import { describe, expect, it, vi } from 'vitest';
import { BrowserExportManager } from '../../src/services/export-manager';
import type { RecordedMediaArtifact } from '../../src/services/interfaces/recording-engine';

function makeArtifact(
  id: string,
  bytes = 2048,
  mimeType = 'video/webm;codecs=vp9,opus',
): RecordedMediaArtifact {
  return {
    id,
    blob: new Blob([new Uint8Array(bytes)], { type: mimeType }),
    mimeType,
    durationMs: 4_200,
    sizeBytes: bytes,
    chunkCount: 6,
    width: 1280,
    height: 720,
    hasAudioTrack: true,
    createdAtIso: '2026-11-14T07:00:00.000Z',
  };
}

describe('BrowserExportManager', () => {
  it('generates sanitized suggested & normalized filenames across OS-reserved chars, Windows stems, and containers', () => {
    const fixedDate = new Date(2026, 10, 14, 7, 30, 5); // 2026-11-14 07:30:05 local
    const manager = new BrowserExportManager({
      clock: () => fixedDate,
    });

    expect(
      manager.buildSuggestedFileName(
        'C:\\Videos\\System Design: Part 1?.mp4',
        'video/webm;codecs=vp9,opus',
      ),
    ).toBe('system-design-part-1-reaction-20261114-073005.webm');

    expect(manager.buildSuggestedFileName(null, 'video/mp4')).toBe(
      'reactstage-reaction-20261114-073005.mp4',
    );

    // Windows reserved device stem protection + illegal slash/colon sanitization
    expect(manager.normalizeDownloadFileName('CON', 'video/webm')).toBe(
      'video-CON.webm',
    );
    expect(
      manager.normalizeDownloadFileName(
        '  Q1/Q2 Review: Final*Take.webm  ',
        'video/webm;codecs=vp9,opus',
      ),
    ).toBe('Q1-Q2-Review-Final-Take.webm');

    // Blank user input falls back cleanly to timestamped reaction stem
    expect(manager.normalizeDownloadFileName('   ...   ', 'video/mp4')).toBe(
      'reactstage-reaction-20261114-073005.mp4',
    );
  });

  it('allocates one preview URL per take, revokes replaced/cleared URLs, reuses active preview URL on download, and cleans up on dispose()', async () => {
    let urlCounter = 0;
    const created: string[] = [];
    const revoked: string[] = [];
    const downloads: { url: string; fileName: string }[] = [];

    const manager = new BrowserExportManager({
      clock: () => new Date(2026, 10, 14, 8, 0, 0),
      urlAdapter: {
        createObjectURL: () => {
          urlCounter += 1;
          const url = `blob:export/${String(urlCounter)}`;
          created.push(url);
          return url;
        },
        revokeObjectURL: (url) => {
          revoked.push(url);
        },
      },
      downloadTrigger: (url, fileName) => {
        downloads.push({ url, fileName });
      },
      ephemeralRevokeDelayMs: 10,
    });

    const take1 = makeArtifact('take-1', 1024);
    const url1 = manager.attachArtifact(take1, 'demo.webm');
    expect(url1).toBe('blob:export/1');
    expect(manager.getState().activeObjectUrlCount).toBe(1);

    // Attaching the exact same take ID reuses blob:export/1 without creating duplicates
    expect(manager.attachArtifact(take1, 'demo.webm')).toBe('blob:export/1');
    expect(created).toEqual(['blob:export/1']);

    // Downloading the active take reuses blob:export/1 without allocating an extra blob URL
    const result = await manager.triggerLocalDownload({
      artifact: take1,
      baseFileName: 'My Custom Take',
    });
    expect(result.downloadFileName).toBe('My-Custom-Take.webm');
    expect(downloads).toEqual([
      { url: 'blob:export/1', fileName: 'My-Custom-Take.webm' },
    ]);
    expect(created).toEqual(['blob:export/1']);
    expect(revoked).toEqual([]);
    expect(manager.getState().status).toBe('exported');
    expect(manager.getState().exportCount).toBe(1);

    // Replacing with take-2 atomically revokes blob:export/1
    const take2 = makeArtifact('take-2', 4096);
    const url2 = manager.attachArtifact(take2, 'demo-v2.webm');
    expect(url2).toBe('blob:export/2');
    expect(revoked).toEqual(['blob:export/1']);
    expect(manager.getState().activeObjectUrlCount).toBe(1);

    // Standalone download of an unattached take allocates an ephemeral URL and auto-revokes it
    const standaloneTake = makeArtifact('take-standalone', 512);
    await manager.triggerLocalDownload({
      artifact: standaloneTake,
      baseFileName: 'Standalone',
    });
    expect(created).toEqual([
      'blob:export/1',
      'blob:export/2',
      'blob:export/3',
    ]);
    await new Promise((r) => setTimeout(r, 25));
    expect(revoked).toContain('blob:export/3');

    // Dispose revokes remaining preview URL idempotently
    manager.dispose();
    manager.dispose();
    expect(manager.getState().activeObjectUrlCount).toBe(0);
    expect(revoked).toEqual([
      'blob:export/1',
      'blob:export/3',
      'blob:export/2',
    ]);
  });

  it('rejects empty artifacts and revokes ephemeral URLs immediately if download trigger throws', async () => {
    const revoked: string[] = [];
    const manager = new BrowserExportManager({
      urlAdapter: {
        createObjectURL: () => 'blob:ephemeral/fail',
        revokeObjectURL: (u) => revoked.push(u),
      },
      downloadTrigger: vi.fn(() => {
        throw new Error('Blocked by sandbox policy');
      }),
    });

    const emptyTake = makeArtifact('empty', 0);
    await expect(
      manager.triggerLocalDownload({
        artifact: emptyTake,
        baseFileName: 'empty',
      }),
    ).rejects.toThrow(/EMPTY_EXPORT_ARTIFACT/);
    expect(manager.getState().error?.code).toBe('EMPTY_EXPORT_ARTIFACT');

    const validTake = makeArtifact('valid', 512);
    await expect(
      manager.triggerLocalDownload({
        artifact: validTake,
        baseFileName: 'valid',
      }),
    ).rejects.toThrow(/DOWNLOAD_TRIGGER_FAILED/);
    expect(revoked).toEqual(['blob:ephemeral/fail']);
  });
});

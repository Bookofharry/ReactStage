import { StrictMode } from 'react';
import { act, fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { App } from '../../src/App';
import { BrowserExportManager } from '../../src/services/export-manager';
import {
  BrowserRecordingEngine,
  type MediaRecorderLike,
} from '../../src/services/recording-engine';

function simulateMetadataLoaded(video: HTMLVideoElement) {
  Object.defineProperty(video, 'duration', {
    configurable: true,
    get: () => 45,
  });
  Object.defineProperty(video, 'videoWidth', {
    configurable: true,
    get: () => 1280,
  });
  Object.defineProperty(video, 'videoHeight', {
    configurable: true,
    get: () => 720,
  });
  fireEvent.loadedMetadata(video);
}

describe('ExportPanel UI, Filename Editing & Object URL Cleanup', () => {
  it('previews finalized recordings locally, sanitizes custom filenames, triggers local download, and revokes Object URLs on replacement, discard, and unmount', async () => {
    let fakeNowMs = 5_000;
    const triggeredDownloads: { url: string; fileName: string }[] = [];
    const exportCreatedUrls: string[] = [];
    const exportRevokedUrls: string[] = [];

    Object.defineProperty(HTMLCanvasElement.prototype, 'captureStream', {
      configurable: true,
      writable: true,
      value: vi.fn(() => {
        let trackState: MediaStreamTrackState = 'live';
        const videoTrack = {
          id: 'canvas-video-exp',
          kind: 'video',
          get readyState() {
            return trackState;
          },
          stop: () => {
            trackState = 'ended';
          },
          getSettings: () => ({ width: 1280, height: 720, frameRate: 30 }),
          addEventListener: vi.fn(),
          removeEventListener: vi.fn(),
        } as unknown as MediaStreamTrack;
        return {
          id: 'canvas-exp-stream',
          active: true,
          getTracks: () => [videoTrack],
          getVideoTracks: () => [videoTrack],
          getAudioTracks: () => [],
        } as unknown as MediaStream;
      }),
    });

    const recordingEngine = new BrowserRecordingEngine({
      now: () => fakeNowMs,
      clockIntervalMs: 50_000,
      isTypeSupported: (mime) => mime === 'video/webm;codecs=vp9',
      mediaRecorderFactory: (_stream, options) => {
        let recState: RecordingState = 'inactive';
        const rec: MediaRecorderLike = {
          get state() {
            return recState;
          },
          mimeType: options.mimeType ?? 'video/webm;codecs=vp9',
          ondataavailable: null,
          onstop: null,
          onerror: null,
          start() {
            recState = 'recording';
          },
          pause() {
            recState = 'paused';
          },
          resume() {
            recState = 'recording';
          },
          requestData() {
            // no-op
          },
          stop() {
            recState = 'inactive';
            const blob = new Blob([new Uint8Array(1024)], {
              type: this.mimeType,
            });
            this.ondataavailable?.({ data: blob } as unknown as BlobEvent);
            queueMicrotask(() => {
              this.onstop?.(new Event('stop'));
            });
          },
        };
        return rec;
      },
    });

    let exportUrlSeq = 0;
    const exportManager = new BrowserExportManager({
      clock: () => new Date(2026, 10, 14, 9, 15, 0),
      urlAdapter: {
        createObjectURL: () => {
          exportUrlSeq += 1;
          const u = `blob:export-ui/${String(exportUrlSeq)}`;
          exportCreatedUrls.push(u);
          return u;
        },
        revokeObjectURL: (u) => {
          exportRevokedUrls.push(u);
        },
      },
      downloadTrigger: (url, fileName) => {
        triggeredDownloads.push({ url, fileName });
      },
    });

    const user = userEvent.setup();
    const { unmount } = render(
      <StrictMode>
        <App
          recordingEngine={recordingEngine}
          exportManager={exportManager}
        />
      </StrictMode>,
    );

    expect(screen.getByTestId('export-empty-state')).toBeInTheDocument();

    // Load local video "Architecture Demo.webm"
    await user.upload(
      screen.getByTestId('source-file-input'),
      new File(['video'], 'Architecture Demo.webm', { type: 'video/webm' }),
    );
    simulateMetadataLoaded(
      screen.getByTestId<HTMLVideoElement>('source-video-element'),
    );

    // Record Take 1
    await user.click(screen.getByTestId('start-recording-button'));
    act(() => {
      fakeNowMs += 2_500;
    });
    await user.click(screen.getByTestId('stop-recording-button'));

    // Preview video & suggested filename appear immediately
    const previewVideo = screen.getByTestId<HTMLVideoElement>(
      'export-preview-video',
    );
    expect(previewVideo.getAttribute('src')).toBe('blob:export-ui/1');

    const filenameInput = screen.getByTestId<HTMLInputElement>(
      'export-filename-input',
    );
    expect(filenameInput.value).toBe(
      'architecture-demo-reaction-20261114-091500.webm',
    );

    // Edit filename with unsafe characters -> normalized live preview sanitizes cleanly
    fireEvent.change(filenameInput, {
      target: { value: 'Code Review: Episode #4?' },
    });
    expect(screen.getByTestId('export-normalized-filename')).toHaveTextContent(
      'Code-Review-Episode-#4.webm',
    );

    // Trigger local download
    await user.click(screen.getByTestId('download-export-button'));
    expect(triggeredDownloads).toEqual([
      {
        url: 'blob:export-ui/1',
        fileName: 'Code-Review-Episode-#4.webm',
      },
    ]);
    expect(screen.getByTestId('export-success-banner')).toHaveTextContent(
      'Code-Review-Episode-#4.webm',
    );

    // Reset suggested filename button restores generated default
    await user.click(screen.getByTestId('reset-export-filename-button'));
    expect(filenameInput.value).toBe(
      'architecture-demo-reaction-20261114-091500.webm',
    );

    // Record Take 2 -> automatically revokes Take 1's preview URL!
    await user.click(screen.getByTestId('start-recording-button'));
    act(() => {
      fakeNowMs += 1_500;
    });
    await user.click(screen.getByTestId('stop-recording-button'));
    expect(exportRevokedUrls).toContain('blob:export-ui/1');
    expect(
      screen.getByTestId<HTMLVideoElement>('export-preview-video').getAttribute('src'),
    ).toBe('blob:export-ui/2');

    // Unmounting revokes Take 2's preview URL leaving 0 active export Object URLs
    unmount();
    expect(exportManager.getState().activeObjectUrlCount).toBe(0);
    expect(exportRevokedUrls).toEqual(['blob:export-ui/1', 'blob:export-ui/2']);
  });
});

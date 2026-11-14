import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SOURCE_440HZ_PATH = path.join(
  __dirname,
  'fixtures',
  'source-440hz-4s.webm',
);

interface ObjectUrlAudit {
  readonly createdCount: number;
  readonly revokedCount: number;
  readonly activeCount: number;
}

async function installStudioDevicesAndObjectUrlAuditor(
  page: Page,
): Promise<void> {
  await page.addInitScript(() => {
    const created: string[] = [];
    const revoked: string[] = [];
    const active = new Set<string>();

    const origCreate = URL.createObjectURL.bind(URL);
    const origRevoke = URL.revokeObjectURL.bind(URL);

    URL.createObjectURL = (obj: Blob | MediaSource): string => {
      const url = origCreate(obj);
      created.push(url);
      active.add(url);
      return url;
    };

    URL.revokeObjectURL = (url: string): void => {
      if (active.has(url)) {
        active.delete(url);
      }
      revoked.push(url);
      origRevoke(url);
    };

    Object.defineProperty(window, '__getExportUrlAudit', {
      value: (): ObjectUrlAudit => ({
        createdCount: created.length,
        revokedCount: revoked.length,
        activeCount: active.size,
      }),
    });

    const OrigAudioContext = window.AudioContext;
    const synthContexts: AudioContext[] = [];
    const synthTimers: number[] = [];

    const md = navigator.mediaDevices;
    md.enumerateDevices = (): Promise<MediaDeviceInfo[]> =>
      Promise.resolve([
        {
          deviceId: 'exp-cam-1',
          kind: 'videoinput',
          label: 'Export Studio Cam',
          groupId: 'grp-exp-cam',
          toJSON() {
            return this;
          },
        },
        {
          deviceId: 'exp-mic-1200',
          kind: 'audioinput',
          label: 'Export 1200Hz Mic',
          groupId: 'grp-exp-mic',
          toJSON() {
            return this;
          },
        },
      ]);

    md.getUserMedia = (
      constraints?: MediaStreamConstraints,
    ): Promise<MediaStream> => {
      if (constraints?.video) {
        const canvas = document.createElement('canvas');
        canvas.width = 640;
        canvas.height = 360;
        const ctx2d = canvas.getContext('2d');
        let frame = 0;
        const draw = (): void => {
          frame += 1;
          if (ctx2d) {
            ctx2d.fillStyle = '#0f172a';
            ctx2d.fillRect(0, 0, 640, 360);
            ctx2d.fillStyle = '#38bdf8';
            ctx2d.fillRect((frame * 15) % 520, 90, 120, 180);
          }
        };
        draw();
        const id = window.setInterval(draw, 33);
        synthTimers.push(id);
        return Promise.resolve(canvas.captureStream(30));
      }

      if (constraints?.audio) {
        const ctx = new OrigAudioContext({ sampleRate: 48000 });
        synthContexts.push(ctx);
        const osc = ctx.createOscillator();
        osc.frequency.value = 1200;
        const gain = ctx.createGain();
        gain.gain.value = 0.5;
        const dest = ctx.createMediaStreamDestination();
        osc.connect(gain);
        gain.connect(dest);
        osc.start();
        return Promise.resolve(dest.stream);
      }

      return Promise.reject(
        new DOMException('Unsupported constraints', 'NotSupportedError'),
      );
    };

    window.addEventListener('pagehide', () => {
      for (const t of synthTimers) window.clearInterval(t);
      for (const c of synthContexts) void c.close();
    });
  });
}

async function getUrlAudit(page: Page): Promise<ObjectUrlAudit> {
  return page.evaluate(() => {
    return (
      window as unknown as { __getExportUrlAudit: () => ObjectUrlAudit }
    ).__getExportUrlAudit();
  });
}

test.describe('ReactStage — Task 6 Local Reaction Export E2E', () => {
  test('previews finalized reaction video locally, downloads valid sanitized WebM file to disk, revokes Object URLs cleanly, and passes WCAG 2.1 AA + responsive checks', async ({
    page,
  }) => {
    await installStudioDevicesAndObjectUrlAuditor(page);
    await page.goto('./');

    await page.getByTestId('source-video-element').evaluate((el) => {
      (el as HTMLVideoElement).loop = true;
    });

    // 1. Load source video + start webcam & microphone + play
    await page.getByTestId('camera-toggle-button').click();
    await page.getByTestId('microphone-toggle-button').click();
    await page
      .getByTestId('source-file-input')
      .setInputFiles(SOURCE_440HZ_PATH);
    await page.getByTestId('play-pause-button').click();

    // 2. Record Take 1 and Stop & Finalize
    await page.getByTestId('start-recording-button').click();
    await expect
      .poll(async () => {
        const text = await page
          .getByTestId('recording-chunks-readout')
          .textContent();
        return Number(text ?? '0');
      })
      .toBeGreaterThanOrEqual(3);
    await page.getByTestId('stop-recording-button').click();

    // 3. Verify ExportPanel preview <video> loads valid finite-duration 1280x720 metadata
    await expect(page.getByTestId('export-status-badge')).toHaveText(
      'Ready to Save',
    );
    await expect
      .poll(async () => {
        return page
          .getByTestId('export-preview-video')
          .evaluate(
            (el: HTMLVideoElement) =>
              el.readyState >= 1 &&
              Number.isFinite(el.duration) &&
              el.duration > 0.4 &&
              el.videoWidth === 1280 &&
              el.videoHeight === 720,
          );
      })
      .toBe(true);

    // Suggested filename incorporates source file stem ("source-440hz-4s-reaction-...")
    const suggested = await page
      .getByTestId('export-filename-input')
      .inputValue();
    expect(suggested).toMatch(/^source-440hz-4s-reaction-\d{8}-\d{6}\.webm$/);

    // 4. Customize filename with unsafe characters & verify real Chromium file download!
    await page
      .getByTestId('export-filename-input')
      .fill('My Reaction: Take #1?');
    await expect(page.getByTestId('export-normalized-filename')).toHaveText(
      'My-Reaction-Take-#1.webm',
    );

    const downloadPromise = page.waitForEvent('download');
    await page.getByTestId('download-export-button').click();
    const download = await downloadPromise;

    expect(download.suggestedFilename()).toBe('My-Reaction-Take-#1.webm');
    await expect(page.getByTestId('export-status-badge')).toHaveText(
      'Downloaded',
    );
    await expect(page.getByTestId('export-success-banner')).toContainText(
      'My-Reaction-Take-#1.webm',
    );

    const downloadedPath = await download.path();
    expect(downloadedPath).not.toBeNull();
    if (downloadedPath) {
      const diskBytes = fs.readFileSync(downloadedPath);
      expect(diskBytes.byteLength).toBeGreaterThan(1000);
      // Verify EBML WebM magic signature 0x1A 0x45 0xDF 0xA3 on disk!
      expect([
        diskBytes[0],
        diskBytes[1],
        diskBytes[2],
        diskBytes[3],
      ]).toEqual([0x1a, 0x45, 0xdf, 0xa3]);
    }

    // 5. Responsive layout (375/768/1280/1440) + WCAG 2.1 AA audit with active preview & success banner
    for (const vp of [
      { width: 375, height: 812 },
      { width: 768, height: 1024 },
      { width: 1280, height: 800 },
      { width: 1440, height: 900 },
    ]) {
      await page.setViewportSize(vp);
      const hasOverflow = await page.evaluate(
        () =>
          document.documentElement.scrollWidth >
          document.documentElement.clientWidth,
      );
      expect(hasOverflow).toBe(false);
    }

    const axeResults = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
      .analyze();
    expect(axeResults.violations).toEqual([]);

    // 6. Discard take & unload source video -> verify ZERO leaked Object URLs remain!
    await page.getByTestId('discard-recording-button').click();
    await page.getByTestId('unload-video-button').click();

    const finalAudit = await getUrlAudit(page);
    expect(finalAudit.createdCount).toBeGreaterThanOrEqual(2);
    expect(finalAudit.activeCount).toBe(0);
  });
});

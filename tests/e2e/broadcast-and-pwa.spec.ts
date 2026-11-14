import { readFile } from 'node:fs/promises';
import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';

test.describe('ReactStage — Tasks 11–14 Broadcast Suite & Offline PWA E2E', () => {
  test('captures live screen/tab stream, freezes frame, renders Lower-Third & Broadcast Audio controls, exports PNG snapshot, and passes WCAG 2.1 AA', async ({
    page,
  }) => {
    const consoleErrors: string[] = [];
    page.on('pageerror', (err) => consoleErrors.push(err.message));

    // Provide deterministic animated screen stream for getDisplayMedia in headless Chromium
    await page.addInitScript(() => {
      const screenCanvas = document.createElement('canvas');
      screenCanvas.width = 1280;
      screenCanvas.height = 720;
      const ctx = screenCanvas.getContext('2d');
      let tick = 0;
      const paint = () => {
        if (!ctx) {
          return;
        }
        tick += 1;
        ctx.fillStyle = '#0ea5e9';
        ctx.fillRect(0, 0, 1280, 720);
        ctx.fillStyle = '#facc15';
        ctx.fillRect(120 + ((tick * 8) % 600), 160, 360, 240);
      };
      paint();
      const timer = window.setInterval(paint, 33);

      navigator.mediaDevices.getDisplayMedia = () => {
        const stream = screenCanvas.captureStream(30);
        for (const track of stream.getVideoTracks()) {
          track.addEventListener('ended', () => {
            window.clearInterval(timer);
          });
        }
        return Promise.resolve(stream);
      };
    });

    await page.goto('./');
    await expect(page.getByTestId('share-screen-button')).toBeVisible();

    // 1. Start Live Screen / Tab Share
    await page.getByTestId('share-screen-button').click();
    await expect(page.getByTestId('live-screen-badge')).toBeVisible();
    await expect(page.getByTestId('source-playback-time')).toHaveText(
      'Live Stream',
    );
    await expect(page.getByTestId('seek-slider')).toBeDisabled();

    // Switch to Source-Only layout and confirm composed stage canvas draws live screen pixels
    await page.getByTestId('layout-mode-source-only').click();
    await expect
      .poll(async () => {
        return page.evaluate(() => {
          const stage = document.querySelector<HTMLCanvasElement>(
            '[data-testid="scene-compositor-canvas"]',
          );
          const ctx = stage?.getContext('2d');
          if (!stage || !ctx) {
            return false;
          }
          const px = ctx.getImageData(
            Math.floor(stage.width / 2),
            Math.floor(stage.height / 2),
            1,
            1,
          ).data;
          // Sky/amber test pattern has high blue or red channel vs dark #020617 backdrop
          return (px[0] ?? 0) > 40 || (px[2] ?? 0) > 80;
        });
      })
      .toBe(true);

    // Freeze and resume live screen capture
    await page.getByTestId('play-pause-button').click();
    await expect(page.getByTestId('source-playback-time')).toHaveText(
      'Live Frozen',
    );
    await page.getByTestId('play-pause-button').click();
    await expect(page.getByTestId('source-playback-time')).toHaveText(
      'Live Stream',
    );

    // 2. Enable Lower-Third ('L' hotkey) and customize headline/subtitle
    await page.keyboard.press('l');
    await expect(page.getByTestId('lower-third-controls-bar')).toBeVisible();
    await page
      .getByTestId('lower-third-title-input')
      .fill('Architecture Live Review');
    await page
      .getByTestId('lower-third-subtitle-input')
      .fill('System Design Deep Dive');

    // 3. Toggle Auto-Duck Video & Voice Clarity on Live Audio Mixer
    await page.getByTestId('mixer-autoduck-toggle').click();
    await page.getByTestId('mixer-mic-processing-toggle').click();
    await expect(page.getByTestId('mixer-autoduck-toggle')).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    await expect(
      page.getByTestId('mixer-mic-processing-toggle'),
    ).toHaveAttribute('aria-pressed', 'true');

    // 4. Export instant PNG thumbnail snapshot & verify real PNG magic header
    const downloadPromise = page.waitForEvent('download');
    await page.getByTestId('capture-snapshot-button').click();
    const download = await downloadPromise;
    expect(download.suggestedFilename()).toMatch(
      /^reactstage-[a-z0-9-]+-\d{8}-\d{6}\.png$/,
    );
    const downloadedPath = await download.path();
    expect(downloadedPath).not.toBeNull();
    if (downloadedPath) {
      const pngBytes = await readFile(downloadedPath);
      expect(pngBytes.byteLength).toBeGreaterThan(256);
      // PNG signature: 89 50 4E 47
      expect(pngBytes[0]).toBe(0x89);
      expect(pngBytes[1]).toBe(0x50);
      expect(pngBytes[2]).toBe(0x4e);
      expect(pngBytes[3]).toBe(0x47);
    }

    // 5. Verify WCAG 2.1 AA accessibility & responsive 375/768/1280/1440 zero horizontal overflow
    const axeResults = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
      .analyze();
    expect(axeResults.violations).toEqual([]);

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

    // Stop screen share cleanly
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.getByTestId('unload-video-button').click();
    await expect(page.getByTestId('live-screen-badge')).toBeHidden();
    expect(consoleErrors).toEqual([]);
  });

  test('serves Web App Manifest, activates Service Worker precache, and reloads 100% offline', async ({
    page,
    context,
  }) => {
    await page.goto('./');
    await expect(page.getByTestId('scene-stage-panel')).toBeVisible();

    // Verify Web App Manifest & icons are served cleanly
    const manifestResp = await page.request.get('./manifest.webmanifest');
    expect(manifestResp.status()).toBe(200);
    const manifestJson = (await manifestResp.json()) as {
      name: string;
      display: string;
      icons: { src: string; sizes: string }[];
    };
    expect(manifestJson.name).toContain('ReactStage');
    expect(manifestJson.display).toBe('standalone');
    expect(manifestJson.icons.length).toBeGreaterThanOrEqual(2);

    // Wait for Service Worker registration, install precache, and active controller claim
    await expect
      .poll(
        async () => {
          return page.evaluate(async () => {
            if (!('serviceWorker' in navigator)) {
              return false;
            }
            const reg = await navigator.serviceWorker.ready;
            return Boolean(reg.active && navigator.serviceWorker.controller);
          });
        },
        { timeout: 15_000 },
      )
      .toBe(true);

    // Cut network completely and reload ReactStage offline
    await context.setOffline(true);
    try {
      await page.reload();
      await expect(page.getByTestId('scene-stage-panel')).toBeVisible();
      await expect(page.getByTestId('audio-mixer-panel')).toBeVisible();
      await expect(page.getByTestId('header-offline-badge')).toBeVisible();
    } finally {
      await context.setOffline(false);
    }
  });
});

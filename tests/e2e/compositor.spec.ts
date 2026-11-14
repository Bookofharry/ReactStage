import path from 'node:path';
import { fileURLToPath } from 'node:url';
import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MOVING_SOURCE_PATH = path.join(
  __dirname,
  'fixtures',
  'moving-source-6s.webm',
);
const PORTRAIT_SOURCE_PATH = path.join(
  __dirname,
  'fixtures',
  'portrait-source-4s.webm',
);

/**
 * Installs a synthetic moving asymmetric webcam:
 * - Left half alternates between bright green (#00ff00) and bright magenta (#ff00ff) every 80ms
 *   so E2E tests can prove live advancing camera pixels on the composed canvas.
 * - Right half remains solid vivid blue (#0033ff) so E2E tests can prove CSS Mirror Preview
 *   never horizontally flips the composed canvas pixels.
 */
async function installMovingAsymmetricCamera(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const camDevice: MediaDeviceInfo = {
      deviceId: 'cam-synth-moving',
      kind: 'videoinput',
      label: 'Synthetic Moving Cam',
      groupId: 'grp-synth',
      toJSON() {
        return this;
      },
    };

    navigator.mediaDevices.enumerateDevices = () =>
      Promise.resolve([camDevice]);

    navigator.mediaDevices.getUserMedia = (
      constraints?: MediaStreamConstraints,
    ): Promise<MediaStream> => {
      if (!constraints?.video) {
        return Promise.reject(
          new DOMException('Video expected', 'NotSupportedError'),
        );
      }

      const srcCanvas = document.createElement('canvas');
      srcCanvas.width = 640;
      srcCanvas.height = 360;
      const ctx = srcCanvas.getContext('2d');
      let toggle = false;

      const drawTick = () => {
        if (!ctx) return;
        toggle = !toggle;
        // Left half: alternating green / magenta
        ctx.fillStyle = toggle ? '#00ff00' : '#ff00ff';
        ctx.fillRect(0, 0, 320, 360);
        // Right half: constant blue
        ctx.fillStyle = '#0033ff';
        ctx.fillRect(320, 0, 320, 360);
      };

      drawTick();
      const timerId = window.setInterval(drawTick, 80);

      const stream = srcCanvas.captureStream(30);
      const track = stream.getVideoTracks()[0];
      if (track) {
        Object.defineProperty(track, 'label', {
          value: 'Synthetic Moving Cam',
        });
        const origGetSettings = track.getSettings.bind(track);
        track.getSettings = () => ({
          ...origGetSettings(),
          deviceId: 'cam-synth-moving',
        });
        const origStop = track.stop.bind(track);
        track.stop = () => {
          window.clearInterval(timerId);
          origStop();
        };
      }

      return Promise.resolve(stream);
    };
  });
}

async function sampleCanvasRegionSignature(
  page: Page,
  rect: { x: number; y: number; w: number; h: number },
): Promise<string> {
  return page.getByTestId('scene-compositor-canvas').evaluate((el, r) => {
    const canvas = el as HTMLCanvasElement;
    const ctx = canvas.getContext('2d');
    if (!ctx) return 'no-ctx';
    const data = ctx.getImageData(r.x, r.y, r.w, r.h).data;
    // Sample a stride of RGBA bytes to form a compact deterministic signature
    const samples: number[] = [];
    const stride = Math.max(4, Math.floor(data.length / 64) * 4);
    for (let i = 0; i < data.length; i += stride) {
      samples.push(
        data[i] ?? 0,
        data[i + 1] ?? 0,
        data[i + 2] ?? 0,
      );
    }
    return samples.join(',');
  }, rect);
}

async function sampleCanvasPixel(
  page: Page,
  x: number,
  y: number,
): Promise<{ r: number; g: number; b: number }> {
  return page
    .getByTestId('scene-compositor-canvas')
    .evaluate(
      (el, coords) => {
        const canvas = el as HTMLCanvasElement;
        const ctx = canvas.getContext('2d');
        if (!ctx) return { r: 0, g: 0, b: 0 };
        const px = ctx.getImageData(coords.x, coords.y, 1, 1).data;
        return { r: px[0] ?? 0, g: px[1] ?? 0, b: px[2] ?? 0 };
      },
      { x, y },
    );
}

test.describe('ReactStage — Task 3 Live Scene Compositor E2E', () => {
  test('renders advancing composite frames, holds paused source frame while webcam stays live, and keeps canvas unflipped under CSS mirror preview', async ({
    page,
  }) => {
    await installMovingAsymmetricCamera(page);
    await page.goto('./');

    // Load moving landscape video and start synthetic moving camera
    await page
      .getByTestId('source-file-input')
      .setInputFiles(MOVING_SOURCE_PATH);
    await expect(page.getByTestId('loaded-file-name')).toHaveText(
      'moving-source-6s.webm',
    );

    await page.getByTestId('camera-toggle-button').click();
    await expect(page.getByTestId('camera-status-badge')).toHaveText('Live');

    // Start source playback in default Picture-in-Picture (1280x720) mode
    await page.getByTestId('play-pause-button').click();

    const bgRegion = { x: 80, y: 80, w: 320, h: 200 };
    const pipLeftRegion = { x: 900, y: 530, w: 120, h: 120 };

    const initialBgSig = await sampleCanvasRegionSignature(page, bgRegion);
    const initialPipSig = await sampleCanvasRegionSignature(
      page,
      pipLeftRegion,
    );

    // Both background source video and foreground PIP camera must advance pixels
    await expect
      .poll(() => sampleCanvasRegionSignature(page, bgRegion), {
        timeout: 4000,
      })
      .not.toBe(initialBgSig);

    await expect
      .poll(() => sampleCanvasRegionSignature(page, pipLeftRegion), {
        timeout: 4000,
      })
      .not.toBe(initialPipSig);

    // Pause source video -> source frame must hold steady while PIP webcam continues advancing!
    await page.getByTestId('play-pause-button').click();
    await page.waitForTimeout(120);

    const heldBgSig1 = await sampleCanvasRegionSignature(page, bgRegion);
    const livePipAtPause = await sampleCanvasRegionSignature(
      page,
      pipLeftRegion,
    );

    // Wait for camera color alternation while source stays paused
    await expect
      .poll(() => sampleCanvasRegionSignature(page, pipLeftRegion), {
        timeout: 3000,
      })
      .not.toBe(livePipAtPause);

    const heldBgSig2 = await sampleCanvasRegionSignature(page, bgRegion);
    expect(heldBgSig2).toBe(heldBgSig1);
    await expect(page.getByTestId('camera-status-badge')).toHaveText('Live');

    // Switch to Webcam Only and verify CSS Mirror Preview never flips canvas pixels
    await page.getByTestId('layout-mode-camera-only').click();
    await expect
      .poll(async () => {
        const rightPx = await sampleCanvasPixel(page, 960, 360);
        return rightPx.b > 180 && rightPx.r < 40;
      })
      .toBe(true);

    // Toggle Mirror Preview off & back on -> right half of canvas stays solid blue (#0033ff)
    await page.getByTestId('camera-mirror-button').click();
    const rightPxUnmirrored = await sampleCanvasPixel(page, 960, 360);
    expect(rightPxUnmirrored.b).toBeGreaterThan(180);
    expect(rightPxUnmirrored.r).toBeLessThan(40);

    await page.getByTestId('camera-mirror-button').click();
    const rightPxMirroredPreview = await sampleCanvasPixel(page, 960, 360);
    expect(rightPxMirroredPreview.b).toBeGreaterThan(180);
    expect(rightPxMirroredPreview.r).toBeLessThan(40);
  });

  test('composites portrait pillarbox & split layouts accurately, switches 720p/1080p dimensions, and supports PIP drag/keyboard controls', async ({
    page,
  }) => {
    await installMovingAsymmetricCamera(page);
    await page.goto('./');

    // Load 9:16 portrait cyan video (360x640)
    await page
      .getByTestId('source-file-input')
      .setInputFiles(PORTRAIT_SOURCE_PATH);
    await expect(page.getByTestId('loaded-file-name')).toHaveText(
      'portrait-source-4s.webm',
    );
    await expect(page.getByText('360×640')).toBeVisible();

    // Wait for initial decoded frame on source-only mode
    await page.getByTestId('layout-mode-source-only').click();
    await expect
      .poll(async () => {
        const centerPx = await sampleCanvasPixel(page, 640, 360);
        return centerPx.g > 130 && centerPx.b > 150 && centerPx.r < 50;
      })
      .toBe(true);

    // Left and right pillarbox margins on 1280x720 must remain dark studio #020617
    const leftBar = await sampleCanvasPixel(page, 120, 360);
    const rightBar = await sampleCanvasPixel(page, 1160, 360);
    expect(leftBar.r).toBeLessThan(20);
    expect(leftBar.b).toBeLessThan(40);
    expect(rightBar.r).toBeLessThan(20);
    expect(rightBar.b).toBeLessThan(40);

    // Switch output resolution to 1920x1080 (1080p)
    await page.getByTestId('scene-resolution-select').selectOption('1080p');
    const dims = await page
      .getByTestId('scene-compositor-canvas')
      .evaluate((el: HTMLCanvasElement) => ({
        width: el.width,
        height: el.height,
      }));
    expect(dims).toEqual({ width: 1920, height: 1080 });
    await expect(page.getByTestId('scene-dimensions-badge')).toContainText(
      '1920×1080',
    );

    // Start camera and test PIP keyboard + pointer controls
    await page.getByTestId('camera-toggle-button').click();
    await page.getByTestId('layout-mode-pip').click();

    await page.getByTestId('pip-corner-top-left').click();
    await expect(page.getByTestId('pip-metrics-readout')).toContainText(
      'X:3% Y:3%',
    );

    const pipDrag = page.getByTestId('pip-drag-handle');
    await pipDrag.focus();
    await page.keyboard.press('Shift+ArrowRight');
    await expect(page.getByTestId('pip-metrics-readout')).toContainText('X:8%');

    await page.getByTestId('pip-size-slider').fill('0.4');
    await expect(page.getByTestId('pip-metrics-readout')).toContainText('40%');

    // Switch to Side-by-Side split layout at 40% split ratio on 1920x1080
    await page.getByTestId('layout-mode-side-by-side').click();
    await page.getByTestId('split-ratio-slider').fill('0.4');
    await expect(page.getByTestId('split-ratio-readout')).toHaveText(
      '40% Source / 60% Webcam',
    );

    // Left pane center (x=384, y=540) shows cyan portrait source; right pane (x=1750, y=540) shows blue camera right-half
    await expect
      .poll(async () => {
        const srcPx = await sampleCanvasPixel(page, 384, 540);
        const camPx = await sampleCanvasPixel(page, 1750, 540);
        return srcPx.g > 130 && srcPx.b > 150 && camPx.b > 180 && camPx.r < 40;
      })
      .toBe(true);
  });

  test('maintains zero horizontal overflow at 375px, 768px, 1280px, and 1440px and passes WCAG 2.1 AA axe-core audits across all modes', async ({
    page,
  }) => {
    await installMovingAsymmetricCamera(page);
    await page.goto('./');

    await page
      .getByTestId('source-file-input')
      .setInputFiles(MOVING_SOURCE_PATH);
    await page.getByTestId('camera-toggle-button').click();
    await expect(page.getByTestId('camera-status-badge')).toHaveText('Live');

    const viewports = [
      { width: 375, height: 812 },
      { width: 768, height: 1024 },
      { width: 1280, height: 800 },
      { width: 1440, height: 900 },
    ] as const;

    for (const mode of [
      'pip',
      'side-by-side',
      'source-only',
      'camera-only',
    ] as const) {
      await page.getByTestId(`layout-mode-${mode}`).click();

      for (const vp of viewports) {
        await page.setViewportSize(vp);
        const hasOverflow = await page.evaluate(
          () => document.documentElement.scrollWidth > window.innerWidth,
        );
        expect(
          hasOverflow,
          `Expected zero horizontal overflow in ${mode} at ${vp.width}px`,
        ).toBe(false);
      }

      const scan = await new AxeBuilder({ page })
        .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
        .analyze();
      expect(scan.violations).toEqual([]);
    }

    // Also audit WCAG 2.1 AA when scene render loop is paused
    await page.getByTestId('scene-loop-toggle-button').click();
    await expect(page.getByTestId('scene-status-badge')).toHaveText(
      'Scene Paused',
    );
    const pausedSceneScan = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
      .analyze();
    expect(pausedSceneScan.violations).toEqual([]);
  });
});

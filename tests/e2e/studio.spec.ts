import path from 'node:path';
import { fileURLToPath } from 'node:url';
import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SAMPLE_15S_PATH = path.join(__dirname, 'fixtures', 'sample-15s.webm');
const SAMPLE_8S_PATH = path.join(__dirname, 'fixtures', 'sample-8s.webm');

interface UrlAuditSnapshot {
  readonly created: string[];
  readonly revoked: string[];
  readonly activeCount: number;
}

async function installObjectUrlTracker(page: Page): Promise<void> {
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
      revoked.push(url);
      active.delete(url);
      origRevoke(url);
    };

    Object.defineProperty(window, '__getObjectUrlAudit', {
      value: () => ({
        created: [...created],
        revoked: [...revoked],
        activeCount: active.size,
      }),
    });
  });
}

async function getObjectUrlAudit(page: Page): Promise<UrlAuditSnapshot> {
  return page.evaluate(() => {
    const fn = (
      window as unknown as { __getObjectUrlAudit: () => UrlAuditSnapshot }
    ).__getObjectUrlAudit;
    return fn();
  });
}

test.describe('ReactStage — Task 1 Chromium E2E Suite', () => {
  test('serves under /ReactStage/ GitHub Pages base path with zero broken assets and honest placeholders', async ({
    page,
  }) => {
    const failedResponses: string[] = [];
    page.on('response', (response) => {
      if (response.status() >= 400) {
        failedResponses.push(`${response.status()} ${response.url()}`);
      }
    });

    await page.goto('./');
    expect(new URL(page.url()).pathname).toBe('/ReactStage/');
    expect(failedResponses).toEqual([]);

    await expect(
      page.getByRole('heading', { name: 'ReactStage' }),
    ).toBeVisible();
    await expect(page.getByTestId('webcam-capture-panel')).toBeVisible();
    await expect(page.getByTestId('microphone-capture-panel')).toBeVisible();
    await expect(page.getByTestId('recording-session-panel')).toBeVisible();
    await expect(page.getByTestId('export-panel')).toBeVisible();

    await expect(page.getByTestId('play-pause-button')).toBeDisabled();
    await expect(page.getByTestId('seek-slider')).toBeDisabled();
  });

  test('plays, pauses, seeks, rewinds, adjusts speed and volume, and keeps source time separate from recording time', async ({
    page,
  }) => {
    await page.goto('./');

    await page.getByTestId('source-file-input').setInputFiles(SAMPLE_15S_PATH);

    await expect(page.getByTestId('loaded-file-name')).toHaveText(
      'sample-15s.webm',
    );
    await expect(page.getByText('320×180')).toBeVisible();
    await expect(page.getByTestId('play-pause-button')).toBeEnabled();

    // Start real playback and confirm currentTime advances while recording clock stays 00:00.0
    await page.getByTestId('play-pause-button').click();
    await expect
      .poll(async () => {
        return page
          .getByTestId('source-video-element')
          .evaluate((el: HTMLVideoElement) => el.currentTime);
      })
      .toBeGreaterThan(0.25);

    await page.getByTestId('play-pause-button').click();
    const pausedVideoState = await page
      .getByTestId('source-video-element')
      .evaluate((el: HTMLVideoElement) => el.paused);
    expect(pausedVideoState).toBe(true);

    // Seek to 12.5 seconds
    await page.getByTestId('seek-slider').fill('12.5');
    await expect(page.getByTestId('source-playback-time')).toContainText(
      '00:12.5',
    );
    await expect(page.getByTestId('header-source-time')).toContainText(
      '00:12.5',
    );

    // Recording clocks must remain strictly 00:00.0
    await expect(page.getByTestId('recording-session-time')).toHaveText(
      '00:00.0',
    );
    await expect(page.getByTestId('header-recording-time')).toHaveText(
      '00:00.0',
    );
    await expect(page.getByTestId('transport-recording-time')).toHaveText(
      '00:00.0',
    );

    // Rewind 10 seconds -> 00:02.5
    await page.getByTestId('rewind-button').click();
    await expect(page.getByTestId('source-playback-time')).toContainText(
      '00:02.5',
    );

    // Restart -> 00:00.0
    await page.getByTestId('restart-button').click();
    await expect(page.getByTestId('source-playback-time')).toContainText(
      '00:00.0 /',
    );

    // Playback speed control -> 1.5x and 0.5x
    await page.getByTestId('playback-speed-select').selectOption('1.5');
    const rate15 = await page
      .getByTestId('source-video-element')
      .evaluate((el: HTMLVideoElement) => el.playbackRate);
    expect(rate15).toBe(1.5);

    await page.getByTestId('playback-speed-select').selectOption('0.5');
    const rate05 = await page
      .getByTestId('source-video-element')
      .evaluate((el: HTMLVideoElement) => el.playbackRate);
    expect(rate05).toBe(0.5);

    // Volume & mute controls unified with Web Audio mixer (no double attenuation on <video>)
    await page.getByTestId('volume-slider').fill('0.35');
    await expect(page.getByTestId('volume-display')).toHaveText('35%');
    await expect(page.getByTestId('mixer-source-gain-value')).toHaveText('35%');
    const domVolume = await page
      .getByTestId('source-video-element')
      .evaluate((el: HTMLVideoElement) => el.volume);
    expect(domVolume).toBe(1);

    await page.getByTestId('mute-toggle-button').click();
    await expect(page.getByTestId('volume-display')).toHaveText('Muted');
    await expect(page.getByTestId('mixer-source-gain-value')).toHaveText(
      'Muted',
    );
    const domMuted = await page
      .getByTestId('source-video-element')
      .evaluate((el: HTMLVideoElement) => el.muted);
    expect(domMuted).toBe(false);
  });

  test('validates unsupported and corrupt files, supports drag-drop and replacement, and revokes Object URLs safely', async ({
    page,
  }) => {
    await installObjectUrlTracker(page);
    await page.goto('./');

    // 1. Drag & drop an unsupported plain-text file
    const dataTransfer = await page.evaluateHandle(() => {
      const dt = new DataTransfer();
      dt.items.add(
        new File(['unsupported notes'], 'notes.txt', { type: 'text/plain' }),
      );
      return dt;
    });
    await page.getByTestId('source-dropzone').dispatchEvent('drop', {
      dataTransfer,
    });

    await expect(page.getByTestId('source-error-alert')).toContainText(
      'UNSUPPORTED_FILE_TYPE',
    );
    expect((await getObjectUrlAudit(page)).activeCount).toBe(0);

    // 2. Upload a corrupt .webm file -> real <video> decode fails & revokes Object URL
    await page.getByTestId('source-file-input').setInputFiles({
      name: 'corrupt.webm',
      mimeType: 'video/webm',
      buffer: Buffer.from('not-a-valid-ebml-matroska-stream'),
    });

    await expect(page.getByTestId('source-error-alert')).toBeVisible();
    const afterCorruptAudit = await getObjectUrlAudit(page);
    expect(afterCorruptAudit.created.length).toBe(1);
    expect(afterCorruptAudit.revoked.length).toBe(1);
    expect(afterCorruptAudit.activeCount).toBe(0);

    // 3. Load valid video 1, then replace with valid video 2 -> revokes video 1 URL
    await page.getByTestId('source-file-input').setInputFiles(SAMPLE_15S_PATH);
    await expect(page.getByTestId('loaded-file-name')).toHaveText(
      'sample-15s.webm',
    );
    expect((await getObjectUrlAudit(page)).activeCount).toBe(1);

    await page.getByTestId('source-file-input').setInputFiles(SAMPLE_8S_PATH);
    await expect(page.getByTestId('loaded-file-name')).toHaveText(
      'sample-8s.webm',
    );
    await expect(page.getByText('640×360')).toBeVisible();

    const afterReplaceAudit = await getObjectUrlAudit(page);
    expect(afterReplaceAudit.created.length).toBe(3);
    expect(afterReplaceAudit.revoked.length).toBe(2);
    expect(afterReplaceAudit.activeCount).toBe(1);

    // 4. Unload video -> revokes remaining active Object URL
    await page.getByTestId('unload-video-button').click();
    await expect(page.getByTestId('select-video-button')).toBeVisible();

    const afterUnloadAudit = await getObjectUrlAudit(page);
    expect(afterUnloadAudit.activeCount).toBe(0);
    expect(afterUnloadAudit.revoked.length).toBe(3);
  });

  test('adapts cleanly across mobile, tablet, and desktop viewports without horizontal overflow', async ({
    page,
  }) => {
    const viewports = [
      { name: 'mobile', width: 375, height: 812 },
      { name: 'tablet', width: 768, height: 1024 },
      { name: 'desktop', width: 1440, height: 900 },
    ] as const;

    await page.goto('./');

    for (const vp of viewports) {
      await page.setViewportSize({ width: vp.width, height: vp.height });

      await expect(
        page.getByRole('heading', { name: 'ReactStage' }),
      ).toBeVisible();
      await expect(page.getByTestId('source-dropzone')).toBeVisible();
      await expect(page.getByTestId('webcam-capture-panel')).toBeVisible();
      await expect(page.getByTestId('microphone-capture-panel')).toBeVisible();
      await expect(page.getByTestId('recording-session-panel')).toBeVisible();
      await expect(page.getByTestId('export-panel')).toBeVisible();

      const hasHorizontalOverflow = await page.evaluate(
        () => document.documentElement.scrollWidth > window.innerWidth,
      );
      expect(
        hasHorizontalOverflow,
        `Expected zero horizontal overflow on ${vp.name} (${vp.width}px)`,
      ).toBe(false);
    }
  });

  test('passes WCAG 2.1 AA automated accessibility checks across empty, loaded, and error states', async ({
    page,
  }) => {
    await page.goto('./');

    // Empty state accessibility scan
    const emptyScan = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
      .analyze();
    expect(emptyScan.violations).toEqual([]);

    // Keyboard navigation sanity check
    await page.keyboard.press('Tab');
    await expect(
      page.getByRole('link', { name: 'Skip to studio workspace' }),
    ).toBeFocused();

    // Loaded state accessibility scan
    await page.getByTestId('source-file-input').setInputFiles(SAMPLE_15S_PATH);
    await expect(page.getByTestId('loaded-file-name')).toHaveText(
      'sample-15s.webm',
    );
    const loadedScan = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
      .analyze();
    expect(loadedScan.violations).toEqual([]);

    // Error state accessibility scan
    await page.getByTestId('source-file-input').setInputFiles({
      name: 'invalid.txt',
      mimeType: 'text/plain',
      buffer: Buffer.from('not video'),
    });
    await expect(page.getByTestId('source-error-alert')).toBeVisible();
    const errorScan = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
      .analyze();
    expect(errorScan.violations).toEqual([]);
  });
});

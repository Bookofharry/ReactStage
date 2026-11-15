import { readFile } from 'node:fs/promises';
import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';

test.describe('ReactStage — Tasks 16–19 Vertical Shorts, IndexedDB Vault, Teleprompter & Trim/WAV E2E', () => {
  test('records 9:16 Vertical Shorts take with non-recorded Teleprompter HUD, exports real RIFF/WAVE .wav, restores take across page reload via IndexedDB with 0 unsolicited media calls, and passes WCAG 2.1 AA', async ({
    page,
  }) => {
    const pageErrors: string[] = [];
    page.on('pageerror', (err) => pageErrors.push(err.message));

    await page.addInitScript(() => {
      let gumCalls = 0;
      let enumCalls = 0;

      const origGum = navigator.mediaDevices.getUserMedia.bind(
        navigator.mediaDevices,
      );
      const origEnum = navigator.mediaDevices.enumerateDevices.bind(
        navigator.mediaDevices,
      );

      navigator.mediaDevices.getUserMedia = async (constraints) => {
        gumCalls += 1;
        return origGum(constraints);
      };

      navigator.mediaDevices.enumerateDevices = async () => {
        enumCalls += 1;
        return origEnum();
      };

      (
        window as unknown as {
          __VAULT_MEDIA_CALLS__: () => { gumCalls: number; enumCalls: number };
          __RESET_VAULT_MEDIA_CALLS__: () => void;
        }
      ).__VAULT_MEDIA_CALLS__ = () => ({ gumCalls, enumCalls });
      (
        window as unknown as {
          __RESET_VAULT_MEDIA_CALLS__: () => void;
        }
      ).__RESET_VAULT_MEDIA_CALLS__ = () => {
        gumCalls = 0;
        enumCalls = 0;
      };
    });

    await page.goto('./');
    await expect(page.getByTestId('scene-resolution-select')).toBeVisible();

    // 1. Switch to 720x1280 (9:16 Shorts) resolution and press hotkey '5' for Top / Bottom layout
    await page
      .getByTestId('scene-resolution-select')
      .selectOption('720p-vertical');
    await page.keyboard.press('5');
    await expect(page.getByTestId('layout-mode-top-bottom')).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    await expect(page.getByTestId('scene-dimensions-badge')).toContainText(
      '720×1280',
    );

    // 2. Toggle Eye-Line Teleprompter ('t') and enter talking points
    await page.keyboard.press('t');
    await expect(page.getByTestId('teleprompter-stage-overlay')).toBeVisible();
    await page
      .getByTestId('teleprompter-script-input')
      .fill('1. Vertical Shorts Hook\n2. Key Architecture Breakdown');
    await page.getByTestId('teleprompter-scroll-toggle').click();
    await expect(
      page.getByTestId('teleprompter-scroll-toggle'),
    ).toHaveAttribute('aria-pressed', 'true');

    // 3. Enable synthetic camera + microphone and record a short 9:16 reaction take
    await page.getByTestId('camera-toggle-button').click();
    await page.getByTestId('microphone-toggle-button').click();
    await page.getByTestId('start-recording-button').click();
    await expect
      .poll(async () => {
        const text = await page
          .getByTestId('recording-chunks-readout')
          .textContent();
        return Number(text ?? '0');
      })
      .toBeGreaterThanOrEqual(2);
    await page.getByTestId('stop-recording-button').click();

    await expect(page.getByTestId('export-preview-video')).toBeVisible();
    await expect(page.getByTestId('session-takes-count')).toHaveText('1');
    await expect(page.getByTestId('vault-status-badge')).toContainText(
      'Vault Saved',
    );
    await expect(page.getByTestId('export-panel')).toContainText('720×1280');

    // 4. Trim clip In point and export companion 16-bit PCM RIFF/WAVE (.wav)
    await page.getByTestId('toggle-trim-tools-button').click();
    await page.getByTestId('trim-start-input').fill('0.1');
    await expect(
      page.getByTestId('download-trimmed-video-button'),
    ).toBeEnabled();

    const wavDownloadPromise = page.waitForEvent('download');
    await page.getByTestId('download-wav-button').click();
    const wavDownload = await wavDownloadPromise;
    expect(wavDownload.suggestedFilename()).toMatch(/\.wav$/i);

    const wavPath = await wavDownload.path();
    expect(wavPath).not.toBeNull();
    if (wavPath) {
      const wavBytes = await readFile(wavPath);
      expect(wavBytes.byteLength).toBeGreaterThan(44);
      // RIFF....WAVE signature
      expect(
        String.fromCharCode(
          wavBytes[0] ?? 0,
          wavBytes[1] ?? 0,
          wavBytes[2] ?? 0,
          wavBytes[3] ?? 0,
        ),
      ).toBe('RIFF');
      expect(
        String.fromCharCode(
          wavBytes[8] ?? 0,
          wavBytes[9] ?? 0,
          wavBytes[10] ?? 0,
          wavBytes[11] ?? 0,
        ),
      ).toBe('WAVE');
    }

    // 5. Run WCAG 2.1 AA axe-core scan & responsive 375/768/1280/1440 zero-overflow check while 9:16 + Teleprompter + Vault + Trim UI are active!
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

    // 6. Reload browser tab -> verify IndexedDB TakeVault restores the 720x1280 take automatically with ZERO unsolicited media calls!
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.reload();

    await expect(page.getByTestId('session-takes-count')).toHaveText('1');
    await expect(page.getByTestId('vault-status-badge')).toContainText(
      'Vault Saved',
    );
    await expect(page.getByTestId('export-panel')).toContainText('720×1280');
    await expect(page.getByTestId('teleprompter-stage-overlay')).toContainText(
      '1. Vertical Shorts Hook',
    );

    const postReloadMediaCalls = await page.evaluate(() =>
      (
        window as unknown as {
          __VAULT_MEDIA_CALLS__: () => { gumCalls: number; enumCalls: number };
        }
      ).__VAULT_MEDIA_CALLS__(),
    );
    expect(postReloadMediaCalls).toEqual({ gumCalls: 0, enumCalls: 0 });
    expect(pageErrors).toEqual([]);
  });
});

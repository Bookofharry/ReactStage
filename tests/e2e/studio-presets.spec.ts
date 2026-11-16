import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';

async function installPermissionCallCounter(page: Page) {
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
        __MEDIA_CALL_COUNTS__: () => { gumCalls: number; enumCalls: number };
      }
    ).__MEDIA_CALL_COUNTS__ = () => ({ gumCalls, enumCalls });
  });
}

test.describe('ReactStage — Task 8 Local Persistence & Creator Presets E2E', () => {
  test('saves and restores layout, resolution, audio gains, and custom presets across page reload with zero unsolicited media calls and 0 WCAG 2.1 AA violations', async ({
    page,
  }) => {
    await installPermissionCallCounter(page);
    await page.goto('./');
    await expect(
      page.getByTestId('open-settings-modal-button'),
    ).toBeVisible();

    // 1. Open Settings -> Creator Presets dialog & run WCAG 2.1 AA axe-core check while open
    await page.getByTestId('open-settings-modal-button').click();
    await page.getByTestId('open-presets-modal-button').click();
    await expect(page.getByTestId('studio-presets-modal')).toBeVisible();

    const openModalAxe = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
      .analyze();
    expect(openModalAxe.violations).toEqual([]);

    // 2. Apply built-in "Code & Design Review" (1080p, Video 70%, Mic 120%, 3s Pre-Roll)
    await page.getByTestId('apply-preset-built-in-review').click();
    await page.keyboard.press('Escape');
    await expect(page.getByTestId('studio-presets-modal')).toBeHidden();

    // Switch layout to Side-by-Side Split and save custom preset "Podcast Split 1080p"
    await page.getByTestId('layout-mode-side-by-side').click();
    await page.getByTestId('open-settings-modal-button').click();
    await page.getByTestId('open-presets-modal-button').click();
    await page.getByTestId('preset-name-input').fill('Podcast Split 1080p');
    await page.getByTestId('save-custom-preset-button').click();
    await expect(page.getByTestId('custom-presets-count')).toHaveText('1');
    await page.keyboard.press('Escape');

    // 3. Reload the browser page -> verify workspace & custom preset persist with 0 media calls!
    await page.reload();
    await expect(
      page.getByTestId('open-settings-modal-button'),
    ).toBeVisible();

    const mediaCounts = await page.evaluate(() =>
      (
        window as unknown as {
          __MEDIA_CALL_COUNTS__: () => { gumCalls: number; enumCalls: number };
        }
      ).__MEDIA_CALL_COUNTS__(),
    );
    expect(mediaCounts).toEqual({ gumCalls: 0, enumCalls: 0 });

    await expect(page.getByTestId('layout-mode-side-by-side')).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    await expect(page.getByTestId('mixer-source-gain-value')).toHaveText('70%');
    await expect(page.getByTestId('mixer-mic-gain-value')).toHaveText('120%');
    await page.getByTestId('open-settings-modal-button').click();
    await expect(page.getByTestId('scene-resolution-select')).toHaveValue(
      '1080p',
    );
    await expect(page.getByTestId('preroll-countdown-toggle')).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    await expect(page.getByTestId('header-presets-count')).toHaveText('1');
    await page.getByTestId('close-settings-modal-button').click();

    // 4. Verify zero horizontal overflow across 375/768/1280/1440
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

    // 5. Reset defaults cleanly
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.getByTestId('open-settings-modal-button').click();
    await page.getByTestId('open-presets-modal-button').click();
    await page.getByTestId('reset-studio-defaults-button').click();
    await expect(
      page.getByTestId('workspace-persistence-badge'),
    ).toHaveText('Factory Default');
    await page.getByTestId('close-presets-modal-button').click();
    await page.getByTestId('open-settings-modal-button').click();
    await expect(page.getByTestId('scene-resolution-select')).toHaveValue(
      '720p',
    );
  });
});

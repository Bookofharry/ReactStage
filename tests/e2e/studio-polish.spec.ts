import path from 'node:path';
import { fileURLToPath } from 'node:url';
import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const SOURCE_440HZ_PATH = path.join(
  __dirname,
  'fixtures',
  'source-440hz-4s.webm',
);

interface UrlAuditReport {
  readonly createdCount: number;
  readonly revokedCount: number;
  readonly activeCount: number;
}

async function installStudioAuditor(page: Page) {
  await page.addInitScript(() => {
    const activeUrls = new Set<string>();
    let createdCount = 0;
    let revokedCount = 0;

    const origCreate = URL.createObjectURL.bind(URL);
    const origRevoke = URL.revokeObjectURL.bind(URL);

    URL.createObjectURL = (obj: Blob | MediaSource): string => {
      const url = origCreate(obj);
      createdCount += 1;
      activeUrls.add(url);
      return url;
    };

    URL.revokeObjectURL = (url: string): void => {
      if (activeUrls.delete(url)) {
        revokedCount += 1;
      }
      origRevoke(url);
    };

    (
      window as unknown as { __URL_AUDIT__: () => UrlAuditReport }
    ).__URL_AUDIT__ = () => ({
      createdCount,
      revokedCount,
      activeCount: activeUrls.size,
    });
  });
}

async function getUrlAudit(page: Page): Promise<UrlAuditReport> {
  return page.evaluate(() =>
    (
      window as unknown as { __URL_AUDIT__: () => UrlAuditReport }
    ).__URL_AUDIT__(),
  );
}

test.describe('ReactStage — Task 7 Studio Polish E2E', () => {
  test('supports keyboard shortcuts dialog, Shift+R pre-roll countdown, multi-take switching, responsive layouts, and WCAG 2.1 AA', async ({
    page,
  }) => {
    await installStudioAuditor(page);
    await page.goto('./');
    await expect(
      page.getByTestId('open-settings-modal-button'),
    ).toBeVisible();

    // 1. Open Shortcuts modal via '?' (Shift+Slash) key and run WCAG 2.1 AA audit while modal is open
    await page.keyboard.press('Shift+Slash');
    await expect(page.getByTestId('keyboard-shortcuts-modal')).toBeVisible();

    const modalAxe = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
      .analyze();
    expect(modalAxe.violations).toEqual([]);

    await page.keyboard.press('Escape');
    await expect(page.getByTestId('keyboard-shortcuts-modal')).toBeHidden();

    // 2. Load source video & switch layouts via global hotkeys 2 -> Split, 1 -> PIP
    await page
      .getByTestId('source-file-input')
      .setInputFiles(SOURCE_440HZ_PATH);
    await page.keyboard.press('2');
    await expect(page.getByTestId('layout-mode-side-by-side')).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    await page.keyboard.press('1');
    await expect(page.getByTestId('layout-mode-pip')).toHaveAttribute(
      'aria-pressed',
      'true',
    );

    // 3. Trigger Shift+R Pre-Roll Countdown -> verify stage overlay appears, then skip to start recording Take #1
    await page.keyboard.press('Shift+R');
    await expect(page.getByTestId('preroll-stage-overlay')).toBeVisible();
    await page.getByTestId('stage-skip-countdown-button').click();
    await expect(page.getByTestId('recording-status-badge')).toHaveText(
      'Recording',
    );

    await expect
      .poll(async () => {
        const text = await page
          .getByTestId('recording-chunks-readout')
          .textContent();
        return Number(text ?? '0');
      })
      .toBeGreaterThanOrEqual(2);

    // Stop Take #1 via 'r' shortcut
    await page.keyboard.press('r');
    await expect(page.getByTestId('session-takes-count')).toHaveText('1');
    await page.getByTestId('export-filename-input').fill('take-one-cut');
    // Blur input so global shortcuts resume cleanly
    await page.getByTestId('export-filename-input').blur();

    // 4. Record Take #2 via 'r' shortcut and stop
    await page.keyboard.press('r');
    await expect(page.getByTestId('recording-status-badge')).toHaveText(
      'Recording',
    );
    await expect
      .poll(async () => {
        const text = await page
          .getByTestId('recording-chunks-readout')
          .textContent();
        return Number(text ?? '0');
      })
      .toBeGreaterThanOrEqual(2);
    await page.keyboard.press('r');

    await expect(page.getByTestId('session-takes-count')).toHaveText('2');
    await expect(page.getByTestId('select-take-button-2')).toHaveAttribute(
      'aria-pressed',
      'true',
    );

    // Switch back to Take #1 in the Multi-Take Session Drawer -> custom filename preserved!
    await page.getByTestId('select-take-button-1').click();
    await expect(page.getByTestId('export-filename-input')).toHaveValue(
      'take-one-cut',
    );

    const downloadPromise = page.waitForEvent('download');
    await page.getByTestId('download-export-button').click();
    const download = await downloadPromise;
    expect(download.suggestedFilename()).toBe('take-one-cut.webm');

    // 5. Responsive check across 375/768/1280/1440 + WCAG 2.1 AA with multi-take drawer populated
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

    const drawerAxe = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
      .analyze();
    expect(drawerAxe.violations).toEqual([]);

    // 6. Clear all takes + unload source -> 0 active Object URLs leaked!
    await page.getByTestId('clear-all-takes-button').click();
    await expect(page.getByTestId('export-empty-state')).toBeVisible();
    await page.getByTestId('unload-video-button').click();

    const audit = await getUrlAudit(page);
    expect(audit.createdCount).toBeGreaterThanOrEqual(3);
    expect(audit.activeCount).toBe(0);
  });
});

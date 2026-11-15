import { promises as fs } from 'node:fs';
import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';

test.describe('ReactStage — Tasks 9 & 10 Stage Telestrator, PIP Framing & Chapter Markers E2E', () => {
  test('renders Telestrator ink onto live canvas pixels, frames circular PIP webcam, records chapter markers, exports YouTube .txt chapters, and passes WCAG 2.1 AA', async ({
    page,
  }) => {
    await page.goto('./');
    await page.getByTestId('toggle-draw-tools-button').click();
    await expect(page.getByTestId('telestrator-toolbar')).toBeVisible();

    // 1. Select Coral Red Arrow tool and draw across the center of the composed <canvas>
    await page.getByTestId('telestrator-tool-arrow').click();
    await page.getByTestId('telestrator-color-coral-red').click();

    const canvasLocator = page.getByTestId('scene-compositor-canvas');
    const box = await canvasLocator.boundingBox();
    expect(box).not.toBeNull();
    if (!box) {
      return;
    }

    const startX = box.x + box.width * 0.25;
    const startY = box.y + box.height * 0.3;
    const endX = box.x + box.width * 0.75;
    const endY = box.y + box.height * 0.3;

    await page.mouse.move(startX, startY);
    await page.mouse.down();
    await page.mouse.move(endX, endY, { steps: 8 });
    await page.mouse.up();

    await expect(page.getByTestId('telestrator-clear-button')).toContainText(
      'Clear (1)',
    );

    // Verify Coral Red (#ef4444) pixels were genuinely composited onto the 1280x720 canvas!
    const midpointRedPixelFound = await page.evaluate(() => {
      const canvas = document.querySelector<HTMLCanvasElement>(
        '[data-testid="scene-compositor-canvas"]',
      );
      const ctx = canvas?.getContext('2d');
      if (!canvas || !ctx) {
        return false;
      }
      const sampleX = Math.round(canvas.width * 0.5);
      const sampleY = Math.round(canvas.height * 0.3);
      const img = ctx.getImageData(sampleX - 4, sampleY - 4, 9, 9).data;
      for (let i = 0; i < img.length; i += 4) {
        const r = img[i] ?? 0;
        const g = img[i + 1] ?? 0;
        const b = img[i + 2] ?? 0;
        if (r > 190 && g < 110 && b < 110) {
          return true;
        }
      }
      return false;
    });
    expect(midpointRedPixelFound).toBe(true);

    // Switch back to Cursor tool, set Circle PIP + Gold Border
    await page.getByTestId('telestrator-tool-none').click();
    await page.getByTestId('toggle-layout-customize-button').click();
    await page.getByTestId('pip-shape-circle').click();
    await page.getByTestId('pip-border-select').selectOption('amber');

    // 2. Start Recording, drop 2 live Chapter Markers (form + hotkey B), and Stop
    await page.getByTestId('start-recording-button').click();
    await expect(page.getByTestId('live-chapter-markers-bar')).toBeVisible();

    await page.waitForTimeout(1150);
    await page
      .getByTestId('chapter-marker-label-input')
      .fill('Canvas Arrow Explanation');
    await page.getByTestId('add-chapter-marker-button').click();
    await expect(page.getByTestId('live-markers-count')).toHaveText('1');

    await page.getByTestId('chapter-marker-label-input').blur();
    await page.waitForTimeout(350);
    await page.keyboard.press('b');
    await expect(page.getByTestId('live-markers-count')).toHaveText('2');

    await page.getByTestId('stop-recording-button').click();
    await expect(page.getByTestId('export-chapters-card')).toBeVisible();

    const chaptersPreviewText = await page
      .getByTestId('youtube-chapters-preview')
      .innerText();
    expect(chaptersPreviewText).toContain('00:00 Intro');
    expect(chaptersPreviewText).toContain('Canvas Arrow Explanation');
    expect(chaptersPreviewText).toContain('Highlight #2');

    // 3. Verify Save .txt downloads valid UTF-8 YouTube chapters file to disk
    const downloadPromise = page.waitForEvent('download');
    await page.getByTestId('download-chapters-txt-button').click();
    const download = await downloadPromise;
    expect(download.suggestedFilename()).toMatch(/-chapters\.txt$/);
    const savedPath = await download.path();
    expect(savedPath).not.toBeNull();
    if (savedPath) {
      const diskText = await fs.readFile(savedPath, 'utf8');
      expect(diskText).toContain('00:00 Intro');
      expect(diskText).toContain('Canvas Arrow Explanation');
    }

    // 4. Audit WCAG 2.1 AA with Telestrator toolbar, Circular PIP controls & Chapters card mounted
    const axe = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
      .analyze();
    expect(axe.violations).toEqual([]);

    // 5. Verify zero horizontal overflow across 375px / 768px / 1280px / 1440px
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
  });
});

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

const REQUIRED_VIEWPORTS: readonly {
  readonly width: number;
  readonly height: number;
}[] = [
  { width: 320, height: 568 },
  { width: 360, height: 800 },
  { width: 375, height: 812 },
  { width: 390, height: 844 },
  { width: 414, height: 896 },
  { width: 430, height: 932 },
  { width: 480, height: 854 },
  { width: 640, height: 960 },
  { width: 768, height: 1024 },
  { width: 820, height: 1180 },
  { width: 1024, height: 768 },
  { width: 1280, height: 800 },
  { width: 1440, height: 900 },
  { width: 1536, height: 864 },
  { width: 1920, height: 1080 },
];

interface ViewportAuditResult {
  readonly width: number;
  readonly docScrollWidth: number;
  readonly docClientWidth: number;
  readonly bodyScrollWidth: number;
  readonly overflowingControls: readonly string[];
  readonly clippedButtons: readonly string[];
  readonly overflowingMedia: readonly string[];
  readonly pipHandlesOverlap: boolean;
  readonly prompterOverlapsStage: boolean;
  readonly emptyPromptClipped: boolean;
  readonly headerIsFixed: boolean;
  readonly headerOverlapsMainAtTop: boolean;
}

async function auditViewport(
  page: Page,
  expectedWidth: number,
): Promise<ViewportAuditResult> {
  return page.evaluate(async (vw) => {
    await new Promise<void>((resolve) => {
      window.requestAnimationFrame(() => resolve());
    });
    const docEl = document.documentElement;
    const body = document.body;

    const isVisible = (el: Element): boolean => {
      const style = window.getComputedStyle(el);
      if (
        style.display === 'none' ||
        style.visibility === 'hidden' ||
        Number(style.opacity) === 0
      ) {
        return false;
      }
      const rect = el.getBoundingClientRect();
      return rect.width > 1 && rect.height > 1;
    };

    const describeEl = (el: Element): string => {
      const testId = el.getAttribute('data-testid');
      if (testId) {
        return `[data-testid="${testId}"]`;
      }
      const id = el.getAttribute('id');
      if (id) {
        return `#${id}`;
      }
      return `${el.tagName.toLowerCase()}(${el.textContent.trim().slice(0, 24)})`;
    };

    const rectsOverlap = (a: DOMRect, b: DOMRect): boolean =>
      a.left < b.right - 0.5 &&
      a.right > b.left + 0.5 &&
      a.top < b.bottom - 0.5 &&
      a.bottom > b.top + 0.5;

    const overflowingControls: string[] = [];
    const clippedButtons: string[] = [];

    const controls = document.querySelectorAll(
      'button, select, textarea, input:not([type="file"])',
    );
    for (const ctrl of controls) {
      if (ctrl.classList.contains('sr-only') || !isVisible(ctrl)) {
        continue;
      }
      const rect = ctrl.getBoundingClientRect();
      if (rect.left < -1 || rect.right > docEl.clientWidth + 1) {
        overflowingControls.push(
          `${describeEl(ctrl)} [${String(Math.round(rect.left))}..${String(Math.round(rect.right))}/${String(docEl.clientWidth)}]`,
        );
      }
      if (
        ctrl instanceof HTMLButtonElement &&
        ctrl.scrollWidth > ctrl.clientWidth + 2
      ) {
        clippedButtons.push(
          `${describeEl(ctrl)} scroll=${String(ctrl.scrollWidth)} > client=${String(ctrl.clientWidth)}`,
        );
      }
    }

    const overflowingMedia: string[] = [];
    for (const media of document.querySelectorAll('canvas, video, img')) {
      if (!isVisible(media)) {
        continue;
      }
      const rect = media.getBoundingClientRect();
      if (rect.width <= 4 || rect.height <= 4) {
        continue;
      }
      const parent = media.parentElement;
      if (parent) {
        const pRect = parent.getBoundingClientRect();
        if (rect.left < pRect.left - 1.5 || rect.right > pRect.right + 1.5) {
          overflowingMedia.push(describeEl(media));
        }
      }
    }

    let pipHandlesOverlap = false;
    const pipDrag = document.querySelector('[data-testid="pip-drag-handle"]');
    const pipResize = document.querySelector(
      '[data-testid="pip-resize-handle"]',
    );
    if (pipDrag && pipResize && isVisible(pipDrag) && isVisible(pipResize)) {
      pipHandlesOverlap = rectsOverlap(
        pipDrag.getBoundingClientRect(),
        pipResize.getBoundingClientRect(),
      );
    }

    let prompterOverlapsStage = false;
    const prompter = document.querySelector(
      '[data-testid="teleprompter-stage-overlay"]',
    );
    const dropzone = document.querySelector('[data-testid="source-dropzone"]');
    if (prompter && dropzone && isVisible(prompter) && isVisible(dropzone)) {
      prompterOverlapsStage = rectsOverlap(
        prompter.getBoundingClientRect(),
        dropzone.getBoundingClientRect(),
      );
    }

    let emptyPromptClipped = false;
    const selectVideoBtn = document.querySelector(
      '[data-testid="source-dropzone"] [data-testid="select-video-button"]',
    );
    const shareScreenBtn = document.querySelector(
      '[data-testid="source-dropzone"] [data-testid="share-screen-button"]',
    );
    if (dropzone && selectVideoBtn && shareScreenBtn && isVisible(dropzone)) {
      const dzRect = dropzone.getBoundingClientRect();
      for (const btn of [selectVideoBtn, shareScreenBtn]) {
        if (!isVisible(btn)) {
          continue;
        }
        const bRect = btn.getBoundingClientRect();
        if (
          bRect.top < dzRect.top - 1 ||
          bRect.bottom > dzRect.bottom + 1 ||
          bRect.left < dzRect.left - 1 ||
          bRect.right > dzRect.right + 1
        ) {
          emptyPromptClipped = true;
        }
      }
    }

    const headerEl = document.querySelector('[data-testid="studio-header"]');
    const mainEl = document.getElementById('studio-main');
    let headerIsFixed = false;
    let headerOverlapsMainAtTop = false;
    if (headerEl && mainEl) {
      const hStyle = window.getComputedStyle(headerEl);
      const hRect = headerEl.getBoundingClientRect();
      headerIsFixed =
        hStyle.position === 'fixed' && Math.abs(hRect.top) <= 0.5;
      if (window.scrollY <= 1) {
        const mRect = mainEl.getBoundingClientRect();
        headerOverlapsMainAtTop = mRect.top < hRect.bottom - 1;
      }
    }

    return {
      width: vw,
      docScrollWidth: docEl.scrollWidth,
      docClientWidth: docEl.clientWidth,
      bodyScrollWidth: body.scrollWidth,
      overflowingControls,
      clippedButtons,
      overflowingMedia,
      pipHandlesOverlap,
      prompterOverlapsStage,
      emptyPromptClipped,
      headerIsFixed,
      headerOverlapsMainAtTop,
    };
  }, expectedWidth);
}

function expectCleanAudit(audit: ViewportAuditResult): void {
  expect(
    audit.headerIsFixed,
    `Expected fixed top navbar header at ${String(audit.width)}px`,
  ).toBe(true);
  expect(
    audit.headerOverlapsMainAtTop,
    `Fixed navbar overlapped main workspace at ${String(audit.width)}px`,
  ).toBe(false);
  expect(
    audit.docScrollWidth,
    `Horizontal document overflow at ${String(audit.width)}px`,
  ).toBeLessThanOrEqual(audit.docClientWidth);
  expect(
    audit.bodyScrollWidth,
    `Horizontal body overflow at ${String(audit.width)}px`,
  ).toBeLessThanOrEqual(audit.docClientWidth);
  expect(
    audit.overflowingControls,
    `Off-screen controls at ${String(audit.width)}px`,
  ).toEqual([]);
  expect(
    audit.clippedButtons,
    `Clipped button labels at ${String(audit.width)}px`,
  ).toEqual([]);
  expect(
    audit.overflowingMedia,
    `Overflowing media elements at ${String(audit.width)}px`,
  ).toEqual([]);
  expect(
    audit.pipHandlesOverlap,
    `PIP drag/resize handles overlapped at ${String(audit.width)}px`,
  ).toBe(false);
  expect(
    audit.prompterOverlapsStage,
    `Teleprompter overlapped composed stage at ${String(audit.width)}px`,
  ).toBe(false);
  expect(
    audit.emptyPromptClipped,
    `Centered empty prompt clipped inside stage at ${String(audit.width)}px`,
  ).toBe(false);
}

test.describe('ReactStage — 15-Viewport Responsive Layout, Touch & Accessibility Verification', () => {
  test('maintains zero horizontal overflow, zero clipped text, zero element overlap, intact media scaling, and WCAG 2.1 AA compliance across all 15 required widths (320px–1920px)', async ({
    page,
  }) => {
    test.setTimeout(90_000);
    const pageErrors: string[] = [];
    page.on('pageerror', (err) => pageErrors.push(err.message));

    await page.goto('./');
    await expect(page.getByTestId('scene-stage-panel')).toBeVisible();

    // Pass 1: Audit initial empty onboarding state across all 15 widths (320px..1920px)
    for (const vp of REQUIRED_VIEWPORTS) {
      await page.setViewportSize(vp);
      const audit = await auditViewport(page, vp.width);
      expectCleanAudit(audit);
    }

    // Verify fixed navbar remains pinned at top (top === 0) while scrolling the page
    await page.setViewportSize({ width: 375, height: 667 });
    await page.evaluate(() => window.scrollTo(0, 240));
    const scrolledHeaderTop = await page
      .getByTestId('studio-header')
      .evaluate((el) => Math.abs(el.getBoundingClientRect().top));
    expect(scrolledHeaderTop).toBeLessThanOrEqual(0.5);
    await page.evaluate(() => window.scrollTo(0, 0));

    // Pass 2: Load rich active studio state (long filename video + camera + mic + Lower-Third + Teleprompter + PIP 16% Top-Left + recorded take + chapter marker + Trim/WAV panel)
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.getByTestId('source-file-input').setInputFiles(MOVING_SOURCE_PATH);
    await expect(page.getByTestId('loaded-file-name')).toBeVisible();

    await page.getByTestId('camera-toggle-button').click();
    await page.getByTestId('microphone-toggle-button').click();

    // Enable Lower-Third + Eye-Line Teleprompter
    await page.getByTestId('lower-third-toggle-button').click();
    await page
      .getByTestId('lower-third-title-input')
      .fill('Responsive Multi-Device Breakdown');
    await page.getByTestId('teleprompter-toggle-button').click();
    await page
      .getByTestId('teleprompter-script-input')
      .fill('Verify every viewport from 320px to 1920px without overlap.');

    // Switch to Picture-in-Picture, snap Top-Left, and shrink PIP to minimum 16% to stress-test handle collision at 320px
    await page.getByTestId('layout-mode-pip').click();
    await page.getByTestId('toggle-layout-customize-button').click();
    await page.getByTestId('pip-corner-top-left').click();
    await page.getByTestId('pip-size-slider').fill('0.16');

    // Record a short reaction take with a long chapter marker label so ExportPanel + Trim + Chapter list are populated
    await page.getByTestId('start-recording-button').click();
    await page
      .getByTestId('chapter-marker-label-input')
      .fill('Mobile Layout Deep Dive Section With Long Chapter Title');
    await page.getByTestId('add-chapter-marker-button').click();
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
    await page.getByTestId('toggle-trim-tools-button').click();

    // Audit all 15 required viewports in full active studio state
    for (const vp of REQUIRED_VIEWPORTS) {
      await page.setViewportSize(vp);
      const audit = await auditViewport(page, vp.width);
      expectCleanAudit(audit);
    }

    // Pass 3: Switch to 9:16 Vertical Shorts + Top/Bottom Split and audit all 15 required viewports
    await page
      .getByTestId('scene-resolution-select')
      .selectOption('720p-vertical');
    await page.getByTestId('layout-mode-top-bottom').click();

    for (const vp of REQUIRED_VIEWPORTS) {
      await page.setViewportSize(vp);
      const audit = await auditViewport(page, vp.width);
      expectCleanAudit(audit);
    }

    // Pass 4: Verify Presets Modal, Shortcuts Modal, and WCAG 2.1 AA axe-core at 320px, 768px, and 1920px
    for (const vp of [
      { width: 320, height: 568 },
      { width: 768, height: 1024 },
      { width: 1920, height: 1080 },
    ]) {
      await page.setViewportSize(vp);

      const axeMain = await new AxeBuilder({ page })
        .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
        .analyze();
      expect(axeMain.violations).toEqual([]);

      const presetsTriggerId =
        vp.width < 640
          ? 'open-presets-modal-button-mobile'
          : 'open-presets-modal-button';
      const shortcutsTriggerId =
        vp.width < 640
          ? 'open-shortcuts-modal-button-mobile'
          : 'open-shortcuts-modal-button';

      await page.getByTestId(presetsTriggerId).click();
      await expect(page.getByTestId('studio-presets-modal')).toBeVisible();
      expectCleanAudit(await auditViewport(page, vp.width));
      await page.getByTestId('close-presets-modal-button').click();

      await page.getByTestId(shortcutsTriggerId).click();
      await expect(page.getByTestId('keyboard-shortcuts-modal')).toBeVisible();
      expectCleanAudit(await auditViewport(page, vp.width));
      await page.getByTestId('close-shortcuts-modal-button').click();
    }

    expect(pageErrors).toEqual([]);
  });
});

import { describe, expect, it } from 'vitest';
import {
  DEFAULT_PIP_RECT,
  DEFAULT_SPLIT_RATIO,
  MAX_PIP_SIZE,
  MAX_SPLIT_RATIO,
  MIN_PIP_SIZE,
  MIN_SPLIT_RATIO,
  clampPipRect,
  clampSplitRatio,
  computeContainRect,
  computeCoverCrop,
  getPipCornerPresetRect,
  nudgePipRect,
  resizePipRect,
  resolvePipPixelRect,
  resolveResolutionOption,
  resolveSplitPanes,
} from '../../src/services/scene-compositor';

describe('SceneCompositor Layout & Aspect-Ratio Geometry', () => {
  it('resolves selectable 720p (1280x720) and 1080p (1920x1080) output presets', () => {
    expect(resolveResolutionOption('720p')).toEqual({
      id: '720p',
      label: '1280×720 (720p)',
      width: 1280,
      height: 720,
    });
    expect(resolveResolutionOption('1080p')).toEqual({
      id: '1080p',
      label: '1920×1080 (1080p)',
      width: 1920,
      height: 1080,
    });
  });

  it('computes aspect-safe contain (letterbox & pillarbox) geometry for landscape and portrait sources', () => {
    const canvas720 = { x: 0, y: 0, width: 1280, height: 720 };

    // 1. Exact 16:9 landscape source fills 1280x720 with zero bars
    expect(computeContainRect(1920, 1080, canvas720)).toEqual({
      x: 0,
      y: 0,
      width: 1280,
      height: 720,
    });

    // 2. Ultra-wide 21:9 (2520x1080) landscape source letterboxes top & bottom cleanly
    const ultrawide = computeContainRect(2520, 1080, canvas720);
    expect(ultrawide.width).toBe(1280);
    expect(ultrawide.height).toBe(Math.round(1280 / (2520 / 1080))); // 549
    expect(ultrawide.x).toBe(0);
    expect(ultrawide.y).toBe(Math.round((720 - ultrawide.height) / 2));

    // 3. Portrait 9:16 (1080x1920) mobile clip pillarboxes left & right without stretching
    const portrait = computeContainRect(1080, 1920, canvas720);
    expect(portrait.height).toBe(720);
    expect(portrait.width).toBe(405); // 720 * (9 / 16)
    expect(portrait.x).toBe(438); // Math.round((1280 - 405) / 2)
    expect(portrait.y).toBe(0);

    // 4. Landscape 16:9 source inside a 50/50 split left pane (638x720) letterboxes vertically
    const leftSplitPane = { x: 0, y: 0, width: 638, height: 720 };
    const splitFit = computeContainRect(1920, 1080, leftSplitPane);
    expect(splitFit.width).toBe(638);
    expect(splitFit.height).toBe(359);
    expect(splitFit.x).toBe(0);
    expect(splitFit.y).toBe(181);

    // 5. Invalid / zero dimensions return 0x0 safely
    expect(computeContainRect(0, 1080, canvas720)).toEqual({
      x: 0,
      y: 0,
      width: 0,
      height: 0,
    });
    expect(computeContainRect(Number.NaN, 1080, canvas720)).toEqual({
      x: 0,
      y: 0,
      width: 0,
      height: 0,
    });
  });

  it('computes centered cover crop for camera-only, PIP, and split camera panes', () => {
    // 1. 16:9 camera (1280x720) into 16:9 full stage (1920x1080) -> full frame, zero crop
    expect(computeCoverCrop(1280, 720, 1920, 1080)).toEqual({
      sx: 0,
      sy: 0,
      sw: 1280,
      sh: 720,
    });

    // 2. 4:3 webcam (640x480) into 16:9 PIP box (358x202) -> crops top & bottom equally
    const crop4x3 = computeCoverCrop(640, 480, 358, 202);
    expect(crop4x3.sx).toBe(0);
    expect(crop4x3.sw).toBe(640);
    expect(crop4x3.sh).toBe(Math.round(640 / (358 / 202))); // 361
    expect(crop4x3.sy).toBe(Math.round((480 - crop4x3.sh) / 2)); // 60

    // 3. 16:9 webcam (1280x720) into tall 50/50 split right pane (638x720) -> crops left & right equally
    const cropSplit = computeCoverCrop(1280, 720, 638, 720);
    expect(cropSplit.sy).toBe(0);
    expect(cropSplit.sh).toBe(720);
    expect(cropSplit.sw).toBe(638);
    expect(cropSplit.sx).toBe(321); // (1280 - 638) / 2

    // 4. Invalid dimensions return safe zero crop
    expect(computeCoverCrop(0, 720, 640, 360)).toEqual({
      sx: 0,
      sy: 0,
      sw: 0,
      sh: 0,
    });
  });

  it('constrains normalized PIP coordinates & sizes within scene bounds and preserves normalized composition across resolutions', () => {
    // Out-of-bounds negative & overflow values are clamped cleanly
    expect(
      clampPipRect({ x: -0.4, y: 0.95, width: 0.9, height: 0.05 }),
    ).toEqual({
      x: 0,
      y: 1 - MIN_PIP_SIZE,
      width: MAX_PIP_SIZE,
      height: MIN_PIP_SIZE,
    });

    // NaN falls back to defaults safely
    expect(
      clampPipRect({
        x: Number.NaN,
        y: Number.POSITIVE_INFINITY,
        width: Number.NaN,
        height: 0.28,
      }),
    ).toEqual(DEFAULT_PIP_RECT);

    // Nudging & resizing near right/bottom edges never pushes PIP outside [0..1]
    const moved = nudgePipRect(DEFAULT_PIP_RECT, 0.5, 0.5);
    expect(moved.x + moved.width).toBeLessThanOrEqual(1);
    expect(moved.y + moved.height).toBeLessThanOrEqual(1);

    const enlarged = resizePipRect(DEFAULT_PIP_RECT, 0.2);
    expect(enlarged.width).toBe(0.48);
    expect(enlarged.height).toBe(0.48);
    expect(enlarged.x + enlarged.width).toBeLessThanOrEqual(1);
    expect(enlarged.y + enlarged.height).toBeLessThanOrEqual(1);

    // Corner presets remain inside margins
    const topLeft = getPipCornerPresetRect('top-left', DEFAULT_PIP_RECT);
    expect(topLeft.x).toBe(0.03);
    expect(topLeft.y).toBe(0.03);

    // Normalized PIP preserves exact relative composition between 720p and 1080p
    const normRect = { x: 0.65, y: 0.65, width: 0.3, height: 0.3 };
    const px720 = resolvePipPixelRect(normRect, 1280, 720);
    const px1080 = resolvePipPixelRect(normRect, 1920, 1080);

    expect(px720).toEqual({ x: 832, y: 468, width: 384, height: 216 });
    expect(px1080).toEqual({ x: 1248, y: 702, width: 576, height: 324 });
    expect(px720.x / 1280).toBeCloseTo(px1080.x / 1920, 4);
    expect(px720.width / 1280).toBeCloseTo(px1080.width / 1920, 4);
  });

  it('clamps side-by-side split ratios and computes exact non-overlapping panes', () => {
    expect(clampSplitRatio(0.05)).toBe(MIN_SPLIT_RATIO);
    expect(clampSplitRatio(0.95)).toBe(MAX_SPLIT_RATIO);
    expect(clampSplitRatio(Number.NaN)).toBe(DEFAULT_SPLIT_RATIO);
    expect(clampSplitRatio(0.62)).toBe(0.62);

    const panes = resolveSplitPanes(0.5, 1280, 720, 4);
    expect(panes.leftPane).toEqual({ x: 0, y: 0, width: 638, height: 720 });
    expect(panes.divider).toEqual({ x: 638, y: 0, width: 4, height: 720 });
    expect(panes.rightPane).toEqual({ x: 642, y: 0, width: 638, height: 720 });
    expect(
      panes.leftPane.width + panes.divider.width + panes.rightPane.width,
    ).toBe(1280);
  });
});

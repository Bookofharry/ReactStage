import {
  SUPPORTED_SCENE_RESOLUTIONS,
  type SceneResolutionOption,
  type SceneResolutionPreset,
} from '../../types/media';
import type { PipOverlayRect } from '../interfaces/scene-compositor';

export const MIN_PIP_SIZE = 0.15;
export const MAX_PIP_SIZE = 0.65;
export const PIP_EDGE_MARGIN = 0.03;

export const DEFAULT_PIP_RECT: PipOverlayRect = {
  x: 0.69,
  y: 0.69,
  width: 0.28,
  height: 0.28,
};

export type PipCornerPreset =
  | 'top-left'
  | 'top-right'
  | 'bottom-left'
  | 'bottom-right';

export const MIN_SPLIT_RATIO = 0.2;
export const MAX_SPLIT_RATIO = 0.8;
export const DEFAULT_SPLIT_RATIO = 0.5;
export const DEFAULT_SPLIT_DIVIDER_PX = 4;

export interface PixelRect {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

export interface SourceCropRect {
  readonly sx: number;
  readonly sy: number;
  readonly sw: number;
  readonly sh: number;
}

export interface SplitPanesGeometry {
  readonly leftPane: PixelRect;
  readonly divider: PixelRect;
  readonly rightPane: PixelRect;
}

function clampNumber(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function roundNormalized(value: number): number {
  return Math.round(value * 10000) / 10000;
}

export function resolveResolutionOption(
  preset: SceneResolutionPreset,
): SceneResolutionOption {
  const match = SUPPORTED_SCENE_RESOLUTIONS.find((opt) => opt.id === preset);
  return (
    match ?? {
      id: '720p',
      label: '1280×720 (720p)',
      width: 1280,
      height: 720,
    }
  );
}

/**
 * Clamps normalized PIP coordinates and dimensions so the overlay always remains
 * strictly inside [0..1] x [0..1] scene bounds and within [MIN_PIP_SIZE..MAX_PIP_SIZE].
 */
export function clampPipRect(rect: PipOverlayRect): PipOverlayRect {
  const rawWidth = Number.isFinite(rect.width)
    ? rect.width
    : DEFAULT_PIP_RECT.width;
  const rawHeight = Number.isFinite(rect.height)
    ? rect.height
    : DEFAULT_PIP_RECT.height;

  const width = roundNormalized(
    clampNumber(rawWidth, MIN_PIP_SIZE, MAX_PIP_SIZE),
  );
  const height = roundNormalized(
    clampNumber(rawHeight, MIN_PIP_SIZE, MAX_PIP_SIZE),
  );

  const maxX = Math.max(0, 1 - width);
  const maxY = Math.max(0, 1 - height);

  const rawX = Number.isFinite(rect.x) ? rect.x : DEFAULT_PIP_RECT.x;
  const rawY = Number.isFinite(rect.y) ? rect.y : DEFAULT_PIP_RECT.y;

  const x = roundNormalized(clampNumber(rawX, 0, maxX));
  const y = roundNormalized(clampNumber(rawY, 0, maxY));

  return { x, y, width, height };
}

export function nudgePipRect(
  rect: PipOverlayRect,
  deltaX: number,
  deltaY: number,
): PipOverlayRect {
  const safeDx = Number.isFinite(deltaX) ? deltaX : 0;
  const safeDy = Number.isFinite(deltaY) ? deltaY : 0;
  return clampPipRect({
    x: rect.x + safeDx,
    y: rect.y + safeDy,
    width: rect.width,
    height: rect.height,
  });
}

export function resizePipRect(
  rect: PipOverlayRect,
  deltaWidth: number,
  deltaHeight: number = deltaWidth,
): PipOverlayRect {
  const safeDw = Number.isFinite(deltaWidth) ? deltaWidth : 0;
  const safeDh = Number.isFinite(deltaHeight) ? deltaHeight : 0;
  return clampPipRect({
    x: rect.x,
    y: rect.y,
    width: rect.width + safeDw,
    height: rect.height + safeDh,
  });
}

export function getPipCornerPresetRect(
  preset: PipCornerPreset,
  currentRect: PipOverlayRect = DEFAULT_PIP_RECT,
): PipOverlayRect {
  const clamped = clampPipRect(currentRect);
  const rightX = Math.max(0, 1 - clamped.width - PIP_EDGE_MARGIN);
  const bottomY = Math.max(0, 1 - clamped.height - PIP_EDGE_MARGIN);
  const leftX = Math.min(PIP_EDGE_MARGIN, Math.max(0, 1 - clamped.width));
  const topY = Math.min(PIP_EDGE_MARGIN, Math.max(0, 1 - clamped.height));

  switch (preset) {
    case 'top-left':
      return clampPipRect({ ...clamped, x: leftX, y: topY });
    case 'top-right':
      return clampPipRect({ ...clamped, x: rightX, y: topY });
    case 'bottom-left':
      return clampPipRect({ ...clamped, x: leftX, y: bottomY });
    case 'bottom-right':
      return clampPipRect({ ...clamped, x: rightX, y: bottomY });
  }
}

export function clampSplitRatio(ratio: number): number {
  if (!Number.isFinite(ratio)) {
    return DEFAULT_SPLIT_RATIO;
  }
  return roundNormalized(clampNumber(ratio, MIN_SPLIT_RATIO, MAX_SPLIT_RATIO));
}

export function resolvePipPixelRect(
  pipRect: PipOverlayRect,
  canvasWidth: number,
  canvasHeight: number,
): PixelRect {
  if (
    !Number.isFinite(canvasWidth) ||
    !Number.isFinite(canvasHeight) ||
    canvasWidth <= 0 ||
    canvasHeight <= 0
  ) {
    return { x: 0, y: 0, width: 0, height: 0 };
  }

  const clamped = clampPipRect(pipRect);
  const width = Math.max(1, Math.round(clamped.width * canvasWidth));
  const height = Math.max(1, Math.round(clamped.height * canvasHeight));
  const x = clampNumber(
    Math.round(clamped.x * canvasWidth),
    0,
    Math.max(0, canvasWidth - width),
  );
  const y = clampNumber(
    Math.round(clamped.y * canvasHeight),
    0,
    Math.max(0, canvasHeight - height),
  );

  return { x, y, width, height };
}

export function resolveSplitPanes(
  splitRatio: number,
  canvasWidth: number,
  canvasHeight: number,
  dividerWidthPx = DEFAULT_SPLIT_DIVIDER_PX,
): SplitPanesGeometry {
  if (
    !Number.isFinite(canvasWidth) ||
    !Number.isFinite(canvasHeight) ||
    canvasWidth <= 0 ||
    canvasHeight <= 0
  ) {
    const empty: PixelRect = { x: 0, y: 0, width: 0, height: 0 };
    return { leftPane: empty, divider: empty, rightPane: empty };
  }

  const clampedRatio = clampSplitRatio(splitRatio);
  const safeDivider = clampNumber(
    Math.round(dividerWidthPx),
    0,
    Math.max(0, Math.floor(canvasWidth * 0.05)),
  );
  const availableWidth = Math.max(2, canvasWidth - safeDivider);
  const leftWidth = clampNumber(
    Math.round(availableWidth * clampedRatio),
    1,
    availableWidth - 1,
  );
  const rightWidth = availableWidth - leftWidth;

  return {
    leftPane: {
      x: 0,
      y: 0,
      width: leftWidth,
      height: canvasHeight,
    },
    divider: {
      x: leftWidth,
      y: 0,
      width: safeDivider,
      height: canvasHeight,
    },
    rightPane: {
      x: leftWidth + safeDivider,
      y: 0,
      width: rightWidth,
      height: canvasHeight,
    },
  };
}

/**
 * Aspect-safe "contain" fit: scales a source media frame (landscape or portrait)
 * inside targetRect without cropping or stretching, centering with letterbox or
 * pillarbox margins when aspect ratios differ.
 */
export function computeContainRect(
  sourceWidth: number,
  sourceHeight: number,
  targetRect: PixelRect,
): PixelRect {
  if (
    !Number.isFinite(sourceWidth) ||
    !Number.isFinite(sourceHeight) ||
    sourceWidth <= 0 ||
    sourceHeight <= 0 ||
    targetRect.width <= 0 ||
    targetRect.height <= 0
  ) {
    return { x: targetRect.x, y: targetRect.y, width: 0, height: 0 };
  }

  const sourceAspect = sourceWidth / sourceHeight;
  const targetAspect = targetRect.width / targetRect.height;

  let drawWidth: number;
  let drawHeight: number;

  if (sourceAspect >= targetAspect) {
    // Source is wider than (or equal to) target -> fit width, letterbox top/bottom
    drawWidth = targetRect.width;
    drawHeight = Math.max(1, Math.round(targetRect.width / sourceAspect));
  } else {
    // Source is taller than target (e.g. 9:16 portrait) -> fit height, pillarbox left/right
    drawHeight = targetRect.height;
    drawWidth = Math.max(1, Math.round(targetRect.height * sourceAspect));
  }

  const offsetX = Math.round((targetRect.width - drawWidth) / 2);
  const offsetY = Math.round((targetRect.height - drawHeight) / 2);

  return {
    x: targetRect.x + offsetX,
    y: targetRect.y + offsetY,
    width: drawWidth,
    height: drawHeight,
  };
}

/**
 * Aspect-safe centered "cover" crop: computes the centered source sub-rectangle
 * (sx, sy, sw, sh) matching targetWidth / targetHeight so camera-only, PIP, and
 * split camera panes fill their destination bounds without stretching.
 */
export function computeCoverCrop(
  sourceWidth: number,
  sourceHeight: number,
  targetWidth: number,
  targetHeight: number,
): SourceCropRect {
  if (
    !Number.isFinite(sourceWidth) ||
    !Number.isFinite(sourceHeight) ||
    sourceWidth <= 0 ||
    sourceHeight <= 0 ||
    !Number.isFinite(targetWidth) ||
    !Number.isFinite(targetHeight) ||
    targetWidth <= 0 ||
    targetHeight <= 0
  ) {
    return { sx: 0, sy: 0, sw: 0, sh: 0 };
  }

  const sourceAspect = sourceWidth / sourceHeight;
  const targetAspect = targetWidth / targetHeight;

  if (Math.abs(sourceAspect - targetAspect) < 1e-4) {
    return { sx: 0, sy: 0, sw: sourceWidth, sh: sourceHeight };
  }

  if (sourceAspect > targetAspect) {
    // Source is wider than destination -> crop left/right equally
    const sw = Math.max(1, Math.round(sourceHeight * targetAspect));
    const sx = Math.round((sourceWidth - sw) / 2);
    return {
      sx: clampNumber(sx, 0, Math.max(0, sourceWidth - sw)),
      sy: 0,
      sw,
      sh: sourceHeight,
    };
  }

  // Source is taller than destination -> crop top/bottom equally
  const sh = Math.max(1, Math.round(sourceWidth / targetAspect));
  const sy = Math.round((sourceHeight - sh) / 2);
  return {
    sx: 0,
    sy: clampNumber(sy, 0, Math.max(0, sourceHeight - sh)),
    sw: sourceWidth,
    sh,
  };
}

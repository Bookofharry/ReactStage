import type {
  PipBorderStyle,
  PipFrameShape,
  SceneResolutionPreset,
  StageLayoutMode,
} from '../../types/media';
import type {
  CompositorConfig,
  CompositorDiagnostics,
  CompositorError,
  CompositorStateSnapshot,
  NormalizedScenePoint,
  PipOverlayRect,
  SceneCompositor,
  StageAnnotation,
} from '../interfaces/scene-compositor';
import {
  DEFAULT_PIP_RECT,
  DEFAULT_SPLIT_DIVIDER_PX,
  DEFAULT_SPLIT_RATIO,
  clampPipRect,
  clampSplitRatio,
  computeContainRect,
  computeCoverCrop,
  resolvePipPixelRect,
  resolveResolutionOption,
  resolveSplitPanes,
  type PixelRect,
} from './layout-geometry';

export const DEFAULT_TARGET_FPS = 30;
const DEFAULT_DIAGNOSTICS_PUBLISH_INTERVAL_MS = 500;
const MAX_STAGE_ANNOTATIONS = 120;
const LASER_TRAIL_TTL_MS = 900;
const MAX_LASER_POINTS = 96;

interface LaserTrailPoint {
  readonly x: number;
  readonly y: number;
  readonly timestampMs: number;
}

function clampNormalizedCoord(value: number): number {
  if (!Number.isFinite(value)) {
    return 0;
  }
  return Math.min(1, Math.max(0, value));
}

function sanitizeAnnotation(annotation: StageAnnotation): StageAnnotation {
  return {
    id: annotation.id,
    kind: annotation.kind,
    color: annotation.color || '#ef4444',
    points: annotation.points.map((pt) => ({
      x: clampNormalizedCoord(pt.x),
      y: clampNormalizedCoord(pt.y),
    })),
  };
}

function resolvePipBorderHex(
  style: PipBorderStyle,
  cameraActive: boolean,
): string | null {
  if (style === 'none') {
    return null;
  }
  if (!cameraActive) {
    return '#475569';
  }
  switch (style) {
    case 'sky':
      return '#38bdf8';
    case 'amber':
      return '#facc15';
    case 'emerald':
      return '#4ade80';
    case 'subtle':
      return '#64748b';
  }
}

function supportsCanvasPathClipping(ctx: CanvasRenderingContext2D): boolean {
  const maybe = ctx as Partial<CanvasRenderingContext2D>;
  return (
    typeof maybe.save === 'function' &&
    typeof maybe.restore === 'function' &&
    typeof maybe.beginPath === 'function' &&
    typeof maybe.clip === 'function' &&
    typeof maybe.arc === 'function'
  );
}

function supportsCanvasPathDrawing(ctx: CanvasRenderingContext2D): boolean {
  const maybe = ctx as Partial<CanvasRenderingContext2D>;
  return (
    typeof maybe.beginPath === 'function' &&
    typeof maybe.moveTo === 'function' &&
    typeof maybe.lineTo === 'function' &&
    typeof maybe.stroke === 'function'
  );
}

function traceRoundedRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
): void {
  const radius = Math.max(0, Math.min(r, w / 2, h / 2));
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.lineTo(x + w - radius, y);
  ctx.arc(x + w - radius, y + radius, radius, -Math.PI / 2, 0);
  ctx.lineTo(x + w, y + h - radius);
  ctx.arc(x + w - radius, y + h - radius, radius, 0, Math.PI / 2);
  ctx.lineTo(x + radius, y + h);
  ctx.arc(x + radius, y + h - radius, radius, Math.PI / 2, Math.PI);
  ctx.lineTo(x, y + radius);
  ctx.arc(x + radius, y + radius, radius, Math.PI, (Math.PI * 3) / 2);
  ctx.closePath();
}

export interface CompositorFrameScheduler {
  requestFrame(callback: (timestampMs: number) => void): number;
  cancelFrame(handle: number): void;
  now(): number;
}

export interface CanvasSceneCompositorOptions {
  readonly initialConfig?: Partial<CompositorConfig>;
  readonly scheduler?: CompositorFrameScheduler;
  readonly createVideoElement?: () => HTMLVideoElement;
  readonly diagnosticsPublishIntervalMs?: number;
}

const defaultScheduler: CompositorFrameScheduler = {
  requestFrame: (cb) => {
    if (
      typeof requestAnimationFrame === 'function' &&
      (typeof document === 'undefined' || document.visibilityState !== 'hidden')
    ) {
      return requestAnimationFrame(cb);
    }
    return Number(
      setTimeout(() => {
        cb(typeof performance !== 'undefined' ? performance.now() : Date.now());
      }, Math.round(1000 / DEFAULT_TARGET_FPS)),
    );
  },
  cancelFrame: (handle) => {
    if (typeof cancelAnimationFrame === 'function') {
      cancelAnimationFrame(handle);
    }
    clearTimeout(handle);
  },
  now: () =>
    typeof performance !== 'undefined' ? performance.now() : Date.now(),
};

function defaultCreateVideoElement(): HTMLVideoElement {
  return document.createElement('video');
}

function isPotentiallyCrossOriginUrl(rawSrc: string): boolean {
  if (
    rawSrc.startsWith('blob:') ||
    rawSrc.startsWith('data:') ||
    rawSrc.startsWith('/') ||
    rawSrc.startsWith('./') ||
    rawSrc.startsWith('../')
  ) {
    return false;
  }

  if (typeof window === 'undefined' || !window.location.origin) {
    return false;
  }

  try {
    const parsed = new URL(rawSrc, window.location.href);
    if (parsed.protocol === 'http:' || parsed.protocol === 'https:') {
      return parsed.origin !== window.location.origin;
    }
    return false;
  } catch {
    return false;
  }
}

type SourceFrameCheck =
  | {
      readonly drawable: true;
      readonly width: number;
      readonly height: number;
    }
  | {
      readonly drawable: false;
      readonly reason: 'missing' | 'loading' | 'error' | 'tainted';
    };

type CameraFrameCheck =
  | {
      readonly drawable: true;
      readonly width: number;
      readonly height: number;
    }
  | {
      readonly drawable: false;
      readonly reason: 'off' | 'warming-up' | 'ended';
    };

function arePipRectsEqual(a: PipOverlayRect, b: PipOverlayRect): boolean {
  return (
    a.x === b.x &&
    a.y === b.y &&
    a.width === b.width &&
    a.height === b.height
  );
}

function areErrorsEqual(
  a: CompositorError | null,
  b: CompositorError | null,
): boolean {
  if (a === b) {
    return true;
  }
  if (!a || !b) {
    return false;
  }
  return (
    a.code === b.code &&
    a.title === b.title &&
    a.message === b.message &&
    a.recoverable === b.recoverable
  );
}

export function createDefaultCompositorConfig(
  overrides: Partial<CompositorConfig> = {},
): CompositorConfig {
  const preset: SceneResolutionPreset = overrides.resolutionPreset ?? '720p';
  const res = resolveResolutionOption(preset);
  const width =
    overrides.width !== undefined &&
    Number.isFinite(overrides.width) &&
    overrides.width > 0
      ? Math.round(overrides.width)
      : res.width;
  const height =
    overrides.height !== undefined &&
    Number.isFinite(overrides.height) &&
    overrides.height > 0
      ? Math.round(overrides.height)
      : res.height;
  const targetFps =
    overrides.targetFps !== undefined &&
    Number.isFinite(overrides.targetFps) &&
    overrides.targetFps > 0
      ? Math.min(60, Math.max(1, Math.round(overrides.targetFps)))
      : DEFAULT_TARGET_FPS;

  return {
    resolutionPreset: preset,
    width,
    height,
    targetFps,
    layoutMode: overrides.layoutMode ?? 'pip',
    pipRect: clampPipRect(overrides.pipRect ?? DEFAULT_PIP_RECT),
    pipFrameShape: overrides.pipFrameShape ?? 'rect',
    pipBorderStyle: overrides.pipBorderStyle ?? 'sky',
    splitRatio: clampSplitRatio(overrides.splitRatio ?? DEFAULT_SPLIT_RATIO),
  };
}

/**
 * Canvas 2D implementation of SceneCompositor.
 *
 * Non-negotiable ownership invariants:
 * - Borrows HTMLVideoElement read-only; never alters playback state or Object URLs.
 * - Borrows active camera MediaStream via an internal muted, playsInline <video>
 *   with zero CSS transforms (canvas output is unaffected by preview mirroring);
 *   never calls stop() on CaptureManager-owned MediaStreamTracks.
 * - Keeps source and microphone audio completely out of the visual compositor.
 * - Guards its 30fps loop with monotonic loopGeneration tokens so start/stop/source
 *   switches never create duplicate loops or leak animation callbacks.
 */
export class CanvasSceneCompositor implements SceneCompositor {
  private readonly scheduler: CompositorFrameScheduler;
  private readonly createVideoElement: () => HTMLVideoElement;
  private readonly diagnosticsPublishIntervalMs: number;

  private config: CompositorConfig;
  private canvas: HTMLCanvasElement | null = null;
  private ctx2d: CanvasRenderingContext2D | null = null;

  private sourceVideo: HTMLVideoElement | null = null;
  private detachSourceListeners: (() => void) | null = null;

  private cameraStream: MediaStream | null = null;
  private cameraVideo: HTMLVideoElement | null = null;
  private detachCameraListeners: (() => void) | null = null;

  private isRunningFlag = false;
  private isDisposed = false;
  private loopGeneration = 0;
  private rafHandle: number | null = null;
  private lastScheduledFrameTimeMs = 0;

  private renderedFramesCount = 0;
  private droppedFramesCount = 0;
  private measuredFpsValue = 0;
  private fpsWindowStartMs = 0;
  private fpsWindowFrames = 0;
  private lastRenderTimestampMs: number | null = null;
  private lastDiagnosticsPublishMs = 0;
  private hasActiveSourceFrame = false;
  private hasActiveCameraFrame = false;
  private lastError: CompositorError | null = null;

  private annotations: StageAnnotation[] = [];
  private draftAnnotation: StageAnnotation | null = null;
  private laserTrail: LaserTrailPoint[] = [];

  private stateSnapshot: CompositorStateSnapshot;
  private diagnosticsSnapshot: CompositorDiagnostics;

  private readonly stateListeners = new Set<
    (state: CompositorStateSnapshot) => void
  >();
  private readonly diagnosticsListeners = new Set<
    (diagnostics: CompositorDiagnostics) => void
  >();

  public constructor(options: CanvasSceneCompositorOptions = {}) {
    this.scheduler = options.scheduler ?? defaultScheduler;
    this.createVideoElement =
      options.createVideoElement ?? defaultCreateVideoElement;
    this.diagnosticsPublishIntervalMs =
      options.diagnosticsPublishIntervalMs ??
      DEFAULT_DIAGNOSTICS_PUBLISH_INTERVAL_MS;
    this.config = createDefaultCompositorConfig(options.initialConfig);
    this.stateSnapshot = this.buildStateSnapshot();
    this.diagnosticsSnapshot = this.buildDiagnosticsSnapshot();
  }

  public getState(): CompositorStateSnapshot {
    return this.stateSnapshot;
  }

  public subscribe(
    listener: (state: CompositorStateSnapshot) => void,
  ): () => void {
    this.stateListeners.add(listener);
    return () => {
      this.stateListeners.delete(listener);
    };
  }

  public getDiagnostics(): CompositorDiagnostics {
    return this.diagnosticsSnapshot;
  }

  public subscribeDiagnostics(
    listener: (diagnostics: CompositorDiagnostics) => void,
  ): () => void {
    this.diagnosticsListeners.add(listener);
    return () => {
      this.diagnosticsListeners.delete(listener);
    };
  }

  public getCanvas(): HTMLCanvasElement | null {
    return this.canvas;
  }

  public attachCanvas(canvas: HTMLCanvasElement | null): void {
    if (this.isDisposed) {
      return;
    }

    if (this.canvas === canvas) {
      return;
    }

    this.canvas = canvas;
    this.ctx2d = null;

    if (!canvas) {
      if (this.lastError?.code === 'CANVAS_CONTEXT_UNAVAILABLE') {
        this.lastError = null;
      }
      this.syncStateAndDiagnostics(true);
      return;
    }

    this.syncCanvasDimensions(canvas);
    const acquiredCtx = this.acquireCanvasContext(canvas);
    this.ctx2d = acquiredCtx;
    this.syncStateAndDiagnostics(true);

    if (acquiredCtx) {
      this.renderFrameNow();
    }
  }

  public configure(patch: Partial<CompositorConfig>): void {
    if (this.isDisposed) {
      return;
    }

    const nextPreset = patch.resolutionPreset ?? this.config.resolutionPreset;
    const presetChanged = nextPreset !== this.config.resolutionPreset;
    const resolvedDims = resolveResolutionOption(nextPreset);

    const nextWidth =
      patch.width !== undefined &&
      Number.isFinite(patch.width) &&
      patch.width > 0
        ? Math.round(patch.width)
        : presetChanged
          ? resolvedDims.width
          : this.config.width;

    const nextHeight =
      patch.height !== undefined &&
      Number.isFinite(patch.height) &&
      patch.height > 0
        ? Math.round(patch.height)
        : presetChanged
          ? resolvedDims.height
          : this.config.height;

    const nextTargetFps =
      patch.targetFps !== undefined &&
      Number.isFinite(patch.targetFps) &&
      patch.targetFps > 0
        ? Math.min(60, Math.max(1, Math.round(patch.targetFps)))
        : this.config.targetFps;

    const nextLayoutMode = patch.layoutMode ?? this.config.layoutMode;
    const nextPipRect = patch.pipRect
      ? clampPipRect(patch.pipRect)
      : this.config.pipRect;
    const nextPipFrameShape =
      patch.pipFrameShape ?? this.config.pipFrameShape;
    const nextPipBorderStyle =
      patch.pipBorderStyle ?? this.config.pipBorderStyle;
    const nextSplitRatio =
      patch.splitRatio !== undefined
        ? clampSplitRatio(patch.splitRatio)
        : this.config.splitRatio;

    const changed =
      nextPreset !== this.config.resolutionPreset ||
      nextWidth !== this.config.width ||
      nextHeight !== this.config.height ||
      nextTargetFps !== this.config.targetFps ||
      nextLayoutMode !== this.config.layoutMode ||
      !arePipRectsEqual(nextPipRect, this.config.pipRect) ||
      nextPipFrameShape !== this.config.pipFrameShape ||
      nextPipBorderStyle !== this.config.pipBorderStyle ||
      nextSplitRatio !== this.config.splitRatio;

    if (!changed) {
      return;
    }

    this.config = {
      resolutionPreset: nextPreset,
      width: nextWidth,
      height: nextHeight,
      targetFps: nextTargetFps,
      layoutMode: nextLayoutMode,
      pipRect: nextPipRect,
      pipFrameShape: nextPipFrameShape,
      pipBorderStyle: nextPipBorderStyle,
      splitRatio: nextSplitRatio,
    };

    if (this.canvas) {
      this.syncCanvasDimensions(this.canvas);
    }

    this.syncStateAndDiagnostics(false);

    if (this.ctx2d) {
      this.renderFrameNow();
    }
  }

  public setResolution(preset: SceneResolutionPreset): void {
    const option = resolveResolutionOption(preset);
    this.configure({
      resolutionPreset: option.id,
      width: option.width,
      height: option.height,
    });
  }

  public setLayoutMode(mode: StageLayoutMode): void {
    this.configure({ layoutMode: mode });
  }

  public setPipRect(rect: PipOverlayRect): void {
    this.configure({ pipRect: clampPipRect(rect) });
  }

  public setPipFrameShape(shape: PipFrameShape): void {
    this.configure({ pipFrameShape: shape });
  }

  public setPipBorderStyle(border: PipBorderStyle): void {
    this.configure({ pipBorderStyle: border });
  }

  public setSplitRatio(ratio: number): void {
    this.configure({ splitRatio: clampSplitRatio(ratio) });
  }

  public getAnnotations(): readonly StageAnnotation[] {
    return this.annotations;
  }

  public addAnnotation(annotation: StageAnnotation): void {
    if (this.isDisposed || annotation.points.length === 0) {
      return;
    }
    const sanitized = sanitizeAnnotation(annotation);
    const next = [...this.annotations, sanitized].slice(-MAX_STAGE_ANNOTATIONS);
    this.annotations = next;
    this.draftAnnotation = null;
    this.syncStateAndDiagnostics(false);
    if (this.ctx2d) {
      this.renderFrameNow();
    }
  }

  public undoAnnotation(): boolean {
    if (this.isDisposed || this.annotations.length === 0) {
      return false;
    }
    this.annotations = this.annotations.slice(0, -1);
    this.syncStateAndDiagnostics(false);
    if (this.ctx2d) {
      this.renderFrameNow();
    }
    return true;
  }

  public clearAnnotations(): void {
    if (this.isDisposed) {
      return;
    }
    const hadAnnotations =
      this.annotations.length > 0 ||
      this.draftAnnotation !== null ||
      this.laserTrail.length > 0;
    if (!hadAnnotations) {
      return;
    }
    this.annotations = [];
    this.draftAnnotation = null;
    this.laserTrail = [];
    this.syncStateAndDiagnostics(false);
    if (this.ctx2d) {
      this.renderFrameNow();
    }
  }

  public setDraftAnnotation(draft: StageAnnotation | null): void {
    if (this.isDisposed) {
      return;
    }
    this.draftAnnotation =
      draft && draft.points.length > 0 ? sanitizeAnnotation(draft) : null;
    if (this.ctx2d) {
      this.renderFrameNow();
    }
  }

  public pushLaserPoint(point: NormalizedScenePoint | null): void {
    if (this.isDisposed) {
      return;
    }
    const nowMs = this.scheduler.now();
    this.laserTrail = this.laserTrail.filter(
      (pt) => nowMs - pt.timestampMs <= LASER_TRAIL_TTL_MS,
    );
    if (point) {
      this.laserTrail.push({
        x: clampNormalizedCoord(point.x),
        y: clampNormalizedCoord(point.y),
        timestampMs: nowMs,
      });
      if (this.laserTrail.length > MAX_LASER_POINTS) {
        this.laserTrail = this.laserTrail.slice(-MAX_LASER_POINTS);
      }
    }
    if (this.ctx2d) {
      this.renderFrameNow();
    }
  }

  public setSourceVideo(element: HTMLVideoElement | null): void {
    if (this.isDisposed || this.sourceVideo === element) {
      return;
    }

    if (this.detachSourceListeners) {
      this.detachSourceListeners();
      this.detachSourceListeners = null;
    }

    this.sourceVideo = element;
    this.hasActiveSourceFrame = false;

    if (
      this.lastError?.code === 'SOURCE_DRAW_FAILED' ||
      this.lastError?.code === 'CANVAS_TAINTED'
    ) {
      this.lastError = null;
    }

    if (element) {
      const onSourceFrameStateChange = () => {
        if (this.isDisposed || this.sourceVideo !== element) {
          return;
        }
        if (
          this.lastError?.code === 'SOURCE_DRAW_FAILED' ||
          this.lastError?.code === 'CANVAS_TAINTED'
        ) {
          this.lastError = null;
        }
        if (this.ctx2d) {
          this.renderFrameNow();
        }
      };

      element.addEventListener('loadedmetadata', onSourceFrameStateChange);
      element.addEventListener('loadeddata', onSourceFrameStateChange);
      element.addEventListener('seeked', onSourceFrameStateChange);
      element.addEventListener('emptied', onSourceFrameStateChange);
      element.addEventListener('error', onSourceFrameStateChange);

      this.detachSourceListeners = () => {
        element.removeEventListener('loadedmetadata', onSourceFrameStateChange);
        element.removeEventListener('loadeddata', onSourceFrameStateChange);
        element.removeEventListener('seeked', onSourceFrameStateChange);
        element.removeEventListener('emptied', onSourceFrameStateChange);
        element.removeEventListener('error', onSourceFrameStateChange);
      };
    }

    this.syncStateAndDiagnostics(true);

    if (this.ctx2d) {
      this.renderFrameNow();
    }
  }

  public setCameraStream(stream: MediaStream | null): void {
    if (this.isDisposed || this.cameraStream === stream) {
      return;
    }

    this.detachBorrowedCameraResources();
    this.cameraStream = stream;
    this.hasActiveCameraFrame = false;

    if (this.lastError?.code === 'CAMERA_PLAYBACK_FAILED') {
      this.lastError = null;
    }

    if (stream) {
      const primaryVideoTrack = stream.getVideoTracks()[0];
      if (primaryVideoTrack?.readyState === 'live') {
        const camVideo = this.ensureCameraVideoElement();
        camVideo.muted = true;
        camVideo.defaultMuted = true;
        camVideo.volume = 0;
        camVideo.playsInline = true;
        camVideo.setAttribute('playsinline', '');
        camVideo.autoplay = true;
        camVideo.srcObject = stream;

        const onCameraStateChanged = () => {
          if (this.isDisposed || this.cameraStream !== stream) {
            return;
          }
          if (primaryVideoTrack.readyState === 'ended') {
            this.hasActiveCameraFrame = false;
            if (this.cameraVideo?.srcObject === stream) {
              this.cameraVideo.srcObject = null;
            }
          }
          if (this.ctx2d) {
            this.renderFrameNow();
          } else {
            this.syncStateAndDiagnostics(true);
          }
        };

        primaryVideoTrack.addEventListener('ended', onCameraStateChanged);
        primaryVideoTrack.addEventListener('mute', onCameraStateChanged);
        primaryVideoTrack.addEventListener('unmute', onCameraStateChanged);
        camVideo.addEventListener('loadeddata', onCameraStateChanged);

        this.detachCameraListeners = () => {
          primaryVideoTrack.removeEventListener('ended', onCameraStateChanged);
          primaryVideoTrack.removeEventListener('mute', onCameraStateChanged);
          primaryVideoTrack.removeEventListener('unmute', onCameraStateChanged);
          camVideo.removeEventListener('loadeddata', onCameraStateChanged);
        };

        try {
          const playPromise = camVideo.play();
          if (playPromise instanceof Promise) {
            void playPromise.catch((err: unknown) => {
              if (this.isDisposed || this.cameraStream !== stream) {
                return;
              }
              if (err instanceof DOMException && err.name === 'AbortError') {
                return;
              }
              const detail =
                err instanceof Error && err.message
                  ? err.message
                  : 'Unable to start internal camera video decoder.';
              this.setCompositorError({
                code: 'CAMERA_PLAYBACK_FAILED',
                title: 'Camera scene feed blocked',
                message: detail,
                recoverable: true,
              });
            });
          }
        } catch {
          // Ignore synchronous stub errors in non-browser environments
        }
      }
    }

    this.syncStateAndDiagnostics(true);

    if (this.ctx2d) {
      this.renderFrameNow();
    }
  }

  public start(canvas?: HTMLCanvasElement): void {
    if (this.isDisposed) {
      return;
    }

    if (canvas !== undefined) {
      this.attachCanvas(canvas);
    }

    if (this.isRunningFlag) {
      if (this.rafHandle === null) {
        this.scheduleNextTick(this.loopGeneration);
      }
      return;
    }

    this.loopGeneration += 1;
    const activeGen = this.loopGeneration;
    this.isRunningFlag = true;
    this.lastScheduledFrameTimeMs = 0;
    this.fpsWindowStartMs = 0;
    this.fpsWindowFrames = 0;
    this.measuredFpsValue = 0;

    if (this.canvas && !this.ctx2d) {
      this.ctx2d = this.acquireCanvasContext(this.canvas);
    }

    if (this.ctx2d) {
      this.drawCompositeFrame(this.scheduler.now(), true);
    }

    this.syncStateAndDiagnostics(true);
    this.scheduleNextTick(activeGen);
  }

  public stop(): void {
    this.loopGeneration += 1;

    if (this.rafHandle !== null) {
      this.scheduler.cancelFrame(this.rafHandle);
      this.rafHandle = null;
    }

    const wasRunning = this.isRunningFlag;
    this.isRunningFlag = false;
    this.lastScheduledFrameTimeMs = 0;
    this.fpsWindowStartMs = 0;
    this.fpsWindowFrames = 0;
    this.measuredFpsValue = 0;

    if (wasRunning || this.diagnosticsSnapshot.isRunning) {
      this.syncStateAndDiagnostics(true);
    }
  }

  public renderFrameNow(): boolean {
    if (this.isDisposed) {
      return false;
    }

    if (this.canvas && !this.ctx2d) {
      this.ctx2d = this.acquireCanvasContext(this.canvas);
    }

    if (!this.canvas || !this.ctx2d) {
      return false;
    }

    this.syncCanvasDimensions(this.canvas);
    return this.drawCompositeFrame(this.scheduler.now(), false);
  }

  public dispose(): void {
    if (this.isDisposed) {
      return;
    }

    this.stop();

    if (this.detachSourceListeners) {
      this.detachSourceListeners();
      this.detachSourceListeners = null;
    }
    this.sourceVideo = null;

    this.detachBorrowedCameraResources();
    this.cameraStream = null;
    this.cameraVideo = null;

    this.canvas = null;
    this.ctx2d = null;
    this.hasActiveSourceFrame = false;
    this.hasActiveCameraFrame = false;
    this.isDisposed = true;

    this.stateSnapshot = this.buildStateSnapshot();
    this.diagnosticsSnapshot = this.buildDiagnosticsSnapshot();
    this.stateListeners.clear();
    this.diagnosticsListeners.clear();
  }

  private isLoopActive(expectedGen: number): boolean {
    return (
      this.isRunningFlag &&
      !this.isDisposed &&
      expectedGen === this.loopGeneration
    );
  }

  private scheduleNextTick(expectedGen: number): void {
    if (!this.isLoopActive(expectedGen)) {
      return;
    }

    this.rafHandle = this.scheduler.requestFrame((rawTimestampMs) => {
      this.rafHandle = null;

      if (!this.isLoopActive(expectedGen)) {
        return;
      }

      const now =
        Number.isFinite(rawTimestampMs) && rawTimestampMs > 0
          ? rawTimestampMs
          : this.scheduler.now();

      const frameIntervalMs = 1000 / this.config.targetFps;

      if (this.lastScheduledFrameTimeMs === 0) {
        this.lastScheduledFrameTimeMs = now;
        this.drawCompositeFrame(now, true);
      } else {
        const elapsed = now - this.lastScheduledFrameTimeMs;
        if (elapsed >= frameIntervalMs - 1.5) {
          if (elapsed >= frameIntervalMs * 2) {
            const missed = Math.min(
              30,
              Math.floor(elapsed / frameIntervalMs) - 1,
            );
            this.droppedFramesCount += Math.max(0, missed);
          }
          this.lastScheduledFrameTimeMs = now - (elapsed % frameIntervalMs);
          this.drawCompositeFrame(now, true);
        }
      }

      if (this.isLoopActive(expectedGen)) {
        this.scheduleNextTick(expectedGen);
      }
    });
  }

  private drawCompositeFrame(timestampMs: number, countForFps: boolean): boolean {
    const canvas = this.canvas;
    const ctx = this.ctx2d;
    if (!canvas || !ctx) {
      return false;
    }

    this.syncCanvasDimensions(canvas);
    const width = canvas.width;
    const height = canvas.height;
    if (width <= 0 || height <= 0) {
      return false;
    }

    // 1. Clear entire scene canvas with studio dark backdrop (#020617)
    ctx.fillStyle = '#020617';
    ctx.fillRect(0, 0, width, height);

    const fullRect: PixelRect = { x: 0, y: 0, width, height };
    const sourceCheck = this.evaluateSourceFrame();
    const cameraCheck = this.evaluateCameraFrame();

    if (!sourceCheck.drawable && sourceCheck.reason === 'tainted') {
      this.setCompositorError({
        code: 'CANVAS_TAINTED',
        title: 'Cross-origin video blocked from scene canvas',
        message:
          'Only local browser-decodable video files are supported to prevent canvas tainting.',
        recoverable: true,
      });
    }

    let sourceDrawn = false;
    let cameraDrawn = false;

    switch (this.config.layoutMode) {
      case 'source-only': {
        sourceDrawn = this.renderSourceRegion(ctx, fullRect, sourceCheck);
        break;
      }
      case 'camera-only': {
        cameraDrawn = this.renderCameraRegion(
          ctx,
          fullRect,
          cameraCheck,
          false,
        );
        break;
      }
      case 'pip': {
        sourceDrawn = this.renderSourceRegion(ctx, fullRect, sourceCheck);
        const pipPx = resolvePipPixelRect(this.config.pipRect, width, height);
        if (pipPx.width > 0 && pipPx.height > 0) {
          cameraDrawn = this.renderPipFramedCamera(
            ctx,
            pipPx,
            cameraCheck,
            width,
          );
        }
        break;
      }
      case 'side-by-side': {
        const panes = resolveSplitPanes(
          this.config.splitRatio,
          width,
          height,
          DEFAULT_SPLIT_DIVIDER_PX,
        );
        sourceDrawn = this.renderSourceRegion(
          ctx,
          panes.leftPane,
          sourceCheck,
        );
        cameraDrawn = this.renderCameraRegion(
          ctx,
          panes.rightPane,
          cameraCheck,
          false,
        );
        if (panes.divider.width > 0) {
          ctx.fillStyle = '#1e293b';
          ctx.fillRect(
            panes.divider.x,
            panes.divider.y,
            panes.divider.width,
            panes.divider.height,
          );
        }
        break;
      }
    }

    this.renderTelestratorLayer(ctx, width, height, timestampMs);

    const activeSourceChanged = sourceDrawn !== this.hasActiveSourceFrame;
    const activeCameraChanged = cameraDrawn !== this.hasActiveCameraFrame;
    this.hasActiveSourceFrame = sourceDrawn;
    this.hasActiveCameraFrame = cameraDrawn;
    this.renderedFramesCount += 1;
    this.lastRenderTimestampMs = timestampMs;

    if (countForFps) {
      if (this.fpsWindowStartMs === 0) {
        this.fpsWindowStartMs = timestampMs;
        this.fpsWindowFrames = 1;
      } else {
        this.fpsWindowFrames += 1;
        const windowElapsedMs = timestampMs - this.fpsWindowStartMs;
        if (windowElapsedMs >= 500) {
          const rawFps = (this.fpsWindowFrames * 1000) / windowElapsedMs;
          this.measuredFpsValue = Math.min(
            this.config.targetFps + 5,
            Math.round(rawFps * 10) / 10,
          );
          this.fpsWindowStartMs = timestampMs;
          this.fpsWindowFrames = 0;
        }
      }
    }

    this.diagnosticsSnapshot = this.buildDiagnosticsSnapshot();

    const shouldPublishDiagnostics =
      activeSourceChanged ||
      activeCameraChanged ||
      this.lastDiagnosticsPublishMs === 0 ||
      timestampMs - this.lastDiagnosticsPublishMs >=
        this.diagnosticsPublishIntervalMs;

    if (shouldPublishDiagnostics) {
      this.lastDiagnosticsPublishMs = timestampMs;
      this.notifyDiagnosticsListeners();
    }

    return true;
  }

  private renderSourceRegion(
    ctx: CanvasRenderingContext2D,
    targetRect: PixelRect,
    check: SourceFrameCheck,
  ): boolean {
    if (targetRect.width <= 0 || targetRect.height <= 0) {
      return false;
    }

    if (check.drawable && this.sourceVideo) {
      const contain = computeContainRect(check.width, check.height, targetRect);
      if (contain.width > 0 && contain.height > 0) {
        try {
          ctx.drawImage(
            this.sourceVideo,
            0,
            0,
            check.width,
            check.height,
            contain.x,
            contain.y,
            contain.width,
            contain.height,
          );
          return true;
        } catch (err: unknown) {
          const isSecurityError =
            err instanceof DOMException && err.name === 'SecurityError';
          this.setCompositorError({
            code: isSecurityError ? 'CANVAS_TAINTED' : 'SOURCE_DRAW_FAILED',
            title: isSecurityError
              ? 'Cross-origin video blocked'
              : 'Source frame could not be drawn',
            message:
              err instanceof Error && err.message
                ? err.message
                : 'The browser failed to copy the current source video frame.',
            recoverable: true,
          });
        }
      }
    }

    const fallbackTitle =
      check.drawable
        ? 'Source Video Unavailable'
        : check.reason === 'loading'
          ? 'Loading Source Video…'
          : check.reason === 'error' || check.reason === 'tainted'
            ? 'Source Video Unavailable'
            : 'No Source Video';

    const fallbackSubtitle =
      !check.drawable && check.reason === 'loading'
        ? 'Decoding local video frame'
        : 'Import a local video file';

    this.drawFallbackRegion(
      ctx,
      targetRect,
      fallbackTitle,
      fallbackSubtitle,
      false,
    );
    return false;
  }

  private renderPipFramedCamera(
    ctx: CanvasRenderingContext2D,
    pipPx: PixelRect,
    cameraCheck: CameraFrameCheck,
    sceneWidth: number,
  ): boolean {
    const shape = this.config.pipFrameShape;
    const borderHex = resolvePipBorderHex(
      this.config.pipBorderStyle,
      cameraCheck.drawable,
    );
    const borderLineWidth = Math.max(2, Math.round(sceneWidth * 0.0022));

    if (shape === 'rect' || !supportsCanvasPathClipping(ctx)) {
      const drawn = this.renderCameraRegion(ctx, pipPx, cameraCheck, true);
      const effectiveBorder = resolvePipBorderHex(
        this.config.pipBorderStyle,
        drawn,
      );
      if (effectiveBorder) {
        ctx.strokeStyle = effectiveBorder;
        ctx.lineWidth = Math.max(2, Math.round(sceneWidth * 0.0018));
        const inset = ctx.lineWidth / 2;
        ctx.strokeRect(
          pipPx.x + inset,
          pipPx.y + inset,
          Math.max(1, pipPx.width - ctx.lineWidth),
          Math.max(1, pipPx.height - ctx.lineWidth),
        );
      }
      return drawn;
    }

    if (shape === 'circle') {
      const diameter = Math.min(pipPx.width, pipPx.height);
      const radius = diameter / 2;
      const cx = pipPx.x + pipPx.width / 2;
      const cy = pipPx.y + pipPx.height / 2;
      const squareRect: PixelRect = {
        x: Math.round(cx - radius),
        y: Math.round(cy - radius),
        width: Math.round(diameter),
        height: Math.round(diameter),
      };

      ctx.save();
      ctx.beginPath();
      ctx.arc(cx, cy, Math.max(1, radius), 0, Math.PI * 2);
      ctx.closePath();
      ctx.clip();
      const drawn = this.renderCameraRegion(ctx, squareRect, cameraCheck, true);
      ctx.restore();

      const effectiveBorder = resolvePipBorderHex(
        this.config.pipBorderStyle,
        drawn,
      );
      if (effectiveBorder && typeof ctx.stroke === 'function') {
        ctx.save();
        ctx.strokeStyle = effectiveBorder;
        ctx.lineWidth = borderLineWidth;
        ctx.beginPath();
        ctx.arc(
          cx,
          cy,
          Math.max(1, radius - borderLineWidth / 2),
          0,
          Math.PI * 2,
        );
        ctx.closePath();
        ctx.stroke();
        ctx.restore();
      } else if (borderHex) {
        ctx.strokeStyle = borderHex;
      }
      return drawn;
    }

    // shape === 'rounded'
    const cornerRadius = Math.max(
      8,
      Math.round(Math.min(pipPx.width, pipPx.height) * 0.1),
    );
    ctx.save();
    traceRoundedRect(
      ctx,
      pipPx.x,
      pipPx.y,
      pipPx.width,
      pipPx.height,
      cornerRadius,
    );
    ctx.clip();
    const drawn = this.renderCameraRegion(ctx, pipPx, cameraCheck, true);
    ctx.restore();

    const effectiveBorder = resolvePipBorderHex(
      this.config.pipBorderStyle,
      drawn,
    );
    if (effectiveBorder && typeof ctx.stroke === 'function') {
      const inset = borderLineWidth / 2;
      ctx.save();
      ctx.strokeStyle = effectiveBorder;
      ctx.lineWidth = borderLineWidth;
      traceRoundedRect(
        ctx,
        pipPx.x + inset,
        pipPx.y + inset,
        Math.max(1, pipPx.width - borderLineWidth),
        Math.max(1, pipPx.height - borderLineWidth),
        Math.max(4, cornerRadius - inset),
      );
      ctx.stroke();
      ctx.restore();
    }
    return drawn;
  }

  private renderTelestratorLayer(
    ctx: CanvasRenderingContext2D,
    width: number,
    height: number,
    nowMs: number,
  ): void {
    const hasCommitted = this.annotations.length > 0;
    const draft = this.draftAnnotation;
    if (this.laserTrail.length > 0) {
      this.laserTrail = this.laserTrail.filter(
        (pt) => nowMs - pt.timestampMs <= LASER_TRAIL_TTL_MS,
      );
    }
    const hasLaser = this.laserTrail.length > 0;

    if (!hasCommitted && !draft && !hasLaser) {
      return;
    }

    const baseStrokePx = Math.max(3, Math.round(width * 0.0034));

    for (const item of this.annotations) {
      this.renderSingleAnnotation(ctx, item, width, height, baseStrokePx);
    }
    if (draft) {
      this.renderSingleAnnotation(ctx, draft, width, height, baseStrokePx);
    }

    if (hasLaser && supportsCanvasPathDrawing(ctx)) {
      const hasSave = typeof (ctx as Partial<CanvasRenderingContext2D>).save === 'function';
      if (hasSave) {
        ctx.save();
      }
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';

      for (let i = 1; i < this.laserTrail.length; i += 1) {
        const prev = this.laserTrail[i - 1];
        const curr = this.laserTrail[i];
        if (!prev || !curr) {
          continue;
        }
        const ageMs = Math.max(0, nowMs - curr.timestampMs);
        const alpha = Math.max(0.08, 1 - ageMs / LASER_TRAIL_TTL_MS);
        ctx.globalAlpha = alpha;
        ctx.strokeStyle = '#f43f5e';
        ctx.lineWidth = Math.max(2, Math.round(baseStrokePx * (0.6 + alpha)));
        ctx.beginPath();
        ctx.moveTo(prev.x * width, prev.y * height);
        ctx.lineTo(curr.x * width, curr.y * height);
        ctx.stroke();
      }

      const tip = this.laserTrail[this.laserTrail.length - 1];
      if (
        tip &&
        typeof (ctx as Partial<CanvasRenderingContext2D>).arc === 'function' &&
        typeof (ctx as Partial<CanvasRenderingContext2D>).fill === 'function'
      ) {
        const tipAge = Math.max(0, nowMs - tip.timestampMs);
        const tipAlpha = Math.max(0.15, 1 - tipAge / LASER_TRAIL_TTL_MS);
        const tipX = tip.x * width;
        const tipY = tip.y * height;
        ctx.globalAlpha = tipAlpha;
        ctx.fillStyle = '#f43f5e';
        ctx.beginPath();
        ctx.arc(tipX, tipY, Math.max(6, baseStrokePx * 1.7), 0, Math.PI * 2);
        ctx.fill();

        ctx.fillStyle = '#ffffff';
        ctx.beginPath();
        ctx.arc(tipX, tipY, Math.max(2.5, baseStrokePx * 0.7), 0, Math.PI * 2);
        ctx.fill();
      }

      ctx.globalAlpha = 1;
      if (hasSave) {
        ctx.restore();
      }
    }
  }

  private renderSingleAnnotation(
    ctx: CanvasRenderingContext2D,
    annotation: StageAnnotation,
    width: number,
    height: number,
    strokePx: number,
  ): void {
    const pts = annotation.points;
    const first = pts[0];
    if (!first) {
      return;
    }

    const hasSave =
      typeof (ctx as Partial<CanvasRenderingContext2D>).save === 'function';
    if (hasSave) {
      ctx.save();
    }

    ctx.strokeStyle = annotation.color;
    ctx.fillStyle = annotation.color;
    ctx.lineWidth = strokePx;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';

    if (annotation.kind === 'rect') {
      const end = pts[pts.length - 1] ?? first;
      const x1 = Math.min(first.x, end.x) * width;
      const y1 = Math.min(first.y, end.y) * height;
      const rectW = Math.max(4, Math.abs(end.x - first.x) * width);
      const rectH = Math.max(4, Math.abs(end.y - first.y) * height);

      ctx.globalAlpha = 0.14;
      ctx.fillRect(x1, y1, rectW, rectH);
      ctx.globalAlpha = 1;
      ctx.strokeRect(x1, y1, rectW, rectH);

      if (hasSave) {
        ctx.restore();
      }
      return;
    }

    if (!supportsCanvasPathDrawing(ctx)) {
      ctx.fillRect(first.x * width, first.y * height, strokePx, strokePx);
      if (hasSave) {
        ctx.restore();
      }
      return;
    }

    if (annotation.kind === 'arrow') {
      const end = pts[pts.length - 1] ?? first;
      const x1 = first.x * width;
      const y1 = first.y * height;
      const x2 = end.x * width;
      const y2 = end.y * height;

      ctx.beginPath();
      ctx.moveTo(x1, y1);
      ctx.lineTo(x2, y2);
      ctx.stroke();

      const dx = x2 - x1;
      const dy = y2 - y1;
      const dist = Math.hypot(dx, dy);
      if (dist >= 2) {
        const angle = Math.atan2(dy, dx);
        const headLength = Math.max(14, Math.round(strokePx * 4.2));
        const spread = Math.PI / 6;

        ctx.beginPath();
        ctx.moveTo(x2, y2);
        ctx.lineTo(
          x2 - headLength * Math.cos(angle - spread),
          y2 - headLength * Math.sin(angle - spread),
        );
        ctx.lineTo(
          x2 - headLength * Math.cos(angle + spread),
          y2 - headLength * Math.sin(angle + spread),
        );
        ctx.closePath();
        if (typeof (ctx as Partial<CanvasRenderingContext2D>).fill === 'function') {
          ctx.fill();
        } else {
          ctx.stroke();
        }
      }

      if (hasSave) {
        ctx.restore();
      }
      return;
    }

    // annotation.kind === 'pen'
    if (pts.length === 1) {
      if (
        typeof (ctx as Partial<CanvasRenderingContext2D>).arc === 'function' &&
        typeof (ctx as Partial<CanvasRenderingContext2D>).fill === 'function'
      ) {
        ctx.beginPath();
        ctx.arc(
          first.x * width,
          first.y * height,
          Math.max(2, strokePx / 2),
          0,
          Math.PI * 2,
        );
        ctx.fill();
      } else {
        ctx.fillRect(first.x * width, first.y * height, strokePx, strokePx);
      }
    } else {
      ctx.beginPath();
      ctx.moveTo(first.x * width, first.y * height);
      for (let i = 1; i < pts.length; i += 1) {
        const pt = pts[i];
        if (pt) {
          ctx.lineTo(pt.x * width, pt.y * height);
        }
      }
      ctx.stroke();
    }

    if (hasSave) {
      ctx.restore();
    }
  }

  private renderCameraRegion(
    ctx: CanvasRenderingContext2D,
    targetRect: PixelRect,
    check: CameraFrameCheck,
    compactOverlay: boolean,
  ): boolean {
    if (targetRect.width <= 0 || targetRect.height <= 0) {
      return false;
    }

    if (compactOverlay) {
      ctx.fillStyle = '#0f172a';
      ctx.fillRect(
        targetRect.x,
        targetRect.y,
        targetRect.width,
        targetRect.height,
      );
    }

    if (check.drawable && this.cameraVideo) {
      const crop = computeCoverCrop(
        check.width,
        check.height,
        targetRect.width,
        targetRect.height,
      );
      if (crop.sw > 0 && crop.sh > 0) {
        try {
          ctx.drawImage(
            this.cameraVideo,
            crop.sx,
            crop.sy,
            crop.sw,
            crop.sh,
            targetRect.x,
            targetRect.y,
            targetRect.width,
            targetRect.height,
          );
          return true;
        } catch {
          // Fall through to honest fallback box if camera frame is momentarily unreadable
        }
      }
    }

    const title =
      !check.drawable && check.reason === 'warming-up'
        ? 'Starting Camera…'
        : 'Camera Off';
    const subtitle = compactOverlay ? '' : 'Start camera in Capture Setup';

    this.drawFallbackRegion(
      ctx,
      targetRect,
      title,
      subtitle,
      compactOverlay,
    );
    return false;
  }

  private drawFallbackRegion(
    ctx: CanvasRenderingContext2D,
    rect: PixelRect,
    title: string,
    subtitle: string,
    compact: boolean,
  ): void {
    ctx.fillStyle = '#0f172a';
    if (compact) {
      ctx.fillRect(rect.x, rect.y, rect.width, rect.height);
    } else {
      const cardW = Math.min(
        Math.round(rect.width * 0.72),
        Math.max(220, Math.round(rect.width * 0.5)),
      );
      const cardH = Math.min(Math.round(rect.height * 0.44), 160);
      const cardX = rect.x + Math.round((rect.width - cardW) / 2);
      const cardY = rect.y + Math.round((rect.height - cardH) / 2);
      ctx.fillRect(cardX, cardY, cardW, cardH);
      ctx.strokeStyle = '#1e293b';
      ctx.lineWidth = 2;
      ctx.strokeRect(cardX, cardY, cardW, cardH);
    }

    const centerX = rect.x + Math.round(rect.width / 2);
    const centerY = rect.y + Math.round(rect.height / 2);
    const titleFontPx = compact
      ? Math.max(12, Math.min(22, Math.round(rect.height * 0.13)))
      : Math.max(16, Math.min(28, Math.round(rect.height * 0.036)));

    ctx.fillStyle = '#e2e8f0';
    ctx.font = `600 ${titleFontPx}px system-ui, -apple-system, sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(
      title,
      centerX,
      subtitle ? centerY - Math.round(titleFontPx * 0.65) : centerY,
    );

    if (subtitle) {
      const subFontPx = Math.max(12, Math.round(titleFontPx * 0.68));
      ctx.fillStyle = '#94a3b8';
      ctx.font = `400 ${subFontPx}px system-ui, -apple-system, sans-serif`;
      ctx.fillText(
        subtitle,
        centerX,
        centerY + Math.round(titleFontPx * 0.75),
      );
    }
  }

  private evaluateSourceFrame(): SourceFrameCheck {
    const el = this.sourceVideo;
    if (!el) {
      return { drawable: false, reason: 'missing' };
    }

    const attrSrc = el.getAttribute('src') ?? '';
    const effectiveSrc = attrSrc || el.currentSrc;

    if (!effectiveSrc && !el.srcObject) {
      return { drawable: false, reason: 'missing' };
    }

    if (
      effectiveSrc &&
      isPotentiallyCrossOriginUrl(effectiveSrc) &&
      !el.crossOrigin
    ) {
      return { drawable: false, reason: 'tainted' };
    }

    if (el.error !== null) {
      return { drawable: false, reason: 'error' };
    }

    const width = el.videoWidth;
    const height = el.videoHeight;

    if (
      !Number.isFinite(width) ||
      width <= 0 ||
      !Number.isFinite(height) ||
      height <= 0 ||
      el.readyState < 2
    ) {
      return { drawable: false, reason: 'loading' };
    }

    return { drawable: true, width, height };
  }

  private evaluateCameraFrame(): CameraFrameCheck {
    const stream = this.cameraStream;
    if (!stream) {
      return { drawable: false, reason: 'off' };
    }

    const primaryTrack = stream.getVideoTracks()[0];
    if (!primaryTrack || primaryTrack.readyState === 'ended') {
      return { drawable: false, reason: 'ended' };
    }

    if (!primaryTrack.enabled) {
      return { drawable: false, reason: 'off' };
    }

    const camVideo = this.cameraVideo;
    if (camVideo?.srcObject !== stream) {
      return { drawable: false, reason: 'warming-up' };
    }

    const width = camVideo.videoWidth;
    const height = camVideo.videoHeight;

    if (
      !Number.isFinite(width) ||
      width <= 0 ||
      !Number.isFinite(height) ||
      height <= 0 ||
      camVideo.readyState < 2
    ) {
      return { drawable: false, reason: 'warming-up' };
    }

    return { drawable: true, width, height };
  }

  private ensureCameraVideoElement(): HTMLVideoElement {
    this.cameraVideo ??= this.createVideoElement();
    return this.cameraVideo;
  }

  private detachBorrowedCameraResources(): void {
    if (this.detachCameraListeners) {
      this.detachCameraListeners();
      this.detachCameraListeners = null;
    }

    if (this.cameraVideo) {
      try {
        this.cameraVideo.pause();
      } catch {
        // Ignore stub pause errors
      }
      this.cameraVideo.srcObject = null;
    }
  }

  private syncCanvasDimensions(canvas: HTMLCanvasElement): void {
    if (canvas.width !== this.config.width) {
      canvas.width = this.config.width;
    }
    if (canvas.height !== this.config.height) {
      canvas.height = this.config.height;
    }
  }

  private acquireCanvasContext(
    canvas: HTMLCanvasElement,
  ): CanvasRenderingContext2D | null {
    try {
      const ctx =
        canvas.getContext('2d', { alpha: false }) ?? canvas.getContext('2d');
      if (!ctx) {
        this.setCompositorError({
          code: 'CANVAS_CONTEXT_UNAVAILABLE',
          title: 'Scene canvas 2D context unavailable',
          message:
            'Your browser could not initialize an HTML5 Canvas 2D rendering context.',
          recoverable: false,
        });
        return null;
      }

      if (this.lastError?.code === 'CANVAS_CONTEXT_UNAVAILABLE') {
        this.lastError = null;
      }
      return ctx;
    } catch (err: unknown) {
      this.setCompositorError({
        code: 'CANVAS_CONTEXT_UNAVAILABLE',
        title: 'Scene canvas initialization error',
        message:
          err instanceof Error && err.message
            ? err.message
            : 'Failed to create a 2D rendering context on the scene canvas.',
        recoverable: false,
      });
      return null;
    }
  }

  private setCompositorError(error: CompositorError): void {
    if (areErrorsEqual(this.lastError, error)) {
      return;
    }
    this.lastError = error;
    this.syncStateAndDiagnostics(true);
  }

  private buildStateSnapshot(): CompositorStateSnapshot {
    const actualWidth = this.canvas ? this.canvas.width : this.config.width;
    const actualHeight = this.canvas ? this.canvas.height : this.config.height;

    return {
      isRunning: this.isRunningFlag,
      canvasAttached: this.canvas !== null && this.ctx2d !== null,
      resolutionPreset: this.config.resolutionPreset,
      width: actualWidth,
      height: actualHeight,
      targetFps: this.config.targetFps,
      layoutMode: this.config.layoutMode,
      pipRect: this.config.pipRect,
      pipFrameShape: this.config.pipFrameShape,
      pipBorderStyle: this.config.pipBorderStyle,
      splitRatio: this.config.splitRatio,
      annotationCount: this.annotations.length,
      hasSourceElement: this.sourceVideo !== null,
      hasCameraStream: this.cameraStream !== null,
      lastError: this.lastError,
    };
  }

  private buildDiagnosticsSnapshot(): CompositorDiagnostics {
    const canvasAttached = this.canvas !== null && this.ctx2d !== null;
    return {
      isRunning: this.isRunningFlag,
      canvasAttached,
      actualWidth: this.canvas ? this.canvas.width : 0,
      actualHeight: this.canvas ? this.canvas.height : 0,
      targetFps: this.config.targetFps,
      measuredFps: this.isRunningFlag ? this.measuredFpsValue : 0,
      renderedFrames: this.renderedFramesCount,
      droppedFrames: this.droppedFramesCount,
      hasActiveSourceFrame: this.hasActiveSourceFrame,
      hasActiveCameraFrame: this.hasActiveCameraFrame,
      lastRenderTimestampMs: this.lastRenderTimestampMs,
      lastError: this.lastError,
    };
  }

  private syncStateAndDiagnostics(forceDiagnosticsPublish: boolean): void {
    const prevState = this.stateSnapshot;
    const nextState = this.buildStateSnapshot();

    const stateChanged =
      prevState.isRunning !== nextState.isRunning ||
      prevState.canvasAttached !== nextState.canvasAttached ||
      prevState.resolutionPreset !== nextState.resolutionPreset ||
      prevState.width !== nextState.width ||
      prevState.height !== nextState.height ||
      prevState.targetFps !== nextState.targetFps ||
      prevState.layoutMode !== nextState.layoutMode ||
      !arePipRectsEqual(prevState.pipRect, nextState.pipRect) ||
      prevState.pipFrameShape !== nextState.pipFrameShape ||
      prevState.pipBorderStyle !== nextState.pipBorderStyle ||
      prevState.splitRatio !== nextState.splitRatio ||
      prevState.annotationCount !== nextState.annotationCount ||
      prevState.hasSourceElement !== nextState.hasSourceElement ||
      prevState.hasCameraStream !== nextState.hasCameraStream ||
      !areErrorsEqual(prevState.lastError, nextState.lastError);

    this.diagnosticsSnapshot = this.buildDiagnosticsSnapshot();

    if (stateChanged) {
      this.stateSnapshot = nextState;
      for (const listener of this.stateListeners) {
        listener(this.stateSnapshot);
      }
    }

    if (forceDiagnosticsPublish || stateChanged) {
      this.notifyDiagnosticsListeners();
    }
  }

  private notifyDiagnosticsListeners(): void {
    for (const listener of this.diagnosticsListeners) {
      listener(this.diagnosticsSnapshot);
    }
  }
}

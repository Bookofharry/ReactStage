import type {
  PipBorderStyle,
  PipFrameShape,
  SceneResolutionPreset,
  StageLayoutMode,
} from '../../types/media';

export interface NormalizedScenePoint {
  readonly x: number;
  readonly y: number;
}

export type StageAnnotationKind = 'pen' | 'arrow' | 'rect';

export interface StageAnnotation {
  readonly id: string;
  readonly kind: StageAnnotationKind;
  readonly color: string;
  readonly points: readonly NormalizedScenePoint[];
}

/**
 * Normalized Picture-in-Picture overlay bounds in [0..1] canvas space.
 * Because x, y, width, and height are normalized relative to the output canvas,
 * resizing the browser viewport or switching between 720p and 1080p preserves
 * the exact relative scene composition.
 */
export interface PipOverlayRect {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

export type CompositorErrorCode =
  | 'CANVAS_CONTEXT_UNAVAILABLE'
  | 'CANVAS_TAINTED'
  | 'SOURCE_DRAW_FAILED'
  | 'CAMERA_PLAYBACK_FAILED';

export interface CompositorError {
  readonly code: CompositorErrorCode;
  readonly title: string;
  readonly message: string;
  readonly recoverable: boolean;
}

export interface CompositorConfig {
  readonly resolutionPreset: SceneResolutionPreset;
  readonly width: number;
  readonly height: number;
  readonly targetFps: number;
  readonly layoutMode: StageLayoutMode;
  readonly pipRect: PipOverlayRect;
  readonly pipFrameShape: PipFrameShape;
  readonly pipBorderStyle: PipBorderStyle;
  readonly splitRatio: number;
}

/**
 * Low-frequency structural state snapshot emitted only when configuration,
 * running status, canvas attachment/dimensions, or error state changes.
 * Never emitted on every animation frame so React controls do not re-render at 30Hz.
 */
export interface CompositorStateSnapshot {
  readonly isRunning: boolean;
  readonly canvasAttached: boolean;
  readonly resolutionPreset: SceneResolutionPreset;
  readonly width: number;
  readonly height: number;
  readonly targetFps: number;
  readonly layoutMode: StageLayoutMode;
  readonly pipRect: PipOverlayRect;
  readonly pipFrameShape: PipFrameShape;
  readonly pipBorderStyle: PipBorderStyle;
  readonly splitRatio: number;
  readonly annotationCount: number;
  readonly hasSourceElement: boolean;
  readonly hasCameraStream: boolean;
  readonly lastError: CompositorError | null;
}

/**
 * Truthful runtime composition metrics. Queried synchronously via getDiagnostics()
 * and published via subscribeDiagnostics() on a throttled cadence (~2Hz) or state transition.
 */
export interface CompositorDiagnostics {
  readonly isRunning: boolean;
  readonly canvasAttached: boolean;
  readonly actualWidth: number;
  readonly actualHeight: number;
  readonly targetFps: number;
  readonly measuredFps: number;
  readonly renderedFrames: number;
  readonly droppedFrames: number;
  readonly hasActiveSourceFrame: boolean;
  readonly hasActiveCameraFrame: boolean;
  readonly lastRenderTimestampMs: number | null;
  readonly lastError: CompositorError | null;
}

/**
 * Service contract for live HTML5 Canvas 2D scene composition combining the
 * borrowed local source HTMLVideoElement (playing or paused held frame) with
 * the borrowed creator camera MediaStream across four layout modes.
 *
 * Ownership & Future Recording Contract:
 * 1. SceneCompositor borrows the source HTMLVideoElement read-only (never calls
 *    play/pause/seek or revokes Object URLs owned by SourcePlayer).
 * 2. SceneCompositor borrows the camera MediaStream via an internal muted,
 *    playsInline video element (never calls stop() on tracks owned by CaptureManager,
 *    and ignores any audio tracks so audio remains out of the visual compositor).
 * 3. React mounts the output HTMLCanvasElement and binds it via attachCanvas/start.
 *    SceneCompositor owns the 2D rendering loop and intrinsic canvas pixel dimensions
 *    (1280x720 or 1920x1080). In the upcoming Recording milestone, RecordingEngine
 *    will derive a video-only captureStream(30) from getCanvas() when recording starts
 *    and will own stopping those derived CanvasCaptureMediaStreamTracks on stop.
 */
export interface SceneCompositor {
  getState(): CompositorStateSnapshot;
  subscribe(listener: (state: CompositorStateSnapshot) => void): () => void;
  getDiagnostics(): CompositorDiagnostics;
  subscribeDiagnostics(
    listener: (diagnostics: CompositorDiagnostics) => void,
  ): () => void;
  attachCanvas(canvas: HTMLCanvasElement | null): void;
  getCanvas(): HTMLCanvasElement | null;
  configure(patch: Partial<CompositorConfig>): void;
  setResolution(preset: SceneResolutionPreset): void;
  setLayoutMode(mode: StageLayoutMode): void;
  setPipRect(rect: PipOverlayRect): void;
  setPipFrameShape(shape: PipFrameShape): void;
  setPipBorderStyle(border: PipBorderStyle): void;
  setSplitRatio(ratio: number): void;
  getAnnotations(): readonly StageAnnotation[];
  addAnnotation(annotation: StageAnnotation): void;
  undoAnnotation(): boolean;
  clearAnnotations(): void;
  setDraftAnnotation(draft: StageAnnotation | null): void;
  pushLaserPoint(point: NormalizedScenePoint | null): void;
  setSourceVideo(element: HTMLVideoElement | null): void;
  setCameraStream(stream: MediaStream | null): void;
  start(canvas?: HTMLCanvasElement): void;
  stop(): void;
  renderFrameNow(): boolean;
  dispose(): void;
}

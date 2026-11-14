import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ChangeEvent,
  type DragEvent,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
} from 'react';
import type {
  NormalizedScenePoint,
  PipOverlayRect,
  StageAnnotation,
  StageAnnotationKind,
} from '../services/interfaces/scene-compositor';
import {
  MAX_PIP_SIZE,
  MAX_SPLIT_RATIO,
  MIN_PIP_SIZE,
  MIN_SPLIT_RATIO,
  clampPipRect,
  type PipCornerPreset,
} from '../services/scene-compositor';
import { useCapture } from '../state/CaptureContext';
import {
  useCompositorDiagnostics,
  useSceneCompositor,
} from '../state/CompositorContext';
import { useSourcePlayback } from '../state/PlaybackContext';
import { useRecordingSession } from '../state/RecordingSessionContext';
import {
  MAX_LOWER_THIRD_TEXT_LENGTH,
  MAX_TELEPROMPTER_SCRIPT_LENGTH,
  SUPPORTED_SCENE_RESOLUTIONS,
  SUPPORTED_TELESTRATOR_COLORS,
  type PipBorderStyle,
  type PipFrameShape,
  type SceneResolutionPreset,
  type StageLayoutMode,
  type TeleprompterFontSize,
  type TelestratorTool,
} from '../types/media';
import { formatBytes } from '../utils/format';
import {
  AlertIcon,
  ArrowPointerIcon,
  CameraSnapshotIcon,
  HighlightBoxIcon,
  LaserPointerIcon,
  LayoutCameraIcon,
  LayoutPipIcon,
  LayoutSourceIcon,
  LayoutSplitIcon,
  LayoutVerticalStackIcon,
  LowerThirdIcon,
  PenToolIcon,
  ResizeCornerIcon,
  ScreenShareIcon,
  TeleprompterIcon,
  TrashIcon,
  UndoIcon,
  UploadVideoIcon,
} from './StudioIcons';

interface ActivePointerGesture {
  readonly mode: 'move' | 'resize';
  readonly pointerId: number;
  readonly startClientX: number;
  readonly startClientY: number;
  readonly stageWidth: number;
  readonly stageHeight: number;
  readonly initialRect: PipOverlayRect;
}

const LAYOUT_OPTIONS: readonly {
  readonly mode: StageLayoutMode;
  readonly label: string;
}[] = [
  { mode: 'source-only', label: 'Source Only' },
  { mode: 'camera-only', label: 'Webcam Only' },
  { mode: 'pip', label: 'Picture-in-Picture' },
  { mode: 'side-by-side', label: 'Side-by-Side' },
  { mode: 'top-bottom', label: 'Top / Bottom' },
];

const PIP_CORNER_OPTIONS: readonly {
  readonly id: PipCornerPreset;
  readonly label: string;
}[] = [
  { id: 'top-left', label: 'Top Left' },
  { id: 'top-right', label: 'Top Right' },
  { id: 'bottom-left', label: 'Bottom Left' },
  { id: 'bottom-right', label: 'Bottom Right' },
];

const PIP_SHAPE_OPTIONS: readonly {
  readonly id: PipFrameShape;
  readonly label: string;
}[] = [
  { id: 'rect', label: 'Rect' },
  { id: 'rounded', label: 'Rounded' },
  { id: 'circle', label: 'Circle' },
];

const PIP_BORDER_OPTIONS: readonly {
  readonly id: PipBorderStyle;
  readonly label: string;
}[] = [
  { id: 'sky', label: 'Cyan Border' },
  { id: 'amber', label: 'Gold Border' },
  { id: 'emerald', label: 'Green Border' },
  { id: 'subtle', label: 'Subtle Border' },
  { id: 'none', label: 'No Border' },
];

const TELESTRATOR_TOOL_OPTIONS: readonly {
  readonly tool: TelestratorTool;
  readonly label: string;
}[] = [
  { tool: 'none', label: 'Cursor' },
  { tool: 'pen', label: 'Pen' },
  { tool: 'arrow', label: 'Arrow' },
  { tool: 'rect', label: 'Box' },
  { tool: 'laser', label: 'Laser' },
];

interface ActiveAnnotationStroke {
  readonly pointerId: number;
  readonly id: string;
  readonly kind: StageAnnotationKind;
  readonly color: string;
  points: NormalizedScenePoint[];
}

function renderLayoutIcon(mode: StageLayoutMode) {
  const cls = 'h-3.5 w-3.5 shrink-0';
  switch (mode) {
    case 'source-only':
      return <LayoutSourceIcon className={cls} />;
    case 'camera-only':
      return <LayoutCameraIcon className={cls} />;
    case 'pip':
      return <LayoutPipIcon className={cls} />;
    case 'side-by-side':
      return <LayoutSplitIcon className={cls} />;
    case 'top-bottom':
      return <LayoutVerticalStackIcon className={cls} />;
  }
}

function getLayoutDisplayName(mode: StageLayoutMode): string {
  switch (mode) {
    case 'source-only':
      return 'Source Only';
    case 'camera-only':
      return 'Webcam Only';
    case 'pip':
      return 'Picture-in-Picture';
    case 'side-by-side':
      return 'Side-by-Side';
    case 'top-bottom':
      return 'Top / Bottom';
  }
}

function SceneTelemetryBadges() {
  const { state } = useSceneCompositor();
  const diagnostics = useCompositorDiagnostics();

  const displayWidth =
    diagnostics.actualWidth > 0 ? diagnostics.actualWidth : state.width;
  const displayHeight =
    diagnostics.actualHeight > 0 ? diagnostics.actualHeight : state.height;

  const fpsLabel =
    diagnostics.isRunning && diagnostics.measuredFps > 0
      ? `${Math.round(diagnostics.measuredFps)} / ${diagnostics.targetFps} fps`
      : `${diagnostics.targetFps} fps target`;

  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <span
        data-testid="scene-status-badge"
        className={
          diagnostics.isRunning
            ? 'inline-flex items-center gap-1.5 rounded-full border border-emerald-400/40 bg-emerald-400/10 px-2.5 py-0.5 text-[11px] font-medium text-emerald-300'
            : 'inline-flex items-center gap-1.5 rounded-full border border-amber-400/40 bg-amber-400/10 px-2.5 py-0.5 text-[11px] font-medium text-amber-300'
        }
      >
        {diagnostics.isRunning && (
          <span
            aria-hidden="true"
            className="h-1.5 w-1.5 rounded-full bg-emerald-400"
          />
        )}
        {diagnostics.isRunning ? 'Scene Live' : 'Scene Paused'}
      </span>

      <span
        data-testid="scene-dimensions-badge"
        className="rounded bg-slate-800 px-2 py-0.5 font-mono text-[11px] font-medium text-slate-200 tabular-nums"
      >
        {displayWidth}×{displayHeight} · {fpsLabel}
      </span>
    </div>
  );
}

function StagePreRollOverlay() {
  const {
    countdownSecondsRemaining,
    skipCountdownAndStart,
    cancelCountdown,
  } = useRecordingSession();

  if (countdownSecondsRemaining === null) {
    return null;
  }

  return (
    <div
      role="status"
      aria-live="assertive"
      data-testid="preroll-stage-overlay"
      className="absolute inset-0 z-30 flex flex-col items-center justify-center bg-slate-950/75 p-4 text-center backdrop-blur-xs"
    >
      <div className="flex flex-col items-center rounded-2xl border border-sky-400/40 bg-slate-900/95 px-6 py-5 shadow-2xl">
        <span className="text-[11px] font-semibold tracking-wider text-sky-300 uppercase">
          Get Ready · Pre-Roll Count-In
        </span>
        <span
          data-testid="preroll-stage-digit"
          className="mt-1 font-mono text-5xl font-extrabold text-slate-100 tabular-nums sm:text-6xl"
        >
          {countdownSecondsRemaining}
        </span>
        <p className="mt-1 text-xs text-slate-300">
          Recording starts automatically in {countdownSecondsRemaining}{' '}
          {countdownSecondsRemaining === 1 ? 'second' : 'seconds'}
        </p>

        <div className="mt-3.5 flex flex-wrap items-center justify-center gap-2">
          <button
            type="button"
            data-testid="stage-skip-countdown-button"
            onClick={() => {
              void skipCountdownAndStart();
            }}
            className="rounded-lg bg-sky-400 px-3 py-1.5 text-xs font-semibold text-slate-950 hover:bg-sky-300 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky-300"
          >
            Start Now
          </button>
          <button
            type="button"
            data-testid="stage-cancel-countdown-button"
            onClick={cancelCountdown}
            className="rounded-lg border border-slate-700 bg-slate-800 px-3 py-1.5 text-xs font-medium text-slate-100 hover:bg-slate-700 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky-300"
          >
            Cancel (Esc)
          </button>
        </div>
      </div>
    </div>
  );
}

export function SceneStagePanel() {
  const {
    state: playback,
    videoRef,
    loadFile,
    startScreenShare,
    unload,
  } = useSourcePlayback();
  const { snapshot: captureSnapshot } = useCapture();
  const {
    state: compositorState,
    canvasRef,
    activeTool,
    activeColor,
    setActiveTool,
    setActiveColor,
    setLayoutMode,
    setResolution,
    setPipRect,
    setPipFrameShape,
    setPipBorderStyle,
    movePipBy,
    resizePipBy,
    snapPipToCorner,
    resetPipRect,
    setSplitRatio,
    resetSplitRatio,
    setLowerThird,
    toggleLowerThird,
    teleprompter,
    setTeleprompter,
    toggleTeleprompter,
    captureSnapshotPng,
    addAnnotation,
    undoAnnotation,
    clearAnnotations,
    setDraftAnnotation,
    pushLaserPoint,
    toggleSceneLoop,
  } = useSceneCompositor();

  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const stageViewportRef = useRef<HTMLDivElement | null>(null);
  const teleprompterViewportRef = useRef<HTMLDivElement | null>(null);
  const dragDepthRef = useRef(0);
  const activeGestureRef = useRef<ActivePointerGesture | null>(null);
  const activeStrokeRef = useRef<ActiveAnnotationStroke | null>(null);
  const strokeCounterRef = useRef(0);
  const snapshotSavedTimerRef = useRef<number | null>(null);

  const [isDraggingFileOver, setIsDraggingFileOver] = useState(false);
  const [isInteractingPip, setIsInteractingPip] = useState(false);
  const [snapshotJustSaved, setSnapshotJustSaved] = useState(false);
  const [isTeleprompterScrolling, setIsTeleprompterScrolling] = useState(false);

  useEffect(() => {
    if (!teleprompter.enabled || !isTeleprompterScrolling) {
      return undefined;
    }
    let rafId = 0;
    let lastTs = 0;
    const step = (ts: number) => {
      const container = teleprompterViewportRef.current;
      if (!container) {
        return;
      }
      if (lastTs > 0) {
        const dtSec = Math.min(0.1, Math.max(0, (ts - lastTs) / 1000));
        const pxPerSec = 10 + teleprompter.scrollSpeed * 12;
        const maxScroll = Math.max(
          0,
          container.scrollHeight - container.clientHeight,
        );
        if (maxScroll > 0) {
          const nextTop = container.scrollTop + pxPerSec * dtSec;
          if (nextTop >= maxScroll) {
            container.scrollTop = maxScroll;
            setIsTeleprompterScrolling(false);
            return;
          }
          container.scrollTop = nextTop;
        }
      }
      lastTs = ts;
      rafId = window.requestAnimationFrame(step);
    };
    rafId = window.requestAnimationFrame(step);
    return () => {
      window.cancelAnimationFrame(rafId);
    };
  }, [isTeleprompterScrolling, teleprompter.enabled, teleprompter.scrollSpeed]);

  useEffect(() => {
    return () => {
      if (snapshotSavedTimerRef.current !== null) {
        window.clearTimeout(snapshotSavedTimerRef.current);
      }
    };
  }, []);

  const handleCaptureSnapshot = useCallback(async () => {
    const fileName = await captureSnapshotPng();
    if (fileName) {
      setSnapshotJustSaved(true);
      if (snapshotSavedTimerRef.current !== null) {
        window.clearTimeout(snapshotSavedTimerRef.current);
      }
      snapshotSavedTimerRef.current = window.setTimeout(() => {
        setSnapshotJustSaved(false);
      }, 1800);
    }
  }, [captureSnapshotPng]);

  const isSourcePlayable =
    playback.status === 'ready' ||
    playback.status === 'playing' ||
    playback.status === 'paused' ||
    playback.status === 'ended';

  const isCameraActive =
    captureSnapshot.cameraStatus === 'active' &&
    captureSnapshot.activeCameraStream !== null;

  // Show centered onboarding prompt only when neither source, camera, Lower-Third, Teleprompter, nor active Telestrator is on stage
  const showCenteredEmptyPrompt =
    activeTool === 'none' &&
    compositorState.annotationCount === 0 &&
    !compositorState.lowerThird.enabled &&
    !teleprompter.enabled &&
    playback.status === 'empty' &&
    !isCameraActive &&
    compositorState.layoutMode !== 'camera-only';

  const isPortraitStage = compositorState.height > compositorState.width;

  const openFilePicker = useCallback(() => {
    fileInputRef.current?.click();
  }, []);

  const handleFileInputChange = useCallback(
    (event: ChangeEvent<HTMLInputElement>) => {
      const selectedFile = event.currentTarget.files?.[0];
      event.currentTarget.value = '';
      if (selectedFile) {
        loadFile(selectedFile);
      }
    },
    [loadFile],
  );

  const handleDragEnter = useCallback((event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    event.stopPropagation();
    dragDepthRef.current += 1;
    setIsDraggingFileOver(true);
  }, []);

  const handleDragOver = useCallback(
    (event: DragEvent<HTMLDivElement>) => {
      event.preventDefault();
      event.stopPropagation();
      event.dataTransfer.dropEffect = 'copy';
      if (!isDraggingFileOver) {
        setIsDraggingFileOver(true);
      }
    },
    [isDraggingFileOver],
  );

  const handleDragLeave = useCallback((event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    event.stopPropagation();
    dragDepthRef.current = Math.max(0, dragDepthRef.current - 1);
    if (dragDepthRef.current === 0) {
      setIsDraggingFileOver(false);
    }
  }, []);

  const handleDrop = useCallback(
    (event: DragEvent<HTMLDivElement>) => {
      event.preventDefault();
      event.stopPropagation();
      dragDepthRef.current = 0;
      setIsDraggingFileOver(false);

      const droppedFile = event.dataTransfer.files[0];
      if (droppedFile) {
        loadFile(droppedFile);
      }
    },
    [loadFile],
  );

  const handleResolutionChange = useCallback(
    (event: ChangeEvent<HTMLSelectElement>) => {
      setResolution(event.currentTarget.value as SceneResolutionPreset);
    },
    [setResolution],
  );

  const handlePipSizeSliderChange = useCallback(
    (event: ChangeEvent<HTMLInputElement>) => {
      const nextSize = Number(event.currentTarget.value);
      setPipRect(
        clampPipRect({
          ...compositorState.pipRect,
          width: nextSize,
          height: nextSize,
        }),
      );
    },
    [compositorState.pipRect, setPipRect],
  );

  const handleSplitSliderChange = useCallback(
    (event: ChangeEvent<HTMLInputElement>) => {
      setSplitRatio(Number(event.currentTarget.value));
    },
    [setSplitRatio],
  );

  const handlePipBorderChange = useCallback(
    (event: ChangeEvent<HTMLSelectElement>) => {
      setPipBorderStyle(event.currentTarget.value as PipBorderStyle);
    },
    [setPipBorderStyle],
  );

  const resolveCanvasNormalizedPoint = useCallback(
    (clientX: number, clientY: number): NormalizedScenePoint => {
      const target = canvasRef.current ?? stageViewportRef.current;
      const bounds = target?.getBoundingClientRect();
      const width = bounds && bounds.width > 0 ? bounds.width : 1280;
      const height = bounds && bounds.height > 0 ? bounds.height : 720;
      const left = bounds ? bounds.left : 0;
      const top = bounds ? bounds.top : 0;
      const rawX = Number.isFinite(clientX) ? (clientX - left) / width : 0.5;
      const rawY = Number.isFinite(clientY) ? (clientY - top) / height : 0.5;
      return {
        x: Math.min(1, Math.max(0, rawX)),
        y: Math.min(1, Math.max(0, rawY)),
      };
    },
    [canvasRef],
  );

  const handleCanvasPointerDown = useCallback(
    (event: ReactPointerEvent<HTMLCanvasElement>) => {
      if (activeTool === 'none') {
        return;
      }
      if (event.button !== 0 && event.pointerType === 'mouse') {
        return;
      }
      event.preventDefault();
      try {
        event.currentTarget.setPointerCapture(event.pointerId);
      } catch {
        // JSDOM or synthetic PointerEvents may omit setPointerCapture
      }

      const pt = resolveCanvasNormalizedPoint(event.clientX, event.clientY);
      if (activeTool === 'laser') {
        pushLaserPoint(pt);
        return;
      }

      strokeCounterRef.current += 1;
      const stroke: ActiveAnnotationStroke = {
        pointerId: event.pointerId,
        id: `stroke-${String(strokeCounterRef.current)}-${String(Date.now())}`,
        kind: activeTool,
        color: activeColor,
        points: [pt],
      };
      activeStrokeRef.current = stroke;

      const draft: StageAnnotation = {
        id: stroke.id,
        kind: stroke.kind,
        color: stroke.color,
        points: stroke.points,
      };
      setDraftAnnotation(draft);
    },
    [activeColor, activeTool, pushLaserPoint, resolveCanvasNormalizedPoint, setDraftAnnotation],
  );

  const handleCanvasPointerMove = useCallback(
    (event: ReactPointerEvent<HTMLCanvasElement>) => {
      if (activeTool === 'none') {
        return;
      }
      const pt = resolveCanvasNormalizedPoint(event.clientX, event.clientY);
      if (activeTool === 'laser') {
        pushLaserPoint(pt);
        return;
      }

      const stroke = activeStrokeRef.current;
      if (stroke?.pointerId !== event.pointerId) {
        return;
      }

      if (stroke.kind === 'pen') {
        const prev = stroke.points[stroke.points.length - 1];
        const dist = prev ? Math.hypot(pt.x - prev.x, pt.y - prev.y) : 1;
        if (dist >= 0.0025) {
          stroke.points = [...stroke.points, pt];
        }
      } else {
        const start = stroke.points[0] ?? pt;
        stroke.points = [start, pt];
      }

      setDraftAnnotation({
        id: stroke.id,
        kind: stroke.kind,
        color: stroke.color,
        points: stroke.points,
      });
    },
    [activeTool, pushLaserPoint, resolveCanvasNormalizedPoint, setDraftAnnotation],
  );

  const finishCanvasStroke = useCallback(
    (event: ReactPointerEvent<HTMLCanvasElement>, commit: boolean) => {
      const stroke = activeStrokeRef.current;
      if (stroke?.pointerId !== event.pointerId) {
        return;
      }
      activeStrokeRef.current = null;
      if (commit && stroke.points.length > 0) {
        const endPt = resolveCanvasNormalizedPoint(
          event.clientX,
          event.clientY,
        );
        const finalPoints =
          stroke.kind === 'pen'
            ? stroke.points
            : [stroke.points[0] ?? endPt, endPt];
        addAnnotation({
          id: stroke.id,
          kind: stroke.kind,
          color: stroke.color,
          points: finalPoints,
        });
      } else {
        setDraftAnnotation(null);
      }
    },
    [addAnnotation, resolveCanvasNormalizedPoint, setDraftAnnotation],
  );

  // Window-level pointer tracking for smooth mouse & touch PIP drag/resize
  useEffect(() => {
    if (!isInteractingPip) {
      return undefined;
    }

    const onWindowPointerMove = (event: PointerEvent) => {
      const gesture = activeGestureRef.current;
      const eventPointerId = (event as Partial<PointerEvent>).pointerId;
      if (
        !gesture ||
        (eventPointerId !== undefined && gesture.pointerId !== eventPointerId) ||
        !Number.isFinite(event.clientX) ||
        !Number.isFinite(event.clientY)
      ) {
        return;
      }

      const safeW = Math.max(1, gesture.stageWidth);
      const safeH = Math.max(1, gesture.stageHeight);
      const normDx = (event.clientX - gesture.startClientX) / safeW;
      const normDy = (event.clientY - gesture.startClientY) / safeH;

      if (gesture.mode === 'move') {
        setPipRect(
          clampPipRect({
            ...gesture.initialRect,
            x: gesture.initialRect.x + normDx,
            y: gesture.initialRect.y + normDy,
          }),
        );
      } else {
        const dominantDelta =
          Math.abs(normDx) >= Math.abs(normDy) ? normDx : normDy;
        setPipRect(
          clampPipRect({
            ...gesture.initialRect,
            width: gesture.initialRect.width + dominantDelta,
            height: gesture.initialRect.height + dominantDelta,
          }),
        );
      }
    };

    const endGesture = (event: PointerEvent) => {
      const gesture = activeGestureRef.current;
      const eventPointerId = (event as Partial<PointerEvent>).pointerId;
      if (
        !gesture ||
        (eventPointerId !== undefined && gesture.pointerId !== eventPointerId)
      ) {
        return;
      }
      activeGestureRef.current = null;
      setIsInteractingPip(false);
    };

    window.addEventListener('pointermove', onWindowPointerMove);
    window.addEventListener('pointerup', endGesture);
    window.addEventListener('pointercancel', endGesture);

    return () => {
      window.removeEventListener('pointermove', onWindowPointerMove);
      window.removeEventListener('pointerup', endGesture);
      window.removeEventListener('pointercancel', endGesture);
    };
  }, [isInteractingPip, setPipRect]);

  const startPipPointerGesture = useCallback(
    (mode: 'move' | 'resize', event: ReactPointerEvent<HTMLButtonElement>) => {
      if (event.button !== 0 && event.pointerType === 'mouse') {
        return;
      }
      event.preventDefault();
      event.stopPropagation();

      const viewportEl = stageViewportRef.current;
      const bounds = viewportEl?.getBoundingClientRect();
      const stageWidth =
        bounds && bounds.width > 0 ? bounds.width : compositorState.width;
      const stageHeight =
        bounds && bounds.height > 0 ? bounds.height : compositorState.height;

      activeGestureRef.current = {
        mode,
        pointerId: event.pointerId,
        startClientX: event.clientX,
        startClientY: event.clientY,
        stageWidth,
        stageHeight,
        initialRect: compositorState.pipRect,
      };
      setIsInteractingPip(true);
    },
    [compositorState.height, compositorState.pipRect, compositorState.width],
  );

  const handlePipMoveKeyDown = useCallback(
    (event: ReactKeyboardEvent<HTMLButtonElement>) => {
      const step = event.shiftKey ? 0.05 : 0.02;
      switch (event.key) {
        case 'ArrowLeft':
          event.preventDefault();
          movePipBy(-step, 0);
          break;
        case 'ArrowRight':
          event.preventDefault();
          movePipBy(step, 0);
          break;
        case 'ArrowUp':
          event.preventDefault();
          movePipBy(0, -step);
          break;
        case 'ArrowDown':
          event.preventDefault();
          movePipBy(0, step);
          break;
        case 'Home':
          event.preventDefault();
          snapPipToCorner('top-left');
          break;
        case 'End':
          event.preventDefault();
          snapPipToCorner('bottom-right');
          break;
        default:
          break;
      }
    },
    [movePipBy, snapPipToCorner],
  );

  const handlePipResizeKeyDown = useCallback(
    (event: ReactKeyboardEvent<HTMLButtonElement>) => {
      const step = event.shiftKey ? 0.05 : 0.02;
      switch (event.key) {
        case 'ArrowRight':
        case 'ArrowDown':
        case '+':
        case '=':
          event.preventDefault();
          resizePipBy(step);
          break;
        case 'ArrowLeft':
        case 'ArrowUp':
        case '-':
        case '_':
          event.preventDefault();
          resizePipBy(-step);
          break;
        default:
          break;
      }
    },
    [resizePipBy],
  );

  const pipXPercent = Math.round(compositorState.pipRect.x * 100);
  const pipYPercent = Math.round(compositorState.pipRect.y * 100);
  const pipSizePercent = Math.round(compositorState.pipRect.width * 100);
  const splitLeftPercent = Math.round(compositorState.splitRatio * 100);
  const splitRightPercent = 100 - splitLeftPercent;

  return (
    <section
      data-testid="scene-stage-panel"
      aria-labelledby="scene-stage-heading"
      className="flex flex-col overflow-hidden rounded-xl border border-slate-800 bg-slate-900 shadow-lg"
    >
      <input
        id="source-video-file-input"
        ref={fileInputRef}
        data-testid="source-file-input"
        type="file"
        accept="video/*,.mp4,.webm,.ogg,.ogv,.mov,.m4v"
        aria-label="Import local video file"
        className="sr-only"
        onChange={handleFileInputChange}
      />

      {/* Scene Output Header: Distinct from Source Playback */}
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-800 px-3 py-2.5 sm:px-4">
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          <h2
            id="scene-stage-heading"
            className="text-sm font-semibold text-slate-100"
          >
            Live Scene Stage
          </h2>
          <SceneTelemetryBadges />
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <div className="flex items-center gap-1.5 rounded-lg border border-slate-700 bg-slate-950 px-2 py-1">
            <label
              htmlFor="scene-resolution-select"
              className="text-xs font-medium text-slate-300"
            >
              Output
            </label>
            <select
              id="scene-resolution-select"
              data-testid="scene-resolution-select"
              value={compositorState.resolutionPreset}
              onChange={handleResolutionChange}
              className="rounded bg-slate-900 px-1.5 py-0.5 font-mono text-xs font-semibold text-slate-100 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky-400"
            >
              {SUPPORTED_SCENE_RESOLUTIONS.map((option) => (
                <option key={option.id} value={option.id}>
                  {option.label}
                </option>
              ))}
            </select>
          </div>

          <button
            type="button"
            data-testid="capture-snapshot-button"
            onClick={() => {
              void handleCaptureSnapshot();
            }}
            className={
              snapshotJustSaved
                ? 'inline-flex items-center gap-1.5 rounded-lg bg-emerald-400 px-2.5 py-1.5 text-xs font-semibold text-slate-950 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-300'
                : 'inline-flex items-center gap-1.5 rounded-lg border border-slate-700 bg-slate-800 px-2.5 py-1.5 text-xs font-medium text-slate-100 hover:bg-slate-700 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky-400'
            }
          >
            <CameraSnapshotIcon className="h-3.5 w-3.5 shrink-0" />
            <span>{snapshotJustSaved ? 'Saved PNG' : 'Snapshot PNG'}</span>
          </button>

          <button
            type="button"
            data-testid="scene-loop-toggle-button"
            aria-pressed={!compositorState.isRunning}
            onClick={toggleSceneLoop}
            className={
              compositorState.isRunning
                ? 'rounded-lg border border-slate-700 bg-slate-800 px-2.5 py-1.5 text-xs font-medium text-slate-100 hover:bg-slate-700 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky-400'
                : 'rounded-lg bg-emerald-400 px-2.5 py-1.5 text-xs font-semibold text-slate-950 hover:bg-emerald-300 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-300'
            }
          >
            {compositorState.isRunning ? 'Pause Scene' : 'Resume Scene'}
          </button>
        </div>
      </div>

      {/* Accessible Four-Layout Selector Toolbar */}
      <div
        role="group"
        aria-label="Scene layout mode"
        className="grid grid-cols-2 gap-1.5 border-b border-slate-800 bg-slate-950/60 px-3 py-2 sm:flex sm:flex-wrap sm:items-center sm:px-4"
      >
        {LAYOUT_OPTIONS.map((item) => {
          const isSelected = compositorState.layoutMode === item.mode;
          return (
            <button
              key={item.mode}
              type="button"
              data-testid={`layout-mode-${item.mode}`}
              aria-pressed={isSelected}
              onClick={() => setLayoutMode(item.mode)}
              className={
                isSelected
                  ? 'inline-flex min-h-9 items-center justify-center gap-1.5 rounded-lg bg-sky-400 px-3 py-1.5 text-xs font-semibold text-slate-950 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky-300'
                  : 'inline-flex min-h-9 items-center justify-center gap-1.5 rounded-lg border border-slate-700 bg-slate-900 px-3 py-1.5 text-xs font-medium text-slate-100 hover:bg-slate-800 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky-400'
              }
            >
              {renderLayoutIcon(item.mode)}
              <span>{item.label}</span>
            </button>
          );
        })}
      </div>

      {/* Live Stage Telestrator & Laser Pointer Toolbar */}
      <div
        data-testid="telestrator-toolbar"
        className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-800 bg-slate-950/85 px-3 py-2 sm:px-4"
      >
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="mr-0.5 text-xs font-semibold text-slate-200">
            Annotate:
          </span>

          <div
            role="group"
            aria-label="Stage Telestrator tools"
            className="flex flex-wrap items-center gap-1"
          >
            {TELESTRATOR_TOOL_OPTIONS.map((opt) => {
              const selected = activeTool === opt.tool;
              return (
                <button
                  key={opt.tool}
                  type="button"
                  data-testid={`telestrator-tool-${opt.tool}`}
                  aria-pressed={selected}
                  onClick={() => setActiveTool(opt.tool)}
                  className={
                    selected
                      ? 'inline-flex min-h-7 items-center gap-1 rounded-md bg-sky-400 px-2.5 py-1 text-xs font-semibold text-slate-950 focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-sky-300'
                      : 'inline-flex min-h-7 items-center gap-1 rounded-md border border-slate-700 bg-slate-900 px-2.5 py-1 text-xs font-medium text-slate-100 hover:bg-slate-800 focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-sky-400'
                  }
                >
                  {opt.tool === 'pen' && (
                    <PenToolIcon className="h-3 w-3 shrink-0" />
                  )}
                  {opt.tool === 'arrow' && (
                    <ArrowPointerIcon className="h-3 w-3 shrink-0" />
                  )}
                  {opt.tool === 'rect' && (
                    <HighlightBoxIcon className="h-3 w-3 shrink-0" />
                  )}
                  {opt.tool === 'laser' && (
                    <LaserPointerIcon className="h-3 w-3 shrink-0" />
                  )}
                  <span>{opt.label}</span>
                </button>
              );
            })}
          </div>

          <div
            role="group"
            aria-label="Annotation color"
            className="ml-1 flex items-center gap-1.5"
          >
            {SUPPORTED_TELESTRATOR_COLORS.map((swatch) => {
              const isSelected = activeColor === swatch.hex;
              return (
                <button
                  key={swatch.hex}
                  type="button"
                  data-testid={`telestrator-color-${swatch.label.toLowerCase().replace(/\s+/g, '-')}`}
                  aria-label={`Select ${swatch.label} ink`}
                  aria-pressed={isSelected}
                  onClick={() => setActiveColor(swatch.hex)}
                  className={`flex h-6 w-6 items-center justify-center rounded-full border transition focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky-300 ${
                    isSelected
                      ? 'border-white ring-2 ring-sky-400'
                      : 'border-slate-600 hover:border-slate-300'
                  }`}
                >
                  <span
                    aria-hidden="true"
                    style={{ backgroundColor: swatch.hex }}
                    className="h-3.5 w-3.5 rounded-full"
                  />
                </button>
              );
            })}
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-1.5">
          <button
            type="button"
            data-testid="lower-third-toggle-button"
            aria-pressed={compositorState.lowerThird.enabled}
            onClick={toggleLowerThird}
            className={
              compositorState.lowerThird.enabled
                ? 'inline-flex min-h-7 items-center gap-1 rounded-md bg-sky-400 px-2.5 py-1 text-xs font-semibold text-slate-950 focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-sky-300'
                : 'inline-flex min-h-7 items-center gap-1 rounded-md border border-slate-700 bg-slate-900 px-2.5 py-1 text-xs font-medium text-slate-100 hover:bg-slate-800 focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-sky-400'
            }
          >
            <LowerThirdIcon className="h-3 w-3 shrink-0" />
            <span>Lower-Third</span>
          </button>

          <button
            type="button"
            data-testid="teleprompter-toggle-button"
            aria-pressed={teleprompter.enabled}
            onClick={toggleTeleprompter}
            className={
              teleprompter.enabled
                ? 'inline-flex min-h-7 items-center gap-1 rounded-md bg-sky-400 px-2.5 py-1 text-xs font-semibold text-slate-950 focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-sky-300'
                : 'inline-flex min-h-7 items-center gap-1 rounded-md border border-slate-700 bg-slate-900 px-2.5 py-1 text-xs font-medium text-slate-100 hover:bg-slate-800 focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-sky-400'
            }
          >
            <TeleprompterIcon className="h-3 w-3 shrink-0" />
            <span>Teleprompter</span>
          </button>

          <button
            type="button"
            data-testid="telestrator-undo-button"
            disabled={compositorState.annotationCount === 0}
            onClick={() => {
              undoAnnotation();
            }}
            className="inline-flex min-h-7 items-center gap-1 rounded-md border border-slate-700 bg-slate-900 px-2.5 py-1 text-xs font-medium text-slate-100 hover:bg-slate-800 focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-sky-400 disabled:cursor-not-allowed disabled:opacity-50"
          >
            <UndoIcon className="h-3 w-3 shrink-0" />
            <span>Undo</span>
          </button>

          <button
            type="button"
            data-testid="telestrator-clear-button"
            disabled={compositorState.annotationCount === 0}
            onClick={clearAnnotations}
            className="inline-flex min-h-7 items-center gap-1 rounded-md border border-slate-700 bg-slate-900 px-2.5 py-1 text-xs font-medium text-slate-100 hover:border-rose-400/40 hover:text-rose-200 focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-sky-400 disabled:cursor-not-allowed disabled:opacity-50"
          >
            <TrashIcon className="h-3 w-3 shrink-0" />
            <span>
              Clear
              {compositorState.annotationCount > 0
                ? ` (${String(compositorState.annotationCount)})`
                : ''}
            </span>
          </button>
        </div>
      </div>

      {/* Contextual On-Canvas Lower-Third Banner Editor */}
      {compositorState.lowerThird.enabled && (
        <div
          data-testid="lower-third-controls-bar"
          className="grid grid-cols-1 gap-2 border-b border-slate-800 bg-slate-950/75 px-3 py-2 sm:grid-cols-2 sm:px-4"
        >
          <div className="flex items-center gap-2">
            <label
              htmlFor="lower-third-title-input"
              className="shrink-0 text-xs font-medium text-slate-300"
            >
              Headline
            </label>
            <input
              id="lower-third-title-input"
              data-testid="lower-third-title-input"
              type="text"
              maxLength={MAX_LOWER_THIRD_TEXT_LENGTH}
              value={compositorState.lowerThird.title}
              onChange={(event) => {
                setLowerThird({ title: event.currentTarget.value });
              }}
              placeholder="Creator or segment headline"
              className="min-w-0 flex-1 rounded-md border border-slate-700 bg-slate-900 px-2.5 py-1 text-xs text-slate-100 placeholder:text-slate-400 focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-sky-400"
            />
          </div>

          <div className="flex items-center gap-2">
            <label
              htmlFor="lower-third-subtitle-input"
              className="shrink-0 text-xs font-medium text-slate-300"
            >
              Subtitle
            </label>
            <input
              id="lower-third-subtitle-input"
              data-testid="lower-third-subtitle-input"
              type="text"
              maxLength={MAX_LOWER_THIRD_TEXT_LENGTH}
              value={compositorState.lowerThird.subtitle}
              onChange={(event) => {
                setLowerThird({ subtitle: event.currentTarget.value });
              }}
              placeholder="Topic, guest, or chapter note"
              className="min-w-0 flex-1 rounded-md border border-slate-700 bg-slate-900 px-2.5 py-1 text-xs text-slate-100 placeholder:text-slate-400 focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-sky-400"
            />
          </div>
        </div>
      )}

      {/* Contextual Non-Recorded Eye-Line Teleprompter Editor */}
      {teleprompter.enabled && (
        <div
          data-testid="teleprompter-controls-bar"
          className="flex flex-col gap-2 border-b border-slate-800 bg-slate-950/80 px-3 py-2.5 sm:px-4"
        >
          <div className="flex flex-wrap items-center justify-between gap-2">
            <label
              htmlFor="teleprompter-script-input"
              className="text-xs font-semibold text-sky-300"
            >
              Eye-Line Talking Points (Never Recorded onto Canvas)
            </label>

            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                data-testid="teleprompter-scroll-toggle"
                aria-pressed={isTeleprompterScrolling}
                onClick={() => {
                  setIsTeleprompterScrolling((prev) => !prev);
                }}
                className={
                  isTeleprompterScrolling
                    ? 'rounded-md bg-emerald-400 px-2.5 py-1 text-xs font-semibold text-slate-950 focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-emerald-300'
                    : 'rounded-md border border-slate-700 bg-slate-900 px-2.5 py-1 text-xs font-medium text-slate-100 hover:bg-slate-800 focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-sky-400'
                }
              >
                {isTeleprompterScrolling ? 'Pause Scroll' : 'Auto-Scroll'}
              </button>

              <button
                type="button"
                data-testid="teleprompter-reset-scroll"
                onClick={() => {
                  setIsTeleprompterScrolling(false);
                  if (teleprompterViewportRef.current) {
                    teleprompterViewportRef.current.scrollTop = 0;
                  }
                }}
                className="rounded-md border border-slate-700 bg-slate-900 px-2 py-1 text-xs font-medium text-slate-200 hover:bg-slate-800 focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-sky-400"
              >
                Reset Top
              </button>

              <div className="flex items-center gap-1.5">
                <label
                  htmlFor="teleprompter-speed-slider"
                  className="text-xs font-medium text-slate-300"
                >
                  Speed
                </label>
                <input
                  id="teleprompter-speed-slider"
                  data-testid="teleprompter-speed-slider"
                  type="range"
                  min={1}
                  max={5}
                  step={1}
                  value={teleprompter.scrollSpeed}
                  onChange={(event) => {
                    setTeleprompter({
                      scrollSpeed: Number(event.currentTarget.value),
                    });
                  }}
                  className="h-2 w-20 cursor-pointer rounded-lg bg-slate-800"
                />
                <span className="font-mono text-xs text-slate-200 tabular-nums">
                  {teleprompter.scrollSpeed}x
                </span>
              </div>

              <div className="flex items-center gap-1">
                <label
                  htmlFor="teleprompter-size-select"
                  className="text-xs font-medium text-slate-300"
                >
                  Font
                </label>
                <select
                  id="teleprompter-size-select"
                  data-testid="teleprompter-size-select"
                  value={teleprompter.fontSize}
                  onChange={(event) => {
                    setTeleprompter({
                      fontSize: event.currentTarget.value as TeleprompterFontSize,
                    });
                  }}
                  className="rounded border border-slate-700 bg-slate-900 px-2 py-0.5 text-xs font-medium text-slate-100 focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-sky-400"
                >
                  <option value="sm">Compact</option>
                  <option value="md">Medium</option>
                  <option value="lg">Large</option>
                </select>
              </div>
            </div>
          </div>

          <textarea
            id="teleprompter-script-input"
            data-testid="teleprompter-script-input"
            rows={2}
            maxLength={MAX_TELEPROMPTER_SCRIPT_LENGTH}
            value={teleprompter.scriptText}
            onChange={(event) => {
              setTeleprompter({ scriptText: event.currentTarget.value });
            }}
            placeholder="Paste talking points, timestamps, or reaction outline…"
            className="w-full rounded-md border border-slate-700 bg-slate-900 px-2.5 py-1.5 text-xs leading-relaxed text-slate-100 placeholder:text-slate-400 focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-sky-400"
          />
        </div>
      )}

      {/* Compositor or Playback Inline Error Alerts */}
      {compositorState.lastError && (
        <div
          role="alert"
          data-testid="compositor-error-alert"
          className="flex items-start gap-2.5 border-b border-rose-500/40 bg-rose-950/75 px-4 py-2.5 text-xs text-rose-100"
        >
          <AlertIcon className="mt-0.5 h-4 w-4 shrink-0 text-rose-300" />
          <div>
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="font-semibold">
                {compositorState.lastError.title}
              </span>
              <span className="rounded bg-rose-900/90 px-1.5 py-0.5 font-mono text-[10px] text-rose-200">
                {compositorState.lastError.code}
              </span>
            </div>
            <p className="mt-0.5 text-rose-100">
              {compositorState.lastError.message}
            </p>
          </div>
        </div>
      )}

      {isSourcePlayable && playback.error && (
        <div
          role="alert"
          data-testid="playback-inline-error"
          className="flex items-start gap-2.5 border-b border-rose-500/40 bg-rose-950/70 px-4 py-2.5 text-xs text-rose-100"
        >
          <AlertIcon className="mt-0.5 h-4 w-4 shrink-0 text-rose-300" />
          <div>
            <p className="font-semibold">{playback.error.title}</p>
            <p className="text-rose-200">{playback.error.message}</p>
          </div>
        </div>
      )}

      {/* Dominant Single Composed Scene Viewport (16:9 Landscape or 9:16 Vertical Shorts) */}
      <div className="w-full bg-slate-950">
        <div
          ref={stageViewportRef}
          data-testid="source-dropzone"
          onDragEnter={handleDragEnter}
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          onDrop={handleDrop}
          className={`relative flex items-center justify-center overflow-hidden bg-slate-950 ${
            isPortraitStage
              ? 'mx-auto aspect-[9/16] max-h-[540px] w-full max-w-[304px] border-x border-slate-800/80'
              : 'aspect-video w-full'
          } ${isDraggingFileOver ? 'ring-2 ring-sky-400 ring-inset' : ''}`}
        >
        {/* Backing local video element borrowed read-only by SceneCompositor */}
        <video
          ref={videoRef}
          data-testid="source-video-element"
          tabIndex={-1}
          aria-hidden="true"
          playsInline
          preload="metadata"
          className="pointer-events-none absolute top-0 left-0 h-px w-px opacity-0"
        />

        {/* Composed HTML5 Canvas Output (future captureStream(30) source) */}
        <canvas
          ref={canvasRef}
          data-testid="scene-compositor-canvas"
          role="img"
          aria-label={`Composed scene output (${getLayoutDisplayName(compositorState.layoutMode)}, ${compositorState.width} by ${compositorState.height})`}
          onPointerDown={handleCanvasPointerDown}
          onPointerMove={handleCanvasPointerMove}
          onPointerUp={(e) => finishCanvasStroke(e, true)}
          onPointerCancel={(e) => finishCanvasStroke(e, false)}
          className={`block h-full w-full object-contain ${
            activeTool !== 'none' ? 'touch-none cursor-crosshair' : ''
          }`}
        />

        {/* Interactive Normalized PIP Overlay Handles (Pointer, Touch & Keyboard Accessible) */}
        {compositorState.layoutMode === 'pip' &&
          activeTool === 'none' &&
          !showCenteredEmptyPrompt &&
          playback.status !== 'error' && (
            <div
              data-testid="pip-stage-overlay"
              style={{
                left: `${compositorState.pipRect.x * 100}%`,
                top: `${compositorState.pipRect.y * 100}%`,
                width: `${compositorState.pipRect.width * 100}%`,
                height: `${compositorState.pipRect.height * 100}%`,
              }}
              className={`pointer-events-none absolute z-10 border border-sky-400/70 ${
                compositorState.pipFrameShape === 'circle'
                  ? 'rounded-full'
                  : compositorState.pipFrameShape === 'rounded'
                    ? 'rounded-xl'
                    : 'rounded'
              }`}
            >
              <button
                type="button"
                data-testid="pip-drag-handle"
                title="Drag or use Arrow keys to move Picture-in-Picture overlay"
                onPointerDown={(e) => startPipPointerGesture('move', e)}
                onKeyDown={handlePipMoveKeyDown}
                className="pointer-events-auto absolute top-1 left-1 inline-flex min-h-6 touch-none items-center rounded bg-slate-950/90 px-2 py-0.5 text-[11px] font-semibold text-slate-100 shadow cursor-move hover:bg-slate-900 focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-sky-300"
              >
                Move PIP
              </button>

              <button
                type="button"
                data-testid="pip-resize-handle"
                title="Drag or use Arrow/+/- keys to resize Picture-in-Picture overlay"
                onPointerDown={(e) => startPipPointerGesture('resize', e)}
                onKeyDown={handlePipResizeKeyDown}
                className="pointer-events-auto absolute right-1 bottom-1 inline-flex h-6 w-6 touch-none items-center justify-center rounded bg-sky-400 text-slate-950 shadow cursor-nwse-resize hover:bg-sky-300 focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-sky-200"
              >
                <span className="sr-only">Resize PIP</span>
                <ResizeCornerIcon className="h-3.5 w-3.5" />
              </button>
            </div>
          )}

        {/* Onboarding Empty Prompt when stage has neither source video nor active camera */}
        {showCenteredEmptyPrompt && (
          <div className="z-20 flex max-w-md flex-col items-center rounded-xl border border-slate-800/90 bg-slate-950/90 px-4 py-3.5 text-center shadow-xl sm:px-6 sm:py-7">
            <div className="mb-2 hidden h-11 w-11 items-center justify-center rounded-full border border-sky-400/30 bg-sky-400/10 text-sky-300 sm:flex">
              <UploadVideoIcon className="h-5 w-5" />
            </div>
            <h3 className="text-xs font-semibold text-slate-100 sm:text-base">
              Import a local video or share a screen
            </h3>
            <p className="mt-1 hidden text-xs leading-relaxed text-slate-300 sm:block">
              Drop a local video, share a browser tab or window, or start your
              webcam to preview live composition. Everything stays 100% local.
            </p>
            <div className="mt-2.5 flex flex-wrap items-center justify-center gap-2 sm:mt-3.5">
              <button
                type="button"
                data-testid="select-video-button"
                onClick={openFilePicker}
                className="inline-flex items-center gap-1.5 rounded-lg bg-sky-400 px-3 py-1.5 text-xs font-semibold text-slate-950 shadow hover:bg-sky-300 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky-300 sm:px-4 sm:py-2 sm:text-sm"
              >
                <span>Select Local Video</span>
              </button>
              <button
                type="button"
                data-testid="share-screen-button"
                onClick={() => {
                  void startScreenShare();
                }}
                className="inline-flex items-center gap-1.5 rounded-lg border border-slate-700 bg-slate-900 px-3 py-1.5 text-xs font-medium text-slate-100 hover:bg-slate-800 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky-400 sm:px-3.5 sm:py-2 sm:text-sm"
              >
                <ScreenShareIcon className="h-3.5 w-3.5 shrink-0 text-sky-300" />
                <span>Share Screen / Tab</span>
              </button>
            </div>
            <div className="mt-3 hidden flex-wrap justify-center gap-1.5 text-[11px] text-slate-300 sm:flex">
              <span className="rounded border border-slate-800 bg-slate-900 px-2 py-0.5">
                MP4 (H.264 / AAC)
              </span>
              <span className="rounded border border-slate-800 bg-slate-900 px-2 py-0.5">
                WebM (VP8 / VP9 / AV1)
              </span>
              <span className="rounded border border-slate-800 bg-slate-900 px-2 py-0.5">
                Live Tab / Window
              </span>
            </div>
          </div>
        )}

        {/* Non-blocking Loading Pill so live webcam continues visibly */}
        {playback.status === 'loading' && (
          <div
            role="status"
            data-testid="source-loading-indicator"
            className="pointer-events-none absolute top-3 left-3 z-20 flex items-center gap-2.5 rounded-lg border border-sky-400/40 bg-slate-950/90 px-3 py-2 text-xs text-slate-100 shadow-lg"
          >
            <div className="h-4 w-4 animate-spin rounded-full border-2 border-slate-700 border-t-sky-400" />
            <div className="min-w-0">
              <p className="font-medium">
                Validating local stream &amp; reading metadata…
              </p>
              {playback.pendingFileName && (
                <p className="max-w-[200px] truncate text-[11px] text-slate-300">
                  {playback.pendingFileName}
                </p>
              )}
            </div>
          </div>
        )}

        {/* Source Ingestion / Decode Error Alert */}
        {playback.status === 'error' && playback.error && (
          <div
            role="alert"
            data-testid="source-error-alert"
            className="z-20 mx-3 flex max-w-lg flex-col items-center rounded-xl border border-rose-500/40 bg-rose-950/90 p-4 text-center shadow-xl sm:p-5"
          >
            <div className="mb-2 flex h-9 w-9 items-center justify-center rounded-full bg-rose-500/20 text-rose-300">
              <AlertIcon className="h-5 w-5" />
            </div>
            <div className="flex flex-wrap items-center justify-center gap-2">
              <h3 className="text-sm font-semibold text-rose-100">
                {playback.error.title}
              </h3>
              <span className="rounded bg-rose-900/95 px-2 py-0.5 font-mono text-[11px] text-rose-200">
                {playback.error.code}
              </span>
            </div>
            <p className="mt-1 text-xs leading-relaxed text-rose-100">
              {playback.error.message}
            </p>
            <div className="mt-3 flex flex-wrap items-center justify-center gap-2">
              <button
                type="button"
                data-testid="error-retry-button"
                onClick={openFilePicker}
                className="rounded-lg bg-sky-400 px-3 py-1.5 text-xs font-semibold text-slate-950 hover:bg-sky-300 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky-300"
              >
                Choose Supported Video
              </button>
              <button
                type="button"
                data-testid="error-clear-button"
                onClick={unload}
                className="rounded-lg border border-slate-700 bg-slate-900 px-3 py-1.5 text-xs font-medium text-slate-100 hover:bg-slate-800 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky-400"
              >
                Reset Stage
              </button>
            </div>
          </div>
        )}

        {isDraggingFileOver && (
          <div
            data-testid="drag-overlay"
            className="pointer-events-none absolute inset-0 z-30 flex items-center justify-center bg-slate-950/85 backdrop-blur-xs"
          >
            <div className="rounded-xl border-2 border-dashed border-sky-400 bg-slate-900/95 px-5 py-4 text-center">
              <p className="text-sm font-semibold text-sky-300">
                Drop video file to load into Scene Stage
              </p>
              <p className="mt-0.5 text-xs text-slate-300">
                Previous Object URL will be revoked automatically
              </p>
            </div>
          </div>
        )}

        {/* Non-Recorded Top-Center Eye-Line Teleprompter HUD Overlay */}
        {teleprompter.enabled && (
          <div
            data-testid="teleprompter-stage-overlay"
            className="pointer-events-auto absolute top-2.5 left-1/2 z-20 flex w-[92%] max-w-xl -translate-x-1/2 flex-col rounded-xl border border-sky-400/35 bg-slate-950/85 px-3 py-2 text-slate-100 shadow-xl backdrop-blur-xs"
          >
            <div className="flex items-center justify-between gap-2 border-b border-slate-800/90 pb-1">
              <span className="text-[10px] font-semibold tracking-wider text-sky-300 uppercase">
                Eye-Line Prompter · Not Recorded
              </span>
              <button
                type="button"
                data-testid="teleprompter-hud-hide"
                onClick={toggleTeleprompter}
                className="rounded px-1.5 py-0.5 text-[10px] font-semibold text-slate-300 hover:bg-slate-800 hover:text-slate-100 focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-sky-300"
              >
                Hide (T)
              </button>
            </div>
            <div
              ref={teleprompterViewportRef}
              data-testid="teleprompter-hud-viewport"
              className={`mt-1.5 max-h-24 overflow-y-auto whitespace-pre-wrap leading-relaxed font-medium text-slate-100 sm:max-h-28 ${
                teleprompter.fontSize === 'lg'
                  ? 'text-sm sm:text-base'
                  : teleprompter.fontSize === 'sm'
                    ? 'text-[11px] sm:text-xs'
                    : 'text-xs sm:text-sm'
              }`}
            >
              {teleprompter.scriptText.trim().length > 0
                ? teleprompter.scriptText
                : 'Add talking points in the Teleprompter bar above.'}
            </div>
          </div>
        )}

        <StagePreRollOverlay />
        </div>
      </div>

      {/* Contextual PIP Geometry Controls */}
      {compositorState.layoutMode === 'pip' && (
        <div
          data-testid="pip-controls-bar"
          className="flex flex-col gap-2.5 border-t border-slate-800 bg-slate-950/70 px-3 py-2.5 sm:flex-row sm:flex-wrap sm:items-center sm:justify-between sm:px-4"
        >
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="mr-1 text-xs font-medium text-slate-300">
              PIP Position:
            </span>
            {PIP_CORNER_OPTIONS.map((corner) => (
              <button
                key={corner.id}
                type="button"
                data-testid={`pip-corner-${corner.id}`}
                onClick={() => snapPipToCorner(corner.id)}
                className="rounded border border-slate-700 bg-slate-900 px-2 py-1 text-xs font-medium text-slate-100 hover:bg-slate-800 focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-sky-400"
              >
                {corner.label}
              </button>
            ))}
            <button
              type="button"
              data-testid="pip-reset-button"
              onClick={resetPipRect}
              className="rounded border border-slate-700 bg-slate-800 px-2 py-1 text-xs font-medium text-sky-300 hover:bg-slate-700 focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-sky-400"
            >
              Reset PIP
            </button>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <div
              role="group"
              aria-label="PIP webcam shape"
              className="flex items-center gap-1"
            >
              {PIP_SHAPE_OPTIONS.map((shape) => {
                const isSelected = compositorState.pipFrameShape === shape.id;
                return (
                  <button
                    key={shape.id}
                    type="button"
                    data-testid={`pip-shape-${shape.id}`}
                    aria-pressed={isSelected}
                    onClick={() => setPipFrameShape(shape.id)}
                    className={
                      isSelected
                        ? 'rounded bg-sky-400 px-2 py-1 text-xs font-semibold text-slate-950 focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-sky-300'
                        : 'rounded border border-slate-700 bg-slate-900 px-2 py-1 text-xs font-medium text-slate-100 hover:bg-slate-800 focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-sky-400'
                    }
                  >
                    {shape.label}
                  </button>
                );
              })}
            </div>

            <select
              data-testid="pip-border-select"
              aria-label="PIP border style"
              value={compositorState.pipBorderStyle}
              onChange={handlePipBorderChange}
              className="rounded border border-slate-700 bg-slate-900 px-2 py-1 text-xs font-medium text-slate-100 focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-sky-400"
            >
              {PIP_BORDER_OPTIONS.map((opt) => (
                <option key={opt.id} value={opt.id}>
                  {opt.label}
                </option>
              ))}
            </select>

            <label
              htmlFor="pip-size-slider"
              className="text-xs font-medium text-slate-300"
            >
              PIP Size
            </label>
            <input
              id="pip-size-slider"
              data-testid="pip-size-slider"
              type="range"
              min={MIN_PIP_SIZE}
              max={MAX_PIP_SIZE}
              step={0.01}
              value={compositorState.pipRect.width}
              aria-valuetext={`${pipSizePercent} percent of scene width`}
              onChange={handlePipSizeSliderChange}
              className="h-2 w-24 cursor-pointer rounded-lg bg-slate-800 sm:w-28"
            />
            <span
              data-testid="pip-metrics-readout"
              className="font-mono text-xs text-slate-200 tabular-nums"
            >
              X:{pipXPercent}% Y:{pipYPercent}% · {pipSizePercent}%
            </span>
          </div>
        </div>
      )}

      {/* Contextual Side-by-Side or Top/Bottom Split Ratio Controls */}
      {(compositorState.layoutMode === 'side-by-side' ||
        compositorState.layoutMode === 'top-bottom') && (
        <div
          data-testid="split-controls-bar"
          className="flex flex-col gap-2 border-t border-slate-800 bg-slate-950/70 px-3 py-2.5 sm:flex-row sm:flex-wrap sm:items-center sm:justify-between sm:px-4"
        >
          <div className="flex flex-wrap items-center gap-2">
            <label
              htmlFor="split-ratio-slider"
              className="text-xs font-medium text-slate-300"
            >
              Split Ratio
            </label>
            <input
              id="split-ratio-slider"
              data-testid="split-ratio-slider"
              type="range"
              min={MIN_SPLIT_RATIO}
              max={MAX_SPLIT_RATIO}
              step={0.01}
              value={compositorState.splitRatio}
              aria-valuetext={`${splitLeftPercent} percent source video, ${splitRightPercent} percent webcam`}
              onChange={handleSplitSliderChange}
              className="h-2 w-32 cursor-pointer rounded-lg bg-slate-800 sm:w-44"
            />
            <span
              data-testid="split-ratio-readout"
              className="font-mono text-xs font-medium text-slate-100 tabular-nums"
            >
              {compositorState.layoutMode === 'top-bottom'
                ? `${splitLeftPercent}% Top Source / ${splitRightPercent}% Bottom Webcam`
                : `${splitLeftPercent}% Source / ${splitRightPercent}% Webcam`}
            </span>
          </div>

          <button
            type="button"
            data-testid="reset-split-button"
            onClick={resetSplitRatio}
            className="self-start rounded border border-slate-700 bg-slate-800 px-2.5 py-1 text-xs font-medium text-sky-300 hover:bg-slate-700 focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-sky-400 sm:self-auto"
          >
            Reset Split
          </button>
        </div>
      )}

      {/* Integrated Source Media Ingestion Strip (Visually Separated from Scene Output) */}
      <div className="flex flex-wrap items-center justify-between gap-2 border-t border-slate-800 bg-slate-900 px-3 py-2.5 sm:px-4">
        <div className="flex min-w-0 flex-wrap items-center gap-2 text-xs">
          <span className="font-semibold text-sky-300">Source Media:</span>
          {playback.metadata ? (
            <div className="flex min-w-0 flex-wrap items-center gap-1.5 text-slate-300">
              {playback.sourceMode === 'screen' && (
                <span
                  data-testid="live-screen-badge"
                  className="inline-flex items-center gap-1 rounded border border-sky-400/40 bg-sky-400/10 px-2 py-0.5 text-[11px] font-semibold text-sky-200"
                >
                  <span
                    aria-hidden="true"
                    className="h-1.5 w-1.5 rounded-full bg-sky-400"
                  />
                  Live Screen
                </span>
              )}
              <span
                data-testid="loaded-file-name"
                className="max-w-[170px] truncate rounded bg-slate-800 px-2 py-0.5 font-medium text-slate-100 sm:max-w-[260px]"
                title={playback.metadata.fileName}
              >
                {playback.metadata.fileName}
              </span>
              <span className="rounded bg-slate-800/80 px-1.5 py-0.5 font-mono text-slate-200">
                {playback.metadata.width}×{playback.metadata.height}
              </span>
              {playback.sourceMode === 'screen' ? (
                <span className="rounded bg-slate-800/80 px-1.5 py-0.5 text-slate-200">
                  {playback.hasScreenAudioTrack ? 'Tab Audio' : 'Video Only'}
                </span>
              ) : (
                <span className="rounded bg-slate-800/80 px-1.5 py-0.5 text-slate-200">
                  {formatBytes(playback.metadata.fileSizeBytes)}
                </span>
              )}
              {(playback.status === 'paused' || playback.status === 'ready') && (
                <span className="rounded border border-sky-400/30 bg-sky-400/10 px-1.5 py-0.5 text-[11px] font-medium text-sky-300">
                  {playback.sourceMode === 'screen' ? 'Frozen Frame' : 'Held Frame'}
                </span>
              )}
              {playback.status === 'ended' && (
                <span className="rounded border border-amber-400/30 bg-amber-400/10 px-1.5 py-0.5 text-[11px] font-medium text-amber-300">
                  Ended
                </span>
              )}
            </div>
          ) : (
            <span className="text-slate-300">No source video loaded</span>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {playback.status === 'empty' && !showCenteredEmptyPrompt && (
            <>
              <button
                type="button"
                data-testid="select-video-button"
                onClick={openFilePicker}
                className="rounded-md bg-sky-400 px-3 py-1.5 text-xs font-semibold text-slate-950 hover:bg-sky-300 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky-300"
              >
                Select Local Video
              </button>
              <button
                type="button"
                data-testid="share-screen-button"
                onClick={() => {
                  void startScreenShare();
                }}
                className="inline-flex items-center gap-1 rounded-md border border-slate-700 bg-slate-800 px-2.5 py-1.5 text-xs font-medium text-slate-100 hover:bg-slate-700 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky-400"
              >
                <ScreenShareIcon className="h-3.5 w-3.5 shrink-0 text-sky-300" />
                <span>Share Screen / Tab</span>
              </button>
            </>
          )}

          {playback.status !== 'empty' && (
            <>
              <button
                type="button"
                data-testid="share-screen-button"
                onClick={() => {
                  void startScreenShare();
                }}
                className="inline-flex items-center gap-1 rounded-md border border-slate-700 bg-slate-800 px-2.5 py-1.5 text-xs font-medium text-slate-100 hover:bg-slate-700 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky-400"
              >
                <ScreenShareIcon className="h-3.5 w-3.5 shrink-0 text-sky-300" />
                <span>
                  {playback.sourceMode === 'screen'
                    ? 'Change Screen'
                    : 'Share Screen / Tab'}
                </span>
              </button>
              <button
                type="button"
                data-testid="replace-video-button"
                onClick={openFilePicker}
                className="rounded-md border border-slate-700 bg-slate-800 px-2.5 py-1.5 text-xs font-medium text-slate-100 hover:bg-slate-700 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky-400"
              >
                Replace Video
              </button>
              <button
                type="button"
                data-testid="unload-video-button"
                onClick={unload}
                className="rounded-md border border-slate-700 bg-slate-950 px-2.5 py-1.5 text-xs font-medium text-slate-300 hover:text-rose-200 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky-400"
              >
                {playback.sourceMode === 'screen' ? 'Stop Share' : 'Unload'}
              </button>
            </>
          )}
        </div>
      </div>
    </section>
  );
}

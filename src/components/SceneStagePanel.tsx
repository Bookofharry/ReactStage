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
import { clampPipRect } from '../services/scene-compositor';
import { useAudioMixer } from '../state/AudioMixerContext';
import { useCapture } from '../state/CaptureContext';
import {
  useCompositorDiagnostics,
  useSceneCompositor,
} from '../state/CompositorContext';
import { useSourcePlayback } from '../state/PlaybackContext';
import { useRecordingSession } from '../state/RecordingSessionContext';
import { useStudioUi } from '../state/StudioUiContext';
import {
  MAX_LOWER_THIRD_TEXT_LENGTH,
  MAX_TELEPROMPTER_SCRIPT_LENGTH,
  SUPPORTED_TELESTRATOR_COLORS,
  type StageLayoutMode,
  type TeleprompterFontSize,
  type TelestratorTool,
} from '../types/media';
import { formatBytes } from '../utils/format';
import {
  AlertIcon,
  ArrowPointerIcon,
  HighlightBoxIcon,
  LaserPointerIcon,
  LayoutCameraIcon,
  LayoutPipIcon,
  LayoutSourceIcon,
  LayoutSplitIcon,
  LayoutVerticalStackIcon,
  MoveQuadArrowsIcon,
  PenToolIcon,
  PlayIcon,
  ResizeCornerIcon,
  ScreenShareIcon,
  SlidersTuneIcon,
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

const PRIMARY_LAYOUT_OPTIONS: readonly {
  readonly mode: StageLayoutMode;
  readonly label: string;
}[] = [
  { mode: 'pip', label: 'PIP' },
  { mode: 'side-by-side', label: 'Split' },
  { mode: 'top-bottom', label: 'Shorts' },
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
      return 'Video Only';
    case 'camera-only':
      return 'Webcam Only';
    case 'pip':
      return 'Picture-in-Picture';
    case 'side-by-side':
      return 'Side-by-Side';
    case 'top-bottom':
      return 'Vertical Shorts';
  }
}

function SceneTelemetryBadges() {
  const { state } = useSceneCompositor();
  const diagnostics = useCompositorDiagnostics();

  const displayWidth =
    diagnostics.actualWidth > 0 ? diagnostics.actualWidth : state.width;
  const displayHeight =
    diagnostics.actualHeight > 0 ? diagnostics.actualHeight : state.height;

  const fpsValue =
    diagnostics.isRunning && diagnostics.measuredFps > 0
      ? Math.round(diagnostics.measuredFps)
      : diagnostics.targetFps;

  return (
    <div className="sr-only">
      <span data-testid="scene-status-badge">
        {diagnostics.isRunning ? 'Scene Live' : 'Scene Paused'}
      </span>
      <span data-testid="scene-dimensions-badge">
        {displayWidth}×{displayHeight} · {fpsValue} fps
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
      className="absolute inset-0 z-30 flex flex-col items-center justify-center bg-slate-950/80 p-2.5 text-center backdrop-blur-sm sm:p-4"
    >
      <div className="flex max-w-full flex-col items-center rounded-2xl border border-sky-400/40 bg-slate-900/95 px-4 py-3.5 shadow-2xl sm:px-6 sm:py-5">
        <span className="text-[11px] font-semibold tracking-wider text-sky-300 uppercase">
          Get Ready
        </span>
        <span
          data-testid="preroll-stage-digit"
          className="mt-1 font-mono text-[clamp(2.25rem,8vw,3.75rem)] leading-none font-extrabold text-white tabular-nums"
        >
          {countdownSecondsRemaining}
        </span>
        <p className="mt-1 text-xs leading-relaxed text-slate-300">
          Recording starts in {countdownSecondsRemaining}{' '}
          {countdownSecondsRemaining === 1 ? 'second' : 'seconds'}
        </p>

        <div className="mt-3 flex flex-wrap items-center justify-center gap-2 sm:mt-3.5">
          <button
            type="button"
            data-testid="stage-skip-countdown-button"
            onClick={() => {
              void skipCountdownAndStart();
            }}
            className="min-h-9 rounded-lg bg-sky-400 px-3 py-1.5 text-xs font-semibold text-slate-950 hover:bg-sky-300 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky-300 active:bg-sky-500"
          >
            Start Now
          </button>
          <button
            type="button"
            data-testid="stage-cancel-countdown-button"
            onClick={cancelCountdown}
            className="min-h-9 rounded-lg border border-white/10 bg-slate-800 px-3 py-1.5 text-xs font-medium text-slate-100 hover:bg-slate-700 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky-300 active:bg-slate-600"
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
    togglePlayPause,
    unload,
  } = useSourcePlayback();
  const { state: mixerState, enableAudio } = useAudioMixer();
  const { snapshot: captureSnapshot } = useCapture();
  const { countdownSecondsRemaining } = useRecordingSession();
  const {
    openSettingsModal,
    isDrawToolbarOpen,
    setIsDrawToolbarOpen,
  } = useStudioUi();
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
    movePipBy,
    resizePipBy,
    snapPipToCorner,
    setLowerThird,
    toggleLowerThird,
    teleprompter,
    setTeleprompter,
    toggleTeleprompter,
    addAnnotation,
    undoAnnotation,
    clearAnnotations,
    setDraftAnnotation,
    pushLaserPoint,
  } = useSceneCompositor();

  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const stageViewportRef = useRef<HTMLDivElement | null>(null);
  const teleprompterViewportRef = useRef<HTMLDivElement | null>(null);
  const dragDepthRef = useRef(0);
  const activeGestureRef = useRef<ActivePointerGesture | null>(null);
  const activeStrokeRef = useRef<ActiveAnnotationStroke | null>(null);
  const strokeCounterRef = useRef(0);

  const [isDraggingFileOver, setIsDraggingFileOver] = useState(false);
  const [isInteractingPip, setIsInteractingPip] = useState(false);
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

  const isSourcePlayable =
    playback.status === 'ready' ||
    playback.status === 'playing' ||
    playback.status === 'paused' ||
    playback.status === 'ended';

  const isCameraActive =
    captureSnapshot.cameraStatus === 'active' &&
    captureSnapshot.activeCameraStream !== null;

  const showDrawToolbar =
    isDrawToolbarOpen ||
    activeTool !== 'none' ||
    compositorState.annotationCount > 0;

  // Show centered gentle welcome card only when stage is completely clean and idle
  const showCenteredEmptyPrompt =
    !showDrawToolbar &&
    !compositorState.lowerThird.enabled &&
    !teleprompter.enabled &&
    playback.status === 'empty' &&
    !isCameraActive &&
    compositorState.layoutMode !== 'camera-only';

  const isPortraitStage = compositorState.height > compositorState.width;
  const hasTallStageOverlay =
    showCenteredEmptyPrompt ||
    (playback.status === 'error' && Boolean(playback.error)) ||
    countdownSecondsRemaining !== null;

  const openFilePicker = useCallback(() => {
    fileInputRef.current?.click();
  }, []);

  const handlePrimaryLayoutSelect = useCallback(
    (mode: StageLayoutMode) => {
      setLayoutMode(mode);
      if (mode === 'top-bottom') {
        if (compositorState.resolutionPreset === '720p') {
          setResolution('720p-vertical');
        } else if (compositorState.resolutionPreset === '1080p') {
          setResolution('1080p-vertical');
        }
      } else if (mode === 'pip' || mode === 'side-by-side') {
        if (compositorState.resolutionPreset === '720p-vertical') {
          setResolution('720p');
        } else if (compositorState.resolutionPreset === '1080p-vertical') {
          setResolution('1080p');
        }
      }
    },
    [compositorState.resolutionPreset, setLayoutMode, setResolution],
  );

  const handleCanvasTapPlayPause = useCallback(() => {
    if (activeTool !== 'none' || !isSourcePlayable) {
      return;
    }
    if (playback.status !== 'playing' && mixerState.status === 'suspended') {
      void enableAudio();
    }
    void togglePlayPause();
  }, [
    activeTool,
    enableAudio,
    isSourcePlayable,
    mixerState.status,
    playback.status,
    togglePlayPause,
  ]);

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
    [
      activeColor,
      activeTool,
      pushLaserPoint,
      resolveCanvasNormalizedPoint,
      setDraftAnnotation,
    ],
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
    [
      activeTool,
      pushLaserPoint,
      resolveCanvasNormalizedPoint,
      setDraftAnnotation,
    ],
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

  return (
    <section
      data-testid="scene-stage-panel"
      aria-labelledby="scene-stage-heading"
      className="flex flex-col overflow-hidden rounded-2xl border border-slate-800/80 bg-slate-900/60 shadow-lg shadow-black/25"
    >
      <h2 id="scene-stage-heading" className="sr-only">
        Live Scene Stage
      </h2>
      <SceneTelemetryBadges />

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

      {/* Calm Single-Row Stage Bar: Only PIP / Split / Shorts + More Tools */}
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-800/80 px-2.5 py-2 min-[375px]:px-3.5 sm:px-4">
        <div
          role="group"
          aria-label="Scene layout mode"
          className="inline-flex flex-wrap items-center gap-1 rounded-xl border border-slate-800 bg-slate-950/80 p-1"
        >
          {PRIMARY_LAYOUT_OPTIONS.map((item) => {
            const isSelected = compositorState.layoutMode === item.mode;
            return (
              <button
                key={item.mode}
                type="button"
                data-testid={`layout-mode-${item.mode}`}
                aria-pressed={isSelected}
                onClick={() => handlePrimaryLayoutSelect(item.mode)}
                className={
                  isSelected
                    ? 'inline-flex min-h-8 items-center justify-center gap-1.5 rounded-lg border border-sky-400/35 bg-sky-400/15 px-3 py-1 text-xs font-semibold text-sky-200 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky-300'
                    : 'inline-flex min-h-8 items-center justify-center gap-1.5 rounded-lg px-2.5 py-1 text-xs font-medium text-slate-300 hover:bg-slate-800/80 hover:text-white focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky-400'
                }
              >
                {renderLayoutIcon(item.mode)}
                <span>{item.label}</span>
              </button>
            );
          })}

          {(compositorState.layoutMode === 'source-only' ||
            compositorState.layoutMode === 'camera-only') && (
            <span className="inline-flex min-h-8 items-center gap-1 rounded-lg border border-sky-400/30 bg-sky-400/10 px-2.5 py-1 text-xs font-medium text-sky-200">
              {renderLayoutIcon(compositorState.layoutMode)}
              <span>{getLayoutDisplayName(compositorState.layoutMode)}</span>
            </span>
          )}
        </div>

        <button
          type="button"
          data-testid="open-stage-tools-button"
          onClick={openSettingsModal}
          className="inline-flex min-h-9 items-center gap-1.5 rounded-xl border border-slate-800 bg-slate-950/80 px-3 py-1.5 text-xs font-medium text-slate-300 hover:border-slate-700 hover:bg-slate-800 hover:text-white focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky-400"
        >
          <SlidersTuneIcon className="h-3.5 w-3.5 shrink-0 text-sky-300" />
          <span>More Tools</span>
        </button>
      </div>

      {/* Expandable On-Stage Drawing & Laser Palette */}
      {showDrawToolbar && (
        <div
          data-testid="telestrator-toolbar"
          className="flex flex-wrap items-center justify-between gap-2 border-b border-white/[0.07] bg-slate-950/90 px-2.5 py-2 min-[375px]:px-3.5 sm:px-4"
        >
          <div className="flex flex-wrap items-center gap-2">
            <div
              role="group"
              aria-label="Stage Telestrator tools"
              className="flex flex-wrap items-center gap-1.5"
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
                        ? 'inline-flex min-h-9 items-center gap-1 rounded-lg bg-sky-400 px-2.5 py-1 text-xs font-semibold text-slate-950 focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-sky-300 sm:min-h-8'
                        : 'inline-flex min-h-9 items-center gap-1 rounded-lg border border-white/10 bg-slate-900 px-2.5 py-1 text-xs font-medium text-slate-100 hover:bg-slate-800 focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-sky-400 active:bg-slate-700 sm:min-h-8'
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
              className="flex flex-wrap items-center gap-2 sm:ml-1"
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
                    className={`flex h-8 w-8 items-center justify-center rounded-full border transition focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky-300 sm:h-7 sm:w-7 ${
                      isSelected
                        ? 'border-white ring-2 ring-sky-400'
                        : 'border-slate-600 hover:border-slate-300'
                    }`}
                  >
                    <span
                      aria-hidden="true"
                      style={{ backgroundColor: swatch.hex }}
                      className="h-4 w-4 rounded-full sm:h-3.5 sm:w-3.5"
                    />
                  </button>
                );
              })}
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-1.5">
            <button
              type="button"
              data-testid="telestrator-undo-button"
              disabled={compositorState.annotationCount === 0}
              onClick={() => {
                undoAnnotation();
              }}
              className="inline-flex min-h-9 items-center gap-1 rounded-lg border border-white/10 bg-slate-900 px-2.5 py-1 text-xs font-medium text-slate-100 hover:bg-slate-800 focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-sky-400 active:bg-slate-700 disabled:cursor-not-allowed disabled:opacity-50 sm:min-h-8"
            >
              <UndoIcon className="h-3 w-3 shrink-0" />
              <span>Undo</span>
            </button>

            <button
              type="button"
              data-testid="telestrator-clear-button"
              disabled={compositorState.annotationCount === 0}
              onClick={clearAnnotations}
              className="inline-flex min-h-9 items-center gap-1 rounded-lg border border-slate-800 bg-slate-900 px-2.5 py-1 text-xs font-medium text-slate-200 hover:border-rose-400/40 hover:text-rose-200 focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-sky-400 disabled:cursor-not-allowed disabled:opacity-50 sm:min-h-8"
            >
              <TrashIcon className="h-3 w-3 shrink-0" />
              <span>
                Clear
                {compositorState.annotationCount > 0
                  ? ` (${String(compositorState.annotationCount)})`
                  : ''}
              </span>
            </button>

            <button
              type="button"
              data-testid="close-draw-toolbar-button"
              onClick={() => {
                setActiveTool('none');
                setIsDrawToolbarOpen(false);
              }}
              className="inline-flex min-h-9 items-center rounded-lg bg-slate-800 px-2.5 py-1 text-xs font-semibold text-slate-100 hover:bg-slate-700 focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-sky-400 sm:min-h-8"
            >
              Done
            </button>
          </div>
        </div>
      )}

      {/* Contextual On-Canvas Lower-Third Title Banner Editor */}
      {compositorState.lowerThird.enabled && (
        <div
          data-testid="lower-third-controls-bar"
          className="flex flex-wrap items-center gap-2 border-b border-slate-800/80 bg-slate-950/80 px-2.5 py-2 min-[375px]:px-3.5 sm:px-4"
        >
          <div className="flex min-w-[10rem] flex-1 items-center gap-2">
            <label
              htmlFor="lower-third-title-input"
              className="shrink-0 text-xs font-medium text-slate-300"
            >
              Title
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
              placeholder="Your name or episode title"
              className="min-h-9 min-w-0 flex-1 rounded-lg border border-slate-800 bg-slate-900 px-2.5 py-1.5 text-xs text-slate-100 placeholder:text-slate-400 focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-sky-400"
            />
          </div>

          <div className="flex min-w-[10rem] flex-1 items-center gap-2">
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
              placeholder="Channel handle or topic"
              className="min-h-9 min-w-0 flex-1 rounded-lg border border-slate-800 bg-slate-900 px-2.5 py-1.5 text-xs text-slate-100 placeholder:text-slate-400 focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-sky-400"
            />
          </div>

          <button
            type="button"
            onClick={toggleLowerThird}
            className="min-h-9 rounded-lg border border-slate-800 bg-slate-900 px-2.5 py-1 text-xs text-slate-300 hover:bg-slate-800 hover:text-white focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-sky-400"
          >
            Hide
          </button>
        </div>
      )}

      {/* Contextual Non-Recorded Eye-Line Teleprompter Editor */}
      {teleprompter.enabled && (
        <div
          data-testid="teleprompter-controls-bar"
          className="flex flex-col gap-2 border-b border-white/[0.07] bg-slate-950/85 px-2.5 py-2.5 min-[375px]:px-3.5 sm:px-4"
        >
          <div className="flex flex-wrap items-center justify-between gap-2">
            <label
              htmlFor="teleprompter-script-input"
              className="text-xs font-semibold text-sky-300"
            >
              Private Speaker Notes (Only you see this — never recorded)
            </label>

            <div className="flex w-full flex-wrap items-center gap-2 sm:w-auto">
              <button
                type="button"
                data-testid="teleprompter-scroll-toggle"
                aria-pressed={isTeleprompterScrolling}
                onClick={() => {
                  setIsTeleprompterScrolling((prev) => !prev);
                }}
                className={
                  isTeleprompterScrolling
                    ? 'min-h-9 rounded-lg bg-emerald-400 px-2.5 py-1 text-xs font-semibold text-slate-950 focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-emerald-300 sm:min-h-8'
                    : 'min-h-9 rounded-lg border border-white/10 bg-slate-900 px-2.5 py-1 text-xs font-medium text-slate-100 hover:bg-slate-800 focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-sky-400 active:bg-slate-700 sm:min-h-8'
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
                className="min-h-9 rounded-lg border border-white/10 bg-slate-900 px-2.5 py-1 text-xs font-medium text-slate-200 hover:bg-slate-800 focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-sky-400 active:bg-slate-700 sm:min-h-8"
              >
                Back to Top
              </button>

              <div className="flex min-w-[8.5rem] flex-1 items-center gap-1.5 sm:flex-initial">
                <label
                  htmlFor="teleprompter-speed-slider"
                  className="shrink-0 text-xs font-medium text-slate-300"
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
                  className="h-2 min-w-[4.5rem] flex-1 cursor-pointer rounded-lg bg-slate-800 sm:w-20 sm:flex-initial"
                />
                <span className="shrink-0 font-mono text-xs text-slate-200 tabular-nums">
                  {teleprompter.scrollSpeed}x
                </span>
              </div>

              <div className="flex items-center gap-1.5">
                <label
                  htmlFor="teleprompter-size-select"
                  className="shrink-0 text-xs font-medium text-slate-300"
                >
                  Size
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
                  className="min-h-9 rounded-lg border border-white/10 bg-slate-900 px-2 py-1 text-xs font-medium text-slate-100 focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-sky-400 sm:min-h-8"
                >
                  <option value="sm">Compact</option>
                  <option value="md">Medium</option>
                  <option value="lg">Large</option>
                </select>
              </div>

              <button
                type="button"
                onClick={toggleTeleprompter}
                className="min-h-9 rounded-lg border border-slate-800 bg-slate-900 px-2.5 py-1 text-xs text-slate-300 hover:bg-slate-800 hover:text-white focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-sky-400 sm:min-h-8"
              >
                Hide
              </button>
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
            className="w-full rounded-lg border border-white/10 bg-slate-900 px-2.5 py-1.5 text-xs leading-relaxed text-slate-100 placeholder:text-slate-400 focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-sky-400"
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

      {/* Dominant Cinema Stage Viewport */}
      <div className="w-full bg-slate-950">
        {/* Docked Eye-Line Teleprompter HUD (never overlaps canvas or PIP handles) */}
        {teleprompter.enabled && (
          <div className="border-b border-sky-400/25 bg-slate-950/95 px-2.5 py-2 min-[375px]:px-3.5 sm:px-4">
            <div
              data-testid="teleprompter-stage-overlay"
              className="mx-auto flex w-full max-w-2xl flex-col rounded-xl border border-sky-400/35 bg-slate-900/90 px-3 py-2 text-slate-100 shadow-lg"
            >
              <div className="flex flex-wrap items-center justify-between gap-2 border-b border-white/[0.08] pb-1">
                <span className="text-[10px] font-semibold tracking-wider text-sky-300 uppercase">
                  Speaker Notes · Not Recorded
                </span>
                <button
                  type="button"
                  data-testid="teleprompter-hud-hide"
                  onClick={toggleTeleprompter}
                  className="min-h-7 rounded px-2 py-0.5 text-[11px] font-semibold text-slate-200 hover:bg-slate-800 hover:text-white focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-sky-300 active:bg-slate-700"
                >
                  Hide (T)
                </button>
              </div>
              <div
                ref={teleprompterViewportRef}
                data-testid="teleprompter-hud-viewport"
                className={`mt-1.5 max-h-24 overflow-y-auto break-words whitespace-pre-wrap leading-relaxed font-medium text-slate-100 sm:max-h-28 ${
                  teleprompter.fontSize === 'lg'
                    ? 'text-sm sm:text-base'
                    : teleprompter.fontSize === 'sm'
                      ? 'text-[11px] sm:text-xs'
                      : 'text-xs sm:text-sm'
                }`}
              >
                {teleprompter.scriptText.trim().length > 0
                  ? teleprompter.scriptText
                  : 'Type or paste your speaker notes above.'}
              </div>
            </div>
          </div>
        )}

        <div
          ref={stageViewportRef}
          data-testid="source-dropzone"
          onDragEnter={handleDragEnter}
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          onDrop={handleDrop}
          className={`relative flex items-center justify-center overflow-hidden bg-slate-950 ${
            isPortraitStage
              ? hasTallStageOverlay
                ? 'mx-auto min-h-[23rem] w-full max-w-[min(92vw,23rem)] border-x border-white/[0.08] py-4 sm:aspect-[9/16] sm:max-h-[72dvh] sm:py-0'
                : 'mx-auto aspect-[9/16] max-h-[70dvh] w-full max-w-[min(82vw,20rem)] border-x border-white/[0.08] sm:max-w-[21rem]'
              : hasTallStageOverlay
                ? 'min-h-[22rem] w-full py-4 md:aspect-video md:min-h-[24rem] md:py-4'
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

          {/* Composed HTML5 Canvas Output (captureStream(30) source; tap to play/pause when idle) */}
          <canvas
            ref={canvasRef}
            data-testid="scene-compositor-canvas"
            role="img"
            aria-label={`Composed scene output (${getLayoutDisplayName(compositorState.layoutMode)}, ${compositorState.width} by ${compositorState.height})`}
            onClick={handleCanvasTapPlayPause}
            onPointerDown={handleCanvasPointerDown}
            onPointerMove={handleCanvasPointerMove}
            onPointerUp={(e) => finishCanvasStroke(e, true)}
            onPointerCancel={(e) => finishCanvasStroke(e, false)}
            className={`absolute inset-0 block h-full w-full object-contain ${
              activeTool !== 'none'
                ? 'touch-none cursor-crosshair'
                : isSourcePlayable
                  ? 'cursor-pointer'
                  : ''
            }`}
          />

          {/* Gentle Mobile Tap-to-Play Hint when video is loaded and paused */}
          {isSourcePlayable &&
            playback.status !== 'playing' &&
            activeTool === 'none' &&
            countdownSecondsRemaining === null && (
              <div
                data-testid="mobile-tap-play-hint"
                aria-hidden="true"
                className="pointer-events-none relative z-10 flex items-center gap-2 rounded-full border border-white/15 bg-slate-950/80 px-4 py-2 text-xs font-semibold text-white shadow-lg backdrop-blur-xs sm:hidden"
              >
                <PlayIcon className="h-3.5 w-3.5 text-sky-300" />
                <span>
                  {playback.sourceMode === 'screen' ? 'Tap to Resume' : 'Tap to Play'}
                </span>
              </div>
            )}

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
                  className={`pointer-events-auto absolute top-0.5 left-0.5 inline-flex touch-none items-center justify-center rounded bg-slate-950/90 text-[11px] font-semibold text-slate-100 shadow cursor-move hover:bg-slate-900 focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-sky-300 md:top-1 md:left-1 ${
                    compositorState.pipRect.width >= 0.24
                      ? 'h-5 w-5 md:h-6 md:w-auto md:px-2 md:py-0.5'
                      : 'h-5 w-5 md:h-6 md:w-6'
                  }`}
                >
                  <MoveQuadArrowsIcon
                    className={
                      compositorState.pipRect.width >= 0.24
                        ? 'h-3 w-3 shrink-0 md:mr-1'
                        : 'h-3 w-3 shrink-0'
                    }
                  />
                  <span
                    className={
                      compositorState.pipRect.width >= 0.24
                        ? 'sr-only md:not-sr-only'
                        : 'sr-only'
                    }
                  >
                    Move PIP
                  </span>
                </button>

                <button
                  type="button"
                  data-testid="pip-resize-handle"
                  title="Drag or use Arrow/+/- keys to resize Picture-in-Picture overlay"
                  onPointerDown={(e) => startPipPointerGesture('resize', e)}
                  onKeyDown={handlePipResizeKeyDown}
                  className="pointer-events-auto absolute right-0.5 bottom-0.5 inline-flex h-5 w-5 touch-none items-center justify-center rounded bg-sky-400 text-slate-950 shadow cursor-nwse-resize hover:bg-sky-300 focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-sky-200 md:right-1 md:bottom-1 md:h-6 md:w-6"
                >
                  <span className="sr-only">Resize PIP</span>
                  <ResizeCornerIcon className="h-3 w-3 md:h-3.5 md:w-3.5" />
                </button>
              </div>
            )}

          {/* Calm, Mild Empty-Stage Welcome Prompt */}
          {showCenteredEmptyPrompt && (
            <div
              data-testid="stage-onboarding-checklist"
              className="relative z-20 mx-3 flex w-full max-w-sm flex-col items-center rounded-2xl border border-slate-800/90 bg-slate-900/90 px-4 py-5 text-center shadow-xl sm:px-6 sm:py-6"
            >
              <span className="mb-3 flex h-10 w-10 items-center justify-center rounded-2xl border border-slate-800 bg-slate-950 text-sky-300">
                <UploadVideoIcon className="h-5 w-5" />
              </span>
              <h3 className="text-sm font-semibold text-white sm:text-base">
                Add a video to react to
              </h3>
              <p className="mt-1 text-xs leading-relaxed text-slate-300">
                Plays privately on your device — nothing is uploaded.
              </p>

              <div className="mt-4 flex w-full flex-wrap items-center justify-center gap-2 sm:w-auto">
                <button
                  type="button"
                  data-testid="select-video-button"
                  onClick={openFilePicker}
                  className="inline-flex min-h-11 w-full items-center justify-center gap-1.5 rounded-xl bg-sky-400 px-5 py-2.5 text-sm font-semibold text-slate-950 hover:bg-sky-300 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky-300 active:bg-sky-500 sm:min-h-10 sm:w-auto sm:px-4 sm:py-2 sm:text-xs"
                >
                  <span>Choose Video</span>
                </button>
                <button
                  type="button"
                  data-testid="share-screen-button"
                  onClick={() => {
                    void startScreenShare();
                  }}
                  className="hidden min-h-10 items-center gap-1.5 rounded-xl border border-slate-700 bg-slate-950 px-3.5 py-2 text-xs font-medium text-slate-200 hover:bg-slate-800 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky-400 sm:inline-flex"
                >
                  <ScreenShareIcon className="h-3.5 w-3.5 shrink-0 text-sky-300" />
                  <span>Share Screen</span>
                </button>
              </div>
            </div>
          )}

          {/* Non-blocking Loading Pill */}
          {playback.status === 'loading' && (
            <div
              role="status"
              data-testid="source-loading-indicator"
              className="pointer-events-none absolute top-2.5 right-2.5 left-2.5 z-20 flex max-w-sm items-center gap-2.5 rounded-xl border border-sky-400/40 bg-slate-950/90 px-3 py-2 text-xs text-slate-100 shadow-lg sm:right-auto"
            >
              <div className="h-4 w-4 shrink-0 animate-spin rounded-full border-2 border-slate-700 border-t-sky-400" />
              <div className="min-w-0">
                <p className="font-medium">Opening your video…</p>
                {playback.pendingFileName && (
                  <p className="break-all text-[11px] text-slate-300 sm:break-words">
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
              className="relative z-20 mx-2.5 flex max-w-lg flex-col items-center rounded-2xl border border-rose-500/40 bg-rose-950/90 p-3.5 text-center shadow-xl sm:mx-4 sm:p-5"
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
                  className="min-h-9 rounded-lg bg-sky-400 px-3 py-1.5 text-xs font-semibold text-slate-950 hover:bg-sky-300 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky-300 active:bg-sky-500"
                >
                  Choose Another Video
                </button>
                <button
                  type="button"
                  data-testid="error-clear-button"
                  onClick={unload}
                  className="min-h-9 rounded-lg border border-white/10 bg-slate-900 px-3 py-1.5 text-xs font-medium text-slate-100 hover:bg-slate-800 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky-400 active:bg-slate-700"
                >
                  Clear
                </button>
              </div>
            </div>
          )}

          {isDraggingFileOver && (
            <div
              data-testid="drag-overlay"
              className="pointer-events-none absolute inset-0 z-30 flex items-center justify-center bg-slate-950/85 p-3 backdrop-blur-xs"
            >
              <div className="rounded-2xl border-2 border-dashed border-sky-400 bg-slate-900/95 px-4 py-3.5 text-center sm:px-5 sm:py-4">
                <p className="text-sm font-semibold text-sky-300">
                  Drop your video to load it on stage
                </p>
                <p className="mt-0.5 text-xs text-slate-300">
                  Plays 100% locally in your browser — zero uploads
                </p>
              </div>
            </div>
          )}

          <StagePreRollOverlay />
        </div>
      </div>

      {/* Contextual Source Media Bar (only shown once stage is active or a video is loaded) */}
      {!showCenteredEmptyPrompt && (
        <div className="flex flex-wrap items-center justify-between gap-2 border-t border-slate-800/80 bg-slate-950/40 px-2.5 py-2 min-[375px]:px-3.5 sm:px-4">
          <div className="flex min-w-0 flex-wrap items-center gap-2 text-xs">
            {playback.metadata ? (
              <div className="flex min-w-0 flex-wrap items-center gap-1.5 text-slate-300">
                {playback.sourceMode === 'screen' && (
                  <span
                    data-testid="live-screen-badge"
                    className="inline-flex items-center gap-1 rounded-full border border-sky-400/35 bg-sky-400/10 px-2 py-0.5 text-[11px] font-medium text-sky-200"
                  >
                    Live Screen
                  </span>
                )}
                <span
                  data-testid="loaded-file-name"
                  className="min-w-0 break-all font-medium text-slate-200 sm:break-words"
                >
                  {playback.metadata.fileName}
                </span>
                <span className="hidden font-mono text-slate-400 sm:inline">
                  {playback.metadata.width}×{playback.metadata.height}
                </span>
                {playback.sourceMode !== 'screen' && (
                  <span className="hidden text-slate-400 sm:inline">
                    · {formatBytes(playback.metadata.fileSizeBytes)}
                  </span>
                )}
              </div>
            ) : (
              <span className="text-slate-400">No video loaded</span>
            )}
          </div>

          <div className="flex flex-wrap items-center gap-1.5">
            {playback.status === 'empty' ? (
              <>
                <button
                  type="button"
                  data-testid="select-video-button"
                  onClick={openFilePicker}
                  className="min-h-9 rounded-lg bg-sky-400 px-3 py-1.5 text-xs font-semibold text-slate-950 hover:bg-sky-300 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky-300 sm:min-h-8 sm:py-1"
                >
                  Choose Video
                </button>
                <button
                  type="button"
                  data-testid="share-screen-button"
                  onClick={() => {
                    void startScreenShare();
                  }}
                  className="hidden min-h-8 items-center gap-1 rounded-lg border border-slate-800 bg-slate-900 px-2.5 py-1 text-xs font-medium text-slate-200 hover:bg-slate-800 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky-400 sm:inline-flex"
                >
                  <ScreenShareIcon className="h-3.5 w-3.5 shrink-0 text-sky-300" />
                  <span>Share Screen</span>
                </button>
              </>
            ) : (
              <>
                <button
                  type="button"
                  data-testid="share-screen-button"
                  onClick={() => {
                    void startScreenShare();
                  }}
                  className="hidden min-h-8 items-center gap-1 rounded-lg border border-slate-800 bg-slate-900 px-2.5 py-1 text-xs text-slate-300 hover:bg-slate-800 hover:text-white focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky-400 sm:inline-flex"
                >
                  <ScreenShareIcon className="h-3.5 w-3.5 shrink-0 text-sky-300" />
                  <span>
                    {playback.sourceMode === 'screen'
                      ? 'Switch Screen'
                      : 'Share Screen'}
                  </span>
                </button>
                <button
                  type="button"
                  data-testid="replace-video-button"
                  onClick={openFilePicker}
                  className="min-h-9 rounded-lg border border-slate-800 bg-slate-900 px-2.5 py-1 text-xs text-slate-300 hover:bg-slate-800 hover:text-white focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky-400 sm:min-h-8"
                >
                  Change Video
                </button>
                <button
                  type="button"
                  data-testid="unload-video-button"
                  onClick={unload}
                  className="min-h-9 rounded-lg border border-slate-800 bg-slate-950 px-2.5 py-1 text-xs text-slate-300 hover:text-rose-200 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky-400 sm:min-h-8"
                >
                  {playback.sourceMode === 'screen' ? 'Stop Share' : 'Remove'}
                </button>
              </>
            )}
          </div>
        </div>
      )}
    </section>
  );
}

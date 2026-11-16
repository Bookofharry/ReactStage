import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ChangeEvent,
} from 'react';
import {
  MAX_PIP_SIZE,
  MAX_SPLIT_RATIO,
  MIN_PIP_SIZE,
  MIN_SPLIT_RATIO,
  clampPipRect,
  type PipCornerPreset,
} from '../services/scene-compositor';
import { useSceneCompositor } from '../state/CompositorContext';
import { useSourcePlayback } from '../state/PlaybackContext';
import { useRecordingSession } from '../state/RecordingSessionContext';
import { useStudioPreferences } from '../state/StudioPreferencesContext';
import { useStudioShortcuts } from '../state/StudioShortcutsContext';
import { useStudioUi } from '../state/StudioUiContext';
import {
  SUPPORTED_SCENE_RESOLUTIONS,
  type PipBorderStyle,
  type PipFrameShape,
  type SceneResolutionPreset,
  type StageLayoutMode,
} from '../types/media';
import {
  BookmarkPresetIcon,
  CameraSnapshotIcon,
  CloseIcon,
  KeyboardIcon,
  LayoutCameraIcon,
  LayoutPipIcon,
  LayoutSourceIcon,
  LayoutSplitIcon,
  LayoutVerticalStackIcon,
  LowerThirdIcon,
  PenToolIcon,
  SlidersTuneIcon,
  TeleprompterIcon,
} from './StudioIcons';

const MODAL_LAYOUT_OPTIONS: readonly {
  readonly mode: StageLayoutMode;
  readonly label: string;
  readonly testId: string;
}[] = [
  { mode: 'pip', label: 'PIP', testId: 'modal-layout-mode-pip' },
  {
    mode: 'side-by-side',
    label: 'Split',
    testId: 'modal-layout-mode-side-by-side',
  },
  {
    mode: 'top-bottom',
    label: 'Shorts',
    testId: 'modal-layout-mode-top-bottom',
  },
  {
    mode: 'source-only',
    label: 'Video Only',
    testId: 'layout-mode-source-only',
  },
  {
    mode: 'camera-only',
    label: 'Cam Only',
    testId: 'layout-mode-camera-only',
  },
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
  { id: 'rect', label: 'Rectangle' },
  { id: 'rounded', label: 'Rounded' },
  { id: 'circle', label: 'Circle' },
];

const PIP_BORDER_OPTIONS: readonly {
  readonly id: PipBorderStyle;
  readonly label: string;
}[] = [
  { id: 'sky', label: 'Soft Blue' },
  { id: 'amber', label: 'Warm Gold' },
  { id: 'emerald', label: 'Soft Green' },
  { id: 'subtle', label: 'Subtle Frame' },
  { id: 'none', label: 'No Border' },
];

function renderLayoutOptionIcon(mode: StageLayoutMode) {
  const cls = 'h-3.5 w-3.5 shrink-0';
  switch (mode) {
    case 'pip':
      return <LayoutPipIcon className={cls} />;
    case 'side-by-side':
      return <LayoutSplitIcon className={cls} />;
    case 'top-bottom':
      return <LayoutVerticalStackIcon className={cls} />;
    case 'source-only':
      return <LayoutSourceIcon className={cls} />;
    case 'camera-only':
      return <LayoutCameraIcon className={cls} />;
  }
}

export function StudioSettingsModal() {
  const {
    isSettingsModalOpen,
    closeSettingsModal,
    isDrawToolbarOpen,
    setIsDrawToolbarOpen,
  } = useStudioUi();
  const { state: playback } = useSourcePlayback();
  const { preRollEnabled, togglePreRoll } = useRecordingSession();
  const { openPresetsModal, snapshot: prefsSnapshot } = useStudioPreferences();
  const { openShortcutsModal } = useStudioShortcuts();
  const {
    state: compositorState,
    activeTool,
    setActiveTool,
    setLayoutMode,
    setResolution,
    setPipRect,
    setPipFrameShape,
    setPipBorderStyle,
    snapPipToCorner,
    resetPipRect,
    setSplitRatio,
    resetSplitRatio,
    toggleLowerThird,
    teleprompter,
    toggleTeleprompter,
    captureSnapshotPng,
    toggleSceneLoop,
  } = useSceneCompositor();

  const closeBtnRef = useRef<HTMLButtonElement | null>(null);
  const snapshotTimerRef = useRef<number | null>(null);
  const [snapshotJustSaved, setSnapshotJustSaved] = useState(false);

  useEffect(() => {
    if (!isSettingsModalOpen) {
      return undefined;
    }
    closeBtnRef.current?.focus();

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        closeSettingsModal();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
    };
  }, [closeSettingsModal, isSettingsModalOpen]);

  useEffect(() => {
    return () => {
      if (snapshotTimerRef.current !== null) {
        window.clearTimeout(snapshotTimerRef.current);
      }
    };
  }, []);

  const handleResolutionChange = useCallback(
    (event: ChangeEvent<HTMLSelectElement>) => {
      setResolution(event.currentTarget.value as SceneResolutionPreset);
    },
    [setResolution],
  );

  const handlePipBorderChange = useCallback(
    (event: ChangeEvent<HTMLSelectElement>) => {
      setPipBorderStyle(event.currentTarget.value as PipBorderStyle);
    },
    [setPipBorderStyle],
  );

  const handlePipSizeSliderChange = useCallback(
    (event: ChangeEvent<HTMLInputElement>) => {
      const nextSize = Number(event.currentTarget.value);
      if (Number.isFinite(nextSize)) {
        setPipRect(
          clampPipRect({
            ...compositorState.pipRect,
            width: nextSize,
            height: nextSize,
          }),
        );
      }
    },
    [compositorState.pipRect, setPipRect],
  );

  const handleSplitSliderChange = useCallback(
    (event: ChangeEvent<HTMLInputElement>) => {
      const nextRatio = Number(event.currentTarget.value);
      if (Number.isFinite(nextRatio)) {
        setSplitRatio(nextRatio);
      }
    },
    [setSplitRatio],
  );

  const handleToggleDraw = useCallback(() => {
    const currentlyDrawing = isDrawToolbarOpen || activeTool !== 'none';
    if (currentlyDrawing) {
      setActiveTool('none');
      setIsDrawToolbarOpen(false);
    } else {
      setIsDrawToolbarOpen(true);
      setActiveTool('pen');
      closeSettingsModal();
    }
  }, [activeTool, closeSettingsModal, isDrawToolbarOpen, setActiveTool, setIsDrawToolbarOpen]);

  const handleSnapshot = useCallback(async () => {
    const saved = await captureSnapshotPng(playback.metadata?.fileName ?? null);
    if (saved) {
      setSnapshotJustSaved(true);
      if (snapshotTimerRef.current !== null) {
        window.clearTimeout(snapshotTimerRef.current);
      }
      snapshotTimerRef.current = window.setTimeout(() => {
        setSnapshotJustSaved(false);
      }, 1800);
    }
  }, [captureSnapshotPng, playback.metadata?.fileName]);

  if (!isSettingsModalOpen) {
    return null;
  }

  const pipXPercent = Math.round(compositorState.pipRect.x * 100);
  const pipYPercent = Math.round(compositorState.pipRect.y * 100);
  const pipSizePercent = Math.round(compositorState.pipRect.width * 100);
  const splitLeftPercent = Math.round(compositorState.splitRatio * 100);
  const splitRightPercent = 100 - splitLeftPercent;
  const isDrawingActive =
    isDrawToolbarOpen ||
    activeTool !== 'none' ||
    compositorState.annotationCount > 0;

  return (
    <div
      data-testid="studio-settings-backdrop"
      className="fixed inset-0 z-50 flex items-center justify-center p-2.5 sm:p-4"
    >
      <button
        type="button"
        tabIndex={-1}
        aria-label="Close settings dialog backdrop"
        onClick={closeSettingsModal}
        className="fixed inset-0 cursor-default bg-slate-950/75 backdrop-blur-xs"
      />

      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="studio-settings-modal-title"
        data-testid="studio-settings-modal"
        className="relative z-10 flex max-h-[90dvh] w-full max-w-xl flex-col overflow-hidden rounded-2xl border border-slate-800 bg-slate-900 text-slate-100 shadow-2xl"
      >
        {/* Header */}
        <div className="flex items-start justify-between gap-3 border-b border-slate-800 px-4 py-3.5 sm:items-center sm:px-5">
          <div className="flex min-w-0 items-center gap-2.5">
            <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl border border-slate-700 bg-slate-800/80 text-sky-300">
              <SlidersTuneIcon className="h-4 w-4" />
            </span>
            <div className="min-w-0">
              <h2
                id="studio-settings-modal-title"
                className="text-sm font-semibold text-white sm:text-base"
              >
                Settings &amp; Extra Tools
              </h2>
              <p className="text-xs text-slate-300">
                Video quality, layout styling, overlays, and saved presets
              </p>
            </div>
          </div>

          <button
            ref={closeBtnRef}
            type="button"
            data-testid="close-settings-modal-button"
            aria-label="Close settings dialog"
            onClick={closeSettingsModal}
            className="inline-flex min-h-9 min-w-9 shrink-0 items-center justify-center rounded-xl border border-slate-700/80 bg-slate-800/80 text-slate-200 hover:bg-slate-800 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky-400"
          >
            <CloseIcon className="h-4 w-4" />
          </button>
        </div>

        {/* Scrollable Content */}
        <div className="flex flex-col gap-4 overflow-y-auto p-4 sm:p-5">
          {/* 1. Video Quality & Layout Modes */}
          <section className="flex flex-col gap-3 rounded-xl border border-slate-800 bg-slate-950/60 p-3.5">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h3 className="text-xs font-semibold text-slate-200">
                Layout &amp; Video Quality
              </h3>
              <div className="flex min-w-0 flex-wrap items-center gap-2">
                <label
                  htmlFor="scene-resolution-select"
                  className="text-xs text-slate-300"
                >
                  Format
                </label>
                <select
                  id="scene-resolution-select"
                  data-testid="scene-resolution-select"
                  value={compositorState.resolutionPreset}
                  onChange={handleResolutionChange}
                  className="min-h-9 max-w-full rounded-lg border border-slate-700 bg-slate-900 px-2.5 py-1 text-xs font-medium text-slate-100 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky-400"
                >
                  {SUPPORTED_SCENE_RESOLUTIONS.map((option) => (
                    <option key={option.id} value={option.id}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            {/* All 5 Layout Modes (including Video Only & Cam Only) */}
            <div
              role="group"
              aria-label="All stage layout modes"
              className="flex flex-wrap items-center gap-1.5"
            >
              {MODAL_LAYOUT_OPTIONS.map((item) => {
                const isSelected = compositorState.layoutMode === item.mode;
                return (
                  <button
                    key={item.mode}
                    type="button"
                    data-testid={item.testId}
                    aria-pressed={isSelected}
                    onClick={() => setLayoutMode(item.mode)}
                    className={
                      isSelected
                        ? 'inline-flex min-h-9 items-center gap-1.5 rounded-lg border border-sky-400/45 bg-sky-400/15 px-3 py-1.5 text-xs font-semibold text-sky-200 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky-300'
                        : 'inline-flex min-h-9 items-center gap-1.5 rounded-lg border border-slate-800 bg-slate-900 px-3 py-1.5 text-xs font-medium text-slate-200 hover:bg-slate-800 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky-400'
                    }
                  >
                    {renderLayoutOptionIcon(item.mode)}
                    <span>{item.label}</span>
                  </button>
                );
              })}
            </div>

            {/* PIP Fine-Tuning Controls */}
            {compositorState.layoutMode === 'pip' && (
              <div
                data-testid="pip-controls-bar"
                className="flex flex-col gap-2.5 rounded-xl border border-slate-800/90 bg-slate-900/70 p-3"
              >
                <div className="flex flex-wrap items-center gap-1.5">
                  <span className="mr-1 text-xs text-slate-300">Position:</span>
                  {PIP_CORNER_OPTIONS.map((corner) => (
                    <button
                      key={corner.id}
                      type="button"
                      data-testid={`pip-corner-${corner.id}`}
                      onClick={() => snapPipToCorner(corner.id)}
                      className="min-h-8 rounded-lg border border-slate-700/80 bg-slate-950 px-2.5 py-1 text-xs text-slate-200 hover:bg-slate-800 focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-sky-400"
                    >
                      {corner.label}
                    </button>
                  ))}
                  <button
                    type="button"
                    data-testid="pip-reset-button"
                    onClick={resetPipRect}
                    className="min-h-8 rounded-lg border border-slate-700/80 bg-slate-800 px-2.5 py-1 text-xs font-medium text-sky-300 hover:bg-slate-700 focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-sky-400"
                  >
                    Reset PIP
                  </button>
                </div>

                <div className="flex flex-wrap items-center gap-2">
                  <div
                    role="group"
                    aria-label="PIP webcam shape"
                    className="flex flex-wrap items-center gap-1"
                  >
                    {PIP_SHAPE_OPTIONS.map((shape) => {
                      const isSelected =
                        compositorState.pipFrameShape === shape.id;
                      return (
                        <button
                          key={shape.id}
                          type="button"
                          data-testid={`pip-shape-${shape.id}`}
                          aria-pressed={isSelected}
                          onClick={() => setPipFrameShape(shape.id)}
                          className={
                            isSelected
                              ? 'min-h-8 rounded-lg border border-sky-400/45 bg-sky-400/15 px-2.5 py-1 text-xs font-semibold text-sky-200 focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-sky-300'
                              : 'min-h-8 rounded-lg border border-slate-700/80 bg-slate-950 px-2.5 py-1 text-xs text-slate-200 hover:bg-slate-800 focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-sky-400'
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
                    className="min-h-8 rounded-lg border border-slate-700 bg-slate-950 px-2 py-1 text-xs text-slate-100 focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-sky-400"
                  >
                    {PIP_BORDER_OPTIONS.map((opt) => (
                      <option key={opt.id} value={opt.id}>
                        {opt.label}
                      </option>
                    ))}
                  </select>
                </div>

                <div className="flex flex-wrap items-center gap-2">
                  <label
                    htmlFor="pip-size-slider"
                    className="shrink-0 text-xs text-slate-300"
                  >
                    Camera Size
                  </label>
                  <input
                    id="pip-size-slider"
                    data-testid="pip-size-slider"
                    type="range"
                    min={MIN_PIP_SIZE}
                    max={MAX_PIP_SIZE}
                    step={0.01}
                    value={compositorState.pipRect.width}
                    aria-valuetext={`${String(pipSizePercent)} percent of scene width`}
                    onChange={handlePipSizeSliderChange}
                    className="h-2 min-w-[6rem] flex-1 cursor-pointer rounded-lg bg-slate-800"
                  />
                  <span
                    data-testid="pip-metrics-readout"
                    className="font-mono text-xs text-slate-300 tabular-nums"
                  >
                    X:{pipXPercent}% Y:{pipYPercent}% · {pipSizePercent}%
                  </span>
                </div>
              </div>
            )}

            {/* Split / Shorts Balance Controls */}
            {(compositorState.layoutMode === 'side-by-side' ||
              compositorState.layoutMode === 'top-bottom') && (
              <div
                data-testid="split-controls-bar"
                className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-slate-800/90 bg-slate-900/70 p-3"
              >
                <div className="flex min-w-0 flex-1 flex-wrap items-center gap-2">
                  <label
                    htmlFor="split-ratio-slider"
                    className="shrink-0 text-xs text-slate-300"
                  >
                    Split Balance
                  </label>
                  <input
                    id="split-ratio-slider"
                    data-testid="split-ratio-slider"
                    type="range"
                    min={MIN_SPLIT_RATIO}
                    max={MAX_SPLIT_RATIO}
                    step={0.01}
                    value={compositorState.splitRatio}
                    aria-valuetext={`${String(splitLeftPercent)} percent source video, ${String(splitRightPercent)} percent webcam`}
                    onChange={handleSplitSliderChange}
                    className="h-2 min-w-[6rem] flex-1 cursor-pointer rounded-lg bg-slate-800"
                  />
                  <span
                    data-testid="split-ratio-readout"
                    className="font-mono text-xs text-slate-200 tabular-nums"
                  >
                    {compositorState.layoutMode === 'top-bottom'
                      ? `${String(splitLeftPercent)}% Top Source / ${String(splitRightPercent)}% Bottom Webcam`
                      : `${String(splitLeftPercent)}% Source / ${String(splitRightPercent)}% Webcam`}
                  </span>
                </div>

                <button
                  type="button"
                  data-testid="reset-split-button"
                  onClick={resetSplitRatio}
                  className="min-h-8 rounded-lg border border-slate-700/80 bg-slate-800 px-2.5 py-1 text-xs font-medium text-sky-300 hover:bg-slate-700 focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-sky-400"
                >
                  Reset Split
                </button>
              </div>
            )}
          </section>

          {/* 2. On-Screen Creative Tools */}
          <section className="flex flex-col gap-2.5 rounded-xl border border-slate-800 bg-slate-950/60 p-3.5">
            <h3 className="text-xs font-semibold text-slate-200">
              On-Screen Tools
            </h3>

            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              <button
                type="button"
                data-testid="toggle-draw-tools-button"
                aria-pressed={isDrawingActive}
                onClick={handleToggleDraw}
                className={
                  isDrawingActive
                    ? 'flex min-h-11 items-center justify-between gap-2 rounded-xl border border-sky-400/45 bg-sky-400/15 px-3 py-2 text-left text-xs font-semibold text-sky-200 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky-300'
                    : 'flex min-h-11 items-center justify-between gap-2 rounded-xl border border-slate-800 bg-slate-900 px-3 py-2 text-left text-xs font-medium text-slate-200 hover:bg-slate-800 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky-400'
                }
              >
                <span className="flex items-center gap-2">
                  <PenToolIcon className="h-4 w-4 shrink-0 text-sky-300" />
                  <span>Draw on Video</span>
                </span>
                <span className="text-[11px] text-slate-300">
                  {isDrawingActive ? 'On' : 'Off'}
                </span>
              </button>

              <button
                type="button"
                data-testid="lower-third-toggle-button"
                aria-pressed={compositorState.lowerThird.enabled}
                onClick={toggleLowerThird}
                className={
                  compositorState.lowerThird.enabled
                    ? 'flex min-h-11 items-center justify-between gap-2 rounded-xl border border-sky-400/45 bg-sky-400/15 px-3 py-2 text-left text-xs font-semibold text-sky-200 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky-300'
                    : 'flex min-h-11 items-center justify-between gap-2 rounded-xl border border-slate-800 bg-slate-900 px-3 py-2 text-left text-xs font-medium text-slate-200 hover:bg-slate-800 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky-400'
                }
              >
                <span className="flex items-center gap-2">
                  <LowerThirdIcon className="h-4 w-4 shrink-0 text-sky-300" />
                  <span>Title Banner</span>
                </span>
                <span className="text-[11px] text-slate-300">
                  {compositorState.lowerThird.enabled ? 'Shown' : 'Hidden'}
                </span>
              </button>

              <button
                type="button"
                data-testid="teleprompter-toggle-button"
                aria-pressed={teleprompter.enabled}
                onClick={toggleTeleprompter}
                className={
                  teleprompter.enabled
                    ? 'flex min-h-11 items-center justify-between gap-2 rounded-xl border border-sky-400/45 bg-sky-400/15 px-3 py-2 text-left text-xs font-semibold text-sky-200 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky-300'
                    : 'flex min-h-11 items-center justify-between gap-2 rounded-xl border border-slate-800 bg-slate-900 px-3 py-2 text-left text-xs font-medium text-slate-200 hover:bg-slate-800 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky-400'
                }
              >
                <span className="flex items-center gap-2">
                  <TeleprompterIcon className="h-4 w-4 shrink-0 text-sky-300" />
                  <span>Speaker Notes</span>
                </span>
                <span className="text-[11px] text-slate-300">
                  {teleprompter.enabled ? 'Shown' : 'Hidden'}
                </span>
              </button>

              <button
                type="button"
                data-testid="capture-snapshot-button"
                onClick={() => {
                  void handleSnapshot();
                }}
                className={
                  snapshotJustSaved
                    ? 'flex min-h-11 items-center justify-between gap-2 rounded-xl border border-emerald-400/45 bg-emerald-400/15 px-3 py-2 text-left text-xs font-semibold text-emerald-200 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-300'
                    : 'flex min-h-11 items-center justify-between gap-2 rounded-xl border border-slate-800 bg-slate-900 px-3 py-2 text-left text-xs font-medium text-slate-200 hover:bg-slate-800 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky-400'
                }
              >
                <span className="flex items-center gap-2">
                  <CameraSnapshotIcon className="h-4 w-4 shrink-0 text-sky-300" />
                  <span>{snapshotJustSaved ? 'Saved PNG!' : 'Save PNG Frame'}</span>
                </span>
                <span className="text-[11px] text-slate-300">.png</span>
              </button>
            </div>
          </section>

          {/* 3. Studio Preferences, Presets & Shortcuts */}
          <section className="flex flex-col gap-2.5 rounded-xl border border-slate-800 bg-slate-950/60 p-3.5">
            <h3 className="text-xs font-semibold text-slate-200">
              Recording &amp; Studio Preferences
            </h3>

            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              <button
                type="button"
                data-testid="preroll-countdown-toggle"
                aria-pressed={preRollEnabled}
                onClick={togglePreRoll}
                className={
                  preRollEnabled
                    ? 'flex min-h-10 items-center justify-between gap-2 rounded-xl border border-sky-400/45 bg-sky-400/15 px-3 py-2 text-xs font-semibold text-sky-200 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky-300'
                    : 'flex min-h-10 items-center justify-between gap-2 rounded-xl border border-slate-800 bg-slate-900 px-3 py-2 text-xs font-medium text-slate-200 hover:bg-slate-800 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky-400'
                }
              >
                <span>3-Second Count-In</span>
                <span className="text-[11px] text-slate-300">
                  {preRollEnabled ? 'On' : 'Off'}
                </span>
              </button>

              <button
                type="button"
                data-testid="scene-loop-toggle-button"
                aria-pressed={!compositorState.isRunning}
                onClick={toggleSceneLoop}
                className={
                  compositorState.isRunning
                    ? 'flex min-h-10 items-center justify-center rounded-xl border border-slate-800 bg-slate-900 px-3 py-2 text-xs font-medium text-slate-200 hover:bg-slate-800 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky-400'
                    : 'flex min-h-10 items-center justify-center rounded-xl border border-emerald-400/45 bg-emerald-400/15 px-3 py-2 text-xs font-semibold text-emerald-200 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-300'
                }
              >
                {compositorState.isRunning ? 'Pause Stage' : 'Resume Stage'}
              </button>

              <button
                type="button"
                data-testid="open-presets-modal-button"
                onClick={() => {
                  closeSettingsModal();
                  openPresetsModal();
                }}
                className="flex min-h-10 items-center justify-between gap-2 rounded-xl border border-slate-800 bg-slate-900 px-3 py-2 text-xs font-medium text-slate-200 hover:bg-slate-800 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky-400"
              >
                <span className="flex items-center gap-2">
                  <BookmarkPresetIcon className="h-3.5 w-3.5 text-sky-300" />
                  <span>Saved Presets</span>
                </span>
                {prefsSnapshot.customPresets.length > 0 && (
                  <span
                    data-testid="header-presets-count"
                    className="rounded-full bg-slate-800 px-2 py-0.5 font-mono text-[10px] text-sky-300 tabular-nums"
                  >
                    {prefsSnapshot.customPresets.length}
                  </span>
                )}
              </button>

              <button
                type="button"
                data-testid="open-shortcuts-modal-button"
                onClick={() => {
                  closeSettingsModal();
                  openShortcutsModal();
                }}
                className="flex min-h-10 items-center justify-between gap-2 rounded-xl border border-slate-800 bg-slate-900 px-3 py-2 text-xs font-medium text-slate-200 hover:bg-slate-800 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky-400"
              >
                <span className="flex items-center gap-2">
                  <KeyboardIcon className="h-3.5 w-3.5 text-sky-300" />
                  <span>Keyboard Shortcuts</span>
                </span>
                <kbd
                  aria-hidden="true"
                  className="rounded border border-slate-700 bg-slate-950 px-1.5 py-0.5 font-mono text-[10px] text-slate-300"
                >
                  ?
                </kbd>
              </button>
            </div>
          </section>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end border-t border-slate-800 px-4 py-3 sm:px-5">
          <button
            type="button"
            onClick={closeSettingsModal}
            className="inline-flex min-h-9 items-center justify-center rounded-xl bg-slate-800 px-4 py-1.5 text-xs font-semibold text-white hover:bg-slate-700 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky-400"
          >
            Done
          </button>
        </div>
      </div>
    </div>
  );
}

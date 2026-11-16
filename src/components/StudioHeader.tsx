import { useLayoutEffect, useRef } from 'react';
import { useSceneCompositor } from '../state/CompositorContext';
import { useSourcePlayback } from '../state/PlaybackContext';
import { usePwaStatus } from '../state/PwaContext';
import {
  useRecordingSession,
  useRecordingTelemetry,
} from '../state/RecordingSessionContext';
import { useStudioUi } from '../state/StudioUiContext';
import type { RecordingLifecycleStatus } from '../types/media';
import { formatTimecode } from '../utils/format';
import { InstallAppIcon, SlidersTuneIcon, StageLogoIcon } from './StudioIcons';

function getHeaderStatusLabel(
  status: RecordingLifecycleStatus,
  countdownSecondsRemaining: number | null,
): string {
  if (countdownSecondsRemaining !== null) {
    return `${String(countdownSecondsRemaining)}s…`;
  }
  switch (status) {
    case 'recording':
      return 'REC';
    case 'paused':
      return 'Paused';
    case 'completed':
      return 'Ready';
    case 'error':
      return 'Error';
    default:
      return 'Standby';
  }
}

function HeaderRecordingStatus() {
  const { countdownSecondsRemaining } = useRecordingSession();
  const telemetry = useRecordingTelemetry();
  const recordingTimeLabel = formatTimecode(
    telemetry.elapsedRecordingMs / 1000,
    true,
  );
  const statusLabel = getHeaderStatusLabel(
    telemetry.status,
    countdownSecondsRemaining,
  );
  const isVisuallyActive =
    countdownSecondsRemaining !== null ||
    telemetry.status === 'recording' ||
    telemetry.status === 'paused';

  return (
    <div
      aria-label="Recording session clock"
      className={
        isVisuallyActive
          ? 'inline-flex items-center gap-1.5 rounded-full border border-rose-400/35 bg-rose-500/15 px-2.5 py-1 text-xs text-rose-200'
          : 'sr-only'
      }
    >
      <span
        aria-hidden="true"
        className="h-2 w-2 shrink-0 animate-pulse rounded-full bg-rose-400"
      />
      <span
        data-testid="header-recording-status"
        className="font-semibold"
      >
        {statusLabel}
      </span>
      <span
        data-testid="header-recording-time"
        className="font-mono tabular-nums"
      >
        {recordingTimeLabel}
      </span>
    </div>
  );
}

export function StudioHeader() {
  const { state: playback } = useSourcePlayback();
  const { isOffline, canInstall, promptInstall } = usePwaStatus();
  const { state: compositorState, teleprompter, activeTool } =
    useSceneCompositor();
  const { openSettingsModal, isDrawToolbarOpen } = useStudioUi();
  const headerRef = useRef<HTMLElement | null>(null);
  const spacerRef = useRef<HTMLDivElement | null>(null);

  const hasActiveExtraTool =
    isDrawToolbarOpen ||
    activeTool !== 'none' ||
    compositorState.lowerThird.enabled ||
    teleprompter.enabled ||
    compositorState.layoutMode === 'source-only' ||
    compositorState.layoutMode === 'camera-only';

  useLayoutEffect(() => {
    const el = headerRef.current;
    if (!el) {
      return undefined;
    }

    const syncHeight = () => {
      const measured = Math.ceil(el.getBoundingClientRect().height);
      if (measured > 0) {
        if (spacerRef.current) {
          spacerRef.current.style.height = `${String(measured)}px`;
        }
        document.documentElement.style.setProperty(
          '--studio-header-height',
          `${String(measured)}px`,
        );
        document.documentElement.style.setProperty(
          '--studio-header-offset',
          `${String(measured + 16)}px`,
        );
      }
    };

    syncHeight();

    const ResizeObserverCtor = (window as Partial<typeof window>).ResizeObserver;
    const observer = ResizeObserverCtor
      ? new ResizeObserverCtor(() => {
          syncHeight();
        })
      : null;
    observer?.observe(el);
    window.addEventListener('resize', syncHeight);

    return () => {
      observer?.disconnect();
      window.removeEventListener('resize', syncHeight);
    };
  }, [canInstall, isOffline]);

  const sourceTimeLabel =
    playback.sourceMode === 'screen'
      ? playback.status === 'paused'
        ? 'Live (Frozen)'
        : 'Live Screen'
      : `${formatTimecode(playback.currentTimeSec, true)} / ${formatTimecode(playback.durationSec, true)}`;

  return (
    <>
      <header
        ref={headerRef}
        data-testid="studio-header"
        className="fixed inset-x-0 top-0 z-40 w-full border-b border-slate-800/80 bg-slate-950/90 backdrop-blur-md"
      >
        <a
          href="#studio-main"
          className="sr-only focus:not-sr-only focus:fixed focus:top-3 focus:left-3 focus:z-50 focus:rounded-lg focus:bg-sky-400 focus:px-4 focus:py-2 focus:font-semibold focus:text-slate-950"
        >
          Skip to studio workspace
        </a>

        {/* Screen-reader source playback clock */}
        <span data-testid="header-source-time" className="sr-only">
          {sourceTimeLabel}
        </span>

        <div className="mx-auto flex w-full max-w-[92rem] items-center justify-between gap-2 px-2.5 py-2 min-[375px]:px-3.5 sm:px-5 lg:px-6 xl:px-8">
          <div className="flex min-w-0 items-center gap-2.5">
            <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl border border-slate-800 bg-slate-900 text-sky-300">
              <StageLogoIcon className="h-4 w-4" />
            </span>
            <div className="flex min-w-0 flex-wrap items-center gap-2">
              <h1 className="text-sm font-semibold tracking-tight text-white sm:text-base">
                ReactStage
              </h1>
              <span className="hidden text-xs text-slate-400 sm:inline">
                · Private video studio
              </span>
              {isOffline && (
                <span
                  data-testid="header-offline-badge"
                  role="status"
                  className="rounded-full border border-slate-700 bg-slate-900 px-2 py-0.5 text-[11px] font-medium text-sky-300"
                >
                  Offline Ready
                </span>
              )}
            </div>
          </div>

          <div className="flex shrink-0 items-center gap-2">
            <HeaderRecordingStatus />

            {canInstall && (
              <button
                type="button"
                data-testid="install-pwa-button"
                aria-label="Install App"
                onClick={() => {
                  void promptInstall();
                }}
                className="inline-flex min-h-9 items-center gap-1.5 rounded-xl border border-slate-700 bg-slate-900 px-2.5 py-1.5 text-xs font-medium text-slate-100 hover:bg-slate-800 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky-400"
              >
                <InstallAppIcon className="h-3.5 w-3.5 text-sky-300" />
                <span className="hidden min-[420px]:inline">Install App</span>
              </button>
            )}

            <button
              type="button"
              data-testid="open-settings-modal-button"
              onClick={openSettingsModal}
              className="inline-flex min-h-9 items-center gap-1.5 rounded-xl border border-slate-800 bg-slate-900 px-3 py-1.5 text-xs font-medium text-slate-200 transition hover:border-slate-700 hover:bg-slate-800 hover:text-white focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky-400"
            >
              <SlidersTuneIcon className="h-3.5 w-3.5 shrink-0 text-sky-300" />
              <span>
                <span className="min-[420px]:hidden">Tools</span>
                <span className="hidden min-[420px]:inline">
                  Settings &amp; Tools
                </span>
              </span>
              {hasActiveExtraTool && (
                <span
                  aria-hidden="true"
                  className="h-1.5 w-1.5 rounded-full bg-sky-400"
                />
              )}
            </button>
          </div>
        </div>
      </header>
      <div
        ref={spacerRef}
        data-testid="studio-header-spacer"
        aria-hidden="true"
        className="h-[var(--studio-header-height,3.25rem)] w-full shrink-0"
      />
    </>
  );
}

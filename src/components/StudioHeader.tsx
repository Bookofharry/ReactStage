import { useSourcePlayback } from '../state/PlaybackContext';
import { usePwaStatus } from '../state/PwaContext';
import {
  useRecordingSession,
  useRecordingTelemetry,
} from '../state/RecordingSessionContext';
import { useStudioPreferences } from '../state/StudioPreferencesContext';
import { useStudioShortcuts } from '../state/StudioShortcutsContext';
import type { RecordingLifecycleStatus } from '../types/media';
import { formatTimecode } from '../utils/format';
import {
  BookmarkPresetIcon,
  InstallAppIcon,
  KeyboardIcon,
  StageLogoIcon,
} from './StudioIcons';

function getHeaderRecPill(
  status: RecordingLifecycleStatus,
  countdownSecondsRemaining: number | null,
): {
  readonly label: string;
  readonly classes: string;
} {
  if (countdownSecondsRemaining !== null) {
    return {
      label: `${String(countdownSecondsRemaining)}s…`,
      classes: 'bg-sky-400/20 text-sky-200 border border-sky-400/40',
    };
  }
  switch (status) {
    case 'recording':
      return {
        label: 'REC',
        classes: 'bg-rose-500/25 text-rose-200 border border-rose-400/40',
      };
    case 'paused':
      return {
        label: 'Paused',
        classes: 'bg-amber-400/15 text-amber-300 border border-amber-400/35',
      };
    case 'completed':
      return {
        label: 'Ready',
        classes:
          'bg-emerald-400/15 text-emerald-300 border border-emerald-400/35',
      };
    case 'error':
      return {
        label: 'Error',
        classes: 'bg-rose-500/20 text-rose-300 border border-rose-400/35',
      };
    default:
      return {
        label: 'Standby',
        classes: 'bg-slate-800/90 text-slate-300 border border-white/10',
      };
  }
}

function HeaderRecordingClock() {
  const { countdownSecondsRemaining } = useRecordingSession();
  const telemetry = useRecordingTelemetry();
  const recordingTimeLabel = formatTimecode(
    telemetry.elapsedRecordingMs / 1000,
    true,
  );
  const pill = getHeaderRecPill(telemetry.status, countdownSecondsRemaining);

  return (
    <div
      className="flex min-w-0 items-center justify-between gap-2 rounded-xl border border-white/[0.08] bg-slate-900/80 px-2.5 py-1.5 sm:justify-start sm:px-3"
      aria-label="Recording session clock"
    >
      <div className="flex items-center gap-1.5">
        <span
          aria-hidden="true"
          className={`h-2 w-2 shrink-0 rounded-full ${
            telemetry.status === 'recording'
              ? 'animate-pulse bg-rose-400'
              : 'bg-amber-300/80'
          }`}
        />
        <span className="text-[11px] font-medium text-slate-300">Rec</span>
        <span
          data-testid="header-recording-time"
          className="font-mono text-xs font-semibold text-slate-100 tabular-nums"
        >
          {recordingTimeLabel}
        </span>
      </div>
      <span
        data-testid="header-recording-status"
        className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${pill.classes}`}
      >
        {pill.label}
      </span>
    </div>
  );
}

export function StudioHeader() {
  const { state: playback } = useSourcePlayback();
  const { isOffline, canInstall, promptInstall } = usePwaStatus();
  const { openPresetsModal, snapshot: prefsSnapshot } = useStudioPreferences();
  const { openShortcutsModal } = useStudioShortcuts();
  const sourceTimeLabel =
    playback.sourceMode === 'screen'
      ? playback.status === 'paused'
        ? 'Live (Frozen)'
        : 'Live Screen'
      : `${formatTimecode(playback.currentTimeSec, true)} / ${formatTimecode(playback.durationSec, true)}`;

  return (
    <header className="w-full border-b border-white/[0.07] bg-slate-950/80 backdrop-blur-xl">
      <a
        href="#studio-main"
        className="sr-only focus:not-sr-only focus:fixed focus:top-3 focus:left-3 focus:z-50 focus:rounded-lg focus:bg-sky-400 focus:px-4 focus:py-2 focus:font-semibold focus:text-slate-950"
      >
        Skip to studio workspace
      </a>

      <div className="mx-auto flex w-full max-w-[96rem] flex-col gap-2 px-2.5 py-2.5 min-[375px]:px-3.5 sm:flex-row sm:flex-wrap sm:items-center sm:justify-between sm:gap-3 sm:px-5 lg:px-6 xl:px-8">
        <div className="flex min-w-0 items-center justify-between gap-2">
          <div className="flex min-w-0 items-center gap-2.5">
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-sky-400/35 bg-gradient-to-br from-sky-400/20 to-indigo-500/15 text-sky-300 shadow-inner">
              <StageLogoIcon className="h-5 w-5" />
            </span>
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-1.5 sm:gap-2">
                <h1 className="text-[clamp(1rem,2.2vw,1.15rem)] leading-tight font-bold tracking-tight text-white">
                  ReactStage
                </h1>
                <span className="rounded-full border border-emerald-400/30 bg-emerald-400/10 px-2 py-0.5 text-[11px] font-medium text-emerald-300">
                  100% Private
                </span>
                {isOffline && (
                  <span
                    data-testid="header-offline-badge"
                    role="status"
                    className="rounded-full border border-sky-400/40 bg-sky-400/15 px-2 py-0.5 text-[11px] font-semibold text-sky-200"
                  >
                    Offline Ready
                  </span>
                )}
              </div>
              <p className="hidden text-[11px] leading-snug text-slate-300 md:block">
                Creator video reaction studio
              </p>
            </div>
          </div>

          <div className="flex shrink-0 items-center gap-1.5 sm:hidden">
            <button
              type="button"
              data-testid="open-presets-modal-button-mobile"
              aria-label="Open studio presets"
              onClick={openPresetsModal}
              className="inline-flex min-h-10 min-w-10 items-center justify-center rounded-xl border border-white/10 bg-slate-900/90 px-2.5 py-2 text-xs font-medium text-slate-200 hover:bg-slate-800 active:bg-slate-800 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky-300"
            >
              <BookmarkPresetIcon className="h-4 w-4 text-sky-300" />
            </button>

            <button
              type="button"
              data-testid="open-shortcuts-modal-button-mobile"
              aria-label="Open keyboard shortcuts reference"
              onClick={openShortcutsModal}
              className="inline-flex min-h-10 min-w-10 items-center justify-center gap-1 rounded-xl border border-white/10 bg-slate-900/90 px-2.5 py-2 text-xs font-medium text-slate-200 hover:bg-slate-800 active:bg-slate-800 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky-300"
            >
              <KeyboardIcon className="h-4 w-4 text-sky-300" />
              <kbd
                aria-hidden="true"
                className="font-mono text-[11px] font-semibold text-sky-300"
              >
                ?
              </kbd>
            </button>
          </div>
        </div>

        <div className="flex min-w-0 flex-wrap items-center gap-2">
          <div
            className="grid min-w-0 flex-1 grid-cols-1 gap-1.5 min-[380px]:grid-cols-2 sm:flex sm:flex-initial sm:items-center sm:gap-2"
            role="group"
            aria-label="Independent studio clocks"
          >
            <div
              className="flex min-w-0 items-center justify-between gap-2 rounded-xl border border-white/[0.08] bg-slate-900/80 px-2.5 py-1.5 sm:justify-start sm:px-3"
              aria-label="Source playback clock"
            >
              <span className="text-[11px] font-medium text-sky-300">
                Video
              </span>
              <span
                data-testid="header-source-time"
                className="font-mono text-xs font-semibold text-slate-100 tabular-nums"
              >
                {sourceTimeLabel}
              </span>
            </div>

            <HeaderRecordingClock />
          </div>

          {canInstall && (
            <button
              type="button"
              data-testid="install-pwa-button"
              onClick={() => {
                void promptInstall();
              }}
              className="inline-flex min-h-10 items-center gap-1.5 rounded-xl bg-sky-400 px-3 py-2 text-xs font-semibold text-slate-950 shadow-sm hover:bg-sky-300 active:bg-sky-500 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky-300"
            >
              <InstallAppIcon className="h-4 w-4" />
              <span>Install App</span>
            </button>
          )}

          <button
            type="button"
            data-testid="open-presets-modal-button"
            onClick={openPresetsModal}
            className="hidden min-h-10 items-center gap-1.5 rounded-xl border border-white/10 bg-slate-900/80 px-3 py-2 text-xs font-medium text-slate-200 transition hover:bg-slate-800 active:bg-slate-800 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky-300 sm:inline-flex"
          >
            <BookmarkPresetIcon className="h-4 w-4 text-sky-300" />
            <span>Presets</span>
            {prefsSnapshot.customPresets.length > 0 && (
              <span
                data-testid="header-presets-count"
                className="rounded-full border border-white/10 bg-slate-950 px-1.5 py-0.5 font-mono text-[10px] font-semibold text-sky-300 tabular-nums"
              >
                {prefsSnapshot.customPresets.length}
              </span>
            )}
          </button>

          <button
            type="button"
            data-testid="open-shortcuts-modal-button"
            onClick={openShortcutsModal}
            className="hidden min-h-10 items-center gap-1.5 rounded-xl border border-white/10 bg-slate-900/80 px-3 py-2 text-xs font-medium text-slate-200 transition hover:bg-slate-800 active:bg-slate-800 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky-300 sm:inline-flex"
          >
            <KeyboardIcon className="h-4 w-4 text-sky-300" />
            <span>Shortcuts</span>
            <kbd
              aria-hidden="true"
              className="rounded border border-white/10 bg-slate-950 px-1.5 py-0.5 font-mono text-[10px] font-semibold text-sky-300"
            >
              ?
            </kbd>
          </button>
        </div>
      </div>
    </header>
  );
}

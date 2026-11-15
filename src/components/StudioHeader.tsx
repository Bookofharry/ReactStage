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
      label: `${countdownSecondsRemaining}s…`,
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
        classes: 'bg-slate-800 text-slate-300',
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
      className="flex min-w-0 flex-col rounded-lg border border-slate-700/80 bg-slate-950 px-2.5 py-1.5 sm:px-3"
      aria-label="Recording session clock"
    >
      <span className="text-[11px] font-semibold tracking-wider text-amber-300 uppercase">
        Session Rec
      </span>
      <div className="flex flex-wrap items-center gap-1.5">
        <span
          data-testid="header-recording-time"
          className="font-mono text-xs font-semibold text-slate-100 tabular-nums sm:text-sm"
        >
          {recordingTimeLabel}
        </span>
        <span
          data-testid="header-recording-status"
          className={`rounded px-1.5 py-0.5 text-[10px] font-medium ${pill.classes}`}
        >
          {pill.label}
        </span>
      </div>
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
    <header className="w-full border-b border-slate-800 bg-slate-900/95 backdrop-blur">
      <a
        href="#studio-main"
        className="sr-only focus:not-sr-only focus:fixed focus:top-3 focus:left-3 focus:z-50 focus:rounded-md focus:bg-sky-400 focus:px-4 focus:py-2 focus:font-semibold focus:text-slate-950"
      >
        Skip to studio workspace
      </a>

      <div className="mx-auto flex w-full max-w-[96rem] flex-col gap-2.5 px-2.5 py-2.5 min-[375px]:px-3.5 sm:flex-row sm:flex-wrap sm:items-center sm:justify-between sm:gap-3 sm:px-5 sm:py-3 lg:px-6 xl:px-8">
        <div className="flex min-w-0 items-start justify-between gap-2 sm:items-center">
          <div className="flex min-w-0 items-center gap-2.5">
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-sky-400/30 bg-sky-400/10 text-sky-300">
              <StageLogoIcon className="h-5 w-5" />
            </span>
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-1.5 sm:gap-2">
                <h1 className="text-[clamp(1rem,2.4vw,1.15rem)] leading-tight font-bold tracking-tight text-slate-100">
                  ReactStage
                </h1>
                <span className="rounded-full border border-emerald-400/30 bg-emerald-400/10 px-2 py-0.5 text-[11px] font-medium text-emerald-300 sm:px-2.5 sm:text-xs">
                  Local-First · Zero Uploads
                </span>
                {isOffline && (
                  <span
                    data-testid="header-offline-badge"
                    role="status"
                    className="rounded-full border border-sky-400/40 bg-sky-400/15 px-2 py-0.5 text-[11px] font-semibold text-sky-200 sm:px-2.5 sm:text-xs"
                  >
                    Offline Ready
                  </span>
                )}
              </div>
              <p className="mt-0.5 text-xs leading-snug text-slate-300 break-words">
                Open-source video reaction studio
              </p>
            </div>
          </div>

          <div className="flex shrink-0 items-center gap-1.5 sm:hidden">
            <button
              type="button"
              data-testid="open-presets-modal-button-mobile"
              aria-label="Open studio presets"
              onClick={openPresetsModal}
              className="inline-flex min-h-10 min-w-10 items-center justify-center rounded-lg border border-slate-700 bg-slate-950 px-2.5 py-2 text-xs font-medium text-slate-200 hover:bg-slate-800 active:bg-slate-800 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky-300"
            >
              <BookmarkPresetIcon className="h-4 w-4 text-sky-300" />
            </button>

            <button
              type="button"
              data-testid="open-shortcuts-modal-button-mobile"
              aria-label="Open keyboard shortcuts reference"
              onClick={openShortcutsModal}
              className="inline-flex min-h-10 min-w-10 items-center justify-center gap-1 rounded-lg border border-slate-700 bg-slate-950 px-2.5 py-2 text-xs font-medium text-slate-200 hover:bg-slate-800 active:bg-slate-800 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky-300"
            >
              <KeyboardIcon className="h-4 w-4 text-sky-300" />
              <kbd className="font-mono text-[11px] font-semibold text-sky-300">
                ?
              </kbd>
            </button>
          </div>
        </div>

        <div className="flex min-w-0 flex-wrap items-center gap-2 sm:gap-2.5">
          <div
            className="grid min-w-0 flex-1 grid-cols-1 gap-2 min-[360px]:grid-cols-2 sm:flex sm:flex-initial sm:items-center sm:gap-2.5"
            role="group"
            aria-label="Independent studio clocks"
          >
            <div
              className="flex min-w-0 flex-col rounded-lg border border-slate-700/80 bg-slate-950 px-2.5 py-1.5 sm:px-3"
              aria-label="Source playback clock"
            >
              <span className="text-[11px] font-semibold tracking-wider text-sky-300 uppercase">
                Source Time
              </span>
              <span
                data-testid="header-source-time"
                className="font-mono text-xs font-semibold text-slate-100 tabular-nums sm:text-sm"
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
              aria-label="Install ReactStage desktop app"
              onClick={() => {
                void promptInstall();
              }}
              className="inline-flex min-h-10 items-center gap-1.5 rounded-lg bg-sky-400 px-3 py-2 text-xs font-semibold text-slate-950 hover:bg-sky-300 active:bg-sky-300 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky-300"
            >
              <InstallAppIcon className="h-4 w-4" />
              <span>Install App</span>
            </button>
          )}

          <button
            type="button"
            data-testid="open-presets-modal-button"
            aria-label="Creator presets and saved setup"
            onClick={openPresetsModal}
            className="hidden min-h-10 items-center gap-1.5 rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-xs font-medium text-slate-200 hover:bg-slate-800 active:bg-slate-800 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky-300 sm:inline-flex"
          >
            <BookmarkPresetIcon className="h-4 w-4 text-sky-300" />
            <span>Presets</span>
            {prefsSnapshot.customPresets.length > 0 && (
              <span
                data-testid="header-presets-count"
                className="rounded-full border border-slate-700 bg-slate-900 px-1.5 py-0.5 font-mono text-[10px] font-semibold text-sky-300 tabular-nums"
              >
                {prefsSnapshot.customPresets.length}
              </span>
            )}
          </button>

          <button
            type="button"
            data-testid="open-shortcuts-modal-button"
            aria-label="Keyboard shortcuts reference"
            onClick={openShortcutsModal}
            className="hidden min-h-10 items-center gap-1.5 rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-xs font-medium text-slate-200 hover:bg-slate-800 active:bg-slate-800 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky-300 sm:inline-flex"
          >
            <KeyboardIcon className="h-4 w-4 text-sky-300" />
            <span>Shortcuts</span>
            <kbd className="rounded border border-slate-700 bg-slate-900 px-1.5 py-0.5 font-mono text-[10px] font-semibold text-sky-300">
              ?
            </kbd>
          </button>
        </div>
      </div>
    </header>
  );
}

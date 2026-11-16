import { useState, type SyntheticEvent } from 'react';
import { useCapture } from '../state/CaptureContext';
import {
  useRecordingSession,
  useRecordingTelemetry,
} from '../state/RecordingSessionContext';
import { useStudioUi } from '../state/StudioUiContext';
import type { RecordingLifecycleStatus } from '../types/media';
import {
  formatChapterTimestamp,
  MAX_CHAPTER_LABEL_LENGTH,
} from '../utils/chapters';
import { formatBytes, formatTimecode } from '../utils/format';
import {
  AlertIcon,
  DownloadIcon,
  FlagMarkerIcon,
  MicrophoneIcon,
  PauseIcon,
  PlayIcon,
  RecordCircleIcon,
  StopSquareIcon,
  VideoCameraIcon,
} from './StudioIcons';

function getRecordingBadgeMeta(
  status: RecordingLifecycleStatus,
  isSupported: boolean,
  hasError: boolean,
  countdownSecondsRemaining: number | null,
): {
  readonly label: string;
  readonly classes: string;
  readonly showDot: boolean;
} {
  if (countdownSecondsRemaining !== null) {
    return {
      label: `Count-in · ${String(countdownSecondsRemaining)}s`,
      classes: 'border-sky-400/50 bg-sky-400/15 text-sky-200',
      showDot: false,
    };
  }
  if (!isSupported && status === 'idle' && !hasError) {
    return {
      label: 'Unavailable',
      classes: 'border-white/10 bg-slate-800 text-slate-300',
      showDot: false,
    };
  }
  if (hasError || status === 'error') {
    return {
      label: 'Error',
      classes: 'border-rose-400/40 bg-rose-400/10 text-rose-300',
      showDot: false,
    };
  }
  switch (status) {
    case 'arming':
      return {
        label: 'Starting…',
        classes: 'border-amber-400/40 bg-amber-400/10 text-amber-300',
        showDot: false,
      };
    case 'recording':
      return {
        label: 'Recording',
        classes: 'border-rose-400/50 bg-rose-500/20 text-rose-200',
        showDot: true,
      };
    case 'paused':
      return {
        label: 'Paused',
        classes: 'border-amber-400/40 bg-amber-400/10 text-amber-300',
        showDot: false,
      };
    case 'stopping':
      return {
        label: 'Saving…',
        classes: 'border-sky-400/40 bg-sky-400/10 text-sky-300',
        showDot: false,
      };
    case 'completed':
      return {
        label: 'Take Ready',
        classes: 'border-emerald-400/40 bg-emerald-400/10 text-emerald-300',
        showDot: false,
      };
    case 'idle':
    case 'uninitialized':
    default:
      return {
        label: 'Ready',
        classes: 'border-white/10 bg-slate-800/90 text-slate-200',
        showDot: false,
      };
  }
}

function DockSessionClock({
  statusBadge,
}: {
  readonly statusBadge: {
    readonly label: string;
    readonly classes: string;
    readonly showDot: boolean;
  };
}) {
  const telemetry = useRecordingTelemetry();
  const formattedRecTime = formatTimecode(
    telemetry.elapsedRecordingMs / 1000,
    true,
  );
  const showLiveSize =
    telemetry.status === 'recording' ||
    telemetry.status === 'paused' ||
    telemetry.recordedBytes > 0;
  const isQuietIdle =
    statusBadge.label === 'Ready' &&
    telemetry.elapsedRecordingMs === 0 &&
    !showLiveSize;

  return (
    <div
      className={
        isQuietIdle
          ? 'sr-only'
          : 'flex flex-wrap items-center gap-2 rounded-xl border border-slate-800 bg-slate-950/75 px-3 py-1.5'
      }
    >
      <span
        data-testid="recording-session-time"
        className="font-mono text-sm font-bold text-white tabular-nums sm:text-base"
      >
        {formattedRecTime}
      </span>

      {showLiveSize && (
        <span
          data-testid="recording-bytes-readout"
          className="font-mono text-xs font-medium text-slate-300 tabular-nums"
        >
          {formatBytes(telemetry.recordedBytes)}
        </span>
      )}

      {/* Preserved for deterministic MediaRecorder chunk readiness checks without visual jargon */}
      <span data-testid="recording-chunks-readout" className="sr-only">
        {telemetry.chunkCount}
      </span>

      <span
        data-testid="recording-status-badge"
        className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-[11px] font-semibold ${statusBadge.classes}`}
      >
        {statusBadge.showDot && (
          <span
            aria-hidden="true"
            className="h-1.5 w-1.5 animate-pulse rounded-full bg-rose-400"
          />
        )}
        {statusBadge.label}
      </span>
    </div>
  );
}

export function RecordingSessionPanel() {
  const {
    engineState,
    activeMarkers,
    localOrchestrationError,
    preRollEnabled,
    countdownSecondsRemaining,
    requestStartRecording,
    skipCountdownAndStart,
    cancelCountdown,
    togglePauseRecording,
    addChapterMarker,
    stopRecording,
    cancelRecording,
    discardRecording,
  } = useRecordingSession();
  const {
    snapshot: captureSnapshot,
    startCamera,
    stopCamera,
    startMicrophone,
    stopMicrophone,
  } = useCapture();
  const { setActiveTab } = useStudioUi();
  const [markerLabelInput, setMarkerLabelInput] = useState('');

  const handleMarkerFormSubmit = (event: SyntheticEvent<HTMLFormElement>) => {
    event.preventDefault();
    const created = addChapterMarker(markerLabelInput);
    if (created) {
      setMarkerLabelInput('');
    }
  };

  const activeError = localOrchestrationError ?? engineState.error;
  const status = engineState.status;
  const isCountingDown = countdownSecondsRemaining !== null;

  const isIdleLike =
    !isCountingDown &&
    (status === 'idle' ||
      status === 'uninitialized' ||
      status === 'completed' ||
      status === 'error');
  const isRecording = status === 'recording';
  const isPaused = status === 'paused';
  const isActiveSession = isRecording || isPaused;
  const isTransitioning = status === 'arming' || status === 'stopping';

  const isCamActive =
    captureSnapshot.cameraStatus === 'active' &&
    captureSnapshot.activeCameraStream !== null;
  const isMicActive =
    captureSnapshot.microphoneStatus === 'active' &&
    captureSnapshot.activeMicrophoneStream !== null;

  const badge = getRecordingBadgeMeta(
    status,
    engineState.isSupported,
    activeError !== null,
    countdownSecondsRemaining,
  );

  const artifact = engineState.lastArtifact;

  return (
    <section
      data-testid="recording-session-panel"
      aria-labelledby="recording-session-heading"
      className="flex min-w-0 flex-col gap-2.5 rounded-2xl border border-slate-800/80 bg-slate-900/60 px-3 py-2.5 min-[375px]:px-3.5 sm:px-4 sm:py-3"
    >
      <h2 id="recording-session-heading" className="sr-only">
        Reaction Recording
      </h2>

      {/* Calm Record Bar: Cam · Mic · Start Recording */}
      <div className="flex flex-wrap items-center justify-between gap-2.5">
        {/* Quick 1-Click Camera & Mic Pills */}
        <div
          role="group"
          aria-label="Quick camera and microphone toggles"
          className="flex flex-wrap items-center gap-1.5"
        >
          <button
            type="button"
            data-testid="dock-camera-button"
            aria-pressed={isCamActive}
            onClick={() => {
              if (isCamActive || captureSnapshot.cameraStatus === 'requesting') {
                stopCamera();
              } else {
                void startCamera();
              }
            }}
            className={
              isCamActive
                ? 'inline-flex min-h-10 items-center gap-1.5 rounded-xl border border-emerald-400/35 bg-emerald-400/10 px-3 py-2 text-xs font-medium text-emerald-200 transition hover:bg-emerald-400/20 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-300'
                : 'inline-flex min-h-10 items-center gap-1.5 rounded-xl border border-slate-800 bg-slate-950/75 px-3 py-2 text-xs font-medium text-slate-300 transition hover:bg-slate-800 hover:text-white focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky-400'
            }
          >
            <VideoCameraIcon className="h-3.5 w-3.5 shrink-0 text-sky-300" />
            <span>{isCamActive ? 'Cam On' : 'Cam Off'}</span>
          </button>

          <button
            type="button"
            data-testid="dock-mic-button"
            aria-pressed={isMicActive}
            onClick={() => {
              if (
                isMicActive ||
                captureSnapshot.microphoneStatus === 'requesting'
              ) {
                stopMicrophone();
              } else {
                void startMicrophone();
              }
            }}
            className={
              isMicActive
                ? 'inline-flex min-h-10 items-center gap-1.5 rounded-xl border border-emerald-400/35 bg-emerald-400/10 px-3 py-2 text-xs font-medium text-emerald-200 transition hover:bg-emerald-400/20 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-300'
                : 'inline-flex min-h-10 items-center gap-1.5 rounded-xl border border-slate-800 bg-slate-950/75 px-3 py-2 text-xs font-medium text-slate-300 transition hover:bg-slate-800 hover:text-white focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky-400'
            }
          >
            <MicrophoneIcon className="h-3.5 w-3.5 shrink-0 text-emerald-300" />
            <span>{isMicActive ? 'Mic On' : 'Mic Off'}</span>
          </button>
        </div>

        <div className="sm:order-last">
          <DockSessionClock statusBadge={badge} />
        </div>

        {/* Primary Recording Action */}
        <div className="flex w-full flex-wrap items-center gap-2 sm:w-auto sm:ml-auto">
          {isIdleLike && (
            <button
              type="button"
              data-testid="start-recording-button"
              disabled={!engineState.isSupported || isTransitioning}
              onClick={() => {
                void requestStartRecording();
              }}
              className="inline-flex min-h-10 min-w-[10.5rem] flex-1 items-center justify-center gap-2 rounded-xl bg-rose-400 px-4 py-2 text-xs font-semibold text-slate-950 transition hover:bg-rose-300 active:bg-rose-500 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-rose-300 disabled:cursor-not-allowed disabled:bg-slate-800 disabled:text-slate-400 sm:flex-initial sm:text-sm"
            >
              <RecordCircleIcon className="h-4 w-4 shrink-0" />
              <span>
                {artifact
                  ? preRollEnabled
                    ? 'Record New Take (3s)'
                    : 'Record New Take'
                  : preRollEnabled
                    ? 'Start Recording (3s)'
                    : 'Start Recording'}
              </span>
            </button>
          )}

          {(isActiveSession || isTransitioning) && (
            <div className="grid w-full grid-cols-1 gap-2 min-[380px]:grid-cols-2 sm:flex sm:w-auto sm:flex-wrap">
              <button
                type="button"
                data-testid="pause-resume-recording-button"
                disabled={isTransitioning}
                onClick={togglePauseRecording}
                className="inline-flex min-h-10 flex-1 items-center justify-center gap-1.5 rounded-xl border border-white/10 bg-slate-800 px-3.5 py-2 text-xs font-semibold text-slate-100 hover:bg-slate-700 active:bg-slate-700 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky-300 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {isPaused ? (
                  <>
                    <PlayIcon className="h-3.5 w-3.5 shrink-0 text-emerald-300" />
                    <span>Resume</span>
                  </>
                ) : (
                  <>
                    <PauseIcon className="h-3.5 w-3.5 shrink-0 text-amber-300" />
                    <span>Pause</span>
                  </>
                )}
              </button>

              <button
                type="button"
                data-testid="stop-recording-button"
                disabled={isTransitioning}
                onClick={() => {
                  void stopRecording();
                }}
                className="inline-flex min-h-10 flex-1 items-center justify-center gap-1.5 rounded-xl bg-amber-300 px-4 py-2 text-xs font-bold text-slate-950 hover:bg-amber-200 active:bg-amber-400 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-amber-300 disabled:cursor-not-allowed disabled:opacity-60"
              >
                <StopSquareIcon className="h-3.5 w-3.5 shrink-0" />
                <span>Finish Recording</span>
              </button>

              <button
                type="button"
                data-testid="cancel-recording-button"
                disabled={isTransitioning}
                onClick={cancelRecording}
                className="inline-flex min-h-10 items-center justify-center rounded-xl border border-white/10 bg-slate-950/85 px-3 py-2 text-xs font-medium text-slate-200 hover:bg-slate-800 active:bg-slate-800 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky-300 disabled:cursor-not-allowed disabled:opacity-60 min-[380px]:col-span-2 sm:col-span-1"
              >
                Cancel
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Pre-Roll Count-In Banner */}
      {isCountingDown && (
        <div
          data-testid="preroll-panel-banner"
          className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-sky-400/40 bg-sky-950/50 px-3 py-2.5 text-xs text-sky-100"
        >
          <div className="flex items-center gap-2">
            <span
              data-testid="preroll-panel-digit"
              className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-sky-400 font-mono text-sm font-bold text-slate-950 tabular-nums"
            >
              {countdownSecondsRemaining}
            </span>
            <span className="font-medium">
              Starting in {countdownSecondsRemaining}s…
            </span>
          </div>

          <div className="flex flex-wrap items-center gap-1.5">
            <button
              type="button"
              data-testid="skip-countdown-button"
              onClick={() => {
                void skipCountdownAndStart();
              }}
              className="inline-flex min-h-9 items-center justify-center rounded-lg bg-sky-400 px-3 py-1.5 text-xs font-semibold text-slate-950 hover:bg-sky-300 active:bg-sky-300 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky-300"
            >
              Start Now
            </button>
            <button
              type="button"
              data-testid="cancel-countdown-button"
              onClick={cancelCountdown}
              className="inline-flex min-h-9 items-center justify-center rounded-lg border border-white/10 bg-slate-900 px-3 py-1.5 text-xs font-medium text-slate-200 hover:bg-slate-800 active:bg-slate-800 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky-300"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* Accessible Error Diagnostics */}
      {activeError && (
        <div
          role="alert"
          data-testid="recording-error-alert"
          className="flex items-start gap-2 rounded-xl border border-rose-500/40 bg-rose-950/75 p-3 text-xs text-rose-100"
        >
          <AlertIcon className="mt-0.5 h-4 w-4 shrink-0 text-rose-300" />
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="font-semibold">{activeError.title}</span>
              <span className="rounded bg-rose-900/90 px-1.5 py-0.5 font-mono text-[10px] text-rose-200">
                {activeError.code}
              </span>
            </div>
            <p className="mt-0.5 text-[11px] leading-relaxed text-rose-100 break-words">
              {activeError.message}
            </p>
          </div>
        </div>
      )}

      {/* Live Chapter Bookmark Bar (shown only during active recording) */}
      {isActiveSession && (
        <form
          data-testid="live-chapter-markers-bar"
          onSubmit={handleMarkerFormSubmit}
          className="flex flex-col gap-2 rounded-xl border border-white/[0.08] bg-slate-950/80 p-2.5"
        >
          <div className="flex flex-wrap items-center justify-between gap-1.5 text-[11px]">
            <span className="inline-flex items-center gap-1.5 font-semibold text-sky-300">
              <FlagMarkerIcon className="h-3.5 w-3.5 shrink-0" />
              <span>Chapter Bookmarks</span>
              <span
                data-testid="live-markers-count"
                className="rounded-full border border-white/10 bg-slate-900 px-1.5 py-0.5 font-mono text-[10px] text-slate-100 tabular-nums"
              >
                {activeMarkers.length}
              </span>
            </span>

            {activeMarkers.length > 0 && (
              <span
                data-testid="latest-marker-badge"
                className="min-w-0 font-mono text-[11px] text-emerald-300 tabular-nums break-words"
              >
                Last:{' '}
                {formatChapterTimestamp(
                  activeMarkers[activeMarkers.length - 1]
                    ?.elapsedRecordingMs ?? 0,
                )}{' '}
                · {activeMarkers[activeMarkers.length - 1]?.label ?? ''}
              </span>
            )}
          </div>

          <div className="flex flex-col gap-2 min-[420px]:flex-row min-[420px]:items-center min-[420px]:gap-1.5">
            <input
              type="text"
              data-testid="chapter-marker-label-input"
              aria-label="Optional chapter marker label"
              maxLength={MAX_CHAPTER_LABEL_LENGTH}
              value={markerLabelInput}
              onChange={(e) => setMarkerLabelInput(e.currentTarget.value)}
              placeholder="Bookmark this moment (optional, or press B)…"
              className="min-h-9 min-w-0 flex-1 rounded-lg border border-white/10 bg-slate-900 px-2.5 py-1.5 text-xs text-slate-100 placeholder:text-slate-400 focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-sky-300"
            />
            <button
              type="submit"
              data-testid="add-chapter-marker-button"
              className="inline-flex min-h-9 shrink-0 items-center justify-center gap-1 rounded-lg bg-sky-400 px-3 py-1.5 text-xs font-semibold text-slate-950 hover:bg-sky-300 active:bg-sky-300 focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-sky-300"
            >
              <FlagMarkerIcon className="h-3 w-3 shrink-0" />
              <span>Add Marker (B)</span>
            </button>
          </div>
        </form>
      )}

      {/* Compact Take Captured Summary Banner */}
      {artifact && isIdleLike && (
        <div
          data-testid="recorded-artifact-summary"
          className="flex flex-wrap items-center justify-between gap-2.5 rounded-xl border border-emerald-400/35 bg-emerald-950/35 px-3 py-2.5 text-xs"
        >
          <div className="flex min-w-0 flex-wrap items-center gap-2 text-slate-100">
            <span className="font-semibold text-emerald-200">
              Take saved to Takes
            </span>
            <span
              data-testid="recorded-artifact-duration"
              className="rounded-md bg-emerald-400/15 px-2 py-0.5 font-mono text-[11px] font-semibold text-emerald-200 tabular-nums"
            >
              {formatTimecode(artifact.durationMs / 1000, true)}
            </span>
            <span
              data-testid="recorded-artifact-size"
              className="font-mono text-[11px] text-slate-200 tabular-nums"
            >
              {formatBytes(artifact.sizeBytes)}
            </span>
            <span data-testid="recorded-artifact-mime" className="sr-only">
              {artifact.mimeType}
            </span>
          </div>

          <div className="flex flex-wrap items-center gap-1.5">
            <button
              type="button"
              data-testid="open-takes-drawer-button"
              onClick={() => setActiveTab('takes')}
              className="inline-flex min-h-9 items-center gap-1.5 rounded-lg bg-emerald-400 px-3 py-1.5 text-xs font-semibold text-slate-950 hover:bg-emerald-300 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-300"
            >
              <DownloadIcon className="h-3.5 w-3.5 shrink-0" />
              <span>Preview &amp; Download</span>
            </button>
            <button
              type="button"
              data-testid="discard-recording-button"
              onClick={discardRecording}
              className="inline-flex min-h-9 items-center justify-center rounded-lg border border-white/10 bg-slate-900 px-2.5 py-1.5 text-xs font-medium text-slate-200 hover:bg-slate-800 hover:text-rose-200 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky-300"
            >
              Discard
            </button>
          </div>
        </div>
      )}
    </section>
  );
}

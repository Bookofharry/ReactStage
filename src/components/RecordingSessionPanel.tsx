import { useState, type SyntheticEvent } from 'react';
import { useAudioMixer } from '../state/AudioMixerContext';
import { useSceneCompositor } from '../state/CompositorContext';
import {
  useRecordingSession,
  useRecordingTelemetry,
} from '../state/RecordingSessionContext';
import type { RecordingLifecycleStatus, StageLayoutMode } from '../types/media';
import { formatChapterTimestamp, MAX_CHAPTER_LABEL_LENGTH } from '../utils/chapters';
import { formatBytes, formatTimecode } from '../utils/format';
import {
  AlertIcon,
  FlagMarkerIcon,
  PauseIcon,
  PlayIcon,
  RecordCircleIcon,
  StopSquareIcon,
  TimerIcon,
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
      label: `Count-in · ${countdownSecondsRemaining}s`,
      classes: 'border-sky-400/50 bg-sky-400/15 text-sky-200',
      showDot: false,
    };
  }
  if (!isSupported && status === 'idle' && !hasError) {
    return {
      label: 'Recorder Unavailable',
      classes: 'border-slate-700 bg-slate-800 text-slate-300',
      showDot: false,
    };
  }
  if (hasError || status === 'error') {
    return {
      label: 'Recorder Error',
      classes: 'border-rose-400/40 bg-rose-400/10 text-rose-300',
      showDot: false,
    };
  }
  switch (status) {
    case 'arming':
      return {
        label: 'Arming…',
        classes: 'border-amber-400/40 bg-amber-400/10 text-amber-300',
        showDot: false,
      };
    case 'recording':
      return {
        label: 'Recording',
        classes: 'border-rose-400/50 bg-rose-400/15 text-rose-200',
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
        label: 'Finalizing…',
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
        classes: 'border-slate-700 bg-slate-800 text-slate-200',
        showDot: false,
      };
  }
}

function formatCompactMimeLabel(mimeType: string | null): string {
  if (!mimeType) {
    return 'Auto Container';
  }
  const lower = mimeType.toLowerCase();
  if (lower.includes('vp9') && lower.includes('opus')) {
    return 'WebM · VP9 + Opus';
  }
  if (lower.includes('vp8') && lower.includes('opus')) {
    return 'WebM · VP8 + Opus';
  }
  if (lower.includes('h264') && lower.includes('opus')) {
    return 'WebM · H.264 + Opus';
  }
  if (lower.includes('vp9')) {
    return 'WebM · VP9';
  }
  if (lower.includes('vp8')) {
    return 'WebM · VP8';
  }
  if (lower.includes('mp4')) {
    return 'MP4 · H.264/AAC';
  }
  if (lower.includes('webm')) {
    return 'WebM';
  }
  return mimeType;
}

function formatLayoutShort(mode: StageLayoutMode): string {
  switch (mode) {
    case 'pip':
      return 'PIP';
    case 'side-by-side':
      return 'Split';
    case 'top-bottom':
      return 'Shorts';
    case 'source-only':
      return 'Source';
    case 'camera-only':
      return 'Webcam';
  }
}

function LiveRecordingClockCard() {
  const telemetry = useRecordingTelemetry();
  const formattedRecTime = formatTimecode(
    telemetry.elapsedRecordingMs / 1000,
    true,
  );

  return (
    <div className="mt-3 rounded-lg border border-slate-800 bg-slate-950 px-3 py-2.5 sm:px-3.5 sm:py-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <p className="text-[11px] font-semibold tracking-wider text-amber-300 uppercase">
            Session Recording Time
          </p>
          <p className="mt-0.5 text-[11px] text-slate-300">
            Independent commentary clock
          </p>
        </div>
        <span
          data-testid="recording-session-time"
          className="font-mono text-[clamp(1.125rem,3vw,1.35rem)] font-bold text-slate-100 tabular-nums"
        >
          {formattedRecTime}
        </span>
      </div>

      <div className="mt-2.5 flex flex-wrap items-center justify-between gap-2 border-t border-slate-800/80 pt-2 text-[11px] text-slate-300">
        <span>
          Data:{' '}
          <strong
            data-testid="recording-bytes-readout"
            className="font-mono font-semibold text-slate-100 tabular-nums"
          >
            {formatBytes(telemetry.recordedBytes)}
          </strong>
        </span>
        <span>
          Chunks:{' '}
          <strong
            data-testid="recording-chunks-readout"
            className="font-mono font-semibold text-slate-100 tabular-nums"
          >
            {telemetry.chunkCount}
          </strong>
        </span>
        <span
          data-testid="recording-codec-badge"
          className="rounded border border-slate-800 bg-slate-900 px-1.5 py-0.5 font-mono text-[10px] text-slate-200"
        >
          {formatCompactMimeLabel(telemetry.negotiatedMimeType)}
        </span>
      </div>
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
    togglePreRoll,
    requestStartRecording,
    skipCountdownAndStart,
    cancelCountdown,
    togglePauseRecording,
    addChapterMarker,
    stopRecording,
    cancelRecording,
    discardRecording,
  } = useRecordingSession();
  const { state: compositorState } = useSceneCompositor();
  const { state: mixerState } = useAudioMixer();
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

  const badge = getRecordingBadgeMeta(
    status,
    engineState.isSupported,
    activeError !== null,
    countdownSecondsRemaining,
  );

  const audioBusLabel =
    mixerState.status === 'unavailable'
      ? 'Video Only (No Web Audio)'
      : mixerState.mixMode === 'combined'
        ? 'Combined Audio Mix'
        : mixerState.mixMode === 'source-only'
          ? 'Video Audio Only'
          : mixerState.mixMode === 'microphone-only'
            ? 'Microphone Audio Only'
            : 'Silent Mix Bus Ready';

  const artifact = engineState.lastArtifact;

  return (
    <section
      data-testid="recording-session-panel"
      aria-labelledby="recording-session-heading"
      className="flex min-w-0 flex-col rounded-xl border border-slate-800 bg-slate-900 p-3 shadow-lg min-[375px]:p-3.5 sm:p-4"
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <RecordCircleIcon
            className={`h-4 w-4 shrink-0 ${
              isRecording ? 'text-rose-300' : 'text-amber-300'
            }`}
          />
          <h2
            id="recording-session-heading"
            className="text-sm font-semibold text-slate-100"
          >
            Reaction Recording
          </h2>
        </div>

        <span
          data-testid="recording-status-badge"
          className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-[11px] font-medium ${badge.classes}`}
        >
          {badge.showDot && (
            <span
              aria-hidden="true"
              className="h-1.5 w-1.5 rounded-full bg-rose-400"
            />
          )}
          {badge.label}
        </span>
      </div>

      {/* Pipeline Feed Pills + 3s Pre-Roll Toggle */}
      <div className="mt-2.5 flex flex-wrap items-center justify-between gap-2 text-[11px]">
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="rounded border border-slate-800 bg-slate-950 px-2 py-1 font-mono text-slate-200">
            {compositorState.width}×{compositorState.height} ·{' '}
            {formatLayoutShort(compositorState.layoutMode)}
          </span>
          <span className="rounded border border-slate-800 bg-slate-950 px-2 py-1 text-slate-300">
            {audioBusLabel}
          </span>
        </div>

        <button
          type="button"
          data-testid="preroll-countdown-toggle"
          aria-pressed={preRollEnabled}
          disabled={isActiveSession || isTransitioning || isCountingDown}
          onClick={togglePreRoll}
          className={
            preRollEnabled
              ? 'inline-flex min-h-9 items-center gap-1.5 rounded-md border border-sky-400/50 bg-sky-400/15 px-2.5 py-1.5 text-[11px] font-semibold text-sky-200 hover:bg-sky-400/25 active:bg-sky-400/25 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky-300 disabled:cursor-not-allowed disabled:opacity-60'
              : 'inline-flex min-h-9 items-center gap-1.5 rounded-md border border-slate-700 bg-slate-950 px-2.5 py-1.5 text-[11px] font-medium text-slate-300 hover:bg-slate-800 active:bg-slate-800 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky-300 disabled:cursor-not-allowed disabled:opacity-60'
          }
        >
          <TimerIcon className="h-3.5 w-3.5 shrink-0" />
          <span>{preRollEnabled ? '3s Pre-Roll: On' : '3s Pre-Roll: Off'}</span>
        </button>
      </div>

      {/* Monotonic Session Clock & Live Byte Telemetry */}
      <LiveRecordingClockCard />

      {/* Accessible Error Diagnostics */}
      {activeError && (
        <div
          role="alert"
          data-testid="recording-error-alert"
          className="mt-3 flex items-start gap-2 rounded-lg border border-rose-500/40 bg-rose-950/75 p-3 text-xs text-rose-100"
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

      {/* Primary Session Recording Controls */}
      <div className="mt-3 flex flex-col gap-2">
        {isCountingDown && (
          <div
            data-testid="preroll-panel-banner"
            className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-sky-400/40 bg-sky-950/50 px-3 py-2.5 text-xs text-sky-100"
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
                className="inline-flex min-h-9 items-center justify-center rounded-md bg-sky-400 px-3 py-1.5 text-xs font-semibold text-slate-950 hover:bg-sky-300 active:bg-sky-300 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky-300"
              >
                Start Now
              </button>
              <button
                type="button"
                data-testid="cancel-countdown-button"
                onClick={cancelCountdown}
                className="inline-flex min-h-9 items-center justify-center rounded-md border border-slate-700 bg-slate-900 px-3 py-1.5 text-xs font-medium text-slate-200 hover:bg-slate-800 active:bg-slate-800 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky-300"
              >
                Cancel
              </button>
            </div>
          </div>
        )}

        {isIdleLike && (
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              data-testid="start-recording-button"
              disabled={!engineState.isSupported || isTransitioning}
              onClick={() => {
                void requestStartRecording();
              }}
              className="inline-flex min-h-10 min-w-[10rem] flex-1 items-center justify-center gap-2 rounded-lg bg-rose-400 px-4 py-2 text-sm font-semibold text-slate-950 hover:bg-rose-300 active:bg-rose-300 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-rose-300 disabled:cursor-not-allowed disabled:bg-slate-800 disabled:text-slate-400"
            >
              <RecordCircleIcon className="h-4 w-4 shrink-0" />
              <span>
                {artifact
                  ? preRollEnabled
                    ? 'Record New Session (3s)'
                    : 'Record New Session'
                  : preRollEnabled
                    ? 'Start Recording (3s)'
                    : 'Start Recording'}
              </span>
            </button>

            {artifact && (
              <button
                type="button"
                data-testid="discard-recording-button"
                onClick={discardRecording}
                className="inline-flex min-h-10 items-center justify-center rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-xs font-semibold text-slate-100 hover:bg-slate-700 active:bg-slate-700 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky-300"
              >
                Discard Take
              </button>
            )}
          </div>
        )}

        {(isActiveSession || isTransitioning) && (
          <div className="grid grid-cols-1 gap-2 min-[380px]:grid-cols-2 sm:flex sm:flex-wrap">
            <button
              type="button"
              data-testid="pause-resume-recording-button"
              disabled={isTransitioning}
              onClick={togglePauseRecording}
              className="inline-flex min-h-10 flex-1 items-center justify-center gap-1.5 rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-xs font-semibold text-slate-100 hover:bg-slate-700 active:bg-slate-700 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky-300 disabled:cursor-not-allowed disabled:opacity-60"
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
              className="inline-flex min-h-10 flex-1 items-center justify-center gap-1.5 rounded-lg bg-amber-300 px-3 py-2 text-xs font-semibold text-slate-950 hover:bg-amber-200 active:bg-amber-200 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-amber-300 disabled:cursor-not-allowed disabled:opacity-60"
            >
              <StopSquareIcon className="h-3.5 w-3.5 shrink-0" />
              <span>Stop &amp; Finalize</span>
            </button>

            <button
              type="button"
              data-testid="cancel-recording-button"
              disabled={isTransitioning}
              onClick={cancelRecording}
              className="inline-flex min-h-10 items-center justify-center rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-xs font-medium text-slate-200 hover:bg-slate-800 active:bg-slate-800 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky-300 disabled:cursor-not-allowed disabled:opacity-60 min-[380px]:col-span-2 sm:col-span-1"
            >
              Cancel
            </button>

            {isActiveSession && (
              <form
                data-testid="live-chapter-markers-bar"
                onSubmit={handleMarkerFormSubmit}
                className="mt-1 flex flex-col gap-2 rounded-lg border border-slate-800 bg-slate-950 p-2.5 min-[380px]:col-span-2 sm:w-full"
              >
                <div className="flex flex-wrap items-center justify-between gap-1.5 text-[11px]">
                  <span className="inline-flex items-center gap-1.5 font-semibold text-sky-300">
                    <FlagMarkerIcon className="h-3.5 w-3.5 shrink-0" />
                    <span>Chapter Markers</span>
                    <span
                      data-testid="live-markers-count"
                      className="rounded-full border border-slate-700 bg-slate-900 px-1.5 py-0.5 font-mono text-[10px] text-slate-100 tabular-nums"
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
                    placeholder="Chapter title (optional, or press B)…"
                    className="min-h-9 min-w-0 flex-1 rounded-md border border-slate-700 bg-slate-900 px-2.5 py-1.5 text-xs text-slate-100 placeholder:text-slate-400 focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-sky-300"
                  />
                  <button
                    type="submit"
                    data-testid="add-chapter-marker-button"
                    className="inline-flex min-h-9 shrink-0 items-center justify-center gap-1 rounded-md bg-sky-400 px-3 py-1.5 text-xs font-semibold text-slate-950 hover:bg-sky-300 active:bg-sky-300 focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-sky-300"
                  >
                    <FlagMarkerIcon className="h-3 w-3 shrink-0" />
                    <span>Add Marker (B)</span>
                  </button>
                </div>
              </form>
            )}
          </div>
        )}
      </div>

      {/* Completed In-Memory Recorded Artifact Summary */}
      {artifact && (
        <div
          data-testid="recorded-artifact-summary"
          className="mt-3 rounded-lg border border-emerald-400/35 bg-emerald-950/35 p-3 text-xs"
        >
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="font-semibold text-emerald-200">
              Recorded Reaction Captured
            </span>
            <span
              data-testid="recorded-artifact-size"
              className="rounded bg-emerald-400/15 px-2 py-0.5 font-mono text-[11px] font-semibold text-emerald-200 tabular-nums"
            >
              {formatBytes(artifact.sizeBytes)}
            </span>
          </div>

          <dl className="mt-2 grid grid-cols-1 gap-x-3 gap-y-1 text-[11px] text-slate-200 min-[360px]:grid-cols-2">
            <div>
              <dt className="inline text-slate-300">Duration: </dt>
              <dd
                data-testid="recorded-artifact-duration"
                className="inline font-mono font-semibold tabular-nums"
              >
                {formatTimecode(artifact.durationMs / 1000, true)}
              </dd>
            </div>
            <div>
              <dt className="inline text-slate-300">Resolution: </dt>
              <dd className="inline font-mono font-semibold tabular-nums">
                {artifact.width}×{artifact.height}
              </dd>
            </div>
            <div className="min-[360px]:col-span-2">
              <dt className="inline text-slate-300">Format: </dt>
              <dd
                data-testid="recorded-artifact-mime"
                className="inline font-mono text-slate-100 break-words"
              >
                {artifact.mimeType} (
                {artifact.hasAudioTrack ? 'Video + Mixed Audio' : 'Video Only'})
              </dd>
            </div>
          </dl>

          <p className="mt-2 text-[11px] leading-relaxed text-slate-300">
            Held locally in memory ({artifact.chunkCount}{' '}
            {artifact.chunkCount === 1 ? 'chunk' : 'chunks'}). Review playback
            and download your file in{' '}
            <strong className="text-sky-300">Synchronized Export</strong> below.
          </p>
        </div>
      )}

      <p className="mt-2.5 text-xs leading-relaxed text-slate-300">
        Pausing, seeking, slowing down, or replacing the imported video never
        interrupts your recording session or resets the commentary clock.
      </p>
    </section>
  );
}

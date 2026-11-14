import type { ChangeEvent } from 'react';
import {
  MAX_AUDIO_GAIN,
  MIN_AUDIO_GAIN,
  type AudioMixMode,
  type AudioMixerStatus,
  type MicrophoneAudioAvailability,
  type SourceAudioAvailability,
} from '../services/interfaces/audio-mixer';
import { useAudioMixer, useAudioMixerMeters } from '../state/AudioMixerContext';
import {
  AlertIcon,
  AudioMixerIcon,
  LayoutSourceIcon,
  MicrophoneIcon,
  VolumeHighIcon,
  VolumeMutedIcon,
} from './StudioIcons';

function getMixerStatusBadge(status: AudioMixerStatus): {
  readonly label: string;
  readonly classes: string;
} {
  switch (status) {
    case 'running':
      return {
        label: 'Audio Live',
        classes: 'border-emerald-400/40 bg-emerald-400/10 text-emerald-300',
      };
    case 'suspended':
      return {
        label: 'Audio Suspended',
        classes: 'border-amber-400/40 bg-amber-400/10 text-amber-300',
      };
    case 'unavailable':
      return {
        label: 'Web Audio Unavailable',
        classes: 'border-slate-700 bg-slate-800 text-slate-300',
      };
    case 'error':
      return {
        label: 'Mixer Error',
        classes: 'border-rose-400/40 bg-rose-400/10 text-rose-300',
      };
    case 'idle':
    default:
      return {
        label: 'Standby',
        classes: 'border-slate-700 bg-slate-800 text-slate-300',
      };
  }
}

function getMixModeBadge(mode: AudioMixMode): {
  readonly label: string;
  readonly classes: string;
} {
  switch (mode) {
    case 'combined':
      return {
        label: 'Combined Mix',
        classes: 'border-sky-400/40 bg-sky-400/10 text-sky-300',
      };
    case 'source-only':
      return {
        label: 'Video Only',
        classes: 'border-indigo-400/40 bg-indigo-400/10 text-indigo-200',
      };
    case 'microphone-only':
      return {
        label: 'Mic Only',
        classes: 'border-emerald-400/40 bg-emerald-400/10 text-emerald-300',
      };
    case 'silent':
    default:
      return {
        label: 'Silent Mix',
        classes: 'border-slate-700 bg-slate-800 text-slate-300',
      };
  }
}

function getSourceAvailabilityMeta(availability: SourceAudioAvailability): {
  readonly badgeText: string;
  readonly badgeClass: string;
} {
  switch (availability) {
    case 'playing':
      return {
        badgeText: 'Playing',
        badgeClass: 'border-emerald-400/40 bg-emerald-400/10 text-emerald-300',
      };
    case 'paused':
      return {
        badgeText: 'Paused',
        badgeClass: 'border-amber-400/40 bg-amber-400/10 text-amber-300',
      };
    case 'ready':
      return {
        badgeText: 'Ready',
        badgeClass: 'border-sky-400/40 bg-sky-400/10 text-sky-300',
      };
    case 'no-audio-track':
      return {
        badgeText: 'No Audio Track',
        badgeClass: 'border-amber-400/40 bg-amber-400/10 text-amber-300',
      };
    case 'no-source':
    default:
      return {
        badgeText: 'No Video',
        badgeClass: 'border-slate-700 bg-slate-800 text-slate-300',
      };
  }
}

function getMicrophoneAvailabilityMeta(
  availability: MicrophoneAudioAvailability,
): {
  readonly badgeText: string;
  readonly badgeClass: string;
} {
  switch (availability) {
    case 'live':
      return {
        badgeText: 'Live',
        badgeClass: 'border-emerald-400/40 bg-emerald-400/10 text-emerald-300',
      };
    case 'muted-hardware':
      return {
        badgeText: 'Track Muted',
        badgeClass: 'border-amber-400/40 bg-amber-400/10 text-amber-300',
      };
    case 'ended':
      return {
        badgeText: 'Disconnected',
        badgeClass: 'border-rose-400/40 bg-rose-400/10 text-rose-300',
      };
    case 'off':
    default:
      return {
        badgeText: 'Mic Off',
        badgeClass: 'border-slate-700 bg-slate-800 text-slate-300',
      };
  }
}

function getMeterFillClass(levelPercent: number, clipping: boolean): string {
  if (clipping) {
    return 'bg-rose-400';
  }
  if (levelPercent >= 78) {
    return 'bg-amber-400';
  }
  return 'bg-emerald-400';
}

function MasterOutputMeterReadout() {
  const meters = useAudioMixerMeters();
  const fillClass = getMeterFillClass(
    meters.masterLevelPercent,
    meters.clipping,
  );
  const valueText = meters.clipping
    ? `${meters.masterLevelPercent} percent (clipping)`
    : `${meters.masterLevelPercent} percent`;

  return (
    <div className="flex items-center gap-2 rounded-lg border border-slate-800 bg-slate-950 px-2.5 py-1">
      <span className="text-[11px] font-medium text-slate-300">Mix Bus</span>
      <div
        role="meter"
        aria-label="Combined mix output level"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={meters.masterLevelPercent}
        aria-valuetext={valueText}
        data-testid="mixer-master-meter"
        className="h-2 w-16 overflow-hidden rounded-full bg-slate-800 sm:w-20"
      >
        <div
          data-testid="mixer-master-meter-fill"
          style={{ width: `${meters.masterLevelPercent}%` }}
          className={`h-full rounded-full ${fillClass}`}
        />
      </div>
      <span
        data-testid="mixer-master-level-value"
        className="min-w-[2.4rem] text-right font-mono text-[11px] font-semibold text-slate-100 tabular-nums"
      >
        {meters.masterLevelPercent}%
      </span>
      {meters.clipping && (
        <span
          data-testid="mixer-master-clip-badge"
          className="rounded bg-rose-500/20 px-1.5 py-0.5 font-mono text-[10px] font-semibold text-rose-200"
        >
          CLIP
        </span>
      )}
    </div>
  );
}

function SourcePostGainMeter() {
  const meters = useAudioMixerMeters();
  const fillClass = getMeterFillClass(
    meters.sourceLevelPercent,
    meters.sourceClipping,
  );
  const valueText = meters.sourceClipping
    ? `${meters.sourceLevelPercent} percent (clipping)`
    : `${meters.sourceLevelPercent} percent`;

  return (
    <div className="mt-2.5">
      <div className="flex items-center justify-between gap-2 text-[11px]">
        <span className="text-slate-300">Post-Gain Level</span>
        <div className="flex items-center gap-1.5">
          {meters.sourceClipping && (
            <span
              data-testid="mixer-source-clip-badge"
              className="rounded bg-rose-500/20 px-1.5 py-0.5 font-mono text-[10px] font-semibold text-rose-200"
            >
              CLIP
            </span>
          )}
          <span
            data-testid="mixer-source-level-value"
            className="font-mono font-semibold text-slate-100 tabular-nums"
          >
            {meters.sourceLevelPercent}%
          </span>
        </div>
      </div>

      <div
        role="meter"
        aria-label="Video audio post-gain level"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={meters.sourceLevelPercent}
        aria-valuetext={valueText}
        data-testid="mixer-source-meter"
        className="mt-1 h-2 w-full overflow-hidden rounded-full bg-slate-800"
      >
        <div
          data-testid="mixer-source-meter-fill"
          style={{ width: `${meters.sourceLevelPercent}%` }}
          className={`h-full rounded-full ${fillClass}`}
        />
      </div>
    </div>
  );
}

function MicrophonePostGainMeter() {
  const meters = useAudioMixerMeters();
  const fillClass = getMeterFillClass(
    meters.microphoneLevelPercent,
    meters.microphoneClipping,
  );
  const valueText = meters.microphoneClipping
    ? `${meters.microphoneLevelPercent} percent (clipping)`
    : `${meters.microphoneLevelPercent} percent`;

  return (
    <div className="mt-2.5">
      <div className="flex items-center justify-between gap-2 text-[11px]">
        <span className="text-slate-300">Post-Gain Level</span>
        <div className="flex items-center gap-1.5">
          {meters.microphoneClipping && (
            <span
              data-testid="mixer-mic-clip-badge"
              className="rounded bg-rose-500/20 px-1.5 py-0.5 font-mono text-[10px] font-semibold text-rose-200"
            >
              CLIP
            </span>
          )}
          <span
            data-testid="mixer-mic-level-value"
            className="font-mono font-semibold text-slate-100 tabular-nums"
          >
            {meters.microphoneLevelPercent}%
          </span>
        </div>
      </div>

      <div
        role="meter"
        aria-label="Microphone post-gain level"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={meters.microphoneLevelPercent}
        aria-valuetext={valueText}
        data-testid="mixer-mic-meter"
        className="mt-1 h-2 w-full overflow-hidden rounded-full bg-slate-800"
      >
        <div
          data-testid="mixer-mic-meter-fill"
          style={{ width: `${meters.microphoneLevelPercent}%` }}
          className={`h-full rounded-full ${fillClass}`}
        />
      </div>
    </div>
  );
}

export function AudioMixerPanel() {
  const {
    state,
    enableAudio,
    setSourceGain,
    toggleSourceMute,
    resetSourceGain,
    setMicrophoneGain,
    toggleMicrophoneMute,
    resetMicrophoneGain,
  } = useAudioMixer();

  const statusBadge = getMixerStatusBadge(state.status);
  const modeBadge = getMixModeBadge(state.mixMode);
  const sourceAvail = getSourceAvailabilityMeta(state.sourceAvailability);
  const micAvail = getMicrophoneAvailabilityMeta(state.microphoneAvailability);

  const sourceGainPercent = Math.round(state.sourceChannel.gain * 100);
  const micGainPercent = Math.round(state.microphoneChannel.gain * 100);

  const handleSourceGainChange = (event: ChangeEvent<HTMLInputElement>) => {
    setSourceGain(Number(event.currentTarget.value));
  };

  const handleMicGainChange = (event: ChangeEvent<HTMLInputElement>) => {
    setMicrophoneGain(Number(event.currentTarget.value));
  };

  const runtimeError =
    state.error && state.error.code !== 'WEB_AUDIO_UNSUPPORTED'
      ? state.error
      : null;

  return (
    <section
      data-testid="audio-mixer-panel"
      aria-labelledby="audio-mixer-heading"
      className="rounded-xl border border-slate-800 bg-slate-900 p-4 shadow-lg"
    >
      {/* Header & Combined Output State */}
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-800 pb-3">
        <div className="flex flex-wrap items-center gap-2">
          <AudioMixerIcon className="h-4 w-4 text-sky-300" />
          <h2
            id="audio-mixer-heading"
            className="text-sm font-semibold text-slate-100"
          >
            Live Audio Mixer
          </h2>
          <span
            data-testid="mixer-mode-badge"
            className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-[11px] font-medium ${modeBadge.classes}`}
          >
            {modeBadge.label}
          </span>
          <span
            data-testid="mixer-status-badge"
            className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-[11px] font-medium ${statusBadge.classes}`}
          >
            {state.status === 'running' && (
              <span
                aria-hidden="true"
                className="h-1.5 w-1.5 rounded-full bg-emerald-400"
              />
            )}
            {statusBadge.label}
          </span>
          {state.hasMixedOutput && (
            <span
              data-testid="mixer-output-tracks-badge"
              className="rounded border border-slate-700 bg-slate-950 px-2 py-0.5 font-mono text-[11px] text-slate-300"
            >
              {state.outputTrackCount}{' '}
              {state.outputTrackCount === 1 ? 'Mix Track' : 'Mix Tracks'}
            </span>
          )}
        </div>

        <MasterOutputMeterReadout />
      </div>

      {/* Explicit User-Gesture Enable Audio Banner when Browser Autoplay Suspends Context */}
      {state.requiresUserGesture && (
        <div
          data-testid="mixer-gesture-banner"
          className="mt-3 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-amber-400/40 bg-amber-950/60 px-3.5 py-2.5 text-xs text-amber-100"
        >
          <p className="leading-relaxed">
            Browser audio policy paused the live audio mixer. Click{' '}
            <strong className="font-semibold text-amber-200">
              Enable Audio
            </strong>{' '}
            to activate real-time mixing and source monitoring.
          </p>
          <button
            type="button"
            data-testid="enable-audio-button"
            onClick={() => {
              void enableAudio();
            }}
            className="inline-flex min-h-9 shrink-0 items-center justify-center rounded-lg bg-amber-300 px-3.5 py-1.5 text-xs font-semibold text-slate-950 hover:bg-amber-200 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-amber-300"
          >
            Enable Audio
          </button>
        </div>
      )}

      {/* Runtime Audio Mixer Error Alert */}
      {runtimeError && (
        <div
          role="alert"
          data-testid="mixer-error-alert"
          className="mt-3 flex items-start gap-2 rounded-lg border border-rose-500/40 bg-rose-950/75 p-3 text-xs text-rose-100"
        >
          <AlertIcon className="mt-0.5 h-4 w-4 shrink-0 text-rose-300" />
          <div>
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="font-semibold">{runtimeError.title}</span>
              <span className="rounded bg-rose-900/90 px-1.5 py-0.5 font-mono text-[10px] text-rose-200">
                {runtimeError.code}
              </span>
            </div>
            <p className="mt-0.5 text-[11px] leading-relaxed text-rose-100">
              {runtimeError.message}
            </p>
          </div>
        </div>
      )}

      {/* Two Distinct Channels: Video Audio + Microphone */}
      <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
        {/* Channel 1: Video Audio */}
        <div
          data-testid="mixer-source-channel"
          className="flex min-w-0 flex-col justify-between rounded-lg border border-slate-800 bg-slate-950 p-3"
        >
          <div>
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <div className="flex items-center gap-1.5 text-xs font-semibold text-slate-100">
                  <LayoutSourceIcon className="h-3.5 w-3.5 shrink-0 text-sky-300" />
                  <span>Video Audio</span>
                </div>
                <p
                  data-testid="mixer-source-name"
                  className="mt-0.5 truncate text-[11px] text-slate-300"
                  title={state.sourceLabel ?? 'No local video imported'}
                >
                  {state.sourceLabel ?? 'No local video imported'}
                </p>
              </div>

              <span
                data-testid="mixer-source-availability"
                className={`shrink-0 rounded-full border px-2 py-0.5 text-[10px] font-medium ${sourceAvail.badgeClass}`}
              >
                {sourceAvail.badgeText}
              </span>
            </div>

            {/* Gain (0–200%) + Mute */}
            <div className="mt-3 flex items-center gap-2">
              <button
                type="button"
                data-testid="mixer-source-mute-button"
                aria-label={
                  state.sourceChannel.muted
                    ? 'Unmute video audio'
                    : 'Mute video audio'
                }
                aria-pressed={state.sourceChannel.muted}
                onClick={toggleSourceMute}
                className={
                  state.sourceChannel.muted
                    ? 'inline-flex min-h-8 shrink-0 items-center gap-1 rounded-md border border-rose-400/50 bg-rose-950/75 px-2 py-1 text-xs font-medium text-rose-100 hover:bg-rose-900/80 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky-400'
                    : 'inline-flex min-h-8 shrink-0 items-center gap-1 rounded-md border border-slate-700 bg-slate-900 px-2 py-1 text-xs font-medium text-slate-100 hover:bg-slate-800 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky-400'
                }
              >
                {state.sourceChannel.muted ||
                state.sourceChannel.gain === 0 ? (
                  <VolumeMutedIcon className="h-3.5 w-3.5 text-rose-300" />
                ) : (
                  <VolumeHighIcon className="h-3.5 w-3.5 text-sky-300" />
                )}
                <span>{state.sourceChannel.muted ? 'Muted' : 'Mute'}</span>
              </button>

              <label htmlFor="mixer-source-gain-slider" className="sr-only">
                Video audio gain
              </label>
              <input
                id="mixer-source-gain-slider"
                data-testid="mixer-source-gain-slider"
                type="range"
                min={MIN_AUDIO_GAIN}
                max={MAX_AUDIO_GAIN}
                step={0.01}
                value={state.sourceChannel.gain}
                aria-valuetext={
                  state.sourceChannel.muted
                    ? `Muted (${sourceGainPercent} percent)`
                    : `${sourceGainPercent} percent`
                }
                onChange={handleSourceGainChange}
                className="h-2 min-w-0 flex-1 cursor-pointer rounded-lg bg-slate-800"
              />

              <span
                data-testid="mixer-source-gain-value"
                className="min-w-[3.1rem] text-right font-mono text-xs font-semibold text-slate-100 tabular-nums"
              >
                {state.sourceChannel.muted ? 'Muted' : `${sourceGainPercent}%`}
              </span>

              {sourceGainPercent !== 100 && (
                <button
                  type="button"
                  data-testid="mixer-source-unity-button"
                  aria-label="Reset video audio gain to 100%"
                  onClick={resetSourceGain}
                  className="rounded border border-slate-700 bg-slate-900 px-1.5 py-0.5 font-mono text-[10px] font-medium text-sky-300 hover:bg-slate-800 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky-400"
                >
                  100%
                </button>
              )}
            </div>
          </div>

          <SourcePostGainMeter />
        </div>

        {/* Channel 2: Microphone */}
        <div
          data-testid="mixer-mic-channel"
          className="flex min-w-0 flex-col justify-between rounded-lg border border-slate-800 bg-slate-950 p-3"
        >
          <div>
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <div className="flex items-center gap-1.5 text-xs font-semibold text-slate-100">
                  <MicrophoneIcon className="h-3.5 w-3.5 shrink-0 text-emerald-300" />
                  <span>Microphone</span>
                </div>
                <p
                  data-testid="mixer-mic-name"
                  className="mt-0.5 truncate text-[11px] text-slate-300"
                  title={state.microphoneLabel ?? 'No active microphone'}
                >
                  {state.microphoneLabel ?? 'No active microphone'}
                </p>
              </div>

              <span
                data-testid="mixer-mic-availability"
                className={`shrink-0 rounded-full border px-2 py-0.5 text-[10px] font-medium ${micAvail.badgeClass}`}
              >
                {micAvail.badgeText}
              </span>
            </div>

            {/* Gain (0–200%) + Mute */}
            <div className="mt-3 flex items-center gap-2">
              <button
                type="button"
                data-testid="mixer-mic-mute-button"
                aria-label={
                  state.microphoneChannel.muted
                    ? 'Unmute microphone in mix'
                    : 'Mute microphone in mix'
                }
                aria-pressed={state.microphoneChannel.muted}
                onClick={toggleMicrophoneMute}
                className={
                  state.microphoneChannel.muted
                    ? 'inline-flex min-h-8 shrink-0 items-center gap-1 rounded-md border border-rose-400/50 bg-rose-950/75 px-2 py-1 text-xs font-medium text-rose-100 hover:bg-rose-900/80 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky-400'
                    : 'inline-flex min-h-8 shrink-0 items-center gap-1 rounded-md border border-slate-700 bg-slate-900 px-2 py-1 text-xs font-medium text-slate-100 hover:bg-slate-800 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky-400'
                }
              >
                {state.microphoneChannel.muted ||
                state.microphoneChannel.gain === 0 ? (
                  <VolumeMutedIcon className="h-3.5 w-3.5 text-rose-300" />
                ) : (
                  <VolumeHighIcon className="h-3.5 w-3.5 text-emerald-300" />
                )}
                <span>{state.microphoneChannel.muted ? 'Muted' : 'Mute'}</span>
              </button>

              <label htmlFor="mixer-mic-gain-slider" className="sr-only">
                Microphone mix gain
              </label>
              <input
                id="mixer-mic-gain-slider"
                data-testid="mixer-mic-gain-slider"
                type="range"
                min={MIN_AUDIO_GAIN}
                max={MAX_AUDIO_GAIN}
                step={0.01}
                value={state.microphoneChannel.gain}
                aria-valuetext={
                  state.microphoneChannel.muted
                    ? `Muted (${micGainPercent} percent)`
                    : `${micGainPercent} percent`
                }
                onChange={handleMicGainChange}
                className="h-2 min-w-0 flex-1 cursor-pointer rounded-lg bg-slate-800"
              />

              <span
                data-testid="mixer-mic-gain-value"
                className="min-w-[3.1rem] text-right font-mono text-xs font-semibold text-slate-100 tabular-nums"
              >
                {state.microphoneChannel.muted ? 'Muted' : `${micGainPercent}%`}
              </span>

              {micGainPercent !== 100 && (
                <button
                  type="button"
                  data-testid="mixer-mic-unity-button"
                  aria-label="Reset microphone gain to 100%"
                  onClick={resetMicrophoneGain}
                  className="rounded border border-slate-700 bg-slate-900 px-1.5 py-0.5 font-mono text-[10px] font-medium text-sky-300 hover:bg-slate-800 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky-400"
                >
                  100%
                </button>
              )}
            </div>
          </div>

          <MicrophonePostGainMeter />
        </div>
      </div>

      <p className="mt-2.5 text-[11px] text-slate-300">
        Video audio monitors to speakers once; microphone routes exclusively to
        the mixed recording bus with zero speaker feedback.
      </p>
    </section>
  );
}

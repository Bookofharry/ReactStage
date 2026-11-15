import { useState, type ChangeEvent } from 'react';
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
  BroadcastWaveIcon,
  ChevronDownIcon,
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
        classes: 'border-white/10 bg-slate-800 text-slate-300',
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
        classes: 'border-white/10 bg-slate-800 text-slate-300',
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
        classes: 'border-white/10 bg-slate-800 text-slate-300',
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
        badgeClass: 'border-white/10 bg-slate-800 text-slate-300',
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
        badgeClass: 'border-white/10 bg-slate-800 text-slate-300',
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
    ? `${String(meters.masterLevelPercent)} percent (clipping)`
    : `${String(meters.masterLevelPercent)} percent`;

  return (
    <div className="flex w-full items-center gap-2 rounded-xl border border-white/[0.06] bg-slate-900/80 px-2.5 py-1.5">
      <span className="shrink-0 text-[11px] font-medium text-slate-300">
        Mix Output
      </span>
      <div
        role="meter"
        aria-label="Combined mix output level"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={meters.masterLevelPercent}
        aria-valuetext={valueText}
        data-testid="mixer-master-meter"
        className="h-2 min-w-[4rem] flex-1 overflow-hidden rounded-full bg-slate-800"
      >
        <div
          data-testid="mixer-master-meter-fill"
          style={{ width: `${String(meters.masterLevelPercent)}%` }}
          className={`h-full rounded-full ${fillClass}`}
        />
      </div>
      <span
        data-testid="mixer-master-level-value"
        className="min-w-[2.4rem] shrink-0 text-right font-mono text-[11px] font-semibold text-slate-100 tabular-nums"
      >
        {meters.masterLevelPercent}%
      </span>
      {meters.clipping && (
        <span
          data-testid="mixer-master-clip-badge"
          className="shrink-0 rounded bg-rose-500/20 px-1.5 py-0.5 font-mono text-[10px] font-semibold text-rose-200"
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
    ? `${String(meters.sourceLevelPercent)} percent (clipping)`
    : `${String(meters.sourceLevelPercent)} percent`;

  return (
    <div className="mt-2.5 border-t border-white/[0.06] pt-2">
      <div className="flex items-center justify-between gap-2 text-[11px]">
        <span className="text-slate-300">Video Level</span>
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
          style={{ width: `${String(meters.sourceLevelPercent)}%` }}
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
    ? `${String(meters.microphoneLevelPercent)} percent (clipping)`
    : `${String(meters.microphoneLevelPercent)} percent`;

  return (
    <div className="mt-2.5 border-t border-white/[0.06] pt-2">
      <div className="flex items-center justify-between gap-2 text-[11px]">
        <span className="text-slate-300">Mic Level</span>
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
          style={{ width: `${String(meters.microphoneLevelPercent)}%` }}
          className={`h-full rounded-full ${fillClass}`}
        />
      </div>
    </div>
  );
}

function SourceAutoDuckBadge() {
  const meters = useAudioMixerMeters();
  if (!meters.isDucking) {
    return null;
  }
  return (
    <span
      data-testid="mixer-autoduck-active-badge"
      className="rounded-full border border-amber-400/40 bg-amber-400/10 px-2 py-0.5 font-mono text-[10px] font-semibold text-amber-200"
    >
      DUCKING {Math.round(meters.duckGainMultiplier * 100)}%
    </span>
  );
}

export function AudioMixerPanel() {
  const {
    state,
    setSourceGain,
    toggleSourceMute,
    resetSourceGain,
    setMicrophoneGain,
    toggleMicrophoneMute,
    resetMicrophoneGain,
    toggleAutoDuck,
    toggleMicProcessing,
  } = useAudioMixer();
  const [showChannelMeters, setShowChannelMeters] = useState(false);

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
      className="min-w-0 rounded-xl border border-white/[0.07] bg-slate-950/65 p-3"
    >
      {/* Header & Combined Output State */}
      <div className="flex flex-col gap-2.5 border-b border-white/[0.07] pb-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex min-w-0 flex-wrap items-center gap-1.5">
            <AudioMixerIcon className="h-4 w-4 text-sky-300" />
            <h2
              id="audio-mixer-heading"
              className="text-sm font-semibold text-white"
            >
              Audio Mix &amp; Voice
            </h2>
          </div>

          <div className="flex flex-wrap items-center gap-1.5">
            <span
              data-testid="mixer-mode-badge"
              className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-medium ${modeBadge.classes}`}
            >
              {modeBadge.label}
            </span>
            <span
              data-testid="mixer-status-badge"
              className={`inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-[11px] font-medium ${statusBadge.classes}`}
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
                className="sr-only"
              >
                {state.outputTrackCount}{' '}
                {state.outputTrackCount === 1 ? 'Mix Track' : 'Mix Tracks'}
              </span>
            )}
          </div>
        </div>

        <MasterOutputMeterReadout />
      </div>

      {/* Runtime Audio Mixer Error Alert */}
      {runtimeError && (
        <div
          role="alert"
          data-testid="mixer-error-alert"
          className="mt-3 flex items-start gap-2 rounded-xl border border-rose-500/40 bg-rose-950/75 p-3 text-xs text-rose-100"
        >
          <AlertIcon className="mt-0.5 h-4 w-4 shrink-0 text-rose-300" />
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="font-semibold">{runtimeError.title}</span>
              <span className="rounded bg-rose-900/90 px-1.5 py-0.5 font-mono text-[10px] text-rose-200">
                {runtimeError.code}
              </span>
            </div>
            <p className="mt-0.5 text-[11px] leading-relaxed text-rose-100 break-words">
              {runtimeError.message}
            </p>
          </div>
        </div>
      )}

      {/* Smart Creator Audio Enhancements Up Front */}
      <div className="mt-3 flex flex-col gap-2">
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-white/[0.06] bg-slate-900/75 p-2.5">
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-1.5">
              <p className="text-xs font-semibold text-white">
                Auto-Duck Video
              </p>
              <SourceAutoDuckBadge />
            </div>
            <p className="mt-0.5 text-[11px] leading-snug text-slate-300">
              Lowers video volume automatically while you speak
            </p>
          </div>
          <button
            type="button"
            data-testid="mixer-autoduck-toggle"
            aria-pressed={state.autoDuckEnabled}
            onClick={toggleAutoDuck}
            className={
              state.autoDuckEnabled
                ? 'inline-flex min-h-9 shrink-0 items-center gap-1.5 rounded-lg bg-sky-400 px-3 py-1.5 text-xs font-semibold text-slate-950 hover:bg-sky-300 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky-300'
                : 'inline-flex min-h-9 shrink-0 items-center gap-1.5 rounded-lg border border-white/10 bg-slate-950 px-3 py-1.5 text-xs font-medium text-slate-100 hover:bg-slate-800 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky-400'
            }
          >
            <BroadcastWaveIcon className="h-3.5 w-3.5 shrink-0" />
            <span>{state.autoDuckEnabled ? 'On' : 'Turn On'}</span>
          </button>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-white/[0.06] bg-slate-900/75 p-2.5">
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-1.5">
              <p className="text-xs font-semibold text-white">Voice Clarity</p>
              {state.micProcessingEnabled && (
                <span
                  data-testid="mixer-mic-processing-badge"
                  className="rounded-full border border-emerald-400/40 bg-emerald-400/10 px-2 py-0.5 font-mono text-[10px] font-semibold text-emerald-200"
                >
                  Active
                </span>
              )}
            </div>
            <p className="mt-0.5 text-[11px] leading-snug text-slate-300">
              Cuts background rumble &amp; balances loud peaks
            </p>
          </div>
          <button
            type="button"
            data-testid="mixer-mic-processing-toggle"
            aria-pressed={state.micProcessingEnabled}
            onClick={toggleMicProcessing}
            className={
              state.micProcessingEnabled
                ? 'inline-flex min-h-9 shrink-0 items-center gap-1.5 rounded-lg bg-emerald-400 px-3 py-1.5 text-xs font-semibold text-slate-950 hover:bg-emerald-300 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-300'
                : 'inline-flex min-h-9 shrink-0 items-center gap-1.5 rounded-lg border border-white/10 bg-slate-950 px-3 py-1.5 text-xs font-medium text-slate-100 hover:bg-slate-800 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky-400'
            }
          >
            <BroadcastWaveIcon className="h-3.5 w-3.5 shrink-0" />
            <span>{state.micProcessingEnabled ? 'On' : 'Turn On'}</span>
          </button>
        </div>
      </div>

      {/* Stacked Channel Volume Sliders */}
      <div className="mt-3 flex flex-col gap-2.5">
        {/* Channel 1: Video Audio */}
        <div
          data-testid="mixer-source-channel"
          className="flex min-w-0 flex-col rounded-xl border border-white/[0.06] bg-slate-900/75 p-2.5"
        >
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-1.5 text-xs font-semibold text-white">
                <LayoutSourceIcon className="h-3.5 w-3.5 shrink-0 text-sky-300" />
                <span>Video Volume</span>
              </div>
              <p
                data-testid="mixer-source-name"
                className="mt-0.5 text-[11px] leading-snug text-slate-300 break-words"
                title={state.sourceLabel ?? 'No video loaded yet'}
              >
                {state.sourceLabel ?? 'No video loaded yet'}
              </p>
            </div>

            <span
              data-testid="mixer-source-availability"
              className={`shrink-0 rounded-full border px-2 py-0.5 text-[10px] font-medium ${sourceAvail.badgeClass}`}
            >
              {sourceAvail.badgeText}
            </span>
          </div>

          <div className="mt-2.5 flex flex-wrap items-center gap-2">
            <button
              type="button"
              data-testid="mixer-source-mute-button"
              aria-label={
                state.sourceChannel.muted
                  ? 'Unmute video audio (Muted)'
                  : 'Mute video audio'
              }
              aria-pressed={state.sourceChannel.muted}
              onClick={toggleSourceMute}
              className={
                state.sourceChannel.muted
                  ? 'inline-flex min-h-9 shrink-0 items-center gap-1 rounded-lg border border-rose-400/50 bg-rose-950/75 px-2.5 py-1.5 text-xs font-medium text-rose-100 hover:bg-rose-900/80 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky-400'
                  : 'inline-flex min-h-9 shrink-0 items-center gap-1 rounded-lg border border-white/10 bg-slate-950 px-2.5 py-1.5 text-xs font-medium text-slate-100 hover:bg-slate-800 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky-400'
              }
            >
              {state.sourceChannel.muted || state.sourceChannel.gain === 0 ? (
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
                  ? `Muted (${String(sourceGainPercent)} percent)`
                  : `${String(sourceGainPercent)} percent`
              }
              onChange={handleSourceGainChange}
              className="min-w-[5rem] flex-1 cursor-pointer rounded-lg bg-slate-800"
            />

            <span
              data-testid="mixer-source-gain-value"
              className="min-w-[3rem] text-right font-mono text-xs font-semibold text-slate-100 tabular-nums"
            >
              {state.sourceChannel.muted
                ? 'Muted'
                : `${String(sourceGainPercent)}%`}
            </span>

            {sourceGainPercent !== 100 && (
              <button
                type="button"
                data-testid="mixer-source-unity-button"
                aria-label="Reset video volume to 100%"
                onClick={resetSourceGain}
                className="inline-flex min-h-8 items-center justify-center rounded-lg border border-white/10 bg-slate-950 px-2 py-1 text-[11px] font-medium text-sky-300 hover:bg-slate-800 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky-400"
              >
                Reset
              </button>
            )}
          </div>

          {showChannelMeters && <SourcePostGainMeter />}
        </div>

        {/* Channel 2: Microphone */}
        <div
          data-testid="mixer-mic-channel"
          className="flex min-w-0 flex-col rounded-xl border border-white/[0.06] bg-slate-900/75 p-2.5"
        >
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-1.5 text-xs font-semibold text-white">
                <MicrophoneIcon className="h-3.5 w-3.5 shrink-0 text-emerald-300" />
                <span>Mic Volume</span>
              </div>
              <p
                data-testid="mixer-mic-name"
                className="mt-0.5 text-[11px] leading-snug text-slate-300 break-words"
                title={state.microphoneLabel ?? 'Microphone is off'}
              >
                {state.microphoneLabel ?? 'Microphone is off'}
              </p>
            </div>

            <span
              data-testid="mixer-mic-availability"
              className={`shrink-0 rounded-full border px-2 py-0.5 text-[10px] font-medium ${micAvail.badgeClass}`}
            >
              {micAvail.badgeText}
            </span>
          </div>

          <div className="mt-2.5 flex flex-wrap items-center gap-2">
            <button
              type="button"
              data-testid="mixer-mic-mute-button"
              aria-label={
                state.microphoneChannel.muted
                  ? 'Unmute microphone in mix (Muted)'
                  : 'Mute microphone in mix'
              }
              aria-pressed={state.microphoneChannel.muted}
              onClick={toggleMicrophoneMute}
              className={
                state.microphoneChannel.muted
                  ? 'inline-flex min-h-9 shrink-0 items-center gap-1 rounded-lg border border-rose-400/50 bg-rose-950/75 px-2.5 py-1.5 text-xs font-medium text-rose-100 hover:bg-rose-900/80 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky-400'
                  : 'inline-flex min-h-9 shrink-0 items-center gap-1 rounded-lg border border-white/10 bg-slate-950 px-2.5 py-1.5 text-xs font-medium text-slate-100 hover:bg-slate-800 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky-400'
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
                  ? `Muted (${String(micGainPercent)} percent)`
                  : `${String(micGainPercent)} percent`
              }
              onChange={handleMicGainChange}
              className="min-w-[5rem] flex-1 cursor-pointer rounded-lg bg-slate-800"
            />

            <span
              data-testid="mixer-mic-gain-value"
              className="min-w-[3rem] text-right font-mono text-xs font-semibold text-slate-100 tabular-nums"
            >
              {state.microphoneChannel.muted
                ? 'Muted'
                : `${String(micGainPercent)}%`}
            </span>

            {micGainPercent !== 100 && (
              <button
                type="button"
                data-testid="mixer-mic-unity-button"
                aria-label="Reset microphone volume to 100%"
                onClick={resetMicrophoneGain}
                className="inline-flex min-h-8 items-center justify-center rounded-lg border border-white/10 bg-slate-950 px-2 py-1 text-[11px] font-medium text-sky-300 hover:bg-slate-800 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky-400"
              >
                Reset
              </button>
            )}
          </div>

          {showChannelMeters && <MicrophonePostGainMeter />}
        </div>
      </div>

      {/* Progressive Disclosure for Channel Level Meters */}
      <div className="mt-2.5 flex items-center justify-between gap-2">
        <button
          type="button"
          data-testid="toggle-audio-meters-button"
          aria-expanded={showChannelMeters}
          onClick={() => setShowChannelMeters((prev) => !prev)}
          className="inline-flex min-h-8 items-center gap-1 rounded-lg px-2 py-1 text-[11px] font-medium text-slate-300 hover:bg-white/[0.05] hover:text-white focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-sky-400"
        >
          <ChevronDownIcon
            className={`h-3.5 w-3.5 transition-transform ${
              showChannelMeters ? 'rotate-180' : ''
            }`}
          />
          <span>
            {showChannelMeters ? 'Hide channel meters' : 'Show channel meters'}
          </span>
        </button>
      </div>
    </section>
  );
}

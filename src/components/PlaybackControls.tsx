import type { ChangeEvent } from 'react';
import {
  MAX_AUDIO_GAIN,
  MIN_AUDIO_GAIN,
} from '../services/interfaces/audio-mixer';
import { useAudioMixer } from '../state/AudioMixerContext';
import { useSourcePlayback } from '../state/PlaybackContext';
import { useRecordingTelemetry } from '../state/RecordingSessionContext';
import {
  SUPPORTED_PLAYBACK_SPEEDS,
  type PlaybackSpeed,
} from '../types/media';
import { formatSpokenDuration, formatTimecode } from '../utils/format';
import {
  PauseIcon,
  PlayIcon,
  RestartIcon,
  RewindIcon,
  VolumeHighIcon,
  VolumeMutedIcon,
} from './StudioIcons';

function TransportRecordingTimeBadge() {
  const telemetry = useRecordingTelemetry();
  return (
    <span
      data-testid="transport-recording-time"
      className="rounded-md border border-white/[0.08] bg-slate-950/85 px-2 py-0.5 font-mono text-xs text-amber-300 tabular-nums"
    >
      {formatTimecode(telemetry.elapsedRecordingMs / 1000, true)}
    </span>
  );
}

export function PlaybackControls() {
  const {
    state,
    togglePlayPause,
    seek,
    rewind,
    restart,
    setPlaybackRate,
  } = useSourcePlayback();
  const {
    state: mixerState,
    enableAudio,
    setSourceGain,
    toggleSourceMute,
  } = useAudioMixer();

  const isPlayable =
    state.status === 'ready' ||
    state.status === 'playing' ||
    state.status === 'paused' ||
    state.status === 'ended';

  const isScreenMode = state.sourceMode === 'screen';
  const canScrubTimeline = isPlayable && !isScreenMode;
  const isPlaying = state.status === 'playing';
  const sliderMax =
    !isScreenMode && state.durationSec > 0 ? state.durationSec : 0;

  const handleSeekChange = (event: ChangeEvent<HTMLInputElement>) => {
    seek(Number(event.currentTarget.value));
  };

  const handleSpeedChange = (event: ChangeEvent<HTMLSelectElement>) => {
    const parsed = Number(event.currentTarget.value) as PlaybackSpeed;
    setPlaybackRate(parsed);
  };

  const handleVolumeChange = (event: ChangeEvent<HTMLInputElement>) => {
    setSourceGain(Number(event.currentTarget.value));
  };

  const handlePlayPauseClick = () => {
    if (!isPlaying && mixerState.status === 'suspended') {
      void enableAudio();
    }
    void togglePlayPause();
  };

  const sourceGain = mixerState.sourceChannel.gain;
  const sourceMuted = mixerState.sourceChannel.muted;
  const effectiveVolumePercent = sourceMuted
    ? 0
    : Math.round(sourceGain * 100);

  return (
    <section
      data-testid="source-playback-controls"
      aria-labelledby="playback-controls-heading"
      className="min-w-0 rounded-2xl border border-slate-800/80 bg-slate-900/55 px-3 py-2.5 min-[375px]:px-3.5 sm:px-4"
    >
      <h2 id="playback-controls-heading" className="sr-only">
        Source Video Transport
      </h2>
      <div className="sr-only">
        <TransportRecordingTimeBadge />
      </div>

      <div className="flex flex-col gap-2">
        {/* Mild Inline Scrubber & Timestamp */}
        <div className="flex items-center gap-3">
          <label htmlFor="source-seek-slider" className="sr-only">
            Seek source video
          </label>
          <input
            id="source-seek-slider"
            data-testid="seek-slider"
            type="range"
            min={0}
            max={sliderMax}
            step={0.05}
            value={canScrubTimeline ? state.currentTimeSec : 0}
            disabled={!canScrubTimeline}
            aria-valuetext={
              isScreenMode
                ? 'Live screen capture stream'
                : `${formatSpokenDuration(state.currentTimeSec)} of ${formatSpokenDuration(state.durationSec)}`
            }
            onChange={handleSeekChange}
            className="min-w-0 flex-1 cursor-pointer rounded-lg bg-slate-800 disabled:cursor-not-allowed disabled:opacity-40"
          />

          <span
            data-testid="source-playback-time"
            className="shrink-0 font-mono text-xs text-slate-300 tabular-nums"
          >
            {isScreenMode
              ? state.status === 'paused'
                ? 'Live Frozen'
                : 'Live Stream'
              : `${formatTimecode(state.currentTimeSec, true)} / ${formatTimecode(state.durationSec, true)}`}
          </span>
        </div>

        {/* Basic Single-Row Mobile Player (< sm: Play · -10s · Mute) + Full Desktop Bar (sm:) */}
        <div className="flex items-center justify-between gap-2 sm:flex-wrap">
          <div className="flex min-w-0 flex-1 items-center gap-1.5 sm:flex-initial sm:flex-wrap">
            <button
              type="button"
              data-testid="play-pause-button"
              disabled={!isPlayable}
              aria-label={
                isScreenMode
                  ? isPlaying
                    ? 'Freeze live screen frame'
                    : 'Resume live screen stream'
                  : isPlaying
                    ? 'Pause source video'
                    : 'Play source video'
              }
              onClick={handlePlayPauseClick}
              className="inline-flex min-h-11 flex-1 items-center justify-center gap-1.5 rounded-xl bg-sky-400 px-4 py-2 text-xs font-semibold text-slate-950 hover:bg-sky-300 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky-300 disabled:cursor-not-allowed disabled:border disabled:border-slate-800 disabled:bg-slate-900 disabled:text-slate-400 sm:min-h-9 sm:flex-initial sm:px-3.5 sm:py-1.5"
            >
              {isPlaying ? (
                <>
                  <PauseIcon className="h-4 w-4 sm:h-3.5 sm:w-3.5" />
                  <span>{isScreenMode ? 'Freeze' : 'Pause'}</span>
                </>
              ) : (
                <>
                  <PlayIcon className="h-4 w-4 sm:h-3.5 sm:w-3.5" />
                  <span>{isScreenMode && isPlayable ? 'Resume' : 'Play'}</span>
                </>
              )}
            </button>

            <button
              type="button"
              data-testid="rewind-button"
              disabled={!canScrubTimeline}
              aria-label="Rewind -10s"
              onClick={() => rewind(10)}
              className="inline-flex min-h-11 shrink-0 items-center justify-center gap-1 rounded-xl border border-slate-800 bg-slate-950/70 px-3 py-2 text-xs text-slate-200 hover:bg-slate-800 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky-400 disabled:cursor-not-allowed disabled:opacity-45 sm:min-h-9 sm:px-2.5 sm:py-1.5"
            >
              <RewindIcon className="h-3.5 w-3.5" />
              <span>-10s</span>
            </button>

            <button
              type="button"
              data-testid="restart-button"
              disabled={!canScrubTimeline}
              aria-label="Restart source video from beginning"
              onClick={restart}
              className="hidden min-h-9 items-center justify-center gap-1 rounded-xl border border-slate-800 bg-slate-950/70 px-2.5 py-1.5 text-xs text-slate-200 hover:bg-slate-800 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky-400 disabled:cursor-not-allowed disabled:opacity-45 sm:inline-flex"
            >
              <RestartIcon className="h-3.5 w-3.5" />
              <span>Restart</span>
            </button>
          </div>

          <div className="flex shrink-0 items-center gap-2 sm:min-w-0 sm:flex-wrap">
            <label htmlFor="playback-speed-select" className="sr-only">
              Playback speed
            </label>
            <select
              id="playback-speed-select"
              data-testid="playback-speed-select"
              disabled={isScreenMode}
              value={state.playbackRate}
              onChange={handleSpeedChange}
              className="hidden min-h-9 rounded-xl border border-slate-800 bg-slate-950/70 px-2.5 py-1 font-mono text-xs text-slate-200 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky-400 disabled:cursor-not-allowed disabled:opacity-45 sm:block"
            >
              {SUPPORTED_PLAYBACK_SPEEDS.map((speed) => (
                <option key={speed} value={speed}>
                  {speed}x
                </option>
              ))}
            </select>

            <div className="flex items-center gap-1.5 rounded-xl border border-slate-800 bg-slate-950/70 p-0.5 sm:min-h-9 sm:px-2 sm:py-1">
              <button
                type="button"
                data-testid="mute-toggle-button"
                aria-label={
                  sourceMuted ? 'Unmute source audio' : 'Mute source audio'
                }
                aria-pressed={sourceMuted}
                onClick={toggleSourceMute}
                className="inline-flex min-h-10 min-w-10 shrink-0 items-center justify-center rounded-lg text-slate-200 hover:bg-slate-800 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky-400 sm:min-h-7 sm:min-w-7"
              >
                {sourceMuted || sourceGain === 0 ? (
                  <VolumeMutedIcon className="h-4 w-4 text-rose-300" />
                ) : (
                  <VolumeHighIcon className="h-4 w-4 text-sky-300" />
                )}
              </button>

              <label htmlFor="source-volume-slider" className="sr-only">
                Source volume
              </label>
              <input
                id="source-volume-slider"
                data-testid="volume-slider"
                type="range"
                min={MIN_AUDIO_GAIN}
                max={MAX_AUDIO_GAIN}
                step={0.01}
                value={sourceGain}
                aria-valuetext={
                  sourceMuted
                    ? `Muted (${Math.round(sourceGain * 100)} percent)`
                    : `${effectiveVolumePercent} percent`
                }
                onChange={handleVolumeChange}
                className="hidden cursor-pointer rounded-lg bg-slate-800 sm:block sm:w-20"
              />

              <span
                data-testid="volume-display"
                className="hidden min-w-[2.75rem] shrink-0 text-right font-mono text-[11px] text-slate-300 tabular-nums sm:inline"
              >
                {sourceMuted ? 'Muted' : `${effectiveVolumePercent}%`}
              </span>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

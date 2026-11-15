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
      className="min-w-0 rounded-2xl border border-white/[0.08] bg-slate-900/75 px-3 py-2.5 shadow-xl shadow-black/30 backdrop-blur-md min-[375px]:px-3.5 sm:px-4 sm:py-3"
    >
      <h2 id="playback-controls-heading" className="sr-only">
        Source Video Transport
      </h2>

      <div className="flex flex-col gap-2.5">
        {/* Scrubber & Independent Video vs. Recording Clocks */}
        <div className="flex flex-col gap-1.5">
          <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
            <div className="flex flex-wrap items-center gap-1.5 sm:gap-2">
              <span className="font-semibold text-sky-300">Video Player</span>
              <span
                data-testid="source-playback-time"
                className="font-mono font-semibold text-slate-100 tabular-nums"
              >
                {isScreenMode
                  ? state.status === 'paused'
                    ? 'Live Frozen'
                    : 'Live Stream'
                  : `${formatTimecode(state.currentTimeSec, true)} / ${formatTimecode(state.durationSec, true)}`}
              </span>
            </div>

            <div className="flex flex-wrap items-center gap-1.5 text-slate-300">
              <span>Rec</span>
              <TransportRecordingTimeBadge />
            </div>
          </div>

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
            className="w-full cursor-pointer rounded-lg bg-slate-800 disabled:cursor-not-allowed disabled:opacity-50"
          />
        </div>

        {/* Transport Buttons, Speed & Video Volume */}
        <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center sm:justify-between sm:gap-3">
          <div className="grid grid-cols-2 gap-1.5 min-[420px]:flex min-[420px]:flex-wrap min-[420px]:items-center">
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
              className="col-span-2 inline-flex min-h-10 items-center justify-center gap-2 rounded-xl bg-sky-400 px-4 py-2 text-sm font-semibold text-slate-950 shadow-xs hover:bg-sky-300 active:bg-sky-300 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky-300 disabled:cursor-not-allowed disabled:bg-slate-800 disabled:text-slate-400 min-[420px]:col-span-1"
            >
              {isPlaying ? (
                <>
                  <PauseIcon className="h-4 w-4" />
                  <span>{isScreenMode ? 'Freeze' : 'Pause'}</span>
                </>
              ) : (
                <>
                  <PlayIcon className="h-4 w-4" />
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
              className="inline-flex min-h-10 items-center justify-center gap-1.5 rounded-xl border border-white/10 bg-slate-950/80 px-3 py-2 text-xs font-medium text-slate-100 hover:bg-slate-800 active:bg-slate-700 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky-400 disabled:cursor-not-allowed disabled:opacity-50"
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
              className="inline-flex min-h-10 items-center justify-center gap-1.5 rounded-xl border border-white/10 bg-slate-950/80 px-3 py-2 text-xs font-medium text-slate-100 hover:bg-slate-800 active:bg-slate-700 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky-400 disabled:cursor-not-allowed disabled:opacity-50"
            >
              <RestartIcon className="h-3.5 w-3.5" />
              <span>Restart</span>
            </button>
          </div>

          <div className="flex min-w-0 flex-wrap items-center gap-2">
            {/* Speed Selector */}
            <div className="flex min-h-10 items-center gap-1.5 rounded-xl border border-white/[0.08] bg-slate-950/85 px-2.5 py-1">
              <label
                htmlFor="playback-speed-select"
                className="text-xs font-medium text-slate-300"
              >
                Speed
              </label>
              <select
                id="playback-speed-select"
                data-testid="playback-speed-select"
                disabled={isScreenMode}
                value={state.playbackRate}
                onChange={handleSpeedChange}
                className="min-h-8 rounded bg-slate-900 px-1.5 py-0.5 font-mono text-xs font-semibold text-slate-100 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky-400 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {SUPPORTED_PLAYBACK_SPEEDS.map((speed) => (
                  <option key={speed} value={speed}>
                    {speed}x
                  </option>
                ))}
              </select>
            </div>

            {/* Video Volume & Mute */}
            <div className="flex min-h-10 min-w-0 flex-1 items-center gap-2 rounded-xl border border-white/[0.08] bg-slate-950/85 px-2.5 py-1 sm:flex-initial">
              <button
                type="button"
                data-testid="mute-toggle-button"
                aria-label={
                  sourceMuted ? 'Unmute source audio' : 'Mute source audio'
                }
                aria-pressed={sourceMuted}
                onClick={toggleSourceMute}
                className="inline-flex min-h-8 min-w-8 shrink-0 items-center justify-center rounded-lg text-slate-100 transition hover:bg-slate-800 active:bg-slate-800 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky-400"
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
                className="min-w-[4.5rem] flex-1 cursor-pointer rounded-lg bg-slate-800 sm:w-24 sm:flex-initial"
              />

              <span
                data-testid="volume-display"
                className="min-w-[3rem] shrink-0 text-right font-mono text-xs font-medium text-slate-100 tabular-nums"
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

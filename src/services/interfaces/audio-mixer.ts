export const MIN_AUDIO_GAIN = 0;
export const MAX_AUDIO_GAIN = 2;
export const DEFAULT_AUDIO_GAIN = 1;
export const CLIPPING_PEAK_THRESHOLD = 0.98;

export interface AudioChannelConfig {
  readonly gain: number;
  readonly muted: boolean;
}

export type AudioMixerStatus =
  | 'idle'
  | 'suspended'
  | 'running'
  | 'unavailable'
  | 'error';

export type AudioMixMode =
  | 'combined'
  | 'source-only'
  | 'microphone-only'
  | 'silent';

export type SourceAudioAvailability =
  | 'no-source'
  | 'no-audio-track'
  | 'ready'
  | 'playing'
  | 'paused';

export type MicrophoneAudioAvailability =
  | 'off'
  | 'live'
  | 'muted-hardware'
  | 'ended';

export type AudioMixerErrorCode =
  | 'WEB_AUDIO_UNSUPPORTED'
  | 'CONTEXT_INIT_FAILED'
  | 'CONTEXT_RESUME_FAILED'
  | 'MEDIA_ELEMENT_BIND_FAILED'
  | 'MIC_STREAM_ATTACH_FAILED';

export interface AudioMixerError {
  readonly code: AudioMixerErrorCode;
  readonly title: string;
  readonly message: string;
  readonly recoverable: boolean;
}

export interface SourceAudioDescriptor {
  readonly hasSource: boolean;
  readonly isPlaying?: boolean;
  readonly isPaused?: boolean;
  readonly label?: string | null;
  readonly hasAudioTrack?: boolean | null;
}

export interface AudioMixerStateSnapshot {
  readonly status: AudioMixerStatus;
  readonly mixMode: AudioMixMode;
  readonly requiresUserGesture: boolean;
  readonly sourceChannel: AudioChannelConfig;
  readonly microphoneChannel: AudioChannelConfig;
  readonly autoDuckEnabled: boolean;
  readonly micProcessingEnabled: boolean;
  readonly sourceAvailability: SourceAudioAvailability;
  readonly sourceLabel: string | null;
  readonly microphoneAvailability: MicrophoneAudioAvailability;
  readonly microphoneLabel: string | null;
  readonly hasMixedOutput: boolean;
  readonly outputTrackCount: number;
  readonly isSourceElementBound: boolean;
  readonly error: AudioMixerError | null;
}

export interface AudioMeterSnapshot {
  readonly sourceRms: number;
  readonly sourcePeak: number;
  readonly sourceLevelPercent: number;
  readonly sourceClipping: boolean;
  readonly microphoneRms: number;
  readonly microphonePeak: number;
  readonly microphoneLevelPercent: number;
  readonly microphoneClipping: boolean;
  readonly masterRms: number;
  readonly masterPeak: number;
  readonly masterLevelPercent: number;
  readonly clipping: boolean;
  readonly isDucking: boolean;
  readonly duckGainMultiplier: number;
}

/**
 * Service contract for Web Audio API mixing of local source media playback
 * and creator commentary microphone into one stable `MediaStreamAudioDestinationNode`
 * output without local microphone-to-speaker feedback loops.
 *
 * Ownership & Routing Invariants:
 * 1. `SourcePlayer` owns the `HTMLVideoElement` and its `blob:` Object URLs;
 *    `AudioMixer` borrows the element read-only, associates at most one
 *    `MediaElementAudioSourceNode` per element lifetime, and routes source
 *    monitoring to `AudioContext.destination` at most once.
 * 2. `CaptureManager` owns microphone `MediaStreamTrack`s; `AudioMixer` borrows
 *    the active microphone `MediaStream` without ever calling `track.stop()`, and
 *    NEVER routes microphone audio to `AudioContext.destination`.
 * 3. `mixedDestination` (`getMixedOutputStream()`) is completely distinct from
 *    `AudioContext.destination` and exposes one stable mixed audio track for
 *    future `RecordingEngine` consumption.
 */
export interface AudioMixer {
  initialize(): Promise<void>;
  resume(): Promise<void>;
  suspendMonitoring(): void;
  attachSourceElement(element: HTMLMediaElement | null): void;
  attachSourceStream?(
    stream: MediaStream | null,
    label?: string | null,
  ): void;
  updateSourceDescriptor(descriptor: SourceAudioDescriptor): void;
  attachMicrophoneStream(
    stream: MediaStream | null,
    label?: string | null,
  ): void;
  setSourceChannel(config: AudioChannelConfig): void;
  setMicrophoneChannel(config: AudioChannelConfig): void;
  setAutoDuckEnabled?(enabled: boolean): void;
  setMicProcessingEnabled?(enabled: boolean): void;
  getMixedOutputStream(): MediaStream | null;
  getState(): AudioMixerStateSnapshot;
  getMeterSnapshot(): AudioMeterSnapshot;
  sampleMetersNow(): AudioMeterSnapshot;
  subscribe(listener: (state: AudioMixerStateSnapshot) => void): () => void;
  subscribeMeters(listener: (meters: AudioMeterSnapshot) => void): () => void;
  dispose(): void;
}

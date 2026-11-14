import type {
  PlaybackSpeed,
  SourceMediaError,
  SourcePlaybackState,
} from '../../types/media';

export type FileValidationResult =
  | {
      readonly valid: true;
      readonly normalizedMimeType: string;
      readonly supportLevel: 'probably' | 'maybe' | 'unknown-probe';
    }
  | {
      readonly valid: false;
      readonly error: SourceMediaError;
    };

export type SourcePlayerListener = (state: SourcePlaybackState) => void;

/**
 * Service contract for local source media ingestion, validation, Object URL
 * lifecycle management, and HTMLMediaElement transport control.
 */
export interface SourcePlayer {
  getState(): SourcePlaybackState;
  subscribe(listener: SourcePlayerListener): () => void;
  attachVideoElement(element: HTMLVideoElement | null): void;
  loadFile(file: File): void;
  startScreenShare?(): Promise<void>;
  getScreenStream?(): MediaStream | null;
  unload(): void;
  play(): Promise<void>;
  pause(): void;
  togglePlayPause(): Promise<void>;
  seek(timeSec: number): void;
  rewind(seconds?: number): void;
  restart(): void;
  setPlaybackRate(rate: PlaybackSpeed): void;
  setVolume(volume: number): void;
  setMuted(muted: boolean): void;
  toggleMute(): void;
  /**
   * Enables or disables Web Audio gain delegation on the attached HTMLVideoElement.
   * When enabled, the underlying `<video>` element is held at unity pass-through
   * (`volume = 1`, `muted = false`) so `AudioMixer` controls 0–200% gain and mute
   * in one single Web Audio stage without double-applying attenuation.
   */
  setExternalAudioControl?(enabled: boolean): void;
  dispose(): void;
}

import type {
  RecordingLifecycleStatus,
  StageLayoutMode,
} from '../../types/media';

export interface RecordingChapterMarker {
  readonly id: string;
  readonly index: number;
  readonly label: string;
  readonly elapsedRecordingMs: number;
  readonly sourceTimeSec: number | null;
  readonly layoutMode: StageLayoutMode;
}

export interface AddChapterMarkerInput {
  readonly label?: string;
  readonly sourceTimeSec?: number | null;
  readonly layoutMode?: StageLayoutMode;
}

export const DEFAULT_VIDEO_BITS_PER_SECOND = 2_500_000;
export const DEFAULT_AUDIO_BITS_PER_SECOND = 128_000;
export const DEFAULT_RECORDING_TIMESLICE_MS = 250;

export const PREFERRED_AV_RECORDING_MIME_TYPES: readonly string[] = [
  'video/webm;codecs=vp9,opus',
  'video/webm;codecs=vp8,opus',
  'video/webm;codecs=h264,opus',
  'video/webm',
  'video/mp4;codecs=avc1.42E01E,mp4a.40.2',
  'video/mp4',
] as const;

export const PREFERRED_VIDEO_ONLY_RECORDING_MIME_TYPES: readonly string[] = [
  'video/webm;codecs=vp9',
  'video/webm;codecs=vp8',
  'video/webm',
  'video/mp4',
] as const;

export type RecordingErrorCode =
  | 'RECORDER_UNSUPPORTED'
  | 'NO_SUPPORTED_MIME_TYPE'
  | 'SCENE_STREAM_UNAVAILABLE'
  | 'INVALID_VIDEO_TRACK'
  | 'RECORDER_START_FAILED'
  | 'RECORDER_STATE_INVALID'
  | 'RECORDER_RUNTIME_ERROR'
  | 'RECORDER_FINALIZE_FAILED'
  | 'RECORDING_CANCELLED'
  | 'EMPTY_RECORDING_ARTIFACT';

export interface RecordingEngineError {
  readonly code: RecordingErrorCode;
  readonly title: string;
  readonly message: string;
  readonly recoverable: boolean;
}

export interface RecordingEngineConfig {
  readonly preferredMimeTypes?: readonly string[];
  readonly videoBitsPerSecond: number;
  readonly audioBitsPerSecond: number;
  readonly timesliceMs: number;
  readonly width?: number;
  readonly height?: number;
  /**
   * When true, stops the video tracks on `compositedVideoStream` once the
   * recording stops, cancels, fails, or disposes (used for ephemeral
   * `canvas.captureStream(fps)` tracks owned by the recording session).
   * Borrowed `mixedAudioStream` tracks are NEVER stopped by `RecordingEngine`.
   */
  readonly stopVideoTracksOnFinalize?: boolean;
}

export interface RecordingTelemetry {
  readonly status: RecordingLifecycleStatus;
  readonly elapsedRecordingMs: number;
  readonly negotiatedMimeType: string | null;
  readonly recordedBytes: number;
  readonly chunkCount: number;
}

export interface RecordedMediaArtifact {
  readonly id: string;
  readonly blob: Blob;
  readonly mimeType: string;
  readonly durationMs: number;
  readonly sizeBytes: number;
  readonly chunkCount: number;
  readonly width: number;
  readonly height: number;
  readonly hasAudioTrack: boolean;
  readonly createdAtIso: string;
  readonly chapterMarkers?: readonly RecordingChapterMarker[];
}

export interface RecordingStateSnapshot {
  readonly isSupported: boolean;
  readonly status: RecordingLifecycleStatus;
  readonly negotiatedMimeType: string | null;
  readonly supportedMimeTypes: readonly string[];
  readonly activeWidth: number;
  readonly activeHeight: number;
  readonly hasAudioTrack: boolean;
  readonly lastArtifact: RecordedMediaArtifact | null;
  readonly error: RecordingEngineError | null;
  readonly activeMarkers?: readonly RecordingChapterMarker[];
}

/**
 * Service contract for MediaRecorder lifecycle orchestration over the live
 * composited canvas video stream + mixed Web Audio stream, driven by an
 * independent monotonic session clock decoupled from source video playback time.
 */
export interface RecordingEngine {
  getState(): RecordingStateSnapshot;
  subscribeState(listener: (state: RecordingStateSnapshot) => void): () => void;
  getTelemetry(): RecordingTelemetry;
  subscribe(listener: (telemetry: RecordingTelemetry) => void): () => void;
  getSupportedMimeTypes(): readonly string[];
  start(
    compositedVideoStream: MediaStream,
    mixedAudioStream: MediaStream | null,
    config?: Partial<RecordingEngineConfig>,
  ): Promise<void>;
  pause(): void;
  resume(): void;
  addChapterMarker?(
    input?: AddChapterMarkerInput,
  ): RecordingChapterMarker | null;
  stop(): Promise<RecordedMediaArtifact>;
  cancel(): void;
  clearArtifact(): void;
  dispose(): void;
}

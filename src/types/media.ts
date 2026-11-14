export const SUPPORTED_PLAYBACK_SPEEDS = [0.5, 0.75, 1, 1.25, 1.5, 2] as const;

export type PlaybackSpeed = (typeof SUPPORTED_PLAYBACK_SPEEDS)[number];

export type SourcePlaybackStatus =
  | 'empty'
  | 'loading'
  | 'ready'
  | 'playing'
  | 'paused'
  | 'ended'
  | 'error';

export type SourceMediaMode = 'file' | 'screen';

export type SourceMediaErrorCode =
  | 'EMPTY_FILE'
  | 'UNSUPPORTED_FILE_TYPE'
  | 'BROWSER_CODEC_UNSUPPORTED'
  | 'NO_VIDEO_TRACK'
  | 'MEDIA_DECODE_ERROR'
  | 'MEDIA_LOAD_ABORTED'
  | 'PLAYBACK_FAILED'
  | 'SCREEN_CAPTURE_UNSUPPORTED'
  | 'SCREEN_CAPTURE_DENIED'
  | 'SCREEN_CAPTURE_FAILED';

export interface SourceMediaError {
  readonly code: SourceMediaErrorCode;
  readonly title: string;
  readonly message: string;
  readonly fileName?: string;
  readonly recoverable: boolean;
}

export interface SourceMediaMetadata {
  readonly fileName: string;
  readonly fileSizeBytes: number;
  readonly mimeType: string;
  readonly lastModified: number;
  readonly durationSec: number;
  readonly width: number;
  readonly height: number;
}

/**
 * Strictly owns local source video playback state and source media clock.
 * Never conflated with RecordingSessionState or recording wall-clock elapsed time.
 */
export interface SourcePlaybackState {
  readonly status: SourcePlaybackStatus;
  readonly sourceMode: SourceMediaMode;
  readonly objectUrl: string | null;
  readonly metadata: SourceMediaMetadata | null;
  readonly pendingFileName: string | null;
  readonly currentTimeSec: number;
  readonly durationSec: number;
  readonly playbackRate: PlaybackSpeed;
  readonly volume: number;
  readonly muted: boolean;
  readonly hasScreenAudioTrack: boolean;
  readonly error: SourceMediaError | null;
}

export type RecordingLifecycleStatus =
  | 'uninitialized'
  | 'idle'
  | 'arming'
  | 'recording'
  | 'paused'
  | 'stopping'
  | 'completed'
  | 'error';

export type StudioSlotReadiness = 'placeholder' | 'ready' | 'active' | 'error';

export type StageLayoutMode =
  | 'source-only'
  | 'camera-only'
  | 'pip'
  | 'side-by-side';

export type PipFrameShape = 'rect' | 'rounded' | 'circle';

export type PipBorderStyle = 'sky' | 'amber' | 'emerald' | 'subtle' | 'none';

export type TelestratorTool = 'none' | 'pen' | 'arrow' | 'rect' | 'laser';

export interface TelestratorColorOption {
  readonly hex: string;
  readonly label: string;
}

export const SUPPORTED_TELESTRATOR_COLORS: readonly TelestratorColorOption[] = [
  { hex: '#ef4444', label: 'Coral Red' },
  { hex: '#facc15', label: 'Broadcast Gold' },
  { hex: '#38bdf8', label: 'Studio Cyan' },
  { hex: '#4ade80', label: 'Signal Green' },
] as const;

export const DEFAULT_TELESTRATOR_COLOR = '#ef4444';

export const MAX_LOWER_THIRD_TEXT_LENGTH = 64;

export interface StageLowerThirdConfig {
  readonly enabled: boolean;
  readonly title: string;
  readonly subtitle: string;
}

export const DEFAULT_STAGE_LOWER_THIRD: StageLowerThirdConfig = {
  enabled: false,
  title: 'Live Reaction & Breakdown',
  subtitle: 'ReactStage Studio',
};

export type SceneResolutionPreset = '720p' | '1080p';

export interface SceneResolutionOption {
  readonly id: SceneResolutionPreset;
  readonly label: string;
  readonly width: number;
  readonly height: number;
}

export const SUPPORTED_SCENE_RESOLUTIONS: readonly SceneResolutionOption[] = [
  { id: '720p', label: '1280×720 (720p)', width: 1280, height: 720 },
  { id: '1080p', label: '1920×1080 (1080p)', width: 1920, height: 1080 },
] as const;

/**
 * Strictly owns commentary recording session state and continuous session clock.
 * Independent from SourcePlaybackState so creators can pause, rewind, or change
 * source video speed while commentary recording continues uninterrupted.
 */
export interface RecordingSessionState {
  readonly status: RecordingLifecycleStatus;
  readonly elapsedRecordingMs: number;
  readonly layoutMode: StageLayoutMode;
  readonly webcamSlotStatus: StudioSlotReadiness;
  readonly recordingSlotStatus: StudioSlotReadiness;
  readonly exportSlotStatus: StudioSlotReadiness;
  readonly sessionError: string | null;
}

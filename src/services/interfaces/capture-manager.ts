export interface MediaDeviceDescriptor {
  readonly deviceId: string;
  readonly kind: 'videoinput' | 'audioinput';
  readonly label: string;
  readonly groupId: string;
}

export type CapturePermissionState =
  | 'prompt'
  | 'granted'
  | 'denied'
  | 'unsupported';

export type CaptureChannelStatus =
  | 'idle'
  | 'requesting'
  | 'active'
  | 'ended'
  | 'error';

export type CaptureErrorCode =
  | 'MEDIA_DEVICES_UNSUPPORTED'
  | 'PERMISSION_DENIED'
  | 'DEVICE_NOT_FOUND'
  | 'DEVICE_IN_USE'
  | 'OVERCONSTRAINED'
  | 'TRACK_ENDED_UNEXPECTEDLY'
  | 'ENUMERATION_FAILED'
  | 'CAPTURE_FAILED';

export interface CaptureDeviceError {
  readonly code: CaptureErrorCode;
  readonly channel: 'camera' | 'microphone' | 'devices';
  readonly title: string;
  readonly message: string;
  readonly recoverable: boolean;
}

export interface CameraCaptureConfig {
  readonly deviceId?: string;
  readonly facingMode?: 'user' | 'environment';
  readonly idealWidth?: number;
  readonly idealHeight?: number;
  readonly idealFrameRate?: number;
  readonly mirrorPreview?: boolean;
}

export interface MicrophoneCaptureConfig {
  readonly deviceId?: string;
  readonly echoCancellation?: boolean;
  readonly noiseSuppression?: boolean;
  readonly autoGainControl?: boolean;
}

export interface CaptureStateSnapshot {
  readonly isSupported: boolean;
  readonly cameraPermission: CapturePermissionState;
  readonly microphonePermission: CapturePermissionState;
  readonly cameraStatus: CaptureChannelStatus;
  readonly microphoneStatus: CaptureChannelStatus;
  readonly isEnumeratingDevices: boolean;
  readonly availableDevices: readonly MediaDeviceDescriptor[];
  readonly availableCameras: readonly MediaDeviceDescriptor[];
  readonly availableMicrophones: readonly MediaDeviceDescriptor[];
  readonly selectedCameraDeviceId: string;
  readonly selectedMicrophoneDeviceId: string;
  readonly activeCameraDeviceId: string | null;
  readonly activeMicrophoneDeviceId: string | null;
  readonly activeCameraLabel: string | null;
  readonly activeMicrophoneLabel: string | null;
  readonly activeCameraStream: MediaStream | null;
  readonly activeMicrophoneStream: MediaStream | null;
  readonly cameraEnabled: boolean;
  readonly microphoneEnabled: boolean;
  readonly mirrorPreview: boolean;
  readonly cameraError: CaptureDeviceError | null;
  readonly microphoneError: CaptureDeviceError | null;
  readonly deviceEnumerationError: CaptureDeviceError | null;
}

/**
 * Service contract for local camera and microphone permission acquisition,
 * independent channel lifecycles, device enumeration/switching, unexpected track
 * termination recovery, and deterministic MediaStreamTrack cleanup.
 */
export interface CaptureManager {
  getSnapshot(): CaptureStateSnapshot;
  subscribe(listener: (snapshot: CaptureStateSnapshot) => void): () => void;
  enumerateDevices(): Promise<readonly MediaDeviceDescriptor[]>;
  startCamera(config?: CameraCaptureConfig): Promise<MediaStream | null>;
  stopCamera(): void;
  switchCamera(deviceId: string): Promise<MediaStream | null>;
  setSelectedCameraDeviceId(deviceId: string): void;
  setMirrorPreview(mirror: boolean): void;
  startMicrophone(config?: MicrophoneCaptureConfig): Promise<MediaStream | null>;
  stopMicrophone(): void;
  switchMicrophone(deviceId: string): Promise<MediaStream | null>;
  setSelectedMicrophoneDeviceId(deviceId: string): void;
  stopAll(): void;
  dispose(): void;
}

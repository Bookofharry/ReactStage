import type {
  CameraCaptureConfig,
  CaptureDeviceError,
  CaptureManager,
  CaptureStateSnapshot,
  MediaDeviceDescriptor,
  MicrophoneCaptureConfig,
} from '../interfaces/capture-manager';

export interface MediaDevicesLike {
  getUserMedia(constraints: MediaStreamConstraints): Promise<MediaStream>;
  enumerateDevices(): Promise<MediaDeviceInfo[]>;
  addEventListener?: (type: 'devicechange', listener: () => void) => void;
  removeEventListener?: (type: 'devicechange', listener: () => void) => void;
}

export interface BrowserCaptureManagerOptions {
  readonly mediaDevices?: MediaDevicesLike | null;
}

const DEFAULT_CAMERA_CONFIG: Required<
  Omit<CameraCaptureConfig, 'deviceId' | 'facingMode'>
> = {
  idealWidth: 1280,
  idealHeight: 720,
  idealFrameRate: 30,
  mirrorPreview: true,
};

const DEFAULT_MICROPHONE_CONFIG: Required<
  Omit<MicrophoneCaptureConfig, 'deviceId'>
> = {
  echoCancellation: true,
  noiseSuppression: true,
  autoGainControl: true,
};

function resolveDefaultMediaDevices(): MediaDevicesLike | null {
  if (typeof navigator === 'undefined') {
    return null;
  }
  const maybeDevices = (navigator as Partial<Navigator>).mediaDevices;
  return maybeDevices ?? null;
}

function stopStreamTracksSafely(stream: MediaStream | null): void {
  if (!stream) {
    return;
  }
  for (const track of stream.getTracks()) {
    try {
      track.stop();
    } catch {
      // Ignore hardware teardown errors on already-stopped tracks
    }
  }
}

function normalizeDeviceDescriptors(
  rawDevices: readonly MediaDeviceInfo[],
): {
  readonly all: readonly MediaDeviceDescriptor[];
  readonly cameras: readonly MediaDeviceDescriptor[];
  readonly microphones: readonly MediaDeviceDescriptor[];
} {
  const all: MediaDeviceDescriptor[] = [];
  const cameras: MediaDeviceDescriptor[] = [];
  const microphones: MediaDeviceDescriptor[] = [];

  let camIndex = 0;
  let micIndex = 0;

  for (const info of rawDevices) {
    if (info.kind !== 'videoinput' && info.kind !== 'audioinput') {
      continue;
    }

    if (info.kind === 'videoinput') {
      camIndex += 1;
      const descriptor: MediaDeviceDescriptor = {
        deviceId: info.deviceId || `camera-${camIndex}`,
        kind: 'videoinput',
        label: info.label.trim() || `Camera ${camIndex}`,
        groupId: info.groupId || '',
      };
      all.push(descriptor);
      cameras.push(descriptor);
    } else {
      micIndex += 1;
      const descriptor: MediaDeviceDescriptor = {
        deviceId: info.deviceId || `microphone-${micIndex}`,
        kind: 'audioinput',
        label: info.label.trim() || `Microphone ${micIndex}`,
        groupId: info.groupId || '',
      };
      all.push(descriptor);
      microphones.push(descriptor);
    }
  }

  return { all, cameras, microphones };
}

function mapCaptureError(
  err: unknown,
  channel: 'camera' | 'microphone',
): {
  readonly error: CaptureDeviceError;
  readonly denied: boolean;
} {
  const noun = channel === 'camera' ? 'camera' : 'microphone';
  const capitalNoun = channel === 'camera' ? 'Camera' : 'Microphone';
  const errName =
    err instanceof Error || (typeof DOMException !== 'undefined' && err instanceof DOMException)
      ? err.name
      : '';
  const rawMessage =
    err instanceof Error && err.message ? err.message : '';

  if (
    errName === 'NotAllowedError' ||
    errName === 'PermissionDeniedError' ||
    errName === 'SecurityError'
  ) {
    return {
      denied: true,
      error: {
        code: 'PERMISSION_DENIED',
        channel,
        title: `${capitalNoun} permission denied`,
        message: `Browser access to your ${noun} was blocked. Allow ${noun} access in your browser site permissions and try again.`,
        recoverable: true,
      },
    };
  }

  if (errName === 'NotFoundError' || errName === 'DevicesNotFoundError') {
    return {
      denied: false,
      error: {
        code: 'DEVICE_NOT_FOUND',
        channel,
        title: `No ${noun} detected`,
        message: `No available ${noun} device was found. Connect a ${noun} and refresh devices.`,
        recoverable: true,
      },
    };
  }

  if (errName === 'NotReadableError' || errName === 'TrackStartError') {
    return {
      denied: false,
      error: {
        code: 'DEVICE_IN_USE',
        channel,
        title: `${capitalNoun} unavailable or in use`,
        message: `Your ${noun} could not be started because another application or hardware lock is using it.`,
        recoverable: true,
      },
    };
  }

  if (
    errName === 'OverconstrainedError' ||
    errName === 'ConstraintNotSatisfiedError'
  ) {
    return {
      denied: false,
      error: {
        code: 'OVERCONSTRAINED',
        channel,
        title: `Selected ${noun} unavailable`,
        message: `The requested ${noun} source or constraint could not be satisfied. Select another ${noun} device.`,
        recoverable: true,
      },
    };
  }

  return {
    denied: false,
    error: {
      code: 'CAPTURE_FAILED',
      channel,
      title: `${capitalNoun} capture failed`,
      message: rawMessage
        ? `Unable to start ${noun}: ${rawMessage}`
        : `An unexpected error prevented starting your ${noun}.`,
      recoverable: true,
    },
  };
}

export function createInitialCaptureSnapshot(
  isSupported = true,
): CaptureStateSnapshot {
  return {
    isSupported,
    cameraPermission: isSupported ? 'prompt' : 'unsupported',
    microphonePermission: isSupported ? 'prompt' : 'unsupported',
    cameraStatus: 'idle',
    microphoneStatus: 'idle',
    isEnumeratingDevices: false,
    availableDevices: [],
    availableCameras: [],
    availableMicrophones: [],
    selectedCameraDeviceId: '',
    selectedMicrophoneDeviceId: '',
    activeCameraDeviceId: null,
    activeMicrophoneDeviceId: null,
    activeCameraLabel: null,
    activeMicrophoneLabel: null,
    activeCameraStream: null,
    activeMicrophoneStream: null,
    cameraEnabled: false,
    microphoneEnabled: false,
    mirrorPreview: DEFAULT_CAMERA_CONFIG.mirrorPreview,
    cameraError: null,
    microphoneError: null,
    deviceEnumerationError: null,
  };
}

/**
 * Concrete browser implementation of CaptureManager.
 * Owns all created MediaStreamTracks, keeps camera and microphone lifecycles
 * completely independent, never requests permissions on construction, and
 * guards against async races, duplicate clicks, device unplugs, and unmount leaks.
 */
export class BrowserCaptureManager implements CaptureManager {
  private readonly mediaDevices: MediaDevicesLike | null;
  private snapshot: CaptureStateSnapshot;
  private readonly listeners = new Set<(snapshot: CaptureStateSnapshot) => void>();

  private cameraOpId = 0;
  private inFlightCameraPromise: Promise<MediaStream | null> | null = null;
  private inFlightCameraDeviceId: string | null = null;
  private detachCameraTrackListeners: (() => void) | null = null;

  private microphoneOpId = 0;
  private inFlightMicrophonePromise: Promise<MediaStream | null> | null = null;
  private inFlightMicrophoneDeviceId: string | null = null;
  private detachMicrophoneTrackListeners: (() => void) | null = null;

  private enumOpId = 0;
  private detachDeviceChange: (() => void) | null = null;
  private isDisposed = false;

  public constructor(options: BrowserCaptureManagerOptions = {}) {
    this.mediaDevices =
      options.mediaDevices !== undefined
        ? options.mediaDevices
        : resolveDefaultMediaDevices();

    const supported = this.mediaDevices !== null;
    this.snapshot = createInitialCaptureSnapshot(supported);
  }

  public getSnapshot(): CaptureStateSnapshot {
    return this.snapshot;
  }

  public subscribe(
    listener: (snapshot: CaptureStateSnapshot) => void,
  ): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  public async enumerateDevices(): Promise<readonly MediaDeviceDescriptor[]> {
    if (this.isDisposed) {
      return [];
    }

    if (!this.mediaDevices) {
      const error: CaptureDeviceError = {
        code: 'MEDIA_DEVICES_UNSUPPORTED',
        channel: 'devices',
        title: 'Media capture unsupported',
        message:
          'This browser environment does not expose navigator.mediaDevices.',
        recoverable: false,
      };
      this.setSnapshot({
        ...this.snapshot,
        isSupported: false,
        cameraPermission: 'unsupported',
        microphonePermission: 'unsupported',
        deviceEnumerationError: error,
      });
      return [];
    }

    this.ensureDeviceChangeSubscribed();
    const currentEnumOp = ++this.enumOpId;

    this.setSnapshot({
      ...this.snapshot,
      isEnumeratingDevices: true,
      deviceEnumerationError: null,
    });

    try {
      const raw = await this.mediaDevices.enumerateDevices();
      if (currentEnumOp !== this.enumOpId) {
        return this.snapshot.availableDevices;
      }

      const { all, cameras, microphones } = normalizeDeviceDescriptors(raw);

      const selectedCamStillExists =
        this.snapshot.selectedCameraDeviceId === '' ||
        cameras.some((d) => d.deviceId === this.snapshot.selectedCameraDeviceId);
      const nextSelectedCam = selectedCamStillExists
        ? this.snapshot.selectedCameraDeviceId
        : (this.snapshot.activeCameraDeviceId ?? cameras[0]?.deviceId ?? '');

      const selectedMicStillExists =
        this.snapshot.selectedMicrophoneDeviceId === '' ||
        microphones.some(
          (d) => d.deviceId === this.snapshot.selectedMicrophoneDeviceId,
        );
      const nextSelectedMic = selectedMicStillExists
        ? this.snapshot.selectedMicrophoneDeviceId
        : (this.snapshot.activeMicrophoneDeviceId ??
          microphones[0]?.deviceId ??
          '');

      const updatedActiveCamLabel =
        this.snapshot.activeCameraDeviceId !== null
          ? (cameras.find(
              (d) => d.deviceId === this.snapshot.activeCameraDeviceId,
            )?.label ?? this.snapshot.activeCameraLabel)
          : this.snapshot.activeCameraLabel;

      const updatedActiveMicLabel =
        this.snapshot.activeMicrophoneDeviceId !== null
          ? (microphones.find(
              (d) => d.deviceId === this.snapshot.activeMicrophoneDeviceId,
            )?.label ?? this.snapshot.activeMicrophoneLabel)
          : this.snapshot.activeMicrophoneLabel;

      this.setSnapshot({
        ...this.snapshot,
        isEnumeratingDevices: false,
        availableDevices: all,
        availableCameras: cameras,
        availableMicrophones: microphones,
        selectedCameraDeviceId: nextSelectedCam,
        selectedMicrophoneDeviceId: nextSelectedMic,
        activeCameraLabel: updatedActiveCamLabel,
        activeMicrophoneLabel: updatedActiveMicLabel,
        deviceEnumerationError: null,
      });

      return all;
    } catch (err: unknown) {
      if (currentEnumOp !== this.enumOpId) {
        return this.snapshot.availableDevices;
      }

      const detail =
        err instanceof Error && err.message
          ? err.message
          : 'Could not query connected audio/video devices.';

      this.setSnapshot({
        ...this.snapshot,
        isEnumeratingDevices: false,
        deviceEnumerationError: {
          code: 'ENUMERATION_FAILED',
          channel: 'devices',
          title: 'Device list unavailable',
          message: detail,
          recoverable: true,
        },
      });
      return this.snapshot.availableDevices;
    }
  }

  public startCamera(config: CameraCaptureConfig = {}): Promise<MediaStream | null> {
    if (this.isDisposed) {
      return Promise.resolve(null);
    }

    if (!this.mediaDevices) {
      this.setSnapshot({
        ...this.snapshot,
        isSupported: false,
        cameraPermission: 'unsupported',
        cameraStatus: 'error',
        cameraError: {
          code: 'MEDIA_DEVICES_UNSUPPORTED',
          channel: 'camera',
          title: 'Camera capture unsupported',
          message:
            'Browser camera capture requires HTTPS or localhost and navigator.mediaDevices.getUserMedia support.',
          recoverable: false,
        },
      });
      return Promise.resolve(null);
    }

    const targetDeviceId =
      config.deviceId ??
      (config.facingMode ? '' : this.snapshot.selectedCameraDeviceId);

    // Deduplicate identical concurrent startCamera calls
    if (
      this.snapshot.cameraStatus === 'requesting' &&
      this.inFlightCameraPromise !== null &&
      this.inFlightCameraDeviceId === targetDeviceId
    ) {
      return this.inFlightCameraPromise;
    }

    this.ensureDeviceChangeSubscribed();
    const currentOp = ++this.cameraOpId;
    this.inFlightCameraDeviceId = targetDeviceId;

    // Stop any previously active camera stream before opening next hardware stream
    this.releaseCameraResources();

    const nextMirror = config.mirrorPreview ?? this.snapshot.mirrorPreview;

    this.setSnapshot({
      ...this.snapshot,
      cameraStatus: 'requesting',
      cameraEnabled: false,
      activeCameraStream: null,
      activeCameraDeviceId: null,
      activeCameraLabel: null,
      selectedCameraDeviceId: targetDeviceId,
      mirrorPreview: nextMirror,
      cameraError: null,
    });

    const videoConstraints: MediaTrackConstraints = {
      width: { ideal: config.idealWidth ?? DEFAULT_CAMERA_CONFIG.idealWidth },
      height: { ideal: config.idealHeight ?? DEFAULT_CAMERA_CONFIG.idealHeight },
      frameRate: {
        ideal: config.idealFrameRate ?? DEFAULT_CAMERA_CONFIG.idealFrameRate,
      },
      ...(targetDeviceId
        ? { deviceId: { exact: targetDeviceId } }
        : config.facingMode
          ? { facingMode: { ideal: config.facingMode } }
          : {}),
    };

    const requestPromise = this.executeCameraRequest(
      currentOp,
      targetDeviceId,
      videoConstraints,
    );
    this.inFlightCameraPromise = requestPromise;
    return requestPromise;
  }

  public stopCamera(): void {
    this.cameraOpId += 1;
    this.inFlightCameraPromise = null;
    this.inFlightCameraDeviceId = null;
    this.releaseCameraResources();

    if (this.isDisposed) {
      return;
    }

    this.setSnapshot({
      ...this.snapshot,
      cameraStatus: 'idle',
      cameraEnabled: false,
      activeCameraStream: null,
      activeCameraDeviceId: null,
      activeCameraLabel: null,
      cameraError: null,
    });
  }

  public async switchCamera(deviceId: string): Promise<MediaStream | null> {
    if (this.isDisposed) {
      return null;
    }

    if (
      this.snapshot.cameraStatus === 'active' ||
      this.snapshot.cameraStatus === 'requesting'
    ) {
      return this.startCamera({ deviceId });
    }

    this.setSnapshot({
      ...this.snapshot,
      selectedCameraDeviceId: deviceId,
    });
    return null;
  }

  public setSelectedCameraDeviceId(deviceId: string): void {
    if (this.isDisposed) {
      return;
    }
    this.setSnapshot({
      ...this.snapshot,
      selectedCameraDeviceId: deviceId,
    });
  }

  public setMirrorPreview(mirror: boolean): void {
    if (this.isDisposed) {
      return;
    }
    this.setSnapshot({
      ...this.snapshot,
      mirrorPreview: mirror,
    });
  }

  public startMicrophone(
    config: MicrophoneCaptureConfig = {},
  ): Promise<MediaStream | null> {
    if (this.isDisposed) {
      return Promise.resolve(null);
    }

    if (!this.mediaDevices) {
      this.setSnapshot({
        ...this.snapshot,
        isSupported: false,
        microphonePermission: 'unsupported',
        microphoneStatus: 'error',
        microphoneError: {
          code: 'MEDIA_DEVICES_UNSUPPORTED',
          channel: 'microphone',
          title: 'Microphone capture unsupported',
          message:
            'Browser microphone capture requires HTTPS or localhost and navigator.mediaDevices.getUserMedia support.',
          recoverable: false,
        },
      });
      return Promise.resolve(null);
    }

    const targetDeviceId =
      config.deviceId ?? this.snapshot.selectedMicrophoneDeviceId;

    // Deduplicate identical concurrent startMicrophone calls
    if (
      this.snapshot.microphoneStatus === 'requesting' &&
      this.inFlightMicrophonePromise !== null &&
      this.inFlightMicrophoneDeviceId === targetDeviceId
    ) {
      return this.inFlightMicrophonePromise;
    }

    this.ensureDeviceChangeSubscribed();
    const currentOp = ++this.microphoneOpId;
    this.inFlightMicrophoneDeviceId = targetDeviceId;

    // Stop any previously active microphone stream before opening next hardware stream
    this.releaseMicrophoneResources();

    this.setSnapshot({
      ...this.snapshot,
      microphoneStatus: 'requesting',
      microphoneEnabled: false,
      activeMicrophoneStream: null,
      activeMicrophoneDeviceId: null,
      activeMicrophoneLabel: null,
      selectedMicrophoneDeviceId: targetDeviceId,
      microphoneError: null,
    });

    const audioConstraints: MediaTrackConstraints = {
      echoCancellation:
        config.echoCancellation ?? DEFAULT_MICROPHONE_CONFIG.echoCancellation,
      noiseSuppression:
        config.noiseSuppression ?? DEFAULT_MICROPHONE_CONFIG.noiseSuppression,
      autoGainControl:
        config.autoGainControl ?? DEFAULT_MICROPHONE_CONFIG.autoGainControl,
      ...(targetDeviceId ? { deviceId: { exact: targetDeviceId } } : {}),
    };

    const requestPromise = this.executeMicrophoneRequest(
      currentOp,
      targetDeviceId,
      audioConstraints,
    );
    this.inFlightMicrophonePromise = requestPromise;
    return requestPromise;
  }

  public stopMicrophone(): void {
    this.microphoneOpId += 1;
    this.inFlightMicrophonePromise = null;
    this.inFlightMicrophoneDeviceId = null;
    this.releaseMicrophoneResources();

    if (this.isDisposed) {
      return;
    }

    this.setSnapshot({
      ...this.snapshot,
      microphoneStatus: 'idle',
      microphoneEnabled: false,
      activeMicrophoneStream: null,
      activeMicrophoneDeviceId: null,
      activeMicrophoneLabel: null,
      microphoneError: null,
    });
  }

  public async switchMicrophone(deviceId: string): Promise<MediaStream | null> {
    if (this.isDisposed) {
      return null;
    }

    if (
      this.snapshot.microphoneStatus === 'active' ||
      this.snapshot.microphoneStatus === 'requesting'
    ) {
      return this.startMicrophone({ deviceId });
    }

    this.setSnapshot({
      ...this.snapshot,
      selectedMicrophoneDeviceId: deviceId,
    });
    return null;
  }

  public setSelectedMicrophoneDeviceId(deviceId: string): void {
    if (this.isDisposed) {
      return;
    }
    this.setSnapshot({
      ...this.snapshot,
      selectedMicrophoneDeviceId: deviceId,
    });
  }

  public stopAll(): void {
    this.cameraOpId += 1;
    this.microphoneOpId += 1;
    this.inFlightCameraPromise = null;
    this.inFlightCameraDeviceId = null;
    this.inFlightMicrophonePromise = null;
    this.inFlightMicrophoneDeviceId = null;

    this.releaseCameraResources();
    this.releaseMicrophoneResources();

    if (this.detachDeviceChange) {
      this.detachDeviceChange();
      this.detachDeviceChange = null;
    }

    if (this.isDisposed) {
      return;
    }

    this.setSnapshot({
      ...this.snapshot,
      cameraStatus: 'idle',
      cameraEnabled: false,
      activeCameraStream: null,
      activeCameraDeviceId: null,
      activeCameraLabel: null,
      cameraError: null,
      microphoneStatus: 'idle',
      microphoneEnabled: false,
      activeMicrophoneStream: null,
      activeMicrophoneDeviceId: null,
      activeMicrophoneLabel: null,
      microphoneError: null,
    });
  }

  public dispose(): void {
    this.stopAll();
    this.enumOpId += 1;

    if (this.detachDeviceChange) {
      this.detachDeviceChange();
      this.detachDeviceChange = null;
    }

    this.isDisposed = true;
    this.listeners.clear();
  }

  private async executeCameraRequest(
    opId: number,
    requestedDeviceId: string,
    videoConstraints: MediaTrackConstraints,
  ): Promise<MediaStream | null> {
    if (!this.mediaDevices) {
      return null;
    }

    try {
      const stream = await this.mediaDevices.getUserMedia({
        video: videoConstraints,
        audio: false,
      });

      if (this.isDisposed || opId !== this.cameraOpId) {
        stopStreamTracksSafely(stream);
        return null;
      }

      const primaryTrack = stream.getVideoTracks()[0];
      if (!primaryTrack || primaryTrack.readyState === 'ended') {
        stopStreamTracksSafely(stream);
        this.inFlightCameraPromise = null;
        this.inFlightCameraDeviceId = null;
        this.setSnapshot({
          ...this.snapshot,
          cameraStatus: 'error',
          cameraEnabled: false,
          activeCameraStream: null,
          cameraError: {
            code: 'CAPTURE_FAILED',
            channel: 'camera',
            title: 'Camera stream ended immediately',
            message:
              'The browser returned a camera stream without an active video track.',
            recoverable: true,
          },
        });
        return null;
      }

      const settingsDeviceId =
        typeof primaryTrack.getSettings === 'function'
          ? primaryTrack.getSettings().deviceId
          : undefined;
      const resolvedDeviceId = settingsDeviceId ?? (requestedDeviceId || null);
      const resolvedLabel = primaryTrack.label.trim() || 'Active Camera';

      this.bindCameraTrackEnded(stream);
      this.inFlightCameraPromise = null;
      this.inFlightCameraDeviceId = null;

      this.setSnapshot({
        ...this.snapshot,
        cameraPermission: 'granted',
        cameraStatus: 'active',
        cameraEnabled: true,
        activeCameraStream: stream,
        activeCameraDeviceId: resolvedDeviceId,
        selectedCameraDeviceId:
          resolvedDeviceId ?? this.snapshot.selectedCameraDeviceId,
        activeCameraLabel: resolvedLabel,
        cameraError: null,
      });

      void this.enumerateDevices();
      return stream;
    } catch (err: unknown) {
      if (this.isDisposed || opId !== this.cameraOpId) {
        return null;
      }

      this.inFlightCameraPromise = null;
      this.inFlightCameraDeviceId = null;
      const { error, denied } = mapCaptureError(err, 'camera');

      this.setSnapshot({
        ...this.snapshot,
        cameraPermission: denied ? 'denied' : this.snapshot.cameraPermission,
        cameraStatus: 'error',
        cameraEnabled: false,
        activeCameraStream: null,
        activeCameraDeviceId: null,
        activeCameraLabel: null,
        cameraError: error,
      });
      return null;
    }
  }

  private async executeMicrophoneRequest(
    opId: number,
    requestedDeviceId: string,
    audioConstraints: MediaTrackConstraints,
  ): Promise<MediaStream | null> {
    if (!this.mediaDevices) {
      return null;
    }

    try {
      const stream = await this.mediaDevices.getUserMedia({
        video: false,
        audio: audioConstraints,
      });

      if (this.isDisposed || opId !== this.microphoneOpId) {
        stopStreamTracksSafely(stream);
        return null;
      }

      const primaryTrack = stream.getAudioTracks()[0];
      if (!primaryTrack || primaryTrack.readyState === 'ended') {
        stopStreamTracksSafely(stream);
        this.inFlightMicrophonePromise = null;
        this.inFlightMicrophoneDeviceId = null;
        this.setSnapshot({
          ...this.snapshot,
          microphoneStatus: 'error',
          microphoneEnabled: false,
          activeMicrophoneStream: null,
          microphoneError: {
            code: 'CAPTURE_FAILED',
            channel: 'microphone',
            title: 'Microphone stream ended immediately',
            message:
              'The browser returned a microphone stream without an active audio track.',
            recoverable: true,
          },
        });
        return null;
      }

      const settingsDeviceId =
        typeof primaryTrack.getSettings === 'function'
          ? primaryTrack.getSettings().deviceId
          : undefined;
      const resolvedDeviceId = settingsDeviceId ?? (requestedDeviceId || null);
      const resolvedLabel = primaryTrack.label.trim() || 'Active Microphone';

      this.bindMicrophoneTrackEnded(stream);
      this.inFlightMicrophonePromise = null;
      this.inFlightMicrophoneDeviceId = null;

      this.setSnapshot({
        ...this.snapshot,
        microphonePermission: 'granted',
        microphoneStatus: 'active',
        microphoneEnabled: true,
        activeMicrophoneStream: stream,
        activeMicrophoneDeviceId: resolvedDeviceId,
        selectedMicrophoneDeviceId:
          resolvedDeviceId ?? this.snapshot.selectedMicrophoneDeviceId,
        activeMicrophoneLabel: resolvedLabel,
        microphoneError: null,
      });

      void this.enumerateDevices();
      return stream;
    } catch (err: unknown) {
      if (this.isDisposed || opId !== this.microphoneOpId) {
        return null;
      }

      this.inFlightMicrophonePromise = null;
      this.inFlightMicrophoneDeviceId = null;
      const { error, denied } = mapCaptureError(err, 'microphone');

      this.setSnapshot({
        ...this.snapshot,
        microphonePermission: denied
          ? 'denied'
          : this.snapshot.microphonePermission,
        microphoneStatus: 'error',
        microphoneEnabled: false,
        activeMicrophoneStream: null,
        activeMicrophoneDeviceId: null,
        activeMicrophoneLabel: null,
        microphoneError: error,
      });
      return null;
    }
  }

  private bindCameraTrackEnded(stream: MediaStream): void {
    const tracks = stream.getVideoTracks();
    const onEnded = () => {
      if (this.isDisposed || this.snapshot.activeCameraStream !== stream) {
        return;
      }

      this.cameraOpId += 1;
      this.releaseCameraResources();

      this.setSnapshot({
        ...this.snapshot,
        cameraStatus: 'ended',
        cameraEnabled: false,
        activeCameraStream: null,
        activeCameraDeviceId: null,
        activeCameraLabel: null,
        cameraError: {
          code: 'TRACK_ENDED_UNEXPECTEDLY',
          channel: 'camera',
          title: 'Camera disconnected',
          message:
            'The active camera feed ended unexpectedly (device unplugged or permission revoked). Reconnect your camera or select another source.',
          recoverable: true,
        },
      });

      void this.enumerateDevices();
    };

    for (const track of tracks) {
      track.addEventListener('ended', onEnded);
    }

    this.detachCameraTrackListeners = () => {
      for (const track of tracks) {
        track.removeEventListener('ended', onEnded);
      }
    };
  }

  private bindMicrophoneTrackEnded(stream: MediaStream): void {
    const tracks = stream.getAudioTracks();
    const onEnded = () => {
      if (this.isDisposed || this.snapshot.activeMicrophoneStream !== stream) {
        return;
      }

      this.microphoneOpId += 1;
      this.releaseMicrophoneResources();

      this.setSnapshot({
        ...this.snapshot,
        microphoneStatus: 'ended',
        microphoneEnabled: false,
        activeMicrophoneStream: null,
        activeMicrophoneDeviceId: null,
        activeMicrophoneLabel: null,
        microphoneError: {
          code: 'TRACK_ENDED_UNEXPECTEDLY',
          channel: 'microphone',
          title: 'Microphone disconnected',
          message:
            'The active microphone ended unexpectedly (device unplugged or permission revoked). Reconnect your microphone or select another input.',
          recoverable: true,
        },
      });

      void this.enumerateDevices();
    };

    for (const track of tracks) {
      track.addEventListener('ended', onEnded);
    }

    this.detachMicrophoneTrackListeners = () => {
      for (const track of tracks) {
        track.removeEventListener('ended', onEnded);
      }
    };
  }

  private releaseCameraResources(): void {
    if (this.detachCameraTrackListeners) {
      this.detachCameraTrackListeners();
      this.detachCameraTrackListeners = null;
    }
    stopStreamTracksSafely(this.snapshot.activeCameraStream);
  }

  private releaseMicrophoneResources(): void {
    if (this.detachMicrophoneTrackListeners) {
      this.detachMicrophoneTrackListeners();
      this.detachMicrophoneTrackListeners = null;
    }
    stopStreamTracksSafely(this.snapshot.activeMicrophoneStream);
  }

  private ensureDeviceChangeSubscribed(): void {
    const md = this.mediaDevices;
    const rawAdd = md?.addEventListener;
    const rawRemove = md?.removeEventListener;
    if (this.detachDeviceChange !== null || !md || !rawAdd || !rawRemove) {
      return;
    }

    const addListener = rawAdd.bind(md);
    const removeListener = rawRemove.bind(md);

    const handleDeviceChange = () => {
      if (!this.isDisposed) {
        void this.enumerateDevices();
      }
    };

    addListener('devicechange', handleDeviceChange);
    this.detachDeviceChange = () => {
      removeListener('devicechange', handleDeviceChange);
    };
  }

  private setSnapshot(next: CaptureStateSnapshot): void {
    this.snapshot = next;
    for (const listener of this.listeners) {
      listener(this.snapshot);
    }
  }
}

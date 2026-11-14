import {
  SUPPORTED_PLAYBACK_SPEEDS,
  type PlaybackSpeed,
  type SourceMediaError,
  type SourcePlaybackState,
} from '../../types/media';
import type {
  SourcePlayer,
  SourcePlayerListener,
} from '../interfaces/source-player';
import {
  validateSourceVideoFile,
  type CanPlayTypeFn,
} from './file-validator';
import { ObjectUrlRegistry } from './object-url-registry';

export type DisplayMediaFn = (
  options?: DisplayMediaStreamOptions,
) => Promise<MediaStream>;

interface PendingLoadCandidate {
  readonly fileName: string;
  readonly fileSizeBytes: number;
  readonly mimeType: string;
  readonly lastModified: number;
  readonly generation: number;
}

export interface HtmlVideoSourcePlayerOptions {
  readonly urlRegistry?: ObjectUrlRegistry;
  readonly canPlayType?: CanPlayTypeFn;
  readonly getDisplayMedia?: DisplayMediaFn | null;
}

export function createInitialPlaybackState(): SourcePlaybackState {
  return {
    status: 'empty',
    sourceMode: 'file',
    objectUrl: null,
    metadata: null,
    pendingFileName: null,
    currentTimeSec: 0,
    durationSec: 0,
    playbackRate: 1,
    volume: 1,
    muted: false,
    hasScreenAudioTrack: false,
    error: null,
  };
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function isSupportedSpeed(value: number): value is PlaybackSpeed {
  return (SUPPORTED_PLAYBACK_SPEEDS as readonly number[]).includes(value);
}

function resolveDefaultDisplayMedia(): DisplayMediaFn | null {
  if (typeof navigator === 'undefined') {
    return null;
  }
  const devices = (
    navigator as Partial<Navigator> & {
      mediaDevices?: Partial<MediaDevices>;
    }
  ).mediaDevices;
  if (!devices || typeof devices.getDisplayMedia !== 'function') {
    return null;
  }
  return devices.getDisplayMedia.bind(devices);
}

function stopStreamTracksSafely(stream: MediaStream): void {
  for (const track of stream.getTracks()) {
    try {
      track.stop();
    } catch {
      // Ignore track stop errors on already-ended tracks
    }
  }
}

export class HtmlVideoSourcePlayer implements SourcePlayer {
  private state: SourcePlaybackState = createInitialPlaybackState();
  private readonly listeners = new Set<SourcePlayerListener>();
  private readonly urlRegistry: ObjectUrlRegistry;
  private readonly canPlayType?: CanPlayTypeFn;
  private readonly customGetDisplayMedia?: DisplayMediaFn | null;
  private videoElement: HTMLVideoElement | null = null;
  private detachElementListeners: (() => void) | null = null;
  private activeScreenStream: MediaStream | null = null;
  private detachScreenListeners: (() => void) | null = null;
  private pendingCandidate: PendingLoadCandidate | null = null;
  private loadGeneration = 0;
  private isClearingElement = false;
  private isExternalAudioControlled = false;
  private isSyncingElementUnity = false;

  public constructor(options: HtmlVideoSourcePlayerOptions = {}) {
    this.urlRegistry = options.urlRegistry ?? new ObjectUrlRegistry();
    this.canPlayType = options.canPlayType;
    this.customGetDisplayMedia = options.getDisplayMedia;
  }

  public getState(): SourcePlaybackState {
    return this.state;
  }

  public getScreenStream(): MediaStream | null {
    return this.activeScreenStream;
  }

  public subscribe(listener: SourcePlayerListener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  public attachVideoElement(element: HTMLVideoElement | null): void {
    if (this.videoElement === element) {
      return;
    }

    if (this.detachElementListeners) {
      this.detachElementListeners();
      this.detachElementListeners = null;
    }

    this.videoElement = element;

    if (!element) {
      return;
    }

    this.bindVideoEvents(element);
    this.applyAudioAndSpeedToElement(element);

    if (this.activeScreenStream) {
      element.removeAttribute('src');
      element.srcObject = this.activeScreenStream;
      this.enforceScreenMutedOnElement(element);
      void this.safePlayScreenElement(element);
      return;
    }

    if (
      this.state.objectUrl !== null &&
      element.getAttribute('src') !== this.state.objectUrl
    ) {
      element.srcObject = null;
      element.src = this.state.objectUrl;
      this.safeCallLoad(element);
    }
  }

  public loadFile(file: File): void {
    this.loadGeneration += 1;
    const currentGen = this.loadGeneration;

    this.releaseOwnedScreenStream();

    if (this.videoElement && !this.videoElement.paused) {
      this.safeCallPause(this.videoElement);
    }

    const validation = validateSourceVideoFile(file, this.canPlayType);
    if (!validation.valid) {
      this.pendingCandidate = null;
      this.clearVideoElementSource();
      this.urlRegistry.revokeAll();
      this.setState({
        ...this.state,
        status: 'error',
        sourceMode: 'file',
        objectUrl: null,
        metadata: null,
        pendingFileName: null,
        currentTimeSec: 0,
        durationSec: 0,
        hasScreenAudioTrack: false,
        error: validation.error,
      });
      return;
    }

    const nextObjectUrl = this.urlRegistry.replacePrimary(file);
    this.pendingCandidate = {
      fileName: file.name,
      fileSizeBytes: file.size,
      mimeType: validation.normalizedMimeType,
      lastModified: file.lastModified,
      generation: currentGen,
    };

    this.setState({
      ...this.state,
      status: 'loading',
      sourceMode: 'file',
      objectUrl: nextObjectUrl,
      metadata: null,
      pendingFileName: file.name,
      currentTimeSec: 0,
      durationSec: 0,
      hasScreenAudioTrack: false,
      error: null,
    });

    if (this.videoElement) {
      this.videoElement.srcObject = null;
      this.applyAudioAndSpeedToElement(this.videoElement);
      this.videoElement.src = nextObjectUrl;
      this.safeCallLoad(this.videoElement);
    }
  }

  public async startScreenShare(): Promise<void> {
    const displayMediaFn =
      this.customGetDisplayMedia !== undefined
        ? this.customGetDisplayMedia
        : resolveDefaultDisplayMedia();

    if (!displayMediaFn) {
      this.releaseOwnedScreenStream();
      this.clearVideoElementSource();
      this.urlRegistry.revokeAll();
      this.setState({
        ...this.state,
        status: 'error',
        sourceMode: 'file',
        objectUrl: null,
        metadata: null,
        pendingFileName: null,
        currentTimeSec: 0,
        durationSec: 0,
        hasScreenAudioTrack: false,
        error: {
          code: 'SCREEN_CAPTURE_UNSUPPORTED',
          title: 'Screen sharing unavailable',
          message:
            'This browser environment does not support getDisplayMedia screen or tab capture.',
          recoverable: true,
        },
      });
      return;
    }

    this.loadGeneration += 1;
    const requestGen = this.loadGeneration;
    const hadLoadedSourceBeforePrompt =
      this.state.metadata !== null &&
      (this.state.objectUrl !== null || this.activeScreenStream !== null);

    let capturedStream: MediaStream;
    try {
      capturedStream = await displayMediaFn({
        video: {
          frameRate: { ideal: 30, max: 60 },
        },
        audio: true,
      });
    } catch (err: unknown) {
      if (this.loadGeneration !== requestGen) {
        return;
      }

      const isUserDismissed =
        err instanceof DOMException &&
        (err.name === 'NotAllowedError' || err.name === 'AbortError');

      if (isUserDismissed && hadLoadedSourceBeforePrompt) {
        // Keep the creator's already-loaded source intact when canceling the OS picker
        return;
      }

      const reason =
        err instanceof Error && err.message
          ? err.message
          : 'Screen capture permission was declined or failed.';

      this.releaseOwnedScreenStream();
      this.clearVideoElementSource();
      this.urlRegistry.revokeAll();
      this.setState({
        ...this.state,
        status: 'error',
        sourceMode: 'file',
        objectUrl: null,
        metadata: null,
        pendingFileName: null,
        currentTimeSec: 0,
        durationSec: 0,
        hasScreenAudioTrack: false,
        error: {
          code: isUserDismissed
            ? 'SCREEN_CAPTURE_DENIED'
            : 'SCREEN_CAPTURE_FAILED',
          title: isUserDismissed
            ? 'Screen share canceled or blocked'
            : 'Screen share could not start',
          message: isUserDismissed
            ? 'Select a browser tab, window, or screen when prompted, or import a local video file.'
            : `Unable to capture screen stream: ${reason}`,
          recoverable: true,
        },
      });
      return;
    }

    if (this.loadGeneration !== requestGen) {
      stopStreamTracksSafely(capturedStream);
      return;
    }

    const videoTrack = capturedStream.getVideoTracks()[0];
    if (!videoTrack || videoTrack.readyState === 'ended') {
      stopStreamTracksSafely(capturedStream);
      this.releaseOwnedScreenStream();
      this.clearVideoElementSource();
      this.urlRegistry.revokeAll();
      this.setState({
        ...this.state,
        status: 'error',
        sourceMode: 'file',
        objectUrl: null,
        metadata: null,
        pendingFileName: null,
        currentTimeSec: 0,
        durationSec: 0,
        hasScreenAudioTrack: false,
        error: {
          code: 'NO_VIDEO_TRACK',
          title: 'Screen share contained no video track',
          message:
            'The shared source did not provide a live video track. Try sharing a window or tab again.',
          recoverable: true,
        },
      });
      return;
    }

    // Tear down any previous screen stream or local file Object URL cleanly
    this.releaseOwnedScreenStream();
    this.pendingCandidate = null;
    this.urlRegistry.revokeAll();

    this.activeScreenStream = capturedStream;

    const onScreenEnded = () => {
      if (this.activeScreenStream !== capturedStream) {
        return;
      }
      this.unload();
    };
    videoTrack.addEventListener('ended', onScreenEnded);
    this.detachScreenListeners = () => {
      videoTrack.removeEventListener('ended', onScreenEnded);
    };

    const settings =
      typeof videoTrack.getSettings === 'function'
        ? videoTrack.getSettings()
        : undefined;
    const initialWidth =
      settings?.width && settings.width > 0 ? settings.width : 1280;
    const initialHeight =
      settings?.height && settings.height > 0 ? settings.height : 720;
    const label = videoTrack.label.trim() || 'Live Screen Share';
    const hasScreenAudio = capturedStream
      .getAudioTracks()
      .some((track) => track.readyState !== 'ended');

    if (this.videoElement) {
      this.isClearingElement = true;
      try {
        this.videoElement.removeAttribute('src');
        this.videoElement.srcObject = capturedStream;
        this.enforceScreenMutedOnElement(this.videoElement);
      } finally {
        this.isClearingElement = false;
      }
      await this.safePlayScreenElement(this.videoElement);
    }

    if (this.loadGeneration !== requestGen) {
      return;
    }

    const measuredWidth =
      this.videoElement && this.videoElement.videoWidth > 0
        ? this.videoElement.videoWidth
        : initialWidth;
    const measuredHeight =
      this.videoElement && this.videoElement.videoHeight > 0
        ? this.videoElement.videoHeight
        : initialHeight;

    this.setState({
      ...this.state,
      status: 'playing',
      sourceMode: 'screen',
      objectUrl: null,
      metadata: {
        fileName: label,
        fileSizeBytes: 0,
        mimeType: 'video/x-display-media',
        lastModified: Date.now(),
        durationSec: 0,
        width: measuredWidth,
        height: measuredHeight,
      },
      pendingFileName: null,
      currentTimeSec: 0,
      durationSec: 0,
      hasScreenAudioTrack: hasScreenAudio,
      error: null,
    });
  }

  public unload(): void {
    this.loadGeneration += 1;
    this.pendingCandidate = null;
    this.releaseOwnedScreenStream();
    this.clearVideoElementSource();
    this.urlRegistry.revokeAll();

    this.setState({
      ...this.state,
      status: 'empty',
      sourceMode: 'file',
      objectUrl: null,
      metadata: null,
      pendingFileName: null,
      currentTimeSec: 0,
      durationSec: 0,
      hasScreenAudioTrack: false,
      error: null,
    });
  }

  public async play(): Promise<void> {
    if (!this.videoElement || !this.hasPlayableMedia()) {
      return;
    }

    const activeGen = this.loadGeneration;

    if (this.state.sourceMode === 'screen') {
      this.enforceScreenMutedOnElement(this.videoElement);
      await this.safePlayScreenElement(this.videoElement);
      if (this.loadGeneration === activeGen && this.hasPlayableMedia()) {
        this.setState({
          ...this.state,
          status: 'playing',
          error: null,
        });
      }
      return;
    }

    if (this.state.status === 'ended' || this.videoElement.ended) {
      this.videoElement.currentTime = 0;
      this.setState({
        ...this.state,
        currentTimeSec: 0,
      });
    }

    this.applyAudioAndSpeedToElement(this.videoElement);

    try {
      await this.videoElement.play();
      if (this.loadGeneration === activeGen && this.hasPlayableMedia()) {
        this.setState({
          ...this.state,
          status: 'playing',
          error: null,
        });
      }
    } catch (err: unknown) {
      if (this.loadGeneration !== activeGen) {
        return;
      }
      if (err instanceof DOMException && err.name === 'AbortError') {
        return;
      }
      const reason =
        err instanceof Error
          ? err.message
          : 'Browser blocked or failed playback.';
      this.setState({
        ...this.state,
        status: 'paused',
        error: {
          code: 'PLAYBACK_FAILED',
          title: 'Playback could not start',
          message: `Unable to play "${this.state.metadata?.fileName ?? 'source video'}": ${reason}`,
          fileName: this.state.metadata?.fileName,
          recoverable: true,
        },
      });
    }
  }

  public pause(): void {
    if (!this.videoElement || !this.hasPlayableMedia()) {
      return;
    }

    this.safeCallPause(this.videoElement);
    if (this.state.status === 'playing') {
      this.setState({
        ...this.state,
        status: 'paused',
      });
    }
  }

  public async togglePlayPause(): Promise<void> {
    if (this.state.status === 'playing') {
      this.pause();
      return;
    }
    await this.play();
  }

  public seek(timeSec: number): void {
    if (
      this.state.sourceMode === 'screen' ||
      !this.hasPlayableMedia() ||
      !Number.isFinite(timeSec)
    ) {
      return;
    }

    const clampedTime = clamp(timeSec, 0, this.state.durationSec);
    if (this.videoElement) {
      this.videoElement.currentTime = clampedTime;
    }

    const nextStatus =
      this.state.status === 'ended' && clampedTime < this.state.durationSec
        ? 'paused'
        : this.state.status;

    this.setState({
      ...this.state,
      status: nextStatus,
      currentTimeSec: clampedTime,
    });
  }

  public rewind(seconds = 10): void {
    if (this.state.sourceMode === 'screen') {
      return;
    }
    const delta = Number.isFinite(seconds) ? Math.max(0, seconds) : 10;
    this.seek(this.state.currentTimeSec - delta);
  }

  public restart(): void {
    if (this.state.sourceMode === 'screen') {
      return;
    }
    this.seek(0);
  }

  public setPlaybackRate(rate: PlaybackSpeed): void {
    if (!isSupportedSpeed(rate)) {
      return;
    }

    if (this.videoElement && this.state.sourceMode !== 'screen') {
      this.videoElement.defaultPlaybackRate = rate;
      this.videoElement.playbackRate = rate;
    }

    this.setState({
      ...this.state,
      playbackRate: rate,
    });
  }

  public setVolume(volume: number): void {
    if (!Number.isFinite(volume)) {
      return;
    }

    const maxGain =
      this.isExternalAudioControlled || this.state.sourceMode === 'screen'
        ? 2
        : 1;
    const clampedVolume = Math.round(clamp(volume, 0, maxGain) * 100) / 100;
    const nextMuted =
      clampedVolume > 0 && this.state.muted ? false : this.state.muted;

    if (this.videoElement) {
      if (this.state.sourceMode === 'screen') {
        this.enforceScreenMutedOnElement(this.videoElement);
      } else if (this.isExternalAudioControlled) {
        this.enforceUnityOnElement(this.videoElement);
      } else {
        this.videoElement.volume = clampedVolume;
        this.videoElement.muted = nextMuted;
      }
    }

    if (
      clampedVolume !== this.state.volume ||
      nextMuted !== this.state.muted
    ) {
      this.setState({
        ...this.state,
        volume: clampedVolume,
        muted: nextMuted,
      });
    }
  }

  public setMuted(muted: boolean): void {
    if (this.videoElement) {
      if (this.state.sourceMode === 'screen') {
        this.enforceScreenMutedOnElement(this.videoElement);
      } else if (this.isExternalAudioControlled) {
        this.enforceUnityOnElement(this.videoElement);
      } else {
        this.videoElement.muted = muted;
      }
    }

    if (muted !== this.state.muted) {
      this.setState({
        ...this.state,
        muted,
      });
    }
  }

  public toggleMute(): void {
    this.setMuted(!this.state.muted);
  }

  public setExternalAudioControl(enabled: boolean): void {
    if (this.isExternalAudioControlled === enabled) {
      return;
    }

    this.isExternalAudioControlled = enabled;

    if (
      !enabled &&
      this.state.sourceMode !== 'screen' &&
      this.state.volume > 1
    ) {
      this.state = {
        ...this.state,
        volume: 1,
      };
    }

    if (this.videoElement) {
      this.applyAudioAndSpeedToElement(this.videoElement);
    }
  }

  public dispose(): void {
    this.loadGeneration += 1;
    this.pendingCandidate = null;
    this.isExternalAudioControlled = false;
    this.releaseOwnedScreenStream();
    this.clearVideoElementSource();

    if (this.detachElementListeners) {
      this.detachElementListeners();
      this.detachElementListeners = null;
    }

    this.videoElement = null;
    this.urlRegistry.revokeAll();
    this.state = createInitialPlaybackState();
    this.listeners.clear();
  }

  private releaseOwnedScreenStream(): void {
    if (this.detachScreenListeners) {
      this.detachScreenListeners();
      this.detachScreenListeners = null;
    }
    if (this.activeScreenStream) {
      const stream = this.activeScreenStream;
      this.activeScreenStream = null;
      stopStreamTracksSafely(stream);
    }
  }

  private async safePlayScreenElement(element: HTMLVideoElement): Promise<void> {
    try {
      const playPromise = element.play();
      if (playPromise instanceof Promise) {
        await playPromise;
      }
    } catch {
      // Headless JSDOM or aborted transitions safely ignored
    }
  }

  private hasPlayableMedia(): boolean {
    return (
      this.state.status === 'ready' ||
      this.state.status === 'playing' ||
      this.state.status === 'paused' ||
      this.state.status === 'ended'
    );
  }

  private enforceScreenMutedOnElement(element: HTMLVideoElement): void {
    this.isSyncingElementUnity = true;
    try {
      element.volume = 0;
      element.muted = true;
    } finally {
      this.isSyncingElementUnity = false;
    }
  }

  private enforceUnityOnElement(element: HTMLVideoElement): void {
    if (element.volume === 1 && !element.muted) {
      return;
    }
    this.isSyncingElementUnity = true;
    try {
      element.volume = 1;
      element.muted = false;
    } finally {
      this.isSyncingElementUnity = false;
    }
  }

  private applyAudioAndSpeedToElement(element: HTMLVideoElement): void {
    if (this.activeScreenStream || this.state.sourceMode === 'screen') {
      this.enforceScreenMutedOnElement(element);
      return;
    }
    element.defaultPlaybackRate = this.state.playbackRate;
    element.playbackRate = this.state.playbackRate;
    if (this.isExternalAudioControlled) {
      this.enforceUnityOnElement(element);
    } else {
      element.volume = clamp(this.state.volume, 0, 1);
      element.muted = this.state.muted;
    }
  }

  private clearVideoElementSource(): void {
    if (!this.videoElement) {
      return;
    }

    this.isClearingElement = true;
    try {
      this.safeCallPause(this.videoElement);
      this.videoElement.srcObject = null;
      this.videoElement.removeAttribute('src');
      this.safeCallLoad(this.videoElement);
    } finally {
      this.isClearingElement = false;
    }
  }

  private safeCallPause(element: HTMLVideoElement): void {
    try {
      element.pause();
    } catch {
      // Ignore non-implemented stub errors in headless test environments
    }
  }

  private safeCallLoad(element: HTMLVideoElement): void {
    try {
      element.load();
    } catch {
      // Ignore non-implemented stub errors in headless test environments
    }
  }

  private failCurrentLoad(error: SourceMediaError): void {
    this.loadGeneration += 1;
    this.pendingCandidate = null;
    this.releaseOwnedScreenStream();
    this.clearVideoElementSource();
    this.urlRegistry.revokeAll();

    this.setState({
      ...this.state,
      status: 'error',
      sourceMode: 'file',
      objectUrl: null,
      metadata: null,
      pendingFileName: null,
      currentTimeSec: 0,
      durationSec: 0,
      hasScreenAudioTrack: false,
      error,
    });
  }

  private bindVideoEvents(element: HTMLVideoElement): void {
    const onLoadedMetadata = () => {
      if (this.isClearingElement) {
        return;
      }

      if (this.activeScreenStream && this.state.sourceMode === 'screen') {
        const liveW = element.videoWidth;
        const liveH = element.videoHeight;
        if (
          liveW > 0 &&
          liveH > 0 &&
          this.state.metadata &&
          (this.state.metadata.width !== liveW ||
            this.state.metadata.height !== liveH)
        ) {
          this.setState({
            ...this.state,
            metadata: {
              ...this.state.metadata,
              width: liveW,
              height: liveH,
            },
          });
        }
        return;
      }

      if (this.state.objectUrl === null) {
        return;
      }

      const candidate = this.pendingCandidate;
      if (candidate && candidate.generation !== this.loadGeneration) {
        return;
      }

      const duration = element.duration;
      const width = element.videoWidth;
      const height = element.videoHeight;
      const fileName =
        candidate?.fileName ?? this.state.metadata?.fileName ?? 'selected file';

      if (width <= 0 || height <= 0) {
        this.failCurrentLoad({
          code: 'NO_VIDEO_TRACK',
          title: 'No decodable video track',
          message: `"${fileName}" loaded without video dimensions (audio-only or unsupported video codec). Select a video encoded with H.264, VP8, VP9, or AV1.`,
          fileName,
          recoverable: true,
        });
        return;
      }

      if (!Number.isFinite(duration) || duration <= 0) {
        this.failCurrentLoad({
          code: 'MEDIA_DECODE_ERROR',
          title: 'Invalid video duration',
          message: `"${fileName}" did not report a valid finite playback duration.`,
          fileName,
          recoverable: true,
        });
        return;
      }

      this.applyAudioAndSpeedToElement(element);
      this.pendingCandidate = null;

      this.setState({
        ...this.state,
        status: 'ready',
        sourceMode: 'file',
        metadata: {
          fileName,
          fileSizeBytes:
            candidate?.fileSizeBytes ?? this.state.metadata?.fileSizeBytes ?? 0,
          mimeType:
            candidate?.mimeType ?? this.state.metadata?.mimeType ?? 'video/mp4',
          lastModified:
            candidate?.lastModified ?? this.state.metadata?.lastModified ?? 0,
          durationSec: duration,
          width,
          height,
        },
        pendingFileName: null,
        durationSec: duration,
        currentTimeSec: clamp(element.currentTime, 0, duration),
        hasScreenAudioTrack: false,
        error: null,
      });
    };

    const onTimeUpdate = () => {
      if (
        this.isClearingElement ||
        !this.hasPlayableMedia() ||
        this.activeScreenStream !== null ||
        this.state.sourceMode === 'screen'
      ) {
        return;
      }

      const nextTime = clamp(element.currentTime, 0, this.state.durationSec);
      if (nextTime !== this.state.currentTimeSec) {
        this.setState({
          ...this.state,
          currentTimeSec: nextTime,
        });
      }
    };

    const onPlay = () => {
      if (this.isClearingElement || !this.hasPlayableMedia()) {
        return;
      }
      if (this.state.status !== 'playing') {
        this.setState({
          ...this.state,
          status: 'playing',
          error: null,
        });
      }
    };

    const onPause = () => {
      if (this.isClearingElement || !this.hasPlayableMedia() || element.ended) {
        return;
      }
      if (this.state.status === 'playing') {
        this.setState({
          ...this.state,
          status: 'paused',
        });
      }
    };

    const onEnded = () => {
      if (
        this.isClearingElement ||
        !this.hasPlayableMedia() ||
        this.activeScreenStream !== null ||
        this.state.sourceMode === 'screen'
      ) {
        return;
      }
      this.setState({
        ...this.state,
        status: 'ended',
        currentTimeSec: this.state.durationSec,
      });
    };

    const onRateChange = () => {
      if (
        this.isClearingElement ||
        this.activeScreenStream !== null ||
        this.state.sourceMode === 'screen'
      ) {
        return;
      }
      const nextRate = element.playbackRate;
      if (isSupportedSpeed(nextRate) && nextRate !== this.state.playbackRate) {
        this.setState({
          ...this.state,
          playbackRate: nextRate,
        });
      }
    };

    const onVolumeChange = () => {
      if (this.isClearingElement || this.isSyncingElementUnity) {
        return;
      }
      if (this.activeScreenStream !== null || this.state.sourceMode === 'screen') {
        this.enforceScreenMutedOnElement(element);
        return;
      }
      if (this.isExternalAudioControlled) {
        this.enforceUnityOnElement(element);
        return;
      }
      const nextVol = Math.round(clamp(element.volume, 0, 1) * 100) / 100;
      const nextMuted = element.muted;
      if (nextVol !== this.state.volume || nextMuted !== this.state.muted) {
        this.setState({
          ...this.state,
          volume: nextVol,
          muted: nextMuted,
        });
      }
    };

    const onError = () => {
      if (
        this.isClearingElement ||
        this.activeScreenStream !== null ||
        this.state.sourceMode === 'screen' ||
        this.state.objectUrl === null
      ) {
        return;
      }

      const fileName =
        this.pendingCandidate?.fileName ??
        this.state.metadata?.fileName ??
        this.state.pendingFileName ??
        'selected video';
      const mediaError = element.error;
      const errorCode = mediaError?.code;

      if (errorCode === 1) {
        this.failCurrentLoad({
          code: 'MEDIA_LOAD_ABORTED',
          title: 'Video load aborted',
          message: `Loading "${fileName}" was interrupted before completion. Select the file again.`,
          fileName,
          recoverable: true,
        });
        return;
      }

      if (errorCode === 4) {
        this.failCurrentLoad({
          code: 'BROWSER_CODEC_UNSUPPORTED',
          title: 'Unsupported video codec or corrupted container',
          message: `"${fileName}" could not be decoded by your browser. Ensure it uses standard H.264/AAC (MP4) or VP8/VP9/AV1 (WebM).`,
          fileName,
          recoverable: true,
        });
        return;
      }

      this.failCurrentLoad({
        code: 'MEDIA_DECODE_ERROR',
        title: 'Video playback error',
        message: `"${fileName}" encountered a media decoding error and cannot be played.`,
        fileName,
        recoverable: true,
      });
    };

    element.addEventListener('loadedmetadata', onLoadedMetadata);
    element.addEventListener('timeupdate', onTimeUpdate);
    element.addEventListener('play', onPlay);
    element.addEventListener('playing', onPlay);
    element.addEventListener('pause', onPause);
    element.addEventListener('ended', onEnded);
    element.addEventListener('ratechange', onRateChange);
    element.addEventListener('volumechange', onVolumeChange);
    element.addEventListener('error', onError);

    this.detachElementListeners = () => {
      element.removeEventListener('loadedmetadata', onLoadedMetadata);
      element.removeEventListener('timeupdate', onTimeUpdate);
      element.removeEventListener('play', onPlay);
      element.removeEventListener('playing', onPlay);
      element.removeEventListener('pause', onPause);
      element.removeEventListener('ended', onEnded);
      element.removeEventListener('ratechange', onRateChange);
      element.removeEventListener('volumechange', onVolumeChange);
      element.removeEventListener('error', onError);
    };
  }

  private setState(nextState: SourcePlaybackState): void {
    this.state = nextState;
    for (const listener of this.listeners) {
      listener(this.state);
    }
  }
}

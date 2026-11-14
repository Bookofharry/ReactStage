import {
  DEFAULT_AUDIO_BITS_PER_SECOND,
  DEFAULT_RECORDING_TIMESLICE_MS,
  DEFAULT_VIDEO_BITS_PER_SECOND,
  PREFERRED_AV_RECORDING_MIME_TYPES,
  PREFERRED_VIDEO_ONLY_RECORDING_MIME_TYPES,
  type AddChapterMarkerInput,
  type RecordedMediaArtifact,
  type RecordingChapterMarker,
  type RecordingEngine,
  type RecordingEngineConfig,
  type RecordingEngineError,
  type RecordingErrorCode,
  type RecordingStateSnapshot,
  type RecordingTelemetry,
} from '../interfaces/recording-engine';
import type { RecordingLifecycleStatus } from '../../types/media';
import { sanitizeChapterLabel } from '../../utils/chapters';
import { patchWebmDurationIfStreaming } from './webm-duration';

export interface MediaRecorderLike {
  readonly state: RecordingState;
  readonly mimeType: string;
  ondataavailable: ((event: BlobEvent) => void) | null;
  onstop: ((event: Event) => void) | null;
  onerror: ((event: ErrorEvent) => void) | null;
  start(timeslice?: number): void;
  stop(): void;
  pause(): void;
  resume(): void;
  requestData(): void;
}

export interface BrowserRecordingEngineOptions {
  readonly mediaRecorderFactory?: (
    stream: MediaStream,
    options: MediaRecorderOptions,
  ) => MediaRecorderLike;
  readonly isTypeSupported?: (mimeType: string) => boolean;
  readonly now?: () => number;
  readonly clockIntervalMs?: number;
}

function createRecordingError(
  code: RecordingErrorCode,
  title: string,
  message: string,
  recoverable = true,
): RecordingEngineError {
  return { code, title, message, recoverable };
}

function composeMediaStream(tracks: MediaStreamTrack[]): MediaStream {
  if (typeof MediaStream !== 'undefined') {
    return new MediaStream(tracks);
  }
  return {
    id: `synthetic-recording-stream-${String(Date.now())}`,
    active: tracks.some((t) => t.readyState === 'live'),
    getTracks: () => [...tracks],
    getVideoTracks: () => tracks.filter((t) => t.kind === 'video'),
    getAudioTracks: () => tracks.filter((t) => t.kind === 'audio'),
  } as unknown as MediaStream;
}

export class RecordingEngineOperationError extends Error {
  public readonly details: RecordingEngineError;

  public constructor(details: RecordingEngineError) {
    super(`${details.code}: ${details.message}`);
    this.name = 'RecordingEngineOperationError';
    this.details = details;
  }
}

export class BrowserRecordingEngine implements RecordingEngine {
  private readonly customFactory:
    | ((
        stream: MediaStream,
        options: MediaRecorderOptions,
      ) => MediaRecorderLike)
    | undefined;
  private readonly customIsTypeSupported:
    | ((mimeType: string) => boolean)
    | undefined;
  private readonly nowFn: () => number;
  private readonly clockIntervalMs: number;

  private readonly stateListeners = new Set<
    (state: RecordingStateSnapshot) => void
  >();
  private readonly telemetryListeners = new Set<
    (telemetry: RecordingTelemetry) => void
  >();

  private status: RecordingLifecycleStatus = 'idle';
  private negotiatedMimeType: string | null = null;
  private activeWidth = 0;
  private activeHeight = 0;
  private hasAudioTrack = false;
  private lastArtifact: RecordedMediaArtifact | null = null;
  private error: RecordingEngineError | null = null;

  private accumulatedElapsedMs = 0;
  private activeSegmentStartMs: number | null = null;
  private recordedBytes = 0;
  private chunkCount = 0;
  private chunks: Blob[] = [];
  private activeMarkers: RecordingChapterMarker[] = [];
  private markerCounter = 0;

  private activeRecorder: MediaRecorderLike | null = null;
  private activeVideoStream: MediaStream | null = null;
  private stopVideoTracksOnFinalize = false;
  private detachVideoTrackListeners: (() => void) | null = null;
  private clockTimerId: ReturnType<typeof setInterval> | null = null;
  private sessionGeneration = 0;
  private artifactCounter = 0;
  private disposed = false;

  private pendingStop: {
    promise: Promise<RecordedMediaArtifact>;
    resolve: (artifact: RecordedMediaArtifact) => void;
    reject: (reason: Error) => void;
  } | null = null;

  private stateSnapshot: RecordingStateSnapshot;
  private telemetrySnapshot: RecordingTelemetry;

  public constructor(options: BrowserRecordingEngineOptions = {}) {
    this.customFactory = options.mediaRecorderFactory;
    this.customIsTypeSupported = options.isTypeSupported;
    this.nowFn =
      options.now ??
      (() =>
        typeof performance !== 'undefined' ? performance.now() : Date.now());
    this.clockIntervalMs = Math.max(25, options.clockIntervalMs ?? 100);

    this.stateSnapshot = this.buildStateSnapshot();
    this.telemetrySnapshot = this.buildTelemetrySnapshot();
  }

  public getState(): RecordingStateSnapshot {
    return this.stateSnapshot;
  }

  public subscribeState(
    listener: (state: RecordingStateSnapshot) => void,
  ): () => void {
    this.stateListeners.add(listener);
    return () => {
      this.stateListeners.delete(listener);
    };
  }

  public getTelemetry(): RecordingTelemetry {
    return this.telemetrySnapshot;
  }

  public subscribe(
    listener: (telemetry: RecordingTelemetry) => void,
  ): () => void {
    this.telemetryListeners.add(listener);
    return () => {
      this.telemetryListeners.delete(listener);
    };
  }

  public getSupportedMimeTypes(): readonly string[] {
    if (!this.isRecorderApiAvailable()) {
      return [];
    }
    const candidates = [
      ...PREFERRED_AV_RECORDING_MIME_TYPES,
      ...PREFERRED_VIDEO_ONLY_RECORDING_MIME_TYPES,
    ];
    const unique: string[] = [];
    for (const mime of candidates) {
      if (!unique.includes(mime) && this.checkMimeSupported(mime)) {
        unique.push(mime);
      }
    }
    return unique;
  }

  public start(
    compositedVideoStream: MediaStream,
    mixedAudioStream: MediaStream | null,
    config?: Partial<RecordingEngineConfig>,
  ): Promise<void> {
    if (this.disposed) {
      return Promise.reject(
        new RecordingEngineOperationError(
          createRecordingError(
            'RECORDER_STATE_INVALID',
            'Recording engine disposed',
            'Cannot start recording on a disposed RecordingEngine instance.',
          ),
        ),
      );
    }

    if (
      this.status === 'arming' ||
      this.status === 'recording' ||
      this.status === 'paused' ||
      this.status === 'stopping'
    ) {
      return Promise.reject(
        new RecordingEngineOperationError(
          createRecordingError(
            'RECORDER_STATE_INVALID',
            'Session already active',
            'Stop or cancel the active recording session before starting a new one.',
          ),
        ),
      );
    }

    const shouldOwnVideoTracks = Boolean(config?.stopVideoTracksOnFinalize);

    if (!this.isRecorderApiAvailable()) {
      if (shouldOwnVideoTracks) {
        this.stopOwnedVideoTracks(compositedVideoStream);
      }
      const unsupportedErr = createRecordingError(
        'RECORDER_UNSUPPORTED',
        'MediaRecorder unavailable',
        'This browser does not support local MediaRecorder video capture.',
        false,
      );
      this.failWithState(unsupportedErr);
      return Promise.reject(new RecordingEngineOperationError(unsupportedErr));
    }

    const liveVideoTracks = compositedVideoStream
      .getVideoTracks()
      .filter((track) => track.readyState === 'live');

    if (liveVideoTracks.length === 0) {
      if (shouldOwnVideoTracks) {
        this.stopOwnedVideoTracks(compositedVideoStream);
      }
      const noVideoErr = createRecordingError(
        'INVALID_VIDEO_TRACK',
        'Live scene video stream unavailable',
        'The scene compositor canvas does not currently expose a live video track to record.',
      );
      this.failWithState(noVideoErr);
      return Promise.reject(new RecordingEngineOperationError(noVideoErr));
    }

    const liveAudioTracks = (mixedAudioStream?.getAudioTracks() ?? []).filter(
      (track) => track.readyState === 'live',
    );
    const hasAudio = liveAudioTracks.length > 0;

    const candidateMimeTypes =
      config?.preferredMimeTypes && config.preferredMimeTypes.length > 0
        ? config.preferredMimeTypes
        : hasAudio
          ? PREFERRED_AV_RECORDING_MIME_TYPES
          : PREFERRED_VIDEO_ONLY_RECORDING_MIME_TYPES;

    const chosenMimeType = this.negotiateMimeType(candidateMimeTypes);
    if (!chosenMimeType) {
      if (shouldOwnVideoTracks) {
        this.stopOwnedVideoTracks(compositedVideoStream);
      }
      const codecErr = createRecordingError(
        'NO_SUPPORTED_MIME_TYPE',
        'No supported recording format',
        'Your browser could not negotiate a compatible WebM or MP4 recording codec.',
        false,
      );
      this.failWithState(codecErr);
      return Promise.reject(new RecordingEngineOperationError(codecErr));
    }

    const gen = ++this.sessionGeneration;
    this.status = 'arming';
    this.error = null;
    this.lastArtifact = null;
    this.chunks = [];
    this.recordedBytes = 0;
    this.chunkCount = 0;
    this.accumulatedElapsedMs = 0;
    this.activeSegmentStartMs = null;
    this.activeMarkers = [];
    this.negotiatedMimeType = chosenMimeType;
    this.hasAudioTrack = hasAudio;

    const primaryVideoTrack = liveVideoTracks[0];
    const trackSettings =
      typeof primaryVideoTrack?.getSettings === 'function'
        ? primaryVideoTrack.getSettings()
        : undefined;
    this.activeWidth = config?.width ?? trackSettings?.width ?? 1280;
    this.activeHeight = config?.height ?? trackSettings?.height ?? 720;

    this.activeVideoStream = compositedVideoStream;
    this.stopVideoTracksOnFinalize = shouldOwnVideoTracks;
    this.emitBoth();

    const combinedTracks: MediaStreamTrack[] = [
      ...liveVideoTracks.slice(0, 1),
      ...liveAudioTracks.slice(0, 1),
    ];
    const combinedStream = composeMediaStream(combinedTracks);

    const videoBps = Math.max(
      250_000,
      config?.videoBitsPerSecond ?? DEFAULT_VIDEO_BITS_PER_SECOND,
    );
    const audioBps = Math.max(
      32_000,
      config?.audioBitsPerSecond ?? DEFAULT_AUDIO_BITS_PER_SECOND,
    );
    const timesliceMs = Math.max(
      50,
      config?.timesliceMs ?? DEFAULT_RECORDING_TIMESLICE_MS,
    );

    const recorderOptions: MediaRecorderOptions = hasAudio
      ? {
          mimeType: chosenMimeType,
          videoBitsPerSecond: videoBps,
          audioBitsPerSecond: audioBps,
        }
      : {
          mimeType: chosenMimeType,
          videoBitsPerSecond: videoBps,
        };

    try {
      const recorder = this.createRecorderInstance(
        combinedStream,
        recorderOptions,
      );
      this.activeRecorder = recorder;
      if (recorder.mimeType) {
        this.negotiatedMimeType = recorder.mimeType;
      }

      recorder.ondataavailable = (event: BlobEvent) => {
        if (gen !== this.sessionGeneration || this.disposed) {
          return;
        }
        if (event.data.size > 0) {
          this.chunks.push(event.data);
          this.recordedBytes += event.data.size;
          this.chunkCount += 1;
          this.emitTelemetryOnly();
        }
      };

      recorder.onerror = () => {
        if (gen !== this.sessionGeneration || this.disposed) {
          return;
        }
        const runtimeErr = createRecordingError(
          'RECORDER_RUNTIME_ERROR',
          'Recording interrupted',
          'The browser MediaRecorder encountered an unexpected encoding error during capture.',
        );
        this.abortSessionWithError(runtimeErr);
      };

      if (primaryVideoTrack) {
        const onVideoTrackEnded = () => {
          if (gen !== this.sessionGeneration || this.disposed) {
            return;
          }
          if (this.status === 'recording' || this.status === 'paused') {
            const endedErr = createRecordingError(
              'RECORDER_RUNTIME_ERROR',
              'Scene stream ended unexpectedly',
              'The composited scene video track terminated while recording was active.',
            );
            this.abortSessionWithError(endedErr);
          }
        };
        primaryVideoTrack.addEventListener('ended', onVideoTrackEnded);
        this.detachVideoTrackListeners = () => {
          primaryVideoTrack.removeEventListener('ended', onVideoTrackEnded);
        };
      }

      recorder.start(timesliceMs);
      this.status = 'recording';
      this.activeSegmentStartMs = this.nowFn();
      this.startClockTicker();
      this.emitBoth();
      return Promise.resolve();
    } catch (err) {
      const message =
        err instanceof Error && err.message
          ? err.message
          : 'Failed to initialize MediaRecorder session.';
      const startErr = createRecordingError(
        'RECORDER_START_FAILED',
        'Could not start recording',
        message,
      );
      this.cleanupSessionResources();
      this.failWithState(startErr);
      return Promise.reject(new RecordingEngineOperationError(startErr));
    }
  }

  public pause(): void {
    if (
      this.disposed ||
      this.status !== 'recording' ||
      this.activeRecorder?.state !== 'recording'
    ) {
      return;
    }

    try {
      this.freezeActiveSegmentClock();
      this.stopClockTicker();
      this.activeRecorder.pause();
      this.status = 'paused';
      this.emitBoth();
    } catch (err) {
      const message =
        err instanceof Error ? err.message : 'Unable to pause MediaRecorder.';
      this.abortSessionWithError(
        createRecordingError(
          'RECORDER_RUNTIME_ERROR',
          'Pause failed',
          message,
        ),
      );
    }
  }

  public resume(): void {
    if (
      this.disposed ||
      this.status !== 'paused' ||
      this.activeRecorder?.state !== 'paused'
    ) {
      return;
    }

    try {
      this.activeRecorder.resume();
      this.activeSegmentStartMs = this.nowFn();
      this.status = 'recording';
      this.startClockTicker();
      this.emitBoth();
    } catch (err) {
      const message =
        err instanceof Error ? err.message : 'Unable to resume MediaRecorder.';
      this.abortSessionWithError(
        createRecordingError(
          'RECORDER_RUNTIME_ERROR',
          'Resume failed',
          message,
        ),
      );
    }
  }

  public addChapterMarker(
    input?: AddChapterMarkerInput,
  ): RecordingChapterMarker | null {
    if (
      this.disposed ||
      (this.status !== 'recording' && this.status !== 'paused')
    ) {
      return null;
    }

    const nextIndex = this.activeMarkers.length + 1;
    const cleanedLabel = input?.label ? sanitizeChapterLabel(input.label) : '';
    const finalLabel =
      cleanedLabel.length > 0 ? cleanedLabel : `Highlight #${String(nextIndex)}`;
    const elapsedRecordingMs = this.computeCurrentElapsedMs();
    const rawSourceTime = input?.sourceTimeSec;
    const sourceTimeSec =
      typeof rawSourceTime === 'number' &&
      Number.isFinite(rawSourceTime) &&
      rawSourceTime >= 0
        ? Math.round(rawSourceTime * 100) / 100
        : null;

    this.markerCounter += 1;
    const marker: RecordingChapterMarker = {
      id: `marker-${String(this.markerCounter)}-${String(Date.now())}`,
      index: nextIndex,
      label: finalLabel,
      elapsedRecordingMs,
      sourceTimeSec,
      layoutMode: input?.layoutMode ?? 'pip',
    };

    this.activeMarkers = [...this.activeMarkers, marker];
    this.emitBoth();
    return marker;
  }

  public stop(): Promise<RecordedMediaArtifact> {
    if (this.pendingStop) {
      return this.pendingStop.promise;
    }

    if (
      this.disposed ||
      (this.status !== 'recording' && this.status !== 'paused') ||
      !this.activeRecorder
    ) {
      return Promise.reject(
        new RecordingEngineOperationError(
          createRecordingError(
            'RECORDER_STATE_INVALID',
            'No active recording to stop',
            'Start a recording session before calling stop().',
          ),
        ),
      );
    }

    const gen = this.sessionGeneration;
    const recorder = this.activeRecorder;

    this.freezeActiveSegmentClock();
    this.stopClockTicker();
    this.status = 'stopping';
    if (this.detachVideoTrackListeners) {
      this.detachVideoTrackListeners();
      this.detachVideoTrackListeners = null;
    }
    this.emitBoth();

    let resolveStop!: (artifact: RecordedMediaArtifact) => void;
    let rejectStop!: (reason: Error) => void;
    const stopPromise = new Promise<RecordedMediaArtifact>((res, rej) => {
      resolveStop = res;
      rejectStop = rej;
    });
    this.pendingStop = {
      promise: stopPromise,
      resolve: resolveStop,
      reject: rejectStop,
    };

    const finalizeFromStop = async (): Promise<void> => {
      if (!this.isSessionCurrent(gen)) {
        return;
      }

      const nonEmptyRecorderMime =
        recorder.mimeType.length > 0 ? recorder.mimeType : null;
      const rawMime =
        nonEmptyRecorderMime ?? this.negotiatedMimeType ?? 'video/webm';
      const durationMs = Math.max(1, Math.round(this.accumulatedElapsedMs));
      const collectedChunks = [...this.chunks];
      const chunkCount = this.chunkCount;
      const width = this.activeWidth;
      const height = this.activeHeight;
      const hasAudioTrack = this.hasAudioTrack;
      const frozenMarkers = [...this.activeMarkers];

      this.cleanupSessionResources();

      const rawBlob = new Blob(collectedChunks, { type: rawMime });
      if (rawBlob.size === 0) {
        const emptyErr = createRecordingError(
          'EMPTY_RECORDING_ARTIFACT',
          'Recording produced zero bytes',
          'No media frames were encoded before stopping. Ensure the scene stage is active and try again.',
        );
        this.failWithState(emptyErr);
        const pending = this.pendingStop;
        this.pendingStop = null;
        pending?.reject(new RecordingEngineOperationError(emptyErr));
        return;
      }

      const finalizedBlob = await patchWebmDurationIfStreaming(
        rawBlob,
        durationMs,
        rawMime,
      );

      if (!this.isSessionCurrent(gen)) {
        return;
      }

      this.artifactCounter += 1;
      const artifact: RecordedMediaArtifact = {
        id: `rec-${String(this.artifactCounter)}-${String(Date.now())}`,
        blob: finalizedBlob,
        mimeType: rawMime,
        durationMs,
        sizeBytes: finalizedBlob.size,
        chunkCount,
        width,
        height,
        hasAudioTrack,
        createdAtIso: new Date().toISOString(),
        chapterMarkers: frozenMarkers,
      };

      this.recordedBytes = finalizedBlob.size;
      this.lastArtifact = artifact;
      this.status = 'completed';
      this.error = null;
      this.emitBoth();

      const pending = this.pendingStop;
      this.pendingStop = null;
      pending?.resolve(artifact);
    };

    recorder.onstop = () => {
      void finalizeFromStop();
    };

    try {
      if (recorder.state !== 'inactive') {
        try {
          recorder.requestData();
        } catch {
          // Some browsers throw InvalidStateError if requestData() runs before first frame
        }
        recorder.stop();
      } else {
        void finalizeFromStop();
      }
    } catch (err) {
      const message =
        err instanceof Error
          ? err.message
          : 'Failed to finalize MediaRecorder session.';
      const finalizeErr = createRecordingError(
        'RECORDER_FINALIZE_FAILED',
        'Could not finalize recording',
        message,
      );
      this.cleanupSessionResources();
      this.failWithState(finalizeErr);
      this.pendingStop = null;
      rejectStop(new RecordingEngineOperationError(finalizeErr));
    }

    return stopPromise;
  }

  public cancel(): void {
    if (this.disposed) {
      return;
    }

    this.sessionGeneration += 1;
    this.stopClockTicker();
    this.cleanupSessionResources();

    const pending = this.pendingStop;
    this.pendingStop = null;
    if (pending) {
      pending.reject(
        new RecordingEngineOperationError(
          createRecordingError(
            'RECORDING_CANCELLED',
            'Recording cancelled',
            'The active recording session was cancelled and discarded.',
          ),
        ),
      );
    }

    this.chunks = [];
    this.recordedBytes = 0;
    this.chunkCount = 0;
    this.accumulatedElapsedMs = 0;
    this.activeSegmentStartMs = null;
    this.activeMarkers = [];
    this.status = 'idle';
    this.error = null;
    this.emitBoth();
  }

  public clearArtifact(): void {
    if (this.disposed) {
      return;
    }
    this.lastArtifact = null;
    this.activeMarkers = [];
    if (this.status === 'completed' || this.status === 'error') {
      this.status = 'idle';
      this.accumulatedElapsedMs = 0;
      this.activeSegmentStartMs = null;
      this.recordedBytes = 0;
      this.chunkCount = 0;
      this.error = null;
    }
    this.emitBoth();
  }

  public dispose(): void {
    if (this.disposed) {
      return;
    }
    this.cancel();
    this.disposed = true;
    this.lastArtifact = null;
    this.stateListeners.clear();
    this.telemetryListeners.clear();
  }

  private isSessionCurrent(expectedGen: number): boolean {
    return !this.disposed && expectedGen === this.sessionGeneration;
  }

  private isRecorderApiAvailable(): boolean {
    if (this.customFactory) {
      return true;
    }
    return typeof MediaRecorder !== 'undefined';
  }

  private checkMimeSupported(mimeType: string): boolean {
    if (this.customIsTypeSupported) {
      return this.customIsTypeSupported(mimeType);
    }
    if (typeof MediaRecorder === 'undefined') {
      return false;
    }
    if (typeof MediaRecorder.isTypeSupported !== 'function') {
      return mimeType === 'video/webm';
    }
    return MediaRecorder.isTypeSupported(mimeType);
  }

  private negotiateMimeType(candidates: readonly string[]): string | null {
    for (const mime of candidates) {
      if (this.checkMimeSupported(mime)) {
        return mime;
      }
    }
    return null;
  }

  private createRecorderInstance(
    stream: MediaStream,
    options: MediaRecorderOptions,
  ): MediaRecorderLike {
    if (this.customFactory) {
      return this.customFactory(stream, options);
    }
    return new MediaRecorder(stream, options);
  }

  private computeCurrentElapsedMs(): number {
    if (this.activeSegmentStartMs !== null && this.status === 'recording') {
      const delta = Math.max(0, this.nowFn() - this.activeSegmentStartMs);
      return Math.round(this.accumulatedElapsedMs + delta);
    }
    return Math.round(this.accumulatedElapsedMs);
  }

  private freezeActiveSegmentClock(): void {
    if (this.activeSegmentStartMs !== null) {
      const delta = Math.max(0, this.nowFn() - this.activeSegmentStartMs);
      this.accumulatedElapsedMs += delta;
      this.activeSegmentStartMs = null;
    }
  }

  private startClockTicker(): void {
    this.stopClockTicker();
    this.clockTimerId = setInterval(() => {
      if (this.disposed || this.status !== 'recording') {
        return;
      }
      this.emitTelemetryOnly();
    }, this.clockIntervalMs);
  }

  private stopClockTicker(): void {
    if (this.clockTimerId !== null) {
      clearInterval(this.clockTimerId);
      this.clockTimerId = null;
    }
  }

  private stopOwnedVideoTracks(stream: MediaStream | null): void {
    if (!stream) {
      return;
    }
    for (const track of stream.getVideoTracks()) {
      try {
        track.stop();
      } catch {
        // Ignore already-stopped track errors
      }
    }
  }

  private cleanupSessionResources(): void {
    if (this.detachVideoTrackListeners) {
      this.detachVideoTrackListeners();
      this.detachVideoTrackListeners = null;
    }

    const recorder = this.activeRecorder;
    this.activeRecorder = null;
    if (recorder) {
      recorder.ondataavailable = null;
      recorder.onstop = null;
      recorder.onerror = null;
      if (recorder.state !== 'inactive') {
        try {
          recorder.stop();
        } catch {
          // Ignore stop errors during cleanup
        }
      }
    }

    if (this.stopVideoTracksOnFinalize && this.activeVideoStream) {
      this.stopOwnedVideoTracks(this.activeVideoStream);
    }
    this.activeVideoStream = null;
    this.stopVideoTracksOnFinalize = false;
    this.chunks = [];
  }

  private abortSessionWithError(err: RecordingEngineError): void {
    this.sessionGeneration += 1;
    this.freezeActiveSegmentClock();
    this.stopClockTicker();
    this.cleanupSessionResources();

    const pending = this.pendingStop;
    this.pendingStop = null;
    if (pending) {
      pending.reject(new RecordingEngineOperationError(err));
    }

    this.failWithState(err);
  }

  private failWithState(err: RecordingEngineError): void {
    this.status = 'error';
    this.error = err;
    this.activeSegmentStartMs = null;
    this.emitBoth();
  }

  private buildStateSnapshot(): RecordingStateSnapshot {
    const supportedMimeTypes = this.getSupportedMimeTypes();
    return {
      isSupported:
        this.isRecorderApiAvailable() && supportedMimeTypes.length > 0,
      status: this.status,
      negotiatedMimeType:
        this.negotiatedMimeType ?? supportedMimeTypes[0] ?? null,
      supportedMimeTypes,
      activeWidth: this.activeWidth,
      activeHeight: this.activeHeight,
      hasAudioTrack: this.hasAudioTrack,
      lastArtifact: this.lastArtifact,
      error: this.error,
      activeMarkers: [...this.activeMarkers],
    };
  }

  private buildTelemetrySnapshot(): RecordingTelemetry {
    return {
      status: this.status,
      elapsedRecordingMs: this.computeCurrentElapsedMs(),
      negotiatedMimeType:
        this.negotiatedMimeType ?? this.stateSnapshot.negotiatedMimeType,
      recordedBytes: this.recordedBytes,
      chunkCount: this.chunkCount,
    };
  }

  private emitTelemetryOnly(): void {
    this.telemetrySnapshot = this.buildTelemetrySnapshot();
    for (const listener of this.telemetryListeners) {
      listener(this.telemetrySnapshot);
    }
  }

  private emitBoth(): void {
    this.stateSnapshot = this.buildStateSnapshot();
    this.telemetrySnapshot = this.buildTelemetrySnapshot();
    for (const listener of this.stateListeners) {
      listener(this.stateSnapshot);
    }
    for (const listener of this.telemetryListeners) {
      listener(this.telemetrySnapshot);
    }
  }
}

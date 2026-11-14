export interface MicrophoneMeterReading {
  readonly isMonitoring: boolean;
  readonly rms: number;
  readonly peak: number;
  readonly levelPercent: number;
  readonly clipping: boolean;
  readonly error: string | null;
}

export interface AudioAnalyserLike {
  fftSize: number;
  smoothingTimeConstant: number;
  getFloatTimeDomainData(array: Float32Array<ArrayBuffer>): void;
  disconnect(): void;
}

export interface MediaStreamSourceNodeLike {
  connect(target: AudioAnalyserLike): void;
  disconnect(): void;
}

export interface AudioContextLike {
  readonly state: AudioContextState;
  readonly destination: unknown;
  createMediaStreamSource(stream: MediaStream): MediaStreamSourceNodeLike;
  createAnalyser(): AudioAnalyserLike;
  resume(): Promise<void>;
  close(): Promise<void>;
}

export type AudioContextFactory = () => AudioContextLike;

export interface MeterFrameScheduler {
  requestFrame(callback: () => void): number;
  cancelFrame(handle: number): void;
  now(): number;
}

export interface MicrophoneLevelMeterOptions {
  readonly createAudioContext?: AudioContextFactory;
  readonly scheduler?: MeterFrameScheduler;
  readonly sampleIntervalMs?: number;
}

const IDLE_READING: MicrophoneMeterReading = {
  isMonitoring: false,
  rms: 0,
  peak: 0,
  levelPercent: 0,
  clipping: false,
  error: null,
};

function defaultAudioContextFactory(): AudioContextLike {
  if (typeof window === 'undefined') {
    throw new Error('Web Audio API is unavailable outside a browser context.');
  }
  const win = window as Partial<typeof globalThis> & {
    webkitAudioContext?: typeof AudioContext;
  };
  const AudioCtx = win.AudioContext ?? win.webkitAudioContext;
  if (!AudioCtx) {
    throw new Error('This browser does not support AudioContext.');
  }
  return new AudioCtx() as unknown as AudioContextLike;
}

const defaultScheduler: MeterFrameScheduler = {
  requestFrame: (cb) =>
    typeof requestAnimationFrame === 'function'
      ? requestAnimationFrame(cb)
      : Number(setTimeout(cb, 50)),
  cancelFrame: (id) => {
    if (typeof cancelAnimationFrame === 'function') {
      cancelAnimationFrame(id);
    } else {
      clearTimeout(id);
    }
  },
  now: () => (typeof performance !== 'undefined' ? performance.now() : Date.now()),
};

export function computeLevelPercentFromRms(rms: number): number {
  if (!Number.isFinite(rms) || rms <= 0.0005) {
    return 0;
  }
  const db = 20 * Math.log10(Math.min(1, rms));
  const minDb = -50;
  if (db <= minDb) {
    return 0;
  }
  const normalized = (db - minDb) / -minDb;
  return Math.min(100, Math.max(2, Math.round(normalized * 100)));
}

/**
 * Managed Web Audio input level meter for creator microphone setup.
 *
 * Architectural safety guarantees:
 * 1. Borrows MediaStream from CaptureManager; NEVER stops MediaStreamTracks.
 * 2. Connects MediaStreamAudioSourceNode -> AnalyserNode ONLY; NEVER connects
 *    to AudioContext.destination (preventing speaker feedback / echo).
 * 3. Deterministically disconnects nodes, cancels animation frames, and closes
 *    the underlying AudioContext on stream detach, track end, or unmount.
 */
export class MicrophoneLevelMeter {
  private readonly createAudioContext: AudioContextFactory;
  private readonly scheduler: MeterFrameScheduler;
  private readonly sampleIntervalMs: number;
  private readonly listeners = new Set<(reading: MicrophoneMeterReading) => void>();

  private reading: MicrophoneMeterReading = IDLE_READING;
  private currentStream: MediaStream | null = null;
  private audioContext: AudioContextLike | null = null;
  private sourceNode: MediaStreamSourceNodeLike | null = null;
  private analyserNode: AudioAnalyserLike | null = null;
  private sampleBuffer: Float32Array<ArrayBuffer> | null = null;
  private detachTrackListener: (() => void) | null = null;
  private rafHandle: number | null = null;
  private lastSampleTimeMs = 0;
  private smoothedRms = 0;

  public constructor(options: MicrophoneLevelMeterOptions = {}) {
    this.createAudioContext =
      options.createAudioContext ?? defaultAudioContextFactory;
    this.scheduler = options.scheduler ?? defaultScheduler;
    this.sampleIntervalMs = options.sampleIntervalMs ?? 40;
  }

  public getReading(): MicrophoneMeterReading {
    return this.reading;
  }

  public subscribe(
    listener: (reading: MicrophoneMeterReading) => void,
  ): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  public attachStream(stream: MediaStream | null): void {
    if (this.currentStream === stream) {
      return;
    }

    this.teardownGraph();

    if (!stream) {
      this.setReading(IDLE_READING);
      return;
    }

    const primaryAudioTrack = stream.getAudioTracks()[0];
    if (!primaryAudioTrack || primaryAudioTrack.readyState === 'ended') {
      this.setReading(IDLE_READING);
      return;
    }

    try {
      const ctx = this.createAudioContext();
      const source = ctx.createMediaStreamSource(stream);
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 2048;
      analyser.smoothingTimeConstant = 0.5;

      // Connect ONLY to AnalyserNode — NEVER to ctx.destination!
      source.connect(analyser);

      if (ctx.state === 'suspended') {
        void ctx.resume().catch(() => undefined);
      }

      this.currentStream = stream;
      this.audioContext = ctx;
      this.sourceNode = source;
      this.analyserNode = analyser;
      this.sampleBuffer = new Float32Array(new ArrayBuffer(analyser.fftSize * 4));
      this.lastSampleTimeMs = 0;
      this.smoothedRms = 0;

      const onTrackEnded = () => {
        if (this.currentStream === stream) {
          this.stop();
        }
      };
      primaryAudioTrack.addEventListener('ended', onTrackEnded);
      this.detachTrackListener = () => {
        primaryAudioTrack.removeEventListener('ended', onTrackEnded);
      };

      this.setReading({
        isMonitoring: true,
        rms: 0,
        peak: 0,
        levelPercent: 0,
        clipping: false,
        error: null,
      });

      this.scheduleNextSample();
    } catch (err: unknown) {
      this.teardownGraph();
      const detail =
        err instanceof Error && err.message
          ? err.message
          : 'Unable to initialize Web Audio input level meter.';
      this.setReading({
        isMonitoring: false,
        rms: 0,
        peak: 0,
        levelPercent: 0,
        clipping: false,
        error: detail,
      });
    }
  }

  /**
   * Computes an immediate time-domain reading from the active AnalyserNode.
   */
  public sampleNow(): MicrophoneMeterReading {
    if (!this.analyserNode || !this.sampleBuffer) {
      return this.reading;
    }

    this.analyserNode.getFloatTimeDomainData(this.sampleBuffer);

    let sumSquares = 0;
    let peak = 0;
    const length = this.sampleBuffer.length;

    for (let i = 0; i < length; i += 1) {
      const sample = this.sampleBuffer[i] ?? 0;
      const abs = Math.abs(sample);
      if (abs > peak) {
        peak = abs;
      }
      sumSquares += sample * sample;
    }

    const rawRms = length > 0 ? Math.sqrt(sumSquares / length) : 0;
    const ballisticRms =
      rawRms >= this.smoothedRms ? rawRms : this.smoothedRms * 0.78;
    this.smoothedRms = ballisticRms < 0.0005 ? 0 : ballisticRms;

    const clampedRms = Math.min(1, Math.round(this.smoothedRms * 10000) / 10000);
    const clampedPeak = Math.min(1, Math.round(peak * 10000) / 10000);
    const levelPercent = computeLevelPercentFromRms(clampedRms);
    const clipping = clampedPeak >= 0.98;

    if (
      clampedRms !== this.reading.rms ||
      clampedPeak !== this.reading.peak ||
      levelPercent !== this.reading.levelPercent ||
      clipping !== this.reading.clipping ||
      !this.reading.isMonitoring
    ) {
      this.setReading({
        isMonitoring: true,
        rms: clampedRms,
        peak: clampedPeak,
        levelPercent,
        clipping,
        error: null,
      });
    }

    return this.reading;
  }

  /**
   * Tears down the Web Audio graph and closes AudioContext while preserving
   * store listeners (safe across React StrictMode effect remounts).
   */
  public stop(): void {
    this.teardownGraph();
    if (this.reading !== IDLE_READING) {
      this.setReading(IDLE_READING);
    }
  }

  /**
   * Full disposal: tears down AudioContext/AnalyserNode and removes all subscribers.
   */
  public dispose(): void {
    this.stop();
    this.listeners.clear();
  }

  private scheduleNextSample(): void {
    this.rafHandle = this.scheduler.requestFrame(() => {
      if (!this.analyserNode) {
        return;
      }

      const now = this.scheduler.now();
      if (
        this.lastSampleTimeMs === 0 ||
        now - this.lastSampleTimeMs >= this.sampleIntervalMs
      ) {
        this.lastSampleTimeMs = now;
        this.sampleNow();
      }

      if (this.currentStream !== null) {
        this.scheduleNextSample();
      }
    });
  }

  private teardownGraph(): void {
    if (this.rafHandle !== null) {
      this.scheduler.cancelFrame(this.rafHandle);
      this.rafHandle = null;
    }

    if (this.detachTrackListener) {
      this.detachTrackListener();
      this.detachTrackListener = null;
    }

    if (this.sourceNode) {
      try {
        this.sourceNode.disconnect();
      } catch {
        // Ignore disconnect errors on closed contexts
      }
      this.sourceNode = null;
    }

    if (this.analyserNode) {
      try {
        this.analyserNode.disconnect();
      } catch {
        // Ignore disconnect errors on closed contexts
      }
      this.analyserNode = null;
    }

    if (this.audioContext) {
      const ctxToClose = this.audioContext;
      this.audioContext = null;
      if (ctxToClose.state !== 'closed') {
        void ctxToClose.close().catch(() => undefined);
      }
    }

    this.sampleBuffer = null;
    this.currentStream = null;
    this.lastSampleTimeMs = 0;
    this.smoothedRms = 0;
  }

  private setReading(next: MicrophoneMeterReading): void {
    this.reading = next;
    for (const listener of this.listeners) {
      listener(this.reading);
    }
  }
}

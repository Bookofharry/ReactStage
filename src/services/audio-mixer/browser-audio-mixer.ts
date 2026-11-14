import {
  CLIPPING_PEAK_THRESHOLD,
  DEFAULT_AUDIO_GAIN,
  MAX_AUDIO_GAIN,
  MIN_AUDIO_GAIN,
  type AudioChannelConfig,
  type AudioMeterSnapshot,
  type AudioMixMode,
  type AudioMixer,
  type AudioMixerError,
  type AudioMixerStateSnapshot,
  type AudioMixerStatus,
  type MicrophoneAudioAvailability,
  type SourceAudioAvailability,
  type SourceAudioDescriptor,
} from '../interfaces/audio-mixer';

export const AUTO_DUCK_SPEECH_RMS_THRESHOLD = 0.025;
export const AUTO_DUCK_TARGET_MULTIPLIER = 0.28;

export interface MixerAudioParamLike {
  value: number;
}

export interface MixerConnectableNodeLike {
  connect(target: unknown): void;
  disconnect(target?: unknown): void;
}

export interface MixerGainNodeLike extends MixerConnectableNodeLike {
  readonly gain: MixerAudioParamLike;
}

export interface MixerBiquadFilterNodeLike extends MixerConnectableNodeLike {
  type: BiquadFilterType;
  readonly frequency: MixerAudioParamLike;
  readonly Q: MixerAudioParamLike;
}

export interface MixerDynamicsCompressorNodeLike
  extends MixerConnectableNodeLike {
  readonly threshold: MixerAudioParamLike;
  readonly knee: MixerAudioParamLike;
  readonly ratio: MixerAudioParamLike;
  readonly attack: MixerAudioParamLike;
  readonly release: MixerAudioParamLike;
}

export interface MixerAnalyserNodeLike extends MixerConnectableNodeLike {
  fftSize: number;
  smoothingTimeConstant: number;
  getFloatTimeDomainData(array: Float32Array<ArrayBuffer>): void;
}

export type MixerMediaElementSourceNodeLike = MixerConnectableNodeLike;
export type MixerMediaStreamSourceNodeLike = MixerConnectableNodeLike;

export interface MixerMediaStreamDestinationNodeLike {
  readonly stream: MediaStream;
  disconnect?: () => void;
}

export interface MixerAudioContextLike {
  readonly state: AudioContextState | 'interrupted';
  readonly destination: unknown;
  createGain(): MixerGainNodeLike;
  createAnalyser(): MixerAnalyserNodeLike;
  createMediaElementSource(
    element: HTMLMediaElement,
  ): MixerMediaElementSourceNodeLike;
  createMediaStreamSource(stream: MediaStream): MixerMediaStreamSourceNodeLike;
  createMediaStreamDestination(): MixerMediaStreamDestinationNodeLike;
  createBiquadFilter?(): MixerBiquadFilterNodeLike;
  createDynamicsCompressor?(): MixerDynamicsCompressorNodeLike;
  resume(): Promise<void>;
  close(): Promise<void>;
  addEventListener?: (type: 'statechange', listener: () => void) => void;
  removeEventListener?: (type: 'statechange', listener: () => void) => void;
}

export type MixerAudioContextFactory = () => MixerAudioContextLike;

export interface AudioMixerScheduler {
  requestFrame(callback: () => void): number;
  cancelFrame(handle: number): void;
  now(): number;
}

export interface BrowserAudioMixerOptions {
  readonly createAudioContext?: MixerAudioContextFactory | null;
  readonly isSupported?: boolean;
  readonly scheduler?: AudioMixerScheduler;
  readonly sampleIntervalMs?: number;
}

interface BoundMediaElementRecord {
  readonly context: MixerAudioContextLike;
  readonly sourceNode: MixerMediaElementSourceNodeLike;
}

/**
 * Lifetime WeakMap ensuring `AudioContext.createMediaElementSource(element)` is
 * NEVER called more than once for the same `HTMLMediaElement` across React
 * StrictMode remounts, source video replacements, or unloads.
 */
const boundMediaElementRegistry = new WeakMap<
  HTMLMediaElement,
  BoundMediaElementRecord
>();

export const IDLE_AUDIO_METER_SNAPSHOT: AudioMeterSnapshot = {
  sourceRms: 0,
  sourcePeak: 0,
  sourceLevelPercent: 0,
  sourceClipping: false,
  microphoneRms: 0,
  microphonePeak: 0,
  microphoneLevelPercent: 0,
  microphoneClipping: false,
  masterRms: 0,
  masterPeak: 0,
  masterLevelPercent: 0,
  clipping: false,
  isDucking: false,
  duckGainMultiplier: 1,
};

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function round4(value: number): number {
  return Math.round(value * 10000) / 10000;
}

export function computeMixerLevelPercent(rms: number): number {
  if (!Number.isFinite(rms) || rms <= 0.0005) {
    return 0;
  }
  if (rms >= 1) {
    return 100;
  }
  const db = 20 * Math.log10(rms);
  const minDb = -50;
  if (db <= minDb) {
    return 0;
  }
  const normalized = (db - minDb) / -minDb;
  return Math.min(100, Math.max(2, Math.round(normalized * 100)));
}

function detectBrowserAudioContextCtor(): (new () => AudioContext) | null {
  if (typeof window === 'undefined') {
    return null;
  }
  const win = window as Partial<typeof globalThis> & {
    webkitAudioContext?: typeof AudioContext;
  };
  return win.AudioContext ?? win.webkitAudioContext ?? null;
}

function defaultMixerScheduler(): AudioMixerScheduler {
  return {
    requestFrame: (cb) =>
      typeof requestAnimationFrame === 'function'
        ? requestAnimationFrame(cb)
        : Number(setTimeout(cb, 45)),
    cancelFrame: (id) => {
      if (typeof cancelAnimationFrame === 'function') {
        cancelAnimationFrame(id);
      } else {
        clearTimeout(id);
      }
    },
    now: () =>
      typeof performance !== 'undefined' ? performance.now() : Date.now(),
  };
}

interface MediaElementAudioHints {
  readonly mozHasAudio?: boolean;
  readonly audioTracks?: { readonly length: number };
  readonly webkitAudioDecodedByteCount?: number;
}

function probeMediaElementHasAudio(
  element: HTMLMediaElement,
): boolean | null {
  const hinted = element as HTMLMediaElement & MediaElementAudioHints;
  if (typeof hinted.mozHasAudio === 'boolean') {
    return hinted.mozHasAudio;
  }
  if (
    element.readyState >= 1 &&
    hinted.audioTracks !== undefined &&
    typeof hinted.audioTracks.length === 'number'
  ) {
    return hinted.audioTracks.length > 0;
  }
  if (
    typeof hinted.webkitAudioDecodedByteCount === 'number' &&
    !element.paused &&
    element.currentTime > 0.35
  ) {
    return hinted.webkitAudioDecodedByteCount > 0;
  }
  return null;
}

function disconnectSafely(node: MixerConnectableNodeLike | null): void {
  if (!node) {
    return;
  }
  try {
    node.disconnect();
  } catch {
    // Ignore disconnect errors on already-disconnected or closed contexts
  }
}

function computeTimeDomainMetrics(buffer: Float32Array<ArrayBuffer>): {
  readonly rms: number;
  readonly peak: number;
} {
  const length = buffer.length;
  if (length === 0) {
    return { rms: 0, peak: 0 };
  }

  let sumSquares = 0;
  let peak = 0;

  for (let i = 0; i < length; i += 1) {
    const sample = buffer[i] ?? 0;
    const abs = Math.abs(sample);
    if (abs > peak) {
      peak = abs;
    }
    sumSquares += sample * sample;
  }

  return {
    rms: Math.sqrt(sumSquares / length),
    peak,
  };
}

/**
 * Concrete Web Audio API implementation of `AudioMixer`.
 *
 * Graph Topology:
 * - `sourceElementNode -> sourceGainNode` (0–200% gain / mute * auto-duck envelope)
 *     - `-> sourceAnalyserNode` (post-gain source RMS/peak/clipping)
 *     - `-> masterMixBus` (recording mix bus)
 *     - `-> monitorGainNode (1.0) -> audioContext.destination` (at most ONCE; creator hears video)
 * - `sourceStreamSourceNode (screen/tab audio) -> sourceStreamGainNode` (0–200% * auto-duck)
 *     - `-> sourceAnalyserNode` + `-> masterMixBus` (NEVER connected to `audioContext.destination` to avoid shared-tab echo)
 * - `micStreamSourceNode -> [optional 85Hz HPF -> 4:1 Compressor] -> micGainNode` (0–200% gain / mute)
 *     - `-> micAnalyserNode` (post-gain mic RMS/peak/clipping)
 *     - `-> masterMixBus` (recording mix bus; NEVER connected to `audioContext.destination`)
 * - `masterMixBus (1.0)`
 *     - `-> masterAnalyserNode` (combined post-gain output RMS/peak/clipping)
 *     - `-> mixedDestination` (`MediaStreamAudioDestinationNode` — one stable output stream)
 */
export class BrowserAudioMixer implements AudioMixer {
  private readonly contextFactory: MixerAudioContextFactory | null;
  private readonly scheduler: AudioMixerScheduler;
  private readonly sampleIntervalMs: number;

  private readonly stateListeners = new Set<
    (state: AudioMixerStateSnapshot) => void
  >();
  private readonly meterListeners = new Set<
    (meters: AudioMeterSnapshot) => void
  >();

  private audioContext: MixerAudioContextLike | null = null;
  private detachContextStateListener: (() => void) | null = null;

  private sourceGainNode: MixerGainNodeLike | null = null;
  private sourceStreamGainNode: MixerGainNodeLike | null = null;
  private micGainNode: MixerGainNodeLike | null = null;
  private monitorGainNode: MixerGainNodeLike | null = null;
  private masterMixBus: MixerGainNodeLike | null = null;

  private micHighPassFilter: MixerBiquadFilterNodeLike | null = null;
  private micCompressorNode: MixerDynamicsCompressorNodeLike | null = null;

  private sourceAnalyserNode: MixerAnalyserNodeLike | null = null;
  private micAnalyserNode: MixerAnalyserNodeLike | null = null;
  private masterAnalyserNode: MixerAnalyserNodeLike | null = null;
  private mixedDestination: MixerMediaStreamDestinationNodeLike | null = null;

  private sourceBuffer: Float32Array<ArrayBuffer> | null = null;
  private micBuffer: Float32Array<ArrayBuffer> | null = null;
  private masterBuffer: Float32Array<ArrayBuffer> | null = null;

  private sourceElement: HTMLMediaElement | null = null;
  private sourceElementNode: MixerMediaElementSourceNodeLike | null = null;
  private isSourceNodeConnected = false;
  private isMonitorConnected = false;
  private detachSourceElementListeners: (() => void) | null = null;

  private sourceStream: MediaStream | null = null;
  private sourceStreamLabel: string | null = null;
  private sourceStreamSourceNode: MixerMediaStreamSourceNodeLike | null = null;
  private detachSourceStreamListeners: (() => void) | null = null;

  private sourceDescriptor: SourceAudioDescriptor = {
    hasSource: false,
    label: null,
    hasAudioTrack: null,
  };
  private probedHasAudioTrack: boolean | null = null;

  private micStream: MediaStream | null = null;
  private micLabel: string | null = null;
  private micStreamSourceNode: MixerMediaStreamSourceNodeLike | null = null;
  private detachMicTrackListeners: (() => void) | null = null;

  private sourceChannel: AudioChannelConfig = {
    gain: DEFAULT_AUDIO_GAIN,
    muted: false,
  };
  private microphoneChannel: AudioChannelConfig = {
    gain: DEFAULT_AUDIO_GAIN,
    muted: false,
  };

  private autoDuckEnabled = false;
  private micProcessingEnabled = false;
  private currentDuckMultiplier = 1;
  private isCurrentlyDucking = false;

  private smoothedSourceRms = 0;
  private smoothedMicRms = 0;
  private smoothedMasterRms = 0;

  private rafHandle: number | null = null;
  private lastSampleTimeMs = 0;
  private isMonitoringSuspended = false;
  private opGeneration = 0;
  private isDisposed = false;
  private currentError: AudioMixerError | null = null;

  private state: AudioMixerStateSnapshot;
  private meters: AudioMeterSnapshot = IDLE_AUDIO_METER_SNAPSHOT;

  public constructor(options: BrowserAudioMixerOptions = {}) {
    if (options.createAudioContext !== undefined) {
      this.contextFactory = options.createAudioContext;
    } else {
      const Ctor = detectBrowserAudioContextCtor();
      this.contextFactory = Ctor ? () => new Ctor() : null;
    }

    const supported = options.isSupported ?? this.contextFactory !== null;

    this.scheduler = options.scheduler ?? defaultMixerScheduler();
    this.sampleIntervalMs = options.sampleIntervalMs ?? 45;

    this.state = this.computeStateSnapshot(supported);
  }

  public getState(): AudioMixerStateSnapshot {
    return this.state;
  }

  public getMeterSnapshot(): AudioMeterSnapshot {
    return this.meters;
  }

  public getMixedOutputStream(): MediaStream | null {
    if (this.isDisposed || !this.mixedDestination) {
      return null;
    }
    return this.mixedDestination.stream;
  }

  public subscribe(
    listener: (state: AudioMixerStateSnapshot) => void,
  ): () => void {
    this.stateListeners.add(listener);
    return () => {
      this.stateListeners.delete(listener);
    };
  }

  public subscribeMeters(
    listener: (meters: AudioMeterSnapshot) => void,
  ): () => void {
    this.meterListeners.add(listener);
    return () => {
      this.meterListeners.delete(listener);
    };
  }

  public async initialize(): Promise<void> {
    if (this.isDisposed) {
      return;
    }

    this.isMonitoringSuspended = false;
    const ready = this.ensureGraphInitialized();
    if (!ready || !this.audioContext) {
      this.syncState();
      return;
    }

    if (this.sourceElement && !this.sourceStream) {
      this.connectSourceElementIfNeeded();
    }
    if (this.sourceStream) {
      this.connectSourceStreamIfNeeded();
    }
    if (this.micStream) {
      this.connectMicStreamIfNeeded();
    }

    if (this.audioContext.state !== 'running') {
      await this.tryResumeInternal(false);
    } else {
      this.currentError = null;
      this.ensureMeterLoopRunning();
      this.syncState();
    }
  }

  public async resume(): Promise<void> {
    if (this.isDisposed) {
      return;
    }

    this.isMonitoringSuspended = false;
    const ready = this.ensureGraphInitialized();
    if (!ready || !this.audioContext) {
      this.syncState();
      return;
    }

    if (this.sourceElement && !this.sourceStream) {
      this.connectSourceElementIfNeeded();
    }
    if (this.sourceStream) {
      this.connectSourceStreamIfNeeded();
    }
    if (this.micStream) {
      this.connectMicStreamIfNeeded();
    }

    await this.tryResumeInternal(true);
  }

  public suspendMonitoring(): void {
    if (this.isDisposed) {
      return;
    }
    this.isMonitoringSuspended = true;
    this.stopMeterLoop();
  }

  public attachSourceElement(element: HTMLMediaElement | null): void {
    if (this.isDisposed) {
      return;
    }

    this.isMonitoringSuspended = false;

    if (this.sourceElement === element) {
      if (element && !this.sourceStream && this.shouldInitializeForSource(element)) {
        if (this.ensureGraphInitialized()) {
          this.connectSourceElementIfNeeded();
          this.ensureMeterLoopRunning();
        }
      }
      this.syncState();
      return;
    }

    this.detachSourceElementOnly();
    this.sourceElement = element;
    this.probedHasAudioTrack = element
      ? probeMediaElementHasAudio(element)
      : null;

    if (element) {
      this.bindSourceElementEvents(element);
      if (
        !this.sourceStream &&
        (this.audioContext || this.shouldInitializeForSource(element))
      ) {
        if (this.ensureGraphInitialized()) {
          this.connectSourceElementIfNeeded();
          if (this.audioContext?.state === 'suspended') {
            void this.tryResumeInternal(false);
          } else {
            this.ensureMeterLoopRunning();
          }
        }
      }
    } else if (!this.sourceStream) {
      this.resetSourceMeters();
    }

    this.syncState();
  }

  public attachSourceStream(
    stream: MediaStream | null,
    label?: string | null,
  ): void {
    if (this.isDisposed) {
      return;
    }

    this.isMonitoringSuspended = false;
    const nextLabel = label !== undefined ? label : this.sourceStreamLabel;

    if (this.sourceStream === stream) {
      if (nextLabel !== this.sourceStreamLabel) {
        this.sourceStreamLabel = nextLabel;
        this.syncState();
      }
      if (stream && this.audioContext && !this.sourceStreamSourceNode) {
        this.connectSourceStreamIfNeeded();
        this.syncState();
      }
      return;
    }

    this.disconnectSourceStreamNodeOnly();
    this.sourceStream = stream;
    this.sourceStreamLabel = stream
      ? (label ??
        stream.getAudioTracks()[0]?.label.trim() ??
        'Shared Screen Audio')
      : null;

    if (!stream) {
      if (this.sourceElement && this.shouldInitializeForSource(this.sourceElement)) {
        if (this.ensureGraphInitialized()) {
          this.connectSourceElementIfNeeded();
        }
      } else {
        this.resetSourceMeters();
      }
      this.syncState();
      return;
    }

    const primaryAudioTrack = stream.getAudioTracks()[0];
    this.bindSourceStreamTrackEvents(stream, primaryAudioTrack);

    if (primaryAudioTrack && primaryAudioTrack.readyState !== 'ended') {
      if (this.ensureGraphInitialized()) {
        this.connectSourceStreamIfNeeded();
        if (this.audioContext?.state !== 'running') {
          void this.tryResumeInternal(false);
        } else {
          this.ensureMeterLoopRunning();
        }
      }
    } else {
      this.resetSourceMeters();
    }

    this.syncState();
  }

  public updateSourceDescriptor(descriptor: SourceAudioDescriptor): void {
    if (this.isDisposed) {
      return;
    }

    this.isMonitoringSuspended = false;
    this.sourceDescriptor = descriptor;

    if (!descriptor.hasSource) {
      this.probedHasAudioTrack = null;
      this.resetSourceMeters();
    } else if (this.sourceStream) {
      if (this.ensureGraphInitialized()) {
        this.connectSourceStreamIfNeeded();
        if (descriptor.isPlaying && this.audioContext?.state !== 'running') {
          void this.tryResumeInternal(false);
        } else {
          this.ensureMeterLoopRunning();
        }
      }
    } else if (this.sourceElement) {
      if (descriptor.hasAudioTrack !== undefined) {
        this.probedHasAudioTrack = descriptor.hasAudioTrack;
      } else {
        const probed = probeMediaElementHasAudio(this.sourceElement);
        if (probed !== null) {
          this.probedHasAudioTrack = probed;
        }
      }

      if (this.ensureGraphInitialized()) {
        this.connectSourceElementIfNeeded();
        if (descriptor.isPlaying && this.audioContext?.state !== 'running') {
          void this.tryResumeInternal(false);
        } else {
          this.ensureMeterLoopRunning();
        }
      }
    }

    if (descriptor.isPaused) {
      this.resetSourceMeters();
    }

    this.syncState();
  }

  public attachMicrophoneStream(
    stream: MediaStream | null,
    label?: string | null,
  ): void {
    if (this.isDisposed) {
      return;
    }

    this.isMonitoringSuspended = false;
    const nextLabel = label !== undefined ? label : this.micLabel;

    if (this.micStream === stream) {
      if (nextLabel !== this.micLabel) {
        this.micLabel = nextLabel;
        this.syncState();
      }
      if (stream && this.audioContext && !this.micStreamSourceNode) {
        this.connectMicStreamIfNeeded();
        this.syncState();
      }
      return;
    }

    this.disconnectMicrophoneNodeOnly();
    this.micStream = stream;
    this.micLabel = stream
      ? (label ??
        stream.getAudioTracks()[0]?.label.trim() ??
        'Active Microphone')
      : null;

    if (!stream) {
      this.resetDuckingEnvelope();
      this.resetMicMeters();
      this.syncState();
      return;
    }

    const primaryTrack = stream.getAudioTracks()[0];
    this.bindMicrophoneTrackEvents(stream, primaryTrack);

    if (primaryTrack && primaryTrack.readyState !== 'ended') {
      if (this.ensureGraphInitialized()) {
        this.connectMicStreamIfNeeded();
        if (this.audioContext?.state !== 'running') {
          void this.tryResumeInternal(false);
        } else {
          this.ensureMeterLoopRunning();
        }
      }
    } else {
      this.resetDuckingEnvelope();
      this.resetMicMeters();
    }

    this.syncState();
  }

  public setSourceChannel(config: AudioChannelConfig): void {
    if (this.isDisposed) {
      return;
    }

    const nextGain = Number.isFinite(config.gain)
      ? Math.round(
          clamp(config.gain, MIN_AUDIO_GAIN, MAX_AUDIO_GAIN) * 100,
        ) / 100
      : this.sourceChannel.gain;
    const nextMuted = config.muted;

    if (
      nextGain === this.sourceChannel.gain &&
      nextMuted === this.sourceChannel.muted
    ) {
      return;
    }

    this.sourceChannel = { gain: nextGain, muted: nextMuted };
    this.applyChannelGainsToNodes();

    if (nextMuted || nextGain === 0) {
      this.resetSourceMeters();
    }

    this.syncState();
  }

  public setMicrophoneChannel(config: AudioChannelConfig): void {
    if (this.isDisposed) {
      return;
    }

    const nextGain = Number.isFinite(config.gain)
      ? Math.round(
          clamp(config.gain, MIN_AUDIO_GAIN, MAX_AUDIO_GAIN) * 100,
        ) / 100
      : this.microphoneChannel.gain;
    const nextMuted = config.muted;

    if (
      nextGain === this.microphoneChannel.gain &&
      nextMuted === this.microphoneChannel.muted
    ) {
      return;
    }

    this.microphoneChannel = { gain: nextGain, muted: nextMuted };
    if (nextMuted || nextGain === 0) {
      this.resetDuckingEnvelope();
    }
    this.applyChannelGainsToNodes();

    if (nextMuted || nextGain === 0) {
      this.resetMicMeters();
    }

    this.syncState();
  }

  public setAutoDuckEnabled(enabled: boolean): void {
    if (this.isDisposed || this.autoDuckEnabled === enabled) {
      return;
    }
    this.autoDuckEnabled = enabled;
    if (!enabled) {
      this.resetDuckingEnvelope();
      this.publishMetersIfChanged({
        ...this.meters,
        isDucking: false,
        duckGainMultiplier: 1,
      });
    }
    this.syncState();
  }

  public setMicProcessingEnabled(enabled: boolean): void {
    if (this.isDisposed || this.micProcessingEnabled === enabled) {
      return;
    }
    this.micProcessingEnabled = enabled;
    this.rewireMicrophoneProcessingChain();
    this.syncState();
  }

  public sampleMetersNow(): AudioMeterSnapshot {
    if (
      this.isDisposed ||
      this.audioContext?.state !== 'running' ||
      !this.sourceAnalyserNode ||
      !this.micAnalyserNode ||
      !this.masterAnalyserNode ||
      !this.sourceBuffer ||
      !this.micBuffer ||
      !this.masterBuffer
    ) {
      this.publishMetersIfChanged(IDLE_AUDIO_METER_SNAPSHOT);
      return this.meters;
    }

    const micCanEmit = this.canMicProduceSignal();

    // 1. Sample microphone first so Auto-Ducking envelope responds with zero-tick latency
    let micRms = 0;
    let micPeak = 0;
    let rawMicRms = 0;
    if (micCanEmit) {
      this.micAnalyserNode.getFloatTimeDomainData(this.micBuffer);
      const raw = computeTimeDomainMetrics(this.micBuffer);
      rawMicRms = raw.rms;
      const ballistic =
        raw.rms >= this.smoothedMicRms ? raw.rms : this.smoothedMicRms * 0.78;
      this.smoothedMicRms = ballistic < 0.0005 ? 0 : ballistic;
      micRms = round4(this.smoothedMicRms);
      micPeak = round4(raw.peak);
    } else {
      this.smoothedMicRms = 0;
    }

    // 2. Update Auto-Ducking envelope when enabled
    const sourceCanEmit = this.canSourceProduceSignal();
    if (this.autoDuckEnabled && sourceCanEmit) {
      const micSpeaking =
        micCanEmit && rawMicRms >= AUTO_DUCK_SPEECH_RMS_THRESHOLD;
      if (micSpeaking) {
        const nextMult = Math.max(
          AUTO_DUCK_TARGET_MULTIPLIER,
          Math.min(0.35, this.currentDuckMultiplier * 0.55),
        );
        this.currentDuckMultiplier = round4(nextMult);
        this.isCurrentlyDucking = true;
      } else if (this.currentDuckMultiplier < 1) {
        const released = this.currentDuckMultiplier + 0.24;
        if (released >= 0.98) {
          this.currentDuckMultiplier = 1;
          this.isCurrentlyDucking = false;
        } else {
          this.currentDuckMultiplier = round4(released);
          this.isCurrentlyDucking = true;
        }
      } else {
        this.isCurrentlyDucking = false;
      }
      this.applyChannelGainsToNodes();
    } else if (this.currentDuckMultiplier !== 1 || this.isCurrentlyDucking) {
      this.resetDuckingEnvelope();
    }

    // 3. Sample post-gain (and post-ducking) source channel
    let srcRms = 0;
    let srcPeak = 0;
    if (sourceCanEmit) {
      this.sourceAnalyserNode.getFloatTimeDomainData(this.sourceBuffer);
      const raw = computeTimeDomainMetrics(this.sourceBuffer);
      const ballistic =
        raw.rms >= this.smoothedSourceRms
          ? raw.rms
          : this.smoothedSourceRms * 0.78;
      this.smoothedSourceRms = ballistic < 0.0005 ? 0 : ballistic;
      srcRms = round4(this.smoothedSourceRms);
      srcPeak = round4(raw.peak);
    } else {
      this.smoothedSourceRms = 0;
    }

    // 4. Sample combined master recording bus
    let masterRms = 0;
    let masterPeak = 0;
    if (sourceCanEmit || micCanEmit) {
      this.masterAnalyserNode.getFloatTimeDomainData(this.masterBuffer);
      const raw = computeTimeDomainMetrics(this.masterBuffer);
      const ballistic =
        raw.rms >= this.smoothedMasterRms
          ? raw.rms
          : this.smoothedMasterRms * 0.78;
      this.smoothedMasterRms = ballistic < 0.0005 ? 0 : ballistic;
      masterRms = round4(this.smoothedMasterRms);
      masterPeak = round4(Math.max(raw.peak, srcPeak, micPeak));
    } else {
      this.smoothedMasterRms = 0;
    }

    const sourceClipping = srcPeak >= CLIPPING_PEAK_THRESHOLD;
    const microphoneClipping = micPeak >= CLIPPING_PEAK_THRESHOLD;
    const clipping =
      masterPeak >= CLIPPING_PEAK_THRESHOLD ||
      sourceClipping ||
      microphoneClipping;

    const nextSnapshot: AudioMeterSnapshot = {
      sourceRms: srcRms,
      sourcePeak: srcPeak,
      sourceLevelPercent: computeMixerLevelPercent(srcRms),
      sourceClipping,
      microphoneRms: micRms,
      microphonePeak: micPeak,
      microphoneLevelPercent: computeMixerLevelPercent(micRms),
      microphoneClipping,
      masterRms,
      masterPeak,
      masterLevelPercent: computeMixerLevelPercent(masterRms),
      clipping,
      isDucking: this.isCurrentlyDucking,
      duckGainMultiplier: this.currentDuckMultiplier,
    };

    this.publishMetersIfChanged(nextSnapshot);
    return this.meters;
  }

  public dispose(): void {
    if (this.isDisposed) {
      return;
    }

    this.opGeneration += 1;
    this.isDisposed = true;
    this.stopMeterLoop();

    this.detachSourceElementOnly();
    this.disconnectSourceStreamNodeOnly();
    this.sourceStream = null;
    this.sourceStreamLabel = null;
    this.disconnectMicrophoneNodeOnly();
    this.micStream = null;
    this.micLabel = null;

    if (this.detachContextStateListener) {
      this.detachContextStateListener();
      this.detachContextStateListener = null;
    }

    disconnectSafely(this.sourceGainNode);
    disconnectSafely(this.sourceStreamGainNode);
    disconnectSafely(this.micHighPassFilter);
    disconnectSafely(this.micCompressorNode);
    disconnectSafely(this.micGainNode);
    disconnectSafely(this.monitorGainNode);
    disconnectSafely(this.masterMixBus);
    disconnectSafely(this.sourceAnalyserNode);
    disconnectSafely(this.micAnalyserNode);
    disconnectSafely(this.masterAnalyserNode);
    this.mixedDestination?.disconnect?.();

    this.sourceGainNode = null;
    this.sourceStreamGainNode = null;
    this.micHighPassFilter = null;
    this.micCompressorNode = null;
    this.micGainNode = null;
    this.monitorGainNode = null;
    this.masterMixBus = null;
    this.sourceAnalyserNode = null;
    this.micAnalyserNode = null;
    this.masterAnalyserNode = null;
    this.mixedDestination = null;
    this.isMonitorConnected = false;

    this.sourceBuffer = null;
    this.micBuffer = null;
    this.masterBuffer = null;

    if (this.audioContext) {
      const ctxToClose = this.audioContext;
      this.audioContext = null;
      if (ctxToClose.state !== 'closed') {
        void ctxToClose.close().catch(() => undefined);
      }
    }

    this.meters = IDLE_AUDIO_METER_SNAPSHOT;
    this.state = this.computeStateSnapshot(this.contextFactory !== null);
    this.stateListeners.clear();
    this.meterListeners.clear();
  }

  private resetDuckingEnvelope(): void {
    this.currentDuckMultiplier = 1;
    this.isCurrentlyDucking = false;
    this.applyChannelGainsToNodes();
  }

  private shouldInitializeForSource(element: HTMLMediaElement): boolean {
    if (this.sourceDescriptor.hasSource) {
      return true;
    }
    const attrSrc = element.getAttribute('src');
    if (attrSrc && attrSrc.trim().length > 0) {
      return true;
    }
    return Boolean(element.currentSrc && element.currentSrc.trim().length > 0);
  }

  private ensureGraphInitialized(): boolean {
    if (this.isDisposed) {
      return false;
    }

    if (this.audioContext && this.mixedDestination) {
      return true;
    }

    if (!this.contextFactory) {
      this.currentError = {
        code: 'WEB_AUDIO_UNSUPPORTED',
        title: 'Web Audio unavailable',
        message:
          'This browser environment does not expose the Web Audio API (AudioContext).',
        recoverable: false,
      };
      return false;
    }

    try {
      // Reuse an existing non-closed context if the attached HTMLMediaElement was already bound
      const existingBound = this.sourceElement
        ? boundMediaElementRegistry.get(this.sourceElement)
        : undefined;

      const ctx =
        existingBound && existingBound.context.state !== 'closed'
          ? existingBound.context
          : this.contextFactory();

      const sourceGain = ctx.createGain();
      const micGain = ctx.createGain();
      const monitorGain = ctx.createGain();
      const masterBus = ctx.createGain();

      const sourceAnalyser = ctx.createAnalyser();
      const micAnalyser = ctx.createAnalyser();
      const masterAnalyser = ctx.createAnalyser();

      sourceAnalyser.fftSize = 2048;
      sourceAnalyser.smoothingTimeConstant = 0.5;
      micAnalyser.fftSize = 2048;
      micAnalyser.smoothingTimeConstant = 0.5;
      masterAnalyser.fftSize = 2048;
      masterAnalyser.smoothingTimeConstant = 0.5;

      const destination = ctx.createMediaStreamDestination();

      monitorGain.gain.value = 1;
      masterBus.gain.value = 1;

      // Source channel post-gain routing: analyser + master recording bus + monitor gain
      sourceGain.connect(sourceAnalyser);
      sourceGain.connect(masterBus);
      sourceGain.connect(monitorGain);

      // Microphone channel post-gain routing: analyser + master recording bus ONLY
      // NEVER connect micGain or masterBus to monitorGain or ctx.destination!
      micGain.connect(micAnalyser);
      micGain.connect(masterBus);

      // Master mixed output bus -> master analyser + MediaStreamAudioDestinationNode
      masterBus.connect(masterAnalyser);
      masterBus.connect(destination);

      this.audioContext = ctx;
      this.sourceGainNode = sourceGain;
      this.micGainNode = micGain;
      this.monitorGainNode = monitorGain;
      this.masterMixBus = masterBus;
      this.sourceAnalyserNode = sourceAnalyser;
      this.micAnalyserNode = micAnalyser;
      this.masterAnalyserNode = masterAnalyser;
      this.mixedDestination = destination;
      this.isMonitorConnected = false;

      this.sourceBuffer = new Float32Array(
        new ArrayBuffer(sourceAnalyser.fftSize * 4),
      );
      this.micBuffer = new Float32Array(
        new ArrayBuffer(micAnalyser.fftSize * 4),
      );
      this.masterBuffer = new Float32Array(
        new ArrayBuffer(masterAnalyser.fftSize * 4),
      );

      this.applyChannelGainsToNodes();

      const onStateChange = () => {
        if (this.isDisposed || this.audioContext !== ctx) {
          return;
        }
        if (ctx.state === 'running') {
          this.currentError = null;
          this.ensureMeterLoopRunning();
        } else {
          this.publishMetersIfChanged(IDLE_AUDIO_METER_SNAPSHOT);
        }
        this.syncState();
      };

      ctx.addEventListener?.('statechange', onStateChange);
      this.detachContextStateListener = () => {
        ctx.removeEventListener?.('statechange', onStateChange);
      };

      return true;
    } catch (err: unknown) {
      const detail =
        err instanceof Error && err.message
          ? err.message
          : 'Unable to initialize Web Audio mixing graph.';
      this.currentError = {
        code: 'CONTEXT_INIT_FAILED',
        title: 'Audio mixer initialization failed',
        message: detail,
        recoverable: true,
      };
      return false;
    }
  }

  private connectSourceElementIfNeeded(): void {
    const element = this.sourceElement;
    const ctx = this.audioContext;
    const sourceGain = this.sourceGainNode;
    const monitorGain = this.monitorGainNode;

    if (!element || !ctx || !sourceGain || !monitorGain || this.sourceStream) {
      return;
    }

    if (!this.sourceElementNode) {
      const cached = boundMediaElementRegistry.get(element);
      if (cached) {
        if (cached.context !== ctx) {
          this.currentError = {
            code: 'MEDIA_ELEMENT_BIND_FAILED',
            title: 'Source audio element already bound',
            message:
              'The source video element is already associated with a different AudioContext and cannot be bound again.',
            recoverable: false,
          };
          return;
        }
        this.sourceElementNode = cached.sourceNode;
      } else {
        try {
          const created = ctx.createMediaElementSource(element);
          boundMediaElementRegistry.set(element, {
            context: ctx,
            sourceNode: created,
          });
          this.sourceElementNode = created;
        } catch (err: unknown) {
          const detail =
            err instanceof Error && err.message
              ? err.message
              : 'Failed to attach HTMLMediaElement to Web Audio.';
          this.currentError = {
            code: 'MEDIA_ELEMENT_BIND_FAILED',
            title: 'Unable to route video audio',
            message: detail,
            recoverable: false,
          };
          return;
        }
      }
    }

    if (!this.isSourceNodeConnected) {
      this.sourceElementNode.connect(sourceGain);
      this.isSourceNodeConnected = true;
    }

    // Route monitored local-video audio to creator's speakers AT MOST ONCE
    if (!this.isMonitorConnected) {
      monitorGain.connect(ctx.destination);
      this.isMonitorConnected = true;
    }
  }

  private connectSourceStreamIfNeeded(): void {
    const stream = this.sourceStream;
    const ctx = this.audioContext;
    const sourceAnalyser = this.sourceAnalyserNode;
    const masterBus = this.masterMixBus;

    if (
      !stream ||
      !ctx ||
      !sourceAnalyser ||
      !masterBus ||
      this.sourceStreamSourceNode
    ) {
      return;
    }

    const track = stream.getAudioTracks()[0];
    if (!track || track.readyState === 'ended') {
      return;
    }

    if (!this.sourceStreamGainNode) {
      const streamGain = ctx.createGain();
      // Route captured screen/tab audio into sourceAnalyser + masterMixBus ONLY
      // NEVER connect to monitorGain/ctx.destination so shared tab audio never echoes!
      streamGain.connect(sourceAnalyser);
      streamGain.connect(masterBus);
      this.sourceStreamGainNode = streamGain;
      this.applyChannelGainsToNodes();
    }

    try {
      const streamSource = ctx.createMediaStreamSource(stream);
      streamSource.connect(this.sourceStreamGainNode);
      this.sourceStreamSourceNode = streamSource;
    } catch {
      // Non-fatal if stream contains no decodable Web Audio track
    }
  }

  private ensureVocalProcessingNodes(
    ctx: MixerAudioContextLike,
  ): {
    readonly hpf: MixerBiquadFilterNodeLike;
    readonly compressor: MixerDynamicsCompressorNodeLike;
  } | null {
    if (this.micHighPassFilter && this.micCompressorNode) {
      return {
        hpf: this.micHighPassFilter,
        compressor: this.micCompressorNode,
      };
    }

    if (
      typeof ctx.createBiquadFilter !== 'function' ||
      typeof ctx.createDynamicsCompressor !== 'function'
    ) {
      return null;
    }

    const hpf = ctx.createBiquadFilter();
    hpf.type = 'highpass';
    hpf.frequency.value = 85;
    hpf.Q.value = 0.707;

    const compressor = ctx.createDynamicsCompressor();
    compressor.threshold.value = -18;
    compressor.knee.value = 12;
    compressor.ratio.value = 4;
    compressor.attack.value = 0.003;
    compressor.release.value = 0.2;

    this.micHighPassFilter = hpf;
    this.micCompressorNode = compressor;
    return { hpf, compressor };
  }

  private rewireMicrophoneProcessingChain(): void {
    const streamSource = this.micStreamSourceNode;
    const micGain = this.micGainNode;
    const ctx = this.audioContext;

    if (!streamSource || !micGain || !ctx) {
      return;
    }

    disconnectSafely(streamSource);
    disconnectSafely(this.micHighPassFilter);
    disconnectSafely(this.micCompressorNode);

    if (this.micProcessingEnabled) {
      const chain = this.ensureVocalProcessingNodes(ctx);
      if (chain) {
        streamSource.connect(chain.hpf);
        chain.hpf.connect(chain.compressor);
        chain.compressor.connect(micGain);
        return;
      }
    }

    streamSource.connect(micGain);
  }

  private connectMicStreamIfNeeded(): void {
    const stream = this.micStream;
    const ctx = this.audioContext;
    const micGain = this.micGainNode;

    if (!stream || !ctx || !micGain || this.micStreamSourceNode) {
      return;
    }

    const track = stream.getAudioTracks()[0];
    if (!track || track.readyState === 'ended') {
      return;
    }

    try {
      const streamSource = ctx.createMediaStreamSource(stream);
      this.micStreamSourceNode = streamSource;
      this.rewireMicrophoneProcessingChain();
    } catch (err: unknown) {
      const detail =
        err instanceof Error && err.message
          ? err.message
          : 'Failed to route microphone stream into Web Audio mixer.';
      this.currentError = {
        code: 'MIC_STREAM_ATTACH_FAILED',
        title: 'Microphone mix attachment failed',
        message: detail,
        recoverable: true,
      };
    }
  }

  private isOperationCurrent(expectedGen: number): boolean {
    return !this.isDisposed && expectedGen === this.opGeneration;
  }

  private async tryResumeInternal(
    fromExplicitUserAction: boolean,
  ): Promise<void> {
    const ctx = this.audioContext;
    if (!ctx || this.isDisposed) {
      return;
    }

    const currentGen = ++this.opGeneration;

    try {
      await ctx.resume();
      if (!this.isOperationCurrent(currentGen)) {
        return;
      }

      if (ctx.state === 'running') {
        this.currentError = null;
        this.ensureMeterLoopRunning();
      }
      this.syncState();
    } catch (err: unknown) {
      if (!this.isOperationCurrent(currentGen)) {
        return;
      }

      if (fromExplicitUserAction) {
        const detail =
          err instanceof Error && err.message
            ? err.message
            : 'Browser blocked resuming the Web Audio context.';
        this.currentError = {
          code: 'CONTEXT_RESUME_FAILED',
          title: 'Audio activation blocked',
          message: `Could not activate audio mixing: ${detail}`,
          recoverable: true,
        };
      }
      this.syncState();
    }
  }

  private applyChannelGainsToNodes(): void {
    const effectiveSourceGain = this.sourceChannel.muted
      ? 0
      : round4(this.sourceChannel.gain * this.currentDuckMultiplier);

    if (this.sourceGainNode) {
      this.sourceGainNode.gain.value = effectiveSourceGain;
    }
    if (this.sourceStreamGainNode) {
      this.sourceStreamGainNode.gain.value = effectiveSourceGain;
    }
    if (this.micGainNode) {
      this.micGainNode.gain.value = this.microphoneChannel.muted
        ? 0
        : this.microphoneChannel.gain;
    }
  }

  private bindSourceElementEvents(element: HTMLMediaElement): void {
    const refreshFromElement = () => {
      if (this.isDisposed || this.sourceElement !== element || this.sourceStream) {
        return;
      }

      const probed = probeMediaElementHasAudio(element);
      if (probed !== null && this.probedHasAudioTrack !== probed) {
        this.probedHasAudioTrack = probed;
      }

      if (element.paused || element.ended) {
        this.resetSourceMeters();
      } else if (this.audioContext?.state === 'running') {
        this.ensureMeterLoopRunning();
      }

      this.syncState();
    };

    const onEmptied = () => {
      if (this.isDisposed || this.sourceElement !== element || this.sourceStream) {
        return;
      }
      this.probedHasAudioTrack = null;
      this.resetSourceMeters();
      this.syncState();
    };

    element.addEventListener('loadedmetadata', refreshFromElement);
    element.addEventListener('play', refreshFromElement);
    element.addEventListener('playing', refreshFromElement);
    element.addEventListener('pause', refreshFromElement);
    element.addEventListener('ended', refreshFromElement);
    element.addEventListener('timeupdate', refreshFromElement);
    element.addEventListener('emptied', onEmptied);

    this.detachSourceElementListeners = () => {
      element.removeEventListener('loadedmetadata', refreshFromElement);
      element.removeEventListener('play', refreshFromElement);
      element.removeEventListener('playing', refreshFromElement);
      element.removeEventListener('pause', refreshFromElement);
      element.removeEventListener('ended', refreshFromElement);
      element.removeEventListener('timeupdate', refreshFromElement);
      element.removeEventListener('emptied', onEmptied);
    };
  }

  private bindSourceStreamTrackEvents(
    stream: MediaStream,
    track: MediaStreamTrack | undefined,
  ): void {
    if (!track) {
      return;
    }

    const onEndedOrMute = () => {
      if (this.isDisposed || this.sourceStream !== stream) {
        return;
      }
      if (track.readyState === 'ended') {
        if (this.sourceStreamSourceNode) {
          disconnectSafely(this.sourceStreamSourceNode);
          this.sourceStreamSourceNode = null;
        }
        this.resetSourceMeters();
      } else if (track.muted || !track.enabled) {
        this.resetSourceMeters();
      }
      this.syncState();
    };

    track.addEventListener('ended', onEndedOrMute);
    track.addEventListener('mute', onEndedOrMute);
    track.addEventListener('unmute', onEndedOrMute);

    this.detachSourceStreamListeners = () => {
      track.removeEventListener('ended', onEndedOrMute);
      track.removeEventListener('mute', onEndedOrMute);
      track.removeEventListener('unmute', onEndedOrMute);
    };
  }

  private bindMicrophoneTrackEvents(
    stream: MediaStream,
    track: MediaStreamTrack | undefined,
  ): void {
    if (!track) {
      return;
    }

    const onEnded = () => {
      if (this.isDisposed || this.micStream !== stream) {
        return;
      }
      if (this.micStreamSourceNode) {
        disconnectSafely(this.micStreamSourceNode);
        this.micStreamSourceNode = null;
      }
      this.resetDuckingEnvelope();
      this.resetMicMeters();
      this.syncState();
    };

    const onMuteChange = () => {
      if (this.isDisposed || this.micStream !== stream) {
        return;
      }
      if (track.muted || !track.enabled) {
        this.resetDuckingEnvelope();
        this.resetMicMeters();
      }
      this.syncState();
    };

    track.addEventListener('ended', onEnded);
    track.addEventListener('mute', onMuteChange);
    track.addEventListener('unmute', onMuteChange);

    this.detachMicTrackListeners = () => {
      track.removeEventListener('ended', onEnded);
      track.removeEventListener('mute', onMuteChange);
      track.removeEventListener('unmute', onMuteChange);
    };
  }

  private detachSourceElementOnly(): void {
    if (this.detachSourceElementListeners) {
      this.detachSourceElementListeners();
      this.detachSourceElementListeners = null;
    }
    if (this.sourceElementNode && this.isSourceNodeConnected) {
      disconnectSafely(this.sourceElementNode);
    }
    this.sourceElementNode = null;
    this.isSourceNodeConnected = false;
    this.sourceElement = null;
  }

  private disconnectSourceStreamNodeOnly(): void {
    if (this.detachSourceStreamListeners) {
      this.detachSourceStreamListeners();
      this.detachSourceStreamListeners = null;
    }
    if (this.sourceStreamSourceNode) {
      disconnectSafely(this.sourceStreamSourceNode);
      this.sourceStreamSourceNode = null;
    }
  }

  private disconnectMicrophoneNodeOnly(): void {
    if (this.detachMicTrackListeners) {
      this.detachMicTrackListeners();
      this.detachMicTrackListeners = null;
    }
    if (this.micStreamSourceNode) {
      disconnectSafely(this.micStreamSourceNode);
      this.micStreamSourceNode = null;
    }
    disconnectSafely(this.micHighPassFilter);
    disconnectSafely(this.micCompressorNode);
  }

  private ensureMeterLoopRunning(): void {
    if (
      this.isDisposed ||
      this.isMonitoringSuspended ||
      this.rafHandle !== null ||
      this.audioContext?.state !== 'running'
    ) {
      return;
    }

    const step = () => {
      this.rafHandle = null;
      if (
        this.isDisposed ||
        this.isMonitoringSuspended ||
        this.audioContext?.state !== 'running'
      ) {
        return;
      }

      const now = this.scheduler.now();
      if (
        this.lastSampleTimeMs === 0 ||
        now - this.lastSampleTimeMs >= this.sampleIntervalMs
      ) {
        this.lastSampleTimeMs = now;
        this.sampleMetersNow();
      }

      if (this.hasAnyPotentialSignalSource()) {
        this.rafHandle = this.scheduler.requestFrame(step);
      }
    };

    this.rafHandle = this.scheduler.requestFrame(step);
  }

  private stopMeterLoop(): void {
    if (this.rafHandle !== null) {
      this.scheduler.cancelFrame(this.rafHandle);
      this.rafHandle = null;
    }
    this.lastSampleTimeMs = 0;
  }

  private hasAnyPotentialSignalSource(): boolean {
    const hasSource = this.resolveSourceAvailability() !== 'no-source';
    const micAvail = this.resolveMicrophoneAvailability();
    const hasMic = micAvail === 'live' || micAvail === 'muted-hardware';
    return hasSource || hasMic;
  }

  private canSourceProduceSignal(): boolean {
    const avail = this.resolveSourceAvailability();
    if (
      avail === 'no-source' ||
      avail === 'no-audio-track' ||
      avail === 'paused'
    ) {
      return false;
    }
    if (this.sourceStream) {
      if (!this.sourceStreamSourceNode) {
        return false;
      }
      return !this.sourceChannel.muted && this.sourceChannel.gain > 0;
    }
    if (!this.isSourceNodeConnected) {
      return false;
    }
    return !this.sourceChannel.muted && this.sourceChannel.gain > 0;
  }

  private canMicProduceSignal(): boolean {
    if (this.resolveMicrophoneAvailability() !== 'live') {
      return false;
    }
    if (!this.micStreamSourceNode) {
      return false;
    }
    return !this.microphoneChannel.muted && this.microphoneChannel.gain > 0;
  }

  private resetSourceMeters(): void {
    this.smoothedSourceRms = 0;
    if (
      this.meters.sourceRms !== 0 ||
      this.meters.sourcePeak !== 0 ||
      this.meters.sourceClipping
    ) {
      const micActive = this.meters.microphonePeak;
      const micClip = this.meters.microphoneClipping;
      this.publishMetersIfChanged({
        ...this.meters,
        sourceRms: 0,
        sourcePeak: 0,
        sourceLevelPercent: 0,
        sourceClipping: false,
        masterRms: this.meters.microphoneRms,
        masterPeak: micActive,
        masterLevelPercent: this.meters.microphoneLevelPercent,
        clipping: micClip,
      });
    }
  }

  private resetMicMeters(): void {
    this.smoothedMicRms = 0;
    if (
      this.meters.microphoneRms !== 0 ||
      this.meters.microphonePeak !== 0 ||
      this.meters.microphoneClipping ||
      this.meters.isDucking
    ) {
      const srcPeak = this.meters.sourcePeak;
      const srcClip = this.meters.sourceClipping;
      this.publishMetersIfChanged({
        ...this.meters,
        microphoneRms: 0,
        microphonePeak: 0,
        microphoneLevelPercent: 0,
        microphoneClipping: false,
        masterRms: this.meters.sourceRms,
        masterPeak: srcPeak,
        masterLevelPercent: this.meters.sourceLevelPercent,
        clipping: srcClip,
        isDucking: false,
        duckGainMultiplier: 1,
      });
    }
  }

  private resolveSourceAvailability(): SourceAudioAvailability {
    if (this.sourceStream) {
      const track = this.sourceStream.getAudioTracks()[0];
      if (!track || track.readyState === 'ended') {
        return 'no-audio-track';
      }
      if (!track.enabled || track.muted || this.sourceDescriptor.isPaused) {
        return 'paused';
      }
      return 'playing';
    }

    if (!this.sourceElement) {
      return 'no-source';
    }

    const hasMedia = this.shouldInitializeForSource(this.sourceElement);
    if (!hasMedia) {
      return 'no-source';
    }

    const effectiveHasAudio =
      this.sourceDescriptor.hasAudioTrack ?? this.probedHasAudioTrack;
    if (effectiveHasAudio === false) {
      return 'no-audio-track';
    }

    if (this.sourceDescriptor.isPlaying) {
      return 'playing';
    }
    if (this.sourceDescriptor.isPaused) {
      return 'paused';
    }
    if (!this.sourceElement.paused && !this.sourceElement.ended) {
      return 'playing';
    }
    return 'paused';
  }

  private resolveMicrophoneAvailability(): MicrophoneAudioAvailability {
    if (!this.micStream) {
      return 'off';
    }
    const track = this.micStream.getAudioTracks()[0];
    if (!track || track.readyState === 'ended') {
      return 'ended';
    }
    if (!track.enabled || track.muted) {
      return 'muted-hardware';
    }
    return 'live';
  }

  private resolveStatus(supported: boolean): AudioMixerStatus {
    if (!supported) {
      return 'unavailable';
    }
    if (
      this.currentError &&
      this.currentError.code !== 'CONTEXT_RESUME_FAILED'
    ) {
      return 'error';
    }
    if (!this.audioContext) {
      return 'idle';
    }
    if (
      this.audioContext.state === 'suspended' ||
      this.audioContext.state === 'interrupted'
    ) {
      return 'suspended';
    }
    if (this.audioContext.state === 'running') {
      return 'running';
    }
    return 'idle';
  }

  private resolveMixMode(
    sourceAvailability: SourceAudioAvailability,
    microphoneAvailability: MicrophoneAudioAvailability,
  ): AudioMixMode {
    const sourceRouted =
      sourceAvailability !== 'no-source' &&
      sourceAvailability !== 'no-audio-track' &&
      !this.sourceChannel.muted &&
      this.sourceChannel.gain > 0;

    const micRouted =
      microphoneAvailability === 'live' &&
      !this.microphoneChannel.muted &&
      this.microphoneChannel.gain > 0;

    if (sourceRouted && micRouted) {
      return 'combined';
    }
    if (sourceRouted) {
      return 'source-only';
    }
    if (micRouted) {
      return 'microphone-only';
    }
    return 'silent';
  }

  private computeStateSnapshot(supported: boolean): AudioMixerStateSnapshot {
    const status = this.resolveStatus(supported);
    const sourceAvailability = this.resolveSourceAvailability();
    const microphoneAvailability = this.resolveMicrophoneAvailability();
    const mixMode = this.resolveMixMode(
      sourceAvailability,
      microphoneAvailability,
    );

    const outputTracks = this.mixedDestination
      ? this.mixedDestination.stream.getAudioTracks().length
      : 0;

    const requiresUserGesture =
      status === 'suspended' ||
      this.currentError?.code === 'CONTEXT_RESUME_FAILED';

    const resolvedSourceLabel =
      sourceAvailability === 'no-source'
        ? null
        : (this.sourceDescriptor.label ??
          this.sourceStreamLabel ??
          'Source Video');

    return {
      status,
      mixMode,
      requiresUserGesture,
      sourceChannel: this.sourceChannel,
      microphoneChannel: this.microphoneChannel,
      autoDuckEnabled: this.autoDuckEnabled,
      micProcessingEnabled: this.micProcessingEnabled,
      sourceAvailability,
      sourceLabel: resolvedSourceLabel,
      microphoneAvailability,
      microphoneLabel: this.micStream ? this.micLabel : null,
      hasMixedOutput: !this.isDisposed && this.mixedDestination !== null,
      outputTrackCount: outputTracks,
      isSourceElementBound: this.isSourceNodeConnected,
      error: this.currentError,
    };
  }

  private syncState(): void {
    const next = this.computeStateSnapshot(this.contextFactory !== null);
    if (this.areStatesEqual(this.state, next)) {
      return;
    }
    this.state = next;
    for (const listener of this.stateListeners) {
      listener(this.state);
    }
  }

  private areStatesEqual(
    a: AudioMixerStateSnapshot,
    b: AudioMixerStateSnapshot,
  ): boolean {
    return (
      a.status === b.status &&
      a.mixMode === b.mixMode &&
      a.requiresUserGesture === b.requiresUserGesture &&
      a.sourceChannel.gain === b.sourceChannel.gain &&
      a.sourceChannel.muted === b.sourceChannel.muted &&
      a.microphoneChannel.gain === b.microphoneChannel.gain &&
      a.microphoneChannel.muted === b.microphoneChannel.muted &&
      a.autoDuckEnabled === b.autoDuckEnabled &&
      a.micProcessingEnabled === b.micProcessingEnabled &&
      a.sourceAvailability === b.sourceAvailability &&
      a.sourceLabel === b.sourceLabel &&
      a.microphoneAvailability === b.microphoneAvailability &&
      a.microphoneLabel === b.microphoneLabel &&
      a.hasMixedOutput === b.hasMixedOutput &&
      a.outputTrackCount === b.outputTrackCount &&
      a.isSourceElementBound === b.isSourceElementBound &&
      a.error === b.error
    );
  }

  private publishMetersIfChanged(next: AudioMeterSnapshot): void {
    if (
      this.meters.sourceRms === next.sourceRms &&
      this.meters.sourcePeak === next.sourcePeak &&
      this.meters.sourceLevelPercent === next.sourceLevelPercent &&
      this.meters.sourceClipping === next.sourceClipping &&
      this.meters.microphoneRms === next.microphoneRms &&
      this.meters.microphonePeak === next.microphonePeak &&
      this.meters.microphoneLevelPercent === next.microphoneLevelPercent &&
      this.meters.microphoneClipping === next.microphoneClipping &&
      this.meters.masterRms === next.masterRms &&
      this.meters.masterPeak === next.masterPeak &&
      this.meters.masterLevelPercent === next.masterLevelPercent &&
      this.meters.clipping === next.clipping &&
      this.meters.isDucking === next.isDucking &&
      this.meters.duckGainMultiplier === next.duckGainMultiplier
    ) {
      return;
    }

    this.meters = next;
    for (const listener of this.meterListeners) {
      listener(this.meters);
    }
  }
}

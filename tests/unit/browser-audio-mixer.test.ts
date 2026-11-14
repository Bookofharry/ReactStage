import { describe, expect, it, vi } from 'vitest';
import {
  BrowserAudioMixer,
  type MixerAnalyserNodeLike,
  type MixerAudioContextLike,
  type MixerConnectableNodeLike,
  type MixerGainNodeLike,
} from '../../src/services/audio-mixer';

interface SimNode extends MixerConnectableNodeLike {
  readonly id: string;
  readonly kind:
    | 'gain'
    | 'analyser'
    | 'element-source'
    | 'stream-source'
    | 'stream-dest'
    | 'speaker-dest';
  readonly outputs: Set<SimNode>;
  evaluateBuffer(length: number): Float32Array<ArrayBuffer>;
}

interface SignalGenerator {
  sourceAmplitude: number;
  micAmplitudes: Map<string, number>;
}

/**
 * Deterministic sample-accurate Web Audio graph simulator.
 * Propagates real floating-point waveforms through connected nodes so tests
 * verify actual post-gain signal math, channel summing, mute gating, clipping,
 * and graph topology invariants (zero mic-to-speaker paths, single monitor path).
 */
function createSimulatedWebAudioGraph(options?: {
  initialState?: AudioContextState | 'interrupted';
  resumeImpl?: (setRunning: () => void) => Promise<void>;
}) {
  const signal: SignalGenerator = {
    sourceAmplitude: 0.4,
    micAmplitudes: new Map<string, number>(),
  };

  const stateListeners = new Set<() => void>();
  let currentState: AudioContextState | 'interrupted' =
    options?.initialState ?? 'running';

  const allNodes: SimNode[] = [];
  const inputsMap = new Map<SimNode, Set<SimNode>>();
  let nodeCounter = 0;

  function registerNode(node: SimNode): SimNode {
    allNodes.push(node);
    inputsMap.set(node, new Set<SimNode>());
    return node;
  }

  function link(from: SimNode, to: unknown): void {
    const target = to as SimNode;
    from.outputs.add(target);
    let inbound = inputsMap.get(target);
    if (!inbound) {
      inbound = new Set<SimNode>();
      inputsMap.set(target, inbound);
    }
    inbound.add(from);
  }

  function unlink(from: SimNode, to?: unknown): void {
    if (to !== undefined) {
      const target = to as SimNode;
      from.outputs.delete(target);
      inputsMap.get(target)?.delete(from);
      return;
    }
    for (const target of from.outputs) {
      inputsMap.get(target)?.delete(from);
    }
    from.outputs.clear();
  }

  function sumInputs(node: SimNode, length: number): Float32Array<ArrayBuffer> {
    const out = new Float32Array(new ArrayBuffer(length * 4));
    const inbound = inputsMap.get(node);
    if (!inbound || inbound.size === 0) {
      return out;
    }
    for (const upstream of inbound) {
      const upstreamBuf = upstream.evaluateBuffer(length);
      for (let i = 0; i < length; i += 1) {
        out[i] = (out[i] ?? 0) + (upstreamBuf[i] ?? 0);
      }
    }
    return out;
  }

  let speakerConnectCalls = 0;
  const speakerDestination = registerNode({
    id: 'speaker-destination',
    kind: 'speaker-dest',
    outputs: new Set<SimNode>(),
    connect: () => undefined,
    disconnect: () => undefined,
    evaluateBuffer: (len) => sumInputs(speakerDestination, len),
  });

  const createGainSpy = vi.fn((): MixerGainNodeLike & SimNode => {
    nodeCounter += 1;
    const gainParam = { value: 1 };
    const node: MixerGainNodeLike & SimNode = {
      id: `gain-${nodeCounter}`,
      kind: 'gain',
      gain: gainParam,
      outputs: new Set<SimNode>(),
      connect(target: unknown) {
        if (target === speakerDestination) {
          speakerConnectCalls += 1;
        }
        link(node, target);
      },
      disconnect(target?: unknown) {
        unlink(node, target);
      },
      evaluateBuffer(length: number) {
        const summed = sumInputs(node, length);
        for (let i = 0; i < length; i += 1) {
          summed[i] = (summed[i] ?? 0) * gainParam.value;
        }
        return summed;
      },
    };
    registerNode(node);
    return node;
  });

  const createAnalyserSpy = vi.fn((): MixerAnalyserNodeLike & SimNode => {
    nodeCounter += 1;
    const node: MixerAnalyserNodeLike & SimNode = {
      id: `analyser-${nodeCounter}`,
      kind: 'analyser',
      fftSize: 256,
      smoothingTimeConstant: 0.5,
      outputs: new Set<SimNode>(),
      connect(target: unknown) {
        link(node, target);
      },
      disconnect(target?: unknown) {
        unlink(node, target);
      },
      getFloatTimeDomainData(array: Float32Array<ArrayBuffer>) {
        const buf = sumInputs(node, array.length);
        array.set(buf);
      },
      evaluateBuffer(length: number) {
        return sumInputs(node, length);
      },
    };
    registerNode(node);
    return node;
  });

  const boundElements = new Set<HTMLMediaElement>();
  const createMediaElementSourceSpy = vi.fn((element: HTMLMediaElement) => {
    if (boundElements.has(element)) {
      throw new DOMException(
        'HTMLMediaElement already connected previously to a MediaElementSourceNode',
        'InvalidStateError',
      );
    }
    boundElements.add(element);
    nodeCounter += 1;
    const node: SimNode = {
      id: `element-src-${nodeCounter}`,
      kind: 'element-source',
      outputs: new Set<SimNode>(),
      connect(target: unknown) {
        link(node, target);
      },
      disconnect(target?: unknown) {
        unlink(node, target);
      },
      evaluateBuffer(length: number) {
        const out = new Float32Array(new ArrayBuffer(length * 4));
        const hasSrc = Boolean(element.getAttribute('src'));
        if (!hasSrc || element.paused || element.ended || element.muted) {
          return out;
        }
        const amp = signal.sourceAmplitude * element.volume;
        for (let i = 0; i < length; i += 1) {
          out[i] = i % 2 === 0 ? amp : -amp;
        }
        return out;
      },
    };
    registerNode(node);
    return node;
  });

  const streamSourceNodes: SimNode[] = [];
  const createMediaStreamSourceSpy = vi.fn((stream: MediaStream) => {
    nodeCounter += 1;
    const node: SimNode = {
      id: `stream-src-${nodeCounter}`,
      kind: 'stream-source',
      outputs: new Set<SimNode>(),
      connect(target: unknown) {
        link(node, target);
      },
      disconnect(target?: unknown) {
        unlink(node, target);
      },
      evaluateBuffer(length: number) {
        const out = new Float32Array(new ArrayBuffer(length * 4));
        const track = stream.getAudioTracks()[0];
        if (
          !track ||
          track.readyState === 'ended' ||
          !track.enabled ||
          track.muted
        ) {
          return out;
        }
        const amp = signal.micAmplitudes.get(stream.id) ?? 0.3;
        for (let i = 0; i < length; i += 1) {
          out[i] = i % 2 === 0 ? amp : -amp;
        }
        return out;
      },
    };
    registerNode(node);
    streamSourceNodes.push(node);
    return node;
  });

  const mixedTrack = {
    id: 'mixed-dest-audio-track-1',
    kind: 'audio',
    label: 'ReactStage Mixed Audio',
    readyState: 'live' as MediaStreamTrackState,
    enabled: true,
    muted: false,
    stop: vi.fn(),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  } as unknown as MediaStreamTrack;

  const mixedStream = {
    id: 'mixed-output-stream-1',
    getTracks: () => [mixedTrack],
    getAudioTracks: () => [mixedTrack],
    getVideoTracks: () => [],
  } as unknown as MediaStream;

  let destinationNodeRef: SimNode | null = null;
  const createMediaStreamDestinationSpy = vi.fn(() => {
    nodeCounter += 1;
    const destNode: SimNode & { readonly stream: MediaStream } = {
      id: `stream-dest-${nodeCounter}`,
      kind: 'stream-dest',
      stream: mixedStream,
      outputs: new Set<SimNode>(),
      connect: () => undefined,
      disconnect(target?: unknown) {
        unlink(destNode, target);
      },
      evaluateBuffer(length: number) {
        return sumInputs(destNode, length);
      },
    };
    registerNode(destNode);
    destinationNodeRef = destNode;
    return destNode;
  });

  const setContextState = (next: AudioContextState | 'interrupted') => {
    currentState = next;
    for (const listener of stateListeners) {
      listener();
    }
  };

  const resumeSpy = vi.fn((): Promise<void> => {
    if (options?.resumeImpl) {
      return options.resumeImpl(() => setContextState('running'));
    }
    setContextState('running');
    return Promise.resolve();
  });

  const closeSpy = vi.fn((): Promise<void> => {
    setContextState('closed');
    return Promise.resolve();
  });

  const context: MixerAudioContextLike = {
    get state() {
      return currentState;
    },
    destination: speakerDestination,
    createGain: createGainSpy,
    createAnalyser: createAnalyserSpy,
    createMediaElementSource: createMediaElementSourceSpy,
    createMediaStreamSource: createMediaStreamSourceSpy,
    createMediaStreamDestination: createMediaStreamDestinationSpy,
    resume: resumeSpy,
    close: closeSpy,
    addEventListener: (_type, listener) => {
      stateListeners.add(listener);
    },
    removeEventListener: (_type, listener) => {
      stateListeners.delete(listener);
    },
  };

  const createContextFactory = vi.fn(() => context);

  /**
   * Graph reachability check proving whether ANY directed path exists from
   * `start` to `goal` in the live Web Audio node graph.
   */
  function hasDirectedPath(start: SimNode, goal: SimNode): boolean {
    const visited = new Set<SimNode>();
    const stack: SimNode[] = [start];
    while (stack.length > 0) {
      const curr = stack.pop();
      if (!curr || visited.has(curr)) continue;
      if (curr === goal) return true;
      visited.add(curr);
      for (const next of curr.outputs) {
        stack.push(next);
      }
    }
    return false;
  }

  return {
    signal,
    context,
    createContextFactory,
    speakerDestination,
    getSpeakerConnectCalls: () => speakerConnectCalls,
    createMediaElementSourceSpy,
    createMediaStreamSourceSpy,
    createMediaStreamDestinationSpy,
    streamSourceNodes,
    resumeSpy,
    closeSpy,
    setContextState,
    hasPathFromAnyMicSourceToSpeakers: () =>
      streamSourceNodes.some((n) => hasDirectedPath(n, speakerDestination)),
    readMixedDestinationSignal: (len = 64) =>
      destinationNodeRef
        ? destinationNodeRef.evaluateBuffer(len)
        : new Float32Array(new ArrayBuffer(len * 4)),
    readSpeakerMonitorSignal: (len = 64) =>
      speakerDestination.evaluateBuffer(len),
  };
}

function createMockVideoElement(options?: {
  src?: string;
  paused?: boolean;
  mozHasAudio?: boolean;
}) {
  const video = document.createElement('video');
  let paused = options?.paused ?? false;

  Object.defineProperty(video, 'paused', {
    configurable: true,
    get: () => paused,
  });

  if (options?.mozHasAudio !== undefined) {
    Object.defineProperty(video, 'mozHasAudio', {
      configurable: true,
      get: () => options.mozHasAudio,
    });
  }

  if (options?.src) {
    video.setAttribute('src', options.src);
  }

  return {
    video,
    setPaused: (next: boolean) => {
      paused = next;
      video.dispatchEvent(new Event(next ? 'pause' : 'play'));
    },
  };
}

function createMockMicStream(id: string, label: string) {
  const listeners = new Map<string, Set<() => void>>();
  let readyState: MediaStreamTrackState = 'live';
  let enabled = true;
  let muted = false;
  const stopSpy = vi.fn(() => {
    readyState = 'ended';
  });

  const track = {
    id: `${id}-track`,
    kind: 'audio',
    label,
    get readyState() {
      return readyState;
    },
    get enabled() {
      return enabled;
    },
    set enabled(val: boolean) {
      enabled = val;
    },
    get muted() {
      return muted;
    },
    stop: stopSpy,
    addEventListener: vi.fn((type: string, cb: () => void) => {
      let set = listeners.get(type);
      if (!set) {
        set = new Set();
        listeners.set(type, set);
      }
      set.add(cb);
    }),
    removeEventListener: vi.fn((type: string, cb: () => void) => {
      listeners.get(type)?.delete(cb);
    }),
  } as unknown as MediaStreamTrack;

  const stream = {
    id,
    getTracks: () => [track],
    getAudioTracks: () => [track],
    getVideoTracks: () => [],
  } as unknown as MediaStream;

  return {
    stream,
    track,
    stopSpy,
    triggerEnded: () => {
      readyState = 'ended';
      for (const cb of listeners.get('ended') ?? []) {
        cb();
      }
    },
    setHardwareMuted: (nextMuted: boolean) => {
      muted = nextMuted;
      for (const cb of listeners.get(nextMuted ? 'mute' : 'unmute') ?? []) {
        cb();
      }
    },
  };
}

describe('BrowserAudioMixer', () => {
  it('supports source-only, microphone-only, combined, and silent modes with accurate post-gain summing, 0–200% gain, mute, and clipping', () => {
    const graph = createSimulatedWebAudioGraph();
    graph.signal.sourceAmplitude = 0.4;
    graph.signal.micAmplitudes.set('mic-1', 0.3);

    const mixer = new BrowserAudioMixer({
      createAudioContext: graph.createContextFactory,
      scheduler: {
        requestFrame: () => 1,
        cancelFrame: () => undefined,
        now: () => 1000,
      },
    });

    // Lazy initialization: zero AudioContexts created on idle construction
    expect(graph.createContextFactory).not.toHaveBeenCalled();
    expect(mixer.getState().status).toBe('idle');
    expect(mixer.getState().mixMode).toBe('silent');
    expect(mixer.getMixedOutputStream()).toBeNull();

    // 1. Source-only mode
    const { video } = createMockVideoElement({
      src: 'blob:http://localhost/source-1',
      paused: false,
    });
    mixer.attachSourceElement(video);

    expect(graph.createContextFactory).toHaveBeenCalledTimes(1);
    expect(mixer.getState().status).toBe('running');
    expect(mixer.getState().mixMode).toBe('source-only');

    const outputStream = mixer.getMixedOutputStream();
    expect(outputStream).not.toBeNull();
    expect(outputStream?.getAudioTracks().length).toBe(1);
    expect(outputStream?.getVideoTracks().length).toBe(0);
    expect(mixer.getState().outputTrackCount).toBe(1);

    const srcOnlyMeters = mixer.sampleMetersNow();
    expect(srcOnlyMeters.sourceRms).toBeCloseTo(0.4, 3);
    expect(srcOnlyMeters.microphoneRms).toBe(0);
    expect(srcOnlyMeters.masterPeak).toBeCloseTo(0.4, 3);
    expect(srcOnlyMeters.clipping).toBe(false);

    // Creator speaker monitor receives source audio (0.4), mixed destination receives 0.4
    expect(Math.abs(graph.readSpeakerMonitorSignal(8)[0] ?? 0)).toBeCloseTo(
      0.4,
      3,
    );
    expect(Math.abs(graph.readMixedDestinationSignal(8)[0] ?? 0)).toBeCloseTo(
      0.4,
      3,
    );

    // 2. Attach live microphone -> Combined mode
    const mic1 = createMockMicStream('mic-1', 'Studio Condenser');
    mixer.attachMicrophoneStream(mic1.stream, 'Studio Condenser');

    expect(mixer.getState().mixMode).toBe('combined');
    // Same stable MediaStreamAudioDestinationNode output reference!
    expect(mixer.getMixedOutputStream()).toBe(outputStream);
    // ZERO microphone-to-speaker connections!
    expect(graph.hasPathFromAnyMicSourceToSpeakers()).toBe(false);
    expect(graph.getSpeakerConnectCalls()).toBe(1);

    const combinedMeters = mixer.sampleMetersNow();
    expect(combinedMeters.sourceRms).toBeCloseTo(0.4, 3);
    expect(combinedMeters.microphoneRms).toBeCloseTo(0.3, 3);
    // Constructive sum in master mix bus: 0.4 + 0.3 = 0.7!
    expect(combinedMeters.masterPeak).toBeCloseTo(0.7, 3);
    expect(Math.abs(graph.readMixedDestinationSignal(8)[0] ?? 0)).toBeCloseTo(
      0.7,
      3,
    );
    // Speaker monitor MUST ONLY contain video audio (0.4), NEVER microphone (0.3)!
    expect(Math.abs(graph.readSpeakerMonitorSignal(8)[0] ?? 0)).toBeCloseTo(
      0.4,
      3,
    );

    // 3. Independent 0–200% gain & post-gain clipping detection
    mixer.setSourceChannel({ gain: 1.5, muted: false }); // 0.4 * 1.5 = 0.60
    mixer.setMicrophoneChannel({ gain: 2.0, muted: false }); // 0.3 * 2.0 = 0.60 -> sum = 1.20 >= 0.98 (CLIP!)

    const boostedMeters = mixer.sampleMetersNow();
    expect(boostedMeters.sourcePeak).toBeCloseTo(0.6, 3);
    expect(boostedMeters.sourceClipping).toBe(false);
    expect(boostedMeters.microphonePeak).toBeCloseTo(0.6, 3);
    expect(boostedMeters.microphoneClipping).toBe(false);
    expect(boostedMeters.masterPeak).toBeCloseTo(1.2, 3);
    expect(boostedMeters.clipping).toBe(true);

    // Direct single-channel clipping when source gain = 200% on 0.55 source
    graph.signal.sourceAmplitude = 0.55;
    mixer.setSourceChannel({ gain: 2, muted: false }); // 1.10 >= 0.98
    const singleClip = mixer.sampleMetersNow();
    expect(singleClip.sourceClipping).toBe(true);
    expect(singleClip.clipping).toBe(true);

    // 4. Mute source -> Microphone-only mode
    mixer.setSourceChannel({ gain: 1.5, muted: true });
    expect(mixer.getState().mixMode).toBe('microphone-only');
    const micOnlyMeters = mixer.sampleMetersNow();
    expect(micOnlyMeters.sourceRms).toBe(0);
    expect(micOnlyMeters.microphonePeak).toBeCloseTo(0.6, 3);
    expect(Math.abs(graph.readSpeakerMonitorSignal(8)[0] ?? 0)).toBe(0);
    expect(Math.abs(graph.readMixedDestinationSignal(8)[0] ?? 0)).toBeCloseTo(
      0.6,
      3,
    );

    // 5. Mute microphone too -> Silent mode
    mixer.setMicrophoneChannel({ gain: 2.0, muted: true });
    expect(mixer.getState().mixMode).toBe('silent');
    const silentMeters = mixer.sampleMetersNow();
    expect(silentMeters.masterPeak).toBe(0);
    expect(Math.abs(graph.readMixedDestinationSignal(8)[0] ?? 0)).toBe(0);

    mixer.dispose();
  });

  it('preserves microphone & graph across source pause/resume, seek, playbackRate, replacement, unload, and missing audio tracks without duplicate createMediaElementSource', () => {
    const revokeSpy = vi.spyOn(URL, 'revokeObjectURL');
    const graph = createSimulatedWebAudioGraph();
    graph.signal.sourceAmplitude = 0.45;
    graph.signal.micAmplitudes.set('mic-live', 0.25);

    const mixer = new BrowserAudioMixer({
      createAudioContext: graph.createContextFactory,
      scheduler: {
        requestFrame: () => 1,
        cancelFrame: () => undefined,
        now: () => 1000,
      },
    });

    const { video, setPaused } = createMockVideoElement({
      src: 'blob:http://localhost/first-clip',
      paused: false,
    });
    const mic = createMockMicStream('mic-live', 'Creator Mic');

    mixer.attachSourceElement(video);
    mixer.attachMicrophoneStream(mic.stream, 'Creator Mic');
    const initialMixedStream = mixer.getMixedOutputStream();

    expect(graph.createMediaElementSourceSpy).toHaveBeenCalledTimes(1);
    expect(graph.getSpeakerConnectCalls()).toBe(1);

    // 1. Pause source video -> source silences naturally while mic stays live in mix!
    setPaused(true);
    expect(mixer.getState().sourceAvailability).toBe('paused');
    const pausedMeters = mixer.sampleMetersNow();
    expect(pausedMeters.sourceRms).toBe(0);
    expect(pausedMeters.microphoneRms).toBeCloseTo(0.25, 3);
    expect(Math.abs(graph.readMixedDestinationSignal(8)[0] ?? 0)).toBeCloseTo(
      0.25,
      3,
    );

    // 2. Resume source video -> restores source audio WITHOUT recreating graph or MediaElementAudioSourceNode!
    setPaused(false);
    const resumedMeters = mixer.sampleMetersNow();
    expect(resumedMeters.sourceRms).toBeCloseTo(0.45, 3);
    expect(resumedMeters.microphoneRms).toBeCloseTo(0.25, 3);
    expect(graph.createContextFactory).toHaveBeenCalledTimes(1);
    expect(graph.createMediaElementSourceSpy).toHaveBeenCalledTimes(1);
    expect(mixer.getMixedOutputStream()).toBe(initialMixedStream);

    // 3. Seek & playback speed changes never interrupt mic or recreate destination
    video.currentTime = 24.5;
    video.dispatchEvent(new Event('timeupdate'));
    video.playbackRate = 1.5;
    video.dispatchEvent(new Event('ratechange'));
    expect(mic.stopSpy).not.toHaveBeenCalled();
    expect(mixer.getMixedOutputStream()).toBe(initialMixedStream);

    // 4. Replace source video on the SAME <video> element -> reuses MediaElementAudioSourceNode!
    video.setAttribute('src', 'blob:http://localhost/second-clip');
    mixer.updateSourceDescriptor({
      hasSource: true,
      isPlaying: true,
      label: 'second-clip.webm',
    });
    mixer.attachSourceElement(video);
    expect(graph.createMediaElementSourceSpy).toHaveBeenCalledTimes(1);
    expect(graph.getSpeakerConnectCalls()).toBe(1);
    expect(mixer.getState().sourceLabel).toBe('second-clip.webm');

    // 5. Detach and reattach the SAME <video> element (e.g. StrictMode remount) -> STILL 1 createMediaElementSource!
    mixer.attachSourceElement(null);
    mixer.attachSourceElement(video);
    expect(graph.createMediaElementSourceSpy).toHaveBeenCalledTimes(1);
    expect(graph.getSpeakerConnectCalls()).toBe(1);

    // 6. Video without an audio track -> reports no-audio-track cleanly while mic continues
    mixer.updateSourceDescriptor({
      hasSource: true,
      isPlaying: true,
      label: 'silent-screen.webm',
      hasAudioTrack: false,
    });
    expect(mixer.getState().sourceAvailability).toBe('no-audio-track');
    expect(mixer.getState().mixMode).toBe('microphone-only');

    // 7. Unload source video -> removes stale source contribution, keeps mic active, never revokes Object URLs
    video.removeAttribute('src');
    video.dispatchEvent(new Event('emptied'));
    mixer.updateSourceDescriptor({ hasSource: false, label: null });

    expect(mixer.getState().sourceAvailability).toBe('no-source');
    expect(mixer.getState().mixMode).toBe('microphone-only');
    expect(mic.stopSpy).not.toHaveBeenCalled();
    expect(revokeSpy).not.toHaveBeenCalled();

    mixer.dispose();
  });

  it('handles microphone stop, live device switching, hardware mute, unexpected track end, and reconnect without interrupting source playback or stopping borrowed tracks', () => {
    const graph = createSimulatedWebAudioGraph();
    graph.signal.sourceAmplitude = 0.35;
    graph.signal.micAmplitudes.set('mic-usb', 0.2);
    graph.signal.micAmplitudes.set('mic-xlr', 0.5);

    const mixer = new BrowserAudioMixer({
      createAudioContext: graph.createContextFactory,
      scheduler: {
        requestFrame: () => 1,
        cancelFrame: () => undefined,
        now: () => 1000,
      },
    });

    const { video } = createMockVideoElement({
      src: 'blob:http://localhost/lecture',
      paused: false,
    });
    const pauseSpy = vi.spyOn(video, 'pause');
    mixer.attachSourceElement(video);

    const usbMic = createMockMicStream('mic-usb', 'USB Mic');
    mixer.attachMicrophoneStream(usbMic.stream, 'USB Mic');
    mixer.setMicrophoneChannel({ gain: 1.4, muted: false });

    expect(mixer.sampleMetersNow().microphonePeak).toBeCloseTo(0.28, 3);

    // 1. Hardware mute switch on mic track
    usbMic.setHardwareMuted(true);
    expect(mixer.getState().microphoneAvailability).toBe('muted-hardware');
    expect(mixer.getState().mixMode).toBe('source-only');
    expect(mixer.sampleMetersNow().microphoneRms).toBe(0);

    usbMic.setHardwareMuted(false);
    expect(mixer.getState().microphoneAvailability).toBe('live');
    expect(mixer.getState().mixMode).toBe('combined');

    // 2. Switch microphone to XLR Mic -> preserves 140% mic gain, never stops borrowed USB track
    const xlrMic = createMockMicStream('mic-xlr', 'XLR Interface');
    mixer.attachMicrophoneStream(xlrMic.stream, 'XLR Interface');
    expect(usbMic.stopSpy).not.toHaveBeenCalled();
    expect(mixer.getState().microphoneLabel).toBe('XLR Interface');
    expect(mixer.getState().microphoneChannel.gain).toBe(1.4);
    expect(mixer.sampleMetersNow().microphonePeak).toBeCloseTo(0.7, 3);

    // 3. Unexpected microphone unplug ('ended' event) -> source video keeps playing uninterrupted!
    xlrMic.triggerEnded();
    expect(mixer.getState().microphoneAvailability).toBe('ended');
    expect(mixer.getState().mixMode).toBe('source-only');
    expect(pauseSpy).not.toHaveBeenCalled();
    expect(mixer.sampleMetersNow().sourceRms).toBeCloseTo(0.35, 3);

    // 4. Reconnect fresh microphone stream -> resumes combined mixing on existing AudioContext
    const reconnectedMic = createMockMicStream('mic-usb', 'Reconnected USB Mic');
    mixer.attachMicrophoneStream(reconnectedMic.stream, 'Reconnected USB Mic');
    expect(mixer.getState().microphoneAvailability).toBe('live');
    expect(mixer.getState().mixMode).toBe('combined');
    expect(graph.createContextFactory).toHaveBeenCalledTimes(1);

    // 5. Detach microphone (stop mic) -> never calls track.stop() on borrowed track
    mixer.attachMicrophoneStream(null, null);
    expect(reconnectedMic.stopSpy).not.toHaveBeenCalled();
    expect(mixer.getState().microphoneAvailability).toBe('off');

    mixer.dispose();
  });

  it('handles AudioContext suspended/interrupted states, resume rejection, late async settlement after dispose, and idempotent disposal', async () => {
    const resolverRef: { current: (() => void) | null } = { current: null };
    let shouldRejectResume = true;

    const graph = createSimulatedWebAudioGraph({
      initialState: 'suspended',
      resumeImpl: (setRunning) => {
        if (shouldRejectResume) {
          return Promise.reject(
            new DOMException('User gesture required', 'NotAllowedError'),
          );
        }
        return new Promise<void>((resolve) => {
          resolverRef.current = () => {
            setRunning();
            resolve();
          };
        });
      },
    });

    const mixer = new BrowserAudioMixer({
      createAudioContext: graph.createContextFactory,
      scheduler: {
        requestFrame: () => 1,
        cancelFrame: () => undefined,
        now: () => 1000,
      },
    });

    // Initialize in suspended autoplay-restricted state
    await mixer.initialize();
    expect(mixer.getState().status).toBe('suspended');
    expect(mixer.getState().requiresUserGesture).toBe(true);
    expect(mixer.getState().error).toBeNull(); // Passive autoplay block doesn't spam error before user clicks Enable Audio

    // Explicit resume() rejected -> surfaces recoverable CONTEXT_RESUME_FAILED error
    await mixer.resume();
    expect(mixer.getState().status).toBe('suspended');
    expect(mixer.getState().requiresUserGesture).toBe(true);
    expect(mixer.getState().error?.code).toBe('CONTEXT_RESUME_FAILED');

    // Allow next resume() to succeed asynchronously
    shouldRejectResume = false;
    const resumePromise = mixer.resume();
    expect(resolverRef.current).not.toBeNull();
    resolverRef.current?.();
    await resumePromise;

    expect(mixer.getState().status).toBe('running');
    expect(mixer.getState().requiresUserGesture).toBe(false);
    expect(mixer.getState().error).toBeNull();

    // Simulate OS audio interruption ('interrupted') followed by late async resume after dispose()
    graph.setContextState('interrupted');
    expect(mixer.getState().status).toBe('suspended');

    const lateResumePromise = mixer.resume();
    // Dispose BEFORE lateResumePromise settles + call dispose() twice to verify idempotency
    mixer.dispose();
    mixer.dispose();

    expect(graph.closeSpy).toHaveBeenCalledTimes(1);
    expect(mixer.getMixedOutputStream()).toBeNull();

    // Settling the late promise after dispose must not throw or resurrect state
    resolverRef.current?.();
    await lateResumePromise;
    expect(mixer.getMixedOutputStream()).toBeNull();
  });
});

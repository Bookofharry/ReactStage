import { describe, expect, it, vi } from 'vitest';
import {
  MicrophoneLevelMeter,
  type AudioAnalyserLike,
  type AudioContextLike,
  type MediaStreamSourceNodeLike,
  type MeterFrameScheduler,
} from '../../src/services/capture-manager/microphone-level-meter';

function createMockAudioEnvironment(initialAmplitude = 0.25) {
  let amplitude = initialAmplitude;
  let connectedTarget: unknown = null;
  let contextState: AudioContextState = 'running';
  const destinationSentinel = { kind: 'SPEAKER_DESTINATION_DO_NOT_CONNECT' };

  const analyserDisconnectSpy = vi.fn();
  const sourceDisconnectSpy = vi.fn();

  const analyser: AudioAnalyserLike = {
    fftSize: 256,
    smoothingTimeConstant: 0.8,
    getFloatTimeDomainData: vi.fn((buffer: Float32Array<ArrayBuffer>) => {
      for (let i = 0; i < buffer.length; i += 1) {
        buffer[i] = i % 2 === 0 ? amplitude : -amplitude;
      }
    }),
    disconnect: analyserDisconnectSpy,
  };

  const source: MediaStreamSourceNodeLike = {
    connect: vi.fn((target: unknown) => {
      connectedTarget = target;
    }),
    disconnect: sourceDisconnectSpy,
  };

  const closeSpy = vi.fn(() => {
    contextState = 'closed';
    return Promise.resolve();
  });

  const context: AudioContextLike = {
    get state() {
      return contextState;
    },
    destination: destinationSentinel,
    createMediaStreamSource: vi.fn(() => source),
    createAnalyser: vi.fn(() => analyser),
    resume: vi.fn(() => Promise.resolve()),
    close: closeSpy,
  };

  const factory = vi.fn(() => context);

  let nextRafId = 1;
  let pendingFrame: (() => void) | null = null;
  let currentTimeMs = 100;

  const scheduler: MeterFrameScheduler = {
    requestFrame: vi.fn((cb: () => void) => {
      pendingFrame = cb;
      const id = nextRafId;
      nextRafId += 1;
      return id;
    }),
    cancelFrame: vi.fn(() => {
      pendingFrame = null;
    }),
    now: () => currentTimeMs,
  };

  return {
    factory,
    context,
    source,
    analyser,
    sourceDisconnectSpy,
    analyserDisconnectSpy,
    closeSpy,
    destinationSentinel,
    scheduler,
    getConnectedTarget: () => connectedTarget,
    setAmplitude: (next: number) => {
      amplitude = next;
    },
    stepFrame: (advanceMs = 60) => {
      currentTimeMs += advanceMs;
      const cb = pendingFrame;
      pendingFrame = null;
      cb?.();
    },
  };
}

function createBorrowedAudioStream() {
  const stopSpy = vi.fn();
  const endedListeners = new Set<EventListener>();
  let readyState: MediaStreamTrackState = 'live';

  const audioTrack = {
    kind: 'audio',
    get readyState() {
      return readyState;
    },
    stop: stopSpy,
    addEventListener: vi.fn((type: string, cb: EventListener) => {
      if (type === 'ended') {
        endedListeners.add(cb);
      }
    }),
    removeEventListener: vi.fn((type: string, cb: EventListener) => {
      if (type === 'ended') {
        endedListeners.delete(cb);
      }
    }),
  } as unknown as MediaStreamTrack;

  const stream = {
    getAudioTracks: () => [audioTrack],
    getTracks: () => [audioTrack],
  } as unknown as MediaStream;

  return {
    stream,
    stopSpy,
    triggerTrackEnded: () => {
      readyState = 'ended';
      for (const listener of Array.from(endedListeners)) {
        listener(new Event('ended'));
      }
    },
  };
}

describe('MicrophoneLevelMeter', () => {
  it('never creates an AudioContext before a live stream is attached and never connects to speakers', () => {
    const env = createMockAudioEnvironment(0.2);
    const meter = new MicrophoneLevelMeter({
      createAudioContext: env.factory,
      scheduler: env.scheduler,
    });

    expect(env.factory).not.toHaveBeenCalled();
    expect(meter.getReading().isMonitoring).toBe(false);

    const borrowed = createBorrowedAudioStream();
    meter.attachStream(borrowed.stream);

    expect(env.factory).toHaveBeenCalledTimes(1);
    expect(env.getConnectedTarget()).toBe(env.analyser);
    expect(env.getConnectedTarget()).not.toBe(env.destinationSentinel);

    // Step animation frame to sample signal
    env.stepFrame(60);
    expect(meter.getReading().isMonitoring).toBe(true);
    expect(meter.getReading().rms).toBeCloseTo(0.2, 2);
    expect(meter.getReading().levelPercent).toBeGreaterThan(50);
    expect(meter.getReading().clipping).toBe(false);

    // Clipping signal (>= 0.98 peak)
    env.setAmplitude(0.99);
    env.stepFrame(60);
    expect(meter.getReading().clipping).toBe(true);
    expect(meter.getReading().levelPercent).toBe(100);

    // Cleanup disconnects nodes, closes AudioContext, and NEVER stops CaptureManager's track
    meter.dispose();
    expect(env.sourceDisconnectSpy).toHaveBeenCalledTimes(1);
    expect(env.analyserDisconnectSpy).toHaveBeenCalledTimes(1);
    expect(env.closeSpy).toHaveBeenCalledTimes(1);
    expect(borrowed.stopSpy).not.toHaveBeenCalled();
  });

  it('closes AudioContext automatically when borrowed microphone track ends unexpectedly', () => {
    const env = createMockAudioEnvironment(0.15);
    const meter = new MicrophoneLevelMeter({
      createAudioContext: env.factory,
      scheduler: env.scheduler,
    });

    const borrowed = createBorrowedAudioStream();
    meter.attachStream(borrowed.stream);
    expect(meter.getReading().isMonitoring).toBe(true);

    borrowed.triggerTrackEnded();
    expect(meter.getReading().isMonitoring).toBe(false);
    expect(meter.getReading().levelPercent).toBe(0);
    expect(env.closeSpy).toHaveBeenCalledTimes(1);
    expect(borrowed.stopSpy).not.toHaveBeenCalled();
  });
});

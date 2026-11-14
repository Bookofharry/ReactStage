import { describe, expect, it, vi } from 'vitest';
import {
  BrowserRecordingEngine,
  patchWebmDurationIfStreaming,
  readBlobBytes,
  type MediaRecorderLike,
} from '../../src/services/recording-engine';

interface FakeTrackController {
  readonly track: MediaStreamTrack;
  readonly stopCalls: () => number;
  readonly triggerEnded: () => void;
}

function createFakeTrack(
  kind: 'video' | 'audio',
  width = 1280,
  height = 720,
): FakeTrackController {
  let state: MediaStreamTrackState = 'live';
  let stops = 0;
  const listeners = new Map<string, Set<EventListener>>();

  const track = {
    id: `${kind}-track-${String(Math.random())}`,
    kind,
    label: `Synthetic ${kind}`,
    enabled: true,
    muted: false,
    get readyState() {
      return state;
    },
    stop: () => {
      stops += 1;
      state = 'ended';
    },
    getSettings: () =>
      kind === 'video' ? { width, height, frameRate: 30 } : { sampleRate: 48000 },
    addEventListener: (type: string, cb: EventListener) => {
      const set = listeners.get(type) ?? new Set<EventListener>();
      set.add(cb);
      listeners.set(type, set);
    },
    removeEventListener: (type: string, cb: EventListener) => {
      listeners.get(type)?.delete(cb);
    },
  } as unknown as MediaStreamTrack;

  return {
    track,
    stopCalls: () => stops,
    triggerEnded: () => {
      state = 'ended';
      for (const cb of listeners.get('ended') ?? []) {
        cb(new Event('ended'));
      }
    },
  };
}

function createStreamFromTracks(tracks: MediaStreamTrack[]): MediaStream {
  return {
    id: `stream-${String(Math.random())}`,
    active: tracks.some((t) => t.readyState === 'live'),
    getTracks: () => [...tracks],
    getVideoTracks: () => tracks.filter((t) => t.kind === 'video'),
    getAudioTracks: () => tracks.filter((t) => t.kind === 'audio'),
  } as unknown as MediaStream;
}

class FakeMediaRecorder implements MediaRecorderLike {
  public state: RecordingState = 'inactive';
  public readonly mimeType: string;
  public ondataavailable: ((event: BlobEvent) => void) | null = null;
  public onstop: ((event: Event) => void) | null = null;
  public onerror: ((event: ErrorEvent) => void) | null = null;
  public readonly capturedStream: MediaStream;
  public readonly options: MediaRecorderOptions;
  public autoFlushChunkOnStop = true;

  public constructor(stream: MediaStream, options: MediaRecorderOptions) {
    this.capturedStream = stream;
    this.options = options;
    this.mimeType = options.mimeType ?? 'video/webm;codecs=vp9,opus';
  }

  public start(): void {
    this.state = 'recording';
  }

  public pause(): void {
    if (this.state !== 'recording') {
      throw new Error('InvalidStateError: not recording');
    }
    this.state = 'paused';
  }

  public resume(): void {
    if (this.state !== 'paused') {
      throw new Error('InvalidStateError: not paused');
    }
    this.state = 'recording';
  }

  public requestData(): void {
    // Controlled explicitly in tests via emitChunk()
  }

  public stop(): void {
    if (this.state === 'inactive') {
      return;
    }
    this.state = 'inactive';
    if (this.autoFlushChunkOnStop) {
      this.emitChunk(new Uint8Array([10, 20, 30, 40]));
    }
    queueMicrotask(() => {
      this.onstop?.(new Event('stop'));
    });
  }

  public emitChunk(payload: Uint8Array): void {
    const copy = new Uint8Array(payload.byteLength);
    copy.set(payload);
    const blob = new Blob([copy], { type: this.mimeType });
    this.ondataavailable?.({ data: blob } as unknown as BlobEvent);
  }

  public emitError(): void {
    this.state = 'inactive';
    this.onerror?.(new ErrorEvent('error'));
  }
}

describe('BrowserRecordingEngine & WebM Duration Patching', () => {
  it('orchestrates start, chunk accounting, pause/resume monotonic clock, stop finalization, and strict stream ownership', async () => {
    let fakeNowMs = 1_000;
    const recorders: FakeMediaRecorder[] = [];

    const engine = new BrowserRecordingEngine({
      now: () => fakeNowMs,
      clockIntervalMs: 1_000,
      isTypeSupported: (mime) =>
        mime === 'video/webm;codecs=vp8,opus' || mime === 'video/webm;codecs=vp8',
      mediaRecorderFactory: (stream, options) => {
        const rec = new FakeMediaRecorder(stream, options);
        recorders.push(rec);
        return rec;
      },
    });

    expect(engine.getSupportedMimeTypes()).toEqual([
      'video/webm;codecs=vp8,opus',
      'video/webm;codecs=vp8',
    ]);
    expect(engine.getState().status).toBe('idle');

    const canvasVideo = createFakeTrack('video', 1920, 1080);
    const mixedAudio = createFakeTrack('audio');
    const videoStream = createStreamFromTracks([canvasVideo.track]);
    const audioStream = createStreamFromTracks([mixedAudio.track]);

    await engine.start(videoStream, audioStream, {
      width: 1920,
      height: 1080,
      stopVideoTracksOnFinalize: true,
    });

    expect(engine.getState().status).toBe('recording');
    expect(engine.getState().negotiatedMimeType).toBe(
      'video/webm;codecs=vp8,opus',
    );
    expect(recorders[0]?.capturedStream.getTracks()).toHaveLength(2);

    // Advance 1,450ms while recording & emit a 100-byte chunk
    fakeNowMs += 1_450;
    recorders[0]?.emitChunk(new Uint8Array(100));
    expect(engine.getTelemetry().elapsedRecordingMs).toBe(1_450);
    expect(engine.getTelemetry().recordedBytes).toBe(100);
    expect(engine.getTelemetry().chunkCount).toBe(1);

    // Pause recording -> advance 5,000ms while paused (clock MUST NOT advance!)
    engine.pause();
    expect(engine.getState().status).toBe('paused');
    fakeNowMs += 5_000;
    expect(engine.getTelemetry().elapsedRecordingMs).toBe(1_450);

    // Resume recording -> advance 550ms -> total elapsed MUST equal 2,000ms
    engine.resume();
    expect(engine.getState().status).toBe('recording');
    fakeNowMs += 550;
    recorders[0]?.emitChunk(new Uint8Array(60));
    expect(engine.getTelemetry().elapsedRecordingMs).toBe(2_000);

    // Stop & finalize
    const artifact = await engine.stop();
    expect(engine.getState().status).toBe('completed');
    expect(artifact.durationMs).toBe(2_000);
    expect(artifact.sizeBytes).toBe(164); // 100 + 60 + 4 flushed bytes
    expect(artifact.chunkCount).toBe(3);
    expect(artifact.width).toBe(1920);
    expect(artifact.height).toBe(1080);
    expect(artifact.hasAudioTrack).toBe(true);
    expect(artifact.mimeType).toBe('video/webm;codecs=vp8,opus');

    // Ephemeral canvas video track WAS stopped; borrowed AudioMixer track WAS NOT stopped!
    expect(canvasVideo.stopCalls()).toBe(1);
    expect(mixedAudio.stopCalls()).toBe(0);

    // Clear artifact & dispose idempotently
    engine.clearArtifact();
    expect(engine.getState().status).toBe('idle');
    expect(engine.getState().lastArtifact).toBeNull();
    engine.dispose();
    engine.dispose();
    expect(mixedAudio.stopCalls()).toBe(0);
  });

  it('handles cancel(), unexpected video track ended, recorder errors, zero-byte artifacts, and video-only fallback', async () => {
    const recorders: FakeMediaRecorder[] = [];
    const engine = new BrowserRecordingEngine({
      now: () => 500,
      isTypeSupported: (mime) => mime.startsWith('video/webm'),
      mediaRecorderFactory: (stream, options) => {
        const rec = new FakeMediaRecorder(stream, options);
        recorders.push(rec);
        return rec;
      },
    });

    // 1. Video-only recording when mixedAudioStream is null, then cancel()
    const v1 = createFakeTrack('video');
    await engine.start(createStreamFromTracks([v1.track]), null, {
      stopVideoTracksOnFinalize: true,
    });
    expect(engine.getState().hasAudioTrack).toBe(false);
    expect(engine.getState().negotiatedMimeType).toBe('video/webm;codecs=vp9');
    recorders[0]?.emitChunk(new Uint8Array(50));

    engine.cancel();
    expect(engine.getState().status).toBe('idle');
    expect(engine.getTelemetry().recordedBytes).toBe(0);
    expect(engine.getTelemetry().elapsedRecordingMs).toBe(0);
    expect(v1.stopCalls()).toBe(1);

    // Late chunks from cancelled recorder must be ignored
    recorders[0]?.emitChunk(new Uint8Array(999));
    expect(engine.getTelemetry().recordedBytes).toBe(0);

    // 2. Unexpected video track termination during recording -> RECORDER_RUNTIME_ERROR
    const v2 = createFakeTrack('video');
    const a2 = createFakeTrack('audio');
    await engine.start(
      createStreamFromTracks([v2.track]),
      createStreamFromTracks([a2.track]),
      { stopVideoTracksOnFinalize: false },
    );
    v2.triggerEnded();
    expect(engine.getState().status).toBe('error');
    expect(engine.getState().error?.code).toBe('RECORDER_RUNTIME_ERROR');
    expect(a2.stopCalls()).toBe(0);

    // 3. Zero-byte artifact rejection -> EMPTY_RECORDING_ARTIFACT
    const v3 = createFakeTrack('video');
    await engine.start(createStreamFromTracks([v3.track]), null);
    const r3 = recorders[2];
    if (r3) {
      r3.autoFlushChunkOnStop = false;
    }
    await expect(engine.stop()).rejects.toThrow(/EMPTY_RECORDING_ARTIFACT/);
    expect(engine.getState().status).toBe('error');
    expect(engine.getState().error?.code).toBe('EMPTY_RECORDING_ARTIFACT');

    engine.dispose();
  });

  it('rejects cleanly when MediaRecorder is unsupported or video tracks are ended', async () => {
    const origRecorder = globalThis.MediaRecorder;
    vi.stubGlobal('MediaRecorder', undefined);

    const unsupportedEngine = new BrowserRecordingEngine();
    expect(unsupportedEngine.getState().isSupported).toBe(false);

    const liveVideo = createFakeTrack('video');
    await expect(
      unsupportedEngine.start(createStreamFromTracks([liveVideo.track]), null, {
        stopVideoTracksOnFinalize: true,
      }),
    ).rejects.toThrow(/RECORDER_UNSUPPORTED/);
    expect(liveVideo.stopCalls()).toBe(1);

    vi.stubGlobal('MediaRecorder', origRecorder);

    // Ended video track rejected with INVALID_VIDEO_TRACK
    const supportedEngine = new BrowserRecordingEngine({
      isTypeSupported: () => true,
      mediaRecorderFactory: (s, o) => new FakeMediaRecorder(s, o),
    });
    const endedVideo = createFakeTrack('video');
    endedVideo.track.stop();
    await expect(
      supportedEngine.start(createStreamFromTracks([endedVideo.track]), null),
    ).rejects.toThrow(/INVALID_VIDEO_TRACK/);
    expect(supportedEngine.getState().error?.code).toBe('INVALID_VIDEO_TRACK');
  });

  it('patches streaming EBML WebM Info with float64 Duration without mutating cluster payloads', async () => {
    // Minimal valid EBML Header + Unknown-Size Segment + Info (TimecodeScale=1,000,000) + Cluster
    const ebmlBytes = new Uint8Array([
      // EBML Header (0x1A45DFA3), size 4 (0x84), DocType (0x4282) size 2 "wm"
      0x1a, 0x45, 0xdf, 0xa3, 0x84, 0x42, 0x82, 0x81, 0x77,
      // Segment (0x18538067), unknown streaming size (0x01FFFFFFFFFFFFFF)
      0x18, 0x53, 0x80, 0x67, 0x01, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff,
      // Info (0x1549A966), size 7 (0x87): TimecodeScale (0x2AD7B1), size 3 (0x83), 1_000_000 (0x0F4240)
      0x15, 0x49, 0xa9, 0x66, 0x87, 0x2a, 0xd7, 0xb1, 0x83, 0x0f, 0x42, 0x40,
      // Cluster (0x1F43B675), size 2 (0x82), payload 0xAA, 0xBB
      0x1f, 0x43, 0xb6, 0x75, 0x82, 0xaa, 0xbb,
    ]);

    const originalBlob = new Blob([ebmlBytes], {
      type: 'video/webm;codecs=vp9,opus',
    });
    const patchedBlob = await patchWebmDurationIfStreaming(
      originalBlob,
      3_500,
      'video/webm;codecs=vp9,opus',
    );

    // Info size VINT grew from 1 byte (0x87) to 4 bytes (+3) plus 11-byte Duration element = +14 bytes
    expect(patchedBlob.size).toBe(originalBlob.size + 14);

    const patchedBytes = await readBlobBytes(patchedBlob);
    // Trailing Cluster bytes (0x1F, 0x43, 0xB6, 0x75, 0x82, 0xAA, 0xBB) remain intact
    expect(Array.from(patchedBytes.slice(-7))).toEqual([
      0x1f, 0x43, 0xb6, 0x75, 0x82, 0xaa, 0xbb,
    ]);

    // Second pass on already-patched WebM is idempotent (no duplicate 0x4489 added!)
    const secondPass = await patchWebmDurationIfStreaming(
      patchedBlob,
      3_500,
      'video/webm;codecs=vp9,opus',
    );
    expect(secondPass.size).toBe(patchedBlob.size);
  });
});

import { describe, expect, it, vi } from 'vitest';
import {
  CanvasSceneCompositor,
  type CompositorFrameScheduler,
} from '../../src/services/scene-compositor';

interface DrawImageRecord {
  readonly source: CanvasImageSource;
  readonly sx: number;
  readonly sy: number;
  readonly sw: number;
  readonly sh: number;
  readonly dx: number;
  readonly dy: number;
  readonly dw: number;
  readonly dh: number;
  readonly frameToken: string;
}

interface FillTextRecord {
  readonly text: string;
  readonly x: number;
  readonly y: number;
}

function createManualScheduler() {
  let currentTimeMs = 1000;
  let nextHandle = 1;
  const pending = new Map<number, (timestampMs: number) => void>();

  const scheduler: CompositorFrameScheduler = {
    requestFrame: (cb) => {
      const id = nextHandle++;
      pending.set(id, cb);
      return id;
    },
    cancelFrame: (id) => {
      pending.delete(id);
    },
    now: () => currentTimeMs,
  };

  return {
    scheduler,
    getPendingCount: () => pending.size,
    advanceBy: (deltaMs: number) => {
      currentTimeMs += deltaMs;
      const callbacks = Array.from(pending.entries());
      pending.clear();
      for (const [, cb] of callbacks) {
        cb(currentTimeMs);
      }
    },
  };
}

function createCanvasHarness(width = 1280, height = 720) {
  const drawCalls: DrawImageRecord[] = [];
  const textCalls: FillTextRecord[] = [];
  const strokeRectCalls: {
    readonly x: number;
    readonly y: number;
    readonly w: number;
    readonly h: number;
  }[] = [];

  const ctx = {
    fillStyle: '#000000',
    strokeStyle: '#000000',
    lineWidth: 1,
    font: '12px sans-serif',
    textAlign: 'center',
    textBaseline: 'middle',
    fillRect: vi.fn(),
    clearRect: vi.fn(),
    strokeRect: vi.fn((x: number, y: number, w: number, h: number) => {
      strokeRectCalls.push({ x, y, w, h });
    }),
    fillText: vi.fn((text: string, x: number, y: number) => {
      textCalls.push({ text, x, y });
    }),
    drawImage: vi.fn(
      (
        source: CanvasImageSource,
        sx: number,
        sy: number,
        sw: number,
        sh: number,
        dx: number,
        dy: number,
        dw: number,
        dh: number,
      ) => {
        const tagged = source as unknown as { __frameToken?: string };
        drawCalls.push({
          source,
          sx,
          sy,
          sw,
          sh,
          dx,
          dy,
          dw,
          dh,
          frameToken: tagged.__frameToken ?? 'untagged',
        });
      },
    ),
  } as unknown as CanvasRenderingContext2D;

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  vi.spyOn(canvas, 'getContext').mockImplementation(((contextId: string) =>
    contextId === '2d' ? ctx : null) as typeof canvas.getContext);

  return {
    canvas,
    ctx,
    drawCalls,
    textCalls,
    strokeRectCalls,
    resetRecords: () => {
      drawCalls.length = 0;
      textCalls.length = 0;
      strokeRectCalls.length = 0;
    },
  };
}

function createMockSourceVideo(options: {
  src?: string | null;
  width?: number;
  height?: number;
  readyState?: number;
  paused?: boolean;
  ended?: boolean;
  currentTime?: number;
  frameToken?: string;
  hasError?: boolean;
}) {
  const el = document.createElement('video');
  if (options.src !== null) {
    el.setAttribute(
      'src',
      options.src ?? 'blob:http://localhost:5173/local-video-1',
    );
  }

  let videoWidth = options.width ?? 1920;
  let videoHeight = options.height ?? 1080;
  let readyState = options.readyState ?? 4;
  let paused = options.paused ?? false;
  let ended = options.ended ?? false;
  let currentTime = options.currentTime ?? 0;
  let hasError = options.hasError ?? false;

  Object.defineProperty(el, '__frameToken', {
    configurable: true,
    writable: true,
    value: options.frameToken ?? 'src-frame-0',
  });
  Object.defineProperty(el, 'videoWidth', {
    configurable: true,
    get: () => videoWidth,
  });
  Object.defineProperty(el, 'videoHeight', {
    configurable: true,
    get: () => videoHeight,
  });
  Object.defineProperty(el, 'readyState', {
    configurable: true,
    get: () => readyState,
  });
  Object.defineProperty(el, 'paused', {
    configurable: true,
    get: () => paused,
  });
  Object.defineProperty(el, 'ended', {
    configurable: true,
    get: () => ended,
  });
  Object.defineProperty(el, 'currentTime', {
    configurable: true,
    get: () => currentTime,
    set: (val: number) => {
      currentTime = val;
    },
  });
  Object.defineProperty(el, 'error', {
    configurable: true,
    get: () => (hasError ? ({ code: 3 } as MediaError) : null),
  });

  const playSpy = vi.spyOn(el, 'play');
  const pauseSpy = vi.spyOn(el, 'pause');

  return {
    el,
    playSpy,
    pauseSpy,
    update: (next: {
      src?: string | null;
      width?: number;
      height?: number;
      readyState?: number;
      paused?: boolean;
      ended?: boolean;
      currentTime?: number;
      frameToken?: string;
      hasError?: boolean;
    }) => {
      if (next.src === null) {
        el.removeAttribute('src');
      } else if (next.src !== undefined) {
        el.setAttribute('src', next.src);
      }
      if (next.width !== undefined) videoWidth = next.width;
      if (next.height !== undefined) videoHeight = next.height;
      if (next.readyState !== undefined) readyState = next.readyState;
      if (next.paused !== undefined) paused = next.paused;
      if (next.ended !== undefined) ended = next.ended;
      if (next.currentTime !== undefined) currentTime = next.currentTime;
      if (next.hasError !== undefined) hasError = next.hasError;
      if (next.frameToken !== undefined) {
        (el as unknown as { __frameToken: string }).__frameToken =
          next.frameToken;
      }
    },
  };
}

function createMockCameraStreamAndDecoder(
  camWidth = 1280,
  camHeight = 720,
  initialToken = 'cam-frame-1',
) {
  const stopSpy = vi.fn();
  const listeners = new Map<string, Set<() => void>>();
  let readyState: MediaStreamTrackState = 'live';
  let enabled = true;

  const videoTrack = {
    id: 'mock-cam-track',
    kind: 'video',
    label: 'Studio Cam',
    get readyState() {
      return readyState;
    },
    get enabled() {
      return enabled;
    },
    set enabled(val: boolean) {
      enabled = val;
    },
    stop: stopSpy,
    addEventListener: vi.fn((type: string, cb: () => void) => {
      const set = listeners.get(type) ?? new Set<() => void>();
      set.add(cb);
      listeners.set(type, set);
    }),
    removeEventListener: vi.fn((type: string, cb: () => void) => {
      listeners.get(type)?.delete(cb);
    }),
  } as unknown as MediaStreamTrack;

  const stream = {
    id: 'mock-cam-stream',
    getTracks: () => [videoTrack],
    getVideoTracks: () => [videoTrack],
    getAudioTracks: () => [],
  } as unknown as MediaStream;

  const decoderVideo = document.createElement('video');
  let decoderReadyState = 4;
  Object.defineProperty(decoderVideo, 'videoWidth', {
    configurable: true,
    get: () => camWidth,
  });
  Object.defineProperty(decoderVideo, 'videoHeight', {
    configurable: true,
    get: () => camHeight,
  });
  Object.defineProperty(decoderVideo, 'readyState', {
    configurable: true,
    get: () => decoderReadyState,
  });
  Object.defineProperty(decoderVideo, '__frameToken', {
    configurable: true,
    writable: true,
    value: initialToken,
  });

  return {
    stream,
    videoTrack,
    decoderVideo,
    stopSpy,
    setFrameToken: (token: string) => {
      (decoderVideo as unknown as { __frameToken: string }).__frameToken =
        token;
    },
    setDecoderReadyState: (rs: number) => {
      decoderReadyState = rs;
    },
    triggerTrackEnded: () => {
      readyState = 'ended';
      for (const cb of listeners.get('ended') ?? []) {
        cb();
      }
    },
  };
}

describe('CanvasSceneCompositor Service', () => {
  it('composites source-only, camera-only, PIP, and side-by-side layouts with aspect-safe landscape & portrait geometry at 720p and 1080p', () => {
    const { scheduler } = createManualScheduler();
    const { canvas, drawCalls, strokeRectCalls, resetRecords } =
      createCanvasHarness();
    const source = createMockSourceVideo({
      width: 1080,
      height: 1920, // Portrait 9:16 video
      frameToken: 'portrait-src',
    });
    const cam = createMockCameraStreamAndDecoder(640, 480, 'cam-4x3');

    const compositor = new CanvasSceneCompositor({
      scheduler,
      createVideoElement: () => cam.decoderVideo,
    });

    compositor.attachCanvas(canvas);
    compositor.setSourceVideo(source.el);
    compositor.setCameraStream(cam.stream);

    // 1. Source-only layout with 9:16 portrait source -> pillarboxed 405x720 centered at x=438
    resetRecords();
    compositor.setLayoutMode('source-only');
    expect(canvas.width).toBe(1280);
    expect(canvas.height).toBe(720);
    expect(drawCalls).toHaveLength(1);
    expect(drawCalls[0]).toMatchObject({
      frameToken: 'portrait-src',
      sx: 0,
      sy: 0,
      sw: 1080,
      sh: 1920,
      dx: 438,
      dy: 0,
      dw: 405,
      dh: 720,
    });

    // 2. Camera-only layout with 4:3 webcam -> centered cover crop onto full 1280x720 canvas
    resetRecords();
    compositor.setLayoutMode('camera-only');
    expect(drawCalls).toHaveLength(1);
    expect(drawCalls[0]).toMatchObject({
      frameToken: 'cam-4x3',
      sx: 0,
      sy: 60,
      sw: 640,
      sh: 360,
      dx: 0,
      dy: 0,
      dw: 1280,
      dh: 720,
    });

    // 3. PIP layout at 720p then switched to 1080p -> preserves normalized PIP composition
    compositor.setPipRect({ x: 0.65, y: 0.65, width: 0.3, height: 0.3 });
    resetRecords();
    compositor.setLayoutMode('pip');
    expect(drawCalls).toHaveLength(2);
    expect(drawCalls[0]?.frameToken).toBe('portrait-src');
    expect(drawCalls[1]).toMatchObject({
      frameToken: 'cam-4x3',
      dx: 832,
      dy: 468,
      dw: 384,
      dh: 216,
    });
    expect(strokeRectCalls.length).toBeGreaterThanOrEqual(1);

    resetRecords();
    compositor.setResolution('1080p');
    expect(canvas.width).toBe(1920);
    expect(canvas.height).toBe(1080);
    expect(compositor.getDiagnostics().actualWidth).toBe(1920);
    expect(compositor.getDiagnostics().actualHeight).toBe(1080);
    expect(drawCalls[1]).toMatchObject({
      frameToken: 'cam-4x3',
      dx: 1248,
      dy: 702,
      dw: 576,
      dh: 324,
    });

    // 4. Side-by-side split view at 60% split ratio on 1920x1080 with 16:9 landscape source
    source.update({ width: 1920, height: 1080, frameToken: 'landscape-src' });
    compositor.setSplitRatio(0.6);
    resetRecords();
    compositor.setLayoutMode('side-by-side');

    expect(drawCalls).toHaveLength(2);
    // Available width = 1920 - 4 = 1916; leftPane = round(1916 * 0.6) = 1150
    expect(drawCalls[0]).toMatchObject({
      frameToken: 'landscape-src',
      dx: 0,
      dw: 1150,
    });
    expect(drawCalls[1]).toMatchObject({
      frameToken: 'cam-4x3',
      dx: 1154,
      dy: 0,
      dw: 766,
      dh: 1080,
    });

    compositor.dispose();
  });

  it('continues rendering held source frame while webcam advances when source video is paused, sought, slowed, replaced, or unloaded', () => {
    const revokeSpy = vi.spyOn(URL, 'revokeObjectURL');
    const manual = createManualScheduler();
    const { canvas, drawCalls, textCalls, resetRecords } =
      createCanvasHarness();
    const source = createMockSourceVideo({
      paused: true,
      currentTime: 24.5,
      frameToken: 'paused-at-24.5s',
    });
    const cam = createMockCameraStreamAndDecoder(1280, 720, 'cam-live-1');

    const compositor = new CanvasSceneCompositor({
      scheduler: manual.scheduler,
      createVideoElement: () => cam.decoderVideo,
    });

    compositor.setSourceVideo(source.el);
    compositor.setCameraStream(cam.stream);
    compositor.start(canvas);

    // Advance 3 frames at ~34ms (30fps) while source video stays paused and camera moves
    for (let i = 2; i <= 4; i += 1) {
      resetRecords();
      cam.setFrameToken(`cam-live-${i}`);
      manual.advanceBy(34);

      expect(drawCalls).toHaveLength(2);
      expect(drawCalls[0]?.frameToken).toBe('paused-at-24.5s');
      expect(drawCalls[1]?.frameToken).toBe(`cam-live-${i}`);
    }

    // Source seek & ended state hold frame without touching camera or mutating video playback
    source.update({
      currentTime: 59.9,
      ended: true,
      frameToken: 'ended-final-frame',
    });
    resetRecords();
    source.el.dispatchEvent(new Event('seeked'));
    expect(drawCalls[0]?.frameToken).toBe('ended-final-frame');
    expect(drawCalls[1]?.frameToken).toBe('cam-live-4');

    // Source replacement entering loading (readyState = 0) immediately drops previous source frame (zero stale pixels)
    source.update({
      src: 'blob:http://localhost:5173/local-video-2',
      readyState: 0,
      ended: false,
      frameToken: 'loading-video-2',
    });
    resetRecords();
    cam.setFrameToken('cam-live-5');
    manual.advanceBy(34);

    // Only live camera is drawn via drawImage; background renders honest loading fallback
    expect(drawCalls).toHaveLength(1);
    expect(drawCalls[0]?.frameToken).toBe('cam-live-5');
    expect(textCalls.some((t) => t.text.includes('Loading Source Video'))).toBe(
      true,
    );

    // Source unload clears src -> honest "No Source Video" fallback while camera stays live
    source.update({ src: null, width: 0, height: 0, readyState: 0 });
    resetRecords();
    source.el.dispatchEvent(new Event('emptied'));
    expect(drawCalls).toHaveLength(1);
    expect(drawCalls[0]?.frameToken).toBe('cam-live-5');
    expect(textCalls.some((t) => t.text.includes('No Source Video'))).toBe(
      true,
    );

    // Verify strict ownership boundaries: zero mutations to source playback/URLs or camera tracks
    expect(source.playSpy).not.toHaveBeenCalled();
    expect(source.pauseSpy).not.toHaveBeenCalled();
    expect(revokeSpy).not.toHaveBeenCalled();
    expect(cam.stopSpy).not.toHaveBeenCalled();

    compositor.dispose();
    expect(cam.stopSpy).not.toHaveBeenCalled();
  });

  it('handles camera stop, device switching, unexpected track ended, invalid metadata, and cross-origin tainting protection', () => {
    const manual = createManualScheduler();
    const { canvas, drawCalls, textCalls, resetRecords } =
      createCanvasHarness();
    const source = createMockSourceVideo({ frameToken: 'valid-source' });
    const cam1 = createMockCameraStreamAndDecoder(1280, 720, 'cam-device-1');
    const cam2 = createMockCameraStreamAndDecoder(1920, 1080, 'cam-device-2');

    let nextDecoder: HTMLVideoElement = cam1.decoderVideo;
    const compositor = new CanvasSceneCompositor({
      scheduler: manual.scheduler,
      createVideoElement: () => nextDecoder,
    });

    compositor.attachCanvas(canvas);
    compositor.setSourceVideo(source.el);
    compositor.setCameraStream(cam1.stream);
    expect(compositor.getDiagnostics().hasActiveCameraFrame).toBe(true);

    // Unexpected camera track termination switches immediately to Camera Off fallback without calling stop()
    resetRecords();
    cam1.triggerTrackEnded();
    expect(compositor.getDiagnostics().hasActiveCameraFrame).toBe(false);
    expect(cam1.decoderVideo.srcObject).toBeNull();
    expect(textCalls.some((t) => t.text.includes('Camera Off'))).toBe(true);
    expect(cam1.stopSpy).not.toHaveBeenCalled();

    // Switch to camera 2 on a fresh stream
    compositor.dispose();
    nextDecoder = cam2.decoderVideo;
    const compositor2 = new CanvasSceneCompositor({
      scheduler: manual.scheduler,
      createVideoElement: () => nextDecoder,
    });
    compositor2.attachCanvas(canvas);
    compositor2.setSourceVideo(source.el);
    compositor2.setCameraStream(cam2.stream);
    expect(compositor2.getDiagnostics().hasActiveCameraFrame).toBe(true);

    // Camera stop detaches stream cleanly
    resetRecords();
    compositor2.setCameraStream(null);
    expect(compositor2.getDiagnostics().hasActiveCameraFrame).toBe(false);
    expect(cam2.stopSpy).not.toHaveBeenCalled();

    // Invalid metadata (0x0 dimensions) falls back safely
    source.update({ width: 0, height: 0 });
    resetRecords();
    compositor2.renderFrameNow();
    expect(drawCalls).toHaveLength(0);
    expect(compositor2.getDiagnostics().hasActiveSourceFrame).toBe(false);

    // Cross-origin source URL is blocked before drawImage to prevent canvas tainting
    source.update({
      src: 'https://cdn.example.org/external-clip.mp4',
      width: 1920,
      height: 1080,
      readyState: 4,
    });
    resetRecords();
    compositor2.renderFrameNow();
    expect(drawCalls).toHaveLength(0);
    expect(compositor2.getState().lastError?.code).toBe('CANVAS_TAINTED');

    compositor2.dispose();
  });

  it('paces 30fps loop without duplicate callbacks, avoids per-frame React state notifications, and disposes idempotently', () => {
    const manual = createManualScheduler();
    const { canvas } = createCanvasHarness();
    const source = createMockSourceVideo({ frameToken: 'steady-src' });

    const compositor = new CanvasSceneCompositor({
      scheduler: manual.scheduler,
    });

    const stateListener = vi.fn();
    compositor.subscribe(stateListener);

    compositor.setSourceVideo(source.el);
    compositor.start(canvas);
    const notificationsAfterStart = stateListener.mock.calls.length;

    // Repeated start() calls must never schedule duplicate rAF loops
    compositor.start(canvas);
    compositor.start();
    expect(manual.getPendingCount()).toBe(1);

    const initialFrames = compositor.getDiagnostics().renderedFrames;

    // Simulate 60Hz monitor ticks (16.7ms each) for ~1 second (60 ticks -> ~30 rendered frames)
    for (let tick = 0; tick < 60; tick += 1) {
      manual.advanceBy(16.7);
      expect(manual.getPendingCount()).toBe(1);
    }

    const deltaFrames =
      compositor.getDiagnostics().renderedFrames - initialFrames;
    expect(deltaFrames).toBeGreaterThanOrEqual(28);
    expect(deltaFrames).toBeLessThanOrEqual(32);
    expect(compositor.getDiagnostics().measuredFps).toBeGreaterThan(25);

    // Zero React state notifications during steady-state 30fps frame rendering!
    expect(stateListener.mock.calls.length).toBe(notificationsAfterStart);

    // Stop cancels pending frame callback immediately
    compositor.stop();
    expect(manual.getPendingCount()).toBe(0);
    expect(compositor.getState().isRunning).toBe(false);
    expect(compositor.getDiagnostics().measuredFps).toBe(0);

    // Idempotent disposal (safe to invoke repeatedly)
    compositor.dispose();
    compositor.dispose();
    expect(compositor.getCanvas()).toBeNull();
    expect(compositor.renderFrameNow()).toBe(false);
  });

  it('reports CANVAS_CONTEXT_UNAVAILABLE truthfully when 2D context creation returns null', () => {
    const brokenCanvas = document.createElement('canvas');
    vi.spyOn(brokenCanvas, 'getContext').mockReturnValue(null);

    const compositor = new CanvasSceneCompositor();
    compositor.attachCanvas(brokenCanvas);

    expect(compositor.getState().canvasAttached).toBe(false);
    expect(compositor.getState().lastError?.code).toBe(
      'CANVAS_CONTEXT_UNAVAILABLE',
    );
    expect(compositor.renderFrameNow()).toBe(false);
    compositor.dispose();
  });
});

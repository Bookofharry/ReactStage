import { describe, expect, it, vi } from 'vitest';
import {
  BrowserCaptureManager,
  type MediaDevicesLike,
} from '../../src/services/capture-manager/browser-capture-manager';

interface SyntheticTrack {
  readonly track: MediaStreamTrack;
  readonly stopSpy: ReturnType<typeof vi.fn>;
  triggerUnexpectedEnded: () => void;
}

function createSyntheticTrack(
  kind: 'video' | 'audio',
  deviceId: string,
  label: string,
): SyntheticTrack {
  let readyState: MediaStreamTrackState = 'live';
  const endedListeners = new Set<EventListener>();

  const stopSpy = vi.fn(() => {
    readyState = 'ended';
  });

  const track = {
    id: `${kind}-${deviceId}-${Math.random().toString(36).slice(2, 7)}`,
    kind,
    label,
    enabled: true,
    muted: false,
    get readyState() {
      return readyState;
    },
    stop: stopSpy,
    getSettings: () => ({ deviceId }),
    addEventListener: vi.fn((type: string, listener: EventListener) => {
      if (type === 'ended') {
        endedListeners.add(listener);
      }
    }),
    removeEventListener: vi.fn((type: string, listener: EventListener) => {
      if (type === 'ended') {
        endedListeners.delete(listener);
      }
    }),
  } as unknown as MediaStreamTrack;

  return {
    track,
    stopSpy,
    triggerUnexpectedEnded: () => {
      readyState = 'ended';
      for (const listener of Array.from(endedListeners)) {
        listener(new Event('ended'));
      }
    },
  };
}

function createSyntheticStream(tracks: readonly MediaStreamTrack[]): MediaStream {
  return {
    id: `stream-${Math.random().toString(36).slice(2, 8)}`,
    active: true,
    getTracks: () => [...tracks],
    getVideoTracks: () => tracks.filter((t) => t.kind === 'video'),
    getAudioTracks: () => tracks.filter((t) => t.kind === 'audio'),
  } as unknown as MediaStream;
}

function makeDeviceInfo(
  kind: MediaDeviceKind,
  deviceId: string,
  label: string,
): MediaDeviceInfo {
  return {
    deviceId,
    kind,
    label,
    groupId: `group-${deviceId}`,
    toJSON: () => ({ deviceId, kind, label }),
  };
}

describe('BrowserCaptureManager', () => {
  it('never calls getUserMedia or enumerateDevices on instantiation', () => {
    const getUserMedia = vi.fn();
    const enumerateDevices = vi.fn();
    const addEventListener = vi.fn();

    const manager = new BrowserCaptureManager({
      mediaDevices: {
        getUserMedia,
        enumerateDevices,
        addEventListener,
        removeEventListener: vi.fn(),
      },
    });

    expect(getUserMedia).not.toHaveBeenCalled();
    expect(enumerateDevices).not.toHaveBeenCalled();
    expect(addEventListener).not.toHaveBeenCalled();
    expect(manager.getSnapshot().cameraStatus).toBe('idle');
    expect(manager.getSnapshot().microphoneStatus).toBe('idle');
  });

  it('starts and stops camera and microphone with completely independent lifecycles', async () => {
    const camTrack = createSyntheticTrack('video', 'cam-1', 'Studio Webcam 4K');
    const micTrack = createSyntheticTrack('audio', 'mic-1', 'USB Condenser Mic');

    const mediaDevices: MediaDevicesLike = {
      getUserMedia: vi.fn((constraints: MediaStreamConstraints) => {
        if (constraints.video) {
          return Promise.resolve(createSyntheticStream([camTrack.track]));
        }
        return Promise.resolve(createSyntheticStream([micTrack.track]));
      }),
      enumerateDevices: vi.fn(() =>
        Promise.resolve([
          makeDeviceInfo('videoinput', 'cam-1', 'Studio Webcam 4K'),
          makeDeviceInfo('audioinput', 'mic-1', 'USB Condenser Mic'),
        ]),
      ),
    };

    const manager = new BrowserCaptureManager({ mediaDevices });

    await manager.startCamera();
    expect(manager.getSnapshot().cameraStatus).toBe('active');
    expect(manager.getSnapshot().cameraEnabled).toBe(true);
    expect(manager.getSnapshot().activeCameraLabel).toBe('Studio Webcam 4K');
    expect(manager.getSnapshot().microphoneStatus).toBe('idle');

    await manager.startMicrophone();
    expect(manager.getSnapshot().microphoneStatus).toBe('active');
    expect(manager.getSnapshot().microphoneEnabled).toBe(true);
    expect(manager.getSnapshot().activeMicrophoneLabel).toBe('USB Condenser Mic');

    // Stopping camera MUST leave microphone active and untouched
    manager.stopCamera();
    expect(camTrack.stopSpy).toHaveBeenCalledTimes(1);
    expect(manager.getSnapshot().cameraStatus).toBe('idle');
    expect(manager.getSnapshot().activeCameraStream).toBeNull();
    expect(manager.getSnapshot().microphoneStatus).toBe('active');
    expect(micTrack.stopSpy).not.toHaveBeenCalled();

    // Stopping microphone stops mic track cleanly
    manager.stopMicrophone();
    expect(micTrack.stopSpy).toHaveBeenCalledTimes(1);
    expect(manager.getSnapshot().microphoneStatus).toBe('idle');
  });

  it('switches active camera and microphone devices and stops replaced tracks', async () => {
    const cam1 = createSyntheticTrack('video', 'cam-1', 'Front Cam');
    const cam2 = createSyntheticTrack('video', 'cam-2', 'Overhead Cam');
    const mic1 = createSyntheticTrack('audio', 'mic-1', 'Built-in Mic');
    const mic2 = createSyntheticTrack('audio', 'mic-2', 'Podcast XLR');

    const getUserMedia = vi.fn((constraints: MediaStreamConstraints) => {
      if (constraints.video && typeof constraints.video === 'object') {
        const exact = (constraints.video.deviceId as { exact?: string } | undefined)?.exact;
        return Promise.resolve(
          createSyntheticStream([exact === 'cam-2' ? cam2.track : cam1.track]),
        );
      }
      if (constraints.audio && typeof constraints.audio === 'object') {
        const exact = (constraints.audio.deviceId as { exact?: string } | undefined)?.exact;
        return Promise.resolve(
          createSyntheticStream([exact === 'mic-2' ? mic2.track : mic1.track]),
        );
      }
      return Promise.reject(new Error('Invalid constraints'));
    });

    const manager = new BrowserCaptureManager({
      mediaDevices: {
        getUserMedia,
        enumerateDevices: vi.fn(() =>
          Promise.resolve([
            makeDeviceInfo('videoinput', 'cam-1', 'Front Cam'),
            makeDeviceInfo('videoinput', 'cam-2', 'Overhead Cam'),
            makeDeviceInfo('audioinput', 'mic-1', 'Built-in Mic'),
            makeDeviceInfo('audioinput', 'mic-2', 'Podcast XLR'),
          ]),
        ),
      },
    });

    await manager.startCamera();
    await manager.startMicrophone();
    expect(manager.getSnapshot().activeCameraDeviceId).toBe('cam-1');
    expect(manager.getSnapshot().activeMicrophoneDeviceId).toBe('mic-1');

    // Switch camera to cam-2 while live -> cam-1 stopped, mic-1 untouched
    await manager.switchCamera('cam-2');
    expect(cam1.stopSpy).toHaveBeenCalledTimes(1);
    expect(manager.getSnapshot().activeCameraDeviceId).toBe('cam-2');
    expect(manager.getSnapshot().activeCameraLabel).toBe('Overhead Cam');
    expect(mic1.stopSpy).not.toHaveBeenCalled();

    // Switch microphone to mic-2 while live -> mic-1 stopped, cam-2 untouched
    await manager.switchMicrophone('mic-2');
    expect(mic1.stopSpy).toHaveBeenCalledTimes(1);
    expect(manager.getSnapshot().activeMicrophoneDeviceId).toBe('mic-2');
    expect(manager.getSnapshot().activeMicrophoneLabel).toBe('Podcast XLR');
    expect(cam2.stopSpy).not.toHaveBeenCalled();

    manager.dispose();
    expect(cam2.stopSpy).toHaveBeenCalledTimes(1);
    expect(mic2.stopSpy).toHaveBeenCalledTimes(1);
  });

  it('maps permission denial, missing device, busy hardware, overconstrained, and unsupported browser errors', async () => {
    const unsupportedMgr = new BrowserCaptureManager({ mediaDevices: null });
    await unsupportedMgr.startCamera();
    expect(unsupportedMgr.getSnapshot().cameraError?.code).toBe(
      'MEDIA_DEVICES_UNSUPPORTED',
    );

    const errorSequence = [
      { name: 'NotAllowedError', expectedCode: 'PERMISSION_DENIED' },
      { name: 'NotFoundError', expectedCode: 'DEVICE_NOT_FOUND' },
      { name: 'NotReadableError', expectedCode: 'DEVICE_IN_USE' },
      { name: 'OverconstrainedError', expectedCode: 'OVERCONSTRAINED' },
    ] as const;

    for (const item of errorSequence) {
      const domError = new DOMException('Hardware error', item.name);
      const mgr = new BrowserCaptureManager({
        mediaDevices: {
          getUserMedia: vi.fn(() => Promise.reject(domError)),
          enumerateDevices: vi.fn(() => Promise.resolve([])),
        },
      });

      const result = await mgr.startCamera();
      expect(result).toBeNull();
      expect(mgr.getSnapshot().cameraStatus).toBe('error');
      expect(mgr.getSnapshot().cameraError?.code).toBe(item.expectedCode);
      if (item.expectedCode === 'PERMISSION_DENIED') {
        expect(mgr.getSnapshot().cameraPermission).toBe('denied');
      }
    }
  });

  it('handles unexpected track termination on one channel without interrupting the other channel', async () => {
    const camTrack = createSyntheticTrack('video', 'cam-1', 'USB Cam');
    const micTrack = createSyntheticTrack('audio', 'mic-1', 'USB Mic');

    const manager = new BrowserCaptureManager({
      mediaDevices: {
        getUserMedia: vi.fn((c: MediaStreamConstraints) =>
          Promise.resolve(
            createSyntheticStream([c.video ? camTrack.track : micTrack.track]),
          ),
        ),
        enumerateDevices: vi.fn(() => Promise.resolve([])),
      },
    });

    await manager.startCamera();
    await manager.startMicrophone();

    // Simulate physical unplug of USB camera
    camTrack.triggerUnexpectedEnded();

    expect(manager.getSnapshot().cameraStatus).toBe('ended');
    expect(manager.getSnapshot().cameraEnabled).toBe(false);
    expect(manager.getSnapshot().activeCameraStream).toBeNull();
    expect(manager.getSnapshot().cameraError?.code).toBe(
      'TRACK_ENDED_UNEXPECTEDLY',
    );

    // Microphone remains active
    expect(manager.getSnapshot().microphoneStatus).toBe('active');
    expect(manager.getSnapshot().microphoneEnabled).toBe(true);
    expect(micTrack.stopSpy).not.toHaveBeenCalled();
  });

  it('deduplicates identical concurrent requests and stops late-resolving superseded streams on stop or switch races', async () => {
    const slowCamTrack = createSyntheticTrack('video', 'cam-slow', 'Slow Cam');
    const fastCamTrack = createSyntheticTrack('video', 'cam-fast', 'Fast Cam');

    let resolveSlowCam!: (stream: MediaStream) => void;
    const slowCamPromise = new Promise<MediaStream>((resolve) => {
      resolveSlowCam = resolve;
    });

    const getUserMedia = vi.fn((constraints: MediaStreamConstraints) => {
      const exact =
        typeof constraints.video === 'object'
          ? (constraints.video.deviceId as { exact?: string } | undefined)?.exact
          : undefined;
      if (exact === 'cam-fast') {
        return Promise.resolve(createSyntheticStream([fastCamTrack.track]));
      }
      return slowCamPromise;
    });

    const manager = new BrowserCaptureManager({
      mediaDevices: {
        getUserMedia,
        enumerateDevices: vi.fn(() => Promise.resolve([])),
      },
    });

    // 1. Duplicate concurrent calls with same target reuse the in-flight promise
    const p1 = manager.startCamera({ deviceId: 'cam-slow' });
    const p2 = manager.startCamera({ deviceId: 'cam-slow' });
    expect(p1).toBe(p2);
    expect(getUserMedia).toHaveBeenCalledTimes(1);

    // 2. Switch to cam-fast BEFORE cam-slow resolves
    const pFast = manager.switchCamera('cam-fast');
    await pFast;
    expect(manager.getSnapshot().activeCameraDeviceId).toBe('cam-fast');

    // Now resolve the stale cam-slow request -> its track MUST be immediately stopped!
    resolveSlowCam(createSyntheticStream([slowCamTrack.track]));
    const staleResult = await p1;
    expect(staleResult).toBeNull();
    expect(slowCamTrack.stopSpy).toHaveBeenCalledTimes(1);
    expect(fastCamTrack.stopSpy).not.toHaveBeenCalled();
    expect(manager.getSnapshot().activeCameraDeviceId).toBe('cam-fast');
  });

  it('stops late-resolving stream when stopCamera() is called while getUserMedia is still pending', async () => {
    const pendingMicTrack = createSyntheticTrack('audio', 'mic-1', 'Delayed Mic');
    let resolveMic!: (stream: MediaStream) => void;

    const manager = new BrowserCaptureManager({
      mediaDevices: {
        getUserMedia: vi.fn(
          () =>
            new Promise<MediaStream>((resolve) => {
              resolveMic = resolve;
            }),
        ),
        enumerateDevices: vi.fn(() => Promise.resolve([])),
      },
    });

    const startPromise = manager.startMicrophone();
    expect(manager.getSnapshot().microphoneStatus).toBe('requesting');

    manager.stopMicrophone();
    expect(manager.getSnapshot().microphoneStatus).toBe('idle');

    resolveMic(createSyntheticStream([pendingMicTrack.track]));
    const result = await startPromise;

    expect(result).toBeNull();
    expect(pendingMicTrack.stopSpy).toHaveBeenCalledTimes(1);
    expect(manager.getSnapshot().microphoneStatus).toBe('idle');
    expect(manager.getSnapshot().activeMicrophoneStream).toBeNull();
  });
});

import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { App } from '../../src/App';
import {
  BrowserCaptureManager,
  MicrophoneLevelMeter,
  type AudioAnalyserLike,
  type AudioContextLike,
  type MediaStreamSourceNodeLike,
} from '../../src/services/capture-manager';

function createSyntheticMediaHarness() {
  const camStopSpy = vi.fn();
  const micStopSpy = vi.fn();
  const contextCloseSpy = vi.fn(() => Promise.resolve());

  const camTrack = {
    id: 'cam-track-1',
    kind: 'video',
    label: 'Creator FaceCam Pro',
    readyState: 'live' as MediaStreamTrackState,
    stop: camStopSpy,
    getSettings: () => ({ deviceId: 'cam-pro', width: 1280, height: 720 }),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  } as unknown as MediaStreamTrack;

  const micTrack = {
    id: 'mic-track-1',
    kind: 'audio',
    label: 'Creator Broadcast Mic',
    readyState: 'live' as MediaStreamTrackState,
    stop: micStopSpy,
    getSettings: () => ({ deviceId: 'mic-pro' }),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  } as unknown as MediaStreamTrack;

  const camStream = {
    id: 'cam-stream',
    getTracks: () => [camTrack],
    getVideoTracks: () => [camTrack],
    getAudioTracks: () => [],
  } as unknown as MediaStream;

  const micStream = {
    id: 'mic-stream',
    getTracks: () => [micTrack],
    getVideoTracks: () => [],
    getAudioTracks: () => [micTrack],
  } as unknown as MediaStream;

  const getUserMediaSpy = vi.fn((constraints: MediaStreamConstraints) => {
    if (constraints.video) {
      return Promise.resolve(camStream);
    }
    return Promise.resolve(micStream);
  });

  const enumerateDevicesSpy = vi.fn((): Promise<MediaDeviceInfo[]> =>
    Promise.resolve([
      {
        deviceId: 'cam-pro',
        kind: 'videoinput',
        label: 'Creator FaceCam Pro',
        groupId: 'g1',
        toJSON: () => ({}),
      },
      {
        deviceId: 'mic-pro',
        kind: 'audioinput',
        label: 'Creator Broadcast Mic',
        groupId: 'g2',
        toJSON: () => ({}),
      },
    ]),
  );

  const captureManager = new BrowserCaptureManager({
    mediaDevices: {
      getUserMedia: getUserMediaSpy,
      enumerateDevices: enumerateDevicesSpy,
    },
  });

  const analyser: AudioAnalyserLike = {
    fftSize: 256,
    smoothingTimeConstant: 0.5,
    getFloatTimeDomainData: (arr: Float32Array<ArrayBuffer>) => {
      arr.fill(0.18);
    },
    disconnect: vi.fn(),
  };

  const source: MediaStreamSourceNodeLike = {
    connect: vi.fn(),
    disconnect: vi.fn(),
  };

  const createAudioContextSpy = vi.fn(
    (): AudioContextLike => ({
      state: 'running',
      destination: {},
      createMediaStreamSource: () => source,
      createAnalyser: () => analyser,
      resume: () => Promise.resolve(),
      close: contextCloseSpy,
    }),
  );

  let sampledInitialFrame = false;
  const levelMeter = new MicrophoneLevelMeter({
    createAudioContext: createAudioContextSpy,
    scheduler: {
      requestFrame: (cb) => {
        if (!sampledInitialFrame) {
          sampledInitialFrame = true;
          return Number(setTimeout(cb, 10));
        }
        return 1;
      },
      cancelFrame: (id) => {
        clearTimeout(id);
      },
      now: () => 1000,
    },
  });

  return {
    captureManager,
    levelMeter,
    getUserMediaSpy,
    enumerateDevicesSpy,
    createAudioContextSpy,
    camStopSpy,
    micStopSpy,
    contextCloseSpy,
    camStream,
  };
}

function simulateSourceVideoMetadata(
  video: HTMLVideoElement,
  duration = 60,
) {
  Object.defineProperty(video, 'duration', {
    configurable: true,
    get: () => duration,
  });
  Object.defineProperty(video, 'videoWidth', {
    configurable: true,
    get: () => 1920,
  });
  Object.defineProperty(video, 'videoHeight', {
    configurable: true,
    get: () => 1080,
  });
  fireEvent.loadedMetadata(video);
}

describe('Creator Capture Setup UI & Source Playback Independence', () => {
  it('requests zero permissions on page load and starts camera/mic only from explicit user actions', async () => {
    const user = userEvent.setup();
    const harness = createSyntheticMediaHarness();

    const { unmount } = render(
      <App
        captureManager={harness.captureManager}
        levelMeter={harness.levelMeter}
      />,
    );

    // Zero media hardware or Web Audio calls on initial load
    expect(harness.getUserMediaSpy).not.toHaveBeenCalled();
    expect(harness.enumerateDevicesSpy).not.toHaveBeenCalled();
    expect(harness.createAudioContextSpy).not.toHaveBeenCalled();

    // Start Camera via user click
    await user.click(screen.getByTestId('camera-toggle-button'));
    expect(screen.getByTestId('camera-status-badge')).toHaveTextContent('Live');
    expect(screen.getByTestId('active-camera-label')).toHaveTextContent(
      'Creator FaceCam Pro',
    );

    const previewVideo = screen.getByTestId<HTMLVideoElement>(
      'webcam-preview-video',
    );
    expect(previewVideo.muted).toBe(true);
    expect(previewVideo).toHaveAttribute('playsinline');
    expect(previewVideo.srcObject).toBe(harness.camStream);

    // Mirror preview toggle only flips CSS class without restarting camera or altering stream
    expect(previewVideo.className).toContain('-scale-x-100');
    await user.click(screen.getByTestId('camera-mirror-button'));
    expect(previewVideo.className).not.toContain('-scale-x-100');
    expect(harness.getUserMediaSpy).toHaveBeenCalledTimes(1);

    // Start Microphone via user click
    await user.click(screen.getByTestId('microphone-toggle-button'));
    expect(screen.getByTestId('microphone-status-badge')).toHaveTextContent(
      'Live',
    );
    expect(harness.createAudioContextSpy).toHaveBeenCalledTimes(1);

    // Unmount stops all owned hardware tracks and closes AudioContext
    unmount();
    expect(harness.camStopSpy).toHaveBeenCalledTimes(1);
    expect(harness.micStopSpy).toHaveBeenCalledTimes(1);
    expect(harness.contextCloseSpy).toHaveBeenCalledTimes(1);
  });

  it('never interrupts active camera or microphone during source load, play, pause, seek, speed change, replacement, error, or unload', async () => {
    const user = userEvent.setup({ applyAccept: false });
    const harness = createSyntheticMediaHarness();

    render(
      <App
        captureManager={harness.captureManager}
        levelMeter={harness.levelMeter}
      />,
    );

    // Start both camera and microphone first
    await user.click(screen.getByTestId('camera-toggle-button'));
    await user.click(screen.getByTestId('microphone-toggle-button'));
    expect(screen.getByTestId('camera-status-badge')).toHaveTextContent('Live');
    expect(screen.getByTestId('microphone-status-badge')).toHaveTextContent(
      'Live',
    );

    // 1. Import source video 1
    const fileInput = screen.getByTestId('source-file-input');
    const sourceVideo = screen.getByTestId<HTMLVideoElement>(
      'source-video-element',
    );
    await user.upload(
      fileInput,
      new File(['video-1'], 'clip-1.webm', { type: 'video/webm' }),
    );
    simulateSourceVideoMetadata(sourceVideo, 90);

    // 2. Play, pause, seek, rewind, and change playback rate
    await user.click(screen.getByTestId('play-pause-button'));
    await user.click(screen.getByTestId('play-pause-button'));
    fireEvent.change(screen.getByTestId('seek-slider'), {
      target: { value: '35' },
    });
    await user.click(screen.getByTestId('rewind-button'));
    await user.selectOptions(screen.getByTestId('playback-speed-select'), '2');

    // 3. Replace with source video 2
    await user.upload(
      fileInput,
      new File(['video-2'], 'clip-2.mp4', { type: 'video/mp4' }),
    );
    simulateSourceVideoMetadata(sourceVideo, 45);

    // 4. Unload source video
    await user.click(screen.getByTestId('unload-video-button'));

    // 5. Attempt invalid file upload
    await user.upload(
      fileInput,
      new File(['not-a-video'], 'broken.txt', { type: 'text/plain' }),
    );
    expect(screen.getByTestId('source-error-alert')).toBeInTheDocument();

    // Camera and microphone MUST still be continuously Live with zero track stops!
    expect(harness.camStopSpy).not.toHaveBeenCalled();
    expect(harness.micStopSpy).not.toHaveBeenCalled();
    expect(screen.getByTestId('camera-status-badge')).toHaveTextContent('Live');
    expect(screen.getByTestId('microphone-status-badge')).toHaveTextContent(
      'Live',
    );
  });
});

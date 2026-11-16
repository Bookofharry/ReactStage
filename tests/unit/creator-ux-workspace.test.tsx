import { StrictMode } from 'react';
import { render, screen } from '@testing-library/react';
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
import {
  BrowserRecordingEngine,
  type MediaRecorderLike,
} from '../../src/services/recording-engine';

function createSyntheticWorkspaceHarness() {
  const camStopSpy = vi.fn();
  const micStopSpy = vi.fn();

  const camTrack = {
    id: 'cam-ux-1',
    kind: 'video',
    label: 'Creator Webcam',
    readyState: 'live' as MediaStreamTrackState,
    stop: camStopSpy,
    getSettings: () => ({ deviceId: 'cam-1', width: 1280, height: 720 }),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  } as unknown as MediaStreamTrack;

  const micTrack = {
    id: 'mic-ux-1',
    kind: 'audio',
    label: 'Creator Mic',
    readyState: 'live' as MediaStreamTrackState,
    stop: micStopSpy,
    getSettings: () => ({ deviceId: 'mic-1' }),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  } as unknown as MediaStreamTrack;

  const camStream = {
    id: 'cam-ux-stream',
    getTracks: () => [camTrack],
    getVideoTracks: () => [camTrack],
    getAudioTracks: () => [],
  } as unknown as MediaStream;

  const micStream = {
    id: 'mic-ux-stream',
    getTracks: () => [micTrack],
    getVideoTracks: () => [],
    getAudioTracks: () => [micTrack],
  } as unknown as MediaStream;

  const captureManager = new BrowserCaptureManager({
    mediaDevices: {
      getUserMedia: vi.fn((constraints: MediaStreamConstraints) =>
        Promise.resolve(constraints.video ? camStream : micStream),
      ),
      enumerateDevices: vi.fn((): Promise<MediaDeviceInfo[]> =>
        Promise.resolve([
          {
            deviceId: 'cam-1',
            kind: 'videoinput',
            label: 'Creator Webcam',
            groupId: 'g1',
            toJSON: () => ({}),
          },
          {
            deviceId: 'mic-1',
            kind: 'audioinput',
            label: 'Creator Mic',
            groupId: 'g2',
            toJSON: () => ({}),
          },
        ]),
      ),
    },
  });

  const analyser: AudioAnalyserLike = {
    fftSize: 256,
    smoothingTimeConstant: 0.5,
    getFloatTimeDomainData: (arr: Float32Array<ArrayBuffer>) => {
      arr.fill(0.12);
    },
    disconnect: vi.fn(),
  };

  const source: MediaStreamSourceNodeLike = {
    connect: vi.fn(),
    disconnect: vi.fn(),
  };

  const levelMeter = new MicrophoneLevelMeter({
    createAudioContext: (): AudioContextLike => ({
      state: 'running',
      destination: {},
      createMediaStreamSource: () => source,
      createAnalyser: () => analyser,
      resume: () => Promise.resolve(),
      close: () => Promise.resolve(),
    }),
    scheduler: {
      requestFrame: () => 1,
      cancelFrame: () => undefined,
      now: () => 0,
    },
  });

  Object.defineProperty(HTMLCanvasElement.prototype, 'captureStream', {
    configurable: true,
    writable: true,
    value: vi.fn(() => {
      const videoTrack = {
        id: 'canvas-ux-track',
        kind: 'video',
        readyState: 'live' as MediaStreamTrackState,
        stop: vi.fn(),
        getSettings: () => ({ width: 1280, height: 720, frameRate: 30 }),
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
      } as unknown as MediaStreamTrack;
      return {
        id: 'canvas-ux-stream',
        active: true,
        getTracks: () => [videoTrack],
        getVideoTracks: () => [videoTrack],
        getAudioTracks: () => [],
      } as unknown as MediaStream;
    }),
  });

  let fakeNowMs = 5_000;
  const recordingEngine = new BrowserRecordingEngine({
    now: () => fakeNowMs,
    clockIntervalMs: 50_000,
    isTypeSupported: (mime) => mime.startsWith('video/webm'),
    mediaRecorderFactory: (_stream, options) => {
      let recState: RecordingState = 'inactive';
      const rec: MediaRecorderLike = {
        get state() {
          return recState;
        },
        mimeType: options.mimeType ?? 'video/webm;codecs=vp9',
        ondataavailable: null,
        onerror: null,
        onstop: null,
        start: () => {
          recState = 'recording';
        },
        pause: () => {
          recState = 'paused';
        },
        resume: () => {
          recState = 'recording';
        },
        requestData: () => {
          rec.ondataavailable?.({
            data: new Blob(['ux-chunk'], { type: rec.mimeType }),
          } as unknown as BlobEvent);
        },
        stop: () => {
          fakeNowMs += 2_400;
          rec.ondataavailable?.({
            data: new Blob(['ux-final'], { type: rec.mimeType }),
          } as unknown as BlobEvent);
          recState = 'inactive';
          rec.onstop?.(new Event('stop'));
        },
      };
      return rec;
    },
  });

  return {
    captureManager,
    levelMeter,
    recordingEngine,
  };
}

describe('Creator Mild UX: Calm Stage, Settings Modal & Slim Side Panel', () => {
  it('keeps only simple PIP/Split/Shorts visible on stage, packs extra tools into Settings modal, and auto-focuses Takes after recording', async () => {
    const user = userEvent.setup();
    const { captureManager, levelMeter, recordingEngine } =
      createSyntheticWorkspaceHarness();

    const { unmount } = render(
      <StrictMode>
        <App
          captureManager={captureManager}
          levelMeter={levelMeter}
          recordingEngine={recordingEngine}
        />
      </StrictMode>,
    );

    // 1. Calm welcome prompt visible; extra tools packed away inside Settings modal
    expect(screen.getByTestId('stage-onboarding-checklist')).toBeInTheDocument();
    expect(screen.getByTestId('layout-mode-pip')).toBeInTheDocument();
    expect(screen.getByTestId('layout-mode-side-by-side')).toBeInTheDocument();
    expect(screen.getByTestId('layout-mode-top-bottom')).toBeInTheDocument();
    expect(
      screen.queryByTestId('studio-settings-modal'),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByTestId('layout-mode-source-only'),
    ).not.toBeInTheDocument();
    expect(screen.queryByTestId('pip-controls-bar')).not.toBeInTheDocument();
    expect(screen.queryByTestId('telestrator-toolbar')).not.toBeInTheDocument();

    // Slim side panel starts on Devices tab
    const devicesTab = screen.getByTestId('workspace-tab-devices');
    const audioTab = screen.getByTestId('workspace-tab-audio');
    const takesTab = screen.getByTestId('workspace-tab-takes');
    expect(devicesTab).toHaveAttribute('aria-selected', 'true');

    // 2. Bottom record bar 1-click toggles turn camera & mic on/off cleanly
    await user.click(screen.getByTestId('dock-mic-button'));
    expect(screen.getByTestId('dock-mic-button')).toHaveTextContent('Mic On');
    expect(devicesTab).toHaveTextContent('1 On');

    await user.click(screen.getByTestId('dock-camera-button'));
    expect(
      screen.queryByTestId('stage-onboarding-checklist'),
    ).not.toBeInTheDocument();
    expect(screen.getByTestId('dock-camera-button')).toHaveTextContent('Cam On');
    expect(devicesTab).toHaveTextContent('2 On');

    // 3. Settings & Tools modal opens cleanly and launches Draw toolbar on demand
    await user.click(screen.getByTestId('open-settings-modal-button'));
    expect(screen.getByTestId('studio-settings-modal')).toBeInTheDocument();
    expect(screen.getByTestId('pip-controls-bar')).toBeInTheDocument();
    expect(screen.getByTestId('scene-resolution-select')).toBeInTheDocument();
    expect(screen.getByTestId('layout-mode-source-only')).toBeInTheDocument();

    await user.click(screen.getByTestId('toggle-draw-tools-button'));
    expect(
      screen.queryByTestId('studio-settings-modal'),
    ).not.toBeInTheDocument();
    expect(screen.getByTestId('telestrator-toolbar')).toBeInTheDocument();

    await user.click(screen.getByTestId('close-draw-toolbar-button'));
    expect(screen.queryByTestId('telestrator-toolbar')).not.toBeInTheDocument();

    // Audio channel meters expand on demand
    await user.click(audioTab);
    expect(audioTab).toHaveAttribute('aria-selected', 'true');
    expect(screen.queryByTestId('mixer-source-meter')).not.toBeInTheDocument();
    await user.click(screen.getByTestId('toggle-audio-meters-button'));
    expect(screen.getByTestId('mixer-source-meter')).toBeInTheDocument();

    // 4. Completing a recording take automatically switches the drawer to the Takes tab
    await user.click(screen.getByTestId('start-recording-button'));
    await user.click(await screen.findByTestId('stop-recording-button'));

    expect(takesTab).toHaveAttribute('aria-selected', 'true');
    expect(takesTab).toHaveTextContent('1');
    expect(screen.getByTestId('download-export-button')).toBeInTheDocument();
    expect(screen.getByTestId('export-filename-input')).toBeInTheDocument();

    unmount();
  });
});

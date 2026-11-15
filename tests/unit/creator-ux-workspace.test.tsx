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
    camStopSpy,
    micStopSpy,
  };
}

describe('Task 21 Creator UX: 3-Step Onboarding, Unified Dock & Tabbed Workspace Drawer', () => {
  it('supports 1-click onboarding & dock device toggles, progressive disclosures, and auto-focuses Takes tab after recording', async () => {
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

    // 1. 3-step onboarding checklist visible on clean stage; progressive disclosures collapsed by default
    expect(screen.getByTestId('stage-onboarding-checklist')).toBeInTheDocument();
    expect(screen.queryByTestId('pip-controls-bar')).not.toBeInTheDocument();
    expect(screen.queryByTestId('telestrator-toolbar')).not.toBeInTheDocument();

    // Workspace drawer starts on Devices tab
    const devicesTab = screen.getByTestId('workspace-tab-devices');
    const audioTab = screen.getByTestId('workspace-tab-audio');
    const takesTab = screen.getByTestId('workspace-tab-takes');
    expect(devicesTab).toHaveAttribute('aria-selected', 'true');
    expect(audioTab).toHaveAttribute('aria-selected', 'false');
    expect(takesTab).toHaveAttribute('aria-selected', 'false');

    // 2. 1-click mic toggle on onboarding checklist syncs with bottom dock
    await user.click(screen.getByTestId('onboarding-mic-button'));
    expect(screen.getByTestId('dock-mic-button')).toHaveTextContent('Mic On');
    expect(devicesTab).toHaveTextContent('1 On');

    // 1-click camera button on onboarding checklist activates camera & clears empty stage checklist
    await user.click(screen.getByTestId('onboarding-camera-button'));
    expect(
      screen.queryByTestId('stage-onboarding-checklist'),
    ).not.toBeInTheDocument();
    expect(screen.getByTestId('dock-camera-button')).toHaveTextContent('Cam On');
    expect(devicesTab).toHaveTextContent('2 On');

    // Bottom dock 1-click toggles turn devices off and back on cleanly
    await user.click(screen.getByTestId('dock-camera-button'));
    expect(screen.getByTestId('dock-camera-button')).toHaveTextContent('Cam Off');
    await user.click(screen.getByTestId('dock-camera-button'));
    expect(screen.getByTestId('dock-camera-button')).toHaveTextContent('Cam On');

    // 3. Progressive disclosure toggles reveal Customize PIP, Draw tools, and Audio channel meters on demand
    await user.click(screen.getByTestId('toggle-layout-customize-button'));
    expect(screen.getByTestId('pip-controls-bar')).toBeInTheDocument();

    await user.click(screen.getByTestId('toggle-draw-tools-button'));
    expect(screen.getByTestId('telestrator-toolbar')).toBeInTheDocument();

    await user.click(audioTab);
    expect(audioTab).toHaveAttribute('aria-selected', 'true');
    expect(
      screen.queryByTestId('mixer-source-meter'),
    ).not.toBeInTheDocument();
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

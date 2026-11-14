import { StrictMode } from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { App } from '../../src/App';
import {
  BrowserAudioMixer,
  type MixerAudioContextLike,
} from '../../src/services/audio-mixer';
import { BrowserCaptureManager } from '../../src/services/capture-manager';

function createUiMixerHarness(options?: {
  initialContextState?: AudioContextState;
  rejectFirstResume?: boolean;
}) {
  let contextState: AudioContextState =
    options?.initialContextState ?? 'running';
  let rejectNext = options?.rejectFirstResume ?? false;
  const stateListeners = new Set<() => void>();

  const sourceGainParam = { value: 1 };
  const micGainParam = { value: 1 };
  let gainIndex = 0;

  const createMediaElementSourceSpy = vi.fn(() => ({
    connect: vi.fn(),
    disconnect: vi.fn(),
  }));

  const createMediaStreamSourceSpy = vi.fn(() => ({
    connect: vi.fn(),
    disconnect: vi.fn(),
  }));

  const mixedTrack = {
    id: 'ui-mix-track-1',
    kind: 'audio',
    label: 'Mixed Track',
    readyState: 'live' as MediaStreamTrackState,
    enabled: true,
    muted: false,
    stop: vi.fn(),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  } as unknown as MediaStreamTrack;

  const mixedStream = {
    id: 'ui-mixed-stream',
    getTracks: () => [mixedTrack],
    getAudioTracks: () => [mixedTrack],
    getVideoTracks: () => [],
  } as unknown as MediaStream;

  const closeSpy = vi.fn(() => {
    contextState = 'closed';
    return Promise.resolve();
  });

  const resumeSpy = vi.fn(() => {
    if (rejectNext) {
      rejectNext = false;
      return Promise.reject(new Error('Autoplay gesture missing'));
    }
    contextState = 'running';
    for (const listener of stateListeners) {
      listener();
    }
    return Promise.resolve();
  });

  const ctx: MixerAudioContextLike = {
    get state() {
      return contextState;
    },
    destination: { id: 'speakers' },
    createGain: () => {
      gainIndex += 1;
      const param =
        gainIndex === 1
          ? sourceGainParam
          : gainIndex === 2
            ? micGainParam
            : { value: 1 };
      return {
        gain: param,
        connect: vi.fn(),
        disconnect: vi.fn(),
      };
    },
    createAnalyser: () => ({
      fftSize: 256,
      smoothingTimeConstant: 0.5,
      connect: vi.fn(),
      disconnect: vi.fn(),
      getFloatTimeDomainData: (arr: Float32Array<ArrayBuffer>) => {
        arr.fill(0.25);
      },
    }),
    createMediaElementSource: createMediaElementSourceSpy,
    createMediaStreamSource: createMediaStreamSourceSpy,
    createMediaStreamDestination: () => ({
      stream: mixedStream,
      disconnect: vi.fn(),
    }),
    resume: resumeSpy,
    close: closeSpy,
    addEventListener: (_t, cb) => {
      stateListeners.add(cb);
    },
    removeEventListener: (_t, cb) => {
      stateListeners.delete(cb);
    },
  };

  const createAudioContextSpy = vi.fn(() => ctx);

  const audioMixer = new BrowserAudioMixer({
    createAudioContext: createAudioContextSpy,
    scheduler: {
      requestFrame: () => 1,
      cancelFrame: () => undefined,
      now: () => 1000,
    },
  });

  const micStopSpy = vi.fn();
  const micTrack = {
    id: 'ui-mic-track',
    kind: 'audio',
    label: 'Podcast Dynamic Mic',
    readyState: 'live' as MediaStreamTrackState,
    enabled: true,
    muted: false,
    stop: micStopSpy,
    getSettings: () => ({ deviceId: 'mic-dyn' }),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  } as unknown as MediaStreamTrack;

  const micStream = {
    id: 'ui-mic-stream',
    getTracks: () => [micTrack],
    getAudioTracks: () => [micTrack],
    getVideoTracks: () => [],
  } as unknown as MediaStream;

  const captureManager = new BrowserCaptureManager({
    mediaDevices: {
      getUserMedia: vi.fn(() => Promise.resolve(micStream)),
      enumerateDevices: vi.fn(() => Promise.resolve([])),
    },
  });

  return {
    audioMixer,
    captureManager,
    createAudioContextSpy,
    createMediaElementSourceSpy,
    resumeSpy,
    closeSpy,
    micStopSpy,
    sourceGainParam,
    micGainParam,
  };
}

function simulateLoadedMetadata(
  video: HTMLVideoElement,
  options?: { mozHasAudio?: boolean },
) {
  Object.defineProperty(video, 'duration', {
    configurable: true,
    get: () => 60,
  });
  Object.defineProperty(video, 'videoWidth', {
    configurable: true,
    get: () => 1280,
  });
  Object.defineProperty(video, 'videoHeight', {
    configurable: true,
    get: () => 720,
  });
  if (options?.mozHasAudio !== undefined) {
    Object.defineProperty(video, 'mozHasAudio', {
      configurable: true,
      get: () => options.mozHasAudio,
    });
  }
  fireEvent.loadedMetadata(video);
}

describe('AudioMixerPanel UI, Volume Unification & StrictMode Lifecycles', () => {
  it('unifies PlaybackControls volume/mute with AudioMixer 0–200% source gain without double-attenuating <video>, and cleans up safely under StrictMode', async () => {
    const user = userEvent.setup();
    const harness = createUiMixerHarness();

    const { unmount } = render(
      <StrictMode>
        <App
          captureManager={harness.captureManager}
          audioMixer={harness.audioMixer}
        />
      </StrictMode>,
    );

    // 1. Standby on initial page load with zero AudioContext creations
    expect(harness.createAudioContextSpy).not.toHaveBeenCalled();
    expect(screen.getByTestId('mixer-status-badge')).toHaveTextContent(
      'Standby',
    );
    expect(screen.getByTestId('mixer-mode-badge')).toHaveTextContent(
      'Silent Mix',
    );

    // 2. Load local video -> binds MediaElementAudioSourceNode ONCE even in StrictMode
    await user.upload(
      screen.getByTestId('source-file-input'),
      new File(['video-bytes'], 'walkthrough.webm', { type: 'video/webm' }),
    );
    const videoEl = screen.getByTestId<HTMLVideoElement>('source-video-element');
    simulateLoadedMetadata(videoEl);

    expect(harness.createAudioContextSpy).toHaveBeenCalledTimes(1);
    expect(harness.createMediaElementSourceSpy).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId('mixer-status-badge')).toHaveTextContent(
      'Audio Live',
    );
    expect(screen.getByTestId('mixer-mode-badge')).toHaveTextContent(
      'Video Only',
    );
    expect(screen.getByTestId('mixer-output-tracks-badge')).toHaveTextContent(
      '1 Mix Track',
    );
    expect(screen.getByTestId('mixer-source-name')).toHaveTextContent(
      'walkthrough.webm',
    );

    // 3. Adjust PlaybackControls volume slider to 40% -> syncs Mixer slider AND keeps <video>.volume at unity (1.0)!
    fireEvent.change(screen.getByTestId('volume-slider'), {
      target: { value: '0.4' },
    });
    expect(screen.getByTestId('volume-display')).toHaveTextContent('40%');
    expect(screen.getByTestId('mixer-source-gain-value')).toHaveTextContent(
      '40%',
    );
    expect(harness.sourceGainParam.value).toBeCloseTo(0.4, 2);
    expect(videoEl.volume).toBe(1);
    expect(videoEl.muted).toBe(false);

    // 4. Adjust Mixer Video Audio gain slider to 165% -> syncs PlaybackControls volume readout!
    fireEvent.change(screen.getByTestId('mixer-source-gain-slider'), {
      target: { value: '1.65' },
    });
    expect(screen.getByTestId('mixer-source-gain-value')).toHaveTextContent(
      '165%',
    );
    expect(screen.getByTestId('volume-display')).toHaveTextContent('165%');
    expect(harness.sourceGainParam.value).toBeCloseTo(1.65, 2);
    expect(videoEl.volume).toBe(1);

    // Reset back to 100% unity via quick button
    await user.click(screen.getByTestId('mixer-source-unity-button'));
    expect(screen.getByTestId('mixer-source-gain-value')).toHaveTextContent(
      '100%',
    );
    expect(screen.getByTestId('volume-display')).toHaveTextContent('100%');

    // 5. Mute toggle in AudioMixerPanel syncs PlaybackControls mute state
    await user.click(screen.getByTestId('mixer-source-mute-button'));
    expect(screen.getByTestId('mixer-source-gain-value')).toHaveTextContent(
      'Muted',
    );
    expect(screen.getByTestId('volume-display')).toHaveTextContent('Muted');
    expect(harness.sourceGainParam.value).toBe(0);
    expect(videoEl.muted).toBe(false); // Unity pass-through preserved on <video>

    await user.click(screen.getByTestId('mute-toggle-button'));
    expect(screen.getByTestId('mixer-source-gain-value')).toHaveTextContent(
      '100%',
    );

    // 6. Start Microphone -> switches to Combined Mix with independent 0–200% mic gain
    await user.click(screen.getByTestId('microphone-toggle-button'));
    expect(screen.getByTestId('mixer-mode-badge')).toHaveTextContent(
      'Combined Mix',
    );
    expect(screen.getByTestId('mixer-mic-name')).toHaveTextContent(
      'Podcast Dynamic Mic',
    );

    fireEvent.change(screen.getByTestId('mixer-mic-gain-slider'), {
      target: { value: '1.8' },
    });
    expect(screen.getByTestId('mixer-mic-gain-value')).toHaveTextContent('180%');
    expect(harness.micGainParam.value).toBeCloseTo(1.8, 2);

    // 7. Unmount closes mixer AudioContext once and CaptureManager stops owned mic track once
    unmount();
    expect(harness.closeSpy).toHaveBeenCalledTimes(1);
    expect(harness.micStopSpy).toHaveBeenCalledTimes(1);
  });

  it('shows explicit Enable Audio button when suspended by browser autoplay policy and handles silent-track videos', async () => {
    const user = userEvent.setup();
    const harness = createUiMixerHarness({
      initialContextState: 'suspended',
      rejectFirstResume: true,
    });

    render(
      <StrictMode>
        <App
          captureManager={harness.captureManager}
          audioMixer={harness.audioMixer}
        />
      </StrictMode>,
    );

    // Load a silent screen-recording video (mozHasAudio = false)
    await user.upload(
      screen.getByTestId('source-file-input'),
      new File(['silent-video'], 'screen-capture.webm', { type: 'video/webm' }),
    );
    const videoEl = screen.getByTestId<HTMLVideoElement>('source-video-element');
    simulateLoadedMetadata(videoEl, { mozHasAudio: false });

    expect(screen.getByTestId('mixer-source-availability')).toHaveTextContent(
      'No Audio Track',
    );
    expect(screen.getByTestId('mixer-status-badge')).toHaveTextContent(
      'Audio Suspended',
    );
    expect(screen.getByTestId('enable-audio-button')).toBeInTheDocument();

    // First Enable Audio click rejects -> displays accessible CONTEXT_RESUME_FAILED alert while keeping Enable Audio available
    await user.click(screen.getByTestId('enable-audio-button'));
    expect(screen.getByTestId('mixer-error-alert')).toHaveTextContent(
      'CONTEXT_RESUME_FAILED',
    );
    expect(screen.getByTestId('mixer-status-badge')).toHaveTextContent(
      'Audio Suspended',
    );

    // Second Enable Audio click succeeds -> clears error and transitions to Audio Live
    await user.click(screen.getByTestId('enable-audio-button'));
    expect(screen.getByTestId('mixer-status-badge')).toHaveTextContent(
      'Audio Live',
    );
    expect(
      screen.queryByTestId('enable-audio-button'),
    ).not.toBeInTheDocument();
    expect(screen.queryByTestId('mixer-error-alert')).not.toBeInTheDocument();
  });
});

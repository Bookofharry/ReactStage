import { StrictMode } from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { App } from '../../src/App';
import { BrowserCaptureManager } from '../../src/services/capture-manager';
import { CanvasSceneCompositor } from '../../src/services/scene-compositor';

function createUiTestHarness() {
  const camStopSpy = vi.fn();
  const camTrack = {
    id: 'cam-ui-1',
    kind: 'video',
    label: 'Creator Studio Webcam',
    readyState: 'live' as MediaStreamTrackState,
    enabled: true,
    stop: camStopSpy,
    getSettings: () => ({ deviceId: 'cam-1', width: 1280, height: 720 }),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  } as unknown as MediaStreamTrack;

  const camStream = {
    id: 'stream-ui-1',
    getTracks: () => [camTrack],
    getVideoTracks: () => [camTrack],
    getAudioTracks: () => [],
  } as unknown as MediaStream;

  const captureManager = new BrowserCaptureManager({
    mediaDevices: {
      getUserMedia: vi.fn(() => Promise.resolve(camStream)),
      enumerateDevices: vi.fn(() => Promise.resolve([])),
    },
  });

  const internalCameraVideo = document.createElement('video');
  Object.defineProperty(internalCameraVideo, 'videoWidth', {
    configurable: true,
    get: () => 1280,
  });
  Object.defineProperty(internalCameraVideo, 'videoHeight', {
    configurable: true,
    get: () => 720,
  });
  Object.defineProperty(internalCameraVideo, 'readyState', {
    configurable: true,
    get: () => 4,
  });

  let pendingHandle: number | null = null;
  const compositor = new CanvasSceneCompositor({
    createVideoElement: () => internalCameraVideo,
    scheduler: {
      requestFrame: (cb) => {
        const handle = Number(setTimeout(() => cb(1034), 34));
        pendingHandle = handle;
        return handle;
      },
      cancelFrame: (id) => {
        if (pendingHandle === id) {
          pendingHandle = null;
        }
        clearTimeout(id);
      },
      now: () => 1000,
    },
  });

  return {
    captureManager,
    compositor,
    camStopSpy,
    internalCameraVideo,
    hasPendingFrame: () => pendingHandle !== null,
  };
}

function simulateLoadedVideo(video: HTMLVideoElement) {
  Object.defineProperty(video, 'duration', {
    configurable: true,
    get: () => 120,
  });
  Object.defineProperty(video, 'videoWidth', {
    configurable: true,
    get: () => 1920,
  });
  Object.defineProperty(video, 'videoHeight', {
    configurable: true,
    get: () => 1080,
  });
  Object.defineProperty(video, 'readyState', {
    configurable: true,
    get: () => 4,
  });
  fireEvent.loadedMetadata(video);
}

describe('SceneStagePanel UI, Accessibility Controls & StrictMode Lifecycle', () => {
  it('supports layout switching, 720p/1080p resolution selection, keyboard & pointer PIP controls, and split ratio constraints', async () => {
    const user = userEvent.setup();
    const harness = createUiTestHarness();

    render(
      <StrictMode>
        <App
          captureManager={harness.captureManager}
          compositor={harness.compositor}
        />
      </StrictMode>,
    );

    const canvas = screen.getByTestId<HTMLCanvasElement>(
      'scene-compositor-canvas',
    );
    expect(canvas.width).toBe(1280);
    expect(canvas.height).toBe(720);
    expect(screen.getByTestId('scene-status-badge')).toHaveTextContent(
      'Scene Live',
    );

    // Load a local video so stage exits initial empty prompt and reveals interactive PIP handles
    await user.upload(
      screen.getByTestId('source-file-input'),
      new File(['video-bytes'], 'lesson.webm', { type: 'video/webm' }),
    );
    simulateLoadedVideo(
      screen.getByTestId<HTMLVideoElement>('source-video-element'),
    );

    // 1. Resolution switching updates canvas output dimensions truthfully
    await user.selectOptions(
      screen.getByTestId('scene-resolution-select'),
      '1080p',
    );
    expect(canvas.width).toBe(1920);
    expect(canvas.height).toBe(1080);
    expect(screen.getByTestId('scene-dimensions-badge')).toHaveTextContent(
      '1920×1080',
    );

    // 2. Keyboard PIP move & resize interactions
    const dragHandle = screen.getByTestId('pip-drag-handle');
    dragHandle.focus();
    fireEvent.keyDown(dragHandle, { key: 'ArrowLeft', shiftKey: true });
    expect(harness.compositor.getState().pipRect.x).toBeCloseTo(0.64, 2);

    fireEvent.keyDown(dragHandle, { key: 'Home' });
    expect(harness.compositor.getState().pipRect.x).toBeCloseTo(0.03, 2);
    expect(harness.compositor.getState().pipRect.y).toBeCloseTo(0.03, 2);

    const resizeHandle = screen.getByTestId('pip-resize-handle');
    resizeHandle.focus();
    fireEvent.keyDown(resizeHandle, { key: 'ArrowRight', shiftKey: true });
    expect(harness.compositor.getState().pipRect.width).toBeCloseTo(0.33, 2);

    // 3. Pointer drag gesture on PIP handle updates normalized coordinates & stays inside bounds
    const stageDropzone = screen.getByTestId('source-dropzone');
    vi.spyOn(stageDropzone, 'getBoundingClientRect').mockReturnValue({
      x: 0,
      y: 0,
      top: 0,
      left: 0,
      right: 1000,
      bottom: 562.5,
      width: 1000,
      height: 562.5,
      toJSON: () => ({}),
    });

    fireEvent.pointerDown(dragHandle, {
      pointerId: 1,
      button: 0,
      pointerType: 'mouse',
      clientX: 100,
      clientY: 100,
    });
    fireEvent.pointerMove(window, {
      pointerId: 1,
      clientX: 350, // +0.25 normalized X
      clientY: 212.5, // +0.20 normalized Y
    });
    fireEvent.pointerUp(window, { pointerId: 1 });

    expect(harness.compositor.getState().pipRect.x).toBeCloseTo(0.28, 2);
    expect(harness.compositor.getState().pipRect.y).toBeCloseTo(0.23, 2);

    // Open layout customization bar, then Reset PIP restores default bottom-right bounds
    await user.click(screen.getByTestId('toggle-layout-customize-button'));
    await user.click(screen.getByTestId('pip-reset-button'));
    expect(harness.compositor.getState().pipRect.x).toBe(0.69);
    expect(harness.compositor.getState().pipRect.width).toBe(0.28);

    // 4. Switch across Side-by-Side, Webcam Only, and Source Only modes
    await user.click(screen.getByTestId('layout-mode-side-by-side'));
    expect(harness.compositor.getState().layoutMode).toBe('side-by-side');

    const splitSlider = screen.getByTestId('split-ratio-slider');
    fireEvent.change(splitSlider, { target: { value: '0.65' } });
    expect(screen.getByTestId('split-ratio-readout')).toHaveTextContent(
      '65% Source / 35% Webcam',
    );

    await user.click(screen.getByTestId('reset-split-button'));
    expect(screen.getByTestId('split-ratio-readout')).toHaveTextContent(
      '50% Source / 50% Webcam',
    );

    await user.click(screen.getByTestId('layout-mode-camera-only'));
    expect(harness.compositor.getState().layoutMode).toBe('camera-only');

    await user.click(screen.getByTestId('layout-mode-source-only'));
    expect(harness.compositor.getState().layoutMode).toBe('source-only');
  });

  it('keeps source play/pause and scene-render-loop start/stop distinct, leaves canvas unflipped on preview mirror, and cleans up on unmount', async () => {
    const user = userEvent.setup();
    const harness = createUiTestHarness();

    const { unmount } = render(
      <StrictMode>
        <App
          captureManager={harness.captureManager}
          compositor={harness.compositor}
        />
      </StrictMode>,
    );

    // Start camera & load source video
    await user.click(screen.getByTestId('camera-toggle-button'));
    await user.upload(
      screen.getByTestId('source-file-input'),
      new File(['video-bytes'], 'demo.webm', { type: 'video/webm' }),
    );
    const sourceVideo = screen.getByTestId<HTMLVideoElement>(
      'source-video-element',
    );
    simulateLoadedVideo(sourceVideo);

    // Play then pause source video -> scene compositor loop MUST stay running
    await user.click(screen.getByTestId('play-pause-button'));
    await user.click(screen.getByTestId('play-pause-button'));
    expect(harness.compositor.getState().isRunning).toBe(true);
    expect(screen.getByTestId('scene-status-badge')).toHaveTextContent(
      'Scene Live',
    );

    // Pause scene render loop -> camera capture stays Live and source playback is unaffected
    await user.click(screen.getByTestId('scene-loop-toggle-button'));
    expect(harness.compositor.getState().isRunning).toBe(false);
    expect(screen.getByTestId('scene-status-badge')).toHaveTextContent(
      'Scene Paused',
    );
    expect(screen.getByTestId('camera-status-badge')).toHaveTextContent('Live');
    expect(harness.camStopSpy).not.toHaveBeenCalled();

    // Resume scene render loop
    await user.click(screen.getByTestId('scene-loop-toggle-button'));
    expect(harness.compositor.getState().isRunning).toBe(true);

    // Preview mirror toggles CSS on self-check thumbnail ONLY; compositor's internal video stays unflipped
    const previewThumb = screen.getByTestId('webcam-preview-video');
    expect(previewThumb.className).toContain('-scale-x-100');
    expect(harness.internalCameraVideo.className).toBe('');
    expect(harness.internalCameraVideo.style.transform).toBe('');

    // Unmount stops scene loop cleanly and CaptureProvider stops owned hardware tracks
    unmount();
    expect(harness.compositor.getState().isRunning).toBe(false);
    expect(harness.hasPendingFrame()).toBe(false);
    expect(harness.camStopSpy).toHaveBeenCalledTimes(1);
  });
});

import { StrictMode } from 'react';
import { act, fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { App } from '../../src/App';
import {
  BrowserRecordingEngine,
  type MediaRecorderLike,
} from '../../src/services/recording-engine';

function simulateMetadataLoaded(
  video: HTMLVideoElement,
  duration = 60,
  width = 1280,
  height = 720,
) {
  Object.defineProperty(video, 'duration', {
    configurable: true,
    get: () => duration,
  });
  Object.defineProperty(video, 'videoWidth', {
    configurable: true,
    get: () => width,
  });
  Object.defineProperty(video, 'videoHeight', {
    configurable: true,
    get: () => height,
  });
  fireEvent.loadedMetadata(video);
}

describe('RecordingSessionPanel UI, Source Independence & StrictMode Lifecycle', () => {
  it('records scene + audio on an independent session clock while source video pauses, seeks, changes speed, replaces, and unloads', async () => {
    let fakeNowMs = 10_000;
    let activeRecorder: {
      emitChunk: (size: number) => void;
    } | null = null;
    let canvasVideoStopCount = 0;

    Object.defineProperty(HTMLCanvasElement.prototype, 'captureStream', {
      configurable: true,
      writable: true,
      value: vi.fn(() => {
        let trackState: MediaStreamTrackState = 'live';
        const videoTrack = {
          id: 'canvas-video-1',
          kind: 'video',
          get readyState() {
            return trackState;
          },
          stop: () => {
            canvasVideoStopCount += 1;
            trackState = 'ended';
          },
          getSettings: () => ({ width: 1280, height: 720, frameRate: 30 }),
          addEventListener: vi.fn(),
          removeEventListener: vi.fn(),
        } as unknown as MediaStreamTrack;
        return {
          id: 'canvas-stream',
          active: true,
          getTracks: () => [videoTrack],
          getVideoTracks: () => [videoTrack],
          getAudioTracks: () => [],
        } as unknown as MediaStream;
      }),
    });

    const engine = new BrowserRecordingEngine({
      now: () => fakeNowMs,
      clockIntervalMs: 50_000,
      isTypeSupported: (mime) => mime === 'video/webm;codecs=vp9,opus' || mime === 'video/webm;codecs=vp9',
      mediaRecorderFactory: (_stream, options) => {
        let recState: RecordingState = 'inactive';
        const rec: MediaRecorderLike & { emitChunk: (size: number) => void } = {
          get state() {
            return recState;
          },
          mimeType: options.mimeType ?? 'video/webm;codecs=vp9',
          ondataavailable: null,
          onstop: null,
          onerror: null,
          start() {
            recState = 'recording';
          },
          pause() {
            recState = 'paused';
          },
          resume() {
            recState = 'recording';
          },
          requestData() {
            // no-op
          },
          stop() {
            recState = 'inactive';
            this.emitChunk(512);
            queueMicrotask(() => {
              this.onstop?.(new Event('stop'));
            });
          },
          emitChunk(size: number) {
            const blob = new Blob([new Uint8Array(size)], {
              type: this.mimeType,
            });
            this.ondataavailable?.({ data: blob } as unknown as BlobEvent);
          },
        };
        activeRecorder = rec;
        return rec;
      },
    });

    const user = userEvent.setup();
    const { unmount } = render(
      <StrictMode>
        <App recordingEngine={engine} />
      </StrictMode>,
    );

    // Zero MediaRecorder or captureStream calls on initial mount
    expect(activeRecorder).toBeNull();
    expect(screen.getByTestId('recording-status-badge')).toHaveTextContent(
      'Ready',
    );
    expect(screen.getByTestId('recording-session-time')).toHaveTextContent(
      '00:00.0',
    );

    // Load local source video
    const fileInput = screen.getByTestId('source-file-input');
    await user.upload(
      fileInput,
      new File(['clip-1'], 'lesson-part1.webm', { type: 'video/webm' }),
    );
    const videoEl = screen.getByTestId<HTMLVideoElement>('source-video-element');
    simulateMetadataLoaded(videoEl, 120, 1280, 720);

    // Start Recording from explicit user gesture
    await user.click(screen.getByTestId('start-recording-button'));
    expect(screen.getByTestId('recording-status-badge')).toHaveTextContent(
      'Recording',
    );
    expect(screen.getByTestId('header-recording-status')).toHaveTextContent(
      'REC',
    );

    // Advance session clock to 3.4s while emitting data
    act(() => {
      fakeNowMs += 3_400;
      activeRecorder?.emitChunk(2_048);
    });

    expect(screen.getByTestId('recording-session-time')).toHaveTextContent(
      '00:03.4',
    );
    expect(screen.getByTestId('header-recording-time')).toHaveTextContent(
      '00:03.4',
    );
    expect(screen.getByTestId('transport-recording-time')).toHaveTextContent(
      '00:03.4',
    );
    expect(screen.getByTestId('recording-bytes-readout')).toHaveTextContent(
      '2.0 KB',
    );

    // Seek, pause, change speed, replace, and unload source video -> recording session MUST continue uninterrupted!
    fireEvent.change(screen.getByTestId('seek-slider'), {
      target: { value: '45.0' },
    });
    expect(screen.getByTestId('source-playback-time')).toHaveTextContent(
      '00:45.0 / 02:00.0',
    );
    expect(screen.getByTestId('recording-session-time')).toHaveTextContent(
      '00:03.4',
    );

    await user.click(screen.getByTestId('unload-video-button'));
    expect(screen.getByTestId('recording-status-badge')).toHaveTextContent(
      'Recording',
    );

    // Pause recording -> clock freezes -> Resume -> Stop & Finalize
    await user.click(screen.getByTestId('pause-resume-recording-button'));
    expect(screen.getByTestId('recording-status-badge')).toHaveTextContent(
      'Paused',
    );
    act(() => {
      fakeNowMs += 9_000;
    });

    await user.click(screen.getByTestId('pause-resume-recording-button'));
    expect(screen.getByTestId('recording-status-badge')).toHaveTextContent(
      'Recording',
    );
    act(() => {
      fakeNowMs += 1_600;
    });

    await user.click(screen.getByTestId('stop-recording-button'));
    expect(screen.getByTestId('recording-status-badge')).toHaveTextContent(
      'Take Ready',
    );
    expect(screen.getByTestId('recorded-artifact-summary')).toBeInTheDocument();
    expect(screen.getByTestId('recorded-artifact-duration')).toHaveTextContent(
      '00:05.0',
    );
    expect(canvasVideoStopCount).toBe(1);

    // Finalized take automatically populates ExportPanel preview & download controls
    expect(screen.getByTestId('export-preview-video')).toBeInTheDocument();
    expect(screen.getByTestId('download-export-button')).toBeEnabled();

    // Discard take resets cleanly to Ready / 00:00.0 and clears ExportPanel preview
    await user.click(screen.getByTestId('discard-recording-button'));
    expect(screen.getByTestId('recording-status-badge')).toHaveTextContent(
      'Ready',
    );
    expect(
      screen.queryByTestId('recorded-artifact-summary'),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByTestId('export-preview-video'),
    ).not.toBeInTheDocument();

    unmount();
  });
});

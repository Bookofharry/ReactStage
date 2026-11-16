import { StrictMode } from 'react';
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { App } from '../../src/App';
import { BrowserExportManager } from '../../src/services/export-manager';
import {
  BrowserRecordingEngine,
  type MediaRecorderLike,
} from '../../src/services/recording-engine';

function installMockCanvasCaptureStream() {
  Object.defineProperty(HTMLCanvasElement.prototype, 'captureStream', {
    configurable: true,
    writable: true,
    value: vi.fn(() => {
      let trackState: MediaStreamTrackState = 'live';
      const videoTrack = {
        id: 'canvas-video-polish',
        kind: 'video',
        get readyState() {
          return trackState;
        },
        stop: () => {
          trackState = 'ended';
        },
        getSettings: () => ({ width: 1280, height: 720, frameRate: 30 }),
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
      } as unknown as MediaStreamTrack;
      return {
        id: 'canvas-polish-stream',
        active: true,
        getTracks: () => [videoTrack],
        getVideoTracks: () => [videoTrack],
        getAudioTracks: () => [],
      } as unknown as MediaStream;
    }),
  });
}

function createDeterministicRecordingEngine(getNowMs: () => number) {
  return new BrowserRecordingEngine({
    now: getNowMs,
    clockIntervalMs: 50_000,
    isTypeSupported: (mime) => mime === 'video/webm;codecs=vp9',
    mediaRecorderFactory: (_stream, options) => {
      let recState: RecordingState = 'inactive';
      const rec: MediaRecorderLike = {
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
          const blob = new Blob([new Uint8Array(768)], {
            type: this.mimeType,
          });
          this.ondataavailable?.({ data: blob } as unknown as BlobEvent);
          queueMicrotask(() => {
            this.onstop?.(new Event('stop'));
          });
        },
      };
      return rec;
    },
  });
}

describe('Task 7 Studio Polish: Pre-Roll Countdown, Global Shortcuts & Multi-Take Session Drawer', () => {
  it('runs 3-2-1 pre-roll countdown with skip & Escape cancel without starting MediaRecorder prematurely', async () => {
    installMockCanvasCaptureStream();
    const fakeNowMs = 1_000;
    const recordingEngine = createDeterministicRecordingEngine(() => fakeNowMs);

    const user = userEvent.setup();
    render(
      <StrictMode>
        <App recordingEngine={recordingEngine} countdownStepMs={35} />
      </StrictMode>,
    );

    // Toggle 3s Pre-Roll ON inside Settings & Tools modal
    await user.click(screen.getByTestId('open-settings-modal-button'));
    const preRollToggle = screen.getByTestId('preroll-countdown-toggle');
    expect(preRollToggle).toHaveAttribute('aria-pressed', 'false');
    await user.click(preRollToggle);
    expect(preRollToggle).toHaveAttribute('aria-pressed', 'true');
    await user.click(screen.getByTestId('close-settings-modal-button'));

    // Start countdown -> Escape cancels before MediaRecorder starts
    await user.click(screen.getByTestId('start-recording-button'));
    expect(screen.getByTestId('preroll-stage-overlay')).toBeInTheDocument();
    expect(recordingEngine.getState().status).toBe('idle');

    fireEvent.keyDown(window, { key: 'Escape' });
    expect(
      screen.queryByTestId('preroll-stage-overlay'),
    ).not.toBeInTheDocument();
    expect(recordingEngine.getState().status).toBe('idle');

    // Start countdown again -> let 3-2-1 complete automatically into 'recording'
    await user.click(screen.getByTestId('start-recording-button'));
    expect(screen.getByTestId('preroll-stage-overlay')).toBeInTheDocument();

    await waitFor(
      () => {
        expect(recordingEngine.getState().status).toBe('recording');
      },
      { timeout: 1000 },
    );
    expect(
      screen.queryByTestId('preroll-stage-overlay'),
    ).not.toBeInTheDocument();

    await user.click(screen.getByTestId('stop-recording-button'));
    expect(recordingEngine.getState().status).toBe('completed');

    // Start countdown a third time -> click Start Now to skip immediately
    await user.click(screen.getByTestId('start-recording-button'));
    expect(screen.getByTestId('preroll-stage-overlay')).toBeInTheDocument();
    await user.click(screen.getByTestId('skip-countdown-button'));
    expect(recordingEngine.getState().status).toBe('recording');
    await user.click(screen.getByTestId('cancel-recording-button'));
  });

  it('supports global keyboard shortcuts, ignores form inputs, and honors WCAG 2.1.4 shortcut disable toggle', async () => {
    installMockCanvasCaptureStream();
    let fakeNowMs = 2_000;
    const recordingEngine = createDeterministicRecordingEngine(() => fakeNowMs);

    const user = userEvent.setup();
    render(
      <StrictMode>
        <App recordingEngine={recordingEngine} countdownStepMs={30} />
      </StrictMode>,
    );

    // Layout keys 2 -> side-by-side, 3 -> source-only, 4 -> camera-only, 1 -> pip
    fireEvent.keyDown(window, { key: '2' });
    expect(screen.getByTestId('layout-mode-side-by-side')).toHaveAttribute(
      'aria-pressed',
      'true',
    );

    fireEvent.keyDown(window, { key: '3' });
    await user.click(screen.getByTestId('open-settings-modal-button'));
    expect(screen.getByTestId('layout-mode-source-only')).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    await user.click(screen.getByTestId('close-settings-modal-button'));

    fireEvent.keyDown(window, { key: '1' });
    expect(screen.getByTestId('layout-mode-pip')).toHaveAttribute(
      'aria-pressed',
      'true',
    );

    // V toggles video mute, M toggles microphone mute
    fireEvent.keyDown(window, { key: 'v' });
    expect(screen.getByTestId('mixer-source-mute-button')).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    fireEvent.keyDown(window, { key: 'm' });
    expect(screen.getByTestId('mixer-mic-mute-button')).toHaveAttribute(
      'aria-pressed',
      'true',
    );

    // R starts recording, P pauses/resumes recording, R stops & finalizes
    fireEvent.keyDown(window, { key: 'r' });
    await waitFor(() => {
      expect(recordingEngine.getState().status).toBe('recording');
    });

    act(() => {
      fakeNowMs += 1_200;
    });
    fireEvent.keyDown(window, { key: 'p' });
    expect(recordingEngine.getState().status).toBe('paused');
    fireEvent.keyDown(window, { key: 'p' });
    expect(recordingEngine.getState().status).toBe('recording');

    fireEvent.keyDown(window, { key: 'r' });
    await waitFor(() => {
      expect(recordingEngine.getState().status).toBe('completed');
    });

    // Typing shortcut characters inside <input data-testid="export-filename-input"> must NOT trigger studio actions!
    const filenameInput = screen.getByTestId<HTMLInputElement>(
      'export-filename-input',
    );
    filenameInput.focus();
    await user.clear(filenameInput);
    await user.type(filenameInput, 'r234mvkp');
    expect(recordingEngine.getState().status).toBe('completed');
    expect(screen.getByTestId('layout-mode-pip')).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    filenameInput.blur();

    // '?' opens KeyboardShortcutsModal -> toggle WCAG 2.1.4 off -> Escape closes
    fireEvent.keyDown(window, { key: '?' });
    expect(screen.getByTestId('keyboard-shortcuts-modal')).toBeInTheDocument();

    const toggleShortcutsBtn = screen.getByTestId(
      'toggle-global-shortcuts-button',
    );
    expect(toggleShortcutsBtn).toHaveAttribute('aria-pressed', 'true');
    await user.click(toggleShortcutsBtn);
    expect(toggleShortcutsBtn).toHaveAttribute('aria-pressed', 'false');

    fireEvent.keyDown(window, { key: 'Escape' });
    expect(
      screen.queryByTestId('keyboard-shortcuts-modal'),
    ).not.toBeInTheDocument();

    // With single-key shortcuts disabled, '2' and 'r' do not fire
    fireEvent.keyDown(window, { key: '2' });
    expect(screen.getByTestId('layout-mode-pip')).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    fireEvent.keyDown(window, { key: 'r' });
    expect(recordingEngine.getState().status).toBe('completed');
  });

  it('maintains multi-take session history, preserves per-take custom filenames, and holds at most 1 preview Object URL', async () => {
    installMockCanvasCaptureStream();
    let fakeNowMs = 10_000;
    const recordingEngine = createDeterministicRecordingEngine(() => fakeNowMs);

    let urlSeq = 0;
    const exportManager = new BrowserExportManager({
      clock: () => new Date(2026, 10, 14, 15, 0, 0),
      urlAdapter: {
        createObjectURL: () => {
          urlSeq += 1;
          return `blob:multi-take/${String(urlSeq)}`;
        },
        revokeObjectURL: vi.fn(),
      },
      downloadTrigger: vi.fn(),
    });

    const user = userEvent.setup();
    const { unmount } = render(
      <StrictMode>
        <App recordingEngine={recordingEngine} exportManager={exportManager} />
      </StrictMode>,
    );

    // Record Take #1 (2.0s)
    await user.click(screen.getByTestId('start-recording-button'));
    act(() => {
      fakeNowMs += 2_000;
    });
    await user.click(screen.getByTestId('stop-recording-button'));

    expect(screen.getByTestId('session-takes-count')).toHaveTextContent('1');
    const filenameInput = screen.getByTestId<HTMLInputElement>(
      'export-filename-input',
    );
    fireEvent.change(filenameInput, { target: { value: 'first-take-intro' } });
    expect(exportManager.getState().activeObjectUrlCount).toBe(1);

    // Record Take #2 (4.0s)
    await user.click(screen.getByTestId('start-recording-button'));
    act(() => {
      fakeNowMs += 4_000;
    });
    await user.click(screen.getByTestId('stop-recording-button'));

    expect(screen.getByTestId('session-takes-count')).toHaveTextContent('2');
    expect(screen.getByTestId('select-take-button-2')).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    // Still at most 1 active preview Object URL!
    expect(exportManager.getState().activeObjectUrlCount).toBe(1);

    // Switch back to Take #1 -> custom filename 'first-take-intro' is preserved!
    await user.click(screen.getByTestId('select-take-button-1'));
    expect(screen.getByTestId('select-take-button-1')).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    expect(
      screen.getByTestId<HTMLInputElement>('export-filename-input').value,
    ).toBe('first-take-intro');
    expect(exportManager.getState().activeObjectUrlCount).toBe(1);

    // Delete Take #1 -> falls back to Take #2
    await user.click(screen.getByTestId('delete-take-button-1'));
    expect(screen.getByTestId('session-takes-count')).toHaveTextContent('1');
    expect(screen.getByTestId('select-take-button-2')).toHaveAttribute(
      'aria-pressed',
      'true',
    );

    // Record Take #3, then Clear All Takes -> 0 active Object URLs
    await user.click(screen.getByTestId('start-recording-button'));
    act(() => {
      fakeNowMs += 1_500;
    });
    await user.click(screen.getByTestId('stop-recording-button'));
    expect(screen.getByTestId('session-takes-count')).toHaveTextContent('2');

    await user.click(screen.getByTestId('clear-all-takes-button'));
    expect(screen.getByTestId('export-empty-state')).toBeInTheDocument();
    expect(exportManager.getState().activeObjectUrlCount).toBe(0);

    unmount();
    expect(exportManager.getState().activeObjectUrlCount).toBe(0);
  });
});

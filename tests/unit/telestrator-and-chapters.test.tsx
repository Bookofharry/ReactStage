import { StrictMode } from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { App } from '../../src/App';
import {
  buildChaptersFileName,
  formatChapterTimestamp,
  formatYouTubeChapters,
} from '../../src/utils/chapters';

class StubChapterMediaRecorder {
  public static isTypeSupported(mimeType: string): boolean {
    return mimeType.includes('webm');
  }

  public state: RecordingState = 'inactive';
  public readonly mimeType: string;
  public ondataavailable: ((event: BlobEvent) => void) | null = null;
  public onstop: ((event: Event) => void) | null = null;
  public onerror: ((event: ErrorEvent) => void) | null = null;

  public constructor(_stream: MediaStream, options?: MediaRecorderOptions) {
    this.mimeType = options?.mimeType ?? 'video/webm;codecs=vp9,opus';
  }

  public start(): void {
    this.state = 'recording';
    const chunk = new Blob([new Uint8Array([0x1a, 0x45, 0xdf, 0xa3, 1, 2, 3])], {
      type: this.mimeType,
    });
    this.ondataavailable?.({ data: chunk } as BlobEvent);
  }

  public pause(): void {
    this.state = 'paused';
  }

  public resume(): void {
    this.state = 'recording';
  }

  public requestData(): void {
    if (this.state !== 'inactive') {
      const chunk = new Blob([new Uint8Array([4, 5, 6])], {
        type: this.mimeType,
      });
      this.ondataavailable?.({ data: chunk } as BlobEvent);
    }
  }

  public stop(): void {
    this.state = 'inactive';
    this.onstop?.(new Event('stop'));
  }
}

describe('Tasks 9 & 10: Stage Telestrator, PIP Framing & Recording Chapter Markers', () => {
  const originalMediaRecorder = globalThis.MediaRecorder;
  const originalCaptureStream = (
    HTMLCanvasElement.prototype as Partial<HTMLCanvasElement>
  ).captureStream;

  beforeEach(() => {
    Object.defineProperty(globalThis, 'MediaRecorder', {
      configurable: true,
      writable: true,
      value: StubChapterMediaRecorder,
    });

    Object.defineProperty(HTMLCanvasElement.prototype, 'captureStream', {
      configurable: true,
      writable: true,
      value: vi.fn(() => {
        const fakeTrack = {
          id: 'canvas-video-track-1',
          kind: 'video',
          enabled: true,
          readyState: 'live',
          stop: vi.fn(),
          getSettings: () => ({ width: 1280, height: 720, frameRate: 30 }),
          addEventListener: vi.fn(),
          removeEventListener: vi.fn(),
        } as unknown as MediaStreamTrack;
        return {
          id: 'canvas-stream-1',
          active: true,
          getTracks: () => [fakeTrack],
          getVideoTracks: () => [fakeTrack],
          getAudioTracks: () => [],
        } as unknown as MediaStream;
      }),
    });
  });

  afterEach(() => {
    Object.defineProperty(globalThis, 'MediaRecorder', {
      configurable: true,
      writable: true,
      value: originalMediaRecorder,
    });
    if (originalCaptureStream) {
      Object.defineProperty(HTMLCanvasElement.prototype, 'captureStream', {
        configurable: true,
        writable: true,
        value: originalCaptureStream,
      });
    } else {
      delete (HTMLCanvasElement.prototype as Partial<HTMLCanvasElement>)
        .captureStream;
    }
  });

  it('formats YouTube 00:00 chapter lists and companion filenames accurately', () => {
    expect(formatChapterTimestamp(0)).toBe('00:00');
    expect(formatChapterTimestamp(75_400)).toBe('01:15');
    expect(formatChapterTimestamp(3_661_000)).toBe('01:01:01');

    const chapters = formatYouTubeChapters([
      {
        id: 'm2',
        index: 2,
        label: 'Pause-to-explain trade-offs',
        elapsedRecordingMs: 42_000,
        sourceTimeSec: 18.5,
        layoutMode: 'pip',
      },
      {
        id: 'm1',
        index: 1,
        label: 'Opening Architecture Hook',
        elapsedRecordingMs: 12_000,
        sourceTimeSec: 5,
        layoutMode: 'side-by-side',
      },
    ]);

    expect(chapters).toBe(
      [
        '00:00 Intro',
        '00:12 Opening Architecture Hook (Source 00:05)',
        '00:42 Pause-to-explain trade-offs (Source 00:18)',
      ].join('\n'),
    );

    expect(buildChaptersFileName('demo-reaction-20261114.webm')).toBe(
      'demo-reaction-20261114-chapters.txt',
    );
  });

  it('supports Telestrator drawing, hotkeys (D/Z/C), and persists PIP Circle/Gold framing across remounts', async () => {
    const user = userEvent.setup();
    const firstMount = render(
      <StrictMode>
        <App />
      </StrictMode>,
    );

    // Toggle Pen tool with hotkey D
    fireEvent.keyDown(window, { key: 'd', code: 'KeyD' });
    expect(screen.getByTestId('telestrator-tool-pen')).toHaveAttribute(
      'aria-pressed',
      'true',
    );

    const canvas = screen.getByTestId('scene-compositor-canvas');
    fireEvent.pointerDown(canvas, {
      pointerId: 1,
      button: 0,
      clientX: 180,
      clientY: 140,
    });
    fireEvent.pointerMove(canvas, {
      pointerId: 1,
      clientX: 340,
      clientY: 220,
    });
    fireEvent.pointerUp(canvas, {
      pointerId: 1,
      clientX: 340,
      clientY: 220,
    });

    expect(screen.getByTestId('telestrator-clear-button')).toHaveTextContent(
      'Clear (1)',
    );

    // Draw a second Arrow annotation
    await user.click(screen.getByTestId('telestrator-tool-arrow'));
    fireEvent.pointerDown(canvas, {
      pointerId: 2,
      button: 0,
      clientX: 100,
      clientY: 100,
    });
    fireEvent.pointerUp(canvas, {
      pointerId: 2,
      clientX: 280,
      clientY: 260,
    });

    expect(screen.getByTestId('telestrator-clear-button')).toHaveTextContent(
      'Clear (2)',
    );

    // Undo via Ctrl+Z -> leaves 1 annotation, then C clears remaining
    fireEvent.keyDown(window, { key: 'z', code: 'KeyZ', ctrlKey: true });
    expect(screen.getByTestId('telestrator-clear-button')).toHaveTextContent(
      'Clear (1)',
    );

    fireEvent.keyDown(window, { key: 'c', code: 'KeyC' });
    expect(screen.getByTestId('telestrator-clear-button')).toBeDisabled();

    // Select Circle PIP shape + Gold Border and verify persistence across remount
    await user.click(screen.getByTestId('toggle-layout-customize-button'));
    await user.click(screen.getByTestId('pip-shape-circle'));
    await user.selectOptions(screen.getByTestId('pip-border-select'), 'amber');

    firstMount.unmount();

    render(
      <StrictMode>
        <App />
      </StrictMode>,
    );

    await user.click(screen.getByTestId('toggle-layout-customize-button'));
    await waitFor(() => {
      expect(screen.getByTestId('pip-shape-circle')).toHaveAttribute(
        'aria-pressed',
        'true',
      );
    });
    expect(screen.getByTestId('pip-border-select')).toHaveValue('amber');
  });

  it('records live chapter markers via form and hotkey B, seeks preview video, and exports YouTube chapters', async () => {
    const user = userEvent.setup();
    render(
      <StrictMode>
        <App />
      </StrictMode>,
    );

    await user.click(screen.getByTestId('start-recording-button'));
    expect(screen.getByTestId('live-chapter-markers-bar')).toBeInTheDocument();
    expect(screen.getByTestId('live-markers-count')).toHaveTextContent('0');

    // Add first marker with custom title
    const markerInput = screen.getByTestId('chapter-marker-label-input');
    await user.type(markerInput, 'State Topology Breakdown');
    await user.click(screen.getByTestId('add-chapter-marker-button'));

    expect(screen.getByTestId('live-markers-count')).toHaveTextContent('1');
    expect(screen.getByTestId('latest-marker-badge')).toHaveTextContent(
      'State Topology Breakdown',
    );

    // Blur input and drop second marker via hotkey B
    markerInput.blur();
    fireEvent.keyDown(window, { key: 'b', code: 'KeyB' });
    expect(screen.getByTestId('live-markers-count')).toHaveTextContent('2');

    await user.click(screen.getByTestId('stop-recording-button'));

    await waitFor(() => {
      expect(screen.getByTestId('export-chapters-card')).toBeInTheDocument();
    });

    expect(screen.getByTestId('youtube-chapters-preview')).toHaveTextContent(
      'State Topology Breakdown',
    );
    expect(screen.getByTestId('youtube-chapters-preview')).toHaveTextContent(
      'Highlight #2',
    );

    // Clicking chapter chip seeks preview <video>
    await user.click(screen.getByTestId('seek-chapter-marker-1'));
    const previewVideo = screen.getByTestId<HTMLVideoElement>(
      'export-preview-video',
    );
    expect(Number.isFinite(previewVideo.currentTime)).toBe(true);
  });
});

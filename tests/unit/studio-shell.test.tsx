import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { App } from '../../src/App';

function simulateMetadataLoaded(
  video: HTMLVideoElement,
  duration = 90,
  width = 1920,
  height = 1080,
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

describe('ReactStage Studio Shell', () => {
  it('renders accessible studio shell with all six pipeline panels and no download button before recording', () => {
    render(<App />);

    expect(
      screen.getByRole('heading', { name: 'ReactStage' }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('heading', { name: 'Live Scene Stage' }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('heading', { name: 'Source Video Transport' }),
    ).toBeInTheDocument();
    expect(screen.getByTestId('scene-compositor-canvas')).toBeInTheDocument();
    expect(screen.getByTestId('webcam-capture-panel')).toBeInTheDocument();
    expect(screen.getByTestId('microphone-capture-panel')).toBeInTheDocument();
    expect(screen.getByTestId('recording-session-panel')).toBeInTheDocument();
    expect(screen.getByTestId('export-panel')).toBeInTheDocument();

    // Transport buttons disabled before loading a video
    expect(screen.getByTestId('play-pause-button')).toBeDisabled();
    expect(screen.getByTestId('rewind-button')).toBeDisabled();
    expect(screen.getByTestId('restart-button')).toBeDisabled();
    expect(screen.getByTestId('seek-slider')).toBeDisabled();

    // Download button only appears once a recording take has been finalized
    expect(
      screen.queryByTestId('download-export-button'),
    ).not.toBeInTheDocument();
  });

  it('keeps source playback time strictly separate from recording session time during playback and seeking', async () => {
    const revokeSpy = vi.spyOn(URL, 'revokeObjectURL');
    const user = userEvent.setup();
    const { unmount } = render(<App />);

    const fileInput = screen.getByTestId('source-file-input');
    const validFile = new File(['video-content'], 'tutorial.webm', {
      type: 'video/webm',
    });

    await user.upload(fileInput, validFile);

    const videoEl = screen.getByTestId<HTMLVideoElement>('source-video-element');
    simulateMetadataLoaded(videoEl, 90, 1920, 1080);

    expect(screen.getByTestId('loaded-file-name')).toHaveTextContent(
      'tutorial.webm',
    );
    expect(screen.getByTestId('source-playback-time')).toHaveTextContent(
      '00:00.0 / 01:30.0',
    );
    expect(screen.getByTestId('recording-session-time')).toHaveTextContent(
      '00:00.0',
    );

    // Seek source video to 42.5s
    const seekSlider = screen.getByTestId('seek-slider');
    fireEvent.change(seekSlider, { target: { value: '42.5' } });

    expect(screen.getByTestId('source-playback-time')).toHaveTextContent(
      '00:42.5 / 01:30.0',
    );
    expect(screen.getByTestId('header-source-time')).toHaveTextContent(
      '00:42.5 / 01:30.0',
    );

    // Recording session clock MUST remain completely unaffected at 00:00.0
    expect(screen.getByTestId('recording-session-time')).toHaveTextContent(
      '00:00.0',
    );
    expect(screen.getByTestId('header-recording-time')).toHaveTextContent(
      '00:00.0',
    );
    expect(screen.getByTestId('transport-recording-time')).toHaveTextContent(
      '00:00.0',
    );

    // Change speed and volume
    await user.selectOptions(screen.getByTestId('playback-speed-select'), '1.5');
    expect(videoEl.playbackRate).toBe(1.5);

    fireEvent.change(screen.getByTestId('volume-slider'), {
      target: { value: '0.45' },
    });
    expect(screen.getByTestId('volume-display')).toHaveTextContent('45%');

    // Unmounting revokes Object URL automatically
    unmount();
    expect(revokeSpy).toHaveBeenCalledTimes(1);
  });

  it('supports drag-and-drop ingestion and displays accessible alert on unsupported files', () => {
    const createSpy = vi.spyOn(URL, 'createObjectURL');
    render(<App />);

    const dropzone = screen.getByTestId('source-dropzone');
    const badFile = new File(['plain text'], 'readme.txt', {
      type: 'text/plain',
    });

    fireEvent.drop(dropzone, {
      dataTransfer: {
        files: [badFile],
      },
    });

    const alert = screen.getByRole('alert');
    expect(alert).toHaveTextContent('Unsupported file format');
    expect(alert).toHaveTextContent('UNSUPPORTED_FILE_TYPE');
    expect(createSpy).not.toHaveBeenCalled();
  });
});

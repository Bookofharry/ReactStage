import { StrictMode } from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { App } from '../../src/App';
import { BrowserExportManager } from '../../src/services/export-manager';
import type { RecordedMediaArtifact } from '../../src/services/interfaces/recording-engine';
import {
  CanvasSceneCompositor,
  resolveVerticalSplitPanes,
} from '../../src/services/scene-compositor';
import { InMemoryTakeVault } from '../../src/services/take-vault';
import { readBlobBytes } from '../../src/services/recording-engine/webm-duration';
import {
  buildTrimmedVideoFileName,
  buildWavFileName,
  clampTrimRange,
  encodePcm16Wav,
  extractCompanionWavBlob,
} from '../../src/utils/media-trim-and-wav';

function createSampleArtifact(
  id: string,
  durationMs = 4200,
  width = 720,
  height = 1280,
): RecordedMediaArtifact {
  const payload = new Uint8Array(1024);
  payload.fill(0x42);
  const blob = new Blob([payload], { type: 'video/webm' });
  return {
    id,
    blob,
    mimeType: 'video/webm',
    durationMs,
    sizeBytes: blob.size,
    chunkCount: 8,
    width,
    height,
    hasAudioTrack: true,
    createdAtIso: '2026-06-01T12:00:00.000Z',
  };
}

describe('Tasks 16–19 Vertical Shorts, IndexedDB Take Vault, Eye-Line Teleprompter & Trim/WAV Export', () => {
  it('computes vertical top/bottom split geometry and renders 9:16 portrait frames on CanvasSceneCompositor', () => {
    const panes = resolveVerticalSplitPanes(0.5, 720, 1280, 4);
    expect(panes.topPane).toEqual({ x: 0, y: 0, width: 720, height: 638 });
    expect(panes.divider).toEqual({ x: 0, y: 638, width: 720, height: 4 });
    expect(panes.bottomPane).toEqual({ x: 0, y: 642, width: 720, height: 638 });

    const clampedHigh = resolveVerticalSplitPanes(0.99, 1080, 1920, 4);
    expect(clampedHigh.topPane.height).toBeGreaterThan(
      clampedHigh.bottomPane.height,
    );
    expect(
      clampedHigh.topPane.height +
        clampedHigh.divider.height +
        clampedHigh.bottomPane.height,
    ).toBe(1920);

    const drawImageCalls: {
      dx: number;
      dy: number;
      dw: number;
      dh: number;
    }[] = [];
    const fillRectCalls: {
      x: number;
      y: number;
      w: number;
      h: number;
    }[] = [];

    const fakeCtx = {
      fillStyle: '#000000',
      strokeStyle: '#000000',
      lineWidth: 1,
      globalAlpha: 1,
      font: '16px sans-serif',
      textAlign: 'left',
      textBaseline: 'top',
      fillRect: (x: number, y: number, w: number, h: number) => {
        fillRectCalls.push({ x, y, w, h });
      },
      strokeRect: vi.fn(),
      fillText: vi.fn(),
      measureText: (txt: string) => ({ width: txt.length * 10 }),
      drawImage: (
        _img: CanvasImageSource,
        _sx: number,
        _sy: number,
        _sw: number,
        _sh: number,
        dx: number,
        dy: number,
        dw: number,
        dh: number,
      ) => {
        drawImageCalls.push({ dx, dy, dw, dh });
      },
      save: vi.fn(),
      restore: vi.fn(),
    } as unknown as CanvasRenderingContext2D;

    const canvas = document.createElement('canvas');
    vi.spyOn(canvas, 'getContext').mockReturnValue(fakeCtx);

    const fakeSourceVideo = document.createElement('video');
    fakeSourceVideo.setAttribute(
      'src',
      'blob:http://localhost:5173/local-video-1',
    );
    Object.defineProperty(fakeSourceVideo, 'readyState', {
      configurable: true,
      value: 4,
    });
    Object.defineProperty(fakeSourceVideo, 'videoWidth', {
      configurable: true,
      value: 1920,
    });
    Object.defineProperty(fakeSourceVideo, 'videoHeight', {
      configurable: true,
      value: 1080,
    });
    Object.defineProperty(fakeSourceVideo, 'error', {
      configurable: true,
      get: () => null,
    });

    const fakeCamVideo = document.createElement('video');
    Object.defineProperty(fakeCamVideo, 'readyState', { value: 4 });
    Object.defineProperty(fakeCamVideo, 'videoWidth', { value: 1280 });
    Object.defineProperty(fakeCamVideo, 'videoHeight', { value: 720 });
    fakeCamVideo.play = () => Promise.resolve();

    const compositor = new CanvasSceneCompositor({
      initialConfig: {
        resolutionPreset: '720p-vertical',
        layoutMode: 'top-bottom',
        splitRatio: 0.5,
      },
      createVideoElement: () => fakeCamVideo,
    });

    compositor.attachCanvas(canvas);
    expect(canvas.width).toBe(720);
    expect(canvas.height).toBe(1280);

    const camTrack = {
      id: 'cam-1',
      kind: 'video',
      enabled: true,
      muted: false,
      readyState: 'live',
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    } as unknown as MediaStreamTrack;
    const camStream = {
      id: 'cam-stream',
      getVideoTracks: () => [camTrack],
    } as unknown as MediaStream;

    compositor.setSourceVideo(fakeSourceVideo);
    compositor.setCameraStream(camStream);
    drawImageCalls.length = 0;
    fillRectCalls.length = 0;

    expect(compositor.renderFrameNow()).toBe(true);
    expect(drawImageCalls.length).toBe(2);
    // Top pane contain-fits 16:9 video inside 720x638 -> 720x405 centered vertically
    expect(drawImageCalls[0]?.dw).toBe(720);
    expect(drawImageCalls[0]?.dh).toBe(405);
    // Bottom pane cover-crops webcam to fill 720x638
    expect(drawImageCalls[1]?.dy).toBe(642);
    expect(drawImageCalls[1]?.dw).toBe(720);
    expect(drawImageCalls[1]?.dh).toBe(638);

    // Switch to 1080p-vertical (1080x1920)
    compositor.setResolution('1080p-vertical');
    expect(canvas.width).toBe(1080);
    expect(canvas.height).toBe(1920);
    compositor.dispose();
  });

  it('encodes spec-valid 16-bit PCM RIFF/WAVE headers, slices decoded Web Audio buffers with 0 speaker bleed, and clamps trim ranges', async () => {
    const clamped = clampTrimRange(-2, 99, 10);
    expect(clamped).toEqual({
      startSec: 0,
      endSec: 10,
      durationSec: 10,
      isTrimmed: false,
    });

    const trimmed = clampTrimRange(1.25, 4.75, 10);
    expect(trimmed).toEqual({
      startSec: 1.25,
      endSec: 4.75,
      durationSec: 3.5,
      isTrimmed: true,
    });

    expect(buildWavFileName('my-reaction.webm', false)).toBe('my-reaction.wav');
    expect(buildWavFileName('my-reaction.webm', true)).toBe(
      'my-reaction.trimmed.wav'.replace('.trimmed', '-trimmed'),
    );
    expect(buildTrimmedVideoFileName('my-reaction.webm')).toBe(
      'my-reaction-trimmed.webm',
    );

    const left = new Float32Array([0, 1, -1, 0.5]);
    const right = new Float32Array([0, -1, 1, -0.5]);
    const wavBlob = encodePcm16Wav([left, right], 48000);
    expect(wavBlob.type).toBe('audio/wav');
    expect(wavBlob.size).toBe(44 + 4 * 2 * 2);

    const bytes = await readBlobBytes(wavBlob);
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const magic = String.fromCharCode(
      bytes[0] ?? 0,
      bytes[1] ?? 0,
      bytes[2] ?? 0,
      bytes[3] ?? 0,
    );
    const waveTag = String.fromCharCode(
      bytes[8] ?? 0,
      bytes[9] ?? 0,
      bytes[10] ?? 0,
      bytes[11] ?? 0,
    );
    expect(magic).toBe('RIFF');
    expect(waveTag).toBe('WAVE');
    expect(view.getUint16(20, true)).toBe(1); // Linear PCM
    expect(view.getUint16(22, true)).toBe(2); // Stereo
    expect(view.getUint32(24, true)).toBe(48000);
    expect(view.getUint16(34, true)).toBe(16); // 16-bit
    expect(view.getInt16(48, true)).toBe(32767); // frame 1 left = +1.0
    expect(view.getInt16(50, true)).toBe(-32768); // frame 1 right = -1.0

    // Verify extractCompanionWavBlob decodes & slices [1.0s..2.0s] via AudioContext with 0 speaker connections and closes context
    let closeCalls = 0;
    const origAudioCtx = (
      globalThis as { AudioContext?: typeof AudioContext }
    ).AudioContext;

    class FakeDecodeAudioContext {
      public state: AudioContextState = 'running';
      public destination = {
        connect: () => {
          throw new Error('Must never connect to speakers!');
        },
      };
      public decodeAudioData(): Promise<AudioBuffer> {
        const sr = 1000;
        const ch = new Float32Array(3000);
        // Fill [1000..2000) with +0.5 amplitude, rest 0
        ch.fill(0.5, 1000, 2000);
        return Promise.resolve({
          sampleRate: sr,
          length: 3000,
          duration: 3,
          numberOfChannels: 1,
          getChannelData: () => ch,
        } as unknown as AudioBuffer);
      }
      public close(): Promise<void> {
        closeCalls += 1;
        this.state = 'closed';
        return Promise.resolve();
      }
    }

    (
      globalThis as { AudioContext?: typeof AudioContext }
    ).AudioContext = FakeDecodeAudioContext as unknown as typeof AudioContext;

    try {
      const sourceMedia = new Blob([new Uint8Array([1, 2, 3, 4])], {
        type: 'video/webm',
      });
      const slicedWav = await extractCompanionWavBlob(
        sourceMedia,
        3000,
        1.0,
        2.0,
      );
      expect(closeCalls).toBe(1);
      const slicedBytes = await readBlobBytes(slicedWav);
      // 1.0s at 1000Hz mono 16-bit = 1000 * 2 = 2000 data bytes + 44 header bytes = 2044
      expect(slicedBytes.byteLength).toBe(2044);
      const slicedView = new DataView(
        slicedBytes.buffer,
        slicedBytes.byteOffset,
        slicedBytes.byteLength,
      );
      expect(slicedView.getInt16(44, true)).toBeGreaterThan(16000);
    } finally {
      (
        globalThis as { AudioContext?: typeof AudioContext }
      ).AudioContext = origAudioCtx;
    }
  });

  it('hydrates persisted takes from TakeVault with <= 1 active Object URL, supports Trim + WAV download, and keeps Teleprompter off the recorded canvas', async () => {
    window.localStorage.clear();
    const vault = new InMemoryTakeVault({ maxTakes: 3 });
    const art1 = createSampleArtifact('vault-take-1', 4000);
    const art2 = createSampleArtifact('vault-take-2', 6000);

    await vault.saveTake({
      id: art1.id,
      takeNumber: 1,
      artifact: art1,
      sourceFileName: 'demo-clip.mp4',
      customFileName: null,
      downloadedCount: 0,
      trimStartSec: 0,
      trimEndSec: 4,
      savedAtMs: 1000,
    });
    await vault.saveTake({
      id: art2.id,
      takeNumber: 2,
      artifact: art2,
      sourceFileName: 'demo-clip.mp4',
      customFileName: 'shorts-cut',
      downloadedCount: 1,
      trimStartSec: 0.5,
      trimEndSec: 3.5,
      savedAtMs: 2000,
    });

    let activeBlobUrls = 0;
    const exportManager = new BrowserExportManager({
      urlAdapter: {
        createObjectURL: () => {
          activeBlobUrls += 1;
          return `blob:reactstage-vault-${String(activeBlobUrls)}`;
        },
        revokeObjectURL: () => {
          activeBlobUrls = Math.max(0, activeBlobUrls - 1);
        },
      },
    });

    // Spy on Canvas 2D fillText to prove Teleprompter text is NEVER drawn onto recorded canvas
    const canvasFillTextCalls: string[] = [];
    const getContextSpy = vi
      .spyOn(HTMLCanvasElement.prototype, 'getContext')
      .mockImplementation(((contextId: string) => {
        if (contextId !== '2d') {
          return null;
        }
        return {
          fillStyle: '#000',
          strokeStyle: '#000',
          lineWidth: 1,
          globalAlpha: 1,
          font: '16px sans-serif',
          textAlign: 'left',
          textBaseline: 'top',
          fillRect: vi.fn(),
          strokeRect: vi.fn(),
          fillText: (text: string) => {
            canvasFillTextCalls.push(text);
          },
          measureText: (txt: string) => ({ width: txt.length * 8 }),
          drawImage: vi.fn(),
          save: vi.fn(),
          restore: vi.fn(),
        } as unknown as CanvasRenderingContext2D;
      }) as typeof HTMLCanvasElement.prototype.getContext);

    const clickSpy = vi
      .spyOn(HTMLAnchorElement.prototype, 'click')
      .mockImplementation(() => undefined);

    try {
      const user = userEvent.setup();
      const firstMount = render(
        <StrictMode>
          <App takeVault={vault} exportManager={exportManager} />
        </StrictMode>,
      );

      // Hydrates both takes from TakeVault with <= 1 preview Object URL
      await waitFor(
        () => {
          expect(screen.getByTestId('session-takes-count')).toHaveTextContent(
            '2',
          );
        },
        { timeout: 4000 },
      );
      expect(screen.getByTestId('vault-status-badge')).toHaveTextContent(
        'Vault Saved',
      );
      expect(exportManager.getState().activeObjectUrlCount).toBe(1);

      // Switch between Take #1 and Take #2 -> still strictly 1 Object URL
      await user.click(screen.getByTestId('select-take-button-1'));
      expect(exportManager.getState().activeObjectUrlCount).toBe(1);
      await user.click(screen.getByTestId('toggle-trim-tools-button'));
      expect(screen.getByTestId('trim-range-summary')).toHaveTextContent(
        'Full Clip',
      );

      // Adjust Trim In/Out on Take #1 and trigger Companion WAV export
      fireEvent.change(screen.getByTestId('trim-start-input'), {
        target: { value: '0.8' },
      });
      fireEvent.change(screen.getByTestId('trim-end-input'), {
        target: { value: '2.8' },
      });
      expect(screen.getByTestId('trim-range-summary')).toHaveTextContent(
        '00:02.0 Selected',
      );
      expect(
        screen.getByTestId('download-trimmed-video-button'),
      ).not.toBeDisabled();

      await user.click(screen.getByTestId('download-wav-button'));
      await waitFor(() => {
        expect(
          screen.getByTestId('companion-export-banner'),
        ).toHaveTextContent('.wav');
      });
      expect(clickSpy).toHaveBeenCalled();

      // Press hotkey '5' -> Top / Bottom Vertical layout
      fireEvent.keyDown(window, { key: '5' });
      expect(screen.getByTestId('layout-mode-top-bottom')).toHaveAttribute(
        'aria-pressed',
        'true',
      );
      await user.click(screen.getByTestId('open-settings-modal-button'));
      expect(screen.getByTestId('split-ratio-readout')).toHaveTextContent(
        '50% Top Source / 50% Bottom Webcam',
      );
      await user.click(screen.getByTestId('close-settings-modal-button'));

      // Press hotkey 't' -> Toggle Eye-Line Teleprompter HUD & enter private script
      fireEvent.keyDown(window, { key: 't' });
      expect(screen.getByTestId('teleprompter-stage-overlay')).toBeVisible();
      const secretNote = 'PRIVATE_EYE_LINE_SCRIPT_DO_NOT_RECORD';
      fireEvent.change(screen.getByTestId('teleprompter-script-input'), {
        target: { value: secretNote },
      });
      expect(screen.getByTestId('teleprompter-hud-viewport')).toHaveTextContent(
        secretNote,
      );

      // Force canvas re-render via resolution change to 720p-vertical and verify secretNote never hits canvas fillText!
      await user.click(screen.getByTestId('open-settings-modal-button'));
      await user.selectOptions(
        screen.getByTestId('scene-resolution-select'),
        '720p-vertical',
      );
      await user.click(screen.getByTestId('close-settings-modal-button'));
      expect(canvasFillTextCalls).not.toContain(secretNote);

      // Delete Take #1 -> verify Vault removes it
      await user.click(screen.getByTestId('delete-take-button-1'));
      await waitFor(
        async () => {
          const remaining = await vault.loadAll();
          expect(remaining.map((r) => r.id)).toEqual(['vault-take-2']);
        },
        { timeout: 4000 },
      );

      // Unmount and remount -> Teleprompter script + 720p-vertical + Top/Bottom persist via StudioPreferencesStore!
      firstMount.unmount();

      render(
        <StrictMode>
          <App takeVault={vault} />
        </StrictMode>,
      );

      expect(screen.getByTestId('layout-mode-top-bottom')).toHaveAttribute(
        'aria-pressed',
        'true',
      );
      await user.click(screen.getByTestId('open-settings-modal-button'));
      expect(
        screen.getByTestId<HTMLSelectElement>('scene-resolution-select').value,
      ).toBe('720p-vertical');
      expect(screen.getByTestId('teleprompter-hud-viewport')).toHaveTextContent(
        secretNote,
      );
    } finally {
      getContextSpy.mockRestore();
      clickSpy.mockRestore();
      window.localStorage.clear();
    }
  });
});

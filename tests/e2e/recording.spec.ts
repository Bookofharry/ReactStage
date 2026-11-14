import path from 'node:path';
import { fileURLToPath } from 'node:url';
import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SOURCE_440HZ_PATH = path.join(
  __dirname,
  'fixtures',
  'source-440hz-4s.webm',
);

interface DecodedRecordedArtifactReport {
  readonly durationSec: number;
  readonly isDurationFinite: boolean;
  readonly videoWidth: number;
  readonly videoHeight: number;
  readonly sizeBytes: number;
  readonly mimeType: string;
  readonly hasNonBlackPixels: boolean;
  readonly maxDb440: number;
  readonly maxDb1200: number;
}

async function installSyntheticStudioDevices(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const OrigAudioContext = window.AudioContext;
    const synthContexts: AudioContext[] = [];
    const synthTimers: number[] = [];

    const md = navigator.mediaDevices;
    md.enumerateDevices = (): Promise<MediaDeviceInfo[]> =>
      Promise.resolve([
        {
          deviceId: 'rec-cam-1',
          kind: 'videoinput',
          label: 'Reaction Cam HD',
          groupId: 'grp-rec-cam',
          toJSON() {
            return this;
          },
        },
        {
          deviceId: 'rec-mic-1200',
          kind: 'audioinput',
          label: 'Commentary 1200Hz Mic',
          groupId: 'grp-rec-mic',
          toJSON() {
            return this;
          },
        },
      ]);

    md.getUserMedia = (
      constraints?: MediaStreamConstraints,
    ): Promise<MediaStream> => {
      if (constraints?.video) {
        const canvas = document.createElement('canvas');
        canvas.width = 640;
        canvas.height = 360;
        const ctx2d = canvas.getContext('2d');
        let frame = 0;
        const paint = (): void => {
          frame += 1;
          if (ctx2d) {
            ctx2d.fillStyle = '#1e3a8a';
            ctx2d.fillRect(0, 0, 640, 360);
            ctx2d.fillStyle = '#34d399';
            ctx2d.fillRect((frame * 14) % 540, 100, 100, 160);
          }
        };
        paint();
        const id = window.setInterval(paint, 33);
        synthTimers.push(id);
        const stream = canvas.captureStream(30);
        for (const track of stream.getVideoTracks()) {
          Object.defineProperty(track, 'label', { value: 'Reaction Cam HD' });
        }
        return Promise.resolve(stream);
      }

      if (constraints?.audio) {
        const ctx = new OrigAudioContext({ sampleRate: 48000 });
        synthContexts.push(ctx);
        const osc = ctx.createOscillator();
        osc.type = 'sine';
        osc.frequency.value = 1200;
        const gain = ctx.createGain();
        gain.gain.value = 0.55;
        const dest = ctx.createMediaStreamDestination();
        osc.connect(gain);
        gain.connect(dest);
        osc.start();
        for (const track of dest.stream.getAudioTracks()) {
          Object.defineProperty(track, 'label', {
            value: 'Commentary 1200Hz Mic',
          });
        }
        return Promise.resolve(dest.stream);
      }

      return Promise.reject(
        new DOMException('Unsupported constraints', 'NotSupportedError'),
      );
    };

    window.addEventListener('pagehide', () => {
      for (const t of synthTimers) window.clearInterval(t);
      for (const c of synthContexts) void c.close();
    });
  });
}

async function decodeAndVerifyRecordedArtifact(
  page: Page,
): Promise<DecodedRecordedArtifactReport> {
  return page.evaluate(async (): Promise<DecodedRecordedArtifactReport> => {
    const debugRecorder = (
      window as unknown as {
        __REACTSTAGE_RECORDING_ENGINE__?: {
          getLastArtifact: () => {
            blob: Blob;
            mimeType: string;
            sizeBytes: number;
          } | null;
        };
      }
    ).__REACTSTAGE_RECORDING_ENGINE__;

    const artifact = debugRecorder?.getLastArtifact() ?? null;
    if (!artifact) {
      throw new Error('Expected finalized RecordedMediaArtifact in memory');
    }

    const tempUrl = URL.createObjectURL(artifact.blob);
    const video = document.createElement('video');
    video.playsInline = true;
    video.src = tempUrl;

    try {
      await new Promise<void>((resolve, reject) => {
        video.onloadedmetadata = () => {
          resolve();
        };
        video.onerror = () => {
          reject(new Error('Failed to decode recorded WebM artifact'));
        };
      });

      const ctx = new AudioContext({ sampleRate: 48000 });
      await ctx.resume();
      const mediaSource = ctx.createMediaElementSource(video);
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 4096;
      analyser.smoothingTimeConstant = 0;
      const pullSink = ctx.createMediaStreamDestination();
      mediaSource.connect(analyser);
      analyser.connect(pullSink);

      await video.play();

      const freq = new Float32Array(analyser.frequencyBinCount);
      const binHz = ctx.sampleRate / analyser.fftSize;
      const bin440 = Math.round(440 / binHz);
      const bin1200 = Math.round(1200 / binHz);

      const peakAround = (center: number): number => {
        let best = -Infinity;
        for (let offset = -2; offset <= 2; offset += 1) {
          const val = freq[center + offset] ?? -Infinity;
          if (val > best) best = val;
        }
        return best;
      };

      let maxDb440 = -Infinity;
      let maxDb1200 = -Infinity;
      let hasNonBlackPixels = false;

      const probeCanvas = document.createElement('canvas');
      probeCanvas.width = 64;
      probeCanvas.height = 36;
      const probe2d = probeCanvas.getContext('2d');

      for (let step = 0; step < 8; step += 1) {
        await new Promise((r) => setTimeout(r, 90));
        analyser.getFloatFrequencyData(freq);
        maxDb440 = Math.max(maxDb440, peakAround(bin440));
        maxDb1200 = Math.max(maxDb1200, peakAround(bin1200));

        if (probe2d && video.readyState >= 2) {
          probe2d.drawImage(video, 0, 0, 64, 36);
          const pixels = probe2d.getImageData(0, 0, 64, 36).data;
          for (let i = 0; i < pixels.length; i += 4) {
            if (
              (pixels[i] ?? 0) > 20 ||
              (pixels[i + 1] ?? 0) > 20 ||
              (pixels[i + 2] ?? 0) > 20
            ) {
              hasNonBlackPixels = true;
              break;
            }
          }
        }
      }

      video.pause();
      await ctx.close();

      return {
        durationSec: video.duration,
        isDurationFinite: Number.isFinite(video.duration),
        videoWidth: video.videoWidth,
        videoHeight: video.videoHeight,
        sizeBytes: artifact.sizeBytes,
        mimeType: artifact.mimeType,
        hasNonBlackPixels,
        maxDb440,
        maxDb1200,
      };
    } finally {
      video.removeAttribute('src');
      video.load();
      URL.revokeObjectURL(tempUrl);
    }
  });
}

test.describe('ReactStage — Task 5 Live Recording Engine E2E', () => {
  test('records synchronized 1280x720 scene + mixed 440Hz/1200Hz audio across pause-to-explain, layout switch, and recorder pause/resume into a valid finite-duration WebM', async ({
    page,
  }) => {
    await installSyntheticStudioDevices(page);
    await page.goto('./');

    // Loop the 3.6s 440Hz source fixture so playback stays continuous
    await page.getByTestId('source-video-element').evaluate((el) => {
      (el as HTMLVideoElement).loop = true;
    });

    // 1. Start Webcam + 1200Hz Mic + 440Hz Source Video
    await page.getByTestId('camera-toggle-button').click();
    await page.getByTestId('microphone-toggle-button').click();
    await expect(page.getByTestId('camera-status-badge')).toHaveText('Live');
    await expect(page.getByTestId('microphone-status-badge')).toHaveText(
      'Live',
    );

    await page
      .getByTestId('source-file-input')
      .setInputFiles(SOURCE_440HZ_PATH);
    await expect(page.getByTestId('loaded-file-name')).toHaveText(
      'source-440hz-4s.webm',
    );
    await page.getByTestId('play-pause-button').click();

    // 2. Start Recording Session
    await page.getByTestId('start-recording-button').click();
    await expect(page.getByTestId('recording-status-badge')).toHaveText(
      'Recording',
    );
    await expect(page.getByTestId('header-recording-status')).toHaveText('REC');

    // Wait until chunks & elapsed time advance with both 440Hz + 1200Hz playing
    await expect
      .poll(async () => {
        const chunksText = await page
          .getByTestId('recording-chunks-readout')
          .textContent();
        return Number(chunksText ?? '0');
      })
      .toBeGreaterThanOrEqual(2);

    // 3. Pause-to-Explain: pause imported source video & switch layout to Side-by-Side while recording continues!
    await page.getByTestId('play-pause-button').click();
    const recTimeAtSourcePause = await page
      .getByTestId('recording-session-time')
      .textContent();

    await page.getByTestId('layout-mode-side-by-side').click();
    await page.waitForTimeout(350);

    const recTimeAfterExplain = await page
      .getByTestId('recording-session-time')
      .textContent();
    expect(recTimeAfterExplain).not.toBe(recTimeAtSourcePause);
    await expect(page.getByTestId('recording-status-badge')).toHaveText(
      'Recording',
    );

    // Resume source video briefly
    await page.getByTestId('play-pause-button').click();
    await page.waitForTimeout(250);

    // 4. Pause & Resume the Recording Engine itself while source video keeps playing
    await page.getByTestId('pause-resume-recording-button').click();
    await expect(page.getByTestId('recording-status-badge')).toHaveText(
      'Paused',
    );
    const frozenRecTime = await page
      .getByTestId('recording-session-time')
      .textContent();
    await page.waitForTimeout(260);
    expect(await page.getByTestId('recording-session-time').textContent()).toBe(
      frozenRecTime,
    );

    await page.getByTestId('pause-resume-recording-button').click();
    await expect(page.getByTestId('recording-status-badge')).toHaveText(
      'Recording',
    );
    await page.waitForTimeout(250);

    // 5. Stop & Finalize -> Verify recorded WebM decodes with finite duration, 1280x720 video, and BOTH 440Hz & 1200Hz audio!
    await page.getByTestId('stop-recording-button').click();
    await expect(page.getByTestId('recording-status-badge')).toHaveText(
      'Take Ready',
    );
    await expect(page.getByTestId('recorded-artifact-summary')).toBeVisible();

    // Camera, Microphone, Scene Compositor, and Audio Mixer MUST remain live after stopping recording!
    await expect(page.getByTestId('camera-status-badge')).toHaveText('Live');
    await expect(page.getByTestId('microphone-status-badge')).toHaveText(
      'Live',
    );
    await expect(page.getByTestId('scene-status-badge')).toHaveText(
      'Scene Live',
    );
    await expect(page.getByTestId('mixer-status-badge')).toHaveText(
      'Audio Live',
    );

    const decoded = await decodeAndVerifyRecordedArtifact(page);
    expect(decoded.isDurationFinite).toBe(true);
    expect(decoded.durationSec).toBeGreaterThan(0.8);
    expect(decoded.videoWidth).toBe(1280);
    expect(decoded.videoHeight).toBe(720);
    expect(decoded.sizeBytes).toBeGreaterThan(1000);
    expect(decoded.hasNonBlackPixels).toBe(true);
    expect(decoded.maxDb440).toBeGreaterThan(-42);
    expect(decoded.maxDb1200).toBeGreaterThan(-42);
  });

  test('supports cancel & discard flows, preserves zero horizontal overflow at 375/768/1280/1440, and passes WCAG 2.1 AA axe-core checks', async ({
    page,
  }) => {
    await installSyntheticStudioDevices(page);
    await page.goto('./');

    // 1. Start recording then Cancel -> discards chunks and resets to 00:00.0
    await page.getByTestId('camera-toggle-button').click();
    await page.getByTestId('start-recording-button').click();
    await expect(page.getByTestId('recording-status-badge')).toHaveText(
      'Recording',
    );
    await page.waitForTimeout(300);

    await page.getByTestId('cancel-recording-button').click();
    await expect(page.getByTestId('recording-status-badge')).toHaveText(
      'Ready',
    );
    await expect(page.getByTestId('recording-session-time')).toHaveText(
      '00:00.0',
    );
    await expect(page.getByTestId('recorded-artifact-summary')).toHaveCount(0);

    // 2. Record a short take & finalize so completed summary UI is audited for responsiveness & WCAG 2.1 AA
    await page.getByTestId('start-recording-button').click();
    await expect
      .poll(async () => {
        const text = await page
          .getByTestId('recording-chunks-readout')
          .textContent();
        return Number(text ?? '0');
      })
      .toBeGreaterThanOrEqual(1);
    await page.getByTestId('stop-recording-button').click();
    await expect(page.getByTestId('recorded-artifact-summary')).toBeVisible();

    for (const vp of [
      { width: 375, height: 812 },
      { width: 768, height: 1024 },
      { width: 1280, height: 800 },
      { width: 1440, height: 900 },
    ]) {
      await page.setViewportSize(vp);
      await expect(page.getByTestId('recording-session-panel')).toBeVisible();

      const hasOverflow = await page.evaluate(
        () =>
          document.documentElement.scrollWidth >
          document.documentElement.clientWidth,
      );
      expect(
        hasOverflow,
        `Unexpected horizontal overflow at ${String(vp.width)}x${String(vp.height)}`,
      ).toBe(false);
    }

    const axeResults = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
      .analyze();
    expect(axeResults.violations).toEqual([]);

    // Discard take -> returns to clean Ready state
    await page.getByTestId('discard-recording-button').click();
    await expect(page.getByTestId('recorded-artifact-summary')).toHaveCount(0);
  });
});

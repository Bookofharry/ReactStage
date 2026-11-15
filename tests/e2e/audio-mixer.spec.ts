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
const SILENT_MOVING_SOURCE_PATH = path.join(
  __dirname,
  'fixtures',
  'moving-source-6s.webm',
);

interface MixerGraphAudit {
  readonly mediaElementSourceCalls: number;
  readonly speakerDestinationConnections: number;
  readonly micToSpeakerPaths: number;
  readonly audioContextsCreated: number;
  readonly audioContextsClosed: number;
}

interface SpectralReading {
  readonly db440: number;
  readonly db1200: number;
  readonly trackCount: number;
  readonly videoTrackCount: number;
  readonly streamId: string;
}

async function installSyntheticToneDevicesAndAuditor(
  page: Page,
  options?: { forceInitialSuspend?: boolean },
): Promise<void> {
  const forceInitialSuspend = options?.forceInitialSuspend ?? false;

  await page.addInitScript(
    ({ shouldSuspendInitially }) => {
      let mediaElementSourceCalls = 0;
      let speakerDestinationConnections = 0;
      let audioContextsCreated = 0;
      let audioContextsClosed = 0;
      let allowResume = !shouldSuspendInitially;

      const micSourceNodes: AudioNode[] = [];
      const audioGraphEdges: [AudioNode, AudioNode][] = [];
      const suspendedOverlays = new Set<AuditedAudioContext>();

      const OrigAudioContext = window.AudioContext;

      class AuditedAudioContext extends OrigAudioContext {
        private forcedSuspended = shouldSuspendInitially;

        public constructor(contextOptions?: AudioContextOptions) {
          super(contextOptions);
          audioContextsCreated += 1;
          if (shouldSuspendInitially) {
            suspendedOverlays.add(this);
          }
        }

        public override get state(): AudioContextState {
          if (this.forcedSuspended && super.state !== 'closed') {
            return 'suspended';
          }
          return super.state;
        }

        public override async resume(): Promise<void> {
          if (this.forcedSuspended && !allowResume) {
            return;
          }
          this.forcedSuspended = false;
          await super.resume();
          this.dispatchEvent(new Event('statechange'));
        }

        public override createMediaElementSource(
          mediaElement: HTMLMediaElement,
        ): MediaElementAudioSourceNode {
          mediaElementSourceCalls += 1;
          return super.createMediaElementSource(mediaElement);
        }

        public override createMediaStreamSource(
          mediaStream: MediaStream,
        ): MediaStreamAudioSourceNode {
          const node = super.createMediaStreamSource(mediaStream);
          micSourceNodes.push(node);
          return node;
        }

        public override close(): Promise<void> {
          suspendedOverlays.delete(this);
          audioContextsClosed += 1;
          return super.close();
        }
      }

      window.AudioContext = AuditedAudioContext;

      const rawOrigConnect = Reflect.get(
        AudioNode.prototype,
        'connect',
      ) as (...args: unknown[]) => unknown;
      Reflect.set(
        AudioNode.prototype,
        'connect',
        function (
          this: AudioNode,
          destinationNode: unknown,
          ...rest: unknown[]
        ): unknown {
          if (destinationNode instanceof AudioNode) {
            audioGraphEdges.push([this, destinationNode]);
          }
          if (
            typeof AudioDestinationNode !== 'undefined' &&
            destinationNode instanceof AudioDestinationNode
          ) {
            speakerDestinationConnections += 1;
          }
          return rawOrigConnect.call(this, destinationNode, ...rest);
        },
      );

      // Synthetic camera (animated green canvas) + synthetic 1200 Hz sine-wave microphone
      const md = navigator.mediaDevices;
      md.enumerateDevices = (): Promise<MediaDeviceInfo[]> =>
        Promise.resolve([
          {
            deviceId: 'synth-cam-1',
            kind: 'videoinput',
            label: 'Studio Cam 1080p',
            groupId: 'synth-grp-cam',
            toJSON() {
              return this;
            },
          },
          {
            deviceId: 'synth-mic-1200hz',
            kind: 'audioinput',
            label: 'Synthetic 1200Hz Condenser Mic',
            groupId: 'synth-grp-mic',
            toJSON() {
              return this;
            },
          },
        ]);

      const synthAudioContexts: AudioContext[] = [];
      const synthTimers: number[] = [];

      md.getUserMedia = (
        constraints?: MediaStreamConstraints,
      ): Promise<MediaStream> => {
        if (constraints?.video) {
          const canvas = document.createElement('canvas');
          canvas.width = 640;
          canvas.height = 360;
          const ctx2d = canvas.getContext('2d');
          let tick = 0;
          const draw = (): void => {
            tick += 1;
            if (ctx2d) {
              ctx2d.fillStyle = '#065f46';
              ctx2d.fillRect(0, 0, 640, 360);
              ctx2d.fillStyle = '#34d399';
              ctx2d.fillRect((tick * 12) % 560, 120, 80, 120);
            }
          };
          draw();
          const timerId = window.setInterval(draw, 33);
          synthTimers.push(timerId);
          const stream = canvas.captureStream(30);
          for (const track of stream.getVideoTracks()) {
            Object.defineProperty(track, 'label', {
              value: 'Studio Cam 1080p',
            });
          }
          return Promise.resolve(stream);
        }

        if (constraints?.audio) {
          // Use OrigAudioContext so our synthetic mic generator is not counted in app audits
          const oscCtx = new OrigAudioContext({ sampleRate: 48000 });
          synthAudioContexts.push(oscCtx);
          const osc = oscCtx.createOscillator();
          osc.type = 'sine';
          osc.frequency.value = 1200;
          const gain = oscCtx.createGain();
          gain.gain.value = 0.55;
          const dest = oscCtx.createMediaStreamDestination();
          rawOrigConnect.call(osc, gain);
          rawOrigConnect.call(gain, dest);
          osc.start();
          for (const track of dest.stream.getAudioTracks()) {
            Object.defineProperty(track, 'label', {
              value: 'Synthetic 1200Hz Condenser Mic',
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
        for (const c of synthAudioContexts) void c.close();
      });

      // Persistent FFT probe attached lazily to the mixer's MediaStreamAudioDestinationNode
      let probeCtx: AudioContext | null = null;
      let probeAnalyser: AnalyserNode | null = null;
      let probeStream: MediaStream | null = null;

      function ensureSpectralProbe(mixedStream: MediaStream): {
        ctx: AudioContext;
        analyser: AnalyserNode;
      } {
        if (probeCtx && probeAnalyser && probeStream === mixedStream) {
          return { ctx: probeCtx, analyser: probeAnalyser };
        }
        if (probeCtx) {
          void probeCtx.close();
        }
        probeCtx = new OrigAudioContext({ sampleRate: 48000 });
        const source = OrigAudioContext.prototype.createMediaStreamSource.call(
          probeCtx,
          mixedStream,
        );
        const analyser = probeCtx.createAnalyser();
        analyser.fftSize = 4096;
        analyser.smoothingTimeConstant = 0;
        // Connect to a silent MediaStreamDestination sink so Chromium pulls the graph
        const pullSink = probeCtx.createMediaStreamDestination();
        rawOrigConnect.call(source, analyser);
        rawOrigConnect.call(analyser, pullSink);
        probeAnalyser = analyser;
        probeStream = mixedStream;
        return { ctx: probeCtx, analyser };
      }

      function countMicToSpeakerPaths(): number {
        let paths = 0;
        for (const start of micSourceNodes) {
          const visited = new Set<AudioNode>([start]);
          const queue: AudioNode[] = [start];
          while (queue.length > 0) {
            const cur = queue.shift();
            if (!cur) continue;
            for (const [from, to] of audioGraphEdges) {
              if (from === cur && !visited.has(to)) {
                if (
                  typeof AudioDestinationNode !== 'undefined' &&
                  to instanceof AudioDestinationNode
                ) {
                  paths += 1;
                }
                visited.add(to);
                queue.push(to);
              }
            }
          }
        }
        return paths;
      }

      Object.defineProperty(window, '__audioMixerTestHarness', {
        value: {
          allowUserGestureResume: (): void => {
            allowResume = true;
          },
          getGraphAudit: (): MixerGraphAudit => ({
            mediaElementSourceCalls,
            speakerDestinationConnections,
            micToSpeakerPaths: countMicToSpeakerPaths(),
            audioContextsCreated,
            audioContextsClosed,
          }),
          sampleMixedSpectrum: async (): Promise<SpectralReading | null> => {
            const debugApi = (
              window as unknown as {
                __REACTSTAGE_AUDIO_MIXER__?: {
                  getMixedOutputStream: () => MediaStream | null;
                };
              }
            ).__REACTSTAGE_AUDIO_MIXER__;
            const mixedStream = debugApi?.getMixedOutputStream() ?? null;
            if (!mixedStream) return null;

            const { ctx, analyser } = ensureSpectralProbe(mixedStream);
            if (ctx.state === 'suspended') {
              await ctx.resume();
            }

            const freq = new Float32Array(analyser.frequencyBinCount);
            analyser.getFloatFrequencyData(freq);

            const binHz = ctx.sampleRate / analyser.fftSize;
            const bin440 = Math.round(440 / binHz);
            const bin1200 = Math.round(1200 / binHz);

            const maxAround = (center: number): number => {
              let best = -Infinity;
              for (let offset = -2; offset <= 2; offset += 1) {
                const idx = center + offset;
                if (idx >= 0 && idx < freq.length) {
                  const val = freq[idx] ?? -Infinity;
                  if (val > best) best = val;
                }
              }
              return best;
            };

            return {
              db440: maxAround(bin440),
              db1200: maxAround(bin1200),
              trackCount: mixedStream.getAudioTracks().length,
              videoTrackCount: mixedStream.getVideoTracks().length,
              streamId: mixedStream.id,
            };
          },
        },
      });
    },
    { shouldSuspendInitially: forceInitialSuspend },
  );
}

async function sampleSpectrum(page: Page): Promise<SpectralReading | null> {
  return page.evaluate(() => {
    const harness = (
      window as unknown as {
        __audioMixerTestHarness: {
          sampleMixedSpectrum: () => Promise<SpectralReading | null>;
        };
      }
    ).__audioMixerTestHarness;
    return harness.sampleMixedSpectrum();
  });
}

async function getMixerAudit(page: Page): Promise<MixerGraphAudit> {
  return page.evaluate(() => {
    const harness = (
      window as unknown as {
        __audioMixerTestHarness: {
          getGraphAudit: () => MixerGraphAudit;
        };
      }
    ).__audioMixerTestHarness;
    return harness.getGraphAudit();
  });
}

test.describe('ReactStage — Task 4 Live Audio Mixer E2E', () => {
  test('mixes 440Hz source video and 1200Hz microphone into a single destination, preserves mic & webcam when source pauses, and supports mute, 0-200% gain, clipping, and silent source fallback', async ({
    page,
  }) => {
    await installSyntheticToneDevicesAndAuditor(page);
    await page.goto('./');

    // Make source video loop so the 3.6s 440Hz tone fixture never hits EOF mid-assertion
    await page.getByTestId('source-video-element').evaluate((el) => {
      (el as HTMLVideoElement).loop = true;
    });

    // 1. Start Webcam + 1200 Hz Synthetic Microphone
    await page.getByTestId('camera-toggle-button').click();
    await page.getByTestId('microphone-toggle-button').click();
    await expect(page.getByTestId('camera-status-badge')).toHaveText('Live');
    await expect(page.getByTestId('microphone-status-badge')).toHaveText(
      'Live',
    );

    // Load 440 Hz tone video and start playback
    await page
      .getByTestId('source-file-input')
      .setInputFiles(SOURCE_440HZ_PATH);
    await expect(page.getByTestId('loaded-file-name')).toHaveText(
      'source-440hz-4s.webm',
    );
    await page.getByTestId('play-pause-button').click();

    await expect(page.getByTestId('mixer-status-badge')).toHaveText(
      'Audio Live',
    );
    await expect(page.getByTestId('mixer-mode-badge')).toHaveText(
      'Combined Mix',
    );

    // 2. Verify BOTH 440 Hz (source) and 1200 Hz (mic) are present in the mixed destination stream!
    await expect
      .poll(
        async () => {
          const s = await sampleSpectrum(page);
          return s !== null && s.db440 > -35 && s.db1200 > -35;
        },
        { timeout: 6000 },
      )
      .toBe(true);

    const combinedReading = await sampleSpectrum(page);
    expect(combinedReading).not.toBeNull();
    expect(combinedReading?.trackCount).toBe(1);
    expect(combinedReading?.videoTrackCount).toBe(0);
    const initialStreamId = combinedReading?.streamId;

    // 3. Pause imported source video -> 440 Hz disappears, 1200 Hz microphone stays strong, compositor keeps rendering!
    await page.getByTestId('play-pause-button').click();
    await expect(page.getByTestId('scene-status-badge')).toHaveText(
      'Scene Live',
    );
    await expect(page.getByTestId('scene-dimensions-badge')).toContainText(
      'fps',
    );

    await expect
      .poll(
        async () => {
          const s = await sampleSpectrum(page);
          return s !== null && s.db440 < -55 && s.db1200 > -35;
        },
        { timeout: 5000 },
      )
      .toBe(true);

    const pausedReading = await sampleSpectrum(page);
    expect(pausedReading?.streamId).toBe(initialStreamId);
    await expect(page.getByTestId('mixer-status-badge')).toHaveText(
      'Audio Live',
    );
    await expect(page.getByTestId('camera-status-badge')).toHaveText('Live');
    await expect(page.getByTestId('microphone-status-badge')).toHaveText(
      'Live',
    );

    // 4. Resume imported source video -> 440 Hz returns without recreating MediaElementSource or mixed stream!
    await page.getByTestId('play-pause-button').click();
    await expect
      .poll(
        async () => {
          const s = await sampleSpectrum(page);
          return s !== null && s.db440 > -35 && s.db1200 > -35;
        },
        { timeout: 5000 },
      )
      .toBe(true);
    expect((await sampleSpectrum(page))?.streamId).toBe(initialStreamId);

    // 5. Independent Source Mute & Mic Mute
    await page.getByTestId('workspace-tab-audio').click();
    await page.getByTestId('mixer-source-mute-button').click();
    await expect(page.getByTestId('mixer-mode-badge')).toHaveText('Mic Only');
    await expect(page.getByTestId('volume-display')).toHaveText('Muted');
    await expect
      .poll(async () => {
        const s = await sampleSpectrum(page);
        return s !== null && s.db440 < -55 && s.db1200 > -35;
      })
      .toBe(true);

    // Unmute source, mute microphone -> 440 Hz present, 1200 Hz removed
    await page.getByTestId('mixer-source-mute-button').click();
    await page.getByTestId('mixer-mic-mute-button').click();
    await expect(page.getByTestId('mixer-mode-badge')).toHaveText(
      'Video Only',
    );
    await expect
      .poll(async () => {
        const s = await sampleSpectrum(page);
        return s !== null && s.db440 > -35 && s.db1200 < -55;
      })
      .toBe(true);

    // Unmute mic -> back to Combined Mix
    await page.getByTestId('mixer-mic-mute-button').click();
    await expect(page.getByTestId('mixer-mode-badge')).toHaveText(
      'Combined Mix',
    );

    // 6. Independent 0-200% Gain + Unified Playback Volume + Clipping Indicator
    await page.getByTestId('mixer-source-gain-slider').fill('2');
    await page.getByTestId('mixer-mic-gain-slider').fill('2');
    await expect(page.getByTestId('mixer-source-gain-value')).toHaveText(
      '200%',
    );
    await expect(page.getByTestId('volume-display')).toHaveText('200%');
    await expect(page.getByTestId('mixer-mic-gain-value')).toHaveText('200%');
    await expect(page.getByTestId('mixer-master-clip-badge')).toBeVisible();

    // Restore 100% unity gain
    await page.getByTestId('mixer-source-gain-slider').fill('1');
    await page.getByTestId('mixer-mic-gain-slider').fill('1');

    // 7. Replace with a silent video (no audio track) -> reports No Audio Track while 1200 Hz mic continues uninterrupted!
    await page
      .getByTestId('source-file-input')
      .setInputFiles(SILENT_MOVING_SOURCE_PATH);
    await expect(page.getByTestId('loaded-file-name')).toHaveText(
      'moving-source-6s.webm',
    );
    await page.getByTestId('play-pause-button').click();

    await expect(page.getByTestId('mixer-source-availability')).toHaveText(
      'No Audio Track',
      { timeout: 5000 },
    );
    await expect
      .poll(async () => {
        const s = await sampleSpectrum(page);
        return s !== null && s.db1200 > -35;
      })
      .toBe(true);
    expect((await sampleSpectrum(page))?.streamId).toBe(initialStreamId);

    // 8. Verify strict Web Audio graph invariants:
    // - createMediaElementSource called ONCE for the studio's <video>
    // - ZERO microphone-to-speaker paths
    // - Exactly ONE speaker destination connection (for monitored source video)
    const audit = await getMixerAudit(page);
    expect(audit.mediaElementSourceCalls).toBe(1);
    expect(audit.micToSpeakerPaths).toBe(0);
    expect(audit.speakerDestinationConnections).toBe(1);
  });

  test('surfaces Enable Audio button under autoplay suspension and Passes WCAG 2.1 AA + keyboard + responsive checks at 375, 768, 1280, and 1440', async ({
    page,
  }) => {
    await installSyntheticToneDevicesAndAuditor(page, {
      forceInitialSuspend: true,
    });
    await page.goto('./');

    // Load source video while AudioContext is autoplay-suspended
    await page
      .getByTestId('source-file-input')
      .setInputFiles(SOURCE_440HZ_PATH);
    await expect(page.getByTestId('mixer-status-badge')).toHaveText(
      'Audio Suspended',
    );
    await expect(page.getByTestId('enable-audio-button')).toBeVisible();

    // Permit user-gesture resume and click Enable Audio
    await page.evaluate(() => {
      (
        window as unknown as {
          __audioMixerTestHarness: { allowUserGestureResume: () => void };
        }
      ).__audioMixerTestHarness.allowUserGestureResume();
    });
    await page.getByTestId('enable-audio-button').click();
    await expect(page.getByTestId('mixer-status-badge')).toHaveText(
      'Audio Live',
    );
    await expect(page.getByTestId('enable-audio-button')).toHaveCount(0);

    // Start microphone and test keyboard operability on mixer sliders & mute toggles
    await page.getByTestId('microphone-toggle-button').click();
    await expect(page.getByTestId('microphone-status-badge')).toHaveText(
      'Live',
    );
    await page.getByTestId('workspace-tab-audio').click();

    const micSlider = page.getByTestId('mixer-mic-gain-slider');
    await micSlider.focus();
    await page.keyboard.press('ArrowRight');
    await expect(page.getByTestId('mixer-mic-gain-value')).toHaveText('101%');

    const micMuteBtn = page.getByTestId('mixer-mic-mute-button');
    await micMuteBtn.focus();
    await page.keyboard.press('Space');
    await expect(page.getByTestId('mixer-mic-gain-value')).toHaveText('Muted');
    await page.keyboard.press('Space');
    await expect(page.getByTestId('mixer-mic-gain-value')).toHaveText('101%');

    // Responsive check across 375px, 768px, 1280px, and 1440px viewports + Axe WCAG 2.1 AA
    for (const vp of [
      { width: 375, height: 812 },
      { width: 768, height: 1024 },
      { width: 1280, height: 800 },
      { width: 1440, height: 900 },
    ]) {
      await page.setViewportSize(vp);
      await expect(page.getByTestId('audio-mixer-panel')).toBeVisible();

      const hasHorizontalOverflow = await page.evaluate(
        () =>
          document.documentElement.scrollWidth >
          document.documentElement.clientWidth,
      );
      expect(
        hasHorizontalOverflow,
        `Unexpected horizontal overflow at ${String(vp.width)}x${String(vp.height)}`,
      ).toBe(false);
    }

    const axeResults = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
      .analyze();
    expect(axeResults.violations).toEqual([]);
  });
});

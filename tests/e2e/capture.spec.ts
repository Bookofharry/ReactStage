import path from 'node:path';
import { fileURLToPath } from 'node:url';
import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SAMPLE_15S_PATH = path.join(__dirname, 'fixtures', 'sample-15s.webm');
const SAMPLE_8S_PATH = path.join(__dirname, 'fixtures', 'sample-8s.webm');

interface NativeMediaAudit {
  readonly getUserMediaCalls: number;
  readonly enumerateDevicesCalls: number;
  readonly audioContextsCreated: number;
  readonly audioContextsClosed: number;
  readonly speakerDestinationConnections: number;
  readonly micToSpeakerPaths: number;
  readonly liveCapturedTracks: number;
}

async function installNativeMediaAuditor(page: Page): Promise<void> {
  await page.addInitScript(() => {
    let getUserMediaCalls = 0;
    let enumerateDevicesCalls = 0;
    let audioContextsCreated = 0;
    let audioContextsClosed = 0;
    let speakerDestinationConnections = 0;
    const trackedStreams: MediaStream[] = [];
    const micSourceNodes: AudioNode[] = [];
    const audioGraphEdges: [AudioNode, AudioNode][] = [];

    const md = navigator.mediaDevices;
    const origGetUserMedia = md.getUserMedia.bind(md);
    const origEnumerateDevices = md.enumerateDevices.bind(md);

    md.getUserMedia = async (
      constraints?: MediaStreamConstraints,
    ): Promise<MediaStream> => {
      getUserMediaCalls += 1;
      const stream = await origGetUserMedia(constraints);
      trackedStreams.push(stream);
      return stream;
    };

    md.enumerateDevices = async (): Promise<MediaDeviceInfo[]> => {
      enumerateDevicesCalls += 1;
      return origEnumerateDevices();
    };

    const OrigAudioContext = window.AudioContext;
    class AuditedAudioContext extends OrigAudioContext {
      public constructor(options?: AudioContextOptions) {
        super(options);
        audioContextsCreated += 1;
      }

      public override createMediaStreamSource(
        mediaStream: MediaStream,
      ): MediaStreamAudioSourceNode {
        const node = super.createMediaStreamSource(mediaStream);
        micSourceNodes.push(node);
        return node;
      }

      public override close(): Promise<void> {
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

    Object.defineProperty(window, '__getNativeMediaAudit', {
      value: (): NativeMediaAudit => {
        let liveCapturedTracks = 0;
        for (const stream of trackedStreams) {
          for (const track of stream.getTracks()) {
            if (track.readyState === 'live') {
              liveCapturedTracks += 1;
            }
          }
        }
        return {
          getUserMediaCalls,
          enumerateDevicesCalls,
          audioContextsCreated,
          audioContextsClosed,
          speakerDestinationConnections,
          micToSpeakerPaths: countMicToSpeakerPaths(),
          liveCapturedTracks,
        };
      },
    });
  });
}

async function getNativeMediaAudit(page: Page): Promise<NativeMediaAudit> {
  return page.evaluate(() => {
    const fn = (
      window as unknown as { __getNativeMediaAudit: () => NativeMediaAudit }
    ).__getNativeMediaAudit;
    return fn();
  });
}

interface ProgrammableHarnessAudit {
  readonly activeTrackIds: string[];
  readonly stoppedTrackIds: string[];
  readonly audioContextsCreated: number;
  readonly audioContextsClosed: number;
  readonly speakerConnections: number;
}

async function installProgrammableSyntheticDevices(page: Page): Promise<void> {
  await page.addInitScript(() => {
    let denyCamera = false;
    let cameraBusy = false;
    let cameraDelayMs = 0;
    let audioContextsCreated = 0;
    let audioContextsClosed = 0;
    let speakerConnections = 0;

    const activeTracks = new Map<string, MediaStreamTrack>();
    const stoppedTrackIds: string[] = [];
    const helperAudioContexts: AudioContext[] = [];

    const OrigAudioContext = window.AudioContext;

    const defaultCam: MediaDeviceInfo = {
      deviceId: 'cam-front',
      kind: 'videoinput',
      label: 'Front Studio Cam',
      groupId: 'grp-cam-1',
      toJSON() {
        return this;
      },
    };
    const overheadCam: MediaDeviceInfo = {
      deviceId: 'cam-overhead',
      kind: 'videoinput',
      label: 'Overhead Desk Cam',
      groupId: 'grp-cam-2',
      toJSON() {
        return this;
      },
    };
    const defaultMic: MediaDeviceInfo = {
      deviceId: 'mic-podcast',
      kind: 'audioinput',
      label: 'USB Podcast Mic',
      groupId: 'grp-mic-1',
      toJSON() {
        return this;
      },
    };
    const lapelMic: MediaDeviceInfo = {
      deviceId: 'mic-lapel',
      kind: 'audioinput',
      label: 'Wireless Lapel Mic',
      groupId: 'grp-mic-2',
      toJSON() {
        return this;
      },
    };
    const devices: MediaDeviceInfo[] = [
      defaultCam,
      overheadCam,
      defaultMic,
      lapelMic,
    ];

    function buildCanvasVideoStream(deviceId: string, label: string): MediaStream {
      const canvas = document.createElement('canvas');
      canvas.width = 640;
      canvas.height = 360;
      const ctx2d = canvas.getContext('2d');
      ctx2d?.fillRect(0, 0, 640, 360);
      const stream = canvas.captureStream(15);
      const track = stream.getVideoTracks()[0];
      if (track) {
        Object.defineProperty(track, 'label', { value: label });
        const origGetSettings = track.getSettings.bind(track);
        track.getSettings = () => ({ ...origGetSettings(), deviceId });
        const origStop = track.stop.bind(track);
        track.stop = () => {
          activeTracks.delete(track.id);
          stoppedTrackIds.push(track.id);
          origStop();
        };
        activeTracks.set(track.id, track);
      }
      return stream;
    }

    function buildOscillatorAudioStream(
      deviceId: string,
      label: string,
    ): MediaStream {
      const helperCtx = new OrigAudioContext();
      helperAudioContexts.push(helperCtx);
      const osc = helperCtx.createOscillator();
      const gain = helperCtx.createGain();
      gain.gain.value = 0.25;
      const dest = helperCtx.createMediaStreamDestination();
      osc.connect(gain);
      gain.connect(dest);
      osc.start();

      const track = dest.stream.getAudioTracks()[0];
      if (track) {
        Object.defineProperty(track, 'label', { value: label });
        const origGetSettings = track.getSettings.bind(track);
        track.getSettings = () => ({ ...origGetSettings(), deviceId });
        const origStop = track.stop.bind(track);
        track.stop = () => {
          activeTracks.delete(track.id);
          stoppedTrackIds.push(track.id);
          osc.stop();
          void helperCtx.close();
          origStop();
        };
        activeTracks.set(track.id, track);
      }
      return dest.stream;
    }

    // Audit app AudioContexts (created after harness wraps window.AudioContext)
    class AuditedAppAudioContext extends OrigAudioContext {
      public constructor(options?: AudioContextOptions) {
        super(options);
        audioContextsCreated += 1;
      }

      public override close(): Promise<void> {
        audioContextsClosed += 1;
        return super.close();
      }
    }
    window.AudioContext = AuditedAppAudioContext;

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
        if (
          typeof AudioDestinationNode !== 'undefined' &&
          destinationNode instanceof AudioDestinationNode
        ) {
          speakerConnections += 1;
        }
        return rawOrigConnect.call(this, destinationNode, ...rest);
      },
    );

    navigator.mediaDevices.enumerateDevices = () => Promise.resolve([...devices]);

    navigator.mediaDevices.getUserMedia = async (
      constraints?: MediaStreamConstraints,
    ): Promise<MediaStream> => {
      if (constraints?.video) {
        if (cameraDelayMs > 0) {
          await new Promise((r) => setTimeout(r, cameraDelayMs));
        }
        if (denyCamera) {
          throw new DOMException('Permission denied', 'NotAllowedError');
        }
        if (cameraBusy) {
          throw new DOMException('Hardware in use', 'NotReadableError');
        }
        const exactId =
          typeof constraints.video === 'object'
            ? (constraints.video.deviceId as { exact?: string } | undefined)
                ?.exact
            : undefined;
        const chosen =
          devices.find(
            (d) => d.kind === 'videoinput' && (!exactId || d.deviceId === exactId),
          ) ?? defaultCam;
        return buildCanvasVideoStream(chosen.deviceId, chosen.label);
      }

      if (constraints?.audio) {
        const exactId =
          typeof constraints.audio === 'object'
            ? (constraints.audio.deviceId as { exact?: string } | undefined)
                ?.exact
            : undefined;
        const chosen =
          devices.find(
            (d) => d.kind === 'audioinput' && (!exactId || d.deviceId === exactId),
          ) ?? defaultMic;
        return buildOscillatorAudioStream(chosen.deviceId, chosen.label);
      }

      throw new DOMException('Invalid constraints', 'NotSupportedError');
    };

    Object.defineProperty(window, '__captureHarness', {
      value: {
        setDenyCamera: (val: boolean) => {
          denyCamera = val;
        },
        setCameraBusy: (val: boolean) => {
          cameraBusy = val;
        },
        setCameraDelayMs: (ms: number) => {
          cameraDelayMs = ms;
        },
        unplugActiveVideoTrack: () => {
          for (const [id, track] of Array.from(activeTracks.entries())) {
            if (track.kind === 'video') {
              activeTracks.delete(id);
              track.dispatchEvent(new Event('ended'));
            }
          }
        },
        getAudit: (): ProgrammableHarnessAudit => ({
          activeTrackIds: Array.from(activeTracks.keys()),
          stoppedTrackIds: [...stoppedTrackIds],
          audioContextsCreated,
          audioContextsClosed,
          speakerConnections,
        }),
      },
    });
  });
}

test.describe('ReactStage — Task 2 Webcam & Microphone Capture E2E', () => {
  test('captures real Chromium synthetic webcam & tone, verifies zero calls on load, zero speaker routing, and full source playback independence', async ({
    context,
    page,
  }) => {
    await context.grantPermissions(['camera', 'microphone']);
    await installNativeMediaAuditor(page);
    await page.goto('./');

    // 1. Verify zero unsolicited capture or Web Audio calls on initial page load
    const initialAudit = await getNativeMediaAudit(page);
    expect(initialAudit.getUserMediaCalls).toBe(0);
    expect(initialAudit.enumerateDevicesCalls).toBe(0);
    expect(initialAudit.audioContextsCreated).toBe(0);

    // 2. Start Webcam from explicit user action
    await page.getByTestId('camera-toggle-button').click();
    await expect(page.getByTestId('camera-status-badge')).toHaveText('Live');

    const previewProps = await page
      .getByTestId('webcam-preview-video')
      .evaluate((el: HTMLVideoElement) => ({
        muted: el.muted,
        playsInline: el.playsInline,
        videoWidth: el.videoWidth,
        videoHeight: el.videoHeight,
        className: el.className,
      }));
    expect(previewProps.muted).toBe(true);
    expect(previewProps.playsInline).toBe(true);
    expect(previewProps.className).toContain('-scale-x-100');

    await expect
      .poll(() =>
        page
          .getByTestId('webcam-preview-video')
          .evaluate((el: HTMLVideoElement) => el.videoWidth),
      )
      .toBeGreaterThan(0);

    // Toggle preview mirror -> CSS changes, raw track stays untouched (no extra getUserMedia)
    await page.getByTestId('camera-mirror-button').click();
    const unmirroredClass = await page
      .getByTestId('webcam-preview-video')
      .getAttribute('class');
    expect(unmirroredClass).not.toContain('-scale-x-100');
    expect((await getNativeMediaAudit(page)).getUserMediaCalls).toBe(1);

    // 3. Start Microphone -> real Web Audio AnalyserNode reads Chromium's synthetic tone
    await page.getByTestId('microphone-toggle-button').click();
    await expect(page.getByTestId('microphone-status-badge')).toHaveText(
      'Live',
    );

    await expect
      .poll(async () => {
        const val = await page
          .getByTestId('microphone-level-meter')
          .getAttribute('aria-valuenow');
        return Number(val ?? '0');
      })
      .toBeGreaterThan(0);

    // Never connect microphone to speaker output
    expect(
      (await getNativeMediaAudit(page)).speakerDestinationConnections,
    ).toBe(0);

    // 4. Full source video lifecycle MUST NOT interrupt live camera or microphone
    await page.getByTestId('source-file-input').setInputFiles(SAMPLE_15S_PATH);
    await expect(page.getByTestId('loaded-file-name')).toHaveText(
      'sample-15s.webm',
    );
    await page.getByTestId('play-pause-button').click();
    await expect
      .poll(() =>
        page
          .getByTestId('source-video-element')
          .evaluate((el: HTMLVideoElement) => el.currentTime),
      )
      .toBeGreaterThan(0.2);
    await page.getByTestId('play-pause-button').click();
    await page.getByTestId('seek-slider').fill('9.0');
    await page.getByTestId('playback-speed-select').selectOption('1.5');
    await page.getByTestId('source-file-input').setInputFiles(SAMPLE_8S_PATH);
    await expect(page.getByTestId('loaded-file-name')).toHaveText(
      'sample-8s.webm',
    );
    await page.getByTestId('unload-video-button').click();

    await expect(page.getByTestId('camera-status-badge')).toHaveText('Live');
    await expect(page.getByTestId('microphone-status-badge')).toHaveText(
      'Live',
    );
    expect((await getNativeMediaAudit(page)).liveCapturedTracks).toBe(2);

    // 5. Stop camera & microphone -> tracks stopped and AudioContext closed
    await page.getByTestId('microphone-toggle-button').click();
    await page.getByTestId('camera-toggle-button').click();

    await expect(page.getByTestId('camera-status-badge')).toHaveText(
      'Camera Off',
    );
    await expect(page.getByTestId('microphone-status-badge')).toHaveText(
      'Mic Off',
    );

    const beforeUnloadAudit = await getNativeMediaAudit(page);
    expect(beforeUnloadAudit.liveCapturedTracks).toBe(0);
    expect(beforeUnloadAudit.micToSpeakerPaths).toBe(0);
    // At most one speaker monitor connection from the source-video monitor bus
    expect(beforeUnloadAudit.speakerDestinationConnections).toBeLessThanOrEqual(
      1,
    );

    // Trigger pagehide disposal and verify all AudioContexts (meter + mixer) close
    await page.evaluate(() => {
      window.dispatchEvent(new PageTransitionEvent('pagehide'));
    });
    const finalAudit = await getNativeMediaAudit(page);
    expect(finalAudit.audioContextsClosed).toBe(finalAudit.audioContextsCreated);
    expect(finalAudit.micToSpeakerPaths).toBe(0);
  });

  test('handles permission denial, live device switching, unexpected track ended, async stop race, and unmount cleanup', async ({
    page,
  }) => {
    await installProgrammableSyntheticDevices(page);
    await page.goto('./');

    // 1. Deny camera permission while allowing microphone independently
    await page.evaluate(() => {
      (
        window as unknown as {
          __captureHarness: { setDenyCamera: (v: boolean) => void };
        }
      ).__captureHarness.setDenyCamera(true);
    });

    await page.getByTestId('camera-toggle-button').click();
    await expect(page.getByTestId('camera-error-alert')).toContainText(
      'PERMISSION_DENIED',
    );

    await page.getByTestId('microphone-toggle-button').click();
    await expect(page.getByTestId('microphone-status-badge')).toHaveText(
      'Live',
    );
    await expect(page.getByTestId('active-microphone-label')).toHaveText(
      'USB Podcast Mic',
    );

    // 2. Grant camera and verify live device switching stops replaced tracks
    await page.evaluate(() => {
      (
        window as unknown as {
          __captureHarness: { setDenyCamera: (v: boolean) => void };
        }
      ).__captureHarness.setDenyCamera(false);
    });

    await page.getByTestId('camera-toggle-button').click();
    await expect(page.getByTestId('active-camera-label')).toHaveText(
      'Front Studio Cam',
    );

    await page
      .getByTestId('camera-device-select')
      .selectOption('cam-overhead');
    await expect(page.getByTestId('active-camera-label')).toHaveText(
      'Overhead Desk Cam',
    );

    await page
      .getByTestId('microphone-device-select')
      .selectOption('mic-lapel');
    await expect(page.getByTestId('active-microphone-label')).toHaveText(
      'Wireless Lapel Mic',
    );

    // 3. Simulate unexpected camera unplug -> camera enters Disconnected, mic stays Live
    await page.evaluate(() => {
      (
        window as unknown as {
          __captureHarness: { unplugActiveVideoTrack: () => void };
        }
      ).__captureHarness.unplugActiveVideoTrack();
    });

    await expect(page.getByTestId('camera-status-badge')).toHaveText(
      'Disconnected',
    );
    await expect(page.getByTestId('camera-error-alert')).toContainText(
      'TRACK_ENDED_UNEXPECTEDLY',
    );
    await expect(page.getByTestId('microphone-status-badge')).toHaveText(
      'Live',
    );

    // 4. Slow in-flight camera request cancelled mid-flight via UI Cancel Camera button
    await page.evaluate(() => {
      (
        window as unknown as {
          __captureHarness: { setCameraDelayMs: (ms: number) => void };
        }
      ).__captureHarness.setCameraDelayMs(300);
    });
    await page.getByTestId('camera-toggle-button').click();
    await expect(page.getByTestId('camera-status-badge')).toHaveText(
      'Requesting…',
    );
    await expect(page.getByTestId('camera-toggle-button')).toHaveText(
      'Cancel Camera',
    );

    // Click Cancel Camera BEFORE the 300ms getUserMedia resolves
    await page.getByTestId('camera-toggle-button').click();
    await expect(page.getByTestId('camera-status-badge')).toHaveText(
      'Camera Off',
    );

    // Wait past the 300ms delay of the cancelled request and verify its late track was stopped
    await page.waitForTimeout(360);
    await expect(page.getByTestId('camera-status-badge')).toHaveText(
      'Camera Off',
    );

    // Stop active microphone and verify zero leaked tracks or AudioContexts
    await page.getByTestId('microphone-toggle-button').click();
    await expect(page.getByTestId('microphone-status-badge')).toHaveText(
      'Mic Off',
    );

    // Trigger pagehide disposal and verify zero leaked tracks, speaker paths, or AudioContexts
    await page.evaluate(() => {
      window.dispatchEvent(new PageTransitionEvent('pagehide'));
    });

    const finalHarnessAudit = await page.evaluate(() => {
      return (
        window as unknown as {
          __captureHarness: { getAudit: () => ProgrammableHarnessAudit };
        }
      ).__captureHarness.getAudit();
    });
    expect(finalHarnessAudit.activeTrackIds).toEqual([]);
    expect(finalHarnessAudit.stoppedTrackIds.length).toBeGreaterThanOrEqual(4);
    expect(finalHarnessAudit.speakerConnections).toBe(0);
    expect(finalHarnessAudit.audioContextsClosed).toBe(
      finalHarnessAudit.audioContextsCreated,
    );
  });

  test('passes WCAG 2.1 AA accessibility and responsive layout checks at 375, 768, and 1440 with active capture', async ({
    context,
    page,
  }) => {
    await context.grantPermissions(['camera', 'microphone']);
    await installProgrammableSyntheticDevices(page);
    await page.goto('./');

    // Start both camera and mic so live preview + live audio meter are rendered
    await page.getByTestId('camera-toggle-button').click();
    await page.getByTestId('microphone-toggle-button').click();
    await expect(page.getByTestId('camera-status-badge')).toHaveText('Live');
    await expect(page.getByTestId('microphone-status-badge')).toHaveText(
      'Live',
    );

    for (const vp of [
      { width: 375, height: 812 },
      { width: 768, height: 1024 },
      { width: 1440, height: 900 },
    ]) {
      await page.setViewportSize(vp);
      const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth > window.innerWidth,
      );
      expect(overflow).toBe(false);
    }

    const activeScan = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
      .analyze();
    expect(activeScan.violations).toEqual([]);

    // Trigger error states on camera and check WCAG AA accessibility of error alerts
    await page.getByTestId('camera-toggle-button').click();
    await page.evaluate(() => {
      (
        window as unknown as {
          __captureHarness: { setCameraBusy: (v: boolean) => void };
        }
      ).__captureHarness.setCameraBusy(true);
    });
    await page.getByTestId('camera-toggle-button').click();
    await expect(page.getByTestId('camera-error-alert')).toContainText(
      'DEVICE_IN_USE',
    );

    const errorScan = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
      .analyze();
    expect(errorScan.violations).toEqual([]);
  });
});

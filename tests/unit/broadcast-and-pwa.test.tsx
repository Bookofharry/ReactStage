import { StrictMode } from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { App } from '../../src/App';
import {
  AUTO_DUCK_SPEECH_RMS_THRESHOLD,
  AUTO_DUCK_TARGET_MULTIPLIER,
  BrowserAudioMixer,
  type MixerAnalyserNodeLike,
  type MixerAudioContextLike,
  type MixerBiquadFilterNodeLike,
  type MixerConnectableNodeLike,
  type MixerDynamicsCompressorNodeLike,
  type MixerGainNodeLike,
} from '../../src/services/audio-mixer';
import { CanvasSceneCompositor } from '../../src/services/scene-compositor';
import { HtmlVideoSourcePlayer } from '../../src/services/source-player';
import { ObjectUrlRegistry } from '../../src/services/source-player/object-url-registry';
import {
  registerStudioServiceWorker,
  type BeforeInstallPromptEvent,
} from '../../src/utils/pwa';
import {
  buildSnapshotFileName,
  exportCanvasPngSnapshot,
} from '../../src/utils/snapshot';

interface SimTrack {
  id: string;
  kind: 'video' | 'audio';
  label: string;
  enabled: boolean;
  muted: boolean;
  readyState: MediaStreamTrackState;
  stop: ReturnType<typeof vi.fn>;
  getSettings: () => MediaTrackSettings;
  addEventListener: (type: string, cb: () => void) => void;
  removeEventListener: (type: string, cb: () => void) => void;
  emit: (type: string) => void;
}

function createFakeTrack(
  kind: 'video' | 'audio',
  label: string,
  settings: MediaTrackSettings = { width: 1920, height: 1080 },
): SimTrack {
  const listeners = new Map<string, Set<() => void>>();
  const track: SimTrack = {
    id: `${kind}-${label.replace(/\s+/g, '-').toLowerCase()}`,
    kind,
    label,
    enabled: true,
    muted: false,
    readyState: 'live',
    stop: vi.fn(() => {
      track.readyState = 'ended';
    }),
    getSettings: () => settings,
    addEventListener(type: string, cb: () => void) {
      let set = listeners.get(type);
      if (!set) {
        set = new Set<() => void>();
        listeners.set(type, set);
      }
      set.add(cb);
    },
    removeEventListener(type: string, cb: () => void) {
      listeners.get(type)?.delete(cb);
    },
    emit(type: string) {
      const set = listeners.get(type);
      if (!set) {
        return;
      }
      for (const cb of set) {
        cb();
      }
    },
  };
  return track;
}

function createFakeStream(
  videoTracks: SimTrack[],
  audioTracks: SimTrack[] = [],
): MediaStream {
  return {
    id: `stream-${String(Math.random()).slice(2, 8)}`,
    active: true,
    getTracks: () => [
      ...(videoTracks as unknown as MediaStreamTrack[]),
      ...(audioTracks as unknown as MediaStreamTrack[]),
    ],
    getVideoTracks: () => videoTracks as unknown as MediaStreamTrack[],
    getAudioTracks: () => audioTracks as unknown as MediaStreamTrack[],
  } as unknown as MediaStream;
}

function createBroadcastAudioGraphHarness() {
  let sourceStreamAmp = 0.5;
  let micStreamAmp = 0;
  let speakerConnections = 0;

  interface GraphNode extends MixerConnectableNodeLike {
    readonly name: string;
    readonly downstream: Set<GraphNode>;
    evalAmp(): number;
  }

  const upstreamOf = new Map<GraphNode, Set<GraphNode>>();

  function wire(from: GraphNode, to: unknown): void {
    const dest = to as GraphNode;
    from.downstream.add(dest);
    let set = upstreamOf.get(dest);
    if (!set) {
      set = new Set<GraphNode>();
      upstreamOf.set(dest, set);
    }
    set.add(from);
  }

  function unwire(from: GraphNode, to?: unknown): void {
    if (to !== undefined) {
      const dest = to as GraphNode;
      from.downstream.delete(dest);
      upstreamOf.get(dest)?.delete(from);
      return;
    }
    for (const dest of from.downstream) {
      upstreamOf.get(dest)?.delete(from);
    }
    from.downstream.clear();
  }

  function sumUpstream(node: GraphNode): number {
    const set = upstreamOf.get(node);
    if (!set) {
      return 0;
    }
    let total = 0;
    for (const parent of set) {
      total += parent.evalAmp();
    }
    return total;
  }

  const speakerDest: GraphNode = {
    name: 'speaker-dest',
    downstream: new Set<GraphNode>(),
    connect: () => undefined,
    disconnect: () => undefined,
    evalAmp: () => sumUpstream(speakerDest),
  };

  let createdFilters = 0;
  let createdCompressors = 0;
  let lastFilterConfig = { type: '' as string, freq: 0, q: 0 };
  let lastCompressorConfig = { threshold: 0, ratio: 0 };

  const ctx: MixerAudioContextLike = {
    state: 'running',
    destination: speakerDest,
    resume: vi.fn(() => Promise.resolve()),
    close: vi.fn(() => Promise.resolve()),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    createGain(): MixerGainNodeLike {
      const gainParam = { value: 1 };
      const node: GraphNode & MixerGainNodeLike = {
        name: 'gain',
        gain: gainParam,
        downstream: new Set<GraphNode>(),
        connect(target: unknown) {
          if (target === speakerDest) {
            speakerConnections += 1;
          }
          wire(node, target);
        },
        disconnect(target?: unknown) {
          unwire(node, target);
        },
        evalAmp: () => sumUpstream(node) * gainParam.value,
      };
      return node;
    },
    createAnalyser(): MixerAnalyserNodeLike {
      const node: GraphNode & MixerAnalyserNodeLike = {
        name: 'analyser',
        fftSize: 512,
        smoothingTimeConstant: 0.5,
        downstream: new Set<GraphNode>(),
        connect(target: unknown) {
          wire(node, target);
        },
        disconnect(target?: unknown) {
          unwire(node, target);
        },
        evalAmp: () => sumUpstream(node),
        getFloatTimeDomainData(array: Float32Array<ArrayBuffer>) {
          const amp = sumUpstream(node);
          for (let i = 0; i < array.length; i += 1) {
            array[i] = i % 2 === 0 ? amp : -amp;
          }
        },
      };
      return node;
    },
    createMediaElementSource() {
      const node: GraphNode = {
        name: 'element-src',
        downstream: new Set<GraphNode>(),
        connect(target: unknown) {
          wire(node, target);
        },
        disconnect(target?: unknown) {
          unwire(node, target);
        },
        evalAmp: () => 0.4,
      };
      return node;
    },
    createMediaStreamSource(stream: MediaStream) {
      const isScreen = stream
        .getAudioTracks()
        .some((t) => t.label.includes('Tab'));
      const node: GraphNode = {
        name: isScreen ? 'screen-stream-src' : 'mic-stream-src',
        downstream: new Set<GraphNode>(),
        connect(target: unknown) {
          if (target === speakerDest) {
            speakerConnections += 1;
          }
          wire(node, target);
        },
        disconnect(target?: unknown) {
          unwire(node, target);
        },
        evalAmp: () => (isScreen ? sourceStreamAmp : micStreamAmp),
      };
      return node;
    },
    createMediaStreamDestination() {
      const fakeMixTrack = createFakeTrack('audio', 'Mixed Audio');
      const stream = createFakeStream([], [fakeMixTrack]);
      const node: GraphNode & { readonly stream: MediaStream } = {
        name: 'mix-dest',
        stream,
        downstream: new Set<GraphNode>(),
        connect: () => undefined,
        disconnect: () => undefined,
        evalAmp: () => sumUpstream(node),
      };
      return node;
    },
    createBiquadFilter(): MixerBiquadFilterNodeLike {
      createdFilters += 1;
      const freq = { value: 350 };
      const q = { value: 1 };
      let filterType: BiquadFilterType = 'lowpass';
      const node: GraphNode & MixerBiquadFilterNodeLike = {
        name: 'biquad-hpf',
        get type() {
          return filterType;
        },
        set type(next: BiquadFilterType) {
          filterType = next;
          lastFilterConfig = { type: next, freq: freq.value, q: q.value };
        },
        frequency: freq,
        Q: q,
        downstream: new Set<GraphNode>(),
        connect(target: unknown) {
          lastFilterConfig = { type: filterType, freq: freq.value, q: q.value };
          wire(node, target);
        },
        disconnect(target?: unknown) {
          unwire(node, target);
        },
        evalAmp: () => sumUpstream(node),
      };
      return node;
    },
    createDynamicsCompressor(): MixerDynamicsCompressorNodeLike {
      createdCompressors += 1;
      const threshold = { value: -24 };
      const knee = { value: 30 };
      const ratio = { value: 12 };
      const attack = { value: 0.003 };
      const release = { value: 0.25 };
      const node: GraphNode & MixerDynamicsCompressorNodeLike = {
        name: 'compressor',
        threshold,
        knee,
        ratio,
        attack,
        release,
        downstream: new Set<GraphNode>(),
        connect(target: unknown) {
          lastCompressorConfig = {
            threshold: threshold.value,
            ratio: ratio.value,
          };
          wire(node, target);
        },
        disconnect(target?: unknown) {
          unwire(node, target);
        },
        evalAmp: () => Math.min(0.85, sumUpstream(node)),
      };
      return node;
    },
  };

  return {
    ctx,
    setSourceStreamAmp(next: number) {
      sourceStreamAmp = next;
    },
    setMicStreamAmp(next: number) {
      micStreamAmp = next;
    },
    getSpeakerConnections: () => speakerConnections,
    getSpeakerAmp: () => speakerDest.evalAmp(),
    getCreatedFilters: () => createdFilters,
    getCreatedCompressors: () => createdCompressors,
    getLastFilterConfig: () => lastFilterConfig,
    getLastCompressorConfig: () => lastCompressorConfig,
  };
}

describe('Tasks 11–14: Screen Share, Voice Auto-Ducking & Mic Clarity, Lower-Thirds & Snapshots, and PWA', () => {
  it('Task 11: HtmlVideoSourcePlayer captures live screen/tab streams, supports freeze/resume, handles native Stop Sharing, and leaks 0 Object URLs', async () => {
    const videoTrack = createFakeTrack('video', 'Browser Tab: React Docs', {
      width: 1920,
      height: 1080,
    });
    const tabAudioTrack = createFakeTrack('audio', 'Tab Audio');
    const screenStream = createFakeStream([videoTrack], [tabAudioTrack]);

    const getDisplayMedia = vi.fn(() => Promise.resolve(screenStream));
    const urlRegistry = new ObjectUrlRegistry({
      createObjectURL: vi.fn((blob: Blob) => `blob:test-${String(blob.size)}`),
      revokeObjectURL: vi.fn(),
    });

    const player = new HtmlVideoSourcePlayer({
      urlRegistry,
      getDisplayMedia,
    });

    const videoEl = document.createElement('video');
    Object.defineProperty(videoEl, 'play', {
      configurable: true,
      value: vi.fn(() => Promise.resolve()),
    });
    Object.defineProperty(videoEl, 'pause', {
      configurable: true,
      value: vi.fn(),
    });
    player.attachVideoElement(videoEl);

    await player.startScreenShare();

    expect(getDisplayMedia).toHaveBeenCalledTimes(1);
    expect(videoEl.muted).toBe(true);
    expect(player.getScreenStream()).toBe(screenStream);
    expect(player.getState().sourceMode).toBe('screen');
    expect(player.getState().status).toBe('playing');
    expect(player.getState().hasScreenAudioTrack).toBe(true);
    expect(player.getState().metadata?.fileName).toBe(
      'Browser Tab: React Docs',
    );
    expect(urlRegistry.getActiveCount()).toBe(0);

    // Freeze live screen frame & resume
    player.pause();
    expect(player.getState().status).toBe('paused');
    await player.play();
    expect(player.getState().status).toBe('playing');

    // Simulate user clicking browser's native "Stop sharing" bar
    videoTrack.emit('ended');
    expect(player.getState().status).toBe('empty');
    expect(player.getState().sourceMode).toBe('file');
    expect(player.getScreenStream()).toBeNull();
    expect(videoTrack.stop).toHaveBeenCalled();
    expect(tabAudioTrack.stop).toHaveBeenCalled();

    player.dispose();
  });

  it('Task 11 & 12: BrowserAudioMixer routes screen-tab audio without speaker echo, auto-ducks source during speech, and wires 85Hz HPF + 4:1 vocal compressor', () => {
    const harness = createBroadcastAudioGraphHarness();
    const mixer = new BrowserAudioMixer({
      createAudioContext: () => harness.ctx,
      scheduler: {
        requestFrame: () => 1,
        cancelFrame: () => undefined,
        now: () => 1000,
      },
    });

    const tabVideoTrack = createFakeTrack('video', 'Shared Tab');
    const tabAudioTrack = createFakeTrack('audio', 'Tab Audio');
    const screenStream = createFakeStream([tabVideoTrack], [tabAudioTrack]);

    const micTrack = createFakeTrack('audio', 'Broadcast Condenser Mic');
    const micStream = createFakeStream([], [micTrack]);

    mixer.attachSourceStream(screenStream, 'Shared Tab');
    mixer.attachMicrophoneStream(micStream, 'Broadcast Condenser Mic');

    // Screen stream audio and mic audio NEVER connect to AudioContext.destination
    expect(harness.getSpeakerConnections()).toBe(0);
    expect(harness.getSpeakerAmp()).toBe(0);

    // Baseline combined mix without auto-ducking
    harness.setSourceStreamAmp(0.5);
    harness.setMicStreamAmp(0);
    const baselineMeters = mixer.sampleMetersNow();
    expect(baselineMeters.sourceRms).toBeCloseTo(0.5, 2);
    expect(baselineMeters.isDucking).toBe(false);
    expect(baselineMeters.duckGainMultiplier).toBe(1);

    // Enable Smart Voice Auto-Ducking and speak into microphone above speech threshold
    mixer.setAutoDuckEnabled(true);
    expect(mixer.getState().autoDuckEnabled).toBe(true);
    harness.setMicStreamAmp(AUTO_DUCK_SPEECH_RMS_THRESHOLD * 4);

    let duckedMeters = mixer.sampleMetersNow();
    for (let tick = 0; tick < 12; tick += 1) {
      duckedMeters = mixer.sampleMetersNow();
    }

    expect(duckedMeters.isDucking).toBe(true);
    expect(duckedMeters.duckGainMultiplier).toBeCloseTo(
      AUTO_DUCK_TARGET_MULTIPLIER,
      1,
    );
    expect(duckedMeters.sourceRms).toBeLessThan(0.2);

    // Silence microphone -> source gain smoothly recovers to 1.0
    harness.setMicStreamAmp(0);
    let recoveredMeters = mixer.sampleMetersNow();
    for (let tick = 0; tick < 30; tick += 1) {
      recoveredMeters = mixer.sampleMetersNow();
    }
    expect(recoveredMeters.isDucking).toBe(false);
    expect(recoveredMeters.duckGainMultiplier).toBeCloseTo(1, 2);
    expect(recoveredMeters.sourceRms).toBeCloseTo(0.5, 2);

    // Enable Broadcast Vocal Processing -> 85Hz highpass + 4:1 compressor with zero speaker connections
    mixer.setMicProcessingEnabled(true);
    expect(mixer.getState().micProcessingEnabled).toBe(true);
    expect(harness.getCreatedFilters()).toBe(1);
    expect(harness.getCreatedCompressors()).toBe(1);
    expect(harness.getLastFilterConfig().type).toBe('highpass');
    expect(harness.getLastFilterConfig().freq).toBe(85);
    expect(harness.getLastCompressorConfig().ratio).toBe(4);
    expect(harness.getSpeakerConnections()).toBe(0);

    mixer.dispose();
  });

  it('Task 13: CanvasSceneCompositor renders Lower-Third banners and exportCanvasPngSnapshot downloads PNG cleanly with 0 leaked URLs', async () => {
    const fillTextCalls: string[] = [];
    const canvas = document.createElement('canvas');
    const fakeCtx = {
      save: vi.fn(),
      restore: vi.fn(),
      fillRect: vi.fn(),
      strokeRect: vi.fn(),
      beginPath: vi.fn(),
      roundRect: vi.fn(),
      rect: vi.fn(),
      arc: vi.fn(),
      fill: vi.fn(),
      stroke: vi.fn(),
      clip: vi.fn(),
      moveTo: vi.fn(),
      lineTo: vi.fn(),
      closePath: vi.fn(),
      drawImage: vi.fn(),
      fillText: vi.fn((text: string) => {
        fillTextCalls.push(text);
      }),
      measureText: vi.fn((text: string) => ({ width: text.length * 9 })),
      fillStyle: '#000',
      strokeStyle: '#000',
      lineWidth: 1,
      font: '',
      textAlign: 'left',
      textBaseline: 'alphabetic',
      imageSmoothingEnabled: true,
      imageSmoothingQuality: 'high',
    } as unknown as CanvasRenderingContext2D;

    vi.spyOn(canvas, 'getContext').mockReturnValue(fakeCtx);

    const compositor = new CanvasSceneCompositor({
      scheduler: {
        requestFrame: () => 1,
        cancelFrame: () => undefined,
        now: () => 1000,
      },
    });
    compositor.attachCanvas(canvas);
    compositor.setLowerThird({
      enabled: true,
      title: 'Tech Architecture Breakdown',
      subtitle: 'Live Episode 14',
    });
    compositor.renderFrameNow();

    expect(fillTextCalls).toContain('Tech Architecture Breakdown');
    expect(fillTextCalls).toContain('Live Episode 14');
    compositor.dispose();

    // Verify PNG snapshot export & deterministic URL revocation
    const createdUrls: string[] = [];
    const revokedUrls: string[] = [];
    const origCreateUrl = URL.createObjectURL.bind(URL);
    const origRevokeUrl = URL.revokeObjectURL.bind(URL);
    URL.createObjectURL = vi.fn(() => {
      const url = `blob:snapshot-${String(createdUrls.length + 1)}`;
      createdUrls.push(url);
      return url;
    });
    URL.revokeObjectURL = vi.fn((url: string) => {
      revokedUrls.push(url);
    });

    Object.defineProperty(canvas, 'toBlob', {
      configurable: true,
      value: (cb: BlobCallback) => {
        cb(new Blob([new Uint8Array([0x89, 0x50, 0x4e, 0x47])], { type: 'image/png' }));
      },
    });

    const clickSpy = vi
      .spyOn(HTMLAnchorElement.prototype, 'click')
      .mockImplementation(() => undefined);

    const targetFileName = buildSnapshotFileName(
      'Tech Architecture Breakdown',
      new Date(2026, 10, 14, 19, 30, 5),
    );
    expect(targetFileName).toBe(
      'reactstage-tech-architecture-breakdown-20261114-193005.png',
    );
    const exported = await exportCanvasPngSnapshot(canvas, targetFileName);
    expect(exported).toBe(true);
    expect(clickSpy).toHaveBeenCalledTimes(1);
    expect(createdUrls).toHaveLength(1);
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(revokedUrls).toEqual(createdUrls);

    clickSpy.mockRestore();
    URL.createObjectURL = origCreateUrl;
    URL.revokeObjectURL = origRevokeUrl;
  });

  it('Tasks 12–14 UI: persists Lower-Third (L hotkey), Auto-Duck & Voice Clarity across StrictMode remounts, and handles PWA install & offline badges', async () => {
    window.localStorage.clear();
    const user = userEvent.setup();

    const firstRender = render(
      <StrictMode>
        <App />
      </StrictMode>,
    );

    // Press hotkey 'L' to toggle Lower-Third banner on stage
    fireEvent.keyDown(window, { key: 'l' });
    expect(screen.getByTestId('lower-third-toggle-button')).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    expect(screen.getByTestId('lower-third-controls-bar')).toBeInTheDocument();

    const titleInput = screen.getByTestId('lower-third-title-input');
    await user.clear(titleInput);
    await user.type(titleInput, 'Live Code Reaction');

    // Toggle Auto-Duck Video and Voice Clarity
    await user.click(screen.getByTestId('mixer-autoduck-toggle'));
    await user.click(screen.getByTestId('mixer-mic-processing-toggle'));

    expect(screen.getByTestId('mixer-autoduck-toggle')).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    expect(screen.getByTestId('mixer-mic-processing-toggle')).toHaveAttribute(
      'aria-pressed',
      'true',
    );

    // Simulate PWA beforeinstallprompt and offline status
    const promptSpy = vi.fn(() => Promise.resolve());
    act(() => {
      const evt = new Event('beforeinstallprompt') as BeforeInstallPromptEvent;
      Object.defineProperty(evt, 'prompt', { value: promptSpy });
      Object.defineProperty(evt, 'userChoice', {
        value: Promise.resolve({ outcome: 'accepted', platform: 'web' }),
      });
      window.dispatchEvent(evt);
      window.dispatchEvent(new Event('offline'));
    });

    expect(screen.getByTestId('header-offline-badge')).toBeInTheDocument();
    const installBtn = screen.getByTestId('install-pwa-button');
    await user.click(installBtn);
    expect(promptSpy).toHaveBeenCalledTimes(1);

    await waitFor(() => {
      expect(
        screen.queryByTestId('install-pwa-button'),
      ).not.toBeInTheDocument();
    });

    act(() => {
      window.dispatchEvent(new Event('online'));
    });
    expect(
      screen.queryByTestId('header-offline-badge'),
    ).not.toBeInTheDocument();

    // Unmount and remount to verify StudioPreferencesStore persistence
    firstRender.unmount();

    const secondRender = render(
      <StrictMode>
        <App />
      </StrictMode>,
    );

    expect(screen.getByTestId('lower-third-toggle-button')).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    expect(screen.getByTestId('lower-third-title-input')).toHaveValue(
      'Live Code Reaction',
    );
    expect(screen.getByTestId('mixer-autoduck-toggle')).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    expect(screen.getByTestId('mixer-mic-processing-toggle')).toHaveAttribute(
      'aria-pressed',
      'true',
    );

    secondRender.unmount();

    // Verify Service Worker registration helper with forceProd
    const registerSpy = vi.fn(() =>
      Promise.resolve({ scope: './' } as ServiceWorkerRegistration),
    );
    Object.defineProperty(navigator, 'serviceWorker', {
      configurable: true,
      value: { register: registerSpy },
    });
    const reg = await registerStudioServiceWorker({ forceProd: true });
    expect(reg).not.toBeNull();
    expect(registerSpy).toHaveBeenCalledTimes(1);
  });
});

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from 'react';
import { BrowserAudioMixer } from '../services/audio-mixer';
import {
  DEFAULT_AUDIO_GAIN,
  MAX_AUDIO_GAIN,
  MIN_AUDIO_GAIN,
  type AudioMeterSnapshot,
  type AudioMixer,
  type AudioMixerStateSnapshot,
} from '../services/interfaces/audio-mixer';
import { useCapture } from './CaptureContext';
import { useSourcePlayback } from './PlaybackContext';

export interface AudioMixerContextValue {
  readonly state: AudioMixerStateSnapshot;
  readonly enableAudio: () => Promise<void>;
  readonly setSourceGain: (gain: number) => void;
  readonly setSourceMuted: (muted: boolean) => void;
  readonly toggleSourceMute: () => void;
  readonly resetSourceGain: () => void;
  readonly setMicrophoneGain: (gain: number) => void;
  readonly setMicrophoneMuted: (muted: boolean) => void;
  readonly toggleMicrophoneMute: () => void;
  readonly resetMicrophoneGain: () => void;
  readonly getMixedOutputStream: () => MediaStream | null;
}

interface DebugWindowWithMixer {
  __REACTSTAGE_AUDIO_MIXER__?: {
    getMixedOutputStream: () => MediaStream | null;
    getState: () => AudioMixerStateSnapshot;
  };
}

const AudioMixerContext = createContext<AudioMixerContextValue | null>(null);
const AudioMixerMetersContext = createContext<AudioMixer | null>(null);

function clampGain(value: number): number {
  return (
    Math.round(
      Math.min(MAX_AUDIO_GAIN, Math.max(MIN_AUDIO_GAIN, value)) * 100,
    ) / 100
  );
}

export interface AudioMixerProviderProps {
  readonly children: ReactNode;
  readonly mixer?: AudioMixer;
}

export function AudioMixerProvider({
  children,
  mixer: externalMixer,
}: AudioMixerProviderProps) {
  const {
    state: playbackState,
    videoRef,
    setVolume,
    setMuted,
    setExternalAudioControl,
  } = useSourcePlayback();
  const { snapshot: captureSnapshot } = useCapture();

  const [internalMixer] = useState<AudioMixer>(() => new BrowserAudioMixer());
  const activeMixer = externalMixer ?? internalMixer;

  const subscribeState = useCallback(
    (listener: () => void) => activeMixer.subscribe(listener),
    [activeMixer],
  );
  const getStateSnapshot = useCallback(
    () => activeMixer.getState(),
    [activeMixer],
  );

  const state = useSyncExternalStore(
    subscribeState,
    getStateSnapshot,
    getStateSnapshot,
  );

  // Attach borrowed HTMLVideoElement; StrictMode-safe cleanup vs true unmount disposal
  useEffect(() => {
    const currentVideoEl = videoRef.current;
    activeMixer.attachSourceElement(currentVideoEl);

    if (typeof window !== 'undefined') {
      (window as unknown as DebugWindowWithMixer).__REACTSTAGE_AUDIO_MIXER__ = {
        getMixedOutputStream: () => activeMixer.getMixedOutputStream(),
        getState: () => activeMixer.getState(),
      };
    }

    const handlePageHide = () => {
      activeMixer.dispose();
    };
    if (typeof window !== 'undefined') {
      window.addEventListener('pagehide', handlePageHide);
    }

    return () => {
      if (typeof window !== 'undefined') {
        window.removeEventListener('pagehide', handlePageHide);
      }

      if (!currentVideoEl?.isConnected) {
        if (typeof window !== 'undefined') {
          delete (window as unknown as DebugWindowWithMixer)
            .__REACTSTAGE_AUDIO_MIXER__;
        }
        activeMixer.dispose();
      } else {
        activeMixer.suspendMonitoring();
      }
    };
  }, [activeMixer, videoRef]);

  // Delegate HTMLVideoElement gain/mute to Web Audio as soon as MediaElementAudioSourceNode binds
  useEffect(() => {
    const currentVideoEl = videoRef.current;
    setExternalAudioControl(state.isSourceElementBound);
    return () => {
      if (!currentVideoEl?.isConnected) {
        setExternalAudioControl(false);
      }
    };
  }, [setExternalAudioControl, state.isSourceElementBound, videoRef]);

  // Sync source playback lifecycle & metadata into AudioMixer without mutating playback
  useEffect(() => {
    const hasPlayableSource =
      playbackState.status === 'ready' ||
      playbackState.status === 'playing' ||
      playbackState.status === 'paused' ||
      playbackState.status === 'ended';

    activeMixer.attachSourceElement(videoRef.current);
    activeMixer.updateSourceDescriptor({
      hasSource: hasPlayableSource && playbackState.objectUrl !== null,
      isPlaying: playbackState.status === 'playing',
      isPaused:
        playbackState.status === 'ready' ||
        playbackState.status === 'paused' ||
        playbackState.status === 'ended',
      label: playbackState.metadata?.fileName ?? null,
    });
  }, [
    activeMixer,
    videoRef,
    playbackState.status,
    playbackState.objectUrl,
    playbackState.metadata?.fileName,
  ]);

  // Unify PlaybackControls volume/mute with AudioMixer source channel
  useEffect(() => {
    activeMixer.setSourceChannel({
      gain: playbackState.volume,
      muted: playbackState.muted,
    });
  }, [activeMixer, playbackState.volume, playbackState.muted]);

  // Borrow active microphone stream from CaptureManager read-only
  useEffect(() => {
    activeMixer.attachMicrophoneStream(
      captureSnapshot.activeMicrophoneStream,
      captureSnapshot.activeMicrophoneLabel,
    );
  }, [
    activeMixer,
    captureSnapshot.activeMicrophoneStream,
    captureSnapshot.activeMicrophoneLabel,
  ]);

  const enableAudio = useCallback(async () => {
    await activeMixer.resume();
  }, [activeMixer]);

  const setSourceGain = useCallback(
    (gain: number) => {
      if (!Number.isFinite(gain)) {
        return;
      }
      const clamped = clampGain(gain);
      const current = activeMixer.getState().sourceChannel;
      const nextMuted = clamped > 0 && current.muted ? false : current.muted;

      activeMixer.setSourceChannel({ gain: clamped, muted: nextMuted });
      setVolume(clamped);
      if (nextMuted !== playbackState.muted) {
        setMuted(nextMuted);
      }
    },
    [activeMixer, playbackState.muted, setMuted, setVolume],
  );

  const setSourceMuted = useCallback(
    (muted: boolean) => {
      const current = activeMixer.getState().sourceChannel;
      activeMixer.setSourceChannel({ gain: current.gain, muted });
      setMuted(muted);
    },
    [activeMixer, setMuted],
  );

  const toggleSourceMute = useCallback(() => {
    const nextMuted = !activeMixer.getState().sourceChannel.muted;
    setSourceMuted(nextMuted);
  }, [activeMixer, setSourceMuted]);

  const resetSourceGain = useCallback(() => {
    setSourceGain(DEFAULT_AUDIO_GAIN);
  }, [setSourceGain]);

  const setMicrophoneGain = useCallback(
    (gain: number) => {
      if (!Number.isFinite(gain)) {
        return;
      }
      const clamped = clampGain(gain);
      const current = activeMixer.getState().microphoneChannel;
      const nextMuted = clamped > 0 && current.muted ? false : current.muted;
      activeMixer.setMicrophoneChannel({ gain: clamped, muted: nextMuted });
    },
    [activeMixer],
  );

  const setMicrophoneMuted = useCallback(
    (muted: boolean) => {
      const current = activeMixer.getState().microphoneChannel;
      activeMixer.setMicrophoneChannel({ gain: current.gain, muted });
    },
    [activeMixer],
  );

  const toggleMicrophoneMute = useCallback(() => {
    const current = activeMixer.getState().microphoneChannel;
    activeMixer.setMicrophoneChannel({
      gain: current.gain,
      muted: !current.muted,
    });
  }, [activeMixer]);

  const resetMicrophoneGain = useCallback(() => {
    setMicrophoneGain(DEFAULT_AUDIO_GAIN);
  }, [setMicrophoneGain]);

  const getMixedOutputStream = useCallback(
    () => activeMixer.getMixedOutputStream(),
    [activeMixer],
  );

  const value = useMemo<AudioMixerContextValue>(
    () => ({
      state,
      enableAudio,
      setSourceGain,
      setSourceMuted,
      toggleSourceMute,
      resetSourceGain,
      setMicrophoneGain,
      setMicrophoneMuted,
      toggleMicrophoneMute,
      resetMicrophoneGain,
      getMixedOutputStream,
    }),
    [
      state,
      enableAudio,
      setSourceGain,
      setSourceMuted,
      toggleSourceMute,
      resetSourceGain,
      setMicrophoneGain,
      setMicrophoneMuted,
      toggleMicrophoneMute,
      resetMicrophoneGain,
      getMixedOutputStream,
    ],
  );

  return (
    <AudioMixerContext.Provider value={value}>
      <AudioMixerMetersContext.Provider value={activeMixer}>
        {children}
      </AudioMixerMetersContext.Provider>
    </AudioMixerContext.Provider>
  );
}

// eslint-disable-next-line react-refresh/only-export-components
export function useAudioMixer(): AudioMixerContextValue {
  const ctx = useContext(AudioMixerContext);
  if (!ctx) {
    throw new Error('useAudioMixer must be used within an AudioMixerProvider');
  }
  return ctx;
}

// eslint-disable-next-line react-refresh/only-export-components
export function useAudioMixerMeters(): AudioMeterSnapshot {
  const mixer = useContext(AudioMixerMetersContext);
  if (!mixer) {
    throw new Error(
      'useAudioMixerMeters must be used within an AudioMixerProvider',
    );
  }

  const subscribe = useCallback(
    (listener: () => void) => mixer.subscribeMeters(listener),
    [mixer],
  );
  const getSnapshot = useCallback(() => mixer.getMeterSnapshot(), [mixer]);

  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}

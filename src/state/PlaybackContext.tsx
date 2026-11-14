import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type ReactNode,
  type RefObject,
} from 'react';
import type { SourcePlayer } from '../services/interfaces/source-player';
import { HtmlVideoSourcePlayer } from '../services/source-player';
import type { PlaybackSpeed, SourcePlaybackState } from '../types/media';

export interface SourcePlaybackContextValue {
  readonly state: SourcePlaybackState;
  readonly videoRef: RefObject<HTMLVideoElement | null>;
  readonly loadFile: (file: File) => void;
  readonly unload: () => void;
  readonly play: () => Promise<void>;
  readonly pause: () => void;
  readonly togglePlayPause: () => Promise<void>;
  readonly seek: (timeSec: number) => void;
  readonly rewind: (seconds?: number) => void;
  readonly restart: () => void;
  readonly setPlaybackRate: (rate: PlaybackSpeed) => void;
  readonly setVolume: (volume: number) => void;
  readonly setMuted: (muted: boolean) => void;
  readonly toggleMute: () => void;
  readonly setExternalAudioControl: (enabled: boolean) => void;
}

const SourcePlaybackContext = createContext<SourcePlaybackContextValue | null>(null);

export interface SourcePlaybackProviderProps {
  readonly children: ReactNode;
  readonly player?: SourcePlayer;
}

export function SourcePlaybackProvider({
  children,
  player: externalPlayer,
}: SourcePlaybackProviderProps) {
  const [internalPlayer] = useState<SourcePlayer>(() => new HtmlVideoSourcePlayer());
  const activePlayer = externalPlayer ?? internalPlayer;
  const videoRef = useRef<HTMLVideoElement | null>(null);

  const subscribe = useCallback(
    (listener: () => void) => activePlayer.subscribe(listener),
    [activePlayer],
  );
  const getSnapshot = useCallback(() => activePlayer.getState(), [activePlayer]);

  const state = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);

  useEffect(() => {
    activePlayer.attachVideoElement(videoRef.current);
    return () => {
      activePlayer.attachVideoElement(null);
      activePlayer.unload();
    };
  }, [activePlayer]);

  const loadFile = useCallback(
    (file: File) => {
      activePlayer.loadFile(file);
    },
    [activePlayer],
  );

  const unload = useCallback(() => {
    activePlayer.unload();
  }, [activePlayer]);

  const play = useCallback(() => activePlayer.play(), [activePlayer]);
  const pause = useCallback(() => activePlayer.pause(), [activePlayer]);
  const togglePlayPause = useCallback(
    () => activePlayer.togglePlayPause(),
    [activePlayer],
  );
  const seek = useCallback(
    (timeSec: number) => activePlayer.seek(timeSec),
    [activePlayer],
  );
  const rewind = useCallback(
    (seconds?: number) => activePlayer.rewind(seconds),
    [activePlayer],
  );
  const restart = useCallback(() => activePlayer.restart(), [activePlayer]);
  const setPlaybackRate = useCallback(
    (rate: PlaybackSpeed) => activePlayer.setPlaybackRate(rate),
    [activePlayer],
  );
  const setVolume = useCallback(
    (volume: number) => activePlayer.setVolume(volume),
    [activePlayer],
  );
  const setMuted = useCallback(
    (muted: boolean) => activePlayer.setMuted(muted),
    [activePlayer],
  );
  const toggleMute = useCallback(() => activePlayer.toggleMute(), [activePlayer]);
  const setExternalAudioControl = useCallback(
    (enabled: boolean) => {
      activePlayer.setExternalAudioControl?.(enabled);
    },
    [activePlayer],
  );

  const value = useMemo<SourcePlaybackContextValue>(
    () => ({
      state,
      videoRef,
      loadFile,
      unload,
      play,
      pause,
      togglePlayPause,
      seek,
      rewind,
      restart,
      setPlaybackRate,
      setVolume,
      setMuted,
      toggleMute,
      setExternalAudioControl,
    }),
    [
      state,
      loadFile,
      unload,
      play,
      pause,
      togglePlayPause,
      seek,
      rewind,
      restart,
      setPlaybackRate,
      setVolume,
      setMuted,
      toggleMute,
      setExternalAudioControl,
    ],
  );

  return (
    <SourcePlaybackContext.Provider value={value}>
      {children}
    </SourcePlaybackContext.Provider>
  );
}

// eslint-disable-next-line react-refresh/only-export-components
export function useSourcePlayback(): SourcePlaybackContextValue {
  const ctx = useContext(SourcePlaybackContext);
  if (!ctx) {
    throw new Error('useSourcePlayback must be used within a SourcePlaybackProvider');
  }
  return ctx;
}

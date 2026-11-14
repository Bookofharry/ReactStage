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
} from 'react';
import {
  DEFAULT_AUDIO_BITS_PER_SECOND,
  DEFAULT_RECORDING_TIMESLICE_MS,
  DEFAULT_VIDEO_BITS_PER_SECOND,
  type RecordedMediaArtifact,
  type RecordingChapterMarker,
  type RecordingEngine,
  type RecordingEngineError,
  type RecordingStateSnapshot,
  type RecordingTelemetry,
} from '../services/interfaces/recording-engine';
import { BrowserRecordingEngine } from '../services/recording-engine';
import type {
  RecordingSessionState,
  StudioSlotReadiness,
} from '../types/media';
import { useAudioMixer } from './AudioMixerContext';
import { useCapture } from './CaptureContext';
import { useSceneCompositor } from './CompositorContext';
import { useSourcePlayback } from './PlaybackContext';

export const DEFAULT_PREROLL_SECONDS = 3;
export const DEFAULT_COUNTDOWN_STEP_MS = 1000;

// eslint-disable-next-line react-refresh/only-export-components
export function createInitialRecordingSessionState(): RecordingSessionState {
  return {
    status: 'idle',
    elapsedRecordingMs: 0,
    layoutMode: 'pip',
    webcamSlotStatus: 'ready',
    recordingSlotStatus: 'ready',
    exportSlotStatus: 'ready',
    sessionError: null,
  };
}

export interface RequestStartRecordingOptions {
  readonly forcePreRoll?: boolean;
}

export interface RecordingSessionContextValue {
  readonly session: RecordingSessionState;
  readonly engineState: RecordingStateSnapshot;
  readonly activeMarkers: readonly RecordingChapterMarker[];
  readonly localOrchestrationError: RecordingEngineError | null;
  readonly preRollEnabled: boolean;
  readonly countdownSecondsRemaining: number | null;
  readonly setPreRollEnabled: (enabled: boolean) => void;
  readonly togglePreRoll: () => void;
  readonly startRecording: () => Promise<void>;
  readonly requestStartRecording: (
    options?: RequestStartRecordingOptions,
  ) => Promise<void>;
  readonly skipCountdownAndStart: () => Promise<void>;
  readonly cancelCountdown: () => void;
  readonly pauseRecording: () => void;
  readonly resumeRecording: () => void;
  readonly togglePauseRecording: () => void;
  readonly addChapterMarker: (
    customLabel?: string,
  ) => RecordingChapterMarker | null;
  readonly stopRecording: () => Promise<RecordedMediaArtifact | null>;
  readonly cancelRecording: () => void;
  readonly discardRecording: () => void;
}

interface DebugWindowWithRecorder {
  __REACTSTAGE_RECORDING_ENGINE__?: {
    getState: () => RecordingStateSnapshot;
    getTelemetry: () => RecordingTelemetry;
    getLastArtifact: () => RecordedMediaArtifact | null;
  };
}

const RecordingSessionContext =
  createContext<RecordingSessionContextValue | null>(null);
const RecordingTelemetryContext = createContext<RecordingEngine | null>(null);

export interface RecordingSessionProviderProps {
  readonly children: ReactNode;
  readonly engine?: RecordingEngine;
  readonly initialState?: RecordingSessionState;
  readonly countdownStepMs?: number;
}

export function RecordingSessionProvider({
  children,
  engine: externalEngine,
  initialState,
  countdownStepMs = DEFAULT_COUNTDOWN_STEP_MS,
}: RecordingSessionProviderProps) {
  const { snapshot: captureSnapshot } = useCapture();
  const { state: playbackState } = useSourcePlayback();
  const {
    state: mixerState,
    enableAudio,
    getMixedOutputStream,
  } = useAudioMixer();
  const {
    state: compositorState,
    canvasRef,
    captureSceneStream,
  } = useSceneCompositor();

  const [internalEngine] = useState<RecordingEngine>(
    () => new BrowserRecordingEngine(),
  );
  const activeEngine = externalEngine ?? internalEngine;

  const [localError, setLocalError] = useState<RecordingEngineError | null>(
    null,
  );
  const [preRollEnabled, setPreRollEnabled] = useState(false);
  const [countdownSecondsRemaining, setCountdownSecondsRemaining] = useState<
    number | null
  >(null);

  const countdownTokenRef = useRef(0);
  const countdownTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const clearCountdownTimerOnly = useCallback(() => {
    countdownTokenRef.current += 1;
    if (countdownTimerRef.current !== null) {
      clearTimeout(countdownTimerRef.current);
      countdownTimerRef.current = null;
    }
  }, []);

  const cancelCountdown = useCallback(() => {
    clearCountdownTimerOnly();
    setCountdownSecondsRemaining(null);
  }, [clearCountdownTimerOnly]);

  const togglePreRoll = useCallback(() => {
    setPreRollEnabled((prev) => !prev);
  }, []);

  const subscribeState = useCallback(
    (listener: () => void) => activeEngine.subscribeState(listener),
    [activeEngine],
  );
  const getStateSnapshot = useCallback(
    () => activeEngine.getState(),
    [activeEngine],
  );

  const engineState = useSyncExternalStore(
    subscribeState,
    getStateSnapshot,
    getStateSnapshot,
  );

  useEffect(() => {
    const currentCanvasEl = canvasRef.current;

    if (typeof window !== 'undefined') {
      (
        window as unknown as DebugWindowWithRecorder
      ).__REACTSTAGE_RECORDING_ENGINE__ = {
        getState: () => activeEngine.getState(),
        getTelemetry: () => activeEngine.getTelemetry(),
        getLastArtifact: () => activeEngine.getState().lastArtifact,
      };
    }

    const handlePageHide = () => {
      clearCountdownTimerOnly();
      activeEngine.dispose();
    };
    if (typeof window !== 'undefined') {
      window.addEventListener('pagehide', handlePageHide);
    }

    return () => {
      clearCountdownTimerOnly();
      if (typeof window !== 'undefined') {
        window.removeEventListener('pagehide', handlePageHide);
      }
      if (!currentCanvasEl?.isConnected) {
        if (typeof window !== 'undefined') {
          delete (window as unknown as DebugWindowWithRecorder)
            .__REACTSTAGE_RECORDING_ENGINE__;
        }
        activeEngine.dispose();
      } else {
        const status = activeEngine.getState().status;
        if (
          status === 'arming' ||
          status === 'recording' ||
          status === 'paused'
        ) {
          activeEngine.cancel();
        }
      }
    };
  }, [activeEngine, canvasRef, clearCountdownTimerOnly]);

  const startRecording = useCallback(async (): Promise<void> => {
    clearCountdownTimerOnly();
    setCountdownSecondsRemaining(null);
    setLocalError(null);

    if (compositorState.lastError) {
      setLocalError({
        code: 'SCENE_STREAM_UNAVAILABLE',
        title: 'Scene stage has an error',
        message: compositorState.lastError.message,
        recoverable: true,
      });
      return;
    }

    // Unlock/initialize Web Audio inside the explicit user gesture so the
    // mixed destination stream has 1 persistent live audio track ready.
    if (mixerState.status !== 'unavailable') {
      try {
        await enableAudio();
      } catch {
        // Proceed with video-only fallback if Web Audio cannot start
      }
    }

    const sceneStream = captureSceneStream(compositorState.targetFps);
    if (!sceneStream) {
      setLocalError({
        code: 'SCENE_STREAM_UNAVAILABLE',
        title: 'Scene stream unavailable',
        message:
          'This browser environment does not support HTMLCanvasElement.captureStream() for scene recording.',
        recoverable: false,
      });
      return;
    }

    const mixedAudioStream = getMixedOutputStream();

    try {
      await activeEngine.start(sceneStream, mixedAudioStream, {
        videoBitsPerSecond: DEFAULT_VIDEO_BITS_PER_SECOND,
        audioBitsPerSecond: DEFAULT_AUDIO_BITS_PER_SECOND,
        timesliceMs: DEFAULT_RECORDING_TIMESLICE_MS,
        width: compositorState.width,
        height: compositorState.height,
        stopVideoTracksOnFinalize: true,
      });
    } catch {
      // Engine state snapshot already holds the structured RecordingEngineError
    }
  }, [
    activeEngine,
    captureSceneStream,
    clearCountdownTimerOnly,
    compositorState.height,
    compositorState.lastError,
    compositorState.targetFps,
    compositorState.width,
    enableAudio,
    getMixedOutputStream,
    mixerState.status,
  ]);

  const startRecordingRef = useRef(startRecording);
  useEffect(() => {
    startRecordingRef.current = startRecording;
  }, [startRecording]);

  const requestStartRecording = useCallback(
    async (options?: RequestStartRecordingOptions): Promise<void> => {
      const currentStatus = activeEngine.getState().status;
      if (
        currentStatus === 'arming' ||
        currentStatus === 'recording' ||
        currentStatus === 'paused' ||
        currentStatus === 'stopping' ||
        countdownSecondsRemaining !== null
      ) {
        return;
      }

      const usePreRoll = Boolean(options?.forcePreRoll) || preRollEnabled;
      if (!usePreRoll) {
        await startRecording();
        return;
      }

      setLocalError(null);
      if (compositorState.lastError) {
        setLocalError({
          code: 'SCENE_STREAM_UNAVAILABLE',
          title: 'Scene stage has an error',
          message: compositorState.lastError.message,
          recoverable: true,
        });
        return;
      }

      // Unlock Web Audio synchronously inside the user gesture before pre-roll ticks
      if (mixerState.status !== 'unavailable') {
        try {
          await enableAudio();
        } catch {
          // Proceed even if Web Audio fallback applies
        }
      }

      clearCountdownTimerOnly();
      const token = countdownTokenRef.current;
      const stepDelay = Math.max(20, countdownStepMs);

      const scheduleTick = (remaining: number) => {
        if (countdownTokenRef.current !== token) {
          return;
        }
        if (remaining <= 0) {
          countdownTimerRef.current = null;
          setCountdownSecondsRemaining(null);
          void startRecordingRef.current();
          return;
        }
        setCountdownSecondsRemaining(remaining);
        countdownTimerRef.current = setTimeout(() => {
          scheduleTick(remaining - 1);
        }, stepDelay);
      };

      scheduleTick(DEFAULT_PREROLL_SECONDS);
    },
    [
      activeEngine,
      clearCountdownTimerOnly,
      compositorState.lastError,
      countdownSecondsRemaining,
      countdownStepMs,
      enableAudio,
      mixerState.status,
      preRollEnabled,
      startRecording,
    ],
  );

  const skipCountdownAndStart = useCallback(async (): Promise<void> => {
    if (countdownSecondsRemaining === null) {
      return;
    }
    await startRecording();
  }, [countdownSecondsRemaining, startRecording]);

  const pauseRecording = useCallback(() => {
    activeEngine.pause();
  }, [activeEngine]);

  const resumeRecording = useCallback(() => {
    activeEngine.resume();
  }, [activeEngine]);

  const togglePauseRecording = useCallback(() => {
    const status = activeEngine.getState().status;
    if (status === 'recording') {
      activeEngine.pause();
    } else if (status === 'paused') {
      activeEngine.resume();
    }
  }, [activeEngine]);

  const addChapterMarker = useCallback(
    (customLabel?: string): RecordingChapterMarker | null => {
      if (typeof activeEngine.addChapterMarker !== 'function') {
        return null;
      }
      const isSourcePlayable =
        playbackState.status === 'ready' ||
        playbackState.status === 'playing' ||
        playbackState.status === 'paused' ||
        playbackState.status === 'ended';
      return activeEngine.addChapterMarker({
        label: customLabel,
        sourceTimeSec: isSourcePlayable ? playbackState.currentTimeSec : null,
        layoutMode: compositorState.layoutMode,
      });
    },
    [
      activeEngine,
      compositorState.layoutMode,
      playbackState.currentTimeSec,
      playbackState.status,
    ],
  );

  const stopRecording =
    useCallback(async (): Promise<RecordedMediaArtifact | null> => {
      clearCountdownTimerOnly();
      setCountdownSecondsRemaining(null);
      try {
        return await activeEngine.stop();
      } catch {
        return null;
      }
    }, [activeEngine, clearCountdownTimerOnly]);

  const cancelRecording = useCallback(() => {
    clearCountdownTimerOnly();
    setCountdownSecondsRemaining(null);
    setLocalError(null);
    activeEngine.cancel();
  }, [activeEngine, clearCountdownTimerOnly]);

  const discardRecording = useCallback(() => {
    setLocalError(null);
    activeEngine.clearArtifact();
  }, [activeEngine]);

  const webcamSlotStatus: StudioSlotReadiness =
    captureSnapshot.cameraStatus === 'active'
      ? 'active'
      : captureSnapshot.cameraStatus === 'error'
        ? 'error'
        : 'ready';

  const effectiveError = localError ?? engineState.error;

  const recordingSlotStatus: StudioSlotReadiness =
    effectiveError !== null || engineState.status === 'error'
      ? 'error'
      : countdownSecondsRemaining !== null ||
          engineState.status === 'recording' ||
          engineState.status === 'paused' ||
          engineState.status === 'arming' ||
          engineState.status === 'stopping'
        ? 'active'
        : 'ready';

  const session = useMemo<RecordingSessionState>(() => {
    if (initialState) {
      return initialState;
    }
    const telemetry = activeEngine.getTelemetry();
    const exportSlotStatus: StudioSlotReadiness =
      engineState.lastArtifact !== null ? 'active' : 'ready';
    return {
      status: localError ? 'error' : engineState.status,
      elapsedRecordingMs: telemetry.elapsedRecordingMs,
      layoutMode: compositorState.layoutMode,
      webcamSlotStatus,
      recordingSlotStatus,
      exportSlotStatus,
      sessionError: effectiveError?.message ?? null,
    };
  }, [
    activeEngine,
    compositorState.layoutMode,
    effectiveError,
    engineState.lastArtifact,
    engineState.status,
    initialState,
    localError,
    recordingSlotStatus,
    webcamSlotStatus,
  ]);

  const activeMarkers = useMemo<readonly RecordingChapterMarker[]>(
    () => engineState.activeMarkers ?? [],
    [engineState.activeMarkers],
  );

  const value = useMemo<RecordingSessionContextValue>(
    () => ({
      session,
      engineState,
      activeMarkers,
      localOrchestrationError: localError,
      preRollEnabled,
      countdownSecondsRemaining,
      setPreRollEnabled,
      togglePreRoll,
      startRecording,
      requestStartRecording,
      skipCountdownAndStart,
      cancelCountdown,
      pauseRecording,
      resumeRecording,
      togglePauseRecording,
      addChapterMarker,
      stopRecording,
      cancelRecording,
      discardRecording,
    }),
    [
      activeMarkers,
      addChapterMarker,
      cancelCountdown,
      cancelRecording,
      countdownSecondsRemaining,
      discardRecording,
      engineState,
      localError,
      pauseRecording,
      preRollEnabled,
      requestStartRecording,
      resumeRecording,
      session,
      skipCountdownAndStart,
      startRecording,
      stopRecording,
      togglePauseRecording,
      togglePreRoll,
    ],
  );

  return (
    <RecordingSessionContext.Provider value={value}>
      <RecordingTelemetryContext.Provider value={activeEngine}>
        {children}
      </RecordingTelemetryContext.Provider>
    </RecordingSessionContext.Provider>
  );
}

// eslint-disable-next-line react-refresh/only-export-components
export function useRecordingSession(): RecordingSessionContextValue {
  const ctx = useContext(RecordingSessionContext);
  if (!ctx) {
    throw new Error(
      'useRecordingSession must be used within a RecordingSessionProvider',
    );
  }
  return ctx;
}

// eslint-disable-next-line react-refresh/only-export-components
export function useRecordingTelemetry(): RecordingTelemetry {
  const engine = useContext(RecordingTelemetryContext);
  if (!engine) {
    throw new Error(
      'useRecordingTelemetry must be used within a RecordingSessionProvider',
    );
  }

  const subscribe = useCallback(
    (listener: () => void) => engine.subscribe(listener),
    [engine],
  );
  const getSnapshot = useCallback(() => engine.getTelemetry(), [engine]);

  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}

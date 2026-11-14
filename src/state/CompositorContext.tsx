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
import type {
  CompositorDiagnostics,
  CompositorStateSnapshot,
  NormalizedScenePoint,
  PipOverlayRect,
  SceneCompositor,
  StageAnnotation,
} from '../services/interfaces/scene-compositor';
import {
  CanvasSceneCompositor,
  DEFAULT_PIP_RECT,
  DEFAULT_SPLIT_RATIO,
  getPipCornerPresetRect,
  nudgePipRect,
  resizePipRect,
  type PipCornerPreset,
} from '../services/scene-compositor';
import {
  DEFAULT_TELESTRATOR_COLOR,
  type PipBorderStyle,
  type PipFrameShape,
  type SceneResolutionPreset,
  type StageLayoutMode,
  type TelestratorTool,
} from '../types/media';
import { useCapture } from './CaptureContext';
import { useSourcePlayback } from './PlaybackContext';

export interface SceneCompositorContextValue {
  readonly state: CompositorStateSnapshot;
  readonly canvasRef: RefObject<HTMLCanvasElement | null>;
  readonly activeTool: TelestratorTool;
  readonly activeColor: string;
  readonly setActiveTool: (tool: TelestratorTool) => void;
  readonly setActiveColor: (hex: string) => void;
  readonly setLayoutMode: (mode: StageLayoutMode) => void;
  readonly setResolution: (preset: SceneResolutionPreset) => void;
  readonly setPipRect: (rect: PipOverlayRect) => void;
  readonly setPipFrameShape: (shape: PipFrameShape) => void;
  readonly setPipBorderStyle: (border: PipBorderStyle) => void;
  readonly movePipBy: (deltaX: number, deltaY: number) => void;
  readonly resizePipBy: (deltaWidth: number, deltaHeight?: number) => void;
  readonly snapPipToCorner: (corner: PipCornerPreset) => void;
  readonly resetPipRect: () => void;
  readonly setSplitRatio: (ratio: number) => void;
  readonly resetSplitRatio: () => void;
  readonly addAnnotation: (annotation: StageAnnotation) => void;
  readonly undoAnnotation: () => boolean;
  readonly clearAnnotations: () => void;
  readonly setDraftAnnotation: (draft: StageAnnotation | null) => void;
  readonly pushLaserPoint: (point: NormalizedScenePoint | null) => void;
  readonly startSceneLoop: () => void;
  readonly stopSceneLoop: () => void;
  readonly toggleSceneLoop: () => void;
  readonly captureSceneStream: (frameRate?: number) => MediaStream | null;
}

const SceneCompositorContext =
  createContext<SceneCompositorContextValue | null>(null);
const SceneCompositorDiagnosticsContext =
  createContext<SceneCompositor | null>(null);

export interface CompositorProviderProps {
  readonly children: ReactNode;
  readonly compositor?: SceneCompositor;
}

export function CompositorProvider({
  children,
  compositor: externalCompositor,
}: CompositorProviderProps) {
  const { state: playbackState, videoRef } = useSourcePlayback();
  const { snapshot: captureSnapshot } = useCapture();

  const [internalCompositor] = useState<SceneCompositor>(
    () => new CanvasSceneCompositor(),
  );
  const activeCompositor = externalCompositor ?? internalCompositor;
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  const [activeTool, setActiveTool] = useState<TelestratorTool>('none');
  const [activeColor, setActiveColor] = useState<string>(
    DEFAULT_TELESTRATOR_COLOR,
  );

  const subscribeState = useCallback(
    (listener: () => void) => activeCompositor.subscribe(listener),
    [activeCompositor],
  );
  const getStateSnapshot = useCallback(
    () => activeCompositor.getState(),
    [activeCompositor],
  );

  const state = useSyncExternalStore(
    subscribeState,
    getStateSnapshot,
    getStateSnapshot,
  );

  // Attach output canvas & borrowed source HTMLVideoElement; clean up loop on unmount
  useEffect(() => {
    activeCompositor.attachCanvas(canvasRef.current);
    activeCompositor.setSourceVideo(videoRef.current);
    activeCompositor.start();

    return () => {
      activeCompositor.stop();
      activeCompositor.setSourceVideo(null);
      activeCompositor.setCameraStream(null);
      activeCompositor.attachCanvas(null);
    };
  }, [activeCompositor, videoRef]);

  // Borrow active camera MediaStream from CaptureManager without owning its tracks
  useEffect(() => {
    activeCompositor.setCameraStream(captureSnapshot.activeCameraStream);
  }, [activeCompositor, captureSnapshot.activeCameraStream]);

  // Refresh scene frame immediately when source media lifecycle status or URL changes
  useEffect(() => {
    activeCompositor.setSourceVideo(videoRef.current);
    activeCompositor.renderFrameNow();
  }, [
    activeCompositor,
    videoRef,
    playbackState.status,
    playbackState.objectUrl,
  ]);

  const setLayoutMode = useCallback(
    (mode: StageLayoutMode) => {
      activeCompositor.setLayoutMode(mode);
    },
    [activeCompositor],
  );

  const setResolution = useCallback(
    (preset: SceneResolutionPreset) => {
      activeCompositor.setResolution(preset);
    },
    [activeCompositor],
  );

  const setPipRect = useCallback(
    (rect: PipOverlayRect) => {
      activeCompositor.setPipRect(rect);
    },
    [activeCompositor],
  );

  const setPipFrameShape = useCallback(
    (shape: PipFrameShape) => {
      activeCompositor.setPipFrameShape(shape);
    },
    [activeCompositor],
  );

  const setPipBorderStyle = useCallback(
    (border: PipBorderStyle) => {
      activeCompositor.setPipBorderStyle(border);
    },
    [activeCompositor],
  );

  const movePipBy = useCallback(
    (deltaX: number, deltaY: number) => {
      const current = activeCompositor.getState().pipRect;
      activeCompositor.setPipRect(nudgePipRect(current, deltaX, deltaY));
    },
    [activeCompositor],
  );

  const resizePipBy = useCallback(
    (deltaWidth: number, deltaHeight?: number) => {
      const current = activeCompositor.getState().pipRect;
      activeCompositor.setPipRect(
        resizePipRect(current, deltaWidth, deltaHeight),
      );
    },
    [activeCompositor],
  );

  const snapPipToCorner = useCallback(
    (corner: PipCornerPreset) => {
      const current = activeCompositor.getState().pipRect;
      activeCompositor.setPipRect(getPipCornerPresetRect(corner, current));
    },
    [activeCompositor],
  );

  const resetPipRect = useCallback(() => {
    activeCompositor.setPipRect(DEFAULT_PIP_RECT);
  }, [activeCompositor]);

  const setSplitRatio = useCallback(
    (ratio: number) => {
      activeCompositor.setSplitRatio(ratio);
    },
    [activeCompositor],
  );

  const resetSplitRatio = useCallback(() => {
    activeCompositor.setSplitRatio(DEFAULT_SPLIT_RATIO);
  }, [activeCompositor]);

  const addAnnotation = useCallback(
    (annotation: StageAnnotation) => {
      activeCompositor.addAnnotation(annotation);
    },
    [activeCompositor],
  );

  const undoAnnotation = useCallback((): boolean => {
    return activeCompositor.undoAnnotation();
  }, [activeCompositor]);

  const clearAnnotations = useCallback(() => {
    activeCompositor.clearAnnotations();
  }, [activeCompositor]);

  const setDraftAnnotation = useCallback(
    (draft: StageAnnotation | null) => {
      activeCompositor.setDraftAnnotation(draft);
    },
    [activeCompositor],
  );

  const pushLaserPoint = useCallback(
    (point: NormalizedScenePoint | null) => {
      activeCompositor.pushLaserPoint(point);
    },
    [activeCompositor],
  );

  const startSceneLoop = useCallback(() => {
    if (canvasRef.current) {
      activeCompositor.attachCanvas(canvasRef.current);
    }
    activeCompositor.start();
  }, [activeCompositor]);

  const stopSceneLoop = useCallback(() => {
    activeCompositor.stop();
  }, [activeCompositor]);

  const toggleSceneLoop = useCallback(() => {
    if (activeCompositor.getState().isRunning) {
      activeCompositor.stop();
    } else {
      if (canvasRef.current) {
        activeCompositor.attachCanvas(canvasRef.current);
      }
      activeCompositor.start();
    }
  }, [activeCompositor]);

  const captureSceneStream = useCallback(
    (frameRate?: number): MediaStream | null => {
      const canvas = canvasRef.current;
      if (!canvas || typeof canvas.captureStream !== 'function') {
        return null;
      }
      activeCompositor.attachCanvas(canvas);
      if (!activeCompositor.getState().isRunning) {
        activeCompositor.start();
      }
      activeCompositor.renderFrameNow();
      const targetFps = frameRate ?? activeCompositor.getState().targetFps;
      return canvas.captureStream(targetFps);
    },
    [activeCompositor],
  );

  const value = useMemo<SceneCompositorContextValue>(
    () => ({
      state,
      canvasRef,
      activeTool,
      activeColor,
      setActiveTool,
      setActiveColor,
      setLayoutMode,
      setResolution,
      setPipRect,
      setPipFrameShape,
      setPipBorderStyle,
      movePipBy,
      resizePipBy,
      snapPipToCorner,
      resetPipRect,
      setSplitRatio,
      resetSplitRatio,
      addAnnotation,
      undoAnnotation,
      clearAnnotations,
      setDraftAnnotation,
      pushLaserPoint,
      startSceneLoop,
      stopSceneLoop,
      toggleSceneLoop,
      captureSceneStream,
    }),
    [
      activeColor,
      activeTool,
      addAnnotation,
      captureSceneStream,
      clearAnnotations,
      movePipBy,
      pushLaserPoint,
      resetPipRect,
      resetSplitRatio,
      resizePipBy,
      setDraftAnnotation,
      setLayoutMode,
      setPipBorderStyle,
      setPipFrameShape,
      setPipRect,
      setResolution,
      setSplitRatio,
      snapPipToCorner,
      startSceneLoop,
      state,
      stopSceneLoop,
      toggleSceneLoop,
      undoAnnotation,
    ],
  );

  return (
    <SceneCompositorContext.Provider value={value}>
      <SceneCompositorDiagnosticsContext.Provider value={activeCompositor}>
        {children}
      </SceneCompositorDiagnosticsContext.Provider>
    </SceneCompositorContext.Provider>
  );
}

// eslint-disable-next-line react-refresh/only-export-components
export function useSceneCompositor(): SceneCompositorContextValue {
  const ctx = useContext(SceneCompositorContext);
  if (!ctx) {
    throw new Error(
      'useSceneCompositor must be used within a CompositorProvider',
    );
  }
  return ctx;
}

// eslint-disable-next-line react-refresh/only-export-components
export function useCompositorDiagnostics(): CompositorDiagnostics {
  const compositor = useContext(SceneCompositorDiagnosticsContext);
  if (!compositor) {
    throw new Error(
      'useCompositorDiagnostics must be used within a CompositorProvider',
    );
  }

  const subscribe = useCallback(
    (listener: () => void) => compositor.subscribeDiagnostics(listener),
    [compositor],
  );
  const getSnapshot = useCallback(
    () => compositor.getDiagnostics(),
    [compositor],
  );

  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}

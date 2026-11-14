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
import { BrowserExportManager } from '../services/export-manager';
import type {
  ExportManager,
  ExportResult,
  ExportStateSnapshot,
} from '../services/interfaces/export-manager';
import type { RecordedMediaArtifact } from '../services/interfaces/recording-engine';
import { useSceneCompositor } from './CompositorContext';
import { useSourcePlayback } from './PlaybackContext';
import { useRecordingSession } from './RecordingSessionContext';

export interface SessionTakeEntry {
  readonly takeNumber: number;
  readonly artifact: RecordedMediaArtifact;
  readonly sourceFileName: string | null;
  readonly customFileName: string | null;
  readonly downloadedCount: number;
}

interface SessionTakesState {
  readonly items: readonly SessionTakeEntry[];
  readonly nextTakeNumber: number;
  readonly deletedIds: readonly string[];
  readonly lastCommittedEngineId: string | null;
}

interface UserTakeSelection {
  readonly forLatestEngineId: string | null;
  readonly takeId: string | null;
}

export interface ExportContextValue {
  readonly state: ExportStateSnapshot;
  readonly artifact: RecordedMediaArtifact | null;
  readonly takes: readonly SessionTakeEntry[];
  readonly selectedTakeId: string | null;
  readonly activeTake: SessionTakeEntry | null;
  readonly fileNameDraft: string;
  readonly normalizedFileName: string;
  readonly selectTake: (takeId: string) => void;
  readonly removeTake: (takeId: string) => void;
  readonly clearAllTakes: () => void;
  readonly setFileNameDraft: (nextName: string) => void;
  readonly resetFileNameDraft: () => void;
  readonly downloadArtifact: () => Promise<ExportResult | null>;
}

const ExportContext = createContext<ExportContextValue | null>(null);

export interface ExportProviderProps {
  readonly children: ReactNode;
  readonly manager?: ExportManager;
}

export function ExportProvider({
  children,
  manager: externalManager,
}: ExportProviderProps) {
  const { state: playbackState } = useSourcePlayback();
  const { canvasRef } = useSceneCompositor();
  const { engineState, discardRecording } = useRecordingSession();

  const [internalManager] = useState<ExportManager>(
    () => new BrowserExportManager(),
  );
  const activeManager = externalManager ?? internalManager;

  const subscribe = useCallback(
    (listener: () => void) => activeManager.subscribe(listener),
    [activeManager],
  );
  const getSnapshot = useCallback(
    () => activeManager.getState(),
    [activeManager],
  );

  const state = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);

  const [takesState, setTakesState] = useState<SessionTakesState>({
    items: [],
    nextTakeNumber: 1,
    deletedIds: [],
    lastCommittedEngineId: null,
  });
  const [userSelection, setUserSelection] = useState<UserTakeSelection>({
    forLatestEngineId: null,
    takeId: null,
  });

  const latestEngineArtifact = engineState.lastArtifact;
  const engineStatus = engineState.status;
  const currentSourceFileName = playbackState.metadata?.fileName ?? null;

  // Persist newly completed takes & sync explicit Discard Take transitions into state
  useEffect(() => {
    const nextId = latestEngineArtifact?.id ?? null;

    if (nextId !== null && latestEngineArtifact !== null) {
      setTakesState((prev) => {
        if (prev.deletedIds.includes(nextId)) {
          return prev.lastCommittedEngineId === nextId
            ? prev
            : { ...prev, lastCommittedEngineId: nextId };
        }
        if (prev.items.some((entry) => entry.artifact.id === nextId)) {
          return prev.lastCommittedEngineId === nextId
            ? prev
            : { ...prev, lastCommittedEngineId: nextId };
        }
        const newEntry: SessionTakeEntry = {
          takeNumber: prev.nextTakeNumber,
          artifact: latestEngineArtifact,
          sourceFileName: currentSourceFileName,
          customFileName: null,
          downloadedCount: 0,
        };
        return {
          items: [...prev.items, newEntry],
          nextTakeNumber: prev.nextTakeNumber + 1,
          deletedIds: prev.deletedIds,
          lastCommittedEngineId: nextId,
        };
      });
      return;
    }

    setTakesState((prev) => {
      if (prev.lastCommittedEngineId === null) {
        return prev;
      }
      const discardedId = prev.lastCommittedEngineId;
      // Only remove the prior take if the engine returned to 'idle' via
      // explicit clearArtifact() / Discard Take (NOT when starting a new take).
      if (engineStatus === 'idle') {
        return {
          ...prev,
          items: prev.items.filter((entry) => entry.artifact.id !== discardedId),
          deletedIds: prev.deletedIds.includes(discardedId)
            ? prev.deletedIds
            : [...prev.deletedIds, discardedId],
          lastCommittedEngineId: null,
        };
      }
      return {
        ...prev,
        lastCommittedEngineId: null,
      };
    });
  }, [currentSourceFileName, engineStatus, latestEngineArtifact]);

  // Synchronously derive the effective takes list on the very first render after
  // stop() or discardRecording() so zero extra render hops are needed.
  const takes = useMemo<readonly SessionTakeEntry[]>(() => {
    let base = takesState.items;

    if (
      latestEngineArtifact === null &&
      engineStatus === 'idle' &&
      takesState.lastCommittedEngineId !== null
    ) {
      base = base.filter(
        (entry) => entry.artifact.id !== takesState.lastCommittedEngineId,
      );
    }

    if (
      latestEngineArtifact !== null &&
      !takesState.deletedIds.includes(latestEngineArtifact.id) &&
      !base.some((entry) => entry.artifact.id === latestEngineArtifact.id)
    ) {
      return [
        ...base,
        {
          takeNumber: takesState.nextTakeNumber,
          artifact: latestEngineArtifact,
          sourceFileName: currentSourceFileName,
          customFileName: null,
          downloadedCount: 0,
        },
      ];
    }

    return base;
  }, [currentSourceFileName, engineStatus, latestEngineArtifact, takesState]);

  const activeTake = useMemo<SessionTakeEntry | null>(() => {
    if (takes.length === 0) {
      return null;
    }
    const latestId = latestEngineArtifact?.id ?? null;
    if (
      userSelection.takeId !== null &&
      (latestId === null || userSelection.forLatestEngineId === latestId)
    ) {
      const matched = takes.find(
        (entry) => entry.artifact.id === userSelection.takeId,
      );
      if (matched) {
        return matched;
      }
    }
    return takes[takes.length - 1] ?? null;
  }, [latestEngineArtifact?.id, takes, userSelection]);

  const artifact = activeTake?.artifact ?? null;
  const activeTakeSourceName =
    activeTake?.sourceFileName ?? currentSourceFileName;

  // Synchronize ONLY the active selected take into ExportManager so at most 1
  // preview blob: Object URL exists at any time.
  useEffect(() => {
    activeManager.attachArtifact(artifact, activeTakeSourceName);
  }, [activeManager, activeTakeSourceName, artifact]);

  // StrictMode-safe unmount & pagehide cleanup of all export Object URLs
  useEffect(() => {
    const currentCanvasEl = canvasRef.current;

    const handlePageHide = () => {
      activeManager.dispose();
    };
    if (typeof window !== 'undefined') {
      window.addEventListener('pagehide', handlePageHide);
    }

    return () => {
      if (typeof window !== 'undefined') {
        window.removeEventListener('pagehide', handlePageHide);
      }
      if (!currentCanvasEl?.isConnected) {
        activeManager.dispose();
      } else {
        activeManager.attachArtifact(null);
      }
    };
  }, [activeManager, canvasRef]);

  const selectTake = useCallback(
    (takeId: string) => {
      setUserSelection({
        forLatestEngineId: latestEngineArtifact?.id ?? null,
        takeId,
      });
    },
    [latestEngineArtifact?.id],
  );

  const removeTake = useCallback(
    (takeId: string) => {
      setTakesState((prev) => ({
        ...prev,
        items: prev.items.filter((entry) => entry.artifact.id !== takeId),
        deletedIds: prev.deletedIds.includes(takeId)
          ? prev.deletedIds
          : [...prev.deletedIds, takeId],
        lastCommittedEngineId:
          prev.lastCommittedEngineId === takeId
            ? null
            : prev.lastCommittedEngineId,
      }));
      setUserSelection((current) =>
        current.takeId === takeId
          ? { forLatestEngineId: current.forLatestEngineId, takeId: null }
          : current,
      );
      if (latestEngineArtifact?.id === takeId) {
        discardRecording();
      }
    },
    [discardRecording, latestEngineArtifact?.id],
  );

  const clearAllTakes = useCallback(() => {
    const allIds = takes.map((entry) => entry.artifact.id);
    setTakesState((prev) => ({
      ...prev,
      items: [],
      deletedIds: Array.from(new Set([...prev.deletedIds, ...allIds])),
      lastCommittedEngineId: null,
    }));
    setUserSelection({ forLatestEngineId: null, takeId: null });
    discardRecording();
  }, [discardRecording, takes]);

  const fileNameDraft = activeTake?.customFileName ?? state.suggestedFileName;

  const normalizedFileName = useMemo(() => {
    const mime = artifact?.mimeType ?? 'video/webm';
    return activeManager.normalizeDownloadFileName(fileNameDraft, mime);
  }, [activeManager, artifact?.mimeType, fileNameDraft]);

  const setFileNameDraft = useCallback(
    (nextName: string) => {
      const targetTake = activeTake;
      if (!targetTake) {
        return;
      }
      setTakesState((prev) => {
        const exists = prev.items.some(
          (entry) => entry.artifact.id === targetTake.artifact.id,
        );
        if (exists) {
          return {
            ...prev,
            items: prev.items.map((entry) =>
              entry.artifact.id === targetTake.artifact.id
                ? { ...entry, customFileName: nextName }
                : entry,
            ),
          };
        }
        return {
          ...prev,
          items: [
            ...prev.items,
            { ...targetTake, customFileName: nextName },
          ],
          nextTakeNumber: prev.nextTakeNumber + 1,
          lastCommittedEngineId: targetTake.artifact.id,
        };
      });
    },
    [activeTake],
  );

  const resetFileNameDraft = useCallback(() => {
    const targetId = activeTake?.artifact.id;
    if (!targetId) {
      return;
    }
    setTakesState((prev) => ({
      ...prev,
      items: prev.items.map((entry) =>
        entry.artifact.id === targetId
          ? { ...entry, customFileName: null }
          : entry,
      ),
    }));
  }, [activeTake?.artifact.id]);

  const downloadArtifact =
    useCallback(async (): Promise<ExportResult | null> => {
      const targetTake = activeTake;
      if (!targetTake) {
        return null;
      }
      try {
        const result = await activeManager.triggerLocalDownload({
          artifact: targetTake.artifact,
          baseFileName: fileNameDraft,
        });
        setTakesState((prev) => ({
          ...prev,
          items: prev.items.map((entry) =>
            entry.artifact.id === targetTake.artifact.id
              ? { ...entry, downloadedCount: entry.downloadedCount + 1 }
              : entry,
          ),
        }));
        return result;
      } catch {
        return null;
      }
    }, [activeManager, activeTake, fileNameDraft]);

  const effectiveSelectedTakeId = activeTake?.artifact.id ?? null;

  const value = useMemo<ExportContextValue>(
    () => ({
      state,
      artifact,
      takes,
      selectedTakeId: effectiveSelectedTakeId,
      activeTake,
      fileNameDraft,
      normalizedFileName,
      selectTake,
      removeTake,
      clearAllTakes,
      setFileNameDraft,
      resetFileNameDraft,
      downloadArtifact,
    }),
    [
      activeTake,
      artifact,
      clearAllTakes,
      downloadArtifact,
      effectiveSelectedTakeId,
      fileNameDraft,
      normalizedFileName,
      removeTake,
      resetFileNameDraft,
      selectTake,
      setFileNameDraft,
      state,
      takes,
    ],
  );

  return (
    <ExportContext.Provider value={value}>{children}</ExportContext.Provider>
  );
}

// eslint-disable-next-line react-refresh/only-export-components
export function useExport(): ExportContextValue {
  const ctx = useContext(ExportContext);
  if (!ctx) {
    throw new Error('useExport must be used within an ExportProvider');
  }
  return ctx;
}

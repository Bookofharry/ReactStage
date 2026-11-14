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
import { BrowserExportManager } from '../services/export-manager';
import type {
  ExportManager,
  ExportResult,
  ExportStateSnapshot,
} from '../services/interfaces/export-manager';
import type { RecordedMediaArtifact } from '../services/interfaces/recording-engine';
import {
  IndexedDbTakeVault,
  type PersistedVaultTake,
  type TakeVault,
} from '../services/take-vault';
import {
  buildTrimmedVideoFileName,
  buildWavFileName,
  clampTrimRange,
  exportTrimmedWebmBlob,
  extractCompanionWavBlob,
  triggerLocalBlobDownload,
} from '../utils/media-trim-and-wav';
import { useSceneCompositor } from './CompositorContext';
import { useSourcePlayback } from './PlaybackContext';
import { useRecordingSession } from './RecordingSessionContext';

export interface SessionTakeEntry {
  readonly takeNumber: number;
  readonly artifact: RecordedMediaArtifact;
  readonly sourceFileName: string | null;
  readonly customFileName: string | null;
  readonly downloadedCount: number;
  readonly trimStartSec: number;
  readonly trimEndSec: number;
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
  readonly vaultSupported: boolean;
  readonly vaultTotalBytes: number;
  readonly trimStartSec: number;
  readonly trimEndSec: number;
  readonly trimmedDurationSec: number;
  readonly isTrimmed: boolean;
  readonly isProcessingCompanionExport: boolean;
  readonly lastCompanionExportMessage: string | null;
  readonly selectTake: (takeId: string) => void;
  readonly removeTake: (takeId: string) => void;
  readonly clearAllTakes: () => void;
  readonly setFileNameDraft: (nextName: string) => void;
  readonly resetFileNameDraft: () => void;
  readonly setTrimRange: (startSec: number, endSec: number) => void;
  readonly resetTrimRange: () => void;
  readonly downloadArtifact: () => Promise<ExportResult | null>;
  readonly exportCompanionWav: () => Promise<string | null>;
  readonly exportTrimmedVideo: () => Promise<string | null>;
}

const ExportContext = createContext<ExportContextValue | null>(null);

export interface ExportProviderProps {
  readonly children: ReactNode;
  readonly manager?: ExportManager;
  readonly vault?: TakeVault;
}

function toPersistedVaultTake(entry: SessionTakeEntry): PersistedVaultTake {
  return {
    id: entry.artifact.id,
    takeNumber: entry.takeNumber,
    artifact: entry.artifact,
    sourceFileName: entry.sourceFileName,
    customFileName: entry.customFileName,
    downloadedCount: entry.downloadedCount,
    trimStartSec: entry.trimStartSec,
    trimEndSec: entry.trimEndSec,
    savedAtMs: Date.now(),
  };
}

function defaultTrimEndForArtifact(artifact: RecordedMediaArtifact): number {
  return Math.round(Math.max(0.2, artifact.durationMs / 1000) * 100) / 100;
}

export function ExportProvider({
  children,
  manager: externalManager,
  vault: externalVault,
}: ExportProviderProps) {
  const { state: playbackState } = useSourcePlayback();
  const { canvasRef } = useSceneCompositor();
  const { engineState, discardRecording } = useRecordingSession();

  const [internalManager] = useState<ExportManager>(
    () => new BrowserExportManager(),
  );
  const activeManager = externalManager ?? internalManager;

  const [internalVault] = useState<TakeVault>(() => new IndexedDbTakeVault());
  const activeVault = externalVault ?? internalVault;
  const vaultSupported = activeVault.isSupported();

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
  const [isProcessingCompanionExport, setIsProcessingCompanionExport] =
    useState(false);
  const [lastCompanionExportMessage, setLastCompanionExportMessage] = useState<
    string | null
  >(null);
  const persistedVaultIdsRef = useRef<Set<string>>(new Set());

  const latestEngineArtifact = engineState.lastArtifact;
  const engineStatus = engineState.status;
  const currentSourceFileName = playbackState.metadata?.fileName ?? null;

  // Hydrate previously persisted takes from local IndexedDB vault on startup
  useEffect(() => {
    if (!activeVault.isSupported()) {
      return;
    }
    let cancelled = false;
    void activeVault.loadAll().then((persisted) => {
      if (cancelled || persisted.length === 0) {
        return;
      }
      for (const p of persisted) {
        persistedVaultIdsRef.current.add(p.id);
      }
      setTakesState((prev) => {
        const existingIds = new Set(prev.items.map((item) => item.artifact.id));
        const deletedSet = new Set(prev.deletedIds);
        const restored: SessionTakeEntry[] = [];
        let maxTakeNum = prev.nextTakeNumber - 1;

        for (const p of persisted) {
          maxTakeNum = Math.max(maxTakeNum, p.takeNumber);
          if (!existingIds.has(p.id) && !deletedSet.has(p.id)) {
            restored.push({
              takeNumber: p.takeNumber,
              artifact: p.artifact,
              sourceFileName: p.sourceFileName,
              customFileName: p.customFileName,
              downloadedCount: p.downloadedCount,
              trimStartSec: p.trimStartSec,
              trimEndSec: p.trimEndSec,
            });
          }
        }

        if (restored.length === 0 && maxTakeNum + 1 <= prev.nextTakeNumber) {
          return prev;
        }

        const merged = [...restored, ...prev.items].sort(
          (a, b) => a.takeNumber - b.takeNumber,
        );
        return {
          ...prev,
          items: merged,
          nextTakeNumber: Math.max(prev.nextTakeNumber, maxTakeNum + 1),
        };
      });
    });

    return () => {
      cancelled = true;
    };
  }, [activeVault]);

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
          trimStartSec: 0,
          trimEndSec: defaultTrimEndForArtifact(latestEngineArtifact),
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
          items: prev.items.filter(
            (entry) => entry.artifact.id !== discardedId,
          ),
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

  // Synchronize newly committed or discarded engine takes with IndexedDB TakeVault
  useEffect(() => {
    if (!activeVault.isSupported()) {
      return;
    }
    for (const entry of takesState.items) {
      if (!persistedVaultIdsRef.current.has(entry.artifact.id)) {
        persistedVaultIdsRef.current.add(entry.artifact.id);
        void activeVault.saveTake(toPersistedVaultTake(entry));
      }
    }
    for (const deletedId of takesState.deletedIds) {
      if (persistedVaultIdsRef.current.has(deletedId)) {
        persistedVaultIdsRef.current.delete(deletedId);
        void activeVault.deleteTake(deletedId);
      }
    }
  }, [activeVault, takesState.deletedIds, takesState.items]);

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
          trimStartSec: 0,
          trimEndSec: defaultTrimEndForArtifact(latestEngineArtifact),
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

  const updateActiveTakeEntry = useCallback(
    (updater: (entry: SessionTakeEntry) => SessionTakeEntry) => {
      const targetTake = activeTake;
      if (!targetTake) {
        return;
      }
      const nextEntry = updater(targetTake);
      setTakesState((prev) => {
        const exists = prev.items.some(
          (entry) => entry.artifact.id === targetTake.artifact.id,
        );
        if (exists) {
          return {
            ...prev,
            items: prev.items.map((entry) =>
              entry.artifact.id === targetTake.artifact.id ? nextEntry : entry,
            ),
          };
        }
        return {
          ...prev,
          items: [...prev.items, nextEntry],
          nextTakeNumber: prev.nextTakeNumber + 1,
          lastCommittedEngineId: targetTake.artifact.id,
        };
      });
      void activeVault.saveTake(toPersistedVaultTake(nextEntry));
    },
    [activeTake, activeVault],
  );

  const selectTake = useCallback(
    (takeId: string) => {
      setLastCompanionExportMessage(null);
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
      void activeVault.deleteTake(takeId);
      if (latestEngineArtifact?.id === takeId) {
        discardRecording();
      }
    },
    [activeVault, discardRecording, latestEngineArtifact?.id],
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
    setLastCompanionExportMessage(null);
    void activeVault.clearAll();
    discardRecording();
  }, [activeVault, discardRecording, takes]);

  const fileNameDraft = activeTake?.customFileName ?? state.suggestedFileName;

  const normalizedFileName = useMemo(() => {
    const mime = artifact?.mimeType ?? 'video/webm';
    return activeManager.normalizeDownloadFileName(fileNameDraft, mime);
  }, [activeManager, artifact?.mimeType, fileNameDraft]);

  const setFileNameDraft = useCallback(
    (nextName: string) => {
      updateActiveTakeEntry((entry) => ({
        ...entry,
        customFileName: nextName,
      }));
    },
    [updateActiveTakeEntry],
  );

  const resetFileNameDraft = useCallback(() => {
    updateActiveTakeEntry((entry) => ({
      ...entry,
      customFileName: null,
    }));
  }, [updateActiveTakeEntry]);

  const activeDurationSec = useMemo(() => {
    if (!activeTake) {
      return 0;
    }
    return Math.max(0.2, activeTake.artifact.durationMs / 1000);
  }, [activeTake]);

  const clampedTrim = useMemo(() => {
    if (!activeTake || activeDurationSec <= 0) {
      return {
        startSec: 0,
        endSec: 0,
        durationSec: 0,
        isTrimmed: false,
      };
    }
    return clampTrimRange(
      activeTake.trimStartSec,
      activeTake.trimEndSec,
      activeDurationSec,
    );
  }, [activeDurationSec, activeTake]);

  const setTrimRange = useCallback(
    (startSec: number, endSec: number) => {
      if (!activeTake) {
        return;
      }
      const totalSec = Math.max(0.2, activeTake.artifact.durationMs / 1000);
      const nextTrim = clampTrimRange(startSec, endSec, totalSec);
      updateActiveTakeEntry((entry) => ({
        ...entry,
        trimStartSec: nextTrim.startSec,
        trimEndSec: nextTrim.endSec,
      }));
    },
    [activeTake, updateActiveTakeEntry],
  );

  const resetTrimRange = useCallback(() => {
    if (!activeTake) {
      return;
    }
    const fullEnd = defaultTrimEndForArtifact(activeTake.artifact);
    updateActiveTakeEntry((entry) => ({
      ...entry,
      trimStartSec: 0,
      trimEndSec: fullEnd,
    }));
  }, [activeTake, updateActiveTakeEntry]);

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
        const updated: SessionTakeEntry = {
          ...targetTake,
          downloadedCount: targetTake.downloadedCount + 1,
        };
        setTakesState((prev) => ({
          ...prev,
          items: prev.items.map((entry) =>
            entry.artifact.id === targetTake.artifact.id ? updated : entry,
          ),
        }));
        void activeVault.saveTake(toPersistedVaultTake(updated));
        return result;
      } catch {
        return null;
      }
    }, [activeManager, activeTake, activeVault, fileNameDraft]);

  const exportCompanionWav = useCallback(async (): Promise<string | null> => {
    const targetTake = activeTake;
    if (!targetTake || isProcessingCompanionExport) {
      return null;
    }
    setIsProcessingCompanionExport(true);
    try {
      const totalSec = Math.max(0.2, targetTake.artifact.durationMs / 1000);
      const trim = clampTrimRange(
        targetTake.trimStartSec,
        targetTake.trimEndSec,
        totalSec,
      );
      const wavBlob = await extractCompanionWavBlob(
        targetTake.artifact.blob,
        targetTake.artifact.durationMs,
        trim.startSec,
        trim.endSec,
      );
      const wavName = buildWavFileName(normalizedFileName, trim.isTrimmed);
      const ok = triggerLocalBlobDownload(wavBlob, wavName);
      if (!ok) {
        return null;
      }
      setLastCompanionExportMessage(`Audio saved as ${wavName}`);
      return wavName;
    } finally {
      setIsProcessingCompanionExport(false);
    }
  }, [activeTake, isProcessingCompanionExport, normalizedFileName]);

  const exportTrimmedVideo = useCallback(async (): Promise<string | null> => {
    const targetTake = activeTake;
    if (!targetTake || isProcessingCompanionExport) {
      return null;
    }
    const totalSec = Math.max(0.2, targetTake.artifact.durationMs / 1000);
    const trim = clampTrimRange(
      targetTake.trimStartSec,
      targetTake.trimEndSec,
      totalSec,
    );
    if (!trim.isTrimmed) {
      return null;
    }
    setIsProcessingCompanionExport(true);
    try {
      const trimmedBlob = await exportTrimmedWebmBlob(
        targetTake.artifact.blob,
        targetTake.artifact.durationMs,
        trim.startSec,
        trim.endSec,
      );
      const trimmedName = buildTrimmedVideoFileName(normalizedFileName);
      const ok = triggerLocalBlobDownload(trimmedBlob, trimmedName);
      if (!ok) {
        return null;
      }
      setLastCompanionExportMessage(`Trimmed clip saved as ${trimmedName}`);
      return trimmedName;
    } finally {
      setIsProcessingCompanionExport(false);
    }
  }, [activeTake, isProcessingCompanionExport, normalizedFileName]);

  const vaultTotalBytes = useMemo(
    () => takes.reduce((sum, entry) => sum + entry.artifact.sizeBytes, 0),
    [takes],
  );

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
      vaultSupported,
      vaultTotalBytes,
      trimStartSec: clampedTrim.startSec,
      trimEndSec: clampedTrim.endSec,
      trimmedDurationSec: clampedTrim.durationSec,
      isTrimmed: clampedTrim.isTrimmed,
      isProcessingCompanionExport,
      lastCompanionExportMessage,
      selectTake,
      removeTake,
      clearAllTakes,
      setFileNameDraft,
      resetFileNameDraft,
      setTrimRange,
      resetTrimRange,
      downloadArtifact,
      exportCompanionWav,
      exportTrimmedVideo,
    }),
    [
      activeTake,
      artifact,
      clampedTrim.durationSec,
      clampedTrim.endSec,
      clampedTrim.isTrimmed,
      clampedTrim.startSec,
      clearAllTakes,
      downloadArtifact,
      effectiveSelectedTakeId,
      exportCompanionWav,
      exportTrimmedVideo,
      fileNameDraft,
      isProcessingCompanionExport,
      lastCompanionExportMessage,
      normalizedFileName,
      removeTake,
      resetFileNameDraft,
      resetTrimRange,
      selectTake,
      setFileNameDraft,
      setTrimRange,
      state,
      takes,
      vaultSupported,
      vaultTotalBytes,
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

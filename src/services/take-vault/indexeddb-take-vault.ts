import type {
  RecordedMediaArtifact,
  RecordingChapterMarker,
} from '../interfaces/recording-engine';

export const TAKE_VAULT_DB_NAME = 'reactstage-take-vault-v1';
export const TAKE_VAULT_STORE_NAME = 'takes';
export const TAKE_VAULT_DB_VERSION = 1;
export const MAX_VAULT_TAKES = 12;

export interface PersistedVaultTake {
  readonly id: string;
  readonly takeNumber: number;
  readonly artifact: RecordedMediaArtifact;
  readonly sourceFileName: string | null;
  readonly customFileName: string | null;
  readonly downloadedCount: number;
  readonly trimStartSec: number;
  readonly trimEndSec: number;
  readonly savedAtMs: number;
}

export interface TakeVault {
  isSupported(): boolean;
  loadAll(): Promise<readonly PersistedVaultTake[]>;
  saveTake(entry: PersistedVaultTake): Promise<boolean>;
  deleteTake(id: string): Promise<boolean>;
  clearAll(): Promise<boolean>;
}

function isValidChapterMarker(raw: unknown): raw is RecordingChapterMarker {
  if (typeof raw !== 'object' || raw === null) {
    return false;
  }
  const candidate = raw as Record<string, unknown>;
  return (
    typeof candidate.id === 'string' &&
    typeof candidate.index === 'number' &&
    typeof candidate.label === 'string' &&
    typeof candidate.elapsedRecordingMs === 'number' &&
    (candidate.sourceTimeSec === null ||
      typeof candidate.sourceTimeSec === 'number') &&
    typeof candidate.layoutMode === 'string'
  );
}

function sanitizePersistedVaultTake(raw: unknown): PersistedVaultTake | null {
  if (typeof raw !== 'object' || raw === null) {
    return null;
  }
  const record = raw as Record<string, unknown>;
  const artifactRaw = record.artifact;
  if (typeof artifactRaw !== 'object' || artifactRaw === null) {
    return null;
  }
  const art = artifactRaw as Record<string, unknown>;
  const id = typeof record.id === 'string' ? record.id : null;
  const blob = art.blob;
  if (!id || !(blob instanceof Blob) || blob.size <= 0) {
    return null;
  }

  const rawMarkers = Array.isArray(art.chapterMarkers)
    ? art.chapterMarkers.filter(isValidChapterMarker)
    : undefined;

  const durationMs =
    typeof art.durationMs === 'number' && Number.isFinite(art.durationMs)
      ? Math.max(0, art.durationMs)
      : 0;
  const durationSec = durationMs / 1000;

  const rawTrimStart =
    typeof record.trimStartSec === 'number' &&
    Number.isFinite(record.trimStartSec)
      ? Math.max(0, record.trimStartSec)
      : 0;
  const rawTrimEnd =
    typeof record.trimEndSec === 'number' &&
    Number.isFinite(record.trimEndSec) &&
    record.trimEndSec > 0
      ? record.trimEndSec
      : durationSec;

  const artifact: RecordedMediaArtifact = {
    id,
    blob,
    mimeType:
      typeof art.mimeType === 'string' && art.mimeType.length > 0
        ? art.mimeType
        : blob.type || 'video/webm',
    durationMs,
    sizeBytes: blob.size,
    chunkCount:
      typeof art.chunkCount === 'number' && Number.isFinite(art.chunkCount)
        ? Math.max(1, Math.round(art.chunkCount))
        : 1,
    width:
      typeof art.width === 'number' && Number.isFinite(art.width)
        ? Math.max(1, Math.round(art.width))
        : 1280,
    height:
      typeof art.height === 'number' && Number.isFinite(art.height)
        ? Math.max(1, Math.round(art.height))
        : 720,
    hasAudioTrack: Boolean(art.hasAudioTrack),
    createdAtIso:
      typeof art.createdAtIso === 'string'
        ? art.createdAtIso
        : new Date().toISOString(),
    ...(rawMarkers ? { chapterMarkers: rawMarkers } : {}),
  };

  return {
    id,
    takeNumber:
      typeof record.takeNumber === 'number' &&
      Number.isFinite(record.takeNumber) &&
      record.takeNumber >= 1
        ? Math.round(record.takeNumber)
        : 1,
    artifact,
    sourceFileName:
      typeof record.sourceFileName === 'string' ? record.sourceFileName : null,
    customFileName:
      typeof record.customFileName === 'string' ? record.customFileName : null,
    downloadedCount:
      typeof record.downloadedCount === 'number' &&
      Number.isFinite(record.downloadedCount)
        ? Math.max(0, Math.round(record.downloadedCount))
        : 0,
    trimStartSec: rawTrimStart,
    trimEndSec: Math.max(rawTrimStart, rawTrimEnd),
    savedAtMs:
      typeof record.savedAtMs === 'number' && Number.isFinite(record.savedAtMs)
        ? record.savedAtMs
        : Date.now(),
  };
}

function sortVaultEntries(
  entries: readonly PersistedVaultTake[],
): PersistedVaultTake[] {
  return [...entries].sort((a, b) => {
    if (a.takeNumber !== b.takeNumber) {
      return a.takeNumber - b.takeNumber;
    }
    return a.savedAtMs - b.savedAtMs;
  });
}

/**
 * Deterministic in-memory TakeVault implementation for unit testing
 * and environments without IndexedDB.
 */
export class InMemoryTakeVault implements TakeVault {
  private readonly records = new Map<string, PersistedVaultTake>();
  private readonly maxTakes: number;
  private readonly supportedFlag: boolean;

  public constructor(
    options: { readonly maxTakes?: number; readonly supported?: boolean } = {},
  ) {
    this.maxTakes = options.maxTakes ?? MAX_VAULT_TAKES;
    this.supportedFlag = options.supported ?? true;
  }

  public isSupported(): boolean {
    return this.supportedFlag;
  }

  public loadAll(): Promise<readonly PersistedVaultTake[]> {
    if (!this.supportedFlag) {
      return Promise.resolve([]);
    }
    const sanitized: PersistedVaultTake[] = [];
    for (const item of this.records.values()) {
      const clean = sanitizePersistedVaultTake(item);
      if (clean) {
        sanitized.push(clean);
      }
    }
    return Promise.resolve(sortVaultEntries(sanitized));
  }

  public saveTake(entry: PersistedVaultTake): Promise<boolean> {
    if (!this.supportedFlag) {
      return Promise.resolve(false);
    }
    const clean = sanitizePersistedVaultTake(entry);
    if (!clean) {
      return Promise.resolve(false);
    }
    this.records.set(clean.id, clean);
    if (this.records.size > this.maxTakes) {
      const sorted = sortVaultEntries(Array.from(this.records.values()));
      const excess = sorted.slice(0, sorted.length - this.maxTakes);
      for (const stale of excess) {
        this.records.delete(stale.id);
      }
    }
    return Promise.resolve(true);
  }

  public deleteTake(id: string): Promise<boolean> {
    if (!this.supportedFlag) {
      return Promise.resolve(false);
    }
    this.records.delete(id);
    return Promise.resolve(true);
  }

  public clearAll(): Promise<boolean> {
    if (!this.supportedFlag) {
      return Promise.resolve(false);
    }
    this.records.clear();
    return Promise.resolve(true);
  }
}

/**
 * Browser IndexedDB TakeVault storing structured-cloned Blob recordings locally
 * inside `reactstage-take-vault-v1` so multi-take reaction sessions survive
 * accidental page refreshes and browser restarts with zero cloud uploads.
 */
export class IndexedDbTakeVault implements TakeVault {
  private readonly dbName: string;
  private readonly maxTakes: number;

  public constructor(
    options: { readonly dbName?: string; readonly maxTakes?: number } = {},
  ) {
    this.dbName = options.dbName ?? TAKE_VAULT_DB_NAME;
    this.maxTakes = options.maxTakes ?? MAX_VAULT_TAKES;
  }

  public isSupported(): boolean {
    return (
      typeof indexedDB !== 'undefined' && typeof indexedDB.open === 'function'
    );
  }

  private openDb(): Promise<IDBDatabase> {
    return new Promise<IDBDatabase>((resolve, reject) => {
      if (!this.isSupported()) {
        reject(new Error('IndexedDB is unavailable in this environment.'));
        return;
      }
      let request: IDBOpenDBRequest;
      try {
        request = indexedDB.open(this.dbName, TAKE_VAULT_DB_VERSION);
      } catch (err: unknown) {
        reject(
          err instanceof Error
            ? err
            : new Error('Failed to open IndexedDB take vault.'),
        );
        return;
      }

      request.onupgradeneeded = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains(TAKE_VAULT_STORE_NAME)) {
          db.createObjectStore(TAKE_VAULT_STORE_NAME, { keyPath: 'id' });
        }
      };

      request.onsuccess = () => {
        resolve(request.result);
      };

      request.onerror = () => {
        reject(request.error ?? new Error('IndexedDB open request failed.'));
      };
    });
  }

  public async loadAll(): Promise<readonly PersistedVaultTake[]> {
    if (!this.isSupported()) {
      return [];
    }
    let db: IDBDatabase | null = null;
    try {
      const openedDb = await this.openDb();
      db = openedDb;
      const rawItems = await new Promise<unknown[]>((resolve, reject) => {
        const tx = openedDb.transaction(TAKE_VAULT_STORE_NAME, 'readonly');
        const store = tx.objectStore(TAKE_VAULT_STORE_NAME);
        const req = store.getAll();
        req.onsuccess = () => {
          resolve(Array.isArray(req.result) ? req.result : []);
        };
        req.onerror = () => {
          reject(req.error ?? new Error('Failed to read takes from vault.'));
        };
      });

      const valid: PersistedVaultTake[] = [];
      for (const raw of rawItems) {
        const clean = sanitizePersistedVaultTake(raw);
        if (clean) {
          valid.push(clean);
        }
      }
      return sortVaultEntries(valid);
    } catch {
      return [];
    } finally {
      db?.close();
    }
  }

  public async saveTake(entry: PersistedVaultTake): Promise<boolean> {
    if (!this.isSupported()) {
      return false;
    }
    const clean = sanitizePersistedVaultTake(entry);
    if (!clean) {
      return false;
    }

    let db: IDBDatabase | null = null;
    try {
      const openedDb = await this.openDb();
      db = openedDb;
      await new Promise<void>((resolve, reject) => {
        const tx = openedDb.transaction(TAKE_VAULT_STORE_NAME, 'readwrite');
        const store = tx.objectStore(TAKE_VAULT_STORE_NAME);
        store.put(clean);

        const allReq = store.getAll();
        allReq.onsuccess = () => {
          const allRaw = Array.isArray(allReq.result) ? allReq.result : [];
          const parsed: PersistedVaultTake[] = [];
          for (const candidate of allRaw) {
            const c = sanitizePersistedVaultTake(candidate);
            if (c) {
              parsed.push(c);
            }
          }
          if (parsed.length > this.maxTakes) {
            const sorted = sortVaultEntries(parsed);
            const excess = sorted.slice(0, sorted.length - this.maxTakes);
            for (const stale of excess) {
              store.delete(stale.id);
            }
          }
        };

        tx.oncomplete = () => {
          resolve();
        };
        tx.onerror = () => {
          reject(tx.error ?? new Error('Failed to write take to IndexedDB.'));
        };
        tx.onabort = () => {
          reject(tx.error ?? new Error('IndexedDB transaction aborted.'));
        };
      });
      return true;
    } catch {
      return false;
    } finally {
      db?.close();
    }
  }

  public async deleteTake(id: string): Promise<boolean> {
    if (!this.isSupported() || !id) {
      return false;
    }
    let db: IDBDatabase | null = null;
    try {
      const openedDb = await this.openDb();
      db = openedDb;
      await new Promise<void>((resolve, reject) => {
        const tx = openedDb.transaction(TAKE_VAULT_STORE_NAME, 'readwrite');
        tx.objectStore(TAKE_VAULT_STORE_NAME).delete(id);
        tx.oncomplete = () => {
          resolve();
        };
        tx.onerror = () => {
          reject(tx.error ?? new Error('Failed to delete take from vault.'));
        };
        tx.onabort = () => {
          reject(tx.error ?? new Error('IndexedDB delete aborted.'));
        };
      });
      return true;
    } catch {
      return false;
    } finally {
      db?.close();
    }
  }

  public async clearAll(): Promise<boolean> {
    if (!this.isSupported()) {
      return false;
    }
    let db: IDBDatabase | null = null;
    try {
      const openedDb = await this.openDb();
      db = openedDb;
      await new Promise<void>((resolve, reject) => {
        const tx = openedDb.transaction(TAKE_VAULT_STORE_NAME, 'readwrite');
        tx.objectStore(TAKE_VAULT_STORE_NAME).clear();
        tx.oncomplete = () => {
          resolve();
        };
        tx.onerror = () => {
          reject(tx.error ?? new Error('Failed to clear take vault.'));
        };
        tx.onabort = () => {
          reject(tx.error ?? new Error('IndexedDB clear aborted.'));
        };
      });
      return true;
    } catch {
      return false;
    } finally {
      db?.close();
    }
  }
}

import type {
  ExportError,
  ExportErrorCode,
  ExportJobDescriptor,
  ExportManager,
  ExportResult,
  ExportStateSnapshot,
  ExportStatus,
} from '../interfaces/export-manager';
import type { RecordedMediaArtifact } from '../interfaces/recording-engine';
import {
  ObjectUrlRegistry,
  type UrlObjectAdapter,
} from '../source-player/object-url-registry';

const WINDOWS_RESERVED_STEMS = new Set([
  'con',
  'prn',
  'aux',
  'nul',
  'com1',
  'com2',
  'com3',
  'com4',
  'com5',
  'com6',
  'com7',
  'com8',
  'com9',
  'lpt1',
  'lpt2',
  'lpt3',
  'lpt4',
  'lpt5',
  'lpt6',
  'lpt7',
  'lpt8',
  'lpt9',
]);

export interface BrowserExportManagerOptions {
  readonly urlAdapter?: UrlObjectAdapter;
  readonly clock?: () => Date;
  readonly downloadTrigger?: (objectUrl: string, fileName: string) => void;
  readonly ephemeralRevokeDelayMs?: number;
}

export class ExportOperationError extends Error {
  public readonly details: ExportError;

  public constructor(details: ExportError) {
    super(`${details.code}: ${details.message}`);
    this.name = 'ExportOperationError';
    this.details = details;
  }
}

function createExportError(
  code: ExportErrorCode,
  title: string,
  message: string,
  recoverable = true,
): ExportError {
  return { code, title, message, recoverable };
}

export function resolveContainerExtension(mimeType: string): string {
  const lower = mimeType.toLowerCase();
  if (lower.includes('mp4')) {
    return '.mp4';
  }
  if (lower.includes('matroska') || lower.includes('mkv')) {
    return '.mkv';
  }
  return '.webm';
}

function formatCompactTimestamp(date: Date): string {
  const yyyy = String(date.getFullYear());
  const mm = String(date.getMonth() + 1).padStart(2, '0');
  const dd = String(date.getDate()).padStart(2, '0');
  const hh = String(date.getHours()).padStart(2, '0');
  const min = String(date.getMinutes()).padStart(2, '0');
  const ss = String(date.getSeconds()).padStart(2, '0');
  return `${yyyy}${mm}${dd}-${hh}${min}${ss}`;
}

export function sanitizeFileStem(
  rawInput: string,
  fallbackStem = 'reactstage-reaction',
): string {
  // Replace ASCII control chars and filesystem-reserved characters with hyphens
  let cleaned = '';
  for (let i = 0; i < rawInput.length; i += 1) {
    const code = rawInput.charCodeAt(i);
    const ch = rawInput[i] ?? '';
    if (code <= 31 || '<>:"/\\|?*'.includes(ch)) {
      cleaned += '-';
    } else {
      cleaned += ch;
    }
  }

  cleaned = cleaned
    .trim()
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^[-.]+|[-.]+$/g, '');

  if (cleaned.length === 0) {
    return fallbackStem;
  }

  if (WINDOWS_RESERVED_STEMS.has(cleaned.toLowerCase())) {
    cleaned = `video-${cleaned}`;
  }

  if (cleaned.length > 80) {
    cleaned = cleaned.slice(0, 80).replace(/[-.]+$/g, '');
  }

  return cleaned.length > 0 ? cleaned : fallbackStem;
}

function stripKnownVideoExtension(fileName: string): string {
  return fileName.replace(/\.(webm|mp4|m4v|mov|mkv|ogv|ogg|avi)$/i, '');
}

function defaultBrowserDownloadTrigger(
  objectUrl: string,
  fileName: string,
): void {
  if (typeof document === 'undefined') {
    throw new Error('Document DOM is unavailable for local file download.');
  }
  const anchor = document.createElement('a');
  anchor.href = objectUrl;
  anchor.download = fileName;
  anchor.rel = 'noopener';
  anchor.style.display = 'none';
  document.body.appendChild(anchor);
  try {
    anchor.click();
  } finally {
    anchor.remove();
  }
}

export class BrowserExportManager implements ExportManager {
  private readonly urlAdapter: UrlObjectAdapter;
  private readonly previewRegistry: ObjectUrlRegistry;
  private readonly clock: () => Date;
  private readonly downloadTrigger: (
    objectUrl: string,
    fileName: string,
  ) => void;
  private readonly ephemeralRevokeDelayMs: number;

  private readonly listeners = new Set<(state: ExportStateSnapshot) => void>();
  private readonly ephemeralUrls = new Map<
    string,
    ReturnType<typeof setTimeout>
  >();

  private status: ExportStatus = 'idle';
  private activeArtifactId: string | null = null;
  private previewUrl: string | null = null;
  private suggestedFileName = 'reactstage-reaction.webm';
  private lastExportResult: ExportResult | null = null;
  private exportCount = 0;
  private error: ExportError | null = null;
  private disposed = false;

  private stateSnapshot: ExportStateSnapshot;

  public constructor(options: BrowserExportManagerOptions = {}) {
    this.urlAdapter = options.urlAdapter ?? {
      createObjectURL: (blob: Blob) => URL.createObjectURL(blob),
      revokeObjectURL: (url: string) => {
        URL.revokeObjectURL(url);
      },
    };
    this.previewRegistry = new ObjectUrlRegistry(this.urlAdapter);
    this.clock = options.clock ?? (() => new Date());
    this.downloadTrigger =
      options.downloadTrigger ?? defaultBrowserDownloadTrigger;
    this.ephemeralRevokeDelayMs = Math.max(
      0,
      options.ephemeralRevokeDelayMs ?? 300,
    );

    this.stateSnapshot = this.buildSnapshot();
  }

  public getState(): ExportStateSnapshot {
    return this.stateSnapshot;
  }

  public subscribe(listener: (state: ExportStateSnapshot) => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  public buildSuggestedFileName(
    sourceFileName: string | null,
    mimeType: string,
  ): string {
    const ext = resolveContainerExtension(mimeType);
    const timestamp = formatCompactTimestamp(this.clock());

    if (sourceFileName && sourceFileName.trim().length > 0) {
      const leafName =
        sourceFileName.trim().split(/[/\\]/).pop() ?? sourceFileName.trim();
      const stripped = stripKnownVideoExtension(leafName);
      const stem = sanitizeFileStem(stripped, 'reactstage')
        .toLowerCase()
        .slice(0, 56)
        .replace(/[-.]+$/g, '');
      const cleanStem = stem.length > 0 ? stem : 'reactstage';
      return `${cleanStem}-reaction-${timestamp}${ext}`;
    }

    return `reactstage-reaction-${timestamp}${ext}`;
  }

  public normalizeDownloadFileName(
    baseFileName: string,
    mimeType: string,
  ): string {
    const ext = resolveContainerExtension(mimeType);
    const trimmed = baseFileName.trim();
    const withoutMatchingExt = trimmed.toLowerCase().endsWith(ext)
      ? trimmed.slice(0, trimmed.length - ext.length)
      : stripKnownVideoExtension(trimmed);

    const safeStem = sanitizeFileStem(
      withoutMatchingExt,
      `reactstage-reaction-${formatCompactTimestamp(this.clock())}`,
    );
    return `${safeStem}${ext}`;
  }

  public attachArtifact(
    artifact: RecordedMediaArtifact | null,
    sourceFileName: string | null = null,
  ): string | null {
    if (this.disposed) {
      return null;
    }

    if (!artifact) {
      this.previewRegistry.revokeAll();
      this.activeArtifactId = null;
      this.previewUrl = null;
      this.lastExportResult = null;
      this.error = null;
      this.status = 'idle';
      this.emit();
      return null;
    }

    if (artifact.id === this.activeArtifactId && this.previewUrl !== null) {
      return this.previewUrl;
    }

    if (artifact.blob.size <= 0) {
      this.previewRegistry.revokeAll();
      this.activeArtifactId = null;
      this.previewUrl = null;
      this.error = createExportError(
        'EMPTY_EXPORT_ARTIFACT',
        'Empty recording cannot be previewed',
        'The recorded media artifact contains 0 bytes.',
      );
      this.status = 'error';
      this.emit();
      return null;
    }

    try {
      const nextUrl = this.previewRegistry.replacePrimary(artifact.blob);
      this.activeArtifactId = artifact.id;
      this.previewUrl = nextUrl;
      this.suggestedFileName = this.buildSuggestedFileName(
        sourceFileName,
        artifact.mimeType,
      );
      this.lastExportResult = null;
      this.error = null;
      this.status = 'ready';
      this.emit();
      return nextUrl;
    } catch (err) {
      const message =
        err instanceof Error
          ? err.message
          : 'Failed to allocate local preview Object URL.';
      this.error = createExportError(
        'PREVIEW_URL_FAILED',
        'Preview allocation failed',
        message,
      );
      this.status = 'error';
      this.emit();
      return null;
    }
  }

  public createPreviewUrl(artifact: RecordedMediaArtifact): string {
    if (this.disposed) {
      throw new ExportOperationError(
        createExportError(
          'EXPORT_DISPOSED',
          'Export manager disposed',
          'Cannot create a preview URL after disposal.',
          false,
        ),
      );
    }

    if (artifact.blob.size <= 0) {
      const emptyErr = createExportError(
        'EMPTY_EXPORT_ARTIFACT',
        'Empty recording cannot be previewed',
        'The recorded media artifact contains 0 bytes.',
      );
      this.error = emptyErr;
      this.status = 'error';
      this.emit();
      throw new ExportOperationError(emptyErr);
    }

    const url = this.previewRegistry.replacePrimary(artifact.blob);
    this.activeArtifactId = artifact.id;
    this.previewUrl = url;
    this.error = null;
    if (this.status === 'idle' || this.status === 'error') {
      this.status = 'ready';
    }
    this.emit();
    return url;
  }

  public revokePreviewUrl(url: string): void {
    if (!url) {
      return;
    }
    this.previewRegistry.revoke(url);
    if (this.previewUrl === url) {
      this.previewUrl = null;
      this.activeArtifactId = null;
      if (this.status === 'ready' || this.status === 'exported') {
        this.status = 'idle';
      }
    }
    this.revokeEphemeralUrlNow(url);
    this.emit();
  }

  public triggerLocalDownload(job: ExportJobDescriptor): Promise<ExportResult> {
    if (this.disposed) {
      return Promise.reject(
        new ExportOperationError(
          createExportError(
            'EXPORT_DISPOSED',
            'Export manager disposed',
            'Cannot export from a disposed ExportManager instance.',
            false,
          ),
        ),
      );
    }

    if (job.artifact.blob.size <= 0) {
      const emptyErr = createExportError(
        'EMPTY_EXPORT_ARTIFACT',
        'Empty recording cannot be exported',
        'The recorded session contains zero bytes and cannot be saved.',
      );
      this.error = emptyErr;
      this.status = 'error';
      this.emit();
      return Promise.reject(new ExportOperationError(emptyErr));
    }

    const downloadFileName = this.normalizeDownloadFileName(
      job.baseFileName,
      job.artifact.mimeType,
    );

    this.status = 'exporting';
    this.error = null;
    this.emit();

    const canReusePreviewUrl =
      this.activeArtifactId === job.artifact.id && this.previewUrl !== null;

    let targetUrl: string;
    let allocatedEphemeral = false;

    try {
      if (canReusePreviewUrl && this.previewUrl !== null) {
        targetUrl = this.previewUrl;
      } else {
        targetUrl = this.urlAdapter.createObjectURL(job.artifact.blob);
        allocatedEphemeral = true;
      }
    } catch (err) {
      const message =
        err instanceof Error
          ? err.message
          : 'Failed to allocate download Object URL.';
      const allocErr = createExportError(
        'DOWNLOAD_TRIGGER_FAILED',
        'Could not prepare local download',
        message,
      );
      this.error = allocErr;
      this.status = 'error';
      this.emit();
      return Promise.reject(new ExportOperationError(allocErr));
    }

    try {
      this.downloadTrigger(targetUrl, downloadFileName);
    } catch (err) {
      if (allocatedEphemeral) {
        this.urlAdapter.revokeObjectURL(targetUrl);
      }
      const message =
        err instanceof Error
          ? err.message
          : 'Browser blocked or failed local download trigger.';
      const triggerErr = createExportError(
        'DOWNLOAD_TRIGGER_FAILED',
        'Local download failed',
        message,
      );
      this.error = triggerErr;
      this.status = 'error';
      this.emit();
      return Promise.reject(new ExportOperationError(triggerErr));
    }

    if (allocatedEphemeral) {
      const timer = setTimeout(() => {
        this.revokeEphemeralUrlNow(targetUrl);
        this.emit();
      }, this.ephemeralRevokeDelayMs);
      this.ephemeralUrls.set(targetUrl, timer);
    }

    const result: ExportResult = {
      downloadFileName,
      mimeType: job.artifact.mimeType,
      sizeBytes: job.artifact.sizeBytes,
      durationMs: job.artifact.durationMs,
      exportedAtIso: this.clock().toISOString(),
    };

    this.lastExportResult = result;
    this.exportCount += 1;
    this.status = 'exported';
    this.error = null;
    this.emit();

    return Promise.resolve(result);
  }

  public dispose(): void {
    if (this.disposed) {
      return;
    }
    this.disposed = true;
    for (const [url, timer] of Array.from(this.ephemeralUrls.entries())) {
      clearTimeout(timer);
      this.urlAdapter.revokeObjectURL(url);
    }
    this.ephemeralUrls.clear();
    this.previewRegistry.revokeAll();
    this.previewUrl = null;
    this.activeArtifactId = null;
    this.status = 'idle';
    this.stateSnapshot = this.buildSnapshot();
    this.listeners.clear();
  }

  private revokeEphemeralUrlNow(url: string): void {
    const timer = this.ephemeralUrls.get(url);
    if (timer !== undefined) {
      clearTimeout(timer);
      this.ephemeralUrls.delete(url);
      this.urlAdapter.revokeObjectURL(url);
    }
  }

  private buildSnapshot(): ExportStateSnapshot {
    return {
      status: this.status,
      activeArtifactId: this.activeArtifactId,
      previewUrl: this.previewUrl,
      suggestedFileName: this.suggestedFileName,
      lastExportResult: this.lastExportResult,
      exportCount: this.exportCount,
      activeObjectUrlCount:
        this.previewRegistry.getActiveCount() + this.ephemeralUrls.size,
      error: this.error,
    };
  }

  private emit(): void {
    this.stateSnapshot = this.buildSnapshot();
    for (const listener of this.listeners) {
      listener(this.stateSnapshot);
    }
  }
}

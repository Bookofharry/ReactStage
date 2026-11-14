import type { RecordedMediaArtifact } from './recording-engine';

export type ExportStatus = 'idle' | 'ready' | 'exporting' | 'exported' | 'error';

export type ExportErrorCode =
  | 'EMPTY_EXPORT_ARTIFACT'
  | 'INVALID_FILE_NAME'
  | 'PREVIEW_URL_FAILED'
  | 'DOWNLOAD_TRIGGER_FAILED'
  | 'EXPORT_DISPOSED';

export interface ExportError {
  readonly code: ExportErrorCode;
  readonly title: string;
  readonly message: string;
  readonly recoverable: boolean;
}

export interface ExportJobDescriptor {
  readonly artifact: RecordedMediaArtifact;
  readonly baseFileName: string;
}

export interface ExportResult {
  readonly downloadFileName: string;
  readonly mimeType: string;
  readonly sizeBytes: number;
  readonly durationMs: number;
  readonly exportedAtIso: string;
}

export interface ExportStateSnapshot {
  readonly status: ExportStatus;
  readonly activeArtifactId: string | null;
  readonly previewUrl: string | null;
  readonly suggestedFileName: string;
  readonly lastExportResult: ExportResult | null;
  readonly exportCount: number;
  readonly activeObjectUrlCount: number;
  readonly error: ExportError | null;
}

/**
 * Service contract for packaging, sanitizing filenames, previewing, and saving
 * finalized reaction video artifacts locally with deterministic Object URL cleanup.
 */
export interface ExportManager {
  getState(): ExportStateSnapshot;
  subscribe(listener: (state: ExportStateSnapshot) => void): () => void;
  buildSuggestedFileName(
    sourceFileName: string | null,
    mimeType: string,
  ): string;
  normalizeDownloadFileName(baseFileName: string, mimeType: string): string;
  attachArtifact(
    artifact: RecordedMediaArtifact | null,
    sourceFileName?: string | null,
  ): string | null;
  createPreviewUrl(artifact: RecordedMediaArtifact): string;
  revokePreviewUrl(url: string): void;
  triggerLocalDownload(job: ExportJobDescriptor): Promise<ExportResult>;
  dispose(): void;
}

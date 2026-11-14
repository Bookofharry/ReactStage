import { useRef, useState, type ChangeEvent } from 'react';
import type { ExportStatus } from '../services/interfaces/export-manager';
import { useExport } from '../state/ExportContext';
import {
  buildChaptersFileName,
  formatChapterTimestamp,
  formatYouTubeChapters,
  triggerLocalTextDownload,
} from '../utils/chapters';
import { formatBytes, formatTimecode } from '../utils/format';
import {
  AlertIcon,
  CopyClipboardIcon,
  DownloadIcon,
  FlagMarkerIcon,
  HistoryIcon,
  TrashIcon,
} from './StudioIcons';

function getExportBadgeMeta(
  status: ExportStatus,
  hasArtifact: boolean,
): {
  readonly label: string;
  readonly classes: string;
} {
  if (!hasArtifact && status !== 'error') {
    return {
      label: 'Awaiting Take',
      classes: 'border-slate-700 bg-slate-800 text-slate-300',
    };
  }
  switch (status) {
    case 'exporting':
      return {
        label: 'Saving…',
        classes: 'border-sky-400/40 bg-sky-400/10 text-sky-300',
      };
    case 'exported':
      return {
        label: 'Downloaded',
        classes: 'border-emerald-400/40 bg-emerald-400/10 text-emerald-300',
      };
    case 'error':
      return {
        label: 'Export Error',
        classes: 'border-rose-400/40 bg-rose-400/10 text-rose-300',
      };
    case 'ready':
    case 'idle':
    default:
      return {
        label: 'Ready to Save',
        classes: 'border-sky-400/40 bg-sky-400/10 text-sky-300',
      };
  }
}

export function ExportPanel() {
  const {
    state,
    artifact,
    takes,
    selectedTakeId,
    activeTake,
    fileNameDraft,
    normalizedFileName,
    selectTake,
    removeTake,
    clearAllTakes,
    setFileNameDraft,
    resetFileNameDraft,
    downloadArtifact,
  } = useExport();

  const previewVideoRef = useRef<HTMLVideoElement | null>(null);
  const [chaptersCopied, setChaptersCopied] = useState(false);

  const hasArtifact = artifact !== null && state.previewUrl !== null;
  const badge = getExportBadgeMeta(state.status, hasArtifact);
  const isCustomEdited =
    hasArtifact &&
    activeTake?.customFileName !== null &&
    fileNameDraft !== state.suggestedFileName;
  const chapterMarkers = artifact?.chapterMarkers ?? [];
  const formattedChaptersText =
    chapterMarkers.length > 0 ? formatYouTubeChapters(chapterMarkers) : '';

  const handleFileNameChange = (event: ChangeEvent<HTMLInputElement>) => {
    setFileNameDraft(event.currentTarget.value);
  };

  const handleSeekToMarker = (elapsedRecordingMs: number) => {
    const video = previewVideoRef.current;
    if (!video) {
      return;
    }
    const targetSec = Math.max(0, elapsedRecordingMs / 1000);
    video.currentTime = targetSec;
  };

  const handleCopyChapters = async () => {
    if (!formattedChaptersText) {
      return;
    }
    try {
      await navigator.clipboard.writeText(formattedChaptersText);
      setChaptersCopied(true);
      setTimeout(() => {
        setChaptersCopied(false);
      }, 2000);
    } catch {
      // Clipboard API may be restricted in non-HTTPS contexts
    }
  };

  const handleDownloadChaptersTxt = () => {
    if (!formattedChaptersText) {
      return;
    }
    const txtName = buildChaptersFileName(normalizedFileName);
    triggerLocalTextDownload(txtName, formattedChaptersText);
  };

  return (
    <section
      data-testid="export-panel"
      aria-labelledby="export-panel-heading"
      className="flex flex-col rounded-xl border border-slate-800 bg-slate-900 p-4 shadow-lg"
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <DownloadIcon className="h-4 w-4 shrink-0 text-sky-300" />
          <h2
            id="export-panel-heading"
            className="text-sm font-semibold text-slate-100"
          >
            Synchronized Export
          </h2>
        </div>

        <span
          data-testid="export-status-badge"
          className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-[11px] font-medium ${badge.classes}`}
        >
          {badge.label}
        </span>
      </div>

      {state.error && (
        <div
          role="alert"
          data-testid="export-error-alert"
          className="mt-3 flex items-start gap-2 rounded-lg border border-rose-500/40 bg-rose-950/75 p-3 text-xs text-rose-100"
        >
          <AlertIcon className="mt-0.5 h-4 w-4 shrink-0 text-rose-300" />
          <div>
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="font-semibold">{state.error.title}</span>
              <span className="rounded bg-rose-900/90 px-1.5 py-0.5 font-mono text-[10px] text-rose-200">
                {state.error.code}
              </span>
            </div>
            <p className="mt-0.5 text-[11px] leading-relaxed text-rose-100">
              {state.error.message}
            </p>
          </div>
        </div>
      )}

      {!hasArtifact ? (
        <div
          data-testid="export-empty-state"
          className="mt-3 rounded-lg border border-dashed border-slate-700 bg-slate-950 px-3.5 py-4"
        >
          <p className="text-xs font-medium text-slate-100">
            No recorded reaction session yet
          </p>
          <p className="mt-1 text-xs leading-relaxed text-slate-300">
            Record and finalize a reaction take above to review playback
            instantly and save the video file directly to your device.
          </p>
        </div>
      ) : (
        <div className="mt-3 flex flex-col gap-3">
          {/* Multi-Take Session Drawer */}
          {takes.length > 0 && (
            <div
              data-testid="session-takes-drawer"
              className="rounded-lg border border-slate-800 bg-slate-950 p-2.5"
            >
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-1.5 text-xs font-semibold text-slate-200">
                  <HistoryIcon className="h-3.5 w-3.5 shrink-0 text-sky-300" />
                  <span>Session Takes</span>
                  <span
                    data-testid="session-takes-count"
                    className="rounded-full border border-slate-700 bg-slate-900 px-1.5 py-0.5 font-mono text-[10px] text-sky-300 tabular-nums"
                  >
                    {takes.length}
                  </span>
                </div>

                {takes.length > 1 && (
                  <button
                    type="button"
                    data-testid="clear-all-takes-button"
                    onClick={clearAllTakes}
                    className="text-[11px] font-medium text-slate-300 underline hover:text-rose-300 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky-300"
                  >
                    Clear all
                  </button>
                )}
              </div>

              <ul
                aria-label="Recorded session takes"
                className="mt-2 flex max-h-36 flex-col gap-1.5 overflow-y-auto"
              >
                {takes.map((entry) => {
                  const isSelected = entry.artifact.id === selectedTakeId;
                  return (
                    <li
                      key={entry.artifact.id}
                      data-testid={`session-take-row-${entry.takeNumber}`}
                      className={`flex items-center justify-between gap-1.5 rounded-md border px-2 py-1.5 text-xs ${
                        isSelected
                          ? 'border-sky-400/50 bg-sky-950/40'
                          : 'border-slate-800 bg-slate-900/70'
                      }`}
                    >
                      <button
                        type="button"
                        data-testid={`select-take-button-${entry.takeNumber}`}
                        aria-pressed={isSelected}
                        onClick={() => selectTake(entry.artifact.id)}
                        className="flex min-w-0 flex-1 flex-wrap items-center gap-x-2 gap-y-0.5 text-left focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky-300"
                      >
                        <span
                          className={`font-semibold ${
                            isSelected ? 'text-sky-200' : 'text-slate-100'
                          }`}
                        >
                          Take #{entry.takeNumber}
                        </span>
                        <span className="font-mono text-[11px] text-slate-300 tabular-nums">
                          {formatTimecode(entry.artifact.durationMs / 1000, true)}{' '}
                          · {formatBytes(entry.artifact.sizeBytes)}
                        </span>
                        {entry.downloadedCount > 0 && (
                          <span className="rounded bg-emerald-400/15 px-1.5 py-0.5 text-[10px] font-medium text-emerald-300">
                            Saved
                          </span>
                        )}
                      </button>

                      <button
                        type="button"
                        data-testid={`delete-take-button-${entry.takeNumber}`}
                        aria-label={`Delete Take #${entry.takeNumber}`}
                        onClick={() => removeTake(entry.artifact.id)}
                        className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md border border-slate-700 bg-slate-900 text-slate-300 hover:border-rose-400/40 hover:text-rose-300 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky-300"
                      >
                        <TrashIcon className="h-3.5 w-3.5" />
                      </button>
                    </li>
                  );
                })}
              </ul>
            </div>
          )}

          {/* Instant Local Playback Review */}
          <div className="overflow-hidden rounded-lg border border-slate-800 bg-slate-950">
            <video
              ref={previewVideoRef}
              key={state.previewUrl}
              data-testid="export-preview-video"
              src={state.previewUrl}
              controls
              playsInline
              preload="metadata"
              aria-label="Recorded reaction video preview"
              className="aspect-video w-full bg-black object-contain"
            />
            <div className="flex flex-wrap items-center justify-between gap-2 border-t border-slate-800 px-3 py-1.5 text-[11px] text-slate-300">
              <span className="font-mono tabular-nums">
                {activeTake ? `Take #${activeTake.takeNumber} · ` : ''}
                {artifact.width}×{artifact.height} ·{' '}
                {formatTimecode(artifact.durationMs / 1000, true)}
              </span>
              <span className="font-mono font-semibold text-slate-200 tabular-nums">
                {formatBytes(artifact.sizeBytes)}
              </span>
            </div>
          </div>

          {/* Recorded Chapter Markers & YouTube 00:00 Export */}
          {chapterMarkers.length > 0 && (
            <div
              data-testid="export-chapters-card"
              className="rounded-lg border border-slate-800 bg-slate-950 p-3"
            >
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-sky-300">
                  <FlagMarkerIcon className="h-3.5 w-3.5 shrink-0" />
                  <span>Chapter Timestamps ({chapterMarkers.length})</span>
                </span>

                <div className="flex flex-wrap items-center gap-1.5">
                  <button
                    type="button"
                    data-testid="copy-chapters-button"
                    onClick={() => {
                      void handleCopyChapters();
                    }}
                    className="inline-flex items-center gap-1 rounded-md border border-slate-700 bg-slate-900 px-2 py-1 text-[11px] font-medium text-slate-100 hover:bg-slate-800 focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-sky-300"
                  >
                    <CopyClipboardIcon className="h-3 w-3 shrink-0" />
                    <span>{chaptersCopied ? 'Copied!' : 'Copy YouTube'}</span>
                  </button>

                  <button
                    type="button"
                    data-testid="download-chapters-txt-button"
                    onClick={handleDownloadChaptersTxt}
                    className="inline-flex items-center gap-1 rounded-md border border-slate-700 bg-slate-900 px-2 py-1 text-[11px] font-medium text-sky-300 hover:bg-slate-800 focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-sky-300"
                  >
                    <DownloadIcon className="h-3 w-3 shrink-0" />
                    <span>Save .txt</span>
                  </button>
                </div>
              </div>

              <div className="mt-2 flex flex-wrap gap-1.5">
                {chapterMarkers.map((marker) => (
                  <button
                    key={marker.id}
                    type="button"
                    data-testid={`seek-chapter-marker-${String(marker.index)}`}
                    onClick={() => handleSeekToMarker(marker.elapsedRecordingMs)}
                    className="inline-flex items-center gap-1.5 rounded-md border border-slate-700 bg-slate-900 px-2 py-1 text-left text-[11px] text-slate-100 hover:border-sky-400/50 hover:bg-slate-800 focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-sky-300"
                  >
                    <span className="font-mono font-semibold text-sky-300 tabular-nums">
                      {formatChapterTimestamp(marker.elapsedRecordingMs)}
                    </span>
                    <span className="max-w-[160px] truncate">{marker.label}</span>
                  </button>
                ))}
              </div>

              <pre
                data-testid="youtube-chapters-preview"
                className="mt-2 max-h-24 overflow-y-auto rounded border border-slate-800 bg-slate-900/80 p-2 font-mono text-[11px] leading-relaxed text-slate-200"
              >
                {formattedChaptersText}
              </pre>
            </div>
          )}

          {/* Safe Filename Editor */}
          <div className="flex flex-col gap-1.5">
            <div className="flex items-center justify-between gap-2">
              <label
                htmlFor="export-filename-input"
                className="text-xs font-medium text-slate-200"
              >
                Download filename
              </label>
              {isCustomEdited && (
                <button
                  type="button"
                  data-testid="reset-export-filename-button"
                  onClick={resetFileNameDraft}
                  className="text-[11px] font-medium text-sky-300 underline hover:text-sky-200 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky-300"
                >
                  Reset suggested
                </button>
              )}
            </div>

            <input
              id="export-filename-input"
              data-testid="export-filename-input"
              type="text"
              value={fileNameDraft}
              onChange={handleFileNameChange}
              spellCheck={false}
              className="min-h-9 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-1.5 font-mono text-xs text-slate-100 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky-300"
            />

            <p className="truncate text-[11px] text-slate-300">
              Saves as:{' '}
              <code
                data-testid="export-normalized-filename"
                className="text-sky-300"
              >
                {normalizedFileName}
              </code>
            </p>
          </div>

          {/* Primary Local Download Trigger */}
          <button
            type="button"
            data-testid="download-export-button"
            disabled={state.status === 'exporting'}
            onClick={() => {
              void downloadArtifact();
            }}
            className="inline-flex min-h-10 w-full items-center justify-center gap-2 rounded-lg bg-emerald-400 px-4 py-2 text-sm font-semibold text-slate-950 hover:bg-emerald-300 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-300 disabled:cursor-not-allowed disabled:bg-slate-800 disabled:text-slate-400"
          >
            <DownloadIcon className="h-4 w-4 shrink-0" />
            <span>
              {(activeTake?.downloadedCount ?? 0) > 0
                ? 'Download Reaction Video Again'
                : 'Download Reaction Video'}
            </span>
          </button>

          {state.lastExportResult && (
            <div
              data-testid="export-success-banner"
              className="rounded-lg border border-emerald-400/35 bg-emerald-950/35 px-3 py-2 text-[11px] text-emerald-200"
            >
              Saved{' '}
              <span className="font-mono font-semibold">
                {state.lastExportResult.downloadFileName}
              </span>{' '}
              ({formatBytes(state.lastExportResult.sizeBytes)}) to your local
              downloads folder.
            </div>
          )}
        </div>
      )}

      <p className="mt-2.5 text-xs leading-relaxed text-slate-300">
        100% on-device packaging · Preview Object URLs are automatically revoked
        when replaced, discarded, or closed.
      </p>
    </section>
  );
}

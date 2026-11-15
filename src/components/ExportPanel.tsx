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
  AudioWaveformFileIcon,
  ChevronDownIcon,
  CopyClipboardIcon,
  DatabaseVaultIcon,
  DownloadIcon,
  FlagMarkerIcon,
  HistoryIcon,
  ScissorsTrimIcon,
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
      classes: 'border-white/10 bg-slate-800/90 text-slate-300',
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
        classes: 'border-rose-400/40 bg-rose-950/75 text-rose-200',
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
    vaultSupported,
    vaultTotalBytes,
    trimStartSec,
    trimEndSec,
    trimmedDurationSec,
    isTrimmed,
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
  } = useExport();

  const previewVideoRef = useRef<HTMLVideoElement | null>(null);
  const [chaptersCopied, setChaptersCopied] = useState(false);
  const [isMoreExportOpen, setIsMoreExportOpen] = useState(false);

  const hasArtifact = artifact !== null && state.previewUrl !== null;
  const badge = getExportBadgeMeta(state.status, hasArtifact);
  const isCustomEdited =
    hasArtifact &&
    activeTake?.customFileName !== null &&
    fileNameDraft !== state.suggestedFileName;
  const chapterMarkers = artifact?.chapterMarkers ?? [];
  const formattedChaptersText =
    chapterMarkers.length > 0 ? formatYouTubeChapters(chapterMarkers) : '';
  const fullDurationSec = artifact
    ? Math.round(Math.max(0.2, artifact.durationMs / 1000) * 100) / 100
    : 0;

  const showAdvancedExport =
    isMoreExportOpen ||
    isTrimmed ||
    isCustomEdited ||
    Boolean(lastCompanionExportMessage);

  const handleFileNameChange = (event: ChangeEvent<HTMLInputElement>) => {
    setFileNameDraft(event.currentTarget.value);
  };

  const handleTrimStartChange = (event: ChangeEvent<HTMLInputElement>) => {
    const parsed = Number(event.currentTarget.value);
    if (!Number.isFinite(parsed)) {
      return;
    }
    setTrimRange(parsed, trimEndSec);
    if (previewVideoRef.current) {
      try {
        previewVideoRef.current.currentTime = Math.max(0, parsed);
      } catch {
        // Ignore seek errors on unready media elements
      }
    }
  };

  const handleTrimEndChange = (event: ChangeEvent<HTMLInputElement>) => {
    const parsed = Number(event.currentTarget.value);
    if (!Number.isFinite(parsed)) {
      return;
    }
    setTrimRange(trimStartSec, parsed);
  };

  const handlePreviewPlay = () => {
    const video = previewVideoRef.current;
    if (!video || !isTrimmed) {
      return;
    }
    if (
      video.currentTime < trimStartSec - 0.05 ||
      video.currentTime >= trimEndSec - 0.02
    ) {
      try {
        video.currentTime = trimStartSec;
      } catch {
        // Ignore seek errors
      }
    }
  };

  const handlePreviewTimeUpdate = () => {
    const video = previewVideoRef.current;
    if (!video || !isTrimmed) {
      return;
    }
    if (video.currentTime >= trimEndSec) {
      video.pause();
      try {
        video.currentTime = trimStartSec;
      } catch {
        // Ignore seek errors
      }
    }
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
      className="flex min-w-0 flex-col rounded-xl border border-white/[0.07] bg-slate-950/65 p-3"
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <DownloadIcon className="h-4 w-4 shrink-0 text-sky-300" />
          <h2
            id="export-panel-heading"
            className="text-sm font-semibold text-white"
          >
            Recorded Takes
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
          className="mt-3 flex items-start gap-2 rounded-xl border border-rose-500/40 bg-rose-950/75 p-3 text-xs text-rose-100"
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
          className="mt-3 rounded-xl border border-dashed border-white/10 bg-slate-900/60 px-3.5 py-5 text-center"
        >
          <p className="text-xs font-semibold text-white">
            No takes recorded yet
          </p>
          <p className="mt-1 text-xs leading-relaxed text-slate-300">
            Hit <strong className="text-slate-100">Start Recording</strong>{' '}
            under the stage — your finished videos appear right here for instant
            preview and download.
          </p>
        </div>
      ) : (
        <div className="mt-3 flex flex-col gap-3">
          {/* Instant Local Playback Review + Primary 1-Click Download Up Front */}
          <div className="overflow-hidden rounded-xl border border-white/[0.08] bg-slate-900/90">
            <video
              ref={previewVideoRef}
              key={state.previewUrl}
              data-testid="export-preview-video"
              src={state.previewUrl}
              controls
              playsInline
              preload="metadata"
              onPlay={handlePreviewPlay}
              onTimeUpdate={handlePreviewTimeUpdate}
              aria-label="Recorded reaction video preview"
              className="aspect-video max-h-72 w-full bg-black object-contain"
            />
            <div className="flex flex-wrap items-center justify-between gap-2 border-t border-white/[0.07] px-3 py-2 text-[11px] text-slate-300">
              <span className="font-mono tabular-nums">
                {activeTake ? `Take #${String(activeTake.takeNumber)} · ` : ''}
                {artifact.width}×{artifact.height} ·{' '}
                {formatTimecode(artifact.durationMs / 1000, true)}
              </span>
              <span className="font-mono font-semibold text-slate-100 tabular-nums">
                {formatBytes(artifact.sizeBytes)}
              </span>
            </div>
          </div>

          {/* Quick Filename Input + Primary 1-Click Local Download */}
          <div className="flex flex-col gap-2 rounded-xl border border-white/[0.07] bg-slate-900/75 p-2.5">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <label
                htmlFor="export-filename-input"
                className="text-xs font-medium text-slate-200"
              >
                File name
              </label>
              {isCustomEdited && (
                <button
                  type="button"
                  data-testid="reset-export-filename-button"
                  onClick={resetFileNameDraft}
                  className="min-h-7 text-[11px] font-medium text-sky-300 underline hover:text-sky-200 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky-300"
                >
                  Reset name
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
              className="min-h-10 w-full rounded-lg border border-white/10 bg-slate-950 px-3 py-2 font-mono text-xs text-slate-100 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky-300"
            />

            <p className="text-[11px] leading-snug text-slate-300 break-all">
              Saves as:{' '}
              <code
                data-testid="export-normalized-filename"
                className="text-sky-300"
              >
                {normalizedFileName}
              </code>
            </p>

            <button
              type="button"
              data-testid="download-export-button"
              disabled={state.status === 'exporting'}
              onClick={() => {
                void downloadArtifact();
              }}
              className="mt-0.5 inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-xl bg-emerald-400 px-4 py-2.5 text-sm font-bold text-slate-950 shadow-lg shadow-emerald-500/15 transition hover:bg-emerald-300 active:bg-emerald-500 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-300 disabled:cursor-not-allowed disabled:bg-slate-800 disabled:text-slate-400 disabled:shadow-none"
            >
              <DownloadIcon className="h-4 w-4 shrink-0" />
              <span>
                {(activeTake?.downloadedCount ?? 0) > 0
                  ? 'Download Video Again'
                  : 'Download Video'}
              </span>
            </button>
          </div>

          {state.lastExportResult && (
            <div
              data-testid="export-success-banner"
              className="rounded-xl border border-emerald-400/35 bg-emerald-950/35 px-3 py-2 text-[11px] leading-relaxed text-emerald-200 break-words"
            >
              Saved{' '}
              <span className="font-mono font-semibold break-all">
                {state.lastExportResult.downloadFileName}
              </span>{' '}
              ({formatBytes(state.lastExportResult.sizeBytes)}) to your
              downloads folder.
            </div>
          )}

          {/* Recorded Chapter Markers & YouTube 00:00 Export */}
          {chapterMarkers.length > 0 && (
            <div
              data-testid="export-chapters-card"
              className="rounded-xl border border-white/[0.07] bg-slate-900/75 p-3"
            >
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-sky-300">
                  <FlagMarkerIcon className="h-3.5 w-3.5 shrink-0" />
                  <span>YouTube Chapters ({chapterMarkers.length})</span>
                </span>

                <div className="flex flex-wrap items-center gap-1.5">
                  <button
                    type="button"
                    data-testid="copy-chapters-button"
                    onClick={() => {
                      void handleCopyChapters();
                    }}
                    className="inline-flex min-h-9 items-center gap-1 rounded-lg border border-white/10 bg-slate-950 px-2.5 py-1.5 text-[11px] font-medium text-slate-100 hover:bg-slate-800 focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-sky-300"
                  >
                    <CopyClipboardIcon className="h-3 w-3 shrink-0" />
                    <span>{chaptersCopied ? 'Copied!' : 'Copy'}</span>
                  </button>

                  <button
                    type="button"
                    data-testid="download-chapters-txt-button"
                    onClick={handleDownloadChaptersTxt}
                    className="inline-flex min-h-9 items-center gap-1 rounded-lg border border-white/10 bg-slate-950 px-2.5 py-1.5 text-[11px] font-medium text-sky-300 hover:bg-slate-800 focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-sky-300"
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
                    className="inline-flex min-h-9 max-w-full items-center gap-1.5 rounded-lg border border-white/10 bg-slate-950 px-2.5 py-1 text-left text-[11px] text-slate-100 hover:border-sky-400/50 hover:bg-slate-800 focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-sky-300"
                  >
                    <span className="shrink-0 font-mono font-semibold text-sky-300 tabular-nums">
                      {formatChapterTimestamp(marker.elapsedRecordingMs)}
                    </span>
                    <span className="min-w-0 break-words">{marker.label}</span>
                  </button>
                ))}
              </div>

              <pre
                data-testid="youtube-chapters-preview"
                className="mt-2 max-h-24 overflow-x-auto overflow-y-auto whitespace-pre-wrap rounded-lg border border-white/[0.06] bg-slate-950/85 p-2 font-mono text-[11px] leading-relaxed text-slate-200 break-words"
              >
                {formattedChaptersText}
              </pre>
            </div>
          )}

          {/* Multi-Take Session Switcher + Auto-Save Vault */}
          {takes.length > 0 && (
            <div
              data-testid="session-takes-drawer"
              className="rounded-xl border border-white/[0.07] bg-slate-900/75 p-2.5"
            >
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex flex-wrap items-center gap-1.5 text-xs font-semibold text-slate-200">
                  <HistoryIcon className="h-3.5 w-3.5 shrink-0 text-sky-300" />
                  <span>All Takes</span>
                  <span
                    data-testid="session-takes-count"
                    className="rounded-full border border-white/10 bg-slate-950 px-1.5 py-0.5 font-mono text-[10px] text-sky-300 tabular-nums"
                  >
                    {takes.length}
                  </span>
                  {vaultSupported && (
                    <span
                      data-testid="vault-status-badge"
                      className="inline-flex items-center gap-1 rounded-full border border-emerald-400/35 bg-emerald-950/60 px-2 py-0.5 text-[10px] font-medium text-emerald-200"
                    >
                      <DatabaseVaultIcon className="h-2.5 w-2.5 shrink-0 text-emerald-300" />
                      <span>Vault Saved · {formatBytes(vaultTotalBytes)}</span>
                    </span>
                  )}
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
                      data-testid={`session-take-row-${String(entry.takeNumber)}`}
                      className={`flex items-center justify-between gap-1.5 rounded-lg border px-2 py-1.5 text-xs ${
                        isSelected
                          ? 'border-sky-400/50 bg-sky-950/40'
                          : 'border-white/[0.06] bg-slate-950/70'
                      }`}
                    >
                      <button
                        type="button"
                        data-testid={`select-take-button-${String(entry.takeNumber)}`}
                        aria-pressed={isSelected}
                        onClick={() => selectTake(entry.artifact.id)}
                        className="flex min-h-9 min-w-0 flex-1 flex-wrap items-center gap-x-2 gap-y-0.5 py-0.5 text-left focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky-300"
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
                        data-testid={`delete-take-button-${String(entry.takeNumber)}`}
                        aria-label={`Delete Take #${String(entry.takeNumber)}`}
                        onClick={() => removeTake(entry.artifact.id)}
                        className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-white/10 bg-slate-900 text-slate-300 hover:border-rose-400/40 hover:text-rose-300 active:bg-slate-800 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky-300"
                      >
                        <TrashIcon className="h-3.5 w-3.5" />
                      </button>
                    </li>
                  );
                })}
              </ul>
            </div>
          )}

          {/* Progressive Disclosure: Trim Clip & Companion Audio (.wav) */}
          <div>
            <button
              type="button"
              data-testid="toggle-trim-tools-button"
              aria-expanded={showAdvancedExport}
              onClick={() => setIsMoreExportOpen((prev) => !prev)}
              className="flex min-h-10 w-full items-center justify-between gap-2 rounded-xl border border-white/[0.08] bg-slate-900/75 px-3 py-2 text-xs font-medium text-slate-200 hover:bg-slate-800/80 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky-300"
            >
              <span className="inline-flex items-center gap-1.5">
                <ScissorsTrimIcon className="h-3.5 w-3.5 shrink-0 text-sky-300" />
                <span>Trim Clip &amp; Save Audio (.wav)</span>
              </span>
              <ChevronDownIcon
                className={`h-4 w-4 shrink-0 text-slate-300 transition-transform ${
                  showAdvancedExport ? 'rotate-180' : ''
                }`}
              />
            </button>

            {showAdvancedExport && (
              <div className="mt-2.5 flex flex-col gap-3">
                {/* Non-Destructive Trim In/Out & Companion .wav Audio Export */}
                <div
                  data-testid="export-trim-audio-card"
                  className="rounded-xl border border-white/[0.07] bg-slate-900/75 p-3"
                >
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-sky-300">
                      <ScissorsTrimIcon className="h-3.5 w-3.5 shrink-0" />
                      <span>Trim Clip &amp; Save Audio</span>
                    </span>

                    <div className="flex flex-wrap items-center gap-2">
                      <span
                        data-testid="trim-range-summary"
                        className="rounded-md border border-white/10 bg-slate-950 px-2 py-0.5 font-mono text-[10px] font-semibold text-slate-200 tabular-nums"
                      >
                        {isTrimmed
                          ? `${formatTimecode(trimmedDurationSec, true)} Selected`
                          : 'Full Clip'}
                      </span>
                      {isTrimmed && (
                        <button
                          type="button"
                          data-testid="reset-trim-button"
                          onClick={resetTrimRange}
                          className="min-h-8 px-1 text-[11px] font-medium text-sky-300 underline hover:text-sky-200 focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-sky-300"
                        >
                          Reset Trim
                        </button>
                      )}
                    </div>
                  </div>

                  <div className="mt-2.5 grid grid-cols-1 gap-2 min-[360px]:grid-cols-2">
                    <div className="flex flex-col gap-1">
                      <label
                        htmlFor="export-trim-start-input"
                        className="text-[11px] font-medium text-slate-300"
                      >
                        Start Time (s)
                      </label>
                      <input
                        id="export-trim-start-input"
                        data-testid="trim-start-input"
                        type="number"
                        min={0}
                        max={fullDurationSec}
                        step={0.1}
                        value={trimStartSec}
                        onChange={handleTrimStartChange}
                        className="min-h-9 w-full rounded-lg border border-white/10 bg-slate-950 px-2.5 py-1.5 font-mono text-xs text-slate-100 tabular-nums focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-sky-300"
                      />
                    </div>

                    <div className="flex flex-col gap-1">
                      <label
                        htmlFor="export-trim-end-input"
                        className="text-[11px] font-medium text-slate-300"
                      >
                        End Time (s)
                      </label>
                      <input
                        id="export-trim-end-input"
                        data-testid="trim-end-input"
                        type="number"
                        min={0.2}
                        max={fullDurationSec}
                        step={0.1}
                        value={trimEndSec}
                        onChange={handleTrimEndChange}
                        className="min-h-9 w-full rounded-lg border border-white/10 bg-slate-950 px-2.5 py-1.5 font-mono text-xs text-slate-100 tabular-nums focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-sky-300"
                      />
                    </div>
                  </div>

                  <div className="mt-2.5 grid grid-cols-1 gap-2 sm:grid-cols-2">
                    <button
                      type="button"
                      data-testid="download-wav-button"
                      disabled={isProcessingCompanionExport}
                      onClick={() => {
                        void exportCompanionWav();
                      }}
                      className="inline-flex min-h-9 items-center justify-center gap-1.5 rounded-lg border border-white/10 bg-slate-950 px-2.5 py-2 text-xs font-medium text-slate-100 hover:bg-slate-800 focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-sky-300 disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      <AudioWaveformFileIcon className="h-3.5 w-3.5 shrink-0 text-sky-300" />
                      <span>
                        {isTrimmed ? 'Save Trimmed .wav' : 'Save Audio (.wav)'}
                      </span>
                    </button>

                    <button
                      type="button"
                      data-testid="download-trimmed-video-button"
                      disabled={!isTrimmed || isProcessingCompanionExport}
                      onClick={() => {
                        void exportTrimmedVideo();
                      }}
                      className="inline-flex min-h-9 items-center justify-center gap-1.5 rounded-lg border border-sky-400/40 bg-sky-950/50 px-2.5 py-2 text-xs font-semibold text-sky-200 hover:bg-sky-900/60 focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-sky-300 disabled:cursor-not-allowed disabled:border-white/[0.06] disabled:bg-slate-950 disabled:text-slate-400"
                    >
                      <ScissorsTrimIcon className="h-3.5 w-3.5 shrink-0" />
                      <span>Save Trimmed Video</span>
                    </button>
                  </div>

                  {lastCompanionExportMessage && (
                    <p
                      data-testid="companion-export-banner"
                      className="mt-2 text-[11px] font-medium text-emerald-300 break-words"
                    >
                      {lastCompanionExportMessage}
                    </p>
                  )}
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </section>
  );
}

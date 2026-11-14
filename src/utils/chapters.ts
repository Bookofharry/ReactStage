import type { RecordingChapterMarker } from '../services/interfaces/recording-engine';

export const MAX_CHAPTER_LABEL_LENGTH = 60;

export function sanitizeChapterLabel(raw: string): string {
  let cleaned = '';
  for (const ch of raw) {
    const code = ch.codePointAt(0) ?? 0;
    if (code >= 0x20 && code !== 0x7f) {
      cleaned += ch;
    }
  }
  return cleaned
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, MAX_CHAPTER_LABEL_LENGTH);
}

/**
 * Formats a millisecond timestamp as YouTube-compatible `MM:SS` (or `HH:MM:SS`).
 */
export function formatChapterTimestamp(ms: number): string {
  const safeTotalSeconds =
    Number.isFinite(ms) && ms > 0 ? Math.floor(ms / 1000) : 0;
  const hours = Math.floor(safeTotalSeconds / 3600);
  const minutes = Math.floor((safeTotalSeconds % 3600) / 60);
  const seconds = safeTotalSeconds % 60;

  const mm = String(minutes).padStart(2, '0');
  const ss = String(seconds).padStart(2, '0');

  if (hours > 0) {
    return `${String(hours).padStart(2, '0')}:${mm}:${ss}`;
  }
  return `${mm}:${ss}`;
}

/**
 * Generates a YouTube-ready chapter list starting at `00:00`.
 * Automatically prepends `00:00 Intro` if the first marker occurs after `00:00`.
 */
export function formatYouTubeChapters(
  markers: readonly RecordingChapterMarker[],
  introLabel = 'Intro',
): string {
  if (markers.length === 0) {
    return `00:00 ${introLabel}`;
  }

  const sorted = [...markers].sort(
    (a, b) => a.elapsedRecordingMs - b.elapsedRecordingMs,
  );
  const lines: string[] = [];

  const first = sorted[0];
  if (first && Math.floor(first.elapsedRecordingMs / 1000) > 0) {
    lines.push(`00:00 ${introLabel}`);
  }

  for (const marker of sorted) {
    const stamp = formatChapterTimestamp(marker.elapsedRecordingMs);
    const sourceSuffix =
      marker.sourceTimeSec !== null && Number.isFinite(marker.sourceTimeSec)
        ? ` (Source ${formatChapterTimestamp(marker.sourceTimeSec * 1000)})`
        : '';
    lines.push(`${stamp} ${marker.label}${sourceSuffix}`);
  }

  return lines.join('\n');
}

export function buildChaptersFileName(normalizedVideoFileName: string): string {
  const withoutExt = normalizedVideoFileName.replace(/\.(webm|mp4)$/i, '');
  const base = withoutExt.length > 0 ? withoutExt : 'reaction-recording';
  return `${base}-chapters.txt`;
}

export function triggerLocalTextDownload(
  fileName: string,
  content: string,
): void {
  if (typeof document === 'undefined' || typeof URL === 'undefined') {
    return;
  }
  const blob = new Blob([content], { type: 'text/plain;charset=utf-8' });
  const objectUrl = URL.createObjectURL(blob);
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
    setTimeout(() => {
      try {
        URL.revokeObjectURL(objectUrl);
      } catch {
        // Ignore already-revoked errors
      }
    }, 300);
  }
}

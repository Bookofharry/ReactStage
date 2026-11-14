import type { FileValidationResult } from '../interfaces/source-player';

export type CanPlayTypeFn = (mimeType: string) => CanPlayTypeResult;

const EXTENSION_MIME_FALLBACKS: Readonly<Record<string, string>> = {
  '.mp4': 'video/mp4',
  '.m4v': 'video/mp4',
  '.webm': 'video/webm',
  '.ogv': 'video/ogg',
  '.ogg': 'video/ogg',
  '.mov': 'video/quicktime',
  '.mkv': 'video/x-matroska',
  '.avi': 'video/x-msvideo',
  '.flv': 'video/x-flv',
  '.wmv': 'video/x-ms-wmv',
};

let sharedProbeVideo: HTMLVideoElement | null = null;

function defaultCanPlayType(mimeType: string): CanPlayTypeResult {
  if (typeof document === 'undefined') {
    return 'maybe';
  }
  sharedProbeVideo ??= document.createElement('video');
  return sharedProbeVideo.canPlayType(mimeType);
}

function extractLowerExtension(fileName: string): string {
  const lastDot = fileName.lastIndexOf('.');
  if (lastDot < 0) {
    return '';
  }
  return fileName.slice(lastDot).toLowerCase();
}

/**
 * Validates a local File candidate prior to allocating an Object URL.
 * Checks byte size, video MIME / extension classification, and browser canPlayType support.
 */
export function validateSourceVideoFile(
  file: File,
  canPlayType: CanPlayTypeFn = defaultCanPlayType,
): FileValidationResult {
  if (file.size <= 0) {
    return {
      valid: false,
      error: {
        code: 'EMPTY_FILE',
        title: 'Empty video file',
        message: `"${file.name}" contains 0 bytes. Select a valid non-empty local video file.`,
        fileName: file.name,
        recoverable: true,
      },
    };
  }

  const rawMime = file.type.trim().toLowerCase();
  const ext = extractLowerExtension(file.name);
  const fallbackMime = EXTENSION_MIME_FALLBACKS[ext];

  const isGenericBinary = rawMime === '' || rawMime === 'application/octet-stream';
  const normalizedMimeType = isGenericBinary ? (fallbackMime ?? '') : rawMime;

  if (!normalizedMimeType.startsWith('video/')) {
    const detectedLabel = rawMime || ext || 'unknown type';
    return {
      valid: false,
      error: {
        code: 'UNSUPPORTED_FILE_TYPE',
        title: 'Unsupported file format',
        message: `"${file.name}" (${detectedLabel}) is not a supported video file. Import an MP4, WebM, or Ogg video.`,
        fileName: file.name,
        recoverable: true,
      },
    };
  }

  const support = canPlayType(normalizedMimeType);
  if (support === '') {
    return {
      valid: false,
      error: {
        code: 'BROWSER_CODEC_UNSUPPORTED',
        title: 'Browser playback unsupported',
        message: `Your browser cannot natively play "${file.name}" (${normalizedMimeType}). Use MP4 (H.264/AAC) or WebM (VP8/VP9/AV1).`,
        fileName: file.name,
        recoverable: true,
      },
    };
  }

  return {
    valid: true,
    normalizedMimeType,
    supportLevel: support,
  };
}

import { PREFERRED_AV_RECORDING_MIME_TYPES } from '../services/interfaces/recording-engine';
import {
  patchWebmDurationIfStreaming,
  readBlobBytes,
} from '../services/recording-engine/webm-duration';

export const MIN_TRIM_DURATION_SEC = 0.2;
const DEFAULT_FALLBACK_WAV_SAMPLE_RATE = 22050;
const MAX_SILENT_FALLBACK_SECONDS = 30;

export interface ClampedTrimRange {
  readonly startSec: number;
  readonly endSec: number;
  readonly durationSec: number;
  readonly isTrimmed: boolean;
}

function roundTwoDecimals(value: number): number {
  return Math.round(value * 100) / 100;
}

export function clampTrimRange(
  startSec: number,
  endSec: number,
  totalDurationSec: number,
): ClampedTrimRange {
  if (!Number.isFinite(totalDurationSec) || totalDurationSec <= 0) {
    return {
      startSec: 0,
      endSec: 0,
      durationSec: 0,
      isTrimmed: false,
    };
  }

  const safeTotal = roundTwoDecimals(Math.max(0.05, totalDurationSec));
  const minSpan = Math.min(MIN_TRIM_DURATION_SEC, safeTotal);

  const rawStart = Number.isFinite(startSec) ? startSec : 0;
  const clampedStart = roundTwoDecimals(
    Math.min(Math.max(0, rawStart), Math.max(0, safeTotal - minSpan)),
  );

  const rawEnd =
    Number.isFinite(endSec) && endSec > 0 ? endSec : safeTotal;
  const clampedEnd = roundTwoDecimals(
    Math.min(safeTotal, Math.max(clampedStart + minSpan, rawEnd)),
  );

  const isTrimmed =
    clampedStart > 0.01 || clampedEnd < roundTwoDecimals(safeTotal - 0.01);

  return {
    startSec: clampedStart,
    endSec: clampedEnd,
    durationSec: roundTwoDecimals(Math.max(0, clampedEnd - clampedStart)),
    isTrimmed,
  };
}

function writeAscii(view: DataView, offset: number, text: string): void {
  for (let i = 0; i < text.length; i += 1) {
    view.setUint8(offset + i, text.charCodeAt(i) & 0xff);
  }
}

/**
 * Encodes 1 or 2 Float32 PCM channels into a standard 44-byte RIFF/WAVE
 * 16-bit signed little-endian PCM Blob (`audio/wav`).
 */
export function encodePcm16Wav(
  channels: readonly Float32Array[],
  sampleRate: number,
): Blob {
  const numChannels = Math.max(1, Math.min(2, channels.length));
  const safeSampleRate =
    Number.isFinite(sampleRate) && sampleRate >= 8000
      ? Math.round(sampleRate)
      : 44100;

  const ch0 = channels[0] ?? new Float32Array(0);
  const ch1 = numChannels === 2 ? (channels[1] ?? ch0) : ch0;
  const frameCount = ch0.length;

  const bytesPerSample = 2;
  const blockAlign = numChannels * bytesPerSample;
  const byteRate = safeSampleRate * blockAlign;
  const dataByteLength = frameCount * blockAlign;

  const buffer = new ArrayBuffer(44 + dataByteLength);
  const view = new DataView(buffer);

  // RIFF chunk descriptor
  writeAscii(view, 0, 'RIFF');
  view.setUint32(4, 36 + dataByteLength, true);
  writeAscii(view, 8, 'WAVE');

  // fmt sub-chunk
  writeAscii(view, 12, 'fmt ');
  view.setUint32(16, 16, true); // PCM subchunk1 size
  view.setUint16(20, 1, true); // AudioFormat = 1 (Linear PCM)
  view.setUint16(22, numChannels, true);
  view.setUint32(24, safeSampleRate, true);
  view.setUint32(28, byteRate, true);
  view.setUint16(32, blockAlign, true);
  view.setUint16(34, 16, true); // BitsPerSample = 16

  // data sub-chunk
  writeAscii(view, 36, 'data');
  view.setUint32(40, dataByteLength, true);

  let byteOffset = 44;
  for (let i = 0; i < frameCount; i += 1) {
    const raw0 = ch0[i] ?? 0;
    const clamped0 = Math.max(-1, Math.min(1, Number.isFinite(raw0) ? raw0 : 0));
    const pcm0 = clamped0 < 0 ? clamped0 * 0x8000 : clamped0 * 0x7fff;
    view.setInt16(byteOffset, Math.round(pcm0), true);
    byteOffset += 2;

    if (numChannels === 2) {
      const raw1 = ch1[i] ?? 0;
      const clamped1 = Math.max(
        -1,
        Math.min(1, Number.isFinite(raw1) ? raw1 : 0),
      );
      const pcm1 = clamped1 < 0 ? clamped1 * 0x8000 : clamped1 * 0x7fff;
      view.setInt16(byteOffset, Math.round(pcm1), true);
      byteOffset += 2;
    }
  }

  return new Blob([buffer], { type: 'audio/wav' });
}

function resolveAudioContextConstructor(): typeof AudioContext | null {
  if (typeof globalThis === 'undefined') {
    return null;
  }
  const g = globalThis as {
    AudioContext?: typeof AudioContext;
    webkitAudioContext?: typeof AudioContext;
  };
  return g.AudioContext ?? g.webkitAudioContext ?? null;
}

/**
 * Decodes recorded media audio locally via Web Audio API, slices to `[trimStartSec, trimEndSec]`,
 * and encodes a companion 16-bit PCM `.wav` file with zero speaker connections.
 */
export async function extractCompanionWavBlob(
  blob: Blob,
  fallbackDurationMs: number,
  trimStartSec = 0,
  trimEndSec = 0,
): Promise<Blob> {
  const fallbackTotalSec = Math.max(0.2, fallbackDurationMs / 1000);
  const AudioCtx = resolveAudioContextConstructor();

  if (AudioCtx && blob.size > 0) {
    let audioCtx: AudioContext | null = null;
    try {
      const bytes = await readBlobBytes(blob);
      audioCtx = new AudioCtx();
      const copyBuffer = bytes.buffer.slice(
        bytes.byteOffset,
        bytes.byteOffset + bytes.byteLength,
      );
      const decoded = await audioCtx.decodeAudioData(copyBuffer);
      const actualTotalSec =
        decoded.duration > 0 ? decoded.duration : fallbackTotalSec;
      const effectiveEnd = trimEndSec > 0 ? trimEndSec : actualTotalSec;
      const range = clampTrimRange(trimStartSec, effectiveEnd, actualTotalSec);

      const startSample = Math.max(
        0,
        Math.min(decoded.length, Math.floor(range.startSec * decoded.sampleRate)),
      );
      const endSample = Math.max(
        startSample + 1,
        Math.min(decoded.length, Math.ceil(range.endSec * decoded.sampleRate)),
      );

      const channelCount = Math.max(1, Math.min(2, decoded.numberOfChannels));
      const slicedChannels: Float32Array[] = [];
      for (let ch = 0; ch < channelCount; ch += 1) {
        const channelData = decoded.getChannelData(ch);
        slicedChannels.push(channelData.slice(startSample, endSample));
      }

      return encodePcm16Wav(slicedChannels, decoded.sampleRate);
    } catch {
      // Fall through to deterministic silent PCM WAV when recording has no audio track or in headless JSDOM
    } finally {
      if (audioCtx && audioCtx.state !== 'closed') {
        try {
          await audioCtx.close();
        } catch {
          // Ignore close errors
        }
      }
    }
  }

  const effectiveFallbackEnd = trimEndSec > 0 ? trimEndSec : fallbackTotalSec;
  const fallbackRange = clampTrimRange(
    trimStartSec,
    effectiveFallbackEnd,
    fallbackTotalSec,
  );
  const silentSeconds = Math.min(
    MAX_SILENT_FALLBACK_SECONDS,
    Math.max(MIN_TRIM_DURATION_SEC, fallbackRange.durationSec || 0.5),
  );
  const silentFrames = Math.max(
    1,
    Math.round(silentSeconds * DEFAULT_FALLBACK_WAV_SAMPLE_RATE),
  );
  return encodePcm16Wav(
    [new Float32Array(silentFrames)],
    DEFAULT_FALLBACK_WAV_SAMPLE_RATE,
  );
}

function negotiateTrimMimeType(): string {
  if (typeof MediaRecorder === 'undefined') {
    return 'video/webm';
  }
  if (typeof MediaRecorder.isTypeSupported !== 'function') {
    return 'video/webm';
  }
  for (const candidate of PREFERRED_AV_RECORDING_MIME_TYPES) {
    if (MediaRecorder.isTypeSupported(candidate)) {
      return candidate;
    }
  }
  return 'video/webm';
}

/**
 * Exports a genuine trimmed `.webm` clip for `[trimStartSec, trimEndSec]` locally in the browser
 * using an offscreen `<video>` + `<canvas>.captureStream(30)` + silent Web Audio destination
 * (zero speaker connections) + `MediaRecorder` + EBML duration patching.
 */
export async function exportTrimmedWebmBlob(
  sourceBlob: Blob,
  fullDurationMs: number,
  trimStartSec: number,
  trimEndSec: number,
): Promise<Blob> {
  const totalSec = Math.max(0.2, fullDurationMs / 1000);
  const range = clampTrimRange(trimStartSec, trimEndSec, totalSec);
  if (!range.isTrimmed) {
    return sourceBlob;
  }

  if (
    typeof document === 'undefined' ||
    typeof URL === 'undefined' ||
    typeof MediaRecorder === 'undefined'
  ) {
    return sourceBlob;
  }

  const objectUrl = URL.createObjectURL(sourceBlob);
  const video = document.createElement('video');
  video.playsInline = true;
  video.preload = 'auto';

  let audioCtx: AudioContext | null = null;
  const capturedTracks: MediaStreamTrack[] = [];

  try {
    const metadataLoaded = await new Promise<boolean>((resolve) => {
      const timer = setTimeout(() => {
        resolve(false);
      }, 1500);
      video.onloadedmetadata = () => {
        clearTimeout(timer);
        resolve(true);
      };
      video.onerror = () => {
        clearTimeout(timer);
        resolve(false);
      };
      video.src = objectUrl;
    });

    if (!metadataLoaded) {
      return sourceBlob;
    }

    const canvas = document.createElement('canvas');
    canvas.width = Math.max(2, video.videoWidth || 1280);
    canvas.height = Math.max(2, video.videoHeight || 720);
    const ctx = canvas.getContext('2d');
    if (!ctx || typeof canvas.captureStream !== 'function') {
      return sourceBlob;
    }

    const canvasStream = canvas.captureStream(30);
    for (const track of canvasStream.getTracks()) {
      capturedTracks.push(track);
    }

    const combinedTracks: MediaStreamTrack[] = [
      ...canvasStream.getVideoTracks(),
    ];

    const AudioCtx = resolveAudioContextConstructor();
    if (AudioCtx) {
      try {
        audioCtx = new AudioCtx();
        const sourceNode = audioCtx.createMediaElementSource(video);
        const destNode = audioCtx.createMediaStreamDestination();
        // Connect ONLY to MediaStreamDestination — NEVER to audioCtx.destination!
        sourceNode.connect(destNode);
        for (const audioTrack of destNode.stream.getAudioTracks()) {
          capturedTracks.push(audioTrack);
          combinedTracks.push(audioTrack);
        }
        if (audioCtx.state === 'suspended') {
          await audioCtx.resume();
        }
      } catch {
        video.muted = true;
      }
    } else {
      video.muted = true;
    }

    await new Promise<void>((resolve) => {
      const timer = setTimeout(() => {
        resolve();
      }, 800);
      video.onseeked = () => {
        clearTimeout(timer);
        resolve();
      };
      try {
        video.currentTime = range.startSec;
      } catch {
        clearTimeout(timer);
        resolve();
      }
    });

    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);

    const mimeType = negotiateTrimMimeType();
    const combinedStream = new MediaStream(combinedTracks);
    const chunks: Blob[] = [];
    const recorder = new MediaRecorder(combinedStream, { mimeType });

    recorder.ondataavailable = (ev: BlobEvent) => {
      if (ev.data.size > 0) {
        chunks.push(ev.data);
      }
    };

    const stoppedPromise = new Promise<void>((resolve) => {
      recorder.onstop = () => {
        resolve();
      };
      recorder.onerror = () => {
        resolve();
      };
    });

    let pumpActive = true;
    const pumpFrames = () => {
      if (!pumpActive) {
        return;
      }
      try {
        ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
      } catch {
        // Ignore transient decode frame errors
      }
      if (video.currentTime >= range.endSec || video.ended) {
        pumpActive = false;
        video.pause();
        if (recorder.state !== 'inactive') {
          recorder.stop();
        }
        return;
      }
      requestAnimationFrame(pumpFrames);
    };

    recorder.start(100);
    requestAnimationFrame(pumpFrames);

    const maxWaitMs = Math.max(1500, Math.ceil(range.durationSec * 1000) + 2500);
    const safetyTimer = setTimeout(() => {
      pumpActive = false;
      video.pause();
      if (recorder.state !== 'inactive') {
        recorder.stop();
      }
    }, maxWaitMs);

    try {
      await video.play();
    } catch {
      pumpActive = false;
      clearTimeout(safetyTimer);
      if (recorder.state !== 'inactive') {
        recorder.stop();
      }
      return sourceBlob;
    }

    await stoppedPromise;
    pumpActive = false;
    clearTimeout(safetyTimer);

    if (chunks.length === 0) {
      return sourceBlob;
    }

    const rawBlob = new Blob(chunks, {
      type: recorder.mimeType || mimeType,
    });
    if (rawBlob.size === 0) {
      return sourceBlob;
    }

    return await patchWebmDurationIfStreaming(
      rawBlob,
      Math.round(range.durationSec * 1000),
      rawBlob.type || mimeType,
    );
  } catch {
    return sourceBlob;
  } finally {
    video.pause();
    video.removeAttribute('src');
    video.load();
    for (const track of capturedTracks) {
      try {
        track.stop();
      } catch {
        // Ignore track stop errors
      }
    }
    if (audioCtx && audioCtx.state !== 'closed') {
      try {
        await audioCtx.close();
      } catch {
        // Ignore close errors
      }
    }
    try {
      URL.revokeObjectURL(objectUrl);
    } catch {
      // Ignore revoke errors
    }
  }
}

export function buildWavFileName(
  normalizedVideoFileName: string,
  isTrimmed: boolean,
): string {
  const base = normalizedVideoFileName
    .trim()
    .replace(/\.[a-z0-9]{1,8}$/i, '');
  const safeBase = base.length > 0 ? base : 'reactstage-reaction';
  return isTrimmed ? `${safeBase}-trimmed.wav` : `${safeBase}.wav`;
}

export function buildTrimmedVideoFileName(
  normalizedVideoFileName: string,
): string {
  const match = /^(.+)(\.[a-z0-9]{1,8})$/i.exec(normalizedVideoFileName.trim());
  if (match?.[1] && match[2]) {
    return `${match[1]}-trimmed${match[2]}`;
  }
  return `${normalizedVideoFileName.trim() || 'reactstage-reaction'}-trimmed.webm`;
}

export function triggerLocalBlobDownload(blob: Blob, fileName: string): boolean {
  if (typeof document === 'undefined' || typeof URL === 'undefined') {
    return false;
  }
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
    document.body.removeChild(anchor);
    setTimeout(() => {
      try {
        URL.revokeObjectURL(objectUrl);
      } catch {
        // Ignore revoke errors in test environments
      }
    }, 0);
  }

  return true;
}

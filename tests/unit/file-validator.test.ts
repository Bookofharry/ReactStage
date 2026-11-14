import { describe, expect, it } from 'vitest';
import { validateSourceVideoFile } from '../../src/services/source-player/file-validator';

describe('validateSourceVideoFile', () => {
  it('accepts supported MP4, WebM, and Ogg video files', () => {
    const mp4 = new File(['video-bytes'], 'demo.mp4', { type: 'video/mp4' });
    const webm = new File(['video-bytes'], 'clip.webm', { type: 'video/webm' });
    const ogg = new File(['video-bytes'], 'lecture.ogv', { type: 'video/ogg' });

    expect(validateSourceVideoFile(mp4)).toEqual({
      valid: true,
      normalizedMimeType: 'video/mp4',
      supportLevel: 'probably',
    });
    expect(validateSourceVideoFile(webm)).toEqual({
      valid: true,
      normalizedMimeType: 'video/webm',
      supportLevel: 'probably',
    });
    expect(validateSourceVideoFile(ogg)).toEqual({
      valid: true,
      normalizedMimeType: 'video/ogg',
      supportLevel: 'maybe',
    });
  });

  it('infers MIME type from known extension when file.type is empty', () => {
    const untypedMp4 = new File(['video-bytes'], 'camera-roll.MP4', {
      type: '',
    });
    const result = validateSourceVideoFile(untypedMp4);
    expect(result).toEqual({
      valid: true,
      normalizedMimeType: 'video/mp4',
      supportLevel: 'probably',
    });
  });

  it('rejects empty 0-byte files with EMPTY_FILE', () => {
    const empty = new File([], 'empty.mp4', { type: 'video/mp4' });
    const result = validateSourceVideoFile(empty);

    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.error.code).toBe('EMPTY_FILE');
      expect(result.error.fileName).toBe('empty.mp4');
    }
  });

  it('rejects non-video MIME types and unknown file extensions', () => {
    const textFile = new File(['hello'], 'script.txt', { type: 'text/plain' });
    const imageFile = new File(['png-data'], 'thumb.png', { type: 'image/png' });
    const unknownBinary = new File(['raw'], 'archive.bin', {
      type: 'application/octet-stream',
    });

    for (const candidate of [textFile, imageFile, unknownBinary]) {
      const result = validateSourceVideoFile(candidate);
      expect(result.valid).toBe(false);
      if (!result.valid) {
        expect(result.error.code).toBe('UNSUPPORTED_FILE_TYPE');
      }
    }
  });

  it('rejects video MIME types that the browser reports it cannot play', () => {
    const aviFile = new File(['avi-bytes'], 'legacy.avi', {
      type: 'video/x-msvideo',
    });
    const result = validateSourceVideoFile(aviFile, () => '');

    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.error.code).toBe('BROWSER_CODEC_UNSUPPORTED');
    }
  });
});

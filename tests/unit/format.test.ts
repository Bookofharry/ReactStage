import { describe, expect, it } from 'vitest';
import {
  formatBytes,
  formatSpokenDuration,
  formatTimecode,
} from '../../src/utils/format';

describe('format utilities', () => {
  it('formats standard, sub-second, multi-hour, and invalid timecodes cleanly', () => {
    expect(formatTimecode(0)).toBe('00:00');
    expect(formatTimecode(0, true)).toBe('00:00.0');
    expect(formatTimecode(65.4, true)).toBe('01:05.4');
    expect(formatTimecode(3725.8, true)).toBe('01:02:05.8');
    expect(formatTimecode(Number.NaN, true)).toBe('00:00.0');
    expect(formatTimecode(-5, false)).toBe('00:00');
  });

  it('formats spoken ARIA durations for screen readers', () => {
    expect(formatSpokenDuration(0)).toBe('0 seconds');
    expect(formatSpokenDuration(1)).toBe('1 second');
    expect(formatSpokenDuration(62)).toBe('1 minute 2 seconds');
    expect(formatSpokenDuration(3661)).toBe('1 hour 1 minute 1 second');
  });

  it('formats file byte sizes across B, KB, MB, and GB', () => {
    expect(formatBytes(0)).toBe('0 B');
    expect(formatBytes(512)).toBe('512 B');
    expect(formatBytes(2048)).toBe('2.0 KB');
    expect(formatBytes(5 * 1024 * 1024)).toBe('5.0 MB');
  });
});

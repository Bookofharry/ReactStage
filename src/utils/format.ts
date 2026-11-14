/**
 * Formats a duration in seconds into a tabular timecode string (MM:SS or HH:MM:SS).
 * Optionally appends tenths of a second (.d) for sub-second scrubbing precision.
 */
export function formatTimecode(seconds: number, includeTenths = false): string {
  if (!Number.isFinite(seconds) || seconds < 0) {
    return includeTenths ? '00:00.0' : '00:00';
  }

  const clamped = Math.max(0, seconds);
  const totalTenths = Math.floor(clamped * 10 + 1e-6);
  const tenths = totalTenths % 10;
  const wholeSeconds = includeTenths
    ? Math.floor(totalTenths / 10)
    : Math.floor(clamped);

  const hrs = Math.floor(wholeSeconds / 3600);
  const mins = Math.floor((wholeSeconds % 3600) / 60);
  const secs = wholeSeconds % 60;

  const base =
    hrs > 0
      ? `${String(hrs).padStart(2, '0')}:${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`
      : `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;

  return includeTenths ? `${base}.${tenths}` : base;
}

/**
 * Formats seconds into human-friendly spoken duration text for ARIA screen readers.
 */
export function formatSpokenDuration(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds <= 0) {
    return '0 seconds';
  }

  const whole = Math.floor(seconds);
  const hrs = Math.floor(whole / 3600);
  const mins = Math.floor((whole % 3600) / 60);
  const secs = whole % 60;

  const parts: string[] = [];
  if (hrs > 0) {
    parts.push(`${hrs} ${hrs === 1 ? 'hour' : 'hours'}`);
  }
  if (mins > 0) {
    parts.push(`${mins} ${mins === 1 ? 'minute' : 'minutes'}`);
  }
  if (secs > 0 || parts.length === 0) {
    parts.push(`${secs} ${secs === 1 ? 'second' : 'seconds'}`);
  }
  return parts.join(' ');
}

/**
 * Formats file byte size into concise human-readable units.
 */
export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) {
    return '0 B';
  }

  const units = ['B', 'KB', 'MB', 'GB'] as const;
  let value = bytes;
  let unitIndex = 0;

  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex += 1;
  }

  const unit = units[unitIndex] ?? 'B';
  return unitIndex === 0 ? `${Math.round(value)} ${unit}` : `${value.toFixed(1)} ${unit}`;
}

export const MS_TO_KMH = 3.6;
export const DEG = Math.PI / 180;

export function toKmh(metersPerSecond: number): number {
  return metersPerSecond * MS_TO_KMH;
}

function pad(n: number, width: number): string {
  const s = String(n);
  return s.length >= width ? s : '0'.repeat(width - s.length) + s;
}

/** Lap time as m:ss.mmm; anything that is not a finite non-negative time (no time yet) reads as dashes. */
export function formatTime(seconds: number): string {
  if (!(seconds >= 0) || !Number.isFinite(seconds)) return '-:--.---';
  const total = Math.round(seconds * 1000);
  return `${Math.floor(total / 60000)}:${pad(Math.floor(total / 1000) % 60, 2)}.${pad(total % 1000, 3)}`;
}

/** Running lap clock as m:ss.cc, coarse enough to read while it counts. */
export function formatTimeCentis(seconds: number): string {
  if (!(seconds >= 0) || !Number.isFinite(seconds)) return '-:--.--';
  const total = Math.round(seconds * 100);
  return `${Math.floor(total / 6000)}:${pad(Math.floor(total / 100) % 60, 2)}.${pad(total % 100, 2)}`;
}

/** Flight timer as m:ss (whole seconds, like the Betaflight OSD). */
export function formatClock(seconds: number): string {
  const s = seconds >= 0 && Number.isFinite(seconds) ? Math.floor(seconds) : 0;
  return `${Math.floor(s / 60)}:${pad(s % 60, 2)}`;
}

/** Signed gap to the best split: "+0.123" when slower, "-0.123" when faster, empty when there is nothing to compare. */
export function formatSplit(delta: number): string {
  if (!Number.isFinite(delta)) return '';
  const ms = Math.round(Math.abs(delta) * 1000);
  return `${delta < 0 && ms > 0 ? '-' : '+'}${Math.floor(ms / 1000)}.${pad(ms % 1000, 3)}`;
}

export function formatDistance(meters: number): string {
  if (!Number.isFinite(meters)) return '-';
  const a = Math.abs(meters);
  return a >= 1000 ? `${(meters / 1000).toFixed(2)} km` : `${Math.round(meters)} m`;
}

/** Hours (0..24) as HH:MM. */
export function formatHours(hours: number): string {
  const minutes = Math.round((((hours % 24) + 24) % 24) * 60) % 1440;
  return `${pad(Math.floor(minutes / 60), 2)}:${pad(minutes % 60, 2)}`;
}

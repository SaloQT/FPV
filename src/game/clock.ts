const HOUR_MS = 3600000;
const DAY_MS = 24 * HOUR_MS;
/** Time-of-day keys step this many minutes. */
export const TIME_STEP_MINUTES = 15;

/** The simulated wall clock: real time scaled by `timeScale` (0 freezes it), in ms since the Unix epoch (UTC). */
export class SimClock {
  constructor(
    public timeMs: number,
    public timeScale = 1,
  ) {}

  set(timeMs: number, timeScale: number): void {
    this.timeMs = timeMs;
    this.timeScale = timeScale;
  }

  advance(realDt: number): void {
    this.timeMs += realDt * 1000 * this.timeScale;
  }

  nudge(minutes: number): void {
    this.timeMs += minutes * 60000;
  }
}

function offsetMs(longitudeDeg: number): number {
  return (longitudeDeg / 15) * HOUR_MS;
}

/** Mean local solar time in hours [0, 24) at a longitude (the equation of time is ignored). */
export function localSolarHours(timeMs: number, longitudeDeg: number): number {
  const local = timeMs + offsetMs(longitudeDeg);
  return (((local % DAY_MS) + DAY_MS) % DAY_MS) / HOUR_MS;
}

/** The same local solar day as `timeMs`, moved to `hours` (0..24) o'clock. */
export function withLocalSolarHours(timeMs: number, longitudeDeg: number, hours: number): number {
  const off = offsetMs(longitudeDeg);
  const dayStart = Math.floor((timeMs + off) / DAY_MS) * DAY_MS;
  return dayStart + Math.min(Math.max(hours, 0), 24) * HOUR_MS - off;
}

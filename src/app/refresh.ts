/**
 * Display refresh measurement. A browser frame loop runs at the display's refresh rate (requestAnimationFrame cannot run faster and
 * v-sync cannot be turned off for a canvas), so the refresh rate is the frame-rate ceiling and the natural default target for the
 * dynamic-resolution controller. It is measured once at startup from rAF timestamps while nothing else is running.
 */

/** Rates the measurement snaps to when it lands within SNAP_TOLERANCE of one. */
export const COMMON_REFRESH_HZ: readonly number[] = [50, 60, 75, 90, 100, 120, 144, 165, 180, 240, 360];
const SNAP_TOLERANCE = 0.035;
export const FALLBACK_REFRESH_HZ = 60;

const MEASURE_FRAMES = 60;
const SETTLE_INTERVALS = 4;
const MIN_INTERVALS = 20;
const TIMEOUT_MS = 3000;

export interface RefreshMeasurement {
  /** The rate to use: snapped to a common rate when the raw one is close to it. */
  hz: number;
  /** Median interval converted to Hz, unsnapped; 0 when nothing could be measured. */
  rawHz: number;
  intervals: number;
  source: 'measured' | 'fallback';
}

export function snapRefreshHz(rawHz: number): number {
  let best = rawHz;
  let bestErr = Infinity;
  for (const c of COMMON_REFRESH_HZ) {
    const err = Math.abs(rawHz - c) / c;
    if (err < bestErr) {
      bestErr = err;
      best = c;
    }
  }
  return bestErr <= SNAP_TOLERANCE ? best : Math.round(rawHz);
}

/**
 * Median interval of the on-time frames. Missed refreshes and hitches only ever make an interval longer, so the intervals more than
 * 35% above the lower quartile are dropped before the median is taken. Returns 0 when fewer than MIN_INTERVALS usable intervals remain.
 */
export function estimateRefreshHz(intervalsMs: readonly number[]): number {
  const valid = intervalsMs.filter((v) => v > 0.5 && v < 250);
  if (valid.length < MIN_INTERVALS) return 0;
  const sorted = [...valid].sort((a, b) => a - b);
  const q1 = sorted[Math.floor(sorted.length / 4)];
  const kept = sorted.filter((v) => v <= q1 * 1.35);
  const median = kept[kept.length >> 1];
  return 1000 / median;
}

export function summariseRefresh(intervalsMs: readonly number[]): RefreshMeasurement {
  const raw = estimateRefreshHz(intervalsMs);
  if (raw <= 0) return { hz: FALLBACK_REFRESH_HZ, rawHz: 0, intervals: intervalsMs.length, source: 'fallback' };
  return { hz: snapRefreshHz(raw), rawHz: raw, intervals: intervalsMs.length, source: 'measured' };
}

/** Collects rAF timestamps; the first intervals are skipped because the compositor is still settling. */
export class RefreshMeter {
  private readonly intervals: number[] = [];
  private prev = -1;
  private seen = 0;

  push(timestampMs: number): void {
    if (this.prev >= 0 && ++this.seen > SETTLE_INTERVALS) this.intervals.push(timestampMs - this.prev);
    this.prev = timestampMs;
  }

  get done(): boolean {
    return this.intervals.length >= MEASURE_FRAMES;
  }

  result(): RefreshMeasurement {
    return summariseRefresh(this.intervals);
  }
}

export interface MeasureHost {
  raf(cb: (t: number) => void): number;
  cancel(id: number): void;
  hidden(): boolean;
  now(): number;
}

const browserHost: MeasureHost = {
  raf: (cb) => requestAnimationFrame(cb),
  cancel: (id) => cancelAnimationFrame(id),
  hidden: () => document.hidden,
  now: () => performance.now(),
};

/**
 * Runs ~60 idle frames and resolves with the measured refresh; a hidden tab or a timeout falls back to 60 Hz. A hidden tab gets no
 * animation frames at all, so a plain timer ends the wait too.
 */
export function measureRefresh(host: MeasureHost = browserHost): Promise<RefreshMeasurement> {
  return new Promise((resolve) => {
    const meter = new RefreshMeter();
    const started = host.now();
    let id = 0;
    let finished = false;
    const finish = (): void => {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      host.cancel(id);
      resolve(meter.result());
    };
    const timer = setTimeout(finish, TIMEOUT_MS + 500);
    const tick = (t: number): void => {
      if (finished) return;
      if (host.hidden()) return finish();
      meter.push(t);
      if (meter.done || host.now() - started > TIMEOUT_MS) return finish();
      id = host.raf(tick);
    };
    id = host.raf(tick);
  });
}

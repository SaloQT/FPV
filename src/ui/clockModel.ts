import { localSolarHours, withLocalSolarHours } from '../game/clock';
import { DEG, formatHours } from '../game/units';

/** Fixed: time stands still at the chosen hour. Real time: the wall clock. Day cycle: the clock runs `cycleScale` times faster. */
export type TimeMode = 'fixed' | 'real' | 'cycle';
export const TIME_MODES: readonly TimeMode[] = ['fixed', 'real', 'cycle'];
export const TIME_MODE_LABELS: Readonly<Record<TimeMode, string>> = { fixed: 'Fixed time', real: 'Real time', cycle: 'Day cycle' };

/** Speeds of the day-cycle slider: 1x is the real passage of time, 1000x turns a day into 86 seconds. */
export const CYCLE_SCALES: readonly number[] = [1, 2, 5, 10, 20, 50, 100, 200, 500, 1000];
export const DEFAULT_CYCLE_SCALE = 1;

export interface TimeChoice {
  timeMode: TimeMode;
  cycleScale: number;
  /** Local solar hour (0..24) a fixed time starts from at the next launch. */
  fixedHour: number;
}

export interface TimePatch {
  timeMs: number;
  timeScale: number;
}

export function nearestCycleIndex(scale: number): number {
  let best = 0;
  for (let i = 1; i < CYCLE_SCALES.length; i++) {
    if (Math.abs(Math.log(CYCLE_SCALES[i] / scale)) < Math.abs(Math.log(CYCLE_SCALES[best] / scale))) best = i;
  }
  return best;
}

export function cycleScaleAt(index: number): number {
  return CYCLE_SCALES[Math.min(Math.max(Math.round(index), 0), CYCLE_SCALES.length - 1)];
}

const DAY_S = 86400;

/** How long one simulated day lasts at `scale`: "24 h", "2.4 h", "14 min", "86 s". */
export function dayLength(scale: number): string {
  if (!(scale > 0)) return 'never';
  const s = DAY_S / scale;
  if (s >= 86400) return '24 h';
  if (s >= 3600) return `${(s / 3600).toFixed(1)} h`;
  if (s >= 120) return `${Math.round(s / 60)} min`;
  return `${Math.round(s)} s`;
}

export function describeScale(scale: number): string {
  return scale <= 1 ? '1x  ·  real speed' : `${scale}x  ·  a day in ${dayLength(scale)}`;
}

/** What each mode does to the settings. `liveMs` is the clock now (the store's `timeMs` goes stale while the sim runs). */
export function timePatch(choice: TimeChoice, liveMs: number, nowMs: number): TimePatch {
  switch (choice.timeMode) {
    case 'fixed': return { timeMs: liveMs, timeScale: 0 };
    case 'real': return { timeMs: nowMs, timeScale: 1 };
    case 'cycle': return { timeMs: liveMs, timeScale: choice.cycleScale };
  }
}

/** The time a saved choice starts a new session with. `defaultMs` is the settings' default clock (its date is kept). */
export function bootTime(choice: TimeChoice, defaultMs: number, longitudeDeg: number, nowMs: number): TimePatch {
  switch (choice.timeMode) {
    case 'fixed': return { timeMs: withLocalSolarHours(defaultMs, longitudeDeg, choice.fixedHour), timeScale: 0 };
    case 'real': return { timeMs: nowMs, timeScale: 1 };
    case 'cycle': return { timeMs: defaultMs, timeScale: choice.cycleScale };
  }
}

export type SkyPhase = 'day' | 'golden hour' | 'civil twilight' | 'nautical twilight' | 'astronomical twilight' | 'night';

/** Sun-elevation bands: the horizon at -0.833 degrees (refraction and the solar radius), then 6, 12 and 18 degrees of twilight. */
export function skyPhase(sunElevationRad: number): SkyPhase {
  const e = sunElevationRad / DEG;
  if (e >= 6) return 'day';
  if (e >= -0.833) return 'golden hour';
  if (e >= -6) return 'civil twilight';
  if (e >= -12) return 'nautical twilight';
  if (e >= -18) return 'astronomical twilight';
  return 'night';
}

export interface SkyBodies {
  sunElevation: number;
  moonElevation: number;
  moonIlluminatedFraction: number;
}

export interface SkyReadout {
  time: string;
  phase: SkyPhase;
  /** "sun 48°" or "moon 31°, 62% lit" or "moon below the horizon". */
  body: string;
  /** "14:32  sun 48°", with the twilight name when it is not plain day or night. */
  text: string;
}

function degrees(rad: number): string {
  const d = Math.round(rad / DEG);
  return `${d < 0 ? '-' : ''}${Math.abs(d)}°`;
}

export function skyReadout(hours: number, sky: SkyBodies): SkyReadout {
  const phase = skyPhase(sky.sunElevation);
  const time = formatHours(hours);
  const sunUp = sky.sunElevation >= -6 * DEG;
  let body: string;
  if (sunUp) body = `sun ${degrees(sky.sunElevation)}`;
  else if (sky.moonElevation > 0) body = `moon ${degrees(sky.moonElevation)}, ${Math.round(sky.moonIlluminatedFraction * 100)}% lit`;
  else body = 'moon below the horizon';
  const label = phase === 'day' ? '' : phase === 'night' ? '' : `  ·  ${phase}`;
  return { time, phase, body, text: `${time}  ${body}${label}` };
}

/** Local solar hour for a timestamp at a longitude: what the readout and the hour slider show. */
export function hourOf(timeMs: number, longitudeDeg: number): number {
  return localSolarHours(timeMs, longitudeDeg);
}

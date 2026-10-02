/**
 * Query-string parameters of the app (test hooks and quick overrides). Pure: no DOM, no GPU.
 *
 *   seed=<int>            world seed (terrain and track)
 *   tseed=<int>           the track's own seed when it is not the world seed (share links to an N-key track)
 *   style=race|freestyle|mountain|sprint
 *   t=<hour>              local solar hour at the observer, 0..24 (converted to settings.timeMs)
 *   cam=fpv|chase|free    camera mode once flying
 *   scenario=hover|fly|crash|gate   scripted autopilot (synthetic stick input)
 *   autostart=1           skip the start menu
 *   quality=low|medium|high|ultra
 *   scale=<0.25..1>       render scale        dyn=0|1  dynamic resolution
 *   gates=<n> laps=<n>    track size          wind=<m/s> winddir=<deg from>
 *   diff=<0..100>         track difficulty in percent (the share links carry it)
 *   countdown=0|1         race-start countdown: off for `autostart` runs unless asked for with 1
 *   advance=<frames>      run this many deterministic frames before `ready` (default: see SCENARIO_ADVANCE)
 *   agl=<m>               altitude above ground the hover scenario holds (default 1.5; 0.3 skims the grass)
 *   fixeddt=<s>           fixed frame dt for the deterministic runs (default 1/60)
 *   hold=1                after `ready`, do not run the real-time loop (frozen frame; use `advance` in the page)
 */
import type { RenderQuality, TrackData } from '../contracts';
import { withLocalSolarHours } from '../game/clock';
import type { CameraMode } from '../game/cameraRig';
import type { AppSettings } from '../ui/settingsSchema';

export type ScenarioName = 'hover' | 'fly' | 'crash' | 'gate';
export const SCENARIOS: readonly ScenarioName[] = ['hover', 'fly', 'crash', 'gate'];
const STYLES: readonly TrackData['style'][] = ['race', 'freestyle', 'mountain', 'sprint'];
const CAMS: readonly CameraMode[] = ['fpv', 'chase', 'free'];
const QUALITIES: readonly RenderQuality[] = ['low', 'medium', 'high', 'ultra'];

export interface AppParams {
  seed?: number;
  /** Seed the track is generated from, on the terrain of `seed`. */
  trackSeed?: number;
  style?: TrackData['style'];
  /** Local solar hour at the observer. */
  hours?: number;
  cam?: CameraMode;
  scenario?: ScenarioName;
  autostart: boolean;
  quality?: RenderQuality;
  scale?: number;
  dyn?: boolean;
  gates?: number;
  laps?: number;
  /** Track difficulty 0..1. */
  difficulty?: number;
  /** Race-start countdown forced on or off; undefined follows the pilot's option (off for autostart runs). */
  countdown?: boolean;
  wind?: number;
  windDir?: number;
  /** Frames to run deterministically (fixed dt) before the app reports ready. */
  advance: number;
  fixedDt: number;
  /** Altitude the hover scenario holds, metres above the ground (undefined: the scenario default). */
  agl?: number;
  /** Do not start the real-time loop after `ready`: the frame stays frozen (deterministic screenshots). */
  hold: boolean;
}

function num(q: URLSearchParams, key: string): number | undefined {
  const raw = q.get(key);
  if (raw === null || raw.trim() === '') return undefined;
  const v = Number(raw);
  return Number.isFinite(v) ? v : undefined;
}

function pick<T extends string>(q: URLSearchParams, key: string, allowed: readonly T[]): T | undefined {
  const raw = q.get(key);
  return raw !== null && (allowed as readonly string[]).includes(raw) ? (raw as T) : undefined;
}

/**
 * Frames run before `ready` when `advance` is not given: an autostarted scenario is shown in flight instead of on the pad
 * (the hover pilot needs about 4 s to arm and climb). Simulation-only frames are cheap; see `advanceFrames`.
 */
export const SCENARIO_ADVANCE: Readonly<Record<ScenarioName, number>> = { hover: 300, fly: 360, gate: 0, crash: 0 };

function defaultAdvance(scenario: ScenarioName | undefined, autostart: boolean): number {
  return scenario !== undefined && autostart ? SCENARIO_ADVANCE[scenario] : 0;
}

export function parseParams(search: string): AppParams {
  const q = new URLSearchParams(search);
  const flag = (key: string): boolean | undefined => {
    const v = q.get(key);
    return v === null ? undefined : v !== '0' && v !== 'false';
  };
  const seed = num(q, 'seed');
  const trackSeed = num(q, 'tseed');
  const advance = num(q, 'advance');
  const scenario = pick(q, 'scenario', SCENARIOS);
  const autostart = flag('autostart') ?? false;
  const gates = num(q, 'gates');
  const laps = num(q, 'laps');
  const diff = num(q, 'diff');
  const scale = num(q, 'scale');
  const fixedDt = num(q, 'fixeddt');
  const agl = num(q, 'agl');
  return {
    seed: seed === undefined ? undefined : Math.max(0, Math.floor(seed)) >>> 0,
    trackSeed: trackSeed === undefined ? undefined : Math.max(0, Math.floor(trackSeed)) >>> 0,
    style: pick(q, 'style', STYLES),
    hours: num(q, 't'),
    cam: pick(q, 'cam', CAMS),
    scenario,
    autostart,
    quality: pick(q, 'quality', QUALITIES),
    scale: scale === undefined ? undefined : Math.min(1, Math.max(0.25, scale)),
    dyn: flag('dyn'),
    gates: gates === undefined ? undefined : Math.max(1, Math.round(gates)),
    laps: laps === undefined ? undefined : Math.max(1, Math.round(laps)),
    difficulty: diff === undefined ? undefined : Math.min(1, Math.max(0, diff / 100)),
    countdown: flag('countdown'),
    wind: num(q, 'wind'),
    windDir: num(q, 'winddir'),
    advance: Math.max(0, Math.floor(advance ?? defaultAdvance(scenario, autostart))),
    agl: agl === undefined ? undefined : Math.min(50, Math.max(0.3, agl)),
    fixedDt: fixedDt !== undefined && fixedDt > 0 && fixedDt <= 0.1 ? fixedDt : 1 / 60,
    hold: flag('hold') ?? false,
  };
}

/** `t=<local solar hour>` as the simulated UTC time on the same local solar day as `timeMs`. */
export function hoursToTimeMs(timeMs: number, longitudeDeg: number, hours: number): number {
  return withLocalSolarHours(timeMs, longitudeDeg, hours);
}

/** The settings patch a parameter set implies. Empty when the query has no overrides. */
export function settingsPatch(p: AppParams, base: Pick<AppSettings, 'timeMs' | 'observer'>): Partial<AppSettings> {
  const out: Partial<AppSettings> = {};
  if (p.seed !== undefined) out.seed = p.seed;
  if (p.style !== undefined) out.trackStyle = p.style;
  if (p.quality !== undefined) out.quality = p.quality;
  if (p.scale !== undefined) out.renderScale = p.scale;
  if (p.dyn !== undefined) out.dynamicResolution = p.dyn;
  if (p.gates !== undefined) out.gateCount = p.gates;
  if (p.laps !== undefined) out.laps = p.laps;
  if (p.difficulty !== undefined) out.difficulty = p.difficulty;
  if (p.wind !== undefined) out.windSpeed = Math.max(0, p.wind);
  if (p.windDir !== undefined) out.windDirDeg = ((p.windDir % 360) + 360) % 360;
  if (p.hours !== undefined) out.timeMs = hoursToTimeMs(base.timeMs, base.observer.longitudeDeg, p.hours);
  return out;
}

/** Overrides other than the time of day: the store then stays in memory so a test URL never rewrites saved settings. */
export function hasPersistentOverrides(patch: Partial<AppSettings>): boolean {
  return Object.keys(patch).some((k) => k !== 'timeMs');
}

/**
 * Query parameters about performance (kept apart from params.ts, which belongs to the scenario hooks). Pure.
 *
 *   gpuProfile=1       opt-in diagnostic GPU breakdown (may split RT compute passes)
 *   bench=1            scripted fly-through at fixed settings, then results in `window.__fpv.bench` and a panel
 *   benchSeconds=<s>   measured length of the run, 1..300 (default 20)
 *   benchWarmup=<s>    frames before this many seconds are not measured (default 2)
 *   refresh=<hz>       use this display refresh rate instead of measuring it at startup
 *   target=<fps>       dynamic-resolution target (0 = the display refresh)
 *   cap=<fps>          frame cap (0 = none)
 *   perf240=1|0        the Performance 240 preset (High tier with cheaper budgets)
 */
import type { AppSettings } from '../ui/settingsSchema';
import { BENCH_DEFAULT_SECONDS, BENCH_DEFAULT_WARMUP_S } from './benchModel';
import { hoursToTimeMs, type AppParams } from './params';

export interface PerfParams {
  bench: boolean;
  gpuProfile: boolean;
  benchSeconds: number;
  benchWarmup: number;
  /** Refresh rate to assume; undefined measures it. */
  refresh?: number;
  target?: number;
  cap?: number;
  perf240?: boolean;
}

function num(q: URLSearchParams, key: string): number | undefined {
  const raw = q.get(key);
  if (raw === null || raw.trim() === '') return undefined;
  const v = Number(raw);
  return Number.isFinite(v) ? v : undefined;
}

export function parsePerfParams(search: string): PerfParams {
  const q = new URLSearchParams(search);
  const flag = (key: string): boolean | undefined => {
    const v = q.get(key);
    return v === null ? undefined : v !== '0' && v !== 'false';
  };
  const seconds = num(q, 'benchSeconds');
  const warmup = num(q, 'benchWarmup');
  const refresh = num(q, 'refresh');
  const target = num(q, 'target');
  const cap = num(q, 'cap');
  return {
    bench: flag('bench') ?? false,
    gpuProfile: q.get('gpuProfile') === '1',
    benchSeconds: seconds === undefined ? BENCH_DEFAULT_SECONDS : Math.min(300, Math.max(1, seconds)),
    benchWarmup: warmup === undefined ? BENCH_DEFAULT_WARMUP_S : Math.min(30, Math.max(0, warmup)),
    refresh: refresh !== undefined && refresh >= 10 && refresh <= 1000 ? refresh : undefined,
    target: target === undefined ? undefined : Math.max(0, Math.round(target)),
    cap: cap === undefined ? undefined : Math.max(0, Math.round(cap)),
    perf240: flag('perf240'),
  };
}

/** The benchmark flies the scripted track from the pad with the camera in the cockpit. */
export function withBench(p: AppParams, perf: PerfParams): AppParams {
  if (!perf.bench) return p;
  return { ...p, scenario: p.scenario ?? 'fly', autostart: true, cam: p.cam ?? 'fpv', hold: false, advance: p.advance > 0 ? p.advance : 360 };
}

/** What the performance parameters change in the settings. */
export function perfSettingsPatch(perf: PerfParams): Partial<AppSettings> {
  const out: Partial<AppSettings> = {};
  if (perf.target !== undefined) out.targetFps = perf.target;
  if (perf.cap !== undefined) out.frameCap = perf.cap;
  if (perf.perf240 !== undefined) {
    out.performance240 = perf.perf240;
    if (perf.perf240) out.quality = 'high';
  }
  return out;
}

/**
 * The benchmark's fixed settings, applied over whatever the pilot saved so runs on different machines compare: no dynamic resolution,
 * no frame cap, full render scale, still air, noon, the default world. `query` values the URL gave explicitly (quality, scale,
 * seed, t, wind, perf240) win, so a run can still be pointed at another tier or world.
 */
export function benchSettingsPatch(p: AppParams, perf: PerfParams, base: Pick<AppSettings, 'timeMs' | 'observer'>, defaults: AppSettings): Partial<AppSettings> {
  return {
    dynamicResolution: false,
    frameCap: 0,
    targetFps: 0,
    renderScale: p.scale ?? 1,
    quality: p.quality ?? defaults.quality,
    performance240: perf.perf240 ?? false,
    seed: p.seed ?? defaults.seed,
    trackStyle: p.style ?? defaults.trackStyle,
    windSpeed: p.wind ?? 0,
    timeMs: hoursToTimeMs(base.timeMs, base.observer.longitudeDeg, p.hours ?? 12),
    lensDistortion: defaults.lensDistortion,
    videoNoise: defaults.videoNoise,
    fov: defaults.fov,
    cameraTiltDeg: defaults.cameraTiltDeg,
  };
}

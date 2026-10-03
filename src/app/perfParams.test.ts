import { describe, expect, it } from 'vitest';
import { defaultAppSettings } from '../ui/settingsSchema';
import { parseParams } from './params';
import { benchSettingsPatch, parsePerfParams, perfSettingsPatch, withBench } from './perfParams';

describe('parsePerfParams', () => {
  it('defaults: no benchmark, measure the refresh', () => {
    expect(parsePerfParams('')).toEqual({ bench: false, gpuProfile: false, benchSeconds: 20, benchWarmup: 2, refresh: undefined, target: undefined, cap: undefined, perf240: undefined });
  });

  it('requires an explicit profiling opt-in without changing saved settings', () => {
    expect(parsePerfParams('?gpuProfile=1').gpuProfile).toBe(true);
    for (const value of ['', '0', 'false', 'true', 'typo']) expect(parsePerfParams(`?gpuProfile=${value}`).gpuProfile).toBe(false);
    expect(perfSettingsPatch(parsePerfParams('?gpuProfile=1'))).toEqual({});
  });

  it('reads the benchmark options and clamps them', () => {
    expect(parsePerfParams('?bench=1&benchSeconds=3&benchWarmup=0')).toMatchObject({ bench: true, benchSeconds: 3, benchWarmup: 0 });
    expect(parsePerfParams('?bench=1&benchSeconds=99999&benchWarmup=-4')).toMatchObject({ benchSeconds: 300, benchWarmup: 0 });
    expect(parsePerfParams('?bench=0').bench).toBe(false);
    expect(parsePerfParams('?benchSeconds=abc').benchSeconds).toBe(20);
  });

  it('reads refresh, target, cap and the preset', () => {
    expect(parsePerfParams('?refresh=144&target=240&cap=60&perf240=1')).toMatchObject({ refresh: 144, target: 240, cap: 60, perf240: true });
    expect(parsePerfParams('?perf240=0').perf240).toBe(false);
    expect(parsePerfParams('?refresh=3').refresh).toBeUndefined();
    expect(parsePerfParams('?target=-5').target).toBe(0);
  });
});

describe('withBench', () => {
  it('leaves the parameters alone without bench=1', () => {
    const p = parseParams('');
    expect(withBench(p, parsePerfParams(''))).toBe(p);
  });

  it('autostarts the fly scenario in the cockpit and runs the real-time loop', () => {
    const p = withBench(parseParams('?hold=1'), parsePerfParams('?bench=1'));
    expect(p).toMatchObject({ scenario: 'fly', autostart: true, cam: 'fpv', hold: false });
    expect(p.advance).toBeGreaterThan(0);
  });

  it('keeps a scenario and camera the URL asked for', () => {
    const p = withBench(parseParams('?scenario=hover&cam=chase&advance=10'), parsePerfParams('?bench=1'));
    expect(p).toMatchObject({ scenario: 'hover', cam: 'chase', advance: 10 });
  });
});

describe('perfSettingsPatch', () => {
  it('is empty without overrides', () => {
    expect(perfSettingsPatch(parsePerfParams(''))).toEqual({});
  });

  it('the preset implies the High tier', () => {
    expect(perfSettingsPatch(parsePerfParams('?perf240=1'))).toEqual({ performance240: true, quality: 'high' });
    expect(perfSettingsPatch(parsePerfParams('?perf240=0'))).toEqual({ performance240: false });
  });

  it('maps target and cap', () => {
    expect(perfSettingsPatch(parsePerfParams('?target=144&cap=60'))).toEqual({ targetFps: 144, frameCap: 60 });
  });
});

describe('benchSettingsPatch', () => {
  const DEFAULT_SETTINGS = defaultAppSettings();
  const base = { timeMs: DEFAULT_SETTINGS.timeMs, observer: DEFAULT_SETTINGS.observer };

  it('fixes the settings that decide performance, whatever the pilot saved', () => {
    const patch = benchSettingsPatch(parseParams(''), parsePerfParams('?bench=1'), base, DEFAULT_SETTINGS);
    expect(patch).toMatchObject({ dynamicResolution: false, frameCap: 0, targetFps: 0, renderScale: 1, quality: 'high', performance240: false, seed: 1337, windSpeed: 0 });
  });

  it('lets the URL choose the tier, scale, seed and the preset', () => {
    const patch = benchSettingsPatch(parseParams('?quality=low&scale=0.5&seed=9'), parsePerfParams('?bench=1&perf240=1'), base, DEFAULT_SETTINGS);
    expect(patch).toMatchObject({ quality: 'low', renderScale: 0.5, seed: 9, performance240: true });
  });

  it('sets the time of day to local noon unless t= is given', () => {
    const noon = benchSettingsPatch(parseParams(''), parsePerfParams(''), base, DEFAULT_SETTINGS).timeMs as number;
    const dusk = benchSettingsPatch(parseParams('?t=18'), parsePerfParams(''), base, DEFAULT_SETTINGS).timeMs as number;
    expect(Math.round((dusk - noon) / 3600000)).toBe(6);
  });
});

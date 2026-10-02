import { describe, expect, it } from 'vitest';
import { localSolarHours } from '../game/clock';
import { defaultAppSettings } from '../ui/settingsSchema';
import { SCENARIO_ADVANCE, hasPersistentOverrides, hoursToTimeMs, parseParams, settingsPatch } from './params';

describe('parseParams', () => {
  it('has inert defaults with an empty query', () => {
    const p = parseParams('');
    expect(p.autostart).toBe(false);
    expect(p.hold).toBe(false);
    expect(p.advance).toBe(0);
    expect(p.fixedDt).toBeCloseTo(1 / 60, 12);
    for (const k of ['seed', 'style', 'hours', 'cam', 'scenario', 'quality', 'scale', 'dyn', 'gates', 'laps', 'wind', 'windDir', 'agl'] as const) {
      expect(p[k], k).toBeUndefined();
    }
  });

  it('reads the documented keys', () => {
    const p = parseParams('?seed=42&style=mountain&t=18.5&cam=chase&scenario=fly&autostart=1&quality=low&scale=0.5&dyn=0&gates=7&laps=3&wind=6&winddir=270&advance=12&agl=0.5&fixeddt=0.01&hold=1');
    expect(p).toMatchObject({
      seed: 42, style: 'mountain', hours: 18.5, cam: 'chase', scenario: 'fly', autostart: true, quality: 'low', scale: 0.5, dyn: false,
      gates: 7, laps: 3, wind: 6, windDir: 270, advance: 12, agl: 0.5, fixedDt: 0.01, hold: true,
    });
  });

  it('ignores unknown names and garbage numbers', () => {
    const p = parseParams('?style=zigzag&cam=orbit&scenario=dance&quality=ultra-max&seed=abc&t=&gates=NaN&fixeddt=-1');
    expect(p.style).toBeUndefined();
    expect(p.cam).toBeUndefined();
    expect(p.scenario).toBeUndefined();
    expect(p.quality).toBeUndefined();
    expect(p.seed).toBeUndefined();
    expect(p.hours).toBeUndefined();
    expect(p.gates).toBeUndefined();
    expect(p.fixedDt).toBeCloseTo(1 / 60, 12);
  });

  it('clamps numbers to sane ranges', () => {
    const p = parseParams('?seed=-5&scale=9&gates=0&laps=-2&agl=100&fixeddt=5&advance=-3');
    expect(p.seed).toBe(0);
    expect(p.scale).toBe(1);
    expect(p.gates).toBe(1);
    expect(p.laps).toBe(1);
    expect(p.agl).toBe(50);
    expect(p.fixedDt).toBeCloseTo(1 / 60, 12);
    expect(p.advance).toBe(0);
    expect(parseParams('?scale=0.01&agl=0').scale).toBe(0.25);
    expect(parseParams('?agl=0').agl).toBe(0.3);
  });

  it('reads flags the way people write them', () => {
    expect(parseParams('?autostart').autostart).toBe(true);
    expect(parseParams('?autostart=0').autostart).toBe(false);
    expect(parseParams('?autostart=false').autostart).toBe(false);
    expect(parseParams('?dyn=1').dyn).toBe(true);
  });

  it('runs a scenario in flight before ready only when it autostarts', () => {
    expect(parseParams('?scenario=hover&autostart=1').advance).toBe(SCENARIO_ADVANCE.hover);
    expect(parseParams('?scenario=fly&autostart=1').advance).toBe(SCENARIO_ADVANCE.fly);
    expect(parseParams('?scenario=gate&autostart=1').advance).toBe(0);
    expect(parseParams('?scenario=crash&autostart=1').advance).toBe(0);
    expect(parseParams('?scenario=hover').advance).toBe(0);
    expect(parseParams('?autostart=1').advance).toBe(0);
    expect(parseParams('?scenario=hover&autostart=1&advance=20').advance).toBe(20);
    expect(parseParams('?scenario=hover&autostart=1&advance=0').advance).toBe(0);
  });
});

describe('hoursToTimeMs', () => {
  const settings = defaultAppSettings();
  const observer = settings.observer;

  it('lands on the requested local solar hour of the same solar day', () => {
    const base = settings.timeMs;
    for (const h of [0, 6.25, 12, 18.5, 23.99]) {
      const t = hoursToTimeMs(base, observer.longitudeDeg, h);
      expect(localSolarHours(t, observer.longitudeDeg), `hour ${h}`).toBeCloseTo(h, 6);
      expect(Math.abs(t - base)).toBeLessThan(24 * 3600 * 1000);
    }
  });

  it('is the UTC hour at longitude 0 and shifted by 15 degrees per hour elsewhere', () => {
    const day = Date.UTC(2025, 5, 21, 12, 0, 0);
    expect(hoursToTimeMs(day, 0, 12)).toBe(Date.UTC(2025, 5, 21, 12, 0, 0));
    // 90 E is six hours ahead of UTC: local noon is 06:00 UTC.
    expect(hoursToTimeMs(day, 90, 12)).toBe(Date.UTC(2025, 5, 21, 6, 0, 0));
    expect(hoursToTimeMs(day, -90, 12)).toBe(Date.UTC(2025, 5, 21, 18, 0, 0));
  });

  it('clamps out-of-range hours to the day', () => {
    const day = Date.UTC(2025, 5, 21, 12, 0, 0);
    expect(hoursToTimeMs(day, 0, -3)).toBe(Date.UTC(2025, 5, 21, 0, 0, 0));
    expect(hoursToTimeMs(day, 0, 40)).toBe(Date.UTC(2025, 5, 22, 0, 0, 0));
  });
});

describe('settingsPatch', () => {
  const base = defaultAppSettings();

  it('is empty without overrides', () => {
    const patch = settingsPatch(parseParams(''), base);
    expect(patch).toEqual({});
    expect(hasPersistentOverrides(patch)).toBe(false);
  });

  it('maps every override onto its setting', () => {
    const patch = settingsPatch(parseParams('?seed=7&style=sprint&quality=low&scale=0.5&dyn=0&gates=8&laps=2&wind=-3&winddir=-90'), base);
    expect(patch).toMatchObject({
      seed: 7, trackStyle: 'sprint', quality: 'low', renderScale: 0.5, dynamicResolution: false, gateCount: 8, laps: 2, windSpeed: 0, windDirDeg: 270,
    });
    expect(hasPersistentOverrides(patch)).toBe(true);
  });

  it('turns t= into a time and does not count it as a persistent override', () => {
    const patch = settingsPatch(parseParams('?t=6'), base);
    expect(Object.keys(patch)).toEqual(['timeMs']);
    expect(localSolarHours(patch.timeMs as number, base.observer.longitudeDeg)).toBeCloseTo(6, 6);
    expect(hasPersistentOverrides(patch)).toBe(false);
  });
});

describe('world share links', () => {
  it('reads difficulty in percent, clamped, and the countdown switch', () => {
    expect(parseParams('?diff=35').difficulty).toBeCloseTo(0.35, 12);
    expect(parseParams('?diff=250').difficulty).toBe(1);
    expect(parseParams('?diff=-4').difficulty).toBe(0);
    expect(parseParams('?diff=x').difficulty).toBeUndefined();
    expect(parseParams('?countdown=1').countdown).toBe(true);
    expect(parseParams('?countdown=0').countdown).toBe(false);
    expect(parseParams('').countdown).toBeUndefined();
  });

  it('opens the same world the link was made from', async () => {
    const { shareUrl, shareWorld } = await import('../ui/seedModel');
    const s = { ...defaultAppSettings(), seed: 482913, trackStyle: 'mountain' as const, gateCount: 17, laps: 2, difficulty: 0.65 };
    const url = new URL(shareUrl('https://sim.example/fly/', shareWorld(s, null)));
    const p = parseParams(url.search);
    const patch = settingsPatch(p, defaultAppSettings());
    expect(patch).toMatchObject({ seed: 482913, trackStyle: 'mountain', gateCount: 17, laps: 2, quality: s.quality });
    expect(patch.difficulty).toBeCloseTo(0.65, 12);
    expect(p.trackSeed).toBeUndefined();
    expect(hasPersistentOverrides(patch)).toBe(true);
  });

  it('reads the track seed of a link to a track that came from the N key', async () => {
    const { shareUrl } = await import('../ui/seedModel');
    const w = { terrainSeed: 1337, trackSeed: 1340, style: 'race' as const, gateCount: 12, laps: 3, difficulty: 0.35, quality: 'medium' as const };
    const p = parseParams(new URL(shareUrl('https://sim.example/', w)).search);
    expect(p).toMatchObject({ seed: 1337, trackSeed: 1340, style: 'race', gates: 12, laps: 3, quality: 'medium' });
    expect(parseParams('?tseed=-3').trackSeed).toBe(0);
    expect(parseParams('?tseed=zz').trackSeed).toBeUndefined();
  });
});

import { describe, expect, it } from 'vitest';
import { DEFAULT_ATMOSPHERE_SETTINGS, sanitizeAtmosphereSettings, type AtmosphereSettings } from './settings';

describe('atmosphere settings', () => {
  it('ships defaults that are already valid', () => {
    expect(sanitizeAtmosphereSettings({})).toEqual(DEFAULT_ATMOSPHERE_SETTINGS);
    expect(DEFAULT_ATMOSPHERE_SETTINGS.cumulusBaseKm).toBeCloseTo(1.5, 12);
    expect(DEFAULT_ATMOSPHERE_SETTINGS.cumulusTopKm).toBeCloseTo(4, 12);
    expect(DEFAULT_ATMOSPHERE_SETTINGS.cirrusBaseKm).toBeGreaterThanOrEqual(8);
    expect(DEFAULT_ATMOSPHERE_SETTINGS.cirrusTopKm).toBeLessThanOrEqual(10);
    expect(DEFAULT_ATMOSPHERE_SETTINGS.seed).toBeNull();
  });

  it('clamps every knob into its range', () => {
    const s = sanitizeAtmosphereSettings({
      cloudCoverage: 3, cirrusCoverage: -1, cloudDensity: 100, windSpeed: 500, starBrightness: -4, twinkle: 9, milkyWayBrightness: 99, nightSkyScale: -1,
    });
    expect(s.cloudCoverage).toBe(1);
    expect(s.cirrusCoverage).toBe(0);
    expect(s.cloudDensity).toBe(8);
    expect(s.windSpeed).toBe(80);
    expect(s.starBrightness).toBe(0);
    expect(s.twinkle).toBe(1);
    expect(s.milkyWayBrightness).toBe(20);
    expect(s.nightSkyScale).toBe(0);
    expect(sanitizeAtmosphereSettings({ cloudDensity: 0 }).cloudDensity).toBe(0.05);
  });

  it('keeps the layers ordered and separated, whatever the input', () => {
    const inverted = sanitizeAtmosphereSettings({ cumulusBaseKm: 5, cumulusTopKm: 2, cirrusBaseKm: 1, cirrusTopKm: 0 });
    expect(inverted.cumulusTopKm).toBeGreaterThanOrEqual(inverted.cumulusBaseKm + 0.3);
    expect(inverted.cirrusBaseKm).toBeGreaterThanOrEqual(inverted.cumulusTopKm + 0.5);
    expect(inverted.cirrusTopKm).toBeGreaterThanOrEqual(inverted.cirrusBaseKm + 0.2);
    const extreme = sanitizeAtmosphereSettings({ cumulusBaseKm: 100, cumulusTopKm: 100, cirrusBaseKm: 100, cirrusTopKm: 100 });
    expect(extreme.cumulusBaseKm).toBeLessThanOrEqual(6);
    expect(extreme.cumulusTopKm).toBeLessThanOrEqual(9);
    expect(extreme.cirrusBaseKm).toBeLessThanOrEqual(14);
    expect(extreme.cirrusTopKm).toBeLessThanOrEqual(16);
    expect(extreme.cirrusBaseKm).toBeGreaterThan(extreme.cumulusTopKm);
    expect(sanitizeAtmosphereSettings({ cumulusBaseKm: 0 }).cumulusBaseKm).toBe(0.3);
  });

  it('replaces non-finite numbers with the defaults', () => {
    const s = sanitizeAtmosphereSettings({
      cloudCoverage: NaN, cirrusCoverage: Infinity, cloudDensity: NaN, windSpeed: -Infinity, windDirectionDeg: NaN, cumulusBaseKm: NaN, twinkle: NaN,
    });
    expect(s.cloudCoverage).toBe(DEFAULT_ATMOSPHERE_SETTINGS.cloudCoverage);
    expect(s.cirrusCoverage).toBe(DEFAULT_ATMOSPHERE_SETTINGS.cirrusCoverage);
    expect(s.cloudDensity).toBe(1);
    expect(s.windSpeed).toBe(DEFAULT_ATMOSPHERE_SETTINGS.windSpeed);
    expect(s.windDirectionDeg).toBe(DEFAULT_ATMOSPHERE_SETTINGS.windDirectionDeg);
    expect(s.cumulusBaseKm).toBe(DEFAULT_ATMOSPHERE_SETTINGS.cumulusBaseKm);
    expect(s.twinkle).toBe(DEFAULT_ATMOSPHERE_SETTINGS.twinkle);
    for (const v of Object.values(s)) if (typeof v === 'number') expect(Number.isFinite(v)).toBe(true);
  });

  it('passes flags and the seed through, and never mutates its inputs', () => {
    const base: AtmosphereSettings = { ...DEFAULT_ATMOSPHERE_SETTINGS, cloudCoverage: 0.9 };
    const input: Partial<AtmosphereSettings> = { cloudsEnabled: false, starsEnabled: false, milkyWayEnabled: false, seed: 7, windDirectionDeg: 725 };
    const before = JSON.stringify({ base, input });
    const s = sanitizeAtmosphereSettings(input, base);
    expect(s).not.toBe(base);
    expect(s.cloudsEnabled).toBe(false);
    expect(s.starsEnabled).toBe(false);
    expect(s.milkyWayEnabled).toBe(false);
    expect(s.seed).toBe(7);
    expect(s.windDirectionDeg).toBe(725);
    expect(s.cloudCoverage).toBe(0.9);
    expect(JSON.stringify({ base, input })).toBe(before);
  });
});

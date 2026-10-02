import { describe, expect, it } from 'vitest';
import { DEFAULT_ATMOSPHERE_SETTINGS } from './settings';
import { cloudField, cloudOpticalDepth } from './cloudModel';

const DEG = Math.PI / 180;

/** Optical depth along the sun's direction from a 20 x 20 grid of observer positions 1.5 km apart (a stand-in for the sun drifting behind the field). */
function sunTaus(overrides: Partial<typeof DEFAULT_ATMOSPHERE_SETTINGS>, elevationDeg: number): number[] {
  const f = cloudField({ ...DEFAULT_ATMOSPHERE_SETTINGS, ...overrides }, 1337, 0, 1200);
  const e = elevationDeg * DEG;
  const d = [Math.cos(e) * Math.sin(2.5), Math.sin(e), -Math.cos(e) * Math.cos(2.5)];
  const out: number[] = [];
  for (let i = 0; i < 400; i++) out.push(cloudOpticalDepth(f, (i % 20) * 1500 - 15000, 0, Math.floor(i / 20) * 1500 - 15000, d[0], d[1], d[2]));
  return out;
}

const fraction = (taus: number[], pred: (t: number) => boolean): number => taus.filter(pred).length / taus.length;

describe('the sun behind the default cloud field', () => {
  it('is clear (no more than a tenth of an optical depth) for more than half of a high sun, like fair-weather cumulus', () => {
    const taus = sunTaus({}, 60);
    expect(fraction(taus, (t) => t < 0.1)).toBeGreaterThan(0.5);
    expect(fraction(taus, (t) => t < 0.1)).toBeLessThan(0.85);
  });

  it('is behind a cloud too thick to show the disc (tau > 4) for well under half of a high sun', () => {
    expect(fraction(sunTaus({}, 60), (t) => t > 4)).toBeLessThan(0.45);
  });

  it('is blocked more often as the sun gets lower, because its ray crosses more of the layer', () => {
    const high = fraction(sunTaus({}, 60), (t) => t < 0.1), low = fraction(sunTaus({}, 20), (t) => t < 0.1);
    expect(low).toBeLessThan(high);
    expect(low).toBeGreaterThan(0.2);
  });

  it('is hardly dimmed by the default cirrus alone (mean transmittance above 0.9)', () => {
    const taus = sunTaus({ cloudCoverage: 0 }, 45);
    expect(taus.reduce((a, t) => a + Math.exp(-t), 0) / taus.length).toBeGreaterThan(0.9);
  });
});

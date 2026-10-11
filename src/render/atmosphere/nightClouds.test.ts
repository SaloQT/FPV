import { describe, expect, it } from 'vitest';
import density from '../shaders/sky/cloud_density.wgsl?raw';
import { NIGHT_CUMULUS_SCALE } from './cloudModel';

const num = (name: string): number => Number(density.match(new RegExp(`const ${name} : f32 = ([^;]*);`))?.[1]);

describe('night cumulus', () => {
  it('clears whole regions at night instead of raising the cover threshold (which left rows of identical domes)', () => {
    expect(density).toMatch(/fn cumulusCoverage\(\) -> f32 \{ return ap\.cloudA\.x; \}/);
    expect(density).toMatch(/let n = cumulusWeather\(xz\) - nightClearing\(xz, day\);\s*let l = presence\(n, cumulusCoverage\(\)\);/);
    // Taller than zero, flatter than day.
    expect(num('NIGHT_CUMULUS_TALL')).toBeGreaterThan(0.5);
    expect(num('NIGHT_CUMULUS_TALL')).toBeLessThan(1);
  });

  it('takes off enough weather to clear a cloud core, over about the share of the sky the night loses', () => {
    // presence() switches between t - 0.09 and t + 0.09 with t = 0.8 - 0.62 * coverage; a core at weather 1 must fall below t - 0.09 at the
    // default cover (0.3), so the clearing depth must exceed 1 - (0.8 - 0.62 * 0.3 - 0.09).
    expect(num('NIGHT_CLEAR_DEPTH')).toBeGreaterThan(1 - (0.8 - 0.62 * 0.3 - 0.09));
    // The mask (value noise, about uniform on 0..1) clears above NIGHT_CLEAR_LO: roughly 1 - NIGHT_CUMULUS_SCALE of the area, within 0.1.
    expect(Math.abs(1 - num('NIGHT_CLEAR_LO') - (1 - NIGHT_CUMULUS_SCALE))).toBeLessThan(0.1);
  });
});

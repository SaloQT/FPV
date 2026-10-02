import { describe, expect, it } from 'vitest';
import type { Vec3 } from '../../contracts';
import {
  AIRGLOW_HEIGHT_KM, AIRGLOW_SLANT_TINT_NITS, AIRGLOW_ZENITH_NITS, GEGENSCHEIN_S10, GROUND_ALBEDO, MIE_BACK_G, MIE_BACK_WEIGHT, MIE_EXTINCTION,
  MOON_SCATTER_TINT, MS_DIPOLE, MS_DIPOLE_MU_HI, MS_DIPOLE_MU_LO, OZONE_ABSORPTION, MIE_G, MIE_NARROW_G, MIE_NARROW_WEIGHT, MIE_SIDE_G, MIE_SIDE_WEIGHT, MIE_SCALE_HEIGHT_KM, MIE_SCATTER, NITS_PER_S10, STARLIGHT_SKY_NITS, ZODIACAL_COLOR, ZODIACAL_FAR_S10, ZODIACAL_NEAR_S10,
  ZODIACAL_POLE_S10, nightSkyNits, vanRhijn, zodiacalNits, zodiacalS10,
} from './physics';

const nodeFs = (globalThis as unknown as { process: { getBuiltinModule(id: string): unknown } }).process
  .getBuiltinModule('node:fs') as { readFileSync(path: URL): Uint8Array };

const luma = (c: Vec3): number => 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
const cosDeg = (d: number): number => Math.cos((d * Math.PI) / 180);
const sinDeg = (d: number): number => Math.sin((d * Math.PI) / 180);

function wgslConstants(file: string): Map<string, number[]> {
  const src = new TextDecoder().decode(nodeFs.readFileSync(new URL(`../shaders/sky/${file}`, import.meta.url)));
  const out = new Map<string, number[]>();
  for (const m of src.matchAll(/const\s+(\w+)\s*:\s*(?:f32|vec3f)\s*=\s*(?:vec3f\()?([^;]*?)\)?;/g)) out.set(m[1], m[2].split(',').map(Number));
  return out;
}

describe('airglow and starlight floor', () => {
  it('sits near 21.5 mag/arcsec2 at the zenith and is near neutral there', () => {
    const z = nightSkyNits(1);
    expect(luma(z)).toBeGreaterThan(3e-4);
    expect(luma(z)).toBeLessThan(5e-4);
    expect(Math.max(...z) / Math.min(...z)).toBeLessThan(1.15);
  });

  it('brightens with the Van Rhijn slant path and stays positive in every channel', () => {
    expect(luma(nightSkyNits(0.34))).toBeGreaterThan(1.8 * luma(nightSkyNits(1)));
    for (let c = 0; c <= 1; c += 0.05) for (const v of nightSkyNits(c)) expect(v).toBeGreaterThan(0);
  });

  it('reaches about a millinit 20 degrees above the horizon', () => {
    const l = luma(nightSkyNits(cosDeg(70)));
    expect(l).toBeGreaterThan(6e-4);
    expect(l).toBeLessThan(1.6e-3);
  });

  it('turns greener only along the slant path, never at the zenith', () => {
    const zenith = nightSkyNits(1), low = nightSkyNits(cosDeg(80));
    expect(zenith[1] / zenith[0]).toBeLessThan(1.08);
    expect(low[1] / low[0]).toBeGreaterThan(zenith[1] / zenith[0]);
    expect(low[1] / low[0]).toBeLessThan(1.5);
  });

  it('adds exactly the tint per unit of Van Rhijn excess on top of the neutral shell', () => {
    const vr = vanRhijn(0.3);
    const n = nightSkyNits(0.3);
    for (let c = 0; c < 3; c++) {
      expect(n[c]).toBeCloseTo(AIRGLOW_ZENITH_NITS[c] * vr + AIRGLOW_SLANT_TINT_NITS[c] * (vr - 1) + STARLIGHT_SKY_NITS[c], 12);
    }
  });
});

describe('zodiacal light', () => {
  it('is about 1500 S10 (1.2 millinit) at 30 degrees elongation on the ecliptic and 77 S10 at the ecliptic pole', () => {
    expect(zodiacalS10(cosDeg(30), 0)).toBeGreaterThan(1400);
    expect(zodiacalS10(cosDeg(30), 0)).toBeLessThan(1650);
    expect(zodiacalNits(cosDeg(30), 0)[1] / ZODIACAL_COLOR[1]).toBeCloseTo(zodiacalS10(cosDeg(30), 0) * NITS_PER_S10, 12);
    expect(zodiacalS10(cosDeg(90), 1)).toBeCloseTo(ZODIACAL_POLE_S10, 9);
    expect(zodiacalS10(cosDeg(30), 1)).toBeCloseTo(ZODIACAL_POLE_S10, 9);
  });

  it('fades with elongation along the ecliptic, then flattens to a floor above the pole brightness', () => {
    let prev = Infinity;
    for (const e of [20, 30, 45, 60, 90, 120, 150]) {
      const s = zodiacalS10(cosDeg(e), 0);
      expect(s).toBeLessThan(prev);
      prev = s;
    }
    expect(zodiacalS10(cosDeg(150), 0)).toBeGreaterThan(ZODIACAL_POLE_S10);
    expect(zodiacalS10(cosDeg(150), 0)).toBeLessThan(ZODIACAL_FAR_S10 + 0.1 * ZODIACAL_NEAR_S10);
  });

  it('has a gegenschein bump at the anti-solar point that is confined to the ecliptic', () => {
    expect(zodiacalS10(-1, 0)).toBeGreaterThan(zodiacalS10(cosDeg(150), 0) + GEGENSCHEIN_S10 * 0.5);
    expect(zodiacalS10(-1, sinDeg(30))).toBeLessThan(zodiacalS10(-1, 0));
  });

  it('narrows toward the ecliptic close to the sun and decreases monotonically with latitude', () => {
    for (const e of [40, 90, 150]) {
      let prev = Infinity;
      for (const b of [0, 15, 30, 60, 90]) {
        const s = zodiacalS10(cosDeg(e), sinDeg(b));
        expect(s).toBeLessThanOrEqual(prev);
        prev = s;
      }
    }
    const nearHalf = (zodiacalS10(cosDeg(35), sinDeg(15)) - ZODIACAL_POLE_S10) / (zodiacalS10(cosDeg(35), 0) - ZODIACAL_POLE_S10);
    const farHalf = (zodiacalS10(cosDeg(120), sinDeg(15)) - ZODIACAL_POLE_S10) / (zodiacalS10(cosDeg(120), 0) - ZODIACAL_POLE_S10);
    expect(nearHalf).toBeLessThan(farHalf);
  });

  it('is finite and bounded right at the sun', () => {
    expect(Number.isFinite(zodiacalS10(1, 0))).toBe(true);
    expect(zodiacalS10(1, 0)).toBeLessThan(1e4);
  });
});

describe('shader mirrors', () => {
  it('night_light.wgsl carries the same constants as physics.ts', () => {
    const w = wgslConstants('night_light.wgsl');
    expect(w.get('AIRGLOW_HEIGHT')).toEqual([AIRGLOW_HEIGHT_KM]);
    expect(w.get('AIRGLOW_ZENITH')).toEqual([...AIRGLOW_ZENITH_NITS]);
    expect(w.get('AIRGLOW_SLANT_TINT')).toEqual([...AIRGLOW_SLANT_TINT_NITS]);
    expect(w.get('STARLIGHT_FLOOR')).toEqual([...STARLIGHT_SKY_NITS]);
    expect(w.get('NITS_PER_S10')).toEqual([NITS_PER_S10]);
    expect(w.get('ZODIACAL_COLOR')).toEqual([...ZODIACAL_COLOR]);
    expect(w.get('ZODIACAL_POLE_S10')).toEqual([ZODIACAL_POLE_S10]);
    expect(w.get('ZODIACAL_FAR_S10')).toEqual([ZODIACAL_FAR_S10]);
    expect(w.get('ZODIACAL_NEAR_S10')).toEqual([ZODIACAL_NEAR_S10]);
    expect(w.get('GEGENSCHEIN_S10')).toEqual([GEGENSCHEIN_S10]);
  });

  it('atmos_params.wgsl carries the same aerosol and ground constants as physics.ts', () => {
    const w = wgslConstants('atmos_params.wgsl');
    expect(w.get('MIE_SCATTER')).toEqual([MIE_SCATTER]);
    expect(w.get('MIE_EXTINCTION')).toEqual([MIE_EXTINCTION]);
    expect(w.get('MIE_H')).toEqual([MIE_SCALE_HEIGHT_KM]);
    expect(w.get('MIE_G')).toEqual([MIE_G]);
    expect(w.get('MIE_NARROW_G')).toEqual([MIE_NARROW_G]);
    expect(w.get('MIE_NARROW_WEIGHT')).toEqual([MIE_NARROW_WEIGHT]);
    expect(w.get('MIE_SIDE_G')).toEqual([MIE_SIDE_G]);
    expect(w.get('MIE_SIDE_WEIGHT')).toEqual([MIE_SIDE_WEIGHT]);
    expect(w.get('MIE_BACK_G')).toEqual([MIE_BACK_G]);
    expect(w.get('MIE_BACK_WEIGHT')).toEqual([MIE_BACK_WEIGHT]);
    expect(w.get('OZONE_ABSORB')).toEqual([...OZONE_ABSORPTION]);
    expect(w.get('GROUND_ALBEDO')).toEqual([GROUND_ALBEDO]);
    expect(w.get('MOON_SCATTER_TINT')).toEqual([...MOON_SCATTER_TINT]);
    expect(w.get('MS_DIPOLE')).toEqual([MS_DIPOLE]);
    expect(w.get('MS_DIPOLE_MU_LO')).toEqual([MS_DIPOLE_MU_LO]);
    expect(w.get('MS_DIPOLE_MU_HI')).toEqual([MS_DIPOLE_MU_HI]);
  });
});

import { describe, expect, it } from 'vitest';
import { DEG, LUNAR_FEATURES, LUNAR_ROWS, galacticAxesEquatorial } from './celestial';
import { DEFAULT_ATMOSPHERE_SETTINGS, type AtmosphereSettings } from './settings';
import { ATMOS_PARAM_BYTES, AtmosUniforms, FIXED_ROWS, eclipticNorthWorld, windOffset, type AtmosParamInputs } from './uniforms';

const nodeFs = (globalThis as unknown as { process: { getBuiltinModule(id: string): unknown } }).process
  .getBuiltinModule('node:fs') as { readFileSync(path: URL): Uint8Array };

const IDENTITY = [1, 0, 0, 0, 1, 0, 0, 0, 1];
const OBLIQUITY = 23.4392911 * DEG;

function inputs(patch: Partial<AtmosphereSettings> = {}, extra: Partial<AtmosParamInputs> = {}): AtmosParamInputs {
  return {
    settings: { ...DEFAULT_ATMOSPHERE_SETTINGS, ...patch }, moonScattering: true, seed: 123.5, timeSeconds: 100, equatorialToWorld: IDENTITY, starMagLimit: 7.5,
    cloudSteps: 24, jitterIndex: 5, shadowCenterX: 640, shadowCenterZ: -320, shadowExtentM: 8000, historyBlend: 0.9, historyValid: true, lightSteps: 5, ...extra,
  };
}

describe('wind drift', () => {
  it('moves clouds toward the compass bearing at speed x time', () => {
    expect(windOffset(10, 0, 60)[1]).toBeCloseTo(-600, 9);
    expect(windOffset(10, 0, 60)[0]).toBeCloseTo(0, 9);
    const east = windOffset(10, 90, 60);
    expect(east[0]).toBeCloseTo(600, 9);
    expect(east[1]).toBeCloseTo(0, 9);
    expect(windOffset(10, 180, 60)[1]).toBeCloseTo(600, 9);
    const west = windOffset(4, 270, 5);
    expect(west[0]).toBeCloseTo(-20, 9);
  });

  it('has the magnitude speed x time for any bearing, is zero at rest and writes into the given array', () => {
    for (const b of [0, 33, 117, 250, 359]) {
      const [x, z] = windOffset(7, b, 30);
      expect(Math.hypot(x, z)).toBeCloseTo(210, 9);
    }
    expect(Math.hypot(...windOffset(7, 40, 0))).toBe(0);
    expect(Math.hypot(...windOffset(0, 40, 99))).toBe(0);
    const out: [number, number] = [0, 0];
    expect(windOffset(1, 90, 1, out)).toBe(out);
  });
});

describe('ecliptic pole', () => {
  it('is the tilted J2000 pole for the identity and a unit vector for any rotation', () => {
    const v = eclipticNorthWorld(IDENTITY);
    expect(v[0]).toBeCloseTo(0, 12);
    expect(v[1]).toBeCloseTo(-Math.sin(OBLIQUITY), 12);
    expect(v[2]).toBeCloseTo(Math.cos(OBLIQUITY), 12);
    const quarterTurnAboutZ = [0, -1, 0, 1, 0, 0, 0, 0, 1];
    const r = eclipticNorthWorld(quarterTurnAboutZ);
    expect(r[0]).toBeCloseTo(Math.sin(OBLIQUITY), 12);
    expect(r[1]).toBeCloseTo(0, 12);
    expect(r[2]).toBeCloseTo(Math.cos(OBLIQUITY), 12);
    expect(Math.hypot(...r)).toBeCloseTo(1, 12);
  });
});

describe('AtmosParams layout', () => {
  it('sizes the block as 11 fixed rows plus two rows per lunar feature', () => {
    expect(FIXED_ROWS).toBe(11);
    expect(ATMOS_PARAM_BYTES).toBe((FIXED_ROWS + LUNAR_ROWS) * 16);
    expect(new AtmosUniforms().data.length).toBe((FIXED_ROWS + LUNAR_ROWS) * 4);
  });

  it('matches the WGSL struct field for field', () => {
    const source = new TextDecoder().decode(nodeFs.readFileSync(new URL('../shaders/sky/atmos_uniforms.wgsl', import.meta.url)));
    const body = source.slice(source.indexOf('struct AtmosParams'), source.indexOf('};', source.indexOf('struct AtmosParams')));
    const vec4Fields = [...body.matchAll(/^\s*(\w+)\s*:\s*vec4f\s*,/gm)].map((m) => m[1]);
    expect(vec4Fields).toEqual(['flags', 'sky2', 'cloudA', 'cloudB', 'wind', 'cloudC', 'cloudD', 'eclNorth', 'gal0', 'gal1', 'gal2']);
    expect(vec4Fields.length).toBe(FIXED_ROWS);
    expect(body).toMatch(/maria\s*:\s*array<vec4f,\s*\$\{MARIA_ROWS\}>/);
  });

  it('writes the constant tables once: galactic axes and the lunar features', () => {
    const d = new AtmosUniforms().data;
    const axes = galacticAxesEquatorial();
    for (let a = 0; a < 3; a++) for (let i = 0; i < 3; i++) expect(d[32 + a * 4 + i]).toBeCloseTo(axes[a][i], 6);
    LUNAR_FEATURES.forEach((f, k) => {
      const o = 44 + k * 8;
      expect(d[o]).toBeCloseTo(f.lonDeg * DEG, 6);
      expect(d[o + 1]).toBeCloseTo(f.latDeg * DEG, 6);
      expect(d[o + 2]).toBeCloseTo(f.radiusLonDeg * DEG, 6);
      expect(d[o + 3]).toBeCloseTo(f.radiusLatDeg * DEG, 6);
      expect(d[o + 4]).toBeCloseTo(f.strength, 6);
      expect(d[o + 7]).toBe(f.kind === 'mare' ? 0 : 1);
    });
  });

  it('writes the per-frame rows where the shaders read them', () => {
    const u = new AtmosUniforms();
    const d = u.write(inputs({ cloudCoverage: 0.6, cirrusCoverage: 0.2, cloudDensity: 2, nightSkyScale: 3, starBrightness: 1.5, twinkle: 0.25, milkyWayBrightness: 4 }));
    expect(d).toBe(u.data);
    expect(Array.from(d.slice(0, 4))).toEqual([1, 3, 1.5, 0.25]);
    expect(Array.from(d.slice(4, 8))).toEqual([4, 1, 1, 7.5]);
    expect(Array.from(d.slice(8, 12))).toEqual([0.6, 0.2, 2, 123.5].map((v) => Math.fround(v)));
    expect(Array.from(d.slice(12, 16))).toEqual([1.5, 4, 8, 10]);
    expect(Array.from(d.slice(20, 24))).toEqual([24, 5, 640, -320]);
    expect(Array.from(d.slice(24, 28)).map((v) => Math.fround(v))).toEqual([0.9, 1, 5, 8000].map((v) => Math.fround(v)));
  });

  it('turns feature switches into zeros and drifts the cirrus faster and rotated against the cumulus', () => {
    const u = new AtmosUniforms();
    const off = u.write(inputs({ cloudsEnabled: false, starsEnabled: false, milkyWayEnabled: false }, { moonScattering: false, historyValid: false }));
    expect(off[0]).toBe(0);
    expect(off[4]).toBe(0);
    expect(off[5]).toBe(0);
    expect(off[6]).toBe(0);
    expect(off[25]).toBe(0);
    const on = u.write(inputs({ windSpeed: 10, windDirectionDeg: 90 }, { timeSeconds: 10 }));
    expect(on[16]).toBeCloseTo(100, 3);
    expect(on[17]).toBeCloseTo(0, 3);
    expect(Math.hypot(on[18], on[19])).toBeCloseTo(180, 3);
    expect(on[18]).toBeCloseTo(180 * Math.sin(105 * DEG), 3);
    expect(on[31]).toBeCloseTo(105 * DEG, 6);
    expect(Math.hypot(on[28], on[29], on[30])).toBeCloseTo(1, 6);
  });

  it('carries the night-dome radiance in the free w lanes of the galactic rows and leaves the axes alone', () => {
    const u = new AtmosUniforms();
    const axes = galacticAxesEquatorial();
    const d = u.write(inputs({}, { nightDome: [1.5e-4, 1.4e-4, 1.3e-4] }));
    expect([d[35], d[39], d[43]].map((v) => Math.fround(v))).toEqual([1.5e-4, 1.4e-4, 1.3e-4].map((v) => Math.fround(v)));
    for (let a = 0; a < 3; a++) for (let i = 0; i < 3; i++) expect(d[32 + a * 4 + i]).toBeCloseTo(axes[a][i], 6);
    const none = u.write(inputs());
    expect([none[35], none[39], none[43]]).toEqual([0, 0, 0]);
  });
});

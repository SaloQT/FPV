import { describe, expect, it } from 'vitest';
import {
  CIRRUS_SIGMA_KM, CLOUD_SHADOW_EXTENT_M, CLOUD_SHADOW_SIZE, CUMULUS_SIGMA_KM, cirrusDensity, cirrusWeather, cloudAmbientScale, cloudField, cloudOpticalDepth,
  NIGHT_CUMULUS_SCALE, NIGHT_CUMULUS_SIN_HI, NIGHT_CUMULUS_SIN_LO, cloudVisibility, cumulusDensity, cumulusGradient, cumulusWeather, hash21, nightCumulusScale, pcg, presence,
  snapShadowCenter, u01,
} from './cloudModel';
import { DEFAULT_ATMOSPHERE_SETTINGS, type AtmosphereSettings } from './settings';
import { windOffset } from './uniforms';

const SLOW = 60000;

function settings(patch: Partial<AtmosphereSettings> = {}): AtmosphereSettings {
  return { ...DEFAULT_ATMOSPHERE_SETTINGS, ...patch };
}

/** Unit vectors at the given elevations (degrees) and a spread of azimuths. */
function rays(elevations: readonly number[], azimuths = 12): [number, number, number][] {
  const out: [number, number, number][] = [];
  for (const el of elevations) for (let k = 0; k < azimuths; k++) {
    const e = (el * Math.PI) / 180, a = (2 * Math.PI * k) / azimuths;
    out.push([Math.cos(e) * Math.sin(a), Math.sin(e), -Math.cos(e) * Math.cos(a)]);
  }
  return out;
}

const mean = (xs: readonly number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;

function meanVisibility(s: AtmosphereSettings, seed = 3, elevations: readonly number[] = [35, 60, 85]): number {
  const f = cloudField(s, seed, 0, 0);
  return mean(rays(elevations).map(([x, y, z]) => cloudVisibility(f, 0, 200, 0, x, y, z)));
}

describe('hashing', () => {
  it('reproduces the PCG hash reference values the WGSL uses', () => {
    expect(pcg(0)).toBe(129708002);
    expect(pcg(1)).toBe(2831084092);
    expect(pcg(2)).toBe(2055130248);
    expect(pcg(42)).toBe(1223963391);
    expect(pcg(12345)).toBe(4099845390);
    expect(pcg(0xffffffff)).toBe(3861530882);
  });

  it('turns hashes into 0..1 floats that never reach 1', () => {
    expect(u01(0)).toBe(0);
    expect(u01(0xffffffff)).toBeLessThan(1);
    expect(u01(0xffffffff)).toBeGreaterThan(0.999999);
    for (const v of [1, 77, 65535, 1 << 30]) {
      expect(u01(pcg(v))).toBeGreaterThanOrEqual(0);
      expect(u01(pcg(v))).toBeLessThan(1);
    }
  });

  it('gives lattice hashes with the moments of a uniform variable, wrapping negative coordinates', () => {
    const v: number[] = [];
    for (let y = -40; y < 40; y++) for (let x = -40; x < 40; x++) v.push(hash21(x, y));
    const m = mean(v), variance = mean(v.map((h) => (h - m) ** 2));
    expect(m).toBeGreaterThan(0.48);
    expect(m).toBeLessThan(0.52);
    expect(variance).toBeGreaterThan(1 / 12 - 0.01);
    expect(variance).toBeLessThan(1 / 12 + 0.01);
    expect(hash21(-3, 5)).toBe(hash21(-3, 5));
    expect(hash21(-3, 5)).not.toBe(hash21(3, 5));
    expect(hash21(2, 7)).not.toBe(hash21(7, 2));
  });
});

describe('cloud field', () => {
  it('follows the settings and puts the datum at the observer altitude', () => {
    const f = cloudField(settings({ cloudCoverage: 0.7, cirrusCoverage: 0.2, cloudDensity: 3 }), 1.5, 0, 1000);
    expect(f.cumulusCoverage).toBe(0.7);
    expect(f.cirrusCoverage).toBe(0.2);
    expect(f.density).toBe(3);
    expect(f.datumRadiusKm).toBeCloseTo(6361, 9);
    expect(f.seedX).toBeCloseTo(1.5 * 13.37, 9);
    expect(f.cumulusBaseKm).toBe(DEFAULT_ATMOSPHERE_SETTINGS.cumulusBaseKm);
  });

  it('is empty when the clouds are switched off and reuses the object it is given', () => {
    const off = cloudField(settings({ cloudsEnabled: false }), 1, 0, 0);
    expect(off.cumulusCoverage).toBe(0);
    expect(off.cirrusCoverage).toBe(0);
    const again = cloudField(settings(), 1, 0, 0, off);
    expect(again).toBe(off);
    expect(off.cumulusCoverage).toBe(DEFAULT_ATMOSPHERE_SETTINGS.cloudCoverage);
  });

  it('drifts the cirrus 1.8 times as fast as the cumulus and turned 15 degrees', () => {
    const f = cloudField(settings({ windSpeed: 10, windDirectionDeg: 90 }), 1, 20, 0);
    expect(f.cumulusDrift[0]).toBeCloseTo(200, 6);
    expect(f.cumulusDrift[1]).toBeCloseTo(0, 6);
    const expected = windOffset(18, 105, 20);
    expect(f.cirrusDrift[0]).toBeCloseTo(expected[0], 9);
    expect(f.cirrusDrift[1]).toBeCloseTo(expected[1], 9);
    expect(f.streakBearing).toBeCloseTo((105 * Math.PI) / 180, 12);
  });
});

describe('weather and presence', () => {
  it('keeps both weather maps inside 0..1', () => {
    for (let y = -30; y < 30; y += 1.7) for (let x = -30; x < 30; x += 1.3) {
      for (const w of [cumulusWeather(x, y), cirrusWeather(x, y)]) {
        expect(w).toBeGreaterThanOrEqual(0);
        expect(w).toBeLessThanOrEqual(1);
      }
    }
  });

  it('is a smooth step that rises with coverage and is half at the threshold', () => {
    for (const c of [0, 0.3, 0.5, 1]) expect(presence(0.8 - 0.62 * c, c)).toBeCloseTo(0.5, 12);
    expect(presence(0, 0.5)).toBe(0);
    expect(presence(1, 0.5)).toBe(1);
    for (const n of [0.3, 0.5, 0.7]) {
      let prev = -1;
      for (let c = 0; c <= 1.0001; c += 0.1) {
        const p = presence(n, c);
        expect(p).toBeGreaterThanOrEqual(prev);
        prev = p;
      }
    }
    expect(presence(0.6, 0)).toBe(0);
    expect(presence(0.4, 1)).toBe(1);
  });

  it('covers about the requested fraction of the plane', () => {
    for (const coverage of [0.2, 0.5, 0.8]) {
      let above = 0, n = 0;
      for (let y = -90; y < 90; y += 0.9) for (let x = -90; x < 90; x += 0.9) { if (presence(cumulusWeather(x, y), coverage) > 0.5) above++; n++; }
      expect(Math.abs(above / n - coverage)).toBeLessThan(0.15);
    }
  });
});

describe('density profiles', () => {
  it('ramps the height gradient up over the first tenth and down over the last 38 percent', () => {
    expect(cumulusGradient(0)).toBe(0);
    expect(cumulusGradient(1)).toBe(0);
    expect(cumulusGradient(0.1)).toBeCloseTo(1, 12);
    expect(cumulusGradient(0.62)).toBeCloseTo(1, 12);
    expect(cumulusGradient(0.05)).toBeGreaterThan(0);
    expect(cumulusGradient(0.05)).toBeLessThan(1);
    expect(cumulusGradient(0.8)).toBeGreaterThan(0);
    expect(cumulusGradient(0.8)).toBeLessThan(cumulusGradient(0.7));
  });

  it('is zero outside the layers and stays within 0..1 inside them', () => {
    const f = cloudField(settings({ cloudCoverage: 0.8, cirrusCoverage: 0.8 }), 5, 0, 0);
    expect(cumulusDensity(f, 3, 4, f.cumulusBaseKm - 0.01)).toBe(0);
    expect(cumulusDensity(f, 3, 4, f.cumulusTopKm + 0.01)).toBe(0);
    expect(cirrusDensity(f, 3, 4, f.cirrusBaseKm - 0.01)).toBe(0);
    expect(cirrusDensity(f, 3, 4, f.cirrusTopKm + 0.01)).toBe(0);
    let cumulusMax = 0, cirrusMax = 0, cumulusFilled = 0, cirrusFilled = 0, n = 0;
    for (let y = -20; y < 20; y += 0.7) for (let x = -20; x < 20; x += 0.7) {
      for (let k = 1; k < 8; k++) {
        const c = cumulusDensity(f, x, y, f.cumulusBaseKm + ((f.cumulusTopKm - f.cumulusBaseKm) * k) / 8);
        const r = cirrusDensity(f, x, y, f.cirrusBaseKm + ((f.cirrusTopKm - f.cirrusBaseKm) * k) / 8);
        expect(c).toBeGreaterThanOrEqual(0);
        expect(c).toBeLessThanOrEqual(1);
        expect(r).toBeGreaterThanOrEqual(0);
        expect(r).toBeLessThanOrEqual(1);
        cumulusMax = Math.max(cumulusMax, c); cirrusMax = Math.max(cirrusMax, r);
        if (c > 0) cumulusFilled++;
        if (r > 0) cirrusFilled++;
        n++;
      }
    }
    expect(cumulusMax).toBeGreaterThan(0.5);
    expect(cirrusMax).toBeGreaterThan(0.3);
    expect(cumulusFilled / n).toBeGreaterThan(0.05);
    expect(cumulusFilled / n).toBeLessThan(0.95);
    expect(cirrusFilled / n).toBeGreaterThan(0.02);
  }, SLOW);

  it('is far sparser at zero coverage than at the default one (the march skips a layer of exactly zero)', () => {
    const total = (coverage: number): number => {
      const f = cloudField(settings({ cloudCoverage: coverage }), 5, 0, 0);
      let sum = 0;
      for (let y = -20; y < 20; y += 1.1) for (let x = -20; x < 20; x += 1.1) sum += cumulusDensity(f, x, y, 2.5);
      return sum;
    };
    expect(total(DEFAULT_ATMOSPHERE_SETTINGS.cloudCoverage)).toBeGreaterThan(10 * total(0));
    expect(total(1)).toBeGreaterThan(total(DEFAULT_ATMOSPHERE_SETTINGS.cloudCoverage));
  });
});

describe('optical depth and direct-light visibility', () => {
  it('sees no cloud along rays at or below the horizontal, in a clear sky, or with the clouds off', () => {
    const f = cloudField(settings({ cloudCoverage: 1, cirrusCoverage: 1 }), 2, 0, 0);
    expect(cloudOpticalDepth(f, 0, 100, 0, 1, 0, 0)).toBe(0);
    expect(cloudOpticalDepth(f, 0, 100, 0, 0, -1, 0)).toBe(0);
    const clear = cloudField(settings({ cloudCoverage: 0, cirrusCoverage: 0 }), 2, 0, 0);
    expect(cloudOpticalDepth(clear, 0, 100, 0, 0, 1, 0)).toBe(0);
    expect(cloudVisibility(clear, 0, 100, 0, 0, 1, 0)).toBe(1);
    const off = cloudField(settings({ cloudsEnabled: false, cloudCoverage: 1 }), 2, 0, 0);
    expect(meanVisibility(settings({ cloudsEnabled: false, cloudCoverage: 1 }))).toBe(1);
    expect(cloudVisibility(off, 0, 100, 0, 0.3, 0.9, 0.1)).toBe(1);
  });

  it('is exp(-tau), inside 0..1, and finite for every ray', () => {
    const f = cloudField(settings({ cloudCoverage: 0.9, cirrusCoverage: 0.6 }), 4, 0, 0);
    for (const [x, y, z] of rays([5, 20, 45, 80, 90])) {
      const tau = cloudOpticalDepth(f, 10, 200, -30, x, y, z), v = cloudVisibility(f, 10, 200, -30, x, y, z);
      expect(Number.isFinite(tau)).toBe(true);
      expect(tau).toBeGreaterThanOrEqual(0);
      expect(v).toBeCloseTo(Math.exp(-tau), 12);
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThanOrEqual(1);
    }
  });

  it('is no more than the extinction times the thickness for a vertical ray, and grows toward the horizon', () => {
    const f = cloudField(settings({ cloudCoverage: 1, cirrusCoverage: 0 }), 2, 0, 0);
    const thickness = f.cumulusTopKm - f.cumulusBaseKm;
    let maxUp = 0;
    for (let k = 0; k < 40; k++) maxUp = Math.max(maxUp, cloudOpticalDepth(f, k * 260, 0, k * 130, 0, 1, 0));
    expect(maxUp).toBeLessThanOrEqual(CUMULUS_SIGMA_KM * thickness + 1e-6);
    expect(maxUp).toBeGreaterThan(3);
    const zenith = mean(rays([90], 1).map(([x, y, z]) => cloudOpticalDepth(f, 0, 0, 0, x, y, z)));
    const low = mean(rays([12], 24).map(([x, y, z]) => cloudOpticalDepth(f, 0, 0, 0, x, y, z)));
    expect(low).toBeGreaterThan(zenith);
  });

  it('blocks more of the light as the coverage and the density rise', () => {
    let prev = 1.0001;
    for (const coverage of [0, 0.25, 0.5, 0.75, 1]) {
      const v = meanVisibility(settings({ cloudCoverage: coverage, cirrusCoverage: 0 }));
      expect(v).toBeLessThanOrEqual(prev);
      prev = v;
    }
    expect(meanVisibility(settings({ cloudCoverage: 0, cirrusCoverage: 0 }))).toBe(1);
    expect(prev).toBeLessThan(0.5);
    expect(meanVisibility(settings({ cloudCoverage: 0.5, cirrusCoverage: 0, cloudDensity: 3 }))).toBeLessThan(meanVisibility(settings({ cloudCoverage: 0.5, cirrusCoverage: 0 })));
  });

  it('keeps a full cirrus sheet translucent (vertical depth below 0.9 x 2 km x 2/pi) where a cumulus deck is opaque', () => {
    const s = settings({ cloudCoverage: 0, cirrusCoverage: 1 });
    const f = cloudField(s, 3, 0, 0);
    const ceiling = CIRRUS_SIGMA_KM * (f.cirrusTopKm - f.cirrusBaseKm) * (2 / Math.PI);
    const zenith = cloudOpticalDepth(f, 0, 200, 0, 0, 1, 0);
    expect(zenith).toBeLessThanOrEqual(ceiling + 1e-3);
    expect(zenith).toBeGreaterThan(0.5 * ceiling);
    expect(meanVisibility(s)).toBeGreaterThan(0.05);
    expect(meanVisibility(s)).toBeGreaterThan(meanVisibility(settings({ cloudCoverage: 1, cirrusCoverage: 0 })));
  });

  it('is a pure function of the seed, and different seeds give different skies', () => {
    const a = settings({ cloudCoverage: 0.6 });
    expect(meanVisibility(a, 3)).toBe(meanVisibility(a, 3));
    expect(meanVisibility(a, 3)).not.toBe(meanVisibility(a, 4));
  });

  it('moves with the wind: a cloud drifted by D is what a camera displaced by -D sees at time zero', () => {
    const s = settings({ cloudCoverage: 0.7, cirrusCoverage: 0, windSpeed: 12, windDirectionDeg: 40 });
    const later = cloudField(s, 6, 90, 0), start = cloudField(s, 6, 0, 0);
    const [dx, dz] = later.cumulusDrift;
    expect(Math.hypot(dx, dz)).toBeCloseTo(1080, 6);
    for (const [x, y, z] of rays([30, 70], 6)) {
      expect(cloudOpticalDepth(later, 500, 100, -800, x, y, z)).toBeCloseTo(cloudOpticalDepth(start, 500 - dx, 100, -800 - dz, x, y, z), 9);
    }
  });
});

describe('sky light and shadow map', () => {
  it('leaves the sky light alone without clouds and lifts it toward 1.8 at full overcast', () => {
    expect(cloudAmbientScale(settings({ cloudsEnabled: false, cloudCoverage: 1 }))).toBe(1);
    expect(cloudAmbientScale(settings({ cloudCoverage: 0, cirrusCoverage: 0 }))).toBe(1);
    expect(cloudAmbientScale(settings({ cloudCoverage: 1, cirrusCoverage: 1 }))).toBeCloseTo(1.8, 12);
    let prev = 0;
    for (let c = 0; c <= 1.0001; c += 0.1) {
      const k = cloudAmbientScale(settings({ cloudCoverage: c, cirrusCoverage: 0 }));
      expect(k).toBeGreaterThanOrEqual(prev);
      expect(k).toBeLessThanOrEqual(1.8 + 1e-12);
      prev = k;
    }
    expect(cloudAmbientScale(settings({ cloudCoverage: 0, cirrusCoverage: 1 }))).toBeCloseTo(1 + 0.8 * 0.3 ** 1.5, 12);
    expect(cloudAmbientScale(settings({ cloudCoverage: 0.5, cirrusCoverage: 0 }))).toBeLessThan(1 + 0.8 * 0.5);
  });

  it('covers 8 km in 128 texels and snaps the map centre to whole texels', () => {
    expect(CLOUD_SHADOW_SIZE).toBe(128);
    expect(CLOUD_SHADOW_EXTENT_M).toBe(8000);
    const texel = CLOUD_SHADOW_EXTENT_M / CLOUD_SHADOW_SIZE;
    expect(texel).toBe(62.5);
    for (const x of [0, 10, 31.24, 31.26, 62.5, -47.1, 123456.7, -98765.4]) {
      const c = snapShadowCenter(x);
      expect(c / texel).toBeCloseTo(Math.round(c / texel), 9);
      expect(Math.abs(c - x)).toBeLessThanOrEqual(texel / 2 + 1e-9);
      expect(snapShadowCenter(c)).toBe(c);
    }
    expect(snapShadowCenter(31.24)).toBe(0);
    expect(snapShadowCenter(31.26)).toBe(62.5);
  });

  it('holds the centre still while the camera moves within a texel and honours other map sizes', () => {
    const base = snapShadowCenter(1000);
    for (let d = -20; d <= 20; d += 5) expect(snapShadowCenter(1000 + d)).toBe(base);
    expect(snapShadowCenter(100, 1000, 10)).toBe(100);
    expect(snapShadowCenter(149, 1000, 10)).toBe(100);
    expect(snapShadowCenter(151, 1000, 10)).toBe(200);
  });
});

describe('night cumulus', () => {
  it('keeps the whole daytime cover while the sun is up and a fixed fraction once it is well below the horizon', () => {
    expect(nightCumulusScale(1)).toBe(1);
    expect(nightCumulusScale(NIGHT_CUMULUS_SIN_HI)).toBe(1);
    expect(nightCumulusScale(NIGHT_CUMULUS_SIN_LO)).toBe(NIGHT_CUMULUS_SCALE);
    expect(nightCumulusScale(-1)).toBe(NIGHT_CUMULUS_SCALE);
    expect(NIGHT_CUMULUS_SCALE * DEFAULT_ATMOSPHERE_SETTINGS.cloudCoverage).toBeLessThan(0.25);
  });

  it('falls monotonically through twilight', () => {
    let prev = 1;
    for (let s = NIGHT_CUMULUS_SIN_HI; s >= NIGHT_CUMULUS_SIN_LO; s -= 0.01) {
      const k = nightCumulusScale(s);
      expect(k).toBeLessThanOrEqual(prev + 1e-12);
      prev = k;
    }
  });

  it('is mirrored by cloud_density.wgsl', () => {
    const nodeFs = (globalThis as unknown as { process: { getBuiltinModule(n: 'node:fs'): { readFileSync(u: URL): Uint8Array } } }).process.getBuiltinModule('node:fs');
    const text = new TextDecoder().decode(nodeFs.readFileSync(new URL('../shaders/sky/cloud_density.wgsl', import.meta.url)));
    const c = (name: string): number => Number(text.match(new RegExp(`const ${name}\\s*:\\s*f32\\s*=\\s*([^;]+);`))?.[1]);
    expect(c('NIGHT_CUMULUS_SCALE')).toBe(NIGHT_CUMULUS_SCALE);
    expect(c('NIGHT_CUMULUS_SIN_LO')).toBe(NIGHT_CUMULUS_SIN_LO);
    expect(c('NIGHT_CUMULUS_SIN_HI')).toBe(NIGHT_CUMULUS_SIN_HI);
  });
});

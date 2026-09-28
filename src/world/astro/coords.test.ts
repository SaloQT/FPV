import { describe, expect, it } from 'vitest';
import {
  eclipticToEquatorial, equatorialToWorld, equatorialToWorldDir, horizontalToWorld, localSiderealRad, precessionMatrix,
  refractionRad, worldToHorizontal,
} from './coords';
import { DEG, JD_J2000, julianCenturies, wrapTau } from './julian';
import { starDirectionEq } from './stars';

const HOURS = 15 * DEG;

function apply(M: number[], v: readonly number[]): [number, number, number] {
  return [
    M[0] * v[0] + M[1] * v[1] + M[2] * v[2],
    M[3] * v[0] + M[4] * v[1] + M[5] * v[2],
    M[6] * v[0] + M[7] * v[1] + M[8] * v[2],
  ];
}

const elevationDeg = (w: readonly number[]) => Math.asin(w[1]) / DEG;

describe('precession (IAU 1976)', () => {
  it('is the identity at J2000 and always a proper rotation', () => {
    const I = precessionMatrix(0);
    for (let i = 0; i < 9; i++) expect(I[i]).toBeCloseTo(i % 4 === 0 ? 1 : 0, 15);
    for (const T of [-1, 0.27, 1]) {
      const P = precessionMatrix(T);
      const det =
        P[0] * (P[4] * P[8] - P[5] * P[7]) - P[1] * (P[3] * P[8] - P[5] * P[6]) + P[2] * (P[3] * P[7] - P[4] * P[6]);
      expect(det).toBeCloseTo(1, 13);
      for (let r = 0; r < 3; r++) expect(Math.hypot(P[r * 3], P[r * 3 + 1], P[r * 3 + 2])).toBeCloseTo(1, 13);
    }
  });

  it('moves the J2000 equinox by 1.2816 deg of right ascension per century', () => {
    const P = precessionMatrix(1);
    expect(Math.atan2(P[3], P[0]) / DEG).toBeCloseTo(1.2816, 2);
  });

  it('Meeus ex. 21.b: theta Persei from J2000 to 2028 Nov 13.19 (proper motion already applied)', () => {
    const T = (2462088.69 - JD_J2000) / 36525;
    const ra0 = (2 + 44 / 60 + 12.975 / 3600) * HOURS;
    const dec0 = (49 + 13 / 60 + 39.9 / 3600) * DEG;
    const [x, y, z] = apply(precessionMatrix(T), starDirectionEq(ra0, dec0));
    expect(wrapTau(Math.atan2(y, x)) / HOURS).toBeCloseTo(2 + 46 / 60 + 11.331 / 3600, 5);
    expect(Math.asin(z) / DEG).toBeCloseTo(49 + 20 / 60 + 54.54 / 3600, 4);
  });
});

describe('ecliptic and horizontal conversions', () => {
  it('Meeus ex. 13.a: Pollux lambda 113.21563, beta 6.68417 -> RA 116.328942, Dec 28.026183', () => {
    const [ra, dec] = eclipticToEquatorial(113.21563 * DEG, 6.68417 * DEG, 23.4392911 * DEG);
    expect(ra / DEG).toBeCloseTo(116.328942, 4);
    expect(dec / DEG).toBeCloseTo(28.026183, 4);
  });

  it('wraps local sidereal time into [0, 2pi)', () => {
    expect(localSiderealRad(6, 1)).toBeCloseTo(7 - 2 * Math.PI, 12);
    expect(localSiderealRad(0.5, -1)).toBeCloseTo(2 * Math.PI - 0.5, 12);
  });

  it('places azimuth 0 at -Z (north), 90 at +X (east), 180 at +Z (south), and zenith at +Y', () => {
    const expectDir = (got: readonly number[], want: readonly number[]) => {
      for (let i = 0; i < 3; i++) expect(got[i]).toBeCloseTo(want[i], 12);
    };
    expectDir(horizontalToWorld(0, 0), [0, 0, -1]);
    expectDir(horizontalToWorld(Math.PI / 2, 0), [1, 0, 0]);
    expectDir(horizontalToWorld(Math.PI, 0), [0, 0, 1]);
    expectDir(horizontalToWorld(1, Math.PI / 2), [0, 1, 0]);
  });

  it('round-trips azimuth/elevation through world axes', () => {
    for (const [az, alt] of [[0.3, 0.2], [2.5, -0.7], [5.9, 1.2], [4.1, 0]]) {
      const [a, h] = worldToHorizontal(horizontalToWorld(az, alt));
      expect(a).toBeCloseTo(az, 12);
      expect(h).toBeCloseTo(alt, 12);
    }
  });
});

describe('equatorial to world axes', () => {
  const lat = 46 * DEG;

  it('a body on the meridian south of the zenith is due south (+Z), one north of the pole side due north (-Z)', () => {
    const south = equatorialToWorldDir(1, 20 * DEG, 1, lat);
    expect(south[0]).toBeCloseTo(0, 12);
    expect(south[2]).toBeGreaterThan(0);
    expect(elevationDeg(south)).toBeCloseTo(90 - 46 + 20, 9);
    const north = equatorialToWorldDir(1, 80 * DEG, 1, lat);
    expect(north[0]).toBeCloseTo(0, 12);
    expect(north[2]).toBeLessThan(0);
    expect(elevationDeg(north)).toBeCloseTo(90 - (80 - 46), 9);
  });

  it('bodies east of the meridian (not yet transited) have +X, west have -X', () => {
    expect(equatorialToWorldDir(1 + 0.5, 0, 1, lat)[0]).toBeGreaterThan(0.3);
    expect(equatorialToWorldDir(1 - 0.5, 0, 1, lat)[0]).toBeLessThan(-0.3);
  });

  it('a body on the celestial equator rises due east and sets due west', () => {
    const rise = equatorialToWorldDir(0, 0, -Math.PI / 2, lat);
    expect(rise[1]).toBeCloseTo(0, 12);
    expect(rise[0]).toBeCloseTo(1, 12);
    const set = equatorialToWorldDir(0, 0, Math.PI / 2, lat);
    expect(set[1]).toBeCloseTo(0, 12);
    expect(set[0]).toBeCloseTo(-1, 12);
  });

  it('at the north pole the J2000 celestial pole is straight up (+Y) at J2000, and 0.145 deg off in 2026', () => {
    const M0 = equatorialToWorld(0, 2.2, 90 * DEG);
    const up = apply(M0, [0, 0, 1]);
    expect(up[1]).toBeCloseTo(1, 12);
    const T = julianCenturies(2461222.5);
    const tilted = apply(equatorialToWorld(T, 2.2, 90 * DEG), [0, 0, 1]);
    expect(elevationDeg(tilted)).toBeCloseTo(90 - (2004.3109 * T) / 3600, 2);
  });

  it('is orthonormal with determinant +1 and consistent with precess-then-rotate', () => {
    const T = 0.26, lst = 4.4;
    const M = equatorialToWorld(T, lst, lat);
    const det = M[0] * (M[4] * M[8] - M[5] * M[7]) - M[1] * (M[3] * M[8] - M[5] * M[6]) + M[2] * (M[3] * M[7] - M[4] * M[6]);
    expect(det).toBeCloseTo(1, 12);
    const v = starDirectionEq(1.7, -0.4);
    const d = apply(precessionMatrix(T), v);
    const viaDate = equatorialToWorldDir(wrapTau(Math.atan2(d[1], d[0])), Math.asin(d[2]), lst, lat);
    const direct = apply(M, v);
    for (let i = 0; i < 3; i++) expect(direct[i]).toBeCloseTo(viaDate[i], 12);
  });

  it('Polaris stays 45.3..46.7 deg high at latitude 46 over a sidereal day, peaking on the meridian', () => {
    const T = julianCenturies(2461222.5);
    const ra = (2 + 31 / 60 + 49.09 / 3600) * HOURS, dec = (89 + 15 / 60 + 50.8 / 3600) * DEG;
    const polaris = starDirectionEq(ra, dec);
    let lo = 90, hi = 0;
    for (let lst = 0; lst < 2 * Math.PI; lst += 0.01) {
      const h = elevationDeg(apply(equatorialToWorld(T, lst, lat), polaris));
      lo = Math.min(lo, h);
      hi = Math.max(hi, h);
    }
    expect(hi).toBeGreaterThan(46.55);
    expect(hi).toBeLessThan(46.75);
    expect(lo).toBeGreaterThan(45.25);
    expect(lo).toBeLessThan(45.45);
    const w = apply(equatorialToWorld(0, ra, lat), polaris);
    expect(elevationDeg(w)).toBeCloseTo(46 + (90 - 89.264), 1);
    expect(w[2]).toBeLessThan(0);
  });

  it('Polaris is always within 1 deg of due north at latitude 46', () => {
    const polaris = starDirectionEq(0.66, 89.26 * DEG);
    for (let lst = 0; lst < 6.3; lst += 0.3) {
      const [az] = worldToHorizontal(apply(equatorialToWorld(0, lst, lat), polaris));
      const off = Math.min(az, 2 * Math.PI - az) / DEG;
      expect(off).toBeLessThan(1.5);
    }
  });
});

describe('atmospheric refraction (Saemundsson)', () => {
  it('is 29 arcmin at the geometric horizon, 1.0 arcmin at 45 deg and vanishes at the zenith', () => {
    expect((refractionRad(0) / DEG) * 60).toBeCloseTo(28.98, 1);
    expect((refractionRad(45 * DEG) / DEG) * 60).toBeCloseTo(1.013, 2);
    expect(refractionRad(90 * DEG)).toBeLessThan(1e-9);
  });

  it('decreases with elevation, is continuous at -1 deg and zero below -5 deg', () => {
    let prev = Infinity;
    for (let h = -6; h <= 90; h += 0.5) {
      const r = refractionRad(h * DEG);
      expect(r).toBeGreaterThanOrEqual(0);
      if (h > -1) expect(r).toBeLessThan(prev + 1e-12);
      if (h > -1) prev = r;
    }
    expect(Math.abs(refractionRad(-1.0001 * DEG) - refractionRad(-0.9999 * DEG))).toBeLessThan(1e-5);
    expect(refractionRad(-5 * DEG)).toBe(0);
    expect(refractionRad(-30 * DEG)).toBe(0);
  });
});

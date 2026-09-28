import { describe, expect, it } from 'vitest';
import {
  ARCSEC, DEG, decimalYear, deltaT, gastRad, gmstRad, jdTTFromUT, julianCenturies, julianDateFromMs, meanObliquity,
  msFromJulianDate, nutation, wrapPi, wrapTau,
} from './julian';

const HOURS = 15 * DEG;

describe('julian dates', () => {
  it('maps the Unix epoch and J2000', () => {
    expect(julianDateFromMs(0)).toBeCloseTo(2440587.5, 9);
    expect(julianDateFromMs(Date.UTC(2000, 0, 1, 12))).toBeCloseTo(2451545.0, 9);
  });

  it('matches Meeus ex. 7.a (1987 April 10 19h21m UT) and round-trips', () => {
    const ms = Date.UTC(1987, 3, 10, 19, 21, 0);
    expect(julianDateFromMs(ms)).toBeCloseTo(2446896.30625, 6);
    expect(msFromJulianDate(julianDateFromMs(ms))).toBeCloseTo(ms, 0);
  });

  it('computes Julian centuries and wraps angles', () => {
    expect(julianCenturies(2451545.0 + 36525)).toBeCloseTo(1, 12);
    expect(wrapTau(-0.5)).toBeCloseTo(2 * Math.PI - 0.5, 12);
    expect(wrapPi(3 * Math.PI / 2)).toBeCloseTo(-Math.PI / 2, 12);
  });
});

describe('sidereal time', () => {
  it('GMST at J2000.0 is 18h 41m 50.548s', () => {
    expect(gmstRad(2451545.0) / HOURS).toBeCloseTo(18 + 41 / 60 + 50.548 / 3600, 6);
  });

  it('Meeus ex. 12.a: 1987 April 10 0h UT = 13h10m46.3668s', () => {
    expect(gmstRad(2446895.5) / HOURS).toBeCloseTo(13 + 10 / 60 + 46.3668 / 3600, 7);
  });

  it('Meeus ex. 12.b: 1987 April 10 19h21m UT = 8h34m57.0896s', () => {
    const jd = julianDateFromMs(Date.UTC(1987, 3, 10, 19, 21, 0));
    expect(gmstRad(jd) / HOURS).toBeCloseTo(8 + 34 / 60 + 57.0896 / 3600, 7);
  });
});

describe('Delta-T', () => {
  it('follows the Espenak-Meeus expressions at reference years', () => {
    expect(deltaT(1900)).toBeCloseTo(-2.79, 2);
    expect(deltaT(1950)).toBeCloseTo(29.07, 2);
    expect(deltaT(2000)).toBeCloseTo(63.86, 2);
    expect(deltaT(2026)).toBeGreaterThan(68);
    expect(deltaT(2026)).toBeLessThan(80);
  });

  it('is continuous across the polynomial boundaries within 0.6 s', () => {
    for (const y of [-500, 500, 1600, 1700, 1800, 1860, 1900, 1920, 1941, 1961, 1986, 2005, 2050, 2150]) {
      expect(Math.abs(deltaT(y + 1e-6) - deltaT(y - 1e-6))).toBeLessThan(0.6);
    }
  });

  it('converts UT to TT by adding Delta-T', () => {
    const jd = 2451545.0;
    expect((jdTTFromUT(jd) - jd) * 86400).toBeCloseTo(deltaT(decimalYear(jd)), 4);
  });
});

describe('obliquity and nutation', () => {
  const T = julianCenturies(2446895.5);

  it('Meeus ex. 22.a: mean obliquity 23 26 27.407 and nutation -3.788", +9.443"', () => {
    expect(meanObliquity(T) / ARCSEC).toBeCloseTo(23 * 3600 + 26 * 60 + 27.407, 2);
    const [dpsi, deps] = nutation(T);
    expect(dpsi / ARCSEC).toBeCloseTo(-3.788, 1);
    expect(deps / ARCSEC).toBeCloseTo(9.443, 1);
  });

  it('nutation in longitude stays within +-20" and is written into the supplied buffer', () => {
    const out: [number, number] = [0, 0];
    for (let c = -2; c <= 2; c += 0.05) {
      const r = nutation(c, out);
      expect(r).toBe(out);
      expect(Math.abs(out[0]) / ARCSEC).toBeLessThan(20);
      expect(Math.abs(out[1]) / ARCSEC).toBeLessThan(11);
    }
  });

  it('apparent sidereal time differs from mean by the equation of the equinoxes (~ -0.17 s in 1987)', () => {
    const [dpsi, deps] = nutation(T);
    const eps = meanObliquity(T) + deps;
    const diffSeconds = ((gastRad(2446895.5, dpsi, eps) - gmstRad(2446895.5)) / HOURS) * 3600;
    expect(diffSeconds).toBeCloseTo(-0.2317, 2);
  });
});

import { describe, expect, it } from 'vitest';
import { DEG, jdTTFromUT, julianCenturies, julianDateFromMs, meanObliquity } from './julian';
import { planetPositions, planetRaDecOfDate } from './planets';
import { sunPosition } from './sun';

const HOURS = 15 * DEG;

function at(y: number, mo: number, d: number, h = 0, mi = 0) {
  const jd = jdTTFromUT(julianDateFromMs(Date.UTC(y, mo - 1, d, h, mi)));
  return { jd, planets: planetPositions(jd) };
}

function planet(list: ReturnType<typeof planetPositions>, name: string) {
  const p = list.find((q) => q.name === name);
  if (!p) throw new Error(name);
  return p;
}

/** Geocentric ecliptic longitude of date minus the Sun's, wrapped to [-180, 180) degrees; opposition is +-180. */
function longitudeFromSunDeg(p: ReturnType<typeof planetPositions>[number], jd: number): number {
  const [ra, dec] = planetRaDecOfDate(p, jd);
  const eps = meanObliquity(julianCenturies(jd));
  const lon = Math.atan2(Math.sin(ra) * Math.cos(eps) + Math.tan(dec) * Math.sin(eps), Math.cos(ra));
  return ((((lon - sunPosition(jd).eclipticLongitudeRad) / DEG) % 360) + 540) % 360 - 180;
}

describe('planets', () => {
  it('returns the five naked-eye planets with tints and unit directions', () => {
    const { planets } = at(2026, 6, 21);
    expect(planets.map((p) => p.name)).toEqual(['Mercury', 'Venus', 'Mars', 'Jupiter', 'Saturn']);
    for (const p of planets) {
      expect(Math.hypot(...p.dirJ2000)).toBeCloseTo(1, 12);
      expect(p.color.every((c) => c > 0 && c <= 1)).toBe(true);
    }
    const mars = planet(planets, 'Mars').color;
    expect(mars[0]).toBeGreaterThan(mars[1] * 2);
  });

  it('Meeus ex. 33.a: Venus on 1992 Dec 20 0h TD, RA 21h04m41.5s Dec -18d53m17s', () => {
    const jd = 2448976.5;
    const venus = planet(planetPositions(jd), 'Venus');
    const [ra, dec] = planetRaDecOfDate(venus, jd);
    expect(Math.abs(ra - (21 + 4 / 60 + 41.454 / 3600) * HOURS) / DEG).toBeLessThan(0.05);
    expect(Math.abs(dec - -(18 + 53 / 60 + 16.84 / 3600) * DEG) / DEG).toBeLessThan(0.05);
    expect(venus.distanceAu).toBeCloseTo(0.910845, 2);
  });

  it('Mars is at opposition on 2025-01-16: ecliptic longitude 180 from the Sun, 0.64 AU, magnitude ~ -1.4', () => {
    const { jd, planets } = at(2025, 1, 16, 6);
    const mars = planet(planets, 'Mars');
    expect(Math.abs(Math.abs(longitudeFromSunDeg(mars, jd)) - 180)).toBeLessThan(1);
    expect(mars.distanceAu).toBeCloseTo(0.6423, 2);
    expect(mars.magnitude).toBeGreaterThan(-1.6);
    expect(mars.magnitude).toBeLessThan(-1.2);
  });

  it('Jupiter is at opposition on 2026-01-10: ~4.2 AU, magnitude ~ -2.7', () => {
    const { jd, planets } = at(2026, 1, 10, 12);
    const jup = planet(planets, 'Jupiter');
    expect(Math.abs(Math.abs(longitudeFromSunDeg(jup, jd)) - 180)).toBeLessThan(1);
    expect(jup.distanceAu).toBeGreaterThan(4.1);
    expect(jup.distanceAu).toBeLessThan(4.3);
    expect(jup.magnitude).toBeGreaterThan(-2.9);
    expect(jup.magnitude).toBeLessThan(-2.5);
  });

  it('Saturn is at opposition on 2025-09-21: ~8.5 AU, nearly edge-on rings', () => {
    const { jd, planets } = at(2025, 9, 21, 12);
    const sat = planet(planets, 'Saturn');
    expect(Math.abs(Math.abs(longitudeFromSunDeg(sat, jd)) - 180)).toBeLessThan(1);
    expect(sat.distanceAu).toBeGreaterThan(8.4);
    expect(sat.distanceAu).toBeLessThan(8.7);
    expect(sat.magnitude).toBeGreaterThan(0.2);
    expect(sat.magnitude).toBeLessThan(1.3);
  });

  it('Venus reaches greatest eastern elongation ~47 deg on 2025-01-10, bright and half-lit', () => {
    const venus = planet(at(2025, 1, 10, 12).planets, 'Venus');
    expect(venus.elongationRad / DEG).toBeGreaterThan(46.5);
    expect(venus.elongationRad / DEG).toBeLessThan(47.6);
    expect(venus.magnitude).toBeGreaterThan(-4.6);
    expect(venus.magnitude).toBeLessThan(-3.9);
    expect(venus.phaseAngleRad / DEG).toBeGreaterThan(85);
    expect(venus.phaseAngleRad / DEG).toBeLessThan(100);
  });

  it('Mercury never strays beyond 28.5 deg from the Sun over a year', () => {
    let max = 0;
    for (let d = 0; d < 366; d += 2) {
      const m = planet(at(2026, 1, 1 + d).planets, 'Mercury');
      max = Math.max(max, m.elongationRad / DEG);
    }
    expect(max).toBeGreaterThan(20);
    expect(max).toBeLessThan(28.5);
  });
});

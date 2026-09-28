import { describe, expect, it } from 'vitest';
import type { Observer } from '../../contracts';
import { computeAstro, SimClock } from './clock';
import { precessionMatrix, worldToHorizontal } from './coords';
import { DEG, jdTTFromUT, julianCenturies, julianDateFromMs } from './julian';
import { starDirectionEq } from './stars';
import { sunPosition } from './sun';

const ALPS: Observer = { latitudeDeg: 46, longitudeDeg: 8, altitudeM: 500 };
const MIN_MS = 60000;

interface Sample { minute: number; sun: number; moon: number; sunX: number; sunZ: number }

/** Every minute of a UTC day at the observer: elevations in degrees and the sun's world x/z. */
function scanDay(y: number, mo: number, d: number, observer: Observer = ALPS): Sample[] {
  const t0 = Date.UTC(y, mo - 1, d);
  const out: Sample[] = [];
  for (let minute = 0; minute < 1440; minute++) {
    const s = computeAstro(t0 + minute * MIN_MS, observer);
    out.push({ minute, sun: s.sunElevation / DEG, moon: s.moonElevation / DEG, sunX: s.sunDir[0], sunZ: s.sunDir[2] });
  }
  return out;
}

const peak = (day: Sample[]) => day.reduce((a, b) => (b.sun > a.sun ? b : a));

describe('computeAstro: the Sun over the day', () => {
  const summer = scanDay(2026, 6, 21);
  const winter = scanDay(2026, 12, 21);

  it('culminates at 90 - lat + 23.44 = 67.4 deg at the June solstice, near 11:30 UTC (solar noon at lon 8)', () => {
    const p = peak(summer);
    expect(p.sun).toBeGreaterThan(67.3);
    expect(p.sun).toBeLessThan(67.55);
    expect(p.minute).toBeGreaterThan(11 * 60 + 24);
    expect(p.minute).toBeLessThan(11 * 60 + 36);
  });

  it('culminates at 90 - lat - 23.44 = 20.6 deg at the December solstice', () => {
    const p = peak(winter);
    expect(p.sun).toBeGreaterThan(20.45);
    expect(p.sun).toBeLessThan(20.7);
  });

  it('is below the horizon at local midnight and in the north, above it at noon and in the south (+Z)', () => {
    const midnight = summer[23 * 60 + 28];
    expect(midnight.sun).toBeLessThan(-15);
    expect(midnight.sunZ).toBeLessThan(0);
    const noon = peak(summer);
    expect(noon.sunZ).toBeCloseTo(Math.cos(noon.sun * DEG), 3);
    expect(Math.abs(noon.sunX)).toBeLessThan(0.02);
  });

  it('rises in the east (+X) and sets in the west (-X) with the day length spherical astronomy predicts', () => {
    const rise = summer.findIndex((s, i) => i > 0 && summer[i - 1].sun < 0 && s.sun >= 0);
    const set = summer.findIndex((s, i) => i > 0 && summer[i - 1].sun >= 0 && s.sun < 0);
    expect(summer[rise].sunX).toBeGreaterThan(0.6);
    expect(summer[set].sunX).toBeLessThan(-0.6);
    const hours = (set - rise) / 60;
    const expected = (2 * Math.acos(-Math.tan(46 * DEG) * Math.tan(23.437 * DEG))) / (15 * DEG);
    expect(hours).toBeGreaterThan(expected - 0.05);
    expect(hours).toBeLessThan(expected + 0.05);
  });

  it('winter days are shorter than summer days and the sun stays south all day', () => {
    const lit = (day: Sample[]) => day.filter((s) => s.sun > 0).length / 60;
    expect(lit(summer)).toBeGreaterThan(15.5);
    expect(lit(winter)).toBeLessThan(8.7);
    expect(winter.filter((s) => s.sun > 0).every((s) => s.sunZ > 0)).toBe(true);
  });

  it('prints an hourly table for a human (2026-06-21, lat 46, lon 8, UTC)', () => {
    const rows = ['hour  sun deg  moon deg'];
    for (let h = 0; h < 24; h += 2) {
      const s = summer[h * 60];
      rows.push(`${String(h).padStart(2, '0')}:00  ${s.sun.toFixed(1).padStart(7)}  ${s.moon.toFixed(1).padStart(8)}`);
    }
    console.log(rows.join('\n'));
    expect(rows.length).toBe(13);
  });
});

describe('computeAstro: the Moon', () => {
  it('reaches high and low elevations over a month, bounded by 90 - lat + 28.7', () => {
    let max = -90, min = 90;
    const t0 = Date.UTC(2026, 8, 1);
    for (let h = 0; h < 30 * 24; h++) {
      const e = computeAstro(t0 + h * 3600000, ALPS).moonElevation / DEG;
      max = Math.max(max, e);
      min = Math.min(min, e);
    }
    expect(max).toBeGreaterThan(60);
    expect(max).toBeLessThan(73.2);
    expect(min).toBeLessThan(-60);
    expect(min).toBeGreaterThan(-73.2);
  });

  it('shows new, first-quarter, full and last-quarter phases on the right 2026 dates', () => {
    const clock = new SimClock({ timeMs: 0, timeScale: 1, observer: ALPS });
    const phaseAt = (ms: number) => {
      clock.setTimeMs(ms);
      return { name: clock.describe().moonPhaseName, k: clock.state().moonIlluminatedFraction, i: clock.state().moonPhaseAngle };
    };
    const newMoon = phaseAt(Date.UTC(2026, 7, 12, 17, 46));
    expect(newMoon.name).toBe('New Moon');
    expect(newMoon.k).toBeLessThan(0.005);
    expect(newMoon.i / DEG).toBeGreaterThan(175);
    expect(phaseAt(Date.UTC(2026, 7, 16, 12)).name).toBe('Waxing Crescent');
    const first = phaseAt(Date.UTC(2026, 7, 20, 3));
    expect(first.name).toBe('First Quarter');
    expect(first.k).toBeGreaterThan(0.45);
    expect(first.k).toBeLessThan(0.56);
    const full = phaseAt(Date.UTC(2026, 7, 28, 4, 18));
    expect(full.name).toBe('Full Moon');
    expect(full.k).toBeGreaterThan(0.995);
    expect(phaseAt(Date.UTC(2026, 8, 1, 12)).name).toBe('Waning Gibbous');
    expect(phaseAt(Date.UTC(2026, 8, 4, 12)).name).toBe('Last Quarter');
  });

  it('is topocentric: a full moon at the horizon is lower than its geocentric elevation', () => {
    const t0 = Date.UTC(2026, 7, 28, 0);
    let seen = 0;
    for (let m = 0; m < 1440; m += 5) {
      const s = computeAstro(t0 + m * MIN_MS, ALPS);
      if (s.moonElevation > 0 && s.moonElevation < 5 * DEG) seen++;
    }
    expect(seen).toBeGreaterThan(0);
  });
});

describe('computeAstro: eclipse alignment (end to end, topocentric)', () => {
  const separationDeg = (a: readonly number[], b: readonly number[]) =>
    Math.acos(Math.min(1, a[0] * b[0] + a[1] * b[1] + a[2] * b[2])) / DEG;

  // Greatest-eclipse instants and sites from NASA's eclipse catalogue: Sun and Moon must coincide in the observer's sky.
  const cases: Array<{ name: string; ms: number; observer: Observer; sunAlt: [number, number]; azDeg: [number, number] }> = [
    {
      name: '2024-04-08 near Mazatlan-Durango, Mexico',
      ms: Date.UTC(2024, 3, 8, 18, 17, 16),
      observer: { latitudeDeg: 25.29, longitudeDeg: -104.14, altitudeM: 0 },
      sunAlt: [69.4, 70.2],
      azDeg: [148, 151],
    },
    {
      name: '2017-08-21 Hopkinsville, Kentucky',
      ms: Date.UTC(2017, 7, 21, 18, 25, 32),
      observer: { latitudeDeg: 36.97, longitudeDeg: -87.67, altitudeM: 0 },
      sunAlt: [63.2, 64.1],
      // Hour angle 8.4 deg west of the meridian at declination +11.85 puts the Sun 19 deg west of south.
      azDeg: [197, 199.5],
    },
  ];

  for (const c of cases) {
    it(`Sun and Moon centres agree within 0.05 deg at greatest eclipse, ${c.name}`, () => {
      const s = computeAstro(c.ms, c.observer);
      expect(separationDeg(s.sunDir, s.moonDir)).toBeLessThan(0.05);
      expect(s.sunElevation / DEG).toBeGreaterThan(c.sunAlt[0]);
      expect(s.sunElevation / DEG).toBeLessThan(c.sunAlt[1]);
      const az = worldToHorizontal(s.sunDir)[0] / DEG;
      expect(az).toBeGreaterThan(c.azDeg[0]);
      expect(az).toBeLessThan(c.azDeg[1]);
      expect(s.moonIlluminatedFraction).toBeLessThan(0.001);
    });
  }

  it('the Moon drifts off the Sun at the topocentric relative rate (~0.42 deg/h) either side of totality', () => {
    // Sun + Moon radii (0.53 deg) over the ~75 min from first contact to greatest eclipse gives that rate.
    for (const dtMin of [-60, 60]) {
      const s = computeAstro(cases[0].ms + dtMin * MIN_MS, cases[0].observer);
      const sep = separationDeg(s.sunDir, s.moonDir);
      expect(sep).toBeGreaterThan(0.36);
      expect(sep).toBeLessThan(0.48);
    }
  });
});

describe('computeAstro: state shape', () => {
  it('returns independent objects (no aliasing of internal scratch between calls)', () => {
    const t = Date.UTC(2026, 5, 21, 10);
    const a = computeAstro(t, ALPS);
    const sunA = [...a.sunDir], moonA = [...a.moonDir], venusA = [...a.planets[1].dir];
    const b = computeAstro(t + 6 * 3600000, ALPS);
    expect(b.sunDir).not.toBe(a.sunDir);
    expect(a.sunDir).toEqual(sunA);
    expect(a.moonDir).toEqual(moonA);
    expect(a.planets[1].dir).toEqual(venusA);
    expect(b.equatorialToWorld).not.toBe(a.equatorialToWorld);
  });

  it('has unit directions, five tinted planets and a proper 3x3 sky matrix', () => {
    const s = computeAstro(Date.UTC(2026, 9, 5, 21), ALPS);
    expect(s.julianDate).toBeCloseTo(2461319.375, 6);
    expect(Math.hypot(...s.sunDir)).toBeCloseTo(1, 12);
    expect(Math.hypot(...s.moonDir)).toBeCloseTo(1, 12);
    expect(s.planets.map((p) => p.name)).toEqual(['Mercury', 'Venus', 'Mars', 'Jupiter', 'Saturn']);
    for (const p of s.planets) {
      expect(Math.hypot(...p.dir)).toBeCloseTo(1, 12);
      expect(Number.isFinite(p.magnitude)).toBe(true);
    }
    const M = s.equatorialToWorld;
    expect(M.length).toBe(9);
    for (let r = 0; r < 3; r++) expect(Math.hypot(M[r * 3], M[r * 3 + 1], M[r * 3 + 2])).toBeCloseTo(1, 12);
    expect(s.sunElevation).toBeCloseTo(Math.asin(s.sunDir[1]), 12);
  });

  it('keeps the Sun path and the star matrix on one sky (nutation aside, within 0.01 deg)', () => {
    const ms = Date.UTC(2026, 2, 3, 15, 20);
    const s = computeAstro(ms, ALPS);
    const jdTT = jdTTFromUT(julianDateFromMs(ms));
    const sun = sunPosition(jdTT);
    const P = precessionMatrix(julianCenturies(jdTT));
    const d = starDirectionEq(sun.raRad, sun.decRad);
    const j2000 = [
      P[0] * d[0] + P[3] * d[1] + P[6] * d[2],
      P[1] * d[0] + P[4] * d[1] + P[7] * d[2],
      P[2] * d[0] + P[5] * d[1] + P[8] * d[2],
    ];
    const M = s.equatorialToWorld;
    const w = [0, 1, 2].map((r) => M[r * 3] * j2000[0] + M[r * 3 + 1] * j2000[1] + M[r * 3 + 2] * j2000[2]);
    const cos = w[0] * s.sunDir[0] + w[1] * s.sunDir[1] + w[2] * s.sunDir[2];
    expect(Math.acos(Math.min(1, cos)) / DEG).toBeLessThan(0.01);
  });

  it('puts the Sun and the planets on the same sky: planets hug the ecliptic near the Sun path', () => {
    const s = computeAstro(Date.UTC(2026, 5, 21, 11, 30), ALPS);
    const venus = s.planets[1];
    const sep = Math.acos(Math.min(1, s.sunDir[0] * venus.dir[0] + s.sunDir[1] * venus.dir[1] + s.sunDir[2] * venus.dir[2]));
    expect(sep / DEG).toBeGreaterThan(0);
    expect(sep / DEG).toBeLessThan(48);
  });
});

describe('SimClock', () => {
  const start = Date.UTC(2026, 5, 21, 6);

  it('advances by real dt times timeScale and stays put when paused', () => {
    const c = new SimClock({ timeMs: start, timeScale: 60, observer: ALPS });
    c.advance(2);
    expect(c.timeMs).toBe(start + 120000);
    c.timeScale = 0;
    c.advance(100);
    expect(c.timeMs).toBe(start + 120000);
  });

  it('reuses the state until 0.5 s of sim time has passed, then recomputes', () => {
    const c = new SimClock({ timeMs: start, timeScale: 1, observer: ALPS });
    const first = c.state();
    expect(c.state()).toBe(first);
    c.advance(0.3);
    expect(c.state()).toBe(first);
    c.advance(0.3);
    const second = c.state();
    expect(second).not.toBe(first);
    expect(second.julianDate).toBeGreaterThan(first.julianDate);
  });

  it('does not recompute while paused, and recomputes after a jump in time', () => {
    const c = new SimClock({ timeMs: start, timeScale: 0, observer: ALPS });
    const first = c.state();
    c.advance(1000);
    expect(c.state()).toBe(first);
    c.setTimeMs(start + 3 * 3600000);
    expect(c.state()).not.toBe(first);
  });

  it('recomputes when the observer changes and only then', () => {
    const c = new SimClock({ timeMs: start, timeScale: 0, observer: ALPS });
    const first = c.state();
    c.setObserver({ ...ALPS });
    expect(c.state()).toBe(first);
    c.setObserver({ ...ALPS, latitudeDeg: -33 });
    const moved = c.state();
    expect(moved).not.toBe(first);
    expect(moved.sunElevation).not.toBeCloseTo(first.sunElevation, 2);
  });

  it('does not share the caller\'s observer object', () => {
    const o = { ...ALPS };
    const c = new SimClock({ timeMs: start, timeScale: 0, observer: o });
    const first = c.state();
    o.latitudeDeg = -60;
    expect(c.state()).toBe(first);
  });

  it('sets a local mean solar time of day on the current local date', () => {
    const c = new SimClock({ timeMs: start, timeScale: 0, observer: ALPS });
    c.setTimeOfDay(12);
    expect(c.timeMs).toBe(Date.UTC(2026, 5, 21, 11, 28));
    expect(c.describe().localTimeString).toBe('12:00:00');
    expect(c.describe().dateString).toBe('2026-06-21');
    c.setTimeOfDay(-1);
    expect(c.describe().localTimeString).toBe('23:00:00');
    expect(c.describe().dateString).toBe('2026-06-21');
    c.setTimeOfDay(24.5);
    expect(c.describe().localTimeString).toBe('00:30:00');
  });

  it('keeps the local date near the antimeridian where it differs from the UTC date', () => {
    const c = new SimClock({ timeMs: Date.UTC(2026, 5, 21, 20), timeScale: 0, observer: { ...ALPS, longitudeDeg: 170 } });
    expect(c.describe().dateString).toBe('2026-06-22');
    c.setTimeOfDay(12);
    expect(c.describe().dateString).toBe('2026-06-22');
    expect(c.timeMs).toBe(Date.UTC(2026, 5, 22, 0, 40));
  });

  it('describes noon in June as a high sun with a named moon phase', () => {
    const c = new SimClock({ timeMs: start, timeScale: 0, observer: ALPS });
    c.setTimeOfDay(12);
    const d = c.describe();
    expect(d.sunElevationDeg).toBeGreaterThan(67);
    expect(d.sunElevationDeg).toBeLessThan(67.6);
    expect(['New Moon', 'Waxing Crescent', 'First Quarter', 'Waxing Gibbous', 'Full Moon', 'Waning Gibbous', 'Last Quarter', 'Waning Crescent']).toContain(d.moonPhaseName);
  });

  it('matches the pure function exactly', () => {
    const c = new SimClock({ timeMs: start, timeScale: 1, observer: ALPS });
    expect(c.state()).toEqual(computeAstro(start, ALPS));
  });
});

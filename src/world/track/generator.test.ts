import { beforeAll, describe, expect, it } from 'vitest';
import type { TerrainSampler, TrackData } from '../../contracts';
import { generateTrack } from './generator';
import { STYLE_SPECS, type TrackStyle } from './styles';
import { makeTestSampler } from './testTerrain';
import { validateTrack } from './validate';

const SLOW = 60000;

const STYLES: TrackStyle[] = ['race', 'freestyle', 'mountain', 'sprint'];
const SEEDS = 200;

let sampler: TerrainSampler;
const sweep = new Map<TrackStyle, TrackData[]>();

beforeAll(() => {
  sampler = makeTestSampler({ seed: 3 });
  for (const style of STYLES) {
    const tracks: TrackData[] = [];
    for (let seed = 1; seed <= SEEDS; seed++) tracks.push(generateTrack({ seed, style }, sampler));
    sweep.set(style, tracks);
  }
}, 120000);

describe('validity sweep (200 seeds x 4 styles, synthetic terrain)', () => {
  for (const style of STYLES) {
    it(`${style}: every track validates`, () => {
      sweep.get(style)!.forEach((track, i) => {
        const v = validateTrack(track, sampler);
        expect(v.errors, `${style} seed ${i + 1}`).toEqual([]);
        expect(v.ok).toBe(true);
      });
    }, SLOW);

    it(`${style}: keeps the requested gate count on this terrain`, () => {
      const full = sweep.get(style)!.filter((t) => t.gates.length === STYLE_SPECS[style].defaultGates).length;
      expect(full).toBeGreaterThanOrEqual(SEEDS * 0.95);
    });
  }
});

describe('style rules', () => {
  const extent = 256 * 8;
  const near = (t: TrackData, frac: number): boolean => t.path.every((p) => Math.hypot(p[0], p[2]) <= frac * extent + 15);

  it('race: closed 12-gate circuit, start gate first, 500-900 m, inside 0.35 extent', () => {
    for (const t of sweep.get('race')!) {
      expect(t.closed).toBe(true);
      expect(t.gates.length).toBe(12);
      expect(t.gates[0].kind).toBe('start');
      expect(t.laps).toBe(3);
      expect(t.length).toBeGreaterThanOrEqual(500);
      expect(t.length).toBeLessThanOrEqual(900);
      expect(near(t, 0.35)).toBe(true);
      expect(t.gates.some((g) => g.kind === 'arch' || g.kind === 'hoop')).toBe(true);
      for (const g of t.gates.filter((q) => q.kind === 'square')) {
        expect(g.width).toBeGreaterThanOrEqual(1.4);
        expect(g.width).toBeLessThanOrEqual(2.4);
      }
      expect(t.gates[0].width).toBeLessThan(3.4);
      const gap = Math.hypot(...(t.path[0].map((v, k) => v - t.path[t.path.length - 1][k]) as [number, number, number]));
      expect(gap).toBeLessThan(1.5);
    }
  });

  it('race: gates hang 0.4 m to a few metres above the ground', () => {
    for (const t of sweep.get('race')!) {
      for (const g of t.gates) {
        const agl = g.pos[1] - sampler.heightAt(g.pos[0], g.pos[2]);
        expect(agl - g.height / 2).toBeGreaterThanOrEqual(0.4 - 1e-3);
        expect(agl).toBeLessThan(14);
      }
    }
  });

  it('race: 2-3 height changes (high arch or hoop) per lap on most seeds', () => {
    const ok = sweep.get('race')!.filter((t) => t.gates.filter((g) => (g.kind === 'arch' || g.kind === 'hoop') && g.pos[1] - sampler.heightAt(g.pos[0], g.pos[2]) > 4).length >= 2);
    expect(ok.length).toBeGreaterThanOrEqual(SEEDS * 0.9);
  });

  it('freestyle: open, 6-10 gates with arches, hoops and dives; only dives are pitched', () => {
    let dives = 0;
    for (const t of sweep.get('freestyle')!) {
      expect(t.closed).toBe(false);
      expect(t.gates.length).toBeGreaterThanOrEqual(6);
      expect(t.gates.length).toBeLessThanOrEqual(10);
      expect(t.laps).toBe(1);
      for (const g of t.gates) if (g.kind !== 'dive') expect(g.pitch).toBe(0);
      dives += t.gates.filter((g) => g.kind === 'dive').length;
      expect(t.gates.some((g) => g.kind === 'hoop' || g.kind === 'arch')).toBe(true);
    }
    expect(dives).toBeGreaterThan(SEEDS / 2);
  });

  it('freestyle: every track has a dive gate and a big hoop (3-6 m across, at least 4 m up)', () => {
    for (const t of sweep.get('freestyle')!) {
      expect(t.gates.some((g) => g.kind === 'dive'), `seed ${t.seed}`).toBe(true);
      const big = t.gates.filter((g) => g.kind === 'hoop' && g.width >= 3 && g.width <= 6.05);
      expect(big.length, `seed ${t.seed}`).toBeGreaterThanOrEqual(1);
      for (const g of big) expect(g.pos[1] - sampler.heightAt(g.pos[0], g.pos[2])).toBeGreaterThan(4);
    }
  });

  it('dive gates pitch downward: about -60 degrees in freestyle, following the slope on mountains', () => {
    for (const [style, lo, hi] of [['freestyle', -1.2, -0.9], ['mountain', -1, -0.28]] as const) {
      for (const t of sweep.get(style)!) {
        for (const g of t.gates) {
          if (g.kind !== 'dive') continue;
          expect(g.pitch).toBeLessThanOrEqual(hi);
          expect(g.pitch).toBeGreaterThanOrEqual(lo);
        }
      }
    }
  });

  it('mountain: open 15-25 gates over 1.5-3 km, gates 7-42 m above the ground, dive gates on slopes', () => {
    for (const t of sweep.get('mountain')!) {
      expect(t.closed).toBe(false);
      expect(t.gates.length).toBeGreaterThanOrEqual(15);
      expect(t.gates.length).toBeLessThanOrEqual(25);
      expect(t.length).toBeGreaterThanOrEqual(1500);
      expect(t.length).toBeLessThanOrEqual(3000);
      const flying = t.gates.filter((g) => g.kind !== 'dive');
      for (const g of flying) {
        const agl = g.pos[1] - sampler.heightAt(g.pos[0], g.pos[2]);
        expect(agl).toBeGreaterThanOrEqual(7);
        expect(agl).toBeLessThanOrEqual(42);
      }
    }
  });

  it('mountain: most tracks have at least one dive gate', () => {
    const withDive = sweep.get('mountain')!.filter((t) => t.gates.some((g) => g.kind === 'dive')).length;
    expect(withDive).toBeGreaterThanOrEqual(SEEDS * 0.85);
  });

  it('sprint: open 8-12 gates over 300-500 m ending in a finish gate', () => {
    for (const t of sweep.get('sprint')!) {
      expect(t.closed).toBe(false);
      expect(t.gates.length).toBeGreaterThanOrEqual(8);
      expect(t.gates.length).toBeLessThanOrEqual(12);
      expect(t.length).toBeGreaterThanOrEqual(300);
      expect(t.length).toBeLessThanOrEqual(500);
      expect(t.gates[t.gates.length - 1].kind).toBe('finish');
      expect(t.laps).toBe(1);
    }
  });
});

describe('start pad', () => {
  it('sits 8-12 m from the first gate on the ground, facing it', () => {
    for (const style of STYLES) {
      for (const t of sweep.get(style)!.slice(0, 50)) {
        const g0 = t.gates[0];
        const d = Math.hypot(t.start.pos[0] - g0.pos[0], t.start.pos[2] - g0.pos[2]);
        expect(d).toBeGreaterThanOrEqual(8 - 1e-6);
        expect(d).toBeLessThanOrEqual(12 + 1e-6);
        expect(t.start.pos[1]).toBeCloseTo(sampler.heightAt(t.start.pos[0], t.start.pos[2]), 3);
        const dx = g0.pos[0] - t.start.pos[0];
        const dz = g0.pos[2] - t.start.pos[2];
        expect(-Math.sin(t.start.yaw) * dx - Math.cos(t.start.yaw) * dz).toBeGreaterThan(0.999 * d);
      }
    }
  });
});

describe('determinism and parameters', () => {
  it('same params and terrain give identical tracks; other seeds differ', () => {
    for (const style of STYLES) {
      const a = generateTrack({ seed: 77, style }, sampler);
      const b = generateTrack({ seed: 77, style }, makeTestSampler({ seed: 3 }));
      expect(JSON.stringify(b)).toBe(JSON.stringify(a));
      const c = generateTrack({ seed: 78, style }, sampler);
      expect(JSON.stringify(c)).not.toBe(JSON.stringify(a));
    }
  }, SLOW);

  it('honours gateCount, laps and clamps out-of-range requests', () => {
    const t = generateTrack({ seed: 5, style: 'race', gateCount: 15, laps: 5 }, sampler);
    expect(t.gates.length).toBe(15);
    expect(t.laps).toBe(5);
    expect(generateTrack({ seed: 5, style: 'race', gateCount: 99 }, sampler).gates.length).toBeLessThanOrEqual(18);
    expect(generateTrack({ seed: 5, style: 'sprint', gateCount: 1 }, sampler).gates.length).toBeGreaterThanOrEqual(8);
    expect(generateTrack({ seed: 5, style: 'sprint' }, sampler).laps).toBe(1);
  });

  it('treats NaN and infinite parameters as defaults or clamps, never as a failed generation', () => {
    const base = generateTrack({ seed: 9, style: 'race' }, sampler);
    const nan = generateTrack({ seed: 9, style: 'race', gateCount: NaN, laps: NaN, difficulty: NaN }, sampler);
    expect(JSON.stringify(nan)).toBe(JSON.stringify(base));
    const huge = generateTrack({ seed: 9, style: 'race', gateCount: Infinity, laps: Infinity, difficulty: -Infinity }, sampler);
    expect(huge.gates.length).toBeLessThanOrEqual(STYLE_SPECS.race.maxGates);
    expect(Number.isInteger(huge.laps) && huge.laps >= 1).toBe(true);
    expect(validateTrack(huge, sampler).ok).toBe(true);
  });

  it('difficulty makes race gates smaller', () => {
    const mean = (d: number): number => {
      let sum = 0;
      let n = 0;
      for (let seed = 1; seed <= 20; seed++) {
        for (const g of generateTrack({ seed, style: 'race', difficulty: d }, sampler).gates) {
          if (g.kind === 'square') {
            sum += g.width;
            n++;
          }
        }
      }
      return sum / n;
    };
    expect(mean(1)).toBeLessThan(mean(0));
  }, SLOW);

  it('falls back to fewer gates rather than failing on cramped terrain', () => {
    const lake = makeTestSampler({ seed: 5, waterFraction: 0.18 });
    let fewer = 0;
    for (let seed = 1; seed <= 12; seed++) {
      try {
        const t = generateTrack({ seed, style: 'race' }, lake);
        expect(validateTrack(t, lake).ok).toBe(true);
        if (t.gates.length < 12) fewer++;
      } catch (e) {
        expect(String(e)).toContain('no valid race track');
      }
    }
    expect(fewer).toBeGreaterThan(0);
  });
});

import { describe, expect, it, vi } from 'vitest';
import type { TerrainData, TerrainParams, TerrainSampler, TrackData, TrackParams } from '../contracts';
import { makeTrack } from '../game/testKit';
import { flatTerrain } from '../sim/testkit';
import { ALL_STYLES, SEED_ATTEMPTS, STYLE_FALLBACK_SEEDS, TERRAIN_ATTEMPTS, buildTrack, buildWorld, trackAttempts, type TrackStyle, type WorldDeps } from './world';

const REQ = { seed: 100, style: 'race' as TrackStyle, gateCount: 9, laps: 2, difficulty: 0.4 };
const TOTAL_ATTEMPTS = SEED_ATTEMPTS + (ALL_STYLES.length - 1) * STYLE_FALLBACK_SEEDS;

/** A generator that fails until `ok(params)` says yes; records every call. */
function generator(ok: (p: TrackParams, call: number) => boolean): { fn: (p: TrackParams, s: TerrainSampler) => TrackData; calls: TrackParams[] } {
  const calls: TrackParams[] = [];
  return {
    calls,
    fn: (p) => {
      calls.push(p);
      if (!ok(p, calls.length)) throw new Error(`no room for ${p.style}/${p.seed}`);
      return makeTrack(p.gateCount ?? 3, { seed: p.seed, style: p.style, laps: p.laps ?? 1 });
    },
  };
}

describe('trackAttempts', () => {
  it('tries the requested style first, then two seeds of every other style', () => {
    const all = [...trackAttempts(10, 'freestyle')];
    expect(all).toHaveLength(TOTAL_ATTEMPTS);
    expect(all.slice(0, SEED_ATTEMPTS)).toEqual(Array.from({ length: SEED_ATTEMPTS }, (_, i) => ({ seed: 10 + i, style: 'freestyle' })));
    const rest = all.slice(SEED_ATTEMPTS);
    expect(rest.every((a) => a.style !== 'freestyle')).toBe(true);
    expect(new Set(rest.map((a) => a.style))).toEqual(new Set(['race', 'mountain', 'sprint']));
    expect(rest.filter((a) => a.style === 'race').map((a) => a.seed)).toEqual([10, 11]);
  });

  it('is lazy: taking the first attempt does not enumerate the rest', () => {
    const it = trackAttempts(5, 'sprint');
    expect(it.next().value).toEqual({ seed: 5, style: 'sprint' });
  });
});

describe('buildTrack', () => {
  const sampler = flatTerrain(0);

  it('returns the first layout that fits, with a single attempt on a good terrain', () => {
    const g = generator(() => true);
    const r = buildTrack(sampler, REQ, { generateTrack: g.fn });
    expect(r.attempts).toBe(1);
    expect(r.seed).toBe(100);
    expect(r.style).toBe('race');
    expect(g.calls[0]).toEqual({ seed: 100, style: 'race', gateCount: 9, laps: 2, difficulty: 0.4 });
    expect(r.track.gates).toHaveLength(9);
  });

  it('records the exact parameters of the layout that fit, for a share link to rebuild it', () => {
    const g = generator((_p, call) => call >= 3);
    const r = buildTrack(sampler, REQ, { generateTrack: g.fn });
    expect(r.request).toEqual({ seed: 102, style: 'race', gateCount: 9, laps: 2, difficulty: 0.4 });
    const again = buildTrack(sampler, r.request, { generateTrack: generator(() => true).fn });
    expect(again.attempts).toBe(1);
    expect(again.track.seed).toBe(102);
  });

  it('keeps the lap count on a circuit and runs a point-to-point track once', () => {
    const laps = (closed: boolean) => buildTrack(sampler, REQ, { generateTrack: (p) => makeTrack(4, { seed: p.seed, style: p.style, laps: p.laps ?? 1, closed }) }).track.laps;
    expect(laps(true)).toBe(2);
    expect(laps(false)).toBe(1);
  });

  it('retries with the next seed of the same style', () => {
    const g = generator((_p, call) => call >= 4);
    const r = buildTrack(sampler, REQ, { generateTrack: g.fn });
    expect(r.attempts).toBe(4);
    expect(r.seed).toBe(103);
    expect(r.style).toBe('race');
    expect(g.calls.map((c) => c.seed)).toEqual([100, 101, 102, 103]);
  });

  it('falls back to another style once every seed of the requested one failed', () => {
    const g = generator((p) => p.style !== 'race');
    const r = buildTrack(sampler, REQ, { generateTrack: g.fn });
    expect(r.attempts).toBe(SEED_ATTEMPTS + 1);
    expect(r.style).not.toBe('race');
    expect(r.seed).toBe(100);
    expect(r.track.style).toBe(r.style);
  });

  it('throws an Error that lists the failures when nothing fits', () => {
    const g = generator(() => false);
    let caught: (Error & { failures?: string[] }) | null = null;
    try {
      buildTrack(sampler, REQ, { generateTrack: g.fn });
    } catch (e) {
      caught = e as Error & { failures?: string[] };
    }
    expect(caught).toBeInstanceOf(Error);
    expect(caught?.message).toContain(`no valid track layout after ${TOTAL_ATTEMPTS} attempts`);
    expect(caught?.message).toContain('race/100');
    expect(caught?.failures).toHaveLength(TOTAL_ATTEMPTS);
    expect(g.calls).toHaveLength(TOTAL_ATTEMPTS);
  });
});

describe('buildWorld', () => {
  function makeDeps(trackOk: (p: TrackParams, terrainIndex: number) => boolean): {
    deps: WorldDeps;
    terrains: TerrainParams[];
    gen: TrackParams[];
    samplers: TerrainData[];
  } {
    const terrains: TerrainParams[] = [];
    const gen: TrackParams[] = [];
    const samplers: TerrainData[] = [];
    const base = flatTerrain(0);
    const deps: WorldDeps = {
      generateTerrain: async (p, onProgress) => {
        terrains.push(p);
        onProgress?.('Eroding', 1);
        return { seed: p.seed, resolution: 64 } as unknown as TerrainData;
      },
      createSampler: (data) => {
        samplers.push(data);
        return { ...base, data };
      },
      generateTrack: (p) => {
        gen.push(p);
        if (!trackOk(p, samplers.length - 1)) throw new Error('blocked');
        return makeTrack(p.gateCount ?? 3, { seed: p.seed, style: p.style });
      },
    };
    return { deps, terrains, gen, samplers };
  }

  it('builds terrain then track on the requested seed and remembers the base seed and quality', async () => {
    const { deps, terrains } = makeDeps(() => true);
    const progress: [string, number][] = [];
    const w = await buildWorld({ ...REQ, quality: 'medium' }, deps, (s, f) => progress.push([s, f]));
    expect(terrains).toEqual([{ seed: 100, quality: 'medium' }]);
    expect(w.terrainSeed).toBe(100);
    expect(w.baseSeed).toBe(100);
    expect(w.quality).toBe('medium');
    expect(w.attempts).toBe(1);
    expect(w.terrain.seed).toBe(100);
    // Terrain progress is scaled to 90 percent, the track placement closes the bar at 92.
    expect(progress[0]).toEqual(['Eroding', 0.9]);
    expect(progress[progress.length - 1]).toEqual(['Placing track', 0.92]);
  });

  it('regenerates the terrain with a shifted seed when no layout fits the first one', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const { deps, terrains } = makeDeps((_p, terrainIndex) => terrainIndex >= 1);
    const w = await buildWorld({ ...REQ, quality: 'low' }, deps);
    expect(terrains.map((t) => t.seed)).toEqual([100, 100 + 1000003]);
    expect(w.terrainSeed).toBe(100 + 1000003);
    expect(w.baseSeed).toBe(100);
    expect(w.seed).toBe(100 + 1000003);
    expect(warn).toHaveBeenCalledTimes(1);
    warn.mockRestore();
  });

  it('builds the track seed on a terrain seed of its own (a link to an N-key track)', async () => {
    const { deps, terrains, gen } = makeDeps(() => true);
    const w = await buildWorld({ ...REQ, seed: 105, terrainSeed: 100, quality: 'low' }, deps);
    expect(terrains).toEqual([{ seed: 100, quality: 'low' }]);
    expect(gen[0].seed).toBe(105);
    expect(w.terrainSeed).toBe(100);
    expect(w.baseSeed).toBe(100);
    expect(w.seed).toBe(105);
    expect(w.request.seed).toBe(105);
  });

  it('gives up with the last error after TERRAIN_ATTEMPTS terrains', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const { deps, terrains } = makeDeps(() => false);
    await expect(buildWorld({ ...REQ, quality: 'low' }, deps)).rejects.toThrow(/no valid track layout/);
    expect(terrains).toHaveLength(TERRAIN_ATTEMPTS);
    warn.mockRestore();
  });

  it('passes a terrain failure straight through', async () => {
    const { deps } = makeDeps(() => true);
    deps.generateTerrain = () => Promise.reject(new Error('worker died'));
    await expect(buildWorld({ ...REQ, quality: 'low' }, deps)).rejects.toThrow('worker died');
  });
});

import { describe, expect, it } from 'vitest';
import type { TrackData, Vec3 } from '../../contracts';
import { PadGround } from '../../app/padGround';
import { testSampler, testTerrainData } from '../../world/track/testTerrain';
import { packPath } from './pathProgress';
import { parseTrackFile } from './trackFile';
import { GATE_WORDS, TRACK_WORDS, buildTrainWorld, packWorlds, type TrainWorld } from './worlds';

function ringWorld(points: number, closed: boolean): TrainWorld {
  const terrain = testTerrainData({ seed: 3, resolution: 128, cellSize: 8, waterFraction: 0 });
  const sampler = testSampler(terrain);
  const path: Vec3[] = Array.from({ length: points }, (_, i) => {
    const a = (i / points) * 2 * Math.PI;
    return [100 * Math.cos(a), 40, 100 * Math.sin(a)] as Vec3;
  });
  const track: TrackData = {
    seed: 3, style: 'race', closed, laps: closed ? 2 : 1, length: 0, path, obstacles: [],
    start: { pos: [100, 0, -5], yaw: 0 },
    gates: [0, 1, 2].map((i) => ({ index: i, kind: 'square', pos: path[i * 50], yaw: -0.5 * Math.PI - (i * 50 / points) * 2 * Math.PI, pitch: 0, roll: 0, width: 3, height: 3 })),
  };
  return { seed: 3, style: 'race', terrain, sampler, ground: new PadGround(sampler, track), track, colliders: [] };
}

describe('packed worlds', () => {
  it('lays every world path end to end with its offset, count, length and spawn samples', () => {
    const a = ringWorld(300, true), b = ringWorld(180, false);
    const noPath = ringWorld(300, true);
    noPath.track = { ...noPath.track, path: [] };
    const p = packWorlds([a, b, noPath]);
    const tu = new Uint32Array(p.tracks), tf = new Float32Array(p.tracks);
    const pa = packPath(a.track), pb = packPath(b.track);
    expect(p.tracks.byteLength).toBe(3 * TRACK_WORDS * 4);
    expect([tu[33], tu[34]]).toEqual([0, pa.count]);
    expect([tu[TRACK_WORDS + 33], tu[TRACK_WORDS + 34]]).toEqual([pa.count, pb.count]);
    expect(tu[2 * TRACK_WORDS + 34]).toBe(0);
    expect(tf[35]).toBeCloseTo(pa.length, 2);
    expect(tu[36]).toBe(pa.startSample);
    expect(p.paths.length).toBe((pa.count + pb.count) * 4);
    expect(Array.from(p.paths.subarray(pa.count * 4, pa.count * 4 + 4))).toEqual(Array.from(pb.points.subarray(0, 4)));
    // Gate word 17: the gate's path sample
    expect(p.gates[GATE_WORDS + 17]).toBe(pa.gateSample[1]);
  });

  it('keeps a binding-sized path buffer when no world has a path', () => {
    const w = ringWorld(300, true);
    w.track = { ...w.track, path: [] };
    expect(packWorlds([w]).paths.length).toBe(4);
  });
});

describe('training world sources', () => {
  it('rebuilds a style world from its own track file', { timeout: 60000 }, () => {
    const w = buildTrainWorld({ seed: 1001, style: 'race', difficulty: 0.4 });
    const file = JSON.stringify({ terrainSeed: 1001, quality: 'low', track: w.track });
    const f = parseTrackFile(file);
    const again = buildTrainWorld({ seed: f.terrainSeed!, quality: f.quality, track: f.track });
    expect(again.source).toBe('file');
    expect(again.track.gates).toEqual(w.track.gates);
    expect(again.colliders.length).toBe(w.colliders.length);
    expect(again.warnings ?? []).toEqual([]);
  });

  it('puts a start exported on top of the pad back on the ground', { timeout: 60000 }, () => {
    const w = buildTrainWorld({ seed: 1001, style: 'race', difficulty: 0.4, vegetation: false });
    const s = w.track.start.pos;
    const lifted: TrackData = { ...w.track, start: { pos: [s[0], w.sampler.heightAt(s[0], s[2]) + 0.6, s[2]], yaw: w.track.start.yaw } };
    const again = buildTrainWorld({ seed: 1001, track: lifted, vegetation: false });
    expect(again.warnings ?? []).toEqual([]);
    expect(again.track.start.pos[1]).toBeCloseTo(w.track.start.pos[1], 5);
  });

  it('refuses a track that lies off its terrain', { timeout: 60000 }, () => {
    const w = buildTrainWorld({ seed: 1001, style: 'race', difficulty: 0.4, vegetation: false });
    const far: TrackData = { ...w.track, gates: w.track.gates.map((g) => ({ ...g, pos: [g.pos[0] + 5000, g.pos[1], g.pos[2]] as Vec3 })) };
    expect(() => buildTrainWorld({ seed: 1001, track: far, vegetation: false })).toThrow(/outside the terrain/);
  });
});

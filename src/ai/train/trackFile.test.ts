import { describe, expect, it } from 'vitest';
import type { TrackData } from '../../contracts';
import { parseTrackData, parseTrackFile, polylineLength } from './trackFile';

const base = (): TrackData => ({
  seed: 7,
  style: 'technical',
  gates: [
    { index: 5, kind: 'square', pos: [0, 5, 0], yaw: 0, pitch: 0, roll: 0, width: 3, height: 3 },
    { index: 9, kind: 'drop', pos: [20, 9, 0], yaw: 1, pitch: -Math.PI / 2, roll: 0, width: 3, height: 3, feature: 'drop' },
    { index: 2, kind: 'tunnel', pos: [40, 4, 0], yaw: 0, pitch: 0, roll: 0, width: 3, height: 2.6, depth: 6, feature: 'tunnel' },
  ],
  obstacles: [{ kind: 'container', pos: [10, 0, 10], yaw: 0.2, size: [6.1, 2.6, 2.44] }],
  path: [[0, 5, 0], [3, 4, 4], [0, 5, 8]],
  closed: true,
  length: 123,
  start: { pos: [0, 0, -10], yaw: 0 },
  laps: 3,
});

describe('track files', () => {
  it('reads a bare TrackData, renumbering gates and recomputing the length', () => {
    const f = parseTrackFile(JSON.stringify(base()));
    expect(f.terrainSeed).toBeUndefined();
    expect(f.track.gates.map((g) => g.index)).toEqual([0, 1, 2]);
    expect(f.track.gates[1].feature).toBe('drop');
    expect(f.track.gates[2].depth).toBe(6);
    expect(f.track.length).toBeCloseTo(polylineLength(base().path, true));
    expect(f.track.laps).toBe(3);
    expect(f.track.style).toBe('technical');
  });

  it('reads a builder export with terrain seed and quality', () => {
    const f = parseTrackFile(JSON.stringify({ terrainSeed: 4242, quality: 'medium', track: base() }));
    expect(f.terrainSeed).toBe(4242);
    expect(f.quality).toBe('medium');
    expect(f.track.gates).toHaveLength(3);
  });

  it('flies an open run once and fills optional fields', () => {
    const t = { ...base(), closed: false, laps: 4, gates: base().gates.map(({ pitch: _p, roll: _r, ...g }) => g), style: 'whatever' };
    delete (t as Partial<TrackData>).obstacles;
    const d = parseTrackData(t);
    expect(d.laps).toBe(1);
    expect(d.obstacles).toEqual([]);
    expect(d.gates[0].pitch).toBe(0);
    expect(d.style).toBe('custom');
  });

  it('rejects what the trainer cannot fly, saying where', () => {
    const bad = (mut: (t: Record<string, unknown>) => void): (() => unknown) => () => {
      const t = JSON.parse(JSON.stringify(base()));
      mut(t);
      return parseTrackData(t);
    };
    expect(bad((t) => { t.gates = []; })).toThrow(/non-empty/);
    expect(bad((t) => { (t.gates as { kind: string }[])[1].kind = 'portal'; })).toThrow(/gates\[1\]\.kind/);
    expect(bad((t) => { (t.gates as { pos: unknown }[])[0].pos = [0, 'x', 0]; })).toThrow(/gates\[0\]\.pos\[1\]/);
    expect(bad((t) => { (t.gates as { width: number }[])[2].width = 0; })).toThrow(/too small/);
    expect(bad((t) => { (t.gates as { pitch: number }[])[2].pitch = 0.3; })).toThrow(/gates\[2\]: tunnel gates stand upright/);
    expect(bad((t) => { (t.obstacles as { kind: string }[])[0].kind = 'ufo'; })).toThrow(/obstacles\[0\]/);
    expect(bad((t) => { delete t.start; })).toThrow(/start/);
    expect(() => parseTrackFile('{nope')).toThrow(/not JSON/);
    expect(() => parseTrackFile(JSON.stringify({ track: base(), quality: 'max' }))).toThrow(/quality/);
  });
});

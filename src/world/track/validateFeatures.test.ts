import { beforeAll, describe, expect, it } from 'vitest';
import type { TerrainSampler, TrackData, TrackGate, TrackObstacle } from '../../contracts';
import { generateTrack } from './generator';
import { DROP_PITCH } from './kindGeometry';
import { STYLE_SPECS } from './styles';
import { makeTestSampler } from './testTerrain';
import { validateTrack } from './validate';
import { featureZones, pitchProblem } from './validateFeatures';

const gate = (over: Partial<TrackGate>): TrackGate => ({ index: 0, kind: 'square', pos: [0, 2, 0], yaw: 0, roll: 0, pitch: 0, width: 2, height: 2, ...over });

describe('pitchProblem', () => {
  it('drops are exactly vertical, dives up to 1.4 rad either way, upright kinds level, the rest unpitched', () => {
    expect(pitchProblem(gate({ kind: 'drop', pitch: DROP_PITCH }))).toBeNull();
    expect(pitchProblem(gate({ kind: 'drop', pitch: DROP_PITCH + 1e-6 }))).not.toBeNull();
    expect(pitchProblem(gate({ kind: 'dive', pitch: 1.2 }))).toBeNull();
    expect(pitchProblem(gate({ kind: 'dive', pitch: -1.2 }))).toBeNull();
    expect(pitchProblem(gate({ kind: 'dive', pitch: 1.5 }))).not.toBeNull();
    for (const kind of ['window', 'tunnel', 'hurdle', 'ladder'] as const) {
      expect(pitchProblem(gate({ kind }))).toBeNull();
      expect(pitchProblem(gate({ kind, roll: 0.2 }))).not.toBeNull();
      expect(pitchProblem(gate({ kind, pitch: 0.2 }))).not.toBeNull();
    }
    expect(pitchProblem(gate({ kind: 'hoop', roll: Math.PI }))).toBeNull();
    expect(pitchProblem(gate({ kind: 'hoop', pitch: 0.1 }))).not.toBeNull();
  });
});

describe('feature zones', () => {
  it('cover each run of tagged gates plus its lead-in and run-out, and nothing on an original track', () => {
    const path = Array.from({ length: 400 }, (_, i) => [0, 3, -i] as [number, number, number]);
    const gates = [
      gate({ index: 0, pos: [0, 3, -20] }),
      gate({ index: 1, pos: [0, 3, -100], feature: 'slalom' }),
      gate({ index: 2, pos: [0, 3, -118], feature: 'slalom' }),
      gate({ index: 3, pos: [0, 3, -200] }),
      gate({ index: 4, pos: [0, 3, -300], feature: 'window' }),
    ];
    const z = featureZones({ gates, path, closed: false });
    expect(z.zones.map((q) => [q.feature, q.gates, q.from, q.to])).toEqual([
      ['slalom', [1, 2], 88, 130],
      ['window', [4], 290, 310],
    ]);
    expect(Array.from(z.gateZone)).toEqual([-1, 0, 0, -1, 1]);
    expect(z.sampleZone[87]).toBe(-1);
    expect(z.sampleZone[88]).toBe(0);
    expect(z.limit[100]).toBeCloseTo(1 / 6, 6);
    const plain = featureZones({ gates: gates.map((g) => ({ ...g, feature: undefined })), path: path.slice(), closed: false });
    expect(plain.zones).toEqual([]);
  });
});

describe('validation of feature tracks catches broken geometry', () => {
  let sampler: TerrainSampler;
  let technical: TrackData;
  let industrial: TrackData;
  let acro: TrackData;

  beforeAll(() => {
    sampler = makeTestSampler({ seed: 3 });
    technical = generateTrack({ seed: 4, style: 'technical' }, sampler);
    industrial = generateTrack({ seed: 4, style: 'industrial' }, sampler);
    acro = (() => {
      for (let seed = 1; seed < 40; seed++) {
        const t = generateTrack({ seed, style: 'acro' }, sampler);
        if (t.gates.some((g) => g.kind === 'drop')) return t;
      }
      throw new Error('no acro track with a drop');
    })();
  }, 60_000);

  const clone = (t: TrackData): TrackData => JSON.parse(JSON.stringify(t)) as TrackData;
  const errors = (t: TrackData): string[] => validateTrack(t, sampler).errors;

  it('the untouched tracks are valid', () => {
    for (const t of [technical, industrial, acro]) expect(errors(t)).toEqual([]);
  });

  it('a rolled window or a drop that is not vertical', () => {
    const t = clone(industrial);
    const w = t.gates.find((g) => g.kind === 'window')!;
    w.roll = 0.3;
    expect(errors(t).join()).toMatch(/window gates stand upright/);
    const a = clone(acro);
    a.gates.find((g) => g.kind === 'drop')!.pitch = -1.2;
    expect(errors(a).join()).toMatch(/drop gates must be pitched/);
  });

  it('a hurdle raised off its sill, or a drop ring above 12 m', () => {
    let t: TrackData | undefined;
    for (let seed = 1; seed < 40 && !t; seed++) {
      const c = generateTrack({ seed, style: 'technical' }, sampler);
      if (c.gates.some((g) => g.kind === 'hurdle')) t = c;
    }
    const h = clone(t!);
    const g = h.gates.find((q) => q.kind === 'hurdle')!;
    g.pos = [g.pos[0], g.pos[1] + 0.4, g.pos[2]];
    expect(errors(h).join()).toMatch(/hurdle sill .* outside 0.3..0.6/);
    const a = clone(acro);
    const d = a.gates.find((q) => q.kind === 'drop')!;
    d.pos = [d.pos[0], sampler.heightAt(d.pos[0], d.pos[2]) + 12.5, d.pos[2]];
    expect(errors(a).join()).toMatch(/drop ring centre 12.50 m/);
  }, 60_000);

  it('gates edited in place after a validation are checked again, not against the cached zones', () => {
    const t = clone(technical);
    expect(errors(t)).toEqual([]);
    for (const g of t.gates) delete g.feature;
    expect(errors(t).length).toBeGreaterThan(0);
  });

  it('a structure on the line, or a beam too low to fly under', () => {
    const t = clone(industrial);
    const p = t.path[Math.floor(t.path.length / 3)];
    const box: TrackObstacle = { kind: 'container', pos: [p[0], sampler.heightAt(p[0], p[2]), p[2]], yaw: 0, size: [6.1, 2.6, 2.44] };
    t.obstacles = [...t.obstacles, box];
    expect(errors(t).join()).toMatch(/container\): .* m from the path/);
    const beam = t.obstacles.find((o) => o.kind === 'beam' || o.kind === 'bridge');
    if (beam) {
      const u = clone(industrial);
      const b = u.obstacles.find((o) => o.kind === beam.kind && o.pos[0] === beam.pos[0])!;
      b.size = [b.size[0], 3, b.size[2]];
      expect(errors(u).join()).toMatch(/from the path/);
    }
  });

  it('a tight turn outside every zone still fails at the original 6 m limit', () => {
    const t = clone(technical);
    const zone = featureZones(t).sampleZone;
    const i = Array.from(zone).findIndex((z, k) => z < 0 && k > 40 && zone[k + 20] < 0 && zone[k - 20] < 0);
    expect(i).toBeGreaterThan(0);
    t.path[i] = [t.path[i][0] + 1.2, t.path[i][1], t.path[i][2] + 1.2];
    expect(errors(t).join()).toMatch(/path curvature/);
  });

  it('a track built as custom without its recipe is refused, and the spec flags hold', () => {
    const t = clone(technical);
    t.style = 'custom';
    expect(errors(t).join()).toMatch(/custom track without its recipe/);
    expect(STYLE_SPECS.technical.features).toBe(true);
    expect(STYLE_SPECS.race.features).toBeUndefined();
  });
});

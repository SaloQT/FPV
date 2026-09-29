import { describe, expect, it } from 'vitest';
import type { GateKind, TerrainSampler, TrackData, TrackGate, TrackObstacle } from '../../contracts';
import { GATE_TUBE, insideOpening, trackGateFrame } from '../../world/track/gate';
import { buildGate } from './gateMeshes';
import { GLOW_FLOATS, buildGlowMesh } from './glowRibbons';
import { KIND } from './materials';
import { MeshBuilder, VERTEX_FLOATS } from './meshBuilder';
import { checkMesh } from './meshCheck';
import { buildObstacle } from './obstacleMeshes';
import { RT_CONE_CAP, RT_PRIM_CAP, buildTrackProxies } from './trackProxies';
import { PAD_SIZE, buildTrackMesh } from './trackMesh';

const terrain = (height: (x: number, z: number) => number): TerrainSampler => ({ heightAt: height } as unknown as TerrainSampler);
const flat = terrain(() => 0);

const gate = (kind: GateKind, over: Partial<TrackGate> = {}): TrackGate => ({
  index: 3,
  kind,
  pos: [10, 2, -5],
  yaw: 0.7,
  roll: 0,
  pitch: 0,
  width: 2,
  height: 1.6,
  ...over,
});

const track = (gates: TrackGate[], obstacles: TrackObstacle[] = []): TrackData => ({
  seed: 1,
  style: 'race',
  gates,
  obstacles,
  path: [],
  closed: false,
  length: 0,
  start: { pos: [0, 0, 0], yaw: 0 },
  laps: 1,
});

const KINDS: GateKind[] = ['square', 'arch', 'hoop', 'dive', 'flag', 'start', 'finish'];

describe('gates', () => {
  for (const kind of KINDS) {
    it(`${kind} builds a finite mesh tagged with its index and leaves the opening clear`, () => {
      const g = gate(kind, kind === 'dive' ? { pitch: 0.4 } : kind === 'square' ? { roll: 0.3 } : {});
      const b = new MeshBuilder();
      const built = buildGate(b, g, flat);
      const mesh = b.finish();
      checkMesh(mesh);
      const f = trackGateFrame(g);
      let tagged = 0;
      for (let i = 0; i < mesh.vertices.length; i += VERTEX_FLOATS) {
        const d = [mesh.vertices[i] - g.pos[0], mesh.vertices[i + 1] - g.pos[1], mesh.vertices[i + 2] - g.pos[2]];
        if (mesh.vertices[i + 11] === g.index) tagged++;
        const u = d[0] * f.right[0] + d[1] * f.right[1] + d[2] * f.right[2];
        const v = d[0] * f.up[0] + d[1] * f.up[1] + d[2] * f.up[2];
        const w = d[0] * f.forward[0] + d[1] * f.forward[1] + d[2] * f.forward[2];
        if (kind === 'flag' || Math.abs(w) > GATE_TUBE) continue;
        // Scaling the point outward keeps a point on the inner face on the boundary but pulls one deeper inside to the boundary.
        expect(insideOpening(g, u * 1.02, v * 1.02)).toBe(false);
      }
      expect(tagged).toBeGreaterThan(0);
      expect(built.flags.length).toBe(kind === 'flag' ? 2 : 0);
      expect(built.strips.length).toBe(kind === 'flag' ? 0 : kind === 'square' || kind === 'start' || kind === 'finish' ? 4 : kind === 'arch' ? 3 : 1);
    });
  }

  it('a finish gate checkers its top bar and a plain square does not', () => {
    const kinds = (kind: GateKind): Set<number> => {
      const b = new MeshBuilder();
      buildGate(b, gate(kind), flat);
      const m = b.finish();
      const out = new Set<number>();
      for (let i = 0; i < m.vertices.length; i += VERTEX_FLOATS) out.add(m.vertices[i + 8]);
      return out;
    };
    expect(kinds('finish').has(KIND.GATE_CHECKER)).toBe(true);
    expect(kinds('square').has(KIND.GATE_CHECKER)).toBe(false);
    expect(kinds('square').has(KIND.GATE_LED)).toBe(true);
  });

  it('the legs reach the terrain under the gate', () => {
    const slope = terrain((x) => 0.2 * x);
    const b = new MeshBuilder();
    buildGate(b, gate('square', { yaw: 0, pos: [10, 4, 0] }), slope);
    const m = b.finish();
    let lowest = Infinity;
    for (let i = 0; i < m.vertices.length; i += VERTEX_FLOATS) lowest = Math.min(lowest, m.vertices[i + 1] - slope.heightAt(m.vertices[i], m.vertices[i + 2]));
    expect(lowest).toBeLessThan(0.001);
    expect(lowest).toBeGreaterThan(-0.06);
  });

  it('every LED strip lies on the gate it belongs to', () => {
    const b = new MeshBuilder();
    const g = gate('hoop');
    const { strips } = buildGate(b, g, flat);
    for (const s of strips) {
      expect(s.gate).toBe(g.index);
      for (const p of s.pts) expect(Math.hypot(p[0] - g.pos[0], p[1] - g.pos[1], p[2] - g.pos[2])).toBeLessThan(g.width);
    }
  });
});

describe('obstacles', () => {
  const cases: [TrackObstacle['kind'], [number, number, number]][] = [
    ['cone', [0.14, 0.5, 0.14]],
    ['pole', [0.03, 2.5, 0.03]],
    ['flagpole', [0.02, 2.5, 0.02]],
    ['tree', [0.3, 9, 0.3]],
    ['rock', [1.4, 1.0, 1.1]],
    ['wall', [3, 1.2, 0.3]],
  ];
  for (const [kind, size] of cases) {
    it(`${kind} sits on its position and stays inside its collision extents`, () => {
      const o: TrackObstacle = { kind, pos: [4, 1.5, -2], yaw: 0, size };
      const b = new MeshBuilder();
      const flags: unknown[] = [];
      buildObstacle(b, o, 2, flags as never[]);
      const m = b.finish();
      checkMesh(m);
      let lo = Infinity, hi = -Infinity, half = 0;
      for (let i = 0; i < m.vertices.length; i += VERTEX_FLOATS) {
        lo = Math.min(lo, m.vertices[i + 1]);
        hi = Math.max(hi, m.vertices[i + 1]);
        half = Math.max(half, Math.abs(m.vertices[i] - 4), Math.abs(m.vertices[i + 2] + 2));
      }
      // Walls, rocks and trunks sink a little into the ground so a slope never shows a gap.
      expect(lo).toBeGreaterThan(1.5 - 0.16);
      expect(lo).toBeLessThan(1.5 + 0.06);
      expect(hi).toBeGreaterThan(1.5 + size[1] * 0.85);
      if (kind === 'wall' || kind === 'rock') expect(half).toBeLessThanOrEqual(Math.max(size[0], size[2]) * 0.75);
      expect(flags.length).toBe(kind === 'flagpole' ? 1 : 0);
    });
  }

  it('the same obstacle index always builds the same rock', () => {
    const build = (i: number): Float32Array => {
      const b = new MeshBuilder();
      buildObstacle(b, { kind: 'rock', pos: [0, 0, 0], yaw: 0.4, size: [1.4, 1, 1.1] }, i, []);
      return b.finish().vertices;
    };
    expect(Array.from(build(5))).toEqual(Array.from(build(5)));
    expect(Array.from(build(5))).not.toEqual(Array.from(build(6)));
  });
});

describe('start pad and track mesh', () => {
  it('follows a slope: sunk below the low corner, proud of the high one, and square to the heading', () => {
    const slope = terrain((x) => 0.1 * x);
    const t = track([]);
    t.start = { pos: [5, 0.5, 5], yaw: 0 };
    const { mesh } = buildTrackMesh(t, slope);
    checkMesh(mesh, true);
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity, minZ = Infinity, maxZ = -Infinity;
    for (let i = 0; i < mesh.vertices.length; i += VERTEX_FLOATS) {
      minX = Math.min(minX, mesh.vertices[i]);
      maxX = Math.max(maxX, mesh.vertices[i]);
      minY = Math.min(minY, mesh.vertices[i + 1]);
      maxY = Math.max(maxY, mesh.vertices[i + 1]);
      minZ = Math.min(minZ, mesh.vertices[i + 2]);
      maxZ = Math.max(maxZ, mesh.vertices[i + 2]);
    }
    expect(maxX - minX).toBeCloseTo(PAD_SIZE, 5);
    expect(maxZ - minZ).toBeCloseTo(PAD_SIZE, 5);
    expect(minY).toBeCloseTo(0.1 * (5 - PAD_SIZE / 2) - 0.03, 5);
    expect(maxY).toBeCloseTo(0.1 * (5 + PAD_SIZE / 2) + 0.024, 5);
    expect(mesh.indices.length % 3).toBe(0);
  });

  it('bakes every gate, obstacle and the pad into one indexed mesh and collects flags and strips', () => {
    const t = track(
      [gate('square', { index: 0 }), gate('flag', { index: 1, pos: [20, 2, -5] })],
      [{ kind: 'flagpole', pos: [3, 0, 3], yaw: 0, size: [0.02, 2.5, 0.02] }, { kind: 'cone', pos: [1, 0, 1], yaw: 0, size: [0.14, 0.5, 0.14] }],
    );
    const built = buildTrackMesh(t, flat);
    checkMesh(built.mesh);
    expect(built.flags.length).toBe(3);
    expect(built.strips.length).toBe(4);
    const max = built.mesh.indices.reduce((m, i) => Math.max(m, i), 0);
    expect(max).toBeLessThan(built.mesh.vertices.length / VERTEX_FLOATS);
  });
});

describe('ray tracing proxies', () => {
  const finite = (v: readonly number[]): boolean => v.every(Number.isFinite);

  it('every primitive is finite and non-degenerate', () => {
    const t = track(KINDS.map((k, i) => gate(k, { index: i, pos: [i * 8, 2, 0] })), [
      { kind: 'wall', pos: [0, 0, 5], yaw: 0.3, size: [3, 1.2, 0.3] },
      { kind: 'rock', pos: [3, 0, 5], yaw: 0.3, size: [1.4, 1, 1.1] },
      { kind: 'tree', pos: [6, 0, 5], yaw: 0, size: [0.3, 9, 0.3] },
    ]);
    for (const p of buildTrackProxies(t, flat)) {
      if (p.type === 'obb') {
        expect(finite([...p.center, ...p.half, ...p.rot])).toBe(true);
        expect(Math.min(...p.half)).toBeGreaterThan(0);
        expect(Math.hypot(...p.rot)).toBeCloseTo(1, 5);
      } else if (p.type === 'capsule') {
        expect(finite([...p.a, ...p.b, p.radius])).toBe(true);
        expect(p.radius).toBeGreaterThan(0);
      }
    }
  });

  it('stays under the primitive cap with a big course by coarsening the round frames', () => {
    const gates = Array.from({ length: 40 }, (_, i) => gate(i % 2 ? 'hoop' : 'arch', { index: i, pos: [i * 6, 2, 0] }));
    const prims = buildTrackProxies(track(gates), flat);
    expect(prims.length).toBeLessThanOrEqual(RT_PRIM_CAP);
    expect(prims.length).toBeGreaterThan(gates.length * 4);
  });

  it('caps cones and keeps the large obstacles when the budget runs out', () => {
    const cones: TrackObstacle[] = Array.from({ length: 200 }, (_, i) => ({ kind: 'cone', pos: [i, 0, 0], yaw: 0, size: [0.14, 0.5, 0.14] }));
    const wall: TrackObstacle = { kind: 'wall', pos: [0, 0, 9], yaw: 0, size: [3, 1.2, 0.3] };
    const prims = buildTrackProxies(track([gate('square')], [...cones, wall]), flat);
    const capsules = prims.filter((p) => p.type === 'capsule' && p.radius === 0.1).length;
    expect(capsules).toBe(RT_CONE_CAP);
    expect(prims.some((p) => p.type === 'obb' && p.half[0] === 1.5)).toBe(true);

    const tight = buildTrackProxies(track([gate('square')], [wall, ...cones]), flat, 30);
    expect(tight.length).toBeLessThanOrEqual(30);
    expect(tight.some((p) => p.type === 'obb' && p.half[0] === 1.5)).toBe(true);
  });
});

describe('glow ribbons', () => {
  const strips = [
    { gate: 2, pts: [[0, 0, 0], [1, 0, 0], [2, 1, 0]] as [number, number, number][] },
    { gate: 5, pts: [[0, 0, 3], [0, 2, 3]] as [number, number, number][] },
  ];

  it('emits two vertices per point and two triangles per segment', () => {
    const m = buildGlowMesh(strips);
    expect(m.vertices.length).toBe(5 * 2 * GLOW_FLOATS);
    expect(m.indices.length).toBe(3 * 6);
  });

  it('carries unit tangents, both sides and the gate index', () => {
    const m = buildGlowMesh(strips);
    const sides = new Set<number>();
    for (let v = 0; v < m.vertices.length; v += GLOW_FLOATS) {
      expect(Math.hypot(m.vertices[v + 3], m.vertices[v + 4], m.vertices[v + 5])).toBeCloseTo(1, 5);
      sides.add(m.vertices[v + 6]);
      expect([2, 5]).toContain(m.vertices[v + 7]);
    }
    expect(Array.from(sides).sort()).toEqual([-1, 1]);
  });

  it('never joins the end of one strip to the start of the next', () => {
    const m = buildGlowMesh(strips);
    const firstOfSecond = 3 * 2;
    for (let i = 0; i < m.indices.length; i += 6) {
      const group = Array.from(m.indices.slice(i, i + 6));
      const crossing = group.some((k) => k < firstOfSecond) && group.some((k) => k >= firstOfSecond);
      expect(crossing).toBe(false);
    }
  });

  it('an empty strip list gives an empty mesh', () => {
    const m = buildGlowMesh([]);
    expect(m.vertices.length).toBe(0);
    expect(m.indices.length).toBe(0);
  });
});

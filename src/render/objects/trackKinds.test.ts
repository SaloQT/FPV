/** Meshes and RT proxies of the window, ladder, tunnel, hurdle and drop gates, of rolled and pitched frames, and of the composite obstacles. */
import { describe, expect, it } from 'vitest';
import type { GateKind, TerrainSampler, TrackData, TrackGate, TrackObstacle, Vec3 } from '../../contracts';
import { gateColliders, obstacleColliders } from '../../world/track/colliders';
import { archSpring, insideOpening, trackGateFrame } from '../../world/track/gate';
import {
  BRIDGE_PARAPET, OBSTACLE_SIZES, archFeet, buildFrame, frameFeet, ladderGroups, obstacleParts, tunnelSleeve, windowWall,
} from '../../world/track/kindGeometry';
import type { RTPrimitive } from '../contracts';
import { buildGate, buildLadderRails } from './gateMeshes';
import { CONTAINER_COLOURS, KIND } from './materials';
import { MeshBuilder, VERTEX_FLOATS, type MeshData } from './meshBuilder';
import { checkMesh } from './meshCheck';
import { buildObstacle } from './obstacleMeshes';
import { RT_PRIM_CAP, buildTrackProxies, compositePrims } from './trackProxies';
import { buildTrackMesh } from './trackMesh';

const terrain = (height: (x: number, z: number) => number): TerrainSampler => ({ heightAt: height } as unknown as TerrainSampler);
const flat = terrain(() => 0);
const slope = terrain((x, z) => 0.12 * x + 0.05 * z);

const gate = (kind: GateKind, over: Partial<TrackGate> = {}): TrackGate => ({ index: 4, kind, pos: [6, 2.5, -3], yaw: 0.7, roll: 0, pitch: 0, width: 2.4, height: 2, ...over });

const track = (gates: TrackGate[], obstacles: TrackObstacle[] = []): TrackData => ({
  seed: 1, style: 'custom', gates, obstacles, path: [], closed: false, length: 0, start: { pos: [0, 0, -40], yaw: 0 }, laps: 1,
});

function points(m: MeshData): Vec3[] {
  const out: Vec3[] = [];
  for (let i = 0; i < m.vertices.length; i += VERTEX_FLOATS) out.push([m.vertices[i], m.vertices[i + 1], m.vertices[i + 2]]);
  return out;
}

function meshOf(g: TrackGate, sampler: TerrainSampler): { mesh: MeshData; strips: number } {
  const b = new MeshBuilder();
  const built = buildGate(b, g, sampler);
  const mesh = b.finish();
  checkMesh(mesh);
  return { mesh, strips: built.strips.length };
}

/** Gate-local (u, v, w) of a world point in the frame the gate's solids are built in. */
function toLocal(g: TrackGate, p: Vec3, frame = buildFrame(g)): Vec3 {
  const d = [p[0] - g.pos[0], p[1] - g.pos[1], p[2] - g.pos[2]];
  const dot = (a: Vec3): number => d[0] * a[0] + d[1] * a[1] + d[2] * a[2];
  return [dot(frame.right), dot(frame.up), dot(frame.forward)];
}

const lowestAbove = (pts: Vec3[], s: TerrainSampler): number => Math.min(...pts.map((p) => p[1] - s.heightAt(p[0], p[2])));

describe('new gate meshes', () => {
  it('a window wall reaches the ground, rises a metre above the opening and keeps the opening clear', () => {
    const g = gate('window');
    const { mesh } = meshOf(g, slope);
    const pts = points(mesh);
    expect(lowestAbove(pts, slope)).toBeLessThan(0.001);
    const wall = windowWall(g);
    const loc = pts.map((p) => toLocal(g, p));
    expect(Math.max(...loc.map((l) => l[1]))).toBeCloseTo(wall.top, 6);
    expect(Math.max(...loc.map((l) => Math.abs(l[0])))).toBeCloseTo(wall.half, 6);
    for (const [u, v] of loc) expect(Math.abs(u) < g.width / 2 - 0.005 && Math.abs(v) < g.height / 2 - 0.005).toBe(false);
    const kinds = new Set<number>();
    for (let i = 0; i < mesh.vertices.length; i += VERTEX_FLOATS) kinds.add(mesh.vertices[i + 8]);
    expect(kinds.has(KIND.GATE_PANEL)).toBe(true);
    expect(kinds.has(KIND.GATE_LED)).toBe(true);
  });

  it('a tunnel is open from end to end inside its opening and its walls stand on the ground', () => {
    const g = gate('tunnel', { width: 2.6, height: 2.4, pos: [6, 1.8, -3], depth: 7 });
    const { mesh, strips } = meshOf(g, slope);
    expect(strips).toBe(9);
    const s = tunnelSleeve(g);
    const pts = points(mesh);
    for (const p of pts) {
      const [u, v, w] = toLocal(g, p);
      if (w > -1 && w < s.depth + 1) expect(Math.abs(u) < g.width / 2 - 0.005 && Math.abs(v) < g.height / 2 - 0.005, `${u} ${v} ${w}`).toBe(false);
    }
    expect(lowestAbove(pts, slope)).toBeLessThan(0.001);
    const ws = pts.map((p) => toLocal(g, p)[2]);
    expect(Math.max(...ws)).toBeGreaterThan(s.depth);
    expect(Math.min(...ws)).toBeLessThan(0);
  });

  it('a hurdle stands on its posts with a sill bar under the opening and nothing below it', () => {
    const g = gate('hurdle', { width: 5, height: 1.5, pos: [6, 0.45 + 0.75, -3] });
    const { mesh, strips } = meshOf(g, slope);
    expect(strips).toBe(4);
    const pts = points(mesh);
    expect(lowestAbove(pts, slope)).toBeLessThan(0.001);
    for (const p of pts) {
      const [u, v] = toLocal(g, p);
      if (p[1] - slope.heightAt(p[0], p[2]) < 0.08) continue; // the ballast plates lie (level) on the sloped ground
      // The LED ridge on the posts stands 2.5 mm proud of the tube's inner face.
      // Between the posts there is only the top bar and the sill bar, which lies just under the opening.
      if (Math.abs(u) < g.width / 2 - 0.003) expect(v >= g.height / 2 - 0.003 || (v <= -g.height / 2 + 0.003 && v > -g.height / 2 - 0.2), `u ${u} v ${v}`).toBe(true);
    }
  });

  it('a drop ring keeps the shaft through it clear and stands on one post beside it', () => {
    for (const roll of [0, 1.1]) {
      const g = gate('drop', { pitch: -Math.PI / 2, roll, width: 3, height: 3, pos: [6, 7, -3] });
      const { mesh } = meshOf(g, slope);
      const f = trackGateFrame(g);
      const pts = points(mesh);
      expect(lowestAbove(pts, slope)).toBeLessThan(0.001);
      for (const p of pts) {
        const [u, v] = toLocal(g, p, f);
        expect(insideOpening(g, u * 1.02, v * 1.02)).toBe(false);
      }
      // Everything below the ring is the post, outside the ring on the right.
      for (const p of pts) if (p[1] < g.pos[1] - 0.1) expect(toLocal(g, p, f)[0]).toBeGreaterThan(g.width / 2);
    }
  });

  it('legs of rolled and horizontal frames leave the lowest corners', () => {
    for (const over of [{ roll: 1.2 }, { roll: Math.PI / 4 }, { pitch: -Math.PI / 2 }, { pitch: 0.5 }]) {
      const g = gate('square', { pos: [6, 4, -3], ...over });
      const f = trackGateFrame(g);
      const feet = frameFeet(g, f).map(([u, v]): Vec3 => [0, 1, 2].map((k) => g.pos[k] + f.right[k] * u + f.up[k] * v) as Vec3);
      const lowFoot = Math.min(...feet.map((p) => p[1]));
      const { mesh } = meshOf(g, flat);
      const pts = points(mesh);
      // Below the frame there is nothing but the two legs and their plates.
      const below = pts.filter((p) => p[1] < lowFoot - 0.1);
      expect(below.length).toBeGreaterThan(0);
      for (const p of below) expect(Math.min(...feet.map((q) => Math.hypot(p[0] - q[0], p[2] - q[2])))).toBeLessThan(0.21 * Math.SQRT2 + 1e-6);
      for (const q of feet) expect(below.some((p) => Math.hypot(p[0] - q[0], p[2] - q[2]) < 0.05 && p[1] < 0.01)).toBe(true);
    }
  });

  it('legs of rolled and upside-down arches leave points near the lowest part of the arch, as the colliders and RT proxies do', () => {
    for (const over of [{ roll: Math.PI }, { roll: Math.PI / 2 }, { roll: -Math.PI / 2 }, { pitch: -Math.PI / 2 }]) {
      const g = gate('arch', { pos: [6, 5, -3], height: 3, ...over });
      const f = trackGateFrame(g);
      const r = g.width / 2 + 0.03;
      const feet = archFeet(g, f, archSpring(g)).map(([u, v]): Vec3 => [0, 1, 2].map((k) => g.pos[k] + f.right[k] * u + f.up[k] * v) as Vec3);
      const { mesh } = meshOf(g, flat);
      const pts = points(mesh);
      const frame = pts.filter((p) => !feet.some((q) => Math.hypot(p[0] - q[0], p[2] - q[2]) < 0.21 * Math.SQRT2 + 1e-6));
      const low = Math.min(...frame.map((p) => p[1]));
      for (const q of feet) {
        expect(q[1] - low, JSON.stringify(over)).toBeLessThan(0.3 * r + 0.05);
        expect(pts.some((p) => Math.hypot(p[0] - q[0], p[2] - q[2]) < 0.05 && p[1] < 0.01), JSON.stringify(over)).toBe(true);
      }
      // Below the arch there is nothing but the two legs and their plates.
      for (const p of pts) if (p[1] < low - 0.05) expect(Math.min(...feet.map((q) => Math.hypot(p[0] - q[0], p[2] - q[2])))).toBeLessThan(0.21 * Math.SQRT2 + 1e-6);
      // The RT legs and the collider legs start at the same feet.
      const prims: RTPrimitive[] = buildTrackProxies(track([g]), flat);
      const legTops = prims.filter((p) => p.type === 'obb' && p.half[1] > 1).map((p) => (p.type === 'obb' ? p.center[1] + p.half[1] : 0));
      const boxTops = gateColliders(g, flat).filter((b) => b.half[1] > 1).map((b) => b.center[1] + b.half[1]);
      for (const tops of [legTops, boxTops]) {
        expect(tops.length).toBe(2);
        for (const t of tops) expect(Math.min(...feet.map((q) => Math.abs(q[1] - t)))).toBeLessThan(1e-9);
      }
    }
  });

  it('a ladder gets its two side rails once, from the ground to above the top rung', () => {
    const rungs = [0, 1, 2].map((k) => gate('ladder', { index: k, pos: [6, 2.1 + k * 3.1, -3], yaw: 0.7 + (k % 2) * Math.PI, width: 2.2, height: 1.8 }));
    const t = track(rungs);
    const groups = ladderGroups(t.gates);
    expect(groups.length).toBe(1);
    const b = new MeshBuilder();
    buildLadderRails(b, t.gates, groups[0], slope);
    const rails = b.finish();
    checkMesh(rails);
    const pts = points(rails);
    expect(lowestAbove(pts, slope)).toBeLessThan(0.001);
    expect(Math.max(...pts.map((p) => p[1]))).toBeCloseTo(groups[0].railTop, 6);
    for (let i = 0; i < rails.vertices.length; i += VERTEX_FLOATS) expect(rails.vertices[i + 11]).toBe(2);
    const built = buildTrackMesh(t, slope);
    checkMesh(built.mesh);
    expect(built.strips.length).toBe(12);
  });

  it('every new kind casts RT proxies that are finite, and a ladder adds two rails', () => {
    const kinds: GateKind[] = ['window', 'tunnel', 'hurdle', 'drop', 'ladder'];
    for (const kind of kinds) {
      const g = gate(kind, kind === 'drop' ? { pitch: -Math.PI / 2, pos: [6, 7, -3] } : {});
      const prims = buildTrackProxies(track([g]), slope);
      expect(prims.length, kind).toBeGreaterThanOrEqual(kind === 'window' ? 4 : 5);
      for (const p of prims) expect(finitePrim(p)).toBe(true);
    }
    const ladder = [0, 1].map((k) => gate('ladder', { index: k, pos: [6, 2.1 + k * 3.1, -3], width: 2.2, height: 1.8 }));
    expect(buildTrackProxies(track(ladder), flat).length).toBe(2 * 4 + 2);
  });
});

function finitePrim(p: RTPrimitive): boolean {
  const ok = (v: readonly number[]): boolean => v.every(Number.isFinite);
  if (p.type === 'obb') return ok([...p.center, ...p.half, ...p.rot]) && Math.min(...p.half) > 0 && Math.abs(Math.hypot(...p.rot) - 1) < 1e-5;
  if (p.type === 'capsule') return ok([...p.a, ...p.b, p.radius]) && p.radius > 0;
  return true;
}

describe('composite obstacle meshes', () => {
  const KINDS = Object.keys(OBSTACLE_SIZES) as (keyof typeof OBSTACLE_SIZES)[];
  for (const kind of KINDS) {
    it(`${kind} builds a sound mesh inside its footprint, from the ground to its top`, () => {
      const r = OBSTACLE_SIZES[kind];
      for (const t of [0, 1]) {
        const size: Vec3 = [r.x[0] + (r.x[1] - r.x[0]) * t, r.y[0] + (r.y[1] - r.y[0]) * t, r.z[0] + (r.z[1] - r.z[0]) * t];
        const o: TrackObstacle = { kind, pos: [4, 1.5, -2], yaw: 0, size };
        const b = new MeshBuilder();
        buildObstacle(b, o, 3, []);
        const m = b.finish();
        checkMesh(m);
        const pts = points(m);
        const lo = Math.min(...pts.map((p) => p[1]));
        const hi = Math.max(...pts.map((p) => p[1]));
        expect(lo).toBeGreaterThan(1.5 - 0.16);
        expect(lo).toBeLessThan(1.5 + 0.06);
        expect(hi).toBeGreaterThan(1.5 + size[1] * 0.85);
        expect(hi).toBeLessThanOrEqual(1.5 + size[1] + (kind === 'bridge' ? BRIDGE_PARAPET : 0) + 0.06);
        for (const p of pts) {
          expect(Math.abs(p[0] - 4)).toBeLessThanOrEqual(size[0] / 2 + 0.002);
          expect(Math.abs(p[2] + 2)).toBeLessThanOrEqual(size[2] / 2 + 0.002);
        }
      }
    });
  }

  it('stacked containers get two colours and a tall stack is two units', () => {
    const b = new MeshBuilder();
    buildObstacle(b, { kind: 'container', pos: [0, 0, 0], yaw: 0.3, size: [6.1, 5.2, 2.44] }, 1, []);
    const m = b.finish();
    const colours = new Set<number>();
    for (let i = 0; i < m.vertices.length; i += VERTEX_FLOATS) if (m.vertices[i + 8] === KIND.CONTAINER) colours.add(m.vertices[i + 10]);
    expect(colours.size).toBe(2);
    for (const c of colours) expect(c).toBeLessThan(CONTAINER_COLOURS.length);
  });

  it('posts and piers reach the ground on a slope', () => {
    for (const kind of ['beam', 'bridge', 'scaffold', 'tower'] as const) {
      const r = OBSTACLE_SIZES[kind];
      const o: TrackObstacle = { kind, pos: [0, slope.heightAt(0, 0), 0], yaw: 0.4, size: [r.x[1], r.y[0], r.z[1]] };
      const b = new MeshBuilder();
      buildObstacle(b, o, 0, [], slope);
      const pts = points(b.finish());
      // Every support foot is at or under the ground: the lowest vertex near each ground support (a slim post's centre, or the
      // corners of a wide one such as a pier or the tower's leg square) is at or below the terrain.
      const c = Math.cos(o.yaw), s = Math.sin(o.yaw);
      for (const p of obstacleParts(o).filter((q) => q.role === 'support' && q.c[1] - q.h[1] < 0.5)) {
        const feet: [number, number][] = p.h[0] < 0.3 ? [[p.c[0], p.c[2]]] : [-1, 1].flatMap((a) => [-1, 1].map((d): [number, number] => [p.c[0] + a * (p.h[0] - 0.15), p.c[2] + d * (p.h[2] - 0.15)]));
        for (const [lx, lz] of feet) {
          const wx = o.pos[0] + c * lx + s * lz;
          const wz = o.pos[2] - s * lx + c * lz;
          const near = pts.filter((q) => Math.hypot(q[0] - wx, q[2] - wz) < 0.3);
          expect(near.length, kind).toBeGreaterThan(0);
          expect(Math.min(...near.map((q) => q[1] - slope.heightAt(q[0], q[2]))), kind).toBeLessThan(0.001);
        }
      }
    }
  });

  it('containers and pillars stand on a slope with no gap under the downhill side', () => {
    for (const kind of ['container', 'pillar'] as const) {
      const r = OBSTACLE_SIZES[kind];
      for (const yaw of [0.4, 2]) {
        const o: TrackObstacle = { kind, pos: [0, slope.heightAt(0, 0), 0], yaw, size: [r.x[1], r.y[0], r.z[1]] };
        const b = new MeshBuilder();
        buildObstacle(b, o, 0, [], slope);
        const m = b.finish();
        checkMesh(m);
        const pts = points(m);
        const c = Math.cos(yaw), s = Math.sin(yaw);
        for (const [a, d] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
          const lx = a * (o.size[0] / 2 - 0.15);
          const lz = d * (o.size[2] / 2 - 0.15);
          const wx = c * lx + s * lz;
          const wz = -s * lx + c * lz;
          const near = pts.filter((q) => Math.hypot(q[0] - wx, q[2] - wz) < 0.3);
          expect(Math.min(...near.map((q) => q[1] - slope.heightAt(q[0], q[2]))), `${kind} yaw ${yaw}`).toBeLessThan(0.001);
        }
      }
    }
  });

  it('the colliders hold the whole mesh of the solid kinds, on flat ground and on a slope', () => {
    for (const [kind, sampler] of [['container', undefined], ['pillar', undefined], ['beam', undefined], ['bridge', undefined], ['container', slope], ['pillar', slope]] as const) {
      const r = OBSTACLE_SIZES[kind];
      const o: TrackObstacle = { kind, pos: [3, sampler ? sampler.heightAt(3, 2) : 1, 2], yaw: 0.6, size: [r.x[1], r.y[1], r.z[1]] };
      const b = new MeshBuilder();
      buildObstacle(b, o, 0, [], sampler);
      const boxes = [] as ReturnType<typeof gateColliders>;
      obstacleColliders(o, boxes, sampler);
      const pad = 0.012;
      for (const p of points(b.finish())) {
        if (!sampler && p[1] < o.pos[1] + 0.02) continue;
        const inAny = boxes.some((bx) => {
          const c = Math.cos(bx.yaw), s = Math.sin(bx.yaw);
          const dx = p[0] - bx.center[0], dz = p[2] - bx.center[2];
          return Math.abs(c * dx - s * dz) <= bx.half[0] + pad && Math.abs(p[1] - bx.center[1]) <= bx.half[1] + pad && Math.abs(s * dx + c * dz) <= bx.half[2] + pad;
        });
        expect(inAny, `${kind} ${p.map((x) => x.toFixed(2))}`).toBe(true);
      }
    }
  });
});

describe('composite RT proxies and the cap', () => {
  it('every composite kind emits finite proxies; a tower is legs, platform and mast', () => {
    for (const kind of Object.keys(OBSTACLE_SIZES) as (keyof typeof OBSTACLE_SIZES)[]) {
      const r = OBSTACLE_SIZES[kind];
      const out: RTPrimitive[] = [];
      compositePrims({ kind, pos: [0, 0, 0], yaw: 1, size: [r.x[1], r.y[1], r.z[1]] }, slope, 0, out);
      expect(out.length).toBeGreaterThan(0);
      for (const p of out) expect(finitePrim(p)).toBe(true);
      if (kind === 'tower') expect(out.length).toBe(6);
    }
  });

  it('a full course of every gate kind and many composite obstacles stays under the cap, adding composites whole', () => {
    const gates: TrackGate[] = [];
    const kinds: GateKind[] = ['square', 'hoop', 'window', 'tunnel', 'hurdle', 'drop', 'arch', 'dive'];
    for (let i = 0; i < 40; i++) {
      const kind = kinds[i % kinds.length];
      gates.push(gate(kind, { index: i, pos: [i * 10, kind === 'drop' ? 7 : 2.5, 0], pitch: kind === 'drop' ? -Math.PI / 2 : kind === 'dive' ? -0.5 : 0 }));
    }
    const obstacles: TrackObstacle[] = [];
    const ok = Object.keys(OBSTACLE_SIZES) as (keyof typeof OBSTACLE_SIZES)[];
    for (let i = 0; i < 60; i++) {
      const kind = ok[i % ok.length];
      const r = OBSTACLE_SIZES[kind];
      obstacles.push({ kind, pos: [i * 7, 0, 20], yaw: i, size: [r.x[1], r.y[1], r.z[1]] });
    }
    const prims = buildTrackProxies(track(gates, obstacles), flat);
    expect(prims.length).toBeLessThanOrEqual(RT_PRIM_CAP);
    // Every gate keeps its proxies (rings coarsened and plates dropped to make room) and the obstacles fill what is left.
    expect(prims.length).toBeGreaterThan(RT_PRIM_CAP * 0.9);
    for (const p of prims) expect(finitePrim(p)).toBe(true);
    const gateOnly = buildTrackProxies(track(gates), flat);
    expect(gateOnly.length).toBeLessThan(RT_PRIM_CAP);
    expect(prims.slice(0, gateOnly.length)).toEqual(gateOnly);
  });

  it('the tunnel and window proxies keep the opening clear', () => {
    for (const g of [gate('tunnel', { width: 2.6, height: 2.4 }), gate('window')]) {
      const s = g.kind === 'tunnel' ? tunnelSleeve(g).depth : 0;
      for (const p of buildTrackProxies(track([g]), flat)) {
        if (p.type !== 'obb') continue;
        const [u, v, w] = toLocal(g, p.center);
        // An OBB in the gate basis: its local extents are half[0] along u, half[1] along v, half[2] along w.
        const overlaps = Math.abs(u) - p.half[0] < g.width / 2 - 0.01 && Math.abs(v) - p.half[1] < g.height / 2 - 0.01 && w + p.half[2] > -0.01 && w - p.half[2] < s + 0.01;
        expect(overlaps).toBe(false);
      }
    }
  });
});

describe('gate colliders match the meshes', () => {
  it('every mesh vertex of a window, tunnel or hurdle frame lies inside or on a collider box', () => {
    for (const g of [gate('window'), gate('tunnel', { width: 2.6, height: 2.4, pos: [6, 1.8, -3] }), gate('hurdle', { width: 5, height: 1.5, pos: [6, 1.2, -3] })]) {
      const boxes = gateColliders(g, flat);
      const { mesh } = meshOf(g, flat);
      const pad = 0.015;
      let outside = 0;
      for (const p of points(mesh)) {
        if (p[1] < 0.03) continue;
        const inAny = boxes.some((bx) => {
          const c = Math.cos(bx.yaw), s = Math.sin(bx.yaw);
          const dx = p[0] - bx.center[0], dz = p[2] - bx.center[2];
          return Math.abs(c * dx - s * dz) <= bx.half[0] + pad && Math.abs(p[1] - bx.center[1]) <= bx.half[1] + pad && Math.abs(s * dx + c * dz) <= bx.half[2] + pad;
        });
        if (!inAny) outside++;
      }
      expect(outside, g.kind).toBe(0);
    }
  });
});

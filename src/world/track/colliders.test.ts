import { beforeAll, describe, expect, it } from 'vitest';
import type { GateKind, ObstacleCollider, TerrainSampler, TrackData, TrackGate, TrackObstacle, TrackStyle, Vec3 } from '../../contracts';
import { distanceToBox, gateColliders, obstacleCollider, obstacleColliders, trackColliders } from './colliders';
import { GATE_TUBE, archSpring, insideOpening, trackGateFrame } from './gate';
import { generateTrack } from './generator';
import {
  FLY_UNDER_CLEARANCE, FLY_UNDER_SUPPORT_CLEARANCE, OBSTACLE_SIZES, WINDOW_HEAD, buildFrame, flyUnder, obstacleParts, obstacleToWorld, towerLayout, towerTiers, tunnelSleeve,
} from './kindGeometry';
import { makeTestSampler } from './testTerrain';

const STYLES: TrackStyle[] = ['race', 'freestyle', 'mountain', 'sprint'];
let sampler: TerrainSampler;
const tracks: TrackData[] = [];

beforeAll(() => {
  sampler = makeTestSampler({ seed: 3 });
  for (const style of STYLES) for (let seed = 1; seed <= 10; seed++) tracks.push(generateTrack({ seed, style }, sampler));
}, 60000);

/** True when the point is strictly inside the oriented box. */
function inside(b: ObstacleCollider, p: Vec3): boolean {
  const c = Math.cos(b.yaw);
  const s = Math.sin(b.yaw);
  const dx = p[0] - b.center[0];
  const dz = p[2] - b.center[2];
  return Math.abs(c * dx - s * dz) < b.half[0] && Math.abs(p[1] - b.center[1]) < b.half[1] && Math.abs(s * dx + c * dz) < b.half[2];
}

function gate(over: Partial<TrackGate> = {}): TrackGate {
  return { index: 0, kind: 'square', pos: [0, 8, 0], yaw: 0, roll: 0, pitch: 0, width: 2, height: 2, ...over };
}

describe('trackColliders', () => {
  it('has a box for every obstacle and at least four per gate, with sane extents', () => {
    for (const t of tracks) {
      const boxes = trackColliders(t, sampler);
      const obstacleBoxes: ObstacleCollider[] = [];
      for (const o of t.obstacles) obstacleColliders(o, obstacleBoxes, sampler);
      let expected = obstacleBoxes.length;
      for (const g of t.gates) {
        const n = gateColliders(g, sampler).length;
        expect(n).toBeGreaterThanOrEqual(g.kind === 'flag' ? 2 : 4);
        expected += n;
      }
      expect(boxes.length).toBe(expected);
      expect(boxes.length).toBeLessThan(6000);
      for (const b of boxes) {
        expect(b.kind).toBe('box');
        expect(b.center.every(Number.isFinite) && b.half.every((h) => Number.isFinite(h) && h > 0) && Number.isFinite(b.yaw)).toBe(true);
      }
    }
  });

  it('builds a plain square gate from tubes 0.06 m thick: two posts, two bars, legs and plates', () => {
    const boxes = gateColliders(gate());
    expect(boxes.length).toBe(8);
    const posts = boxes.filter((b) => b.half[1] > 1 && b.half[0] < 0.05 && Math.abs(b.center[1] - 8) < 0.01);
    expect(posts.length).toBe(2);
    for (const b of posts) expect(b.half[0]).toBeCloseTo(GATE_TUBE / 2, 6);
    const bars = boxes.filter((b) => b.half[0] > 0.9 && b.half[1] < 0.05);
    expect(bars.length).toBe(2);
  });

  it('turns obstacles into boxes on the ground: round ones from radius x height, rocks and walls from full extents', () => {
    const cone = obstacleCollider({ kind: 'cone', pos: [3, 2, 4], yaw: 0, size: [0.15, 0.45, 0.15] });
    expect(cone.half).toEqual([0.15, 0.225, 0.15]);
    expect(cone.center[1]).toBeCloseTo(2.225, 9);
    const wall = obstacleCollider({ kind: 'wall', pos: [0, 1, 0], yaw: 0.5, size: [6, 1, 0.4] });
    expect(wall.half).toEqual([3, 0.5, 0.2]);
    expect(wall.yaw).toBe(0.5);
  });

  it('puts every box of an upright gate on the gate yaw', () => {
    for (const t of tracks) {
      for (const g of t.gates) for (const b of gateColliders(g, sampler)) expect(b.yaw).toBe(g.yaw);
    }
  });
});

describe('gate openings stay clear', () => {
  it('no box reaches into the opening beyond a 0.12 m margin (0.16 m when rolled or pitched), every kind', () => {
    const kinds: GateKind[] = ['square', 'arch', 'hoop', 'dive', 'start', 'finish', 'flag', 'window', 'ladder', 'tunnel', 'hurdle', 'drop'];
    const upright = new Set<GateKind>(['flag', 'window', 'ladder', 'tunnel', 'hurdle']);
    for (const kind of kinds) {
      const poses = kind === 'drop'
        ? [[0, 0, -Math.PI / 2], [0.7, 0.3, -Math.PI / 2], [2.1, -1.2, -Math.PI / 2]]
        : [[0, 0, 0], [0.7, 0.3, 0], [2.1, -0.4, 0], [-1, 0, kind === 'dive' ? -1.05 : 0], [4, 0.2, 0.5], [1.3, Math.PI / 4, 0], [-2.2, 1.3, 0]];
      for (const [yaw, roll, pitch] of poses) {
        if (upright.has(kind) && (roll !== 0 || pitch !== 0)) continue;
        const g = gate({ kind, yaw, roll, pitch, width: 2.4, height: 2.6, pos: [5, 9, -7] });
        const boxes = gateColliders(g);
        const margin = roll !== 0 || pitch !== 0 ? 0.16 : 0.12;
        const shrunk = { ...g, width: g.width - 2 * margin, height: g.height - 2 * margin };
        const f = trackGateFrame(g);
        let hits = 0;
        for (let u = -1.2; u <= 1.2; u += 0.05) {
          for (let v = -1.3; v <= 1.5; v += 0.05) {
            if (!insideOpening(shrunk, u, v)) continue;
            for (const w of [-0.05, 0, 0.05]) {
              const p: Vec3 = [0, 1, 2].map((k) => g.pos[k] + f.right[k] * u + f.up[k] * v + f.forward[k] * w) as Vec3;
              for (const b of boxes) if (inside(b, p)) hits++;
            }
          }
        }
        expect(hits, `${kind} yaw ${yaw} roll ${roll} pitch ${pitch}`).toBe(0);
      }
    }
  });

  it('legs reach the ground when a sampler is given', () => {
    for (const t of tracks.slice(0, 12)) {
      for (const g of t.gates) {
        if (g.kind === 'flag') continue;
        const boxes = gateColliders(g, sampler);
        const low = Math.min(...boxes.map((b) => b.center[1] - b.half[1]));
        const ground = Math.min(sampler.heightAt(g.pos[0], g.pos[2]), sampler.heightAt(g.pos[0] + 2, g.pos[2]), sampler.heightAt(g.pos[0] - 2, g.pos[2]));
        expect(low).toBeLessThan(ground + 1.2);
      }
    }
  });
});

describe('centreline versus colliders', () => {
  it('the path never enters any collider box (checked every 5 cm)', () => {
    // One expect at the end: an expect per sample made this test slow under load.
    const hits: string[] = [];
    for (const track of tracks) {
      const boxes = trackColliders(track, sampler);
      const reach = boxes.map((b) => Math.hypot(b.half[0], b.half[1], b.half[2]) + 0.1);
      const m = track.path.length;
      const edges = track.closed ? m : m - 1;
      for (let i = 0; i < edges; i++) {
        const a = track.path[i];
        const b = track.path[(i + 1) % m];
        const near: number[] = [];
        for (let k = 0; k < boxes.length; k++) {
          const c = boxes[k].center;
          if (Math.abs(c[0] - a[0]) < reach[k] + 1 && Math.abs(c[2] - a[2]) < reach[k] + 1 && Math.abs(c[1] - a[1]) < reach[k] + 1) near.push(k);
        }
        if (near.length === 0) continue;
        for (let s = 0; s <= 20; s++) {
          const p: Vec3 = [a[0] + ((b[0] - a[0]) * s) / 20, a[1] + ((b[1] - a[1]) * s) / 20, a[2] + ((b[2] - a[2]) * s) / 20];
          for (const k of near) if (inside(boxes[k], p)) hits.push(`${track.style} seed ${track.seed} sample ${i} box ${k}`);
        }
      }
    }
    expect(hits).toEqual([]);
  });

  it('the path keeps a body-width margin from every box (0.15 m) apart from the gate it flies through', () => {
    for (const track of tracks.slice(0, 20)) {
      const boxes = trackColliders(track, sampler);
      for (let i = 0; i < track.path.length; i += 2) {
        const p = track.path[i];
        for (const b of boxes) {
          if (Math.abs(b.center[0] - p[0]) > 8 || Math.abs(b.center[2] - p[2]) > 8) continue;
          expect(distanceToBox(b, p[0], p[1], p[2])).toBeGreaterThan(0.15);
        }
      }
    }
  });
});

/** World point at gate-local (u, v, w) in the frame the solids are built in. */
function local(g: TrackGate, u: number, v: number, w = 0): Vec3 {
  const f = buildFrame(g);
  return [0, 1, 2].map((k) => g.pos[k] + f.right[k] * u + f.up[k] * v + f.forward[k] * w) as Vec3;
}

const hitsAt = (boxes: ObstacleCollider[], p: Vec3): number => boxes.filter((b) => inside(b, p)).length;

/** Boxes the physics would consider for a body at p: centre within the box's bounding radius + 0.2 m (sim/collision.ts and world.wgsl). */
const nearCount = (boxes: ObstacleCollider[], p: Vec3): number =>
  boxes.filter((b) => Math.hypot(p[0] - b.center[0], p[1] - b.center[1], p[2] - b.center[2]) < Math.hypot(b.half[0], b.half[1], b.half[2]) + 0.2).length;

const flatSampler = { heightAt: () => 0 } as unknown as TerrainSampler;
const sloped = { heightAt: (x: number, z: number) => 0.15 * x - 0.05 * z } as unknown as TerrainSampler;

const lowest = (boxes: ObstacleCollider[]): number => Math.min(...boxes.map((b) => b.center[1] - b.half[1]));
const highest = (boxes: ObstacleCollider[]): number => Math.max(...boxes.map((b) => b.center[1] + b.half[1]));

function trackOf(gates: TrackGate[], obstacles: TrackObstacle[] = []): TrackData {
  return { seed: 1, style: 'custom', gates, obstacles, path: [], closed: false, length: 0, start: { pos: [0, 0, 0], yaw: 0 }, laps: 1 };
}

const ladderRungs = (first: number, x: number, z: number, yaw: number, n: number): TrackGate[] =>
  Array.from({ length: n }, (_, k) => gate({ index: first + k, kind: 'ladder', pos: [x, 1.4 + 0.9 + k * 3.1, z], yaw: yaw + (k % 2) * Math.PI, width: 2.2, height: 1.8 }));

describe('new gate kinds', () => {
  it('a window wall stands on the ground, rises WINDOW_HEAD above the opening and leaves the opening and its approach clear', () => {
    const g = gate({ kind: 'window', pos: [4, 2.2, -3], yaw: 0.6, width: 2.4, height: 2 });
    const boxes = gateColliders(g, sloped);
    expect(boxes.length).toBe(4);
    for (const b of boxes) expect(b.yaw).toBe(g.yaw);
    expect(highest(boxes)).toBeCloseTo(g.pos[1] + 1 + WINDOW_HEAD, 9);
    for (const [u, w] of [[-2.8, -0.12], [2.8, 0.12], [0, 0]]) {
      const p = local(g, u, 0, w);
      expect(lowest(boxes)).toBeLessThanOrEqual(sloped.heightAt(p[0], p[2]));
    }
    for (let u = -1.1; u <= 1.1; u += 0.1) for (let v = -0.9; v <= 0.9; v += 0.1) for (const w of [-3, -1, 0, 1, 3]) expect(hitsAt(boxes, local(g, u, v, w))).toBe(0);
    // Solid beside, above and below the opening.
    for (const [u, v] of [[-2, 0], [2, 0], [0, 1.5], [0, -1.1]]) expect(hitsAt(boxes, local(g, u, v, 0))).toBe(1);
  });

  it('a tunnel is clear from end to end inside its opening, with walls to the ground and a roof', () => {
    const g = gate({ kind: 'tunnel', pos: [0, 1.8, 0], yaw: -0.4, width: 2.6, height: 2.4, depth: 7 });
    const boxes = gateColliders(g, sloped);
    const s = tunnelSleeve(g);
    expect(s.depth).toBe(7);
    expect(boxes.length).toBe(12);
    for (let w = -2; w <= s.depth + 2; w += 0.25) {
      for (let u = -1.25; u <= 1.25; u += 0.25) for (let v = -1.15; v <= 1.15; v += 0.23) expect(hitsAt(boxes, local(g, u, v, w)), `u ${u} v ${v} w ${w}`).toBe(0);
    }
    // Up to the visible roof underside the sleeve is open, apart from the frames' top bars and the LED tube along the centre line.
    const hh = g.height / 2;
    for (let w = 0.2; w <= s.depth - 0.2; w += 0.2) {
      for (const u of [-1, -0.5, -0.1, 0.1, 0.5, 1]) expect(hitsAt(boxes, local(g, u, (hh + s.roof) / 2, w)), `u ${u} w ${w}`).toBe(0);
    }
    for (const w of [0, s.depth]) expect(hitsAt(boxes, local(g, 0.5, (hh + s.roof) / 2, w))).toBe(1);
    expect(hitsAt(boxes, local(g, 0, (hh + s.roof) / 2, s.depth / 2))).toBe(1);
    for (const w of [0.5, s.depth / 2, s.depth - 0.5]) {
      for (const side of [-1, 1]) expect(hitsAt(boxes, local(g, side * (s.inner + s.outer) / 2, 0, w))).toBe(1);
      expect(hitsAt(boxes, local(g, 0, (s.roof + s.roofTop) / 2, w))).toBe(1);
      for (const side of [-1, 1]) {
        const p = local(g, side * s.outer, 0, w);
        expect(lowest(boxes)).toBeLessThan(sloped.heightAt(p[0], p[2]));
      }
    }
  });

  it('a hurdle is two posts, a top bar and a sill bar, with the opening and the gap under the sill bar clear', () => {
    const g = gate({ kind: 'hurdle', pos: [2, 0.45 + 0.75, 1], yaw: 1.9, width: 5, height: 1.5 });
    const boxes = gateColliders(g, flatSampler);
    expect(boxes.length).toBe(6);
    expect(lowest(boxes)).toBeLessThanOrEqual(0);
    for (let u = -2.3; u <= 2.3; u += 0.1) for (let y = -0.7; y < 0.7; y += 0.1) expect(hitsAt(boxes, local(g, u, y, 0))).toBe(0);
    for (let u = -2.3; u <= 2.3; u += 0.1) expect(hitsAt(boxes, local(g, u, 0.1 - g.pos[1], 0))).toBe(0);
    expect(hitsAt(boxes, local(g, 0, 0.75 + GATE_TUBE / 2, 0))).toBe(1);
    expect(hitsAt(boxes, local(g, 0, -0.75 - GATE_TUBE / 2, 0))).toBe(1);
  });

  it('a drop ring hangs off one post and the shaft above and below it is clear', () => {
    for (const roll of [0, 1.1]) {
      const g = gate({ kind: 'drop', pos: [3, 7, -2], yaw: 0.3, roll, pitch: -Math.PI / 2, width: 3, height: 3 });
      const boxes = gateColliders(g, sloped);
      const f = trackGateFrame(g);
      expect(f.forward[1]).toBeCloseTo(-1, 9);
      const post = local(g, 1.5 + 0.5, 0);
      expect(lowest(boxes)).toBeLessThanOrEqual(sloped.heightAt(post[0], post[2]));
      // w runs down the travel axis: approach from 4 m above, exit to 4 m below.
      for (let w = -4; w <= 4; w += 0.2) for (let u = -1.3; u <= 1.3; u += 0.2) for (let v = -1.3; v <= 1.3; v += 0.2) {
        if (u * u + v * v > 1.3 * 1.3) continue;
        const p = trackGateFrame(g);
        const q: Vec3 = [0, 1, 2].map((k) => g.pos[k] + p.right[k] * u + p.up[k] * v + p.forward[k] * w) as Vec3;
        expect(hitsAt(boxes, q)).toBe(0);
      }
    }
  });

  it('a rolled or upside-down arch stands on two legs from near its lowest points', () => {
    for (const over of [{ roll: Math.PI }, { roll: -Math.PI }, { roll: Math.PI / 2 }, { roll: -Math.PI / 2 }, { pitch: -Math.PI / 2 }, { roll: 0.4, pitch: Math.PI / 2 }]) {
      const g = gate({ kind: 'arch', pos: [2, 8, -1], yaw: 0.5, width: 2.4, height: 3, ...over });
      const f = trackGateFrame(g);
      const r = g.width / 2 + GATE_TUBE / 2;
      const vs = archSpring(g);
      // The arch outline in the world: both posts and the arc.
      const outline: number[] = [];
      for (let k = 0; k <= 40; k++) {
        const a = (k / 40) * Math.PI;
        const t = k / 40;
        for (const [u, v] of [[r * Math.cos(a), vs + r * Math.sin(a)], [-r, -g.height / 2 + (vs + g.height / 2) * t], [r, -g.height / 2 + (vs + g.height / 2) * t]]) outline.push(g.pos[1] + f.right[1] * u + f.up[1] * v);
      }
      const low = Math.min(...outline);
      const legs = gateColliders(g, flatSampler).filter((b) => b.half[1] > 1);
      expect(legs.length, JSON.stringify(over)).toBe(2);
      for (const b of legs) {
        expect(b.center[1] - b.half[1]).toBeLessThan(0);
        // An upside-down arch stands on its arc 45 degrees either side of the bottom, 0.29 r above the lowest point.
        expect(b.center[1] + b.half[1] - low, JSON.stringify(over)).toBeLessThan(0.3 * r + 0.01);
      }
      expect(Math.hypot(legs[0].center[0] - legs[1].center[0], legs[0].center[2] - legs[1].center[2]), JSON.stringify(over)).toBeGreaterThan(r);
    }
  });

  it('a ladder gets one pair of rails from the ground to above the top rung, and the air in front of and behind it is clear', () => {
    const rungs = ladderRungs(0, 5, -5, 0.8, 3);
    const track = trackOf(rungs);
    const boxes = trackColliders(track, sloped);
    // Four tubes per rung, then two rails and their plates once for the ladder.
    expect(boxes.length).toBe(3 * 4 + 4);
    const alone = gateColliders(rungs[0], sloped);
    expect(alone.length).toBe(4 + 4);
    const rails = boxes.filter((b) => b.half[1] > 3);
    expect(rails.length).toBe(2);
    for (const b of rails) {
      expect(b.center[1] - b.half[1]).toBeLessThan(sloped.heightAt(b.center[0], b.center[2]));
      expect(b.center[1] + b.half[1]).toBeGreaterThan(rungs[2].pos[1] + 0.9);
    }
    for (const g of rungs) {
      for (let u = -1; u <= 1; u += 0.1) for (let v = -0.8; v <= 0.8; v += 0.1) expect(hitsAt(boxes, local(g, u, v, 0))).toBe(0);
    }
    for (let y = 0.5; y < 10; y += 0.25) for (const w of [-2, -0.4, 0.4, 2]) for (const u of [-0.9, 0, 0.9]) expect(hitsAt(boxes, local(rungs[0], u, y - rungs[0].pos[1], w))).toBe(0);
  });
});

describe('composite obstacles', () => {
  const ob = (kind: TrackObstacle['kind'], size: Vec3, yaw = 0.5): TrackObstacle => ({ kind, pos: [6, 0, -9], yaw, size });

  it('splits each new kind into its parts, all on the obstacle yaw and inside its footprint', () => {
    const counts: [TrackObstacle['kind'], Vec3, number][] = [
      ['container', [6.1, 5.2, 2.44], 1],
      ['pillar', [1.5, 14, 1.5], 1],
      ['beam', [10, 4.5, 0.5], 3],
      ['bridge', [18, 6, 5], 7],
      // 5 tiers of 4 legs and 4 girts, the deck, 4 railings and the mast.
      ['tower', [4, 22, 4], 5 * 8 + 6],
      // 4 bays (5 standards a row), decks at 5/3, 10/3 and 5 m, a mid and a top guardrail front and back.
      ['scaffold', [10, 6, 2], 2 * 5 + 3 + 4],
    ];
    for (const [kind, size, n] of counts) {
      const o = ob(kind, size);
      const boxes: ObstacleCollider[] = [];
      obstacleColliders(o, boxes);
      expect(boxes.length, kind).toBe(n);
      const c = Math.cos(o.yaw);
      const s = Math.sin(o.yaw);
      for (const b of boxes) {
        expect(b.yaw).toBe(o.yaw);
        const dx = b.center[0] - o.pos[0];
        const dz = b.center[2] - o.pos[2];
        expect(Math.abs(c * dx - s * dz) + b.half[0]).toBeLessThanOrEqual(size[0] / 2 + 1e-9);
        expect(Math.abs(s * dx + c * dz) + b.half[2]).toBeLessThanOrEqual(size[2] / 2 + 1e-9);
      }
    }
  });

  it('beams and bridges leave the fly-under gap clear, and their supports reach the ground on a slope', () => {
    for (const [kind, size] of [['beam', [12, 5, 0.5]], ['bridge', [20, 7, 5]]] as const) {
      const o: TrackObstacle = { kind, pos: [0, sloped.heightAt(0, 0), 0], yaw: 0.2, size: [...size] };
      const boxes: ObstacleCollider[] = [];
      obstacleColliders(o, boxes, sloped);
      const fu = flyUnder(o)!;
      const span = Math.hypot(fu.supports[0].center[0] - fu.supports[1].center[0], fu.supports[0].center[2] - fu.supports[1].center[2]) / 2;
      const clearX = span - fu.supports[0].half[0] - FLY_UNDER_SUPPORT_CLEARANCE;
      for (let x = -clearX; x <= clearX; x += 0.5) {
        for (let z = -size[2] / 2 - 2; z <= size[2] / 2 + 2; z += 0.5) {
          const g = obstacleToWorld(o, x, 0, z);
          for (let y = sloped.heightAt(g[0], g[2]) + 0.3; y < fu.underside - FLY_UNDER_CLEARANCE + 1.4; y += 0.25) expect(hitsAt(boxes, [g[0], y, g[2]])).toBe(0);
        }
      }
      for (const sup of fu.supports) {
        const g = sloped.heightAt(sup.center[0], sup.center[2]);
        expect(boxes.some((b) => inside(b, [sup.center[0], g + 0.02, sup.center[2]]))).toBe(true);
      }
    }
  });

  it('containers and pillars reach the ground under every corner of their footprint on a slope', () => {
    for (const [kind, size] of [['container', [6.1, 2.6, 2.44]], ['container', [6.1, 5.2, 2.44]], ['pillar', [2, 12, 2]]] as const) {
      for (const yaw of [0, 0.7, 2.2]) {
        const o: TrackObstacle = { kind, pos: [4, sloped.heightAt(4, -3), -3], yaw, size: [...size] };
        const boxes: ObstacleCollider[] = [];
        obstacleColliders(o, boxes, sloped);
        expect(boxes.length).toBe(1);
        const bottom = boxes[0].center[1] - boxes[0].half[1];
        expect(boxes[0].center[1] + boxes[0].half[1]).toBeCloseTo(o.pos[1] + size[1], 9);
        for (const [x, z] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
          const p = obstacleToWorld(o, (x * size[0]) / 2, 0, (z * size[2]) / 2);
          expect(bottom, `${kind} yaw ${yaw}`).toBeLessThanOrEqual(sloped.heightAt(p[0], p[2]));
        }
      }
    }
  });

  it('a scaffold can be flown through between its decks', () => {
    const o = ob('scaffold', [10, 6, 2], 0);
    const boxes: ObstacleCollider[] = [];
    obstacleColliders(o, boxes);
    // Mid-height of the first lift, across the depth, between two standards.
    const parts = obstacleParts(o);
    const deck = Math.min(...parts.filter((p) => p.role === 'deck').map((p) => p.c[1] - p.h[1]));
    for (let z = -2; z <= 2; z += 0.1) expect(hitsAt(boxes, obstacleToWorld(o, 1.25, deck / 2, z))).toBe(0);
  });
});

/** Gates of every kind in awkward poses, a ladder, and the composite obstacles standing right next to them. */
function denseTrack(): TrackData {
  const gates: TrackGate[] = [];
  const add = (over: Partial<TrackGate>): void => {
    gates.push(gate({ index: gates.length, pos: [gates.length * 9, 3, 0], ...over }));
  };
  for (const roll of [0, 0.3, Math.PI / 4, 1.2]) add({ kind: 'square', roll, width: 2.6, height: 2.6 });
  for (const roll of [0, 0.6]) add({ kind: 'hoop', roll, width: 3, height: 3 });
  add({ kind: 'dive', pitch: -1.05 });
  add({ kind: 'arch', width: 2.4, height: 3 });
  add({ kind: 'window', width: 2.4, height: 2 });
  add({ kind: 'tunnel', width: 2.6, height: 2.4, pos: [gates.length * 9, 1.7, 0] });
  add({ kind: 'hurdle', width: 6, height: 1.8, pos: [gates.length * 9, 1.4, 0] });
  add({ kind: 'drop', pitch: -Math.PI / 2, width: 3.6, height: 3.6, pos: [gates.length * 9, 8, 0] });
  for (const g of ladderRungs(gates.length, gates.length * 9, 0, 0, 4)) gates.push(g);
  const obstacles: TrackObstacle[] = [];
  const kinds = Object.keys(OBSTACLE_SIZES) as (keyof typeof OBSTACLE_SIZES)[];
  gates.forEach((g, i) => {
    const kind = kinds[i % kinds.length];
    const r = OBSTACLE_SIZES[kind];
    obstacles.push({ kind, pos: [g.pos[0], 0, 6], yaw: 0.3 * i, size: [r.x[1], r.y[1], r.z[1]] });
  });
  return trackOf(gates, obstacles);
}

describe('physics near-box limit', () => {
  /** Largest number of boxes the physics would gather anywhere in or around the opening of every gate (it keeps the first 32). */
  function worstNear(track: TrackData, boxes: ObstacleCollider[]): { n: number; at: string } {
    let worst = { n: 0, at: '' };
    for (const g of track.gates) {
      const f = g.kind === 'drop' ? trackGateFrame(g) : buildFrame(g);
      const depth = g.kind === 'tunnel' ? tunnelSleeve(g).depth : 0;
      const hw = g.width / 2 + 0.3;
      const hh = g.height / 2 + 0.3;
      for (let w = -1; w <= depth + 1; w += 0.5) {
        for (let u = -hw; u <= hw + 1e-9; u += hw / 4) {
          for (let v = -hh; v <= hh + 1e-9; v += hh / 4) {
            const p = [0, 1, 2].map((k) => g.pos[k] + f.right[k] * u + f.up[k] * v + f.forward[k] * w) as Vec3;
            const n = nearCount(boxes, p);
            if (n > worst.n) worst = { n, at: `${track.style} ${g.kind} #${g.index} roll ${g.roll.toFixed(2)} u ${u.toFixed(2)} v ${v.toFixed(2)} w ${w}` };
          }
        }
      }
    }
    return worst;
  }

  it('never asks for more than 32 boxes in or near a gate opening, on generated tracks', () => {
    for (const t of tracks) {
      const worst = worstNear(t, trackColliders(t, sampler));
      expect(worst.n, worst.at).toBeLessThanOrEqual(32);
    }
    // About 2.5 s alone; give it room when the whole suite runs in parallel.
  }, 30000);

  it('never asks for more than 32 boxes near the opening of any kind, even rolled 45 degrees or next to a composite obstacle', () => {
    const t = denseTrack();
    const boxes = trackColliders(t, flatSampler);
    const worst = worstNear(t, boxes);
    expect(worst.n).toBeGreaterThan(8);
    expect(worst.n, worst.at).toBeLessThanOrEqual(32);
  });

  it('a course of every gate kind and the largest composite obstacles stays well inside the 6000-box budget', () => {
    const t = denseTrack();
    // Three copies of the dense course side by side: 54 gates and 54 large composites.
    const big = trackOf([], []);
    for (let k = 0; k < 3; k++) {
      for (const g of t.gates) big.gates.push({ ...g, index: big.gates.length, pos: [g.pos[0], g.pos[1], g.pos[2] + k * 40] });
      for (const o of t.obstacles) big.obstacles.push({ ...o, pos: [o.pos[0], o.pos[1], o.pos[2] + k * 40] });
    }
    expect(trackColliders(big, flatSampler).length).toBeLessThan(6000);
  });
});

describe('generated tracks of the new styles', () => {
  const NEW_STYLES: TrackStyle[] = ['technical', 'acro', 'industrial'];
  for (const style of NEW_STYLES) {
    it(`${style}: within the box budget, the near-box limit, and the path never enters a box`, (ctx) => {
      const made: TrackData[] = [];
      // Whether a style generates on this terrain is the generator's own test; this one checks the boxes of whatever it builds,
      // and is skipped while the generator has no track of this style (it is built in a separate unit).
      const failures: string[] = [];
      for (let seed = 1; seed <= 4; seed++) {
        try {
          const t = generateTrack({ seed, style }, sampler);
          if (t.style === style) made.push(t);
        } catch (e) {
          failures.push(String(e));
        }
      }
      if (made.length === 0) ctx.skip(failures[0] ?? `no ${style} tracks`);
      for (const t of made) {
        const boxes = trackColliders(t, sampler);
        expect(boxes.length).toBeLessThan(6000);
        const misses: string[] = [];
        for (let i = 0; i < t.path.length; i++) {
          const p = t.path[i];
          for (let k = 0; k < boxes.length; k++) if (inside(boxes[k], p)) misses.push(`seed ${t.seed} sample ${i} box ${k}`);
        }
        expect(misses).toEqual([]);
        let worst = 0;
        for (const g of t.gates) worst = Math.max(worst, nearCount(boxes, g.pos));
        expect(worst).toBeLessThanOrEqual(32);
      }
    }, 60000);
  }
});

describe('lattice tower', () => {
  it('collides on its legs and girts and leaves the inside and the gaps in its faces flyable, within the near-box limit', () => {
    for (const size of [[3, 15, 3], [5, 30, 5]] as Vec3[]) {
      const o: TrackObstacle = { kind: 'tower', pos: [6, 0, -9], yaw: 0.5, size };
      const boxes: ObstacleCollider[] = [];
      obstacleColliders(o, boxes);
      const t = towerLayout(o);
      const tiers = towerTiers(t);
      for (let k = 0; k < tiers; k++) {
        const ym = (t.platform * (k + 0.5)) / tiers;
        const f = ym / t.platform;
        const hx = t.base[0] + (t.top[0] - t.base[0]) * f;
        // The hollow core and the middle of each face between two girts.
        expect(hitsAt(boxes, obstacleToWorld(o, 0, ym, 0)), `core tier ${k}`).toBe(0);
        expect(hitsAt(boxes, obstacleToWorld(o, 0, ym, hx)), `face tier ${k}`).toBe(0);
        // A leg and the girt at the tier top.
        expect(hitsAt(boxes, obstacleToWorld(o, hx, ym, hx)), `leg tier ${k}`).toBeGreaterThan(0);
        const yt = (t.platform * (k + 1)) / tiers;
        const ht = t.base[0] + (t.top[0] - t.base[0]) * (yt / t.platform);
        expect(hitsAt(boxes, obstacleToWorld(o, 0, yt, ht)), `girt tier ${k}`).toBeGreaterThan(0);
      }
      let worst = 0;
      for (let y = 0.5; y < size[1]; y += 0.5) for (let x = -size[0]; x <= size[0]; x += 0.5) worst = Math.max(worst, nearCount(boxes, obstacleToWorld(o, x, y, 0)));
      expect(worst).toBeLessThanOrEqual(32);
    }
  });
});

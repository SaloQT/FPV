import { describe, expect, it } from 'vitest';
import type { TrackGate, TrackObstacle } from '../../contracts';
import { GATE_TUBE, trackGateFrame } from './gate';
import {
  BEAM_DEPTH, BRIDGE_DECK, BRIDGE_PARAPET, FLY_UNDER_SUPPORT_CLEARANCE, LADDER_CAP, OBSTACLE_SIZES, TOWER_RAIL, beamLayout, bridgeLayout, buildFrame,
  containerUnits, flyUnder, frameFeet, isCompositeObstacle, ladderGroups, ladderRailU, obstacleKeepOuts, obstacleParts, obstacleToWorld, scaffoldLayout,
  towerLayout, tunnelKeepOuts, tunnelSleeve,
} from './kindGeometry';

const gate = (over: Partial<TrackGate> = {}): TrackGate => ({ index: 0, kind: 'square', pos: [0, 5, 0], yaw: 0.4, roll: 0, pitch: 0, width: 2.4, height: 2, ...over });
const ob = (kind: TrackObstacle['kind'], size: [number, number, number], yaw = 0.3): TrackObstacle => ({ kind, pos: [10, 2, -4], yaw, size });
const NEW_KINDS = Object.keys(OBSTACLE_SIZES) as (keyof typeof OBSTACLE_SIZES)[];

/** Size at the low and high end of each axis range, and in the middle. */
function sizesOf(kind: keyof typeof OBSTACLE_SIZES): [number, number, number][] {
  const r = OBSTACLE_SIZES[kind];
  return [0, 0.5, 1].map((t): [number, number, number] => [r.x[0] + (r.x[1] - r.x[0]) * t, r.y[0] + (r.y[1] - r.y[0]) * t, r.z[0] + (r.z[1] - r.z[0]) * t]);
}

describe('frame feet', () => {
  const worldY = (g: TrackGate, u: number, v: number): number => {
    const f = trackGateFrame(g);
    return g.pos[1] + f.right[1] * u + f.up[1] * v;
  };

  it('an upright or slightly rolled gate stands on its two bottom corners, left first', () => {
    for (const roll of [0, 0.3, -0.6]) {
      const g = gate({ roll });
      const feet = frameFeet(g, trackGateFrame(g));
      const hu = g.width / 2 + GATE_TUBE / 2;
      const hv = g.height / 2 + GATE_TUBE;
      expect(feet).toEqual([[-hu, -hv], [hu, -hv]]);
    }
  });

  it('a gate rolled past 45 degrees stands on its two lowest corners', () => {
    for (const roll of [1.2, -1.3, 2.5]) {
      const g = gate({ roll });
      const feet = frameFeet(g, trackGateFrame(g));
      const hu = g.width / 2 + GATE_TUBE / 2;
      const hv = g.height / 2 + GATE_TUBE;
      const ys = [[-hu, -hv], [hu, -hv], [-hu, hv], [hu, hv]].map(([u, v]) => worldY(g, u, v)).sort((a, b) => a - b);
      const footYs = feet.map(([u, v]) => worldY(g, u, v)).sort((a, b) => a - b);
      expect(footYs[0]).toBeCloseTo(ys[0], 9);
      expect(footYs[1]).toBeCloseTo(ys[1], 9);
      expect(feet[0][0]).toBeLessThanOrEqual(feet[1][0]);
    }
  });

  it('a horizontal frame stands on two diagonally opposite corners', () => {
    const g = gate({ pitch: -Math.PI / 2 });
    const [a, b] = frameFeet(g, trackGateFrame(g));
    expect(a[0]).toBeCloseTo(-b[0], 9);
    expect(a[1]).toBeCloseTo(-b[1], 9);
  });
});

describe('upright kinds and ladders', () => {
  it('builds windows, tunnels, hurdles and ladders level whatever roll or pitch they carry', () => {
    for (const kind of ['window', 'tunnel', 'hurdle', 'ladder'] as const) {
      const f = buildFrame(gate({ kind, roll: 0.4, pitch: 0.3 }));
      expect(f.up[1]).toBeCloseTo(1, 12);
      expect(f.forward[1]).toBeCloseTo(0, 12);
    }
    expect(buildFrame(gate({ kind: 'square', roll: 0.4 })).up[1]).toBeLessThan(0.95);
  });

  it('a tunnel sleeve sits outside the entry frame and the default depth is 6 m', () => {
    const s = tunnelSleeve(gate({ kind: 'tunnel', width: 2.6, height: 2.4 }));
    expect(s.inner).toBeCloseTo(1.3 + GATE_TUBE, 9);
    expect(s.outer - s.inner).toBeCloseTo(0.2, 9);
    expect(s.roof).toBeCloseTo(1.2 + GATE_TUBE, 9);
    expect(s.depth).toBe(6);
    expect(tunnelSleeve(gate({ kind: 'tunnel', depth: 9 })).depth).toBe(9);
  });

  it('groups ladder rungs that share x/z, lowest first, with rails outside the widest rung', () => {
    const rung = (index: number, x: number, y: number, width = 2.2): TrackGate => gate({ index, kind: 'ladder', pos: [x, y, 3], width, height: 1.8, yaw: index % 2 ? Math.PI : 0 });
    const gates = [gate({ index: 0 }), rung(1, 0, 8), rung(2, 0.2, 2), rung(3, 0.1, 5, 2.6), rung(4, 20, 3), gate({ index: 5, kind: 'hoop' })];
    const groups = ladderGroups(gates);
    expect(groups.length).toBe(2);
    expect(groups[0].rungs).toEqual([2, 3, 1]);
    expect(groups[0].top).toBe(1);
    expect(groups[0].railU).toBeCloseTo(ladderRailU(2.6), 9);
    expect(groups[0].railTop).toBeCloseTo(8 + 0.9 + GATE_TUBE + LADDER_CAP, 9);
    expect(groups[1].rungs).toEqual([4]);
  });

  it('keeps vegetation off the whole tunnel sleeve', () => {
    const g = gate({ kind: 'tunnel', width: 2.6, height: 2.4, yaw: 1.1 });
    const f = buildFrame(g);
    const s = tunnelSleeve(g);
    const discs = [{ x: g.pos[0], z: g.pos[2], r: 0.5 * Math.hypot(g.width, g.height) + 2 }, ...tunnelKeepOuts(g)];
    for (let w = 0; w <= s.depth; w += 0.25) {
      for (const u of [-s.outer, 0, s.outer]) {
        const x = g.pos[0] + f.right[0] * u + f.forward[0] * w;
        const z = g.pos[2] + f.right[2] * u + f.forward[2] * w;
        expect(discs.some((d) => Math.hypot(x - d.x, z - d.z) <= d.r)).toBe(true);
      }
    }
  });
});

describe('composite obstacles', () => {
  it('every part of every new kind stays inside its footprint, over the whole size range', () => {
    for (const kind of NEW_KINDS) {
      expect(isCompositeObstacle(kind)).toBe(true);
      for (const size of sizesOf(kind)) {
        const o = ob(kind, size);
        const parts = obstacleParts(o);
        expect(parts.length).toBeGreaterThan(0);
        // Bridge parapets and tower railings stand on top of the size box; nothing else rises above it.
        const over = kind === 'bridge' ? BRIDGE_PARAPET : 0;
        for (const p of parts) {
          expect(p.h.every((h) => h > 0 && Number.isFinite(h))).toBe(true);
          expect(Math.abs(p.c[0]) + p.h[0]).toBeLessThanOrEqual(size[0] / 2 + 1e-9);
          expect(Math.abs(p.c[2]) + p.h[2]).toBeLessThanOrEqual(size[2] / 2 + 1e-9);
          expect(p.c[1] - p.h[1]).toBeGreaterThanOrEqual(-0.06);
          expect(p.c[1] + p.h[1]).toBeLessThanOrEqual(size[1] + over + 1e-9);
        }
        expect(Math.max(...parts.map((p) => p.c[1] + p.h[1]))).toBeGreaterThanOrEqual(size[1] - 1e-9);
      }
    }
  });

  it('supports reach down to the base the terrain gives them', () => {
    const o = ob('bridge', [20, 6, 5]);
    const parts = obstacleParts(o, (x) => (x < 0 ? -1.5 : 0.8));
    // Each pier is a shaft and a cap; the shaft reaches the ground.
    const piers = parts.filter((p) => p.role === 'support');
    expect(piers.length).toBe(4);
    const bottom = (side: number) => Math.min(...piers.filter((p) => Math.sign(p.c[0]) === side).map((p) => p.c[1] - p.h[1]));
    expect(bottom(-1)).toBeCloseTo(-1.5, 9);
    expect(bottom(1)).toBeCloseTo(0.8, 9);
  });

  it('lays out sensible structures at both ends of every size range', () => {
    for (const size of sizesOf('beam')) {
      const b = beamLayout(ob('beam', size));
      expect(b.postX).toBeGreaterThan(2);
      expect(b.top - b.y0).toBeCloseTo(BEAM_DEPTH, 9);
    }
    for (const size of sizesOf('bridge')) {
      const b = bridgeLayout(ob('bridge', size));
      expect(b.top - b.under).toBeCloseTo(BRIDGE_DECK, 9);
      expect(2 * b.pierX - 1.2).toBeGreaterThan(2 * FLY_UNDER_SUPPORT_CLEARANCE + 4);
    }
    for (const size of sizesOf('scaffold')) {
      const s = scaffoldLayout(ob('scaffold', size));
      expect(s.poles.length).toBeGreaterThanOrEqual(3);
      expect(s.decks.length).toBeGreaterThanOrEqual(1);
      for (let k = 1; k < s.decks.length; k++) expect(s.decks[k] - s.decks[k - 1]).toBeGreaterThan(1.4);
      expect(s.rails[1]).toBeLessThanOrEqual(size[1]);
    }
    for (const size of sizesOf('tower')) {
      const t = towerLayout(ob('tower', size));
      expect(t.platform).toBeGreaterThan(10);
      expect(t.deck[0]).toBeGreaterThan(t.top[0]);
      expect(t.platform + 0.15 + TOWER_RAIL).toBeLessThan(size[1]);
    }
    expect(containerUnits(ob('container', [6.1, 2.6, 2.44])).n).toBe(1);
    expect(containerUnits(ob('container', [6.1, 5.2, 2.44]))).toEqual({ n: 2, height: 2.6 });
  });

  it('describes the fly-under gap of beams and bridges in world space, and nothing for other kinds', () => {
    const beam = ob('beam', [10, 4.5, 0.5], 0.7);
    const fu = flyUnder(beam)!;
    expect(fu.underside).toBeCloseTo(beam.pos[1] + 4, 9);
    expect(fu.supports.length).toBe(2);
    expect(Math.hypot(fu.supports[0].center[0] - fu.supports[1].center[0], fu.supports[0].center[2] - fu.supports[1].center[2])).toBeCloseTo(2 * beamLayout(beam).postX, 9);
    const bridge = ob('bridge', [20, 6, 5]);
    expect(flyUnder(bridge)!.underside).toBeCloseTo(bridge.pos[1] + 6 - BRIDGE_DECK, 9);
    expect(flyUnder(ob('container', [6.1, 2.6, 2.44]))).toBeNull();
    expect(flyUnder(ob('wall', [3, 1, 0.3]))).toBeNull();
  });

  it('maps obstacle-local points like the collider boxes do (x along the right, z toward the back)', () => {
    const o = ob('pillar', [1, 10, 1], Math.PI / 2);
    const p = obstacleToWorld(o, 1, 0, 0);
    expect(p[0]).toBeCloseTo(o.pos[0], 9);
    expect(p[2]).toBeCloseTo(o.pos[2] - 1, 9);
  });
});

describe('vegetation keep-outs', () => {
  it('the original kinds keep their single disc', () => {
    expect(obstacleKeepOuts(ob('wall', [4, 1, 0.4]))).toEqual([{ x: 10, z: -4, r: 0.5 * Math.hypot(4, 0.4) }]);
    expect(obstacleKeepOuts(ob('rock', [1.4, 1, 1.1]))).toEqual([{ x: 10, z: -4, r: 1.4 }]);
    expect(obstacleKeepOuts(ob('tree', [0.3, 9, 0.3]))).toEqual([{ x: 10, z: -4, r: 0.3 }]);
  });

  it('the new kinds are covered by discs small enough for the 32 m blocker cell', () => {
    for (const kind of NEW_KINDS) {
      for (const size of sizesOf(kind)) {
        const o = ob(kind, size, 0.9);
        const discs = obstacleKeepOuts(o);
        for (const d of discs) expect(d.r).toBeLessThan(12);
        for (let i = 0; i <= 10; i++) {
          for (let j = 0; j <= 10; j++) {
            const p = obstacleToWorld(o, size[0] * (i / 10 - 0.5), 0, size[2] * (j / 10 - 0.5));
            expect(discs.some((d) => Math.hypot(p[0] - d.x, p[2] - d.z) <= d.r + 1e-9), `${kind} ${size}`).toBe(true);
          }
        }
      }
    }
    expect(obstacleKeepOuts(ob('bridge', [25, 8, 6])).length).toBeGreaterThan(1);
  });
});

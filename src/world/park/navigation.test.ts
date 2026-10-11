import { describe, expect, it } from 'vitest';
import type { Vec3 } from '../../contracts';
import { Parts } from './parts';
import { defaultParkRecipe } from './recipe';
import { routeParkPaths } from './navigation';
import type { ParkData } from './types';

function scene(a: Vec3, b: Vec3, width = 0.1): ParkData {
  return {
    recipe: defaultParkRecipe(), layout: 'hub', bounds: { min: [-1000, 12, -1000], max: [1000, 100, 1000] }, entrance: 0,
    launch: { pos: a, yaw: 0 }, rides: [], bodies: [], parts: [], lights: [], rooms: [], routes: [],
    nodes: [{ pos: a, links: [1], kind: 'entrance' }, { pos: b, links: [0], kind: 'facility' }], paths: [{ a: 0, b: 1, width }],
  };
}

describe('continuous pedestrian path clearance', () => {
  it('routes around a thin post intersecting between old sampling positions', () => {
    const park = scene([-12, 12.2, 0], [12, 12.2, 0]);
    new Parts(park).part('cylinder', [0.67, 13.4, 0.449], [0.05, 1.4, 0.05], [0.2, 0.2, 0.2]);
    routeParkPaths(park);
    expect(park.paths.length).toBeGreaterThan(1);
    for (const path of park.paths) {
      const a = park.nodes[path.a].pos, b = park.nodes[path.b].pos, dx = b[0] - a[0], dz = b[2] - a[2];
      const t = Math.max(0, Math.min(1, ((0.67 - a[0]) * dx + (0.449 - a[2]) * dz) / (dx * dx + dz * dz)));
      expect(Math.hypot(a[0] + t * dx - 0.67, a[2] + t * dz - 0.449)).toBeGreaterThan(0.45);
    }
  });

  it('relocates an enclosed junction and reroutes the connected network', () => {
    const park = scene([-12, 12.2, 0], [0, 12.2, 0]), b = new Parts(park);
    for (const side of [-1, 1]) {
      b.box([side * 4.5, 13.4, 0], [0.05, 1.4, 4.6], [0.2, 0.2, 0.2]);
      b.box([0, 13.4, side * 4.5], [4.6, 1.4, 0.05], [0.2, 0.2, 0.2]);
    }
    routeParkPaths(park);
    expect(Math.max(Math.abs(park.nodes[1].pos[0]), Math.abs(park.nodes[1].pos[2]))).toBeGreaterThan(4.9);
    const seen = new Set([0]), todo = [0];
    while (todo.length) for (const id of park.nodes[todo.pop()!].links) if (!seen.has(id)) { seen.add(id); todo.push(id); }
    expect(seen.size).toBe(park.nodes.length);
  });
});

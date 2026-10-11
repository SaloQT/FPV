import { describe, expect, it } from 'vitest';
import { parkMesh } from './mesh';

describe('procedural park meshes', () => {
  it('keeps detailed humans within the vertex budget and preserves the far silhouette', () => {
    const near = parkMesh('guest', 12), far = parkMesh('guest', 6);
    expect(near.length / 7).toBeLessThan(3000); expect(far.length / 7).toBeLessThan(1000);
    for (const mesh of [near, far]) {
      let bottom = Infinity, top = -Infinity;
      const materials = new Set<number>();
      for (let i = 0; i < mesh.length; i += 7) {
        expect(Number.isFinite(mesh[i] + mesh[i + 1] + mesh[i + 2])).toBe(true);
        expect(Math.hypot(mesh[i + 3], mesh[i + 4], mesh[i + 5])).toBeCloseTo(1, 5);
        bottom = Math.min(bottom, mesh[i + 1]); top = Math.max(top, mesh[i + 1]); materials.add(Math.floor(mesh[i + 6]) >> 4);
      }
      expect(top).toBeCloseTo(1); expect(bottom).toBeGreaterThanOrEqual(0); expect(bottom).toBeLessThan(0.01);
      for (const material of [0, 1, 2, 3]) expect(materials.has(material)).toBe(true);
      // Hair is material 4 on the far mesh and the shared hair dome, material 11, on the close ones.
      expect(materials.has(4) || materials.has(11)).toBe(true);
    }
  });
  it('winds the cone outward and gives its sloping wall unit analytic normals', () => {
    const mesh = parkMesh('cone', 12);
    for (let i = 0; i < mesh.length; i += 21) {
      const ax = mesh[i + 7] - mesh[i], ay = mesh[i + 8] - mesh[i + 1], az = mesh[i + 9] - mesh[i + 2];
      const bx = mesh[i + 14] - mesh[i], by = mesh[i + 15] - mesh[i + 1], bz = mesh[i + 16] - mesh[i + 2];
      expect((ay * bz - az * by) * mesh[i + 3] + (az * bx - ax * bz) * mesh[i + 4] + (ax * by - ay * bx) * mesh[i + 5]).toBeGreaterThan(0);
    }
    for (let i = 0; i < mesh.length; i += 7) expect(Math.hypot(mesh[i + 3], mesh[i + 4], mesh[i + 5])).toBeCloseTo(1, 5);
  });
  it('adds close facial anatomy without increasing either normal crowd LOD', () => {
    const hero = parkMesh('guestHero', 24), near = parkMesh('guest', 12), far = parkMesh('guest', 6);
    expect(near.length / 7).toBe(2772); expect(far.length / 7).toBe(780); expect(hero.length / 7).toBeGreaterThan(near.length / 7); expect(hero.length / 7).toBeLessThan(13000);
    const materials = new Set<number>(); let nose = Infinity, ears = 0;
    for (let i = 0; i < hero.length; i += 7) {
      expect(Number.isFinite(hero[i] + hero[i + 1] + hero[i + 2])).toBe(true);
      expect(Math.hypot(hero[i + 3], hero[i + 4], hero[i + 5])).toBeCloseTo(1, 5);
      expect(hero[i + 1]).toBeGreaterThanOrEqual(0); expect(hero[i + 1]).toBeLessThanOrEqual(1.005);
      const joint = Math.floor(hero[i + 6]); materials.add(joint >> 4);
      if ((joint & 15) === 1 && hero[i + 1] > 0.91 && hero[i + 1] < 0.94) nose = Math.min(nose, hero[i + 2]);
      if ((joint & 15) === 1 && Math.abs(hero[i]) > 0.06 && hero[i + 1] > 0.9 && hero[i + 1] < 0.947) ears++;
      if ((joint >> 4) >= 5) { expect(joint & 15).toBe(1); expect(Math.abs(hero[i])).toBeLessThanOrEqual(0.071); }
    }
    for (const material of [6, 7, 8, 9]) expect(materials.has(material)).toBe(true);
    expect(nose).toBeLessThan(-0.07); expect(nose).toBeGreaterThan(-0.075); expect(ears).toBeGreaterThan(100);
  });
  it('covers the full hero crown without burying the scalp inside the skull or covering the eyebrows', () => {
    const mesh = parkMesh('guestHero', 24);
    expect(mesh.length / 7).toBe(12060);
    type V = [number, number, number];
    const sub = (a: V, b: V): V => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
    const cross = (a: V, b: V): V => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
    const dot = (a: V, b: V) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
    // Intersect the actual triangles, including between rings/columns where a too-small cap clips.
    const exit = (origin: V, direction: V, material: number) => {
      let hit = -Infinity;
      for (let i = 0; i < mesh.length; i += 21) {
        const code = Math.floor(mesh[i + 6]);
        if ((code >> 4) !== material || (code & 15) !== 1) continue;
        const a: V = [mesh[i], mesh[i + 1], mesh[i + 2]], b: V = [mesh[i + 7], mesh[i + 8], mesh[i + 9]], c: V = [mesh[i + 14], mesh[i + 15], mesh[i + 16]];
        const edge1 = sub(b, a), edge2 = sub(c, a), p = cross(direction, edge2), determinant = dot(edge1, p);
        if (Math.abs(determinant) < 1e-12) continue;
        const offset = sub(origin, a), u = dot(offset, p) / determinant, q = cross(offset, edge1), v = dot(direction, q) / determinant;
        if (u < -1e-7 || v < -1e-7 || u + v > 1 + 1e-7) continue;
        const distance = dot(edge2, q) / determinant;
        if (distance >= 0) hit = Math.max(hit, distance);
      }
      return hit;
    };
    for (const elevation of [40, 55, 70, 90]) for (let column = 0; column < 24; column++) {
      const angle = (column + 0.5) * Math.PI / 12, pitch = elevation * Math.PI / 180;
      const direction: V = [Math.cos(angle) * Math.cos(pitch), Math.sin(pitch), Math.sin(angle) * Math.cos(pitch)];
      const skin = exit([0, 0.934, 0.004], direction, 1), hair = exit([0, 0.934, 0.004], direction, 11);
      expect(Number.isFinite(skin)).toBe(true);
      expect(hair, `crown at elevation ${elevation}, column ${column}`).toBeGreaterThan(skin + 0.0005);
    }
    for (const x of [-0.02, 0, 0.02]) expect(exit([x, 0.9515, 0.004], [0, 0, -1], 11)).toBe(-Infinity);
  });
});

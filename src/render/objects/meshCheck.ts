/** Test helper: structural invariants every mesh in this module must satisfy. */
import { expect } from 'vitest';
import { VERTEX_FLOATS, signedVolume, type MeshData } from './meshBuilder';

export interface MeshReport {
  triangles: number;
  volume: number;
  /** Largest |dot(geometric normal, vertex normal)| deficit: 0 means every face agrees with its normals. */
  worstAgreement: number;
}

export function checkMesh(mesh: MeshData, closed = false): MeshReport {
  const v = mesh.vertices;
  const n = v.length / VERTEX_FLOATS;
  for (let i = 0; i < v.length; i++) expect(Number.isFinite(v[i])).toBe(true);
  for (let i = 0; i < n; i++) {
    const l = Math.hypot(v[i * VERTEX_FLOATS + 3], v[i * VERTEX_FLOATS + 4], v[i * VERTEX_FLOATS + 5]);
    expect(l).toBeGreaterThan(0.999);
    expect(l).toBeLessThan(1.001);
    const ao = v[i * VERTEX_FLOATS + 9];
    expect(ao).toBeGreaterThanOrEqual(0);
    expect(ao).toBeLessThanOrEqual(1.0001);
  }
  let worst = 1;
  for (let i = 0; i < mesh.indices.length; i += 3) {
    const a = mesh.indices[i] * VERTEX_FLOATS, b = mesh.indices[i + 1] * VERTEX_FLOATS, c = mesh.indices[i + 2] * VERTEX_FLOATS;
    expect(Math.max(a, b, c) / VERTEX_FLOATS).toBeLessThan(n);
    const e1 = [v[b] - v[a], v[b + 1] - v[a + 1], v[b + 2] - v[a + 2]];
    const e2 = [v[c] - v[a], v[c + 1] - v[a + 1], v[c + 2] - v[a + 2]];
    const g = [e1[1] * e2[2] - e1[2] * e2[1], e1[2] * e2[0] - e1[0] * e2[2], e1[0] * e2[1] - e1[1] * e2[0]];
    const gl = Math.hypot(g[0], g[1], g[2]);
    expect(gl).toBeGreaterThan(0);
    const s = [v[a + 3] + v[b + 3] + v[c + 3], v[a + 4] + v[b + 4] + v[c + 4], v[a + 5] + v[b + 5] + v[c + 5]];
    const d = (g[0] * s[0] + g[1] * s[1] + g[2] * s[2]) / (gl * Math.hypot(s[0], s[1], s[2]) || 1);
    worst = Math.min(worst, d);
  }
  expect(worst).toBeGreaterThan(0);
  const volume = signedVolume(mesh);
  if (closed) expect(volume).toBeGreaterThan(0);
  return { triangles: mesh.indices.length / 3, volume, worstAgreement: worst };
}

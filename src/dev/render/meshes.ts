import { groundHeight } from './terrain';

export interface MeshRange { firstIndex: number; indexCount: number; baseVertex: number }
export interface MeshSet { vertices: Float32Array; indices: Uint32Array; cube: MeshRange; sphere: MeshRange; ground: MeshRange }

const GROUND_CELLS = 250;
const GROUND_EXTENT = 20000;

class Builder {
  readonly verts: number[] = [];
  readonly idx: number[] = [];
  vertexCount(): number { return this.verts.length / 6; }
}

function addCube(b: Builder): MeshRange {
  const base = b.vertexCount(), first = b.idx.length;
  const faces: [number[], number[], number[]][] = [
    [[1, 0, 0], [0, 1, 0], [0, 0, 1]], [[-1, 0, 0], [0, 0, 1], [0, 1, 0]],
    [[0, 1, 0], [0, 0, 1], [1, 0, 0]], [[0, -1, 0], [1, 0, 0], [0, 0, 1]],
    [[0, 0, 1], [1, 0, 0], [0, 1, 0]], [[0, 0, -1], [0, 1, 0], [1, 0, 0]],
  ];
  for (const [n, u, v] of faces) {
    const o = b.vertexCount() - base;
    for (const [su, sv] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
      b.verts.push(n[0] + u[0] * su + v[0] * sv, n[1] + u[1] * su + v[1] * sv, n[2] + u[2] * su + v[2] * sv, n[0], n[1], n[2]);
    }
    b.idx.push(o, o + 1, o + 2, o, o + 2, o + 3);
  }
  return { firstIndex: first, indexCount: b.idx.length - first, baseVertex: base };
}

function addSphere(b: Builder, rings = 16, segments = 32): MeshRange {
  const base = b.vertexCount(), first = b.idx.length;
  for (let r = 0; r <= rings; r++) {
    const phi = (r / rings) * Math.PI;
    for (let s = 0; s <= segments; s++) {
      const th = (s / segments) * Math.PI * 2;
      const x = Math.sin(phi) * Math.cos(th), y = Math.cos(phi), z = Math.sin(phi) * Math.sin(th);
      b.verts.push(x, y, z, x, y, z);
    }
  }
  const stride = segments + 1;
  for (let r = 0; r < rings; r++) {
    for (let s = 0; s < segments; s++) {
      const a = r * stride + s;
      b.idx.push(a, a + stride, a + 1, a + 1, a + stride, a + stride + 1);
    }
  }
  return { firstIndex: first, indexCount: b.idx.length - first, baseVertex: base };
}

/** Grid whose spacing grows quadratically away from the origin, so it reaches the far horizon with a few thousand triangles. */
function addGround(b: Builder): MeshRange {
  const base = b.vertexCount(), first = b.idx.length;
  const n = GROUND_CELLS;
  const coord = (i: number): number => { const u = (i / n) * 2 - 1; return Math.sign(u) * u * u * GROUND_EXTENT; };
  for (let j = 0; j <= n; j++) {
    for (let i = 0; i <= n; i++) {
      const x = coord(i), z = coord(j), e = 1;
      const nx = groundHeight(x - e, z) - groundHeight(x + e, z), nz = groundHeight(x, z - e) - groundHeight(x, z + e), l = Math.hypot(nx, 2 * e, nz);
      b.verts.push(x, groundHeight(x, z), z, nx / l, (2 * e) / l, nz / l);
    }
  }
  for (let j = 0; j < n; j++) {
    for (let i = 0; i < n; i++) {
      const a = j * (n + 1) + i;
      b.idx.push(a, a + n + 1, a + 1, a + 1, a + n + 1, a + n + 2);
    }
  }
  return { firstIndex: first, indexCount: b.idx.length - first, baseVertex: base };
}

/** Interleaved position + normal (6 floats per vertex) for every dev mesh, with per-mesh draw ranges. */
export function buildMeshes(): MeshSet {
  const b = new Builder();
  const cube = addCube(b), sphere = addSphere(b), ground = addGround(b);
  return { vertices: new Float32Array(b.verts), indices: new Uint32Array(b.idx), cube, sphere, ground };
}

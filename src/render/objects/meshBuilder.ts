/**
 * CPU mesh assembly for the object module. Vertices are 48 bytes: position, normal, uv (metres), attr
 * (x = material kind, y = baked AO, z / w = kind specific). Triangles are wound from the vertex normals, so a mesh is
 * front-facing (counter-clockwise seen from outside) by construction whatever order a primitive emits its corners in.
 */
import type { Quat, Vec3 } from '../../contracts';

export const VERTEX_FLOATS = 12;
export const VERTEX_STRIDE = VERTEX_FLOATS * 4;

export interface MeshData {
  vertices: Float32Array;
  indices: Uint32Array;
}

/** Row-major 3x4 affine matrix: rotation with uniform scale, then translation. */
export type Affine = readonly number[];

export const AFFINE_IDENTITY: Affine = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0];

export function affineMul(a: Affine, b: Affine): number[] {
  const o = new Array<number>(12);
  for (let r = 0; r < 3; r++) {
    for (let c = 0; c < 3; c++) o[r * 4 + c] = a[r * 4] * b[c] + a[r * 4 + 1] * b[4 + c] + a[r * 4 + 2] * b[8 + c];
    o[r * 4 + 3] = a[r * 4] * b[3] + a[r * 4 + 1] * b[7] + a[r * 4 + 2] * b[11] + a[r * 4 + 3];
  }
  return o;
}

export const affineTranslate = (x: number, y: number, z: number): number[] => [1, 0, 0, x, 0, 1, 0, y, 0, 0, 1, z];
export const affineScale = (s: number): number[] => [s, 0, 0, 0, 0, s, 0, 0, 0, 0, s, 0];

/** Rotation about +Y (positive = counter-clockwise seen from above). */
export function affineRotY(a: number): number[] {
  const c = Math.cos(a);
  const s = Math.sin(a);
  return [c, 0, s, 0, 0, 1, 0, 0, -s, 0, c, 0];
}

export function affineRotX(a: number): number[] {
  const c = Math.cos(a);
  const s = Math.sin(a);
  return [1, 0, 0, 0, 0, c, -s, 0, 0, s, c, 0];
}

export function affineRotZ(a: number): number[] {
  const c = Math.cos(a);
  const s = Math.sin(a);
  return [c, -s, 0, 0, s, c, 0, 0, 0, 0, 1, 0];
}

/** Matrix whose columns are the images of the local X, Y and Z axes. Use a mirrored basis to mirror a mesh. */
export function affineFromBasis(ax: Vec3, ay: Vec3, az: Vec3, t: Vec3): number[] {
  return [ax[0], ay[0], az[0], t[0], ax[1], ay[1], az[1], t[1], ax[2], ay[2], az[2], t[2]];
}

export function affineFromQuat(q: Quat, t: Vec3): number[] {
  const [x, y, z, w] = q;
  return [
    1 - 2 * (y * y + z * z), 2 * (x * y - z * w), 2 * (x * z + y * w), t[0],
    2 * (x * y + z * w), 1 - 2 * (x * x + z * z), 2 * (y * z - x * w), t[1],
    2 * (x * z - y * w), 2 * (y * z + x * w), 1 - 2 * (x * x + y * y), t[2],
  ];
}

export class MeshBuilder {
  kind = 0;
  ao = 1;
  a2 = 0;
  a3 = 0;
  /** Extra occlusion multiplied into `ao` at the (transformed) vertex position. */
  aoFn: ((x: number, y: number, z: number) => number) | null = null;

  private readonly verts: number[] = [];
  private readonly idx: number[] = [];
  private xf: Affine = AFFINE_IDENTITY;
  private readonly stack: Affine[] = [];

  get vertexCount(): number {
    return this.verts.length / VERTEX_FLOATS;
  }

  get triangleCount(): number {
    return this.idx.length / 3;
  }

  /** Applies `m` (inside the current transform) to every vertex added until the matching pop. */
  push(m: Affine): void {
    this.stack.push(this.xf);
    this.xf = affineMul(this.xf, m);
  }

  pop(): void {
    const prev = this.stack.pop();
    if (!prev) throw new Error('MeshBuilder.pop without push');
    this.xf = prev;
  }

  vertex(p: Vec3, n: Vec3, u = 0, v = 0): number {
    const m = this.xf;
    const wx = m[0] * p[0] + m[1] * p[1] + m[2] * p[2] + m[3];
    const wy = m[4] * p[0] + m[5] * p[1] + m[6] * p[2] + m[7];
    const wz = m[8] * p[0] + m[9] * p[1] + m[10] * p[2] + m[11];
    let nx = m[0] * n[0] + m[1] * n[1] + m[2] * n[2];
    let ny = m[4] * n[0] + m[5] * n[1] + m[6] * n[2];
    let nz = m[8] * n[0] + m[9] * n[1] + m[10] * n[2];
    const nl = Math.hypot(nx, ny, nz) || 1;
    nx /= nl;
    ny /= nl;
    nz /= nl;
    const ao = this.ao * (this.aoFn ? this.aoFn(wx, wy, wz) : 1);
    this.verts.push(wx, wy, wz, nx, ny, nz, u, v, this.kind, ao, this.a2, this.a3);
    return this.verts.length / VERTEX_FLOATS - 1;
  }

  /** Adds a triangle, swapping two corners when needed so the geometric normal agrees with the vertex normals. */
  tri(a: number, b: number, c: number): void {
    const v = this.verts;
    const pa = a * VERTEX_FLOATS;
    const pb = b * VERTEX_FLOATS;
    const pc = c * VERTEX_FLOATS;
    const e1x = v[pb] - v[pa], e1y = v[pb + 1] - v[pa + 1], e1z = v[pb + 2] - v[pa + 2];
    const e2x = v[pc] - v[pa], e2y = v[pc + 1] - v[pa + 1], e2z = v[pc + 2] - v[pa + 2];
    const gx = e1y * e2z - e1z * e2y, gy = e1z * e2x - e1x * e2z, gz = e1x * e2y - e1y * e2x;
    if (gx * gx + gy * gy + gz * gz < 1e-18) return;
    const sx = v[pa + 3] + v[pb + 3] + v[pc + 3];
    const sy = v[pa + 4] + v[pb + 4] + v[pc + 4];
    const sz = v[pa + 5] + v[pb + 5] + v[pc + 5];
    if (gx * sx + gy * sy + gz * sz < 0) this.idx.push(a, c, b);
    else this.idx.push(a, b, c);
  }

  quad(a: number, b: number, c: number, d: number): void {
    this.tri(a, b, c);
    this.tri(a, c, d);
  }

  /** Copies another mesh in through the current transform; its own kind / AO / attributes are kept. */
  append(mesh: MeshData): void {
    const base = this.vertexCount;
    const src = mesh.vertices;
    for (let i = 0; i < src.length; i += VERTEX_FLOATS) {
      const k = this.kind, a = this.ao, a2 = this.a2, a3 = this.a3;
      this.kind = src[i + 8];
      this.ao = src[i + 9];
      this.a2 = src[i + 10];
      this.a3 = src[i + 11];
      this.vertex([src[i], src[i + 1], src[i + 2]], [src[i + 3], src[i + 4], src[i + 5]], src[i + 6], src[i + 7]);
      this.kind = k;
      this.ao = a;
      this.a2 = a2;
      this.a3 = a3;
    }
    for (let i = 0; i < mesh.indices.length; i += 3) this.tri(base + mesh.indices[i], base + mesh.indices[i + 1], base + mesh.indices[i + 2]);
  }

  finish(): MeshData {
    return { vertices: new Float32Array(this.verts), indices: new Uint32Array(this.idx) };
  }
}

/** Sum of signed tetrahedron volumes: positive for a closed, outward-wound mesh. */
export function signedVolume(mesh: MeshData): number {
  const v = mesh.vertices;
  let vol = 0;
  for (let i = 0; i < mesh.indices.length; i += 3) {
    const a = mesh.indices[i] * VERTEX_FLOATS, b = mesh.indices[i + 1] * VERTEX_FLOATS, c = mesh.indices[i + 2] * VERTEX_FLOATS;
    vol += (v[a] * (v[b + 1] * v[c + 2] - v[b + 2] * v[c + 1]) - v[a + 1] * (v[b] * v[c + 2] - v[b + 2] * v[c]) + v[a + 2] * (v[b] * v[c + 1] - v[b + 1] * v[c])) / 6;
  }
  return vol;
}

import type { Quat, TerrainData, Vec3 } from '../../contracts';
import type { RTPrimitive } from '../../render/contracts';

/** Interleaved vertex: position (3), normal (3), material index (1). */
export const VERTEX_FLOATS = 7;
export const VERTEX_BYTES = VERTEX_FLOATS * 4;

export function rotate(q: Quat, v: Vec3, out: Vec3 = [0, 0, 0]): Vec3 {
  const tx = 2 * (q[1] * v[2] - q[2] * v[1]), ty = 2 * (q[2] * v[0] - q[0] * v[2]), tz = 2 * (q[0] * v[1] - q[1] * v[0]);
  out[0] = v[0] + q[3] * tx + (q[1] * tz - q[2] * ty);
  out[1] = v[1] + q[3] * ty + (q[2] * tx - q[0] * tz);
  out[2] = v[2] + q[3] * tz + (q[0] * ty - q[1] * tx);
  return out;
}

export function normalize(v: Vec3): Vec3 {
  const l = Math.hypot(v[0], v[1], v[2]) || 1;
  return [v[0] / l, v[1] / l, v[2] / l];
}

export function cross(a: Vec3, b: Vec3): Vec3 {
  return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
}

export class MeshBuilder {
  readonly verts: number[] = [];
  readonly idx: number[] = [];

  get vertexCount(): number { return this.verts.length / VERTEX_FLOATS; }

  vertex(p: Vec3, n: Vec3, material: number): number {
    this.verts.push(p[0], p[1], p[2], n[0], n[1], n[2], material);
    return this.vertexCount - 1;
  }

  /** Quad grid over a (rows + 1) x (cols + 1) vertex block that starts at `base`. */
  grid(base: number, rows: number, cols: number): void {
    const stride = cols + 1;
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const a = base + r * stride + c;
        this.idx.push(a, a + stride, a + 1, a + 1, a + stride, a + stride + 1);
      }
    }
  }
}

function addObb(b: MeshBuilder, center: Vec3, half: Vec3, rot: Quat, material: number): void {
  const faces: [Vec3, Vec3, Vec3][] = [
    [[1, 0, 0], [0, 1, 0], [0, 0, 1]], [[-1, 0, 0], [0, 0, 1], [0, 1, 0]],
    [[0, 1, 0], [0, 0, 1], [1, 0, 0]], [[0, -1, 0], [1, 0, 0], [0, 0, 1]],
    [[0, 0, 1], [1, 0, 0], [0, 1, 0]], [[0, 0, -1], [0, 1, 0], [1, 0, 0]],
  ];
  for (const [n, u, v] of faces) {
    const base = b.vertexCount;
    const worldN = rotate(rot, n);
    for (const [su, sv] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
      const local: Vec3 = [(n[0] + u[0] * su + v[0] * sv) * half[0], (n[1] + u[1] * su + v[1] * sv) * half[1], (n[2] + u[2] * su + v[2] * sv) * half[2]];
      const w = rotate(rot, local);
      b.vertex([center[0] + w[0], center[1] + w[1], center[2] + w[2]], worldN, material);
    }
    b.idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
  }
}

const RINGS = 20;
const SEGMENTS = 40;

function addSphere(b: MeshBuilder, center: Vec3, radius: number, material: number): void {
  const base = b.vertexCount;
  for (let r = 0; r <= RINGS; r++) {
    const phi = (r / RINGS) * Math.PI;
    for (let s = 0; s <= SEGMENTS; s++) {
      const th = (s / SEGMENTS) * Math.PI * 2;
      const n: Vec3 = [Math.sin(phi) * Math.cos(th), Math.cos(phi), Math.sin(phi) * Math.sin(th)];
      b.vertex([center[0] + n[0] * radius, center[1] + n[1] * radius, center[2] + n[2] * radius], n, material);
    }
  }
  b.grid(base, RINGS, SEGMENTS);
}

function addCapsule(b: MeshBuilder, a: Vec3, c: Vec3, radius: number, material: number): void {
  const axis = normalize([c[0] - a[0], c[1] - a[1], c[2] - a[2]]);
  const helper: Vec3 = Math.abs(axis[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0];
  const u = normalize(cross(helper, axis)), v = cross(axis, u);
  const base = b.vertexCount;
  const half = RINGS / 2;
  const ring = (lat: number, end: Vec3): void => {
    for (let s = 0; s <= SEGMENTS; s++) {
      const th = (s / SEGMENTS) * Math.PI * 2;
      const cl = Math.cos(lat), sl = Math.sin(lat);
      const n: Vec3 = [
        cl * (Math.cos(th) * u[0] + Math.sin(th) * v[0]) + sl * axis[0],
        cl * (Math.cos(th) * u[1] + Math.sin(th) * v[1]) + sl * axis[1],
        cl * (Math.cos(th) * u[2] + Math.sin(th) * v[2]) + sl * axis[2],
      ];
      b.vertex([end[0] + n[0] * radius, end[1] + n[1] * radius, end[2] + n[2] * radius], n, material);
    }
  };
  for (let k = 0; k <= half; k++) ring(-Math.PI / 2 + (k / half) * (Math.PI / 2), a);
  for (let k = 0; k <= half; k++) ring((k / half) * (Math.PI / 2), c);
  b.grid(base, 2 * half + 1, SEGMENTS);
}

/** Torus around local +Y (the axis of the hole), rotated by `rot`. */
function addTorus(b: MeshBuilder, center: Vec3, rot: Quat, major: number, minor: number, material: number): void {
  const base = b.vertexCount;
  const tube = 16, around = 64;
  for (let i = 0; i <= around; i++) {
    const u = (i / around) * Math.PI * 2;
    for (let j = 0; j <= tube; j++) {
      const w = (j / tube) * Math.PI * 2;
      const n = rotate(rot, [Math.cos(w) * Math.cos(u), Math.sin(w), Math.cos(w) * Math.sin(u)]);
      const p = rotate(rot, [(major + minor * Math.cos(w)) * Math.cos(u), minor * Math.sin(w), (major + minor * Math.cos(w)) * Math.sin(u)]);
      b.vertex([center[0] + p[0], center[1] + p[1], center[2] + p[2]], n, material);
    }
  }
  b.grid(base, around, tube);
}

export function addPrimitive(b: MeshBuilder, p: RTPrimitive, material: number): void {
  switch (p.type) {
    case 'obb': addObb(b, p.center, p.half, p.rot, material); break;
    case 'sphere': addSphere(b, p.center, p.radius, material); break;
    case 'capsule': addCapsule(b, p.a, p.b, p.radius, material); break;
    case 'torus': addTorus(b, p.center, p.rot, p.major, p.minor, material); break;
  }
}

/** Unit sphere around the origin, for the moving prop (its position comes from a per-frame uniform). */
export function addUnitSphere(b: MeshBuilder, radius: number, material: number): void {
  addSphere(b, [0, 0, 0], radius, material);
}

/** One vertex per height sample with the smoothed central-difference normal, cells split along (i, j)-(i+1, j+1) like the sampler. */
export function addTerrain(b: MeshBuilder, t: TerrainData, material: number): void {
  const n = t.resolution, h = t.height, cs = t.cellSize;
  const base = b.vertexCount;
  for (let j = 0; j < n; j++) {
    for (let i = 0; i < n; i++) {
      const i0 = Math.max(i - 1, 0), i1 = Math.min(i + 1, n - 1), j0 = Math.max(j - 1, 0), j1 = Math.min(j + 1, n - 1);
      const dx = (h[j * n + i1] - h[j * n + i0]) / ((i1 - i0) * cs), dz = (h[j1 * n + i] - h[j0 * n + i]) / ((j1 - j0) * cs);
      const l = Math.hypot(dx, 1, dz);
      b.vertex([t.origin[0] + i * cs, h[j * n + i], t.origin[1] + j * cs], [-dx / l, 1 / l, -dz / l], material);
    }
  }
  for (let j = 0; j < n - 1; j++) {
    for (let i = 0; i < n - 1; i++) {
      const a = base + j * n + i;
      b.idx.push(a, a + n, a + n + 1, a, a + n + 1, a + 1);
    }
  }
}

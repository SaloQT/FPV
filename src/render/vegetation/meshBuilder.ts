import type { Vec3 } from '../../contracts';

/**
 * Vertex kind byte: selects the fragment shader's material (mirrored in shaders/vegetation/tree.wgsl and tree_bark.wgsl). Bark kinds are
 * below 128 and the shader reads the bark type as kind / 8: oak (also bushes), pine, birch, beech, spruce and bare dead wood.
 */
export const KIND = { bark: 0, pineBark: 8, birchBark: 16, beechBark: 24, spruceBark: 32, deadWood: 40, leaf: 128, needle: 160, blob: 192, cone: 224 } as const;
export const VERTEX_STRIDE = 24;
/** A bark vertex's phase byte holds sqrt(radius / BARK_RADIUS_MAX) of its limb at that ring (mirrored in tree_bark.wgsl). */
export const BARK_RADIUS_MAX = 1.2;
export const barkRadiusCode = (radius: number): number => Math.sqrt(Math.min(Math.max(radius, 0) / BARK_RADIUS_MAX, 1));

export interface MeshData {
  vertexCount: number;
  /** xyz per vertex. */
  pos: Float32Array;
  /** Unit normals, xyz per vertex. */
  nrm: Float32Array;
  /** uv per vertex: bark = (around 0..1, metres along the branch / 64), leaves = atlas coordinates. */
  uv: Float32Array;
  /** Per vertex bytes: ambient occlusion, sway weight, kind, phase. */
  attr: Uint8Array;
  idx: Uint32Array;
}

export const add = (a: Vec3, b: Vec3): Vec3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
export const sub = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
export const mul = (a: Vec3, s: number): Vec3 => [a[0] * s, a[1] * s, a[2] * s];
export const dot = (a: Vec3, b: Vec3): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
export const cross = (a: Vec3, b: Vec3): Vec3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
export const len = (a: Vec3): number => Math.hypot(a[0], a[1], a[2]);
export const lerp3 = (a: Vec3, b: Vec3, t: number): Vec3 => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];

export function norm(a: Vec3): Vec3 {
  const l = len(a);
  return l > 1e-12 ? [a[0] / l, a[1] / l, a[2] / l] : [0, 1, 0];
}

const clamp01 = (x: number): number => Math.min(Math.max(x, 0), 1);
const byte = (x: number): number => Math.round(clamp01(x) * 255);

export interface Vertex {
  p: Vec3;
  n: Vec3;
  u: number;
  v: number;
  ao: number;
  sway: number;
  kind: number;
  phase: number;
}

/** Growable triangle-list accumulator; every vertex carries the full attribute set so tubes and leaf cards share one layout. */
export class MeshBuilder {
  private readonly pos: number[] = [];
  private readonly nrm: number[] = [];
  private readonly uv: number[] = [];
  private readonly attr: number[] = [];
  private readonly idx: number[] = [];

  get vertexCount(): number { return this.pos.length / 3; }
  get triangleCount(): number { return this.idx.length / 3; }

  vertex(x: Vertex): number {
    const n = norm(x.n);
    this.pos.push(x.p[0], x.p[1], x.p[2]);
    this.nrm.push(n[0], n[1], n[2]);
    this.uv.push(x.u, x.v);
    this.attr.push(byte(x.ao), byte(x.sway), x.kind, byte(x.phase));
    return this.pos.length / 3 - 1;
  }

  tri(a: number, b: number, c: number): void {
    this.idx.push(a, b, c);
  }

  quad(a: number, b: number, c: number, d: number): void {
    this.idx.push(a, b, c, a, c, d);
  }

  build(): MeshData {
    return {
      vertexCount: this.vertexCount,
      pos: Float32Array.from(this.pos),
      nrm: Float32Array.from(this.nrm),
      uv: Float32Array.from(this.uv),
      attr: Uint8Array.from(this.attr),
      idx: Uint32Array.from(this.idx),
    };
  }
}

export interface TubeOptions {
  sides: number;
  kind: number;
  /** Sway weight as a function of world height (metres) and progress along the tube (0..1). */
  sway: (y: number, along: number) => number;
  ao: (p: Vec3, along: number) => number;
  /** Metres already spent along the parent, so bark texture runs continuously. */
  v0?: number;
  /** Close the last ring to a point (tapering twigs). */
  tip?: boolean;
  /**
   * Root flare: `count` root ridges of relative height `amp` (each root its own size, from `phase`) that fade out over `height` metres above
   * the ground, so the trunk spreads into its roots where it meets the soil.
   */
  buttress?: { count: number; amp: number; height: number; phase: number };
  /** Relative height of low, uneven swellings of the bark (burrs, old healed wounds, an out-of-round section); `seed` picks their layout. */
  gnarl?: { amp: number; seed: number };
}

const VSCALE = 1 / 64;
const TAU = Math.PI * 2;

/** Radius multiplier of a root-flare lobe at angle `ang` and height `y`: narrow ridges where roots leave the trunk, each root its own size. */
function flare(o: NonNullable<TubeOptions['buttress']>, ang: number, y: number): number {
  const fade = Math.exp(-Math.max(y, 0) / o.height);
  if (fade < 1e-3) return 1;
  const k = o.count * ang / TAU + o.phase, i = Math.floor(k), f = k - i;
  // A root is a rounded ridge across the middle of its lobe, sized by a hash of the root's index (wrapping at the seam).
  const size = 0.55 + 0.9 * frac(Math.sin(((i % o.count) + o.count) % o.count * 12.9898 + o.phase * 78.233) * 43758.5453);
  const ridge = Math.pow(Math.max(Math.cos((f - 0.5) * Math.PI), 0), 2.2);
  return 1 + o.amp * fade * (size * ridge - 0.12);
}

const frac = (x: number): number => x - Math.floor(x);

/** Radius multiplier of the gentle swellings of a gnarled trunk: a few periodic waves round the limb that wander along it. */
function gnarled(o: NonNullable<TubeOptions['gnarl']>, ang: number, along: number): number {
  const s = o.seed;
  let g = 0;
  for (let k = 0; k < 3; k++) {
    const turns = 2 + k + Math.floor(frac(s * (k + 1.7)) * 3), wave = 0.6 + 1.7 * frac(s * (k + 3.1)), ph = TAU * frac(s * (k + 5.3));
    g += Math.sin(turns * ang + wave * along + ph) * Math.sin(0.9 * wave * along + 2.1 * ph + k);
  }
  return 1 + o.amp * g / 3;
}

/**
 * Sweeps a ring of `sides` vertices along a polyline with parallel-transport frames; `radii[i]` is the radius at `pts[i]`. Normals come from
 * the swept surface itself, so root flare and swellings shade as solid relief; the phase byte carries the ring's radius for the bark shader.
 */
export function tube(b: MeshBuilder, pts: readonly Vec3[], radii: readonly number[], o: TubeOptions): void {
  const n = pts.length;
  if (n < 2) return;
  const sides = o.sides, ring = sides + 1;
  let t = norm(sub(pts[1], pts[0]));
  const ref: Vec3 = Math.abs(t[1]) < 0.95 ? [0, 1, 0] : [1, 0, 0];
  let nx = norm(cross(t, ref));
  let along = o.v0 ?? 0;
  const pos: Vec3[] = [], radial: Vec3[] = [], alongAt: number[] = [];
  for (let i = 0; i < n; i++) {
    const a = pts[Math.max(i - 1, 0)], c = pts[Math.min(i + 1, n - 1)];
    const tNew = norm(sub(c, a));
    const proj = dot(nx, tNew);
    nx = norm([nx[0] - tNew[0] * proj, nx[1] - tNew[1] * proj, nx[2] - tNew[2] * proj]);
    t = tNew;
    const bx = cross(t, nx);
    if (i > 0) along += len(sub(pts[i], pts[i - 1]));
    alongAt.push(along);
    const r = o.tip && i === n - 1 ? 0 : radii[i];
    for (let j = 0; j <= sides; j++) {
      const ang = (j % sides / sides) * TAU;
      const cs = Math.cos(ang), sn = Math.sin(ang);
      const dir: Vec3 = [nx[0] * cs + bx[0] * sn, nx[1] * cs + bx[1] * sn, nx[2] * cs + bx[2] * sn];
      let shape = o.buttress ? flare(o.buttress, ang, pts[i][1]) : 1;
      if (o.gnarl) shape *= gnarled(o.gnarl, ang, along);
      radial.push(dir);
      pos.push([pts[i][0] + dir[0] * r * shape, pts[i][1] + dir[1] * r * shape, pts[i][2] + dir[2] * r * shape]);
    }
  }
  const first = b.vertexCount;
  for (let i = 0; i < n; i++) {
    const f = i / (n - 1), radius = o.tip && i === n - 1 ? 0 : radii[i];
    for (let j = 0; j <= sides; j++) {
      const k = i * ring + j, p = pos[k];
      // Surface normal from the neighbouring vertices round the ring and along the limb; a closed tip keeps the radial direction.
      const around = sub(pos[i * ring + (j + 1) % sides], pos[i * ring + (j + sides - 1) % sides]);
      const up = sub(pos[Math.min(i + 1, n - 1) * ring + j], pos[Math.max(i - 1, 0) * ring + j]);
      let nrm = cross(around, up);
      if (len(around) < 1e-7 || len(up) < 1e-7 || dot(nrm, radial[k]) <= 0) nrm = radial[k];
      b.vertex({
        p, n: nrm, u: j / sides, v: Math.min(alongAt[i] * VSCALE, 1),
        ao: o.ao(p, f), sway: o.sway(p[1], f), kind: o.kind, phase: barkRadiusCode(radius),
      });
    }
  }
  for (let i = 0; i < n - 1; i++) {
    for (let j = 0; j < sides; j++) {
      const a = first + i * ring + j, c = first + (i + 1) * ring + j;
      b.quad(a, a + 1, c + 1, c);
    }
  }
}

export interface CardOptions {
  /** Atlas rectangle: u0, v0 (top), u1, v1 (bottom). */
  rect: readonly [number, number, number, number];
  kind: number;
  /** Per-corner normal source: called with the corner position. */
  normalAt: (p: Vec3) => Vec3;
  aoAt: (p: Vec3) => number;
  swayAt: (p: Vec3) => number;
  phase: number;
}

/** Two-triangle sprite centred at `c`; `right` and `up` are half-extent vectors (the sprite's top is +up). */
export function card(b: MeshBuilder, c: Vec3, right: Vec3, up: Vec3, o: CardOptions): void {
  const [u0, v0, u1, v1] = o.rect;
  const corners: [Vec3, number, number][] = [
    [[c[0] - right[0] - up[0], c[1] - right[1] - up[1], c[2] - right[2] - up[2]], u0, v1],
    [[c[0] + right[0] - up[0], c[1] + right[1] - up[1], c[2] + right[2] - up[2]], u1, v1],
    [[c[0] + right[0] + up[0], c[1] + right[1] + up[1], c[2] + right[2] + up[2]], u1, v0],
    [[c[0] - right[0] + up[0], c[1] - right[1] + up[1], c[2] - right[2] + up[2]], u0, v0],
  ];
  const ids = corners.map(([p, u, v]) => b.vertex({ p, n: o.normalAt(p), u, v, ao: o.aoAt(p), sway: o.swayAt(p), kind: o.kind, phase: o.phase }));
  b.quad(ids[0], ids[1], ids[2], ids[3]);
}

/** A leaf card with a stationary vertex at the painted stem base, so wind cannot tear its attachment. */
export function anchoredCard(b: MeshBuilder, anchor: Vec3, right: Vec3, up: Vec3, stemV: number, o: CardOptions): void {
  const center = add(anchor, mul(up, 2 * stemV - 1)), [u0, v0, u1, v1] = o.rect;
  // The painted shoots narrow into a stem below tile v=.92; those empty corners need no triangles.
  const corners = [[1, -0.84, u1, v0 + (v1 - v0) * 0.92], [1, 1, u1, v0], [-1, 1, u0, v0], [-1, -0.84, u0, v0 + (v1 - v0) * 0.92]];
  const ids = corners.map(([x, y, u, v]) => {
    const p = add(center, add(mul(right, x), mul(up, y)));
    return b.vertex({ p, n: o.normalAt(p), u, v, ao: o.aoAt(p), sway: o.swayAt(p), kind: o.kind, phase: o.phase });
  });
  const root = b.vertex({ p: anchor, n: o.normalAt(anchor), u: (u0 + u1) / 2, v: v0 + (v1 - v0) * stemV,
    ao: o.aoAt(anchor), sway: 0, kind: o.kind, phase: o.phase });
  for (let i = 0; i < 3; i++) b.tri(root, ids[i], ids[i + 1]);
}

/** Interleaved 24-byte vertices (position f32x3, octahedral normal unorm16x2, uv unorm16x2, attr unorm8x4) for a set of meshes. */
export interface PackedMeshes {
  vertices: Uint8Array;
  indices: Uint32Array;
  ranges: { indexCount: number; firstIndex: number; baseVertex: number; vertexCount: number }[];
}

/** Octahedral encoding into [0, 1]^2, the exact inverse of octDecode in common/math.wgsl. */
export function octEncode(n: Vec3, out: [number, number]): [number, number] {
  const s = Math.abs(n[0]) + Math.abs(n[1]) + Math.abs(n[2]);
  let x = n[0] / s, y = n[1] / s;
  if (n[2] / s < 0) {
    const ox = (1 - Math.abs(y)) * (x >= 0 ? 1 : -1);
    const oy = (1 - Math.abs(x)) * (y >= 0 ? 1 : -1);
    x = ox; y = oy;
  }
  out[0] = x * 0.5 + 0.5;
  out[1] = y * 0.5 + 0.5;
  return out;
}

export function packMeshes(meshes: readonly MeshData[]): PackedMeshes {
  let vt = 0, it = 0;
  for (const m of meshes) { vt += m.vertexCount; it += m.idx.length; }
  const vertices = new Uint8Array(vt * VERTEX_STRIDE);
  const dv = new DataView(vertices.buffer);
  const indices = new Uint32Array(it);
  const ranges: PackedMeshes['ranges'] = [];
  const oct: [number, number] = [0, 0];
  const u16 = (x: number): number => Math.round(clamp01(x) * 65535);
  let vBase = 0, iBase = 0;
  for (const m of meshes) {
    for (let i = 0; i < m.vertexCount; i++) {
      const o = (vBase + i) * VERTEX_STRIDE;
      dv.setFloat32(o, m.pos[i * 3], true);
      dv.setFloat32(o + 4, m.pos[i * 3 + 1], true);
      dv.setFloat32(o + 8, m.pos[i * 3 + 2], true);
      octEncode([m.nrm[i * 3], m.nrm[i * 3 + 1], m.nrm[i * 3 + 2]], oct);
      dv.setUint16(o + 12, u16(oct[0]), true);
      dv.setUint16(o + 14, u16(oct[1]), true);
      dv.setUint16(o + 16, u16(m.uv[i * 2]), true);
      dv.setUint16(o + 18, u16(m.uv[i * 2 + 1]), true);
      for (let k = 0; k < 4; k++) vertices[o + 20 + k] = m.attr[i * 4 + k];
    }
    indices.set(m.idx, iBase);
    ranges.push({ indexCount: m.idx.length, firstIndex: iBase, baseVertex: vBase, vertexCount: m.vertexCount });
    vBase += m.vertexCount;
    iBase += m.idx.length;
  }
  return { vertices, indices, ranges };
}

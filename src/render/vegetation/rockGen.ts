import type { Vec3 } from '../../contracts';
import { Rng, deriveSeed } from '../../world/track/rng';
import { MeshBuilder, add, cross, dot, mul, norm, sub, type MeshData } from './meshBuilder';
import { fbm3, smoothstep } from './noise';

export const ROCK_SHAPES = 4;
/** Geodesic frequency per LOD: 20 n^2 triangles, i.e. 500, 80 and 20. */
export const ROCK_FREQUENCY = [5, 2, 1] as const;

const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;
const T = (1 + Math.sqrt(5)) / 2;
const ICO_VERTS: Vec3[] = [[-1, T, 0], [1, T, 0], [-1, -T, 0], [1, -T, 0], [0, -1, T], [0, 1, T], [0, -1, -T], [0, 1, -T], [T, 0, -1], [T, 0, 1], [-T, 0, -1], [-T, 0, 1]];
const ICO_FACES = [
  [0, 11, 5], [0, 5, 1], [0, 1, 7], [0, 7, 10], [0, 10, 11], [1, 5, 9], [5, 11, 4], [11, 10, 2], [10, 7, 6], [7, 1, 8],
  [3, 9, 4], [3, 4, 2], [3, 2, 6], [3, 6, 8], [3, 8, 9], [4, 9, 5], [2, 4, 11], [6, 2, 10], [8, 6, 7], [9, 8, 1],
];

/** Icosahedron with every edge split n times, projected to the unit sphere; vertices are shared between faces. */
export function icosphere(n: number): { dirs: Vec3[]; tris: number[] } {
  const dirs: Vec3[] = [], tris: number[] = [], seen = new Map<string, number>();
  const at = (p: Vec3): number => {
    const d = norm(p), key = `${Math.round(d[0] * 1e5)},${Math.round(d[1] * 1e5)},${Math.round(d[2] * 1e5)}`;
    let id = seen.get(key);
    if (id === undefined) { id = dirs.length; seen.set(key, id); dirs.push(d); }
    return id;
  };
  for (const [ia, ib, ic] of ICO_FACES) {
    const a = ICO_VERTS[ia], b = ICO_VERTS[ib], c = ICO_VERTS[ic];
    const grid = (i: number, j: number): number => at(add(a, add(mul(sub(b, a), i / n), mul(sub(c, a), j / n))));
    for (let i = 0; i < n; i++) {
      for (let j = 0; j < n - i; j++) {
        tris.push(grid(i, j), grid(i + 1, j), grid(i, j + 1));
        if (j < n - i - 1) tris.push(grid(i + 1, j), grid(i + 1, j + 1), grid(i, j + 1));
      }
    }
  }
  return { dirs, tris };
}

interface RockShape {
  planes: [Vec3, number][];
  sharp: number;
  stretch: Vec3;
  amp: number;
  freq: number;
  facet: number;
  ledge: number;
  seed: number;
}

function randomPlane(rng: Rng, flatten: number): Vec3 {
  const y = rng.range(-1, 1) * flatten, a = rng.range(0, Math.PI * 2), r = Math.sqrt(Math.max(1 - y * y, 0));
  return norm([r * Math.cos(a), y, r * Math.sin(a)]);
}

/** 0 angular block, 1 rounded boulder, 2 flat slab, 3 tall chunk: a convex polytope of random cut planes with a smooth-min bevel. */
function shapeOf(shape: number): RockShape {
  const rng = new Rng(deriveSeed(0x2c0c, shape));
  const cut = (k: number, flatten: number, lo: number, hi: number): [Vec3, number][] => Array.from({ length: k }, () => [randomPlane(rng, flatten), rng.range(lo, hi)]);
  const seed = deriveSeed(0x2c0d, shape);
  switch (shape) {
    case 0: return { planes: cut(11, 1, 0.78, 1), sharp: 26, stretch: [1, 0.9, 1.05], amp: 0.05, freq: 2.6, facet: 0.55, ledge: 0.03, seed };
    case 1: return { planes: cut(7, 1, 0.86, 1), sharp: 7, stretch: [1.05, 0.8, 0.95], amp: 0.07, freq: 1.6, facet: 0, ledge: 0, seed };
    case 2: return { planes: [[[0, 1, 0], 0.4], [[0, -1, 0], 0.4], ...cut(6, 0.3, 0.82, 1)], sharp: 22, stretch: [1, 1, 0.8], amp: 0.04, freq: 2.2, facet: 0.4, ledge: 0.06, seed };
    default: return { planes: cut(9, 1, 0.8, 1), sharp: 16, stretch: [0.7, 1.35, 0.75], amp: 0.06, freq: 2.2, facet: 0.35, ledge: 0.04, seed };
  }
}

/** Surface point of the rock along unit direction d: polytope radius, low-frequency displacement, facet quantisation and strata ledges. */
function surfacePoint(s: RockShape, d: Vec3): Vec3 {
  const ray = s.planes.map(([n, h]) => { const c = dot(d, n); return c > 0.02 ? h / c : Infinity; });
  const m = Math.min(...ray);
  let sum = 0;
  for (const v of ray) if (v < Infinity) sum += Math.exp(-s.sharp * (v - m));
  let r = m === Infinity ? 1.4 : Math.min(m - Math.log(sum) / s.sharp, 1.6);
  const q = fbm3(d[0] * s.freq + 3.1, d[1] * s.freq, d[2] * s.freq, s.seed, 3);
  r *= 1 + s.amp * (2 * lerp(q, Math.floor(q * 6) / 6, s.facet) - 1);
  let p = mul(d, r);
  if (s.ledge > 0) {
    const t = p[1] * 3.5 + 1.5 * q, k = 1 + s.ledge * (t - Math.floor(t) - 0.5);
    p = [p[0] * k, p[1], p[2] * k];
  }
  return [p[0] * s.stretch[0], p[1] * s.stretch[1], p[2] * s.stretch[2]];
}

export interface RockAsset {
  lods: [MeshData, MeshData, MeshData];
  /** Mesh height above its base (the mesh sits on y = 0) and the bounding sphere about (0, centreY, 0). */
  height: number;
  centreY: number;
  radius: number;
}

function smoothMesh(pos: Vec3[], dirs: Vec3[], tris: number[]): MeshData {
  const acc: Vec3[] = pos.map(() => [0, 0, 0]);
  for (let t = 0; t < tris.length; t += 3) {
    const a = pos[tris[t]], b = pos[tris[t + 1]], c = pos[tris[t + 2]];
    let n = cross(sub(b, a), sub(c, a));
    if (dot(n, add(a, add(b, c))) < 0) n = mul(n, -1);
    for (let k = 0; k < 3; k++) acc[tris[t + k]] = add(acc[tris[t + k]], n);
  }
  const b = new MeshBuilder();
  pos.forEach((p, i) => {
    b.vertex({ p, n: acc[i], u: 0, v: 0, ao: 0.4 + 0.6 * smoothstep(-0.7, 0.5, dirs[i][1]), sway: 0, kind: 0, phase: 0 });
  });
  for (let t = 0; t < tris.length; t += 3) b.tri(tris[t], tris[t + 1], tris[t + 2]);
  return b.build();
}

/** One rock shape at all LODs, scaled so its farthest surface point is 1 m from the centre and moved to rest on y = 0. */
export function buildRock(shape: number): RockAsset {
  const s = shapeOf(shape);
  const fine = icosphere(ROCK_FREQUENCY[0]);
  let maxR = 0, minY = Infinity, maxY = -Infinity;
  for (const d of fine.dirs) {
    const p = surfacePoint(s, d);
    maxR = Math.max(maxR, Math.hypot(p[0], p[1], p[2]));
    minY = Math.min(minY, p[1]); maxY = Math.max(maxY, p[1]);
  }
  const k = 1 / maxR, lift = -minY * k;
  const lods = ROCK_FREQUENCY.map((n) => {
    const ico = n === ROCK_FREQUENCY[0] ? fine : icosphere(n);
    const pos = ico.dirs.map((d): Vec3 => { const p = surfacePoint(s, d); return [p[0] * k, p[1] * k + lift, p[2] * k]; });
    return smoothMesh(pos, ico.dirs, ico.tris);
  }) as [MeshData, MeshData, MeshData];
  const height = (maxY - minY) * k;
  let radius = 0;
  for (const m of lods) for (let i = 0; i < m.vertexCount; i++) radius = Math.max(radius, Math.hypot(m.pos[i * 3], m.pos[i * 3 + 1] - height / 2, m.pos[i * 3 + 2]));
  return { lods, height, centreY: height / 2, radius };
}

let cache: RockAsset[] | null = null;

/** The four rock shapes, built once (they do not depend on the scene). */
export function rockAssets(): readonly RockAsset[] {
  cache ??= Array.from({ length: ROCK_SHAPES }, (_, i) => buildRock(i));
  return cache;
}

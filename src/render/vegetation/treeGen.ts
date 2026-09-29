import type { Vec3 } from '../../contracts';
import { Rng, deriveSeed } from '../../world/track/rng';
import { TILE, tileRect } from './leafAtlas';
import { KIND, MeshBuilder, add, card, cross, mul, norm, tube, type CardOptions, type MeshData } from './meshBuilder';
import { smoothstep } from './noise';
import { randomDir, rotAxis, trunkAt, trunkRadiusAt, type Cluster, type Limb, type TreePlan } from './treePlan';

const TAU = Math.PI * 2;
const UP: Vec3 = [0, 1, 0];
const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;

/** Lighting proxies baked into vertices: crown-shaped normals, interior occlusion and the height-based sway weight. */
interface Shading {
  normalAt: (p: Vec3) => Vec3;
  aoAt: (p: Vec3) => number;
  swayAt: (y: number) => number;
}

function shading(plan: TreePlan): Shading {
  const [cx, cy, cz] = plan.crownC, [rx, ry, rz] = plan.crownR;
  const conifer = plan.foliage === KIND.needle;
  const H = plan.height;
  return {
    normalAt: conifer
      ? (p) => {
        const dx = p[0] - cx, dz = p[2] - cz, h = Math.hypot(dx, dz);
        return h > 1e-4 ? norm([dx / h, 0.6, dz / h]) : UP;
      }
      : (p) => {
        const g = norm([(p[0] - cx) / (rx * rx), (p[1] - cy) / (ry * ry), (p[2] - cz) / (rz * rz)]);
        return norm([g[0], g[1] + 0.25, g[2]]);
      },
    aoAt: (p) => 0.3 + 0.7 * smoothstep(0.2, 1, Math.hypot((p[0] - cx) / rx, (p[1] - cy) / ry, (p[2] - cz) / rz)),
    swayAt: (y) => Math.min(Math.pow(Math.max(y, 0) / H, 1.6), 1),
  };
}

function cardOptions(sh: Shading, tile: number, kind: number, phase: number): CardOptions {
  return { rect: tileRect(tile), kind, normalAt: sh.normalAt, aoAt: sh.aoAt, swayAt: (p) => sh.swayAt(p[1]), phase };
}

function decimate(l: Limb, stride: number): Limb {
  if (stride === 1) return l;
  const n = l.pts.length, pts: Vec3[] = [], radii: number[] = [];
  for (let i = 0; i < n; i += stride) { pts.push(l.pts[i]); radii.push(l.radii[i]); }
  if ((n - 1) % stride !== 0) { pts.push(l.pts[n - 1]); radii.push(l.radii[n - 1]); }
  return { pts, radii, order: l.order };
}

/** Bark tubes: full detail at LOD0; at LOD1 only the trunk and (for small plans) the primary limbs, with few sides. */
function emitLimbs(b: MeshBuilder, rng: Rng, plan: TreePlan, sh: Shading, lod: 0 | 1): void {
  const many = plan.limbs.length > 100;
  for (const limb of plan.limbs) {
    let sides = plan.trunkSides[lod], stride = 1;
    if (limb.order > 0) {
      if (lod === 1 && (limb.order > 1 || many)) continue;
      sides = lod === 0 && !many ? Math.max(4, 7 - limb.order) : 3;
      stride = lod === 1 || many ? 2 : 1;
    }
    const d = decimate(limb, stride);
    tube(b, d.pts, d.radii, {
      sides, kind: plan.bark, sway: (y) => sh.swayAt(y), ao: sh.aoAt, phase: limb.order === 0 ? 0 : rng.next(), v0: rng.range(0, 20), tip: limb.order > 0,
    });
  }
}

/** Conifer sprays: two cards crossed along the branch axis; LOD1 keeps every third (or second) one, enlarged. */
function emitFronds(b: MeshBuilder, rng: Rng, plan: TreePlan, sh: Shading, lod: 0 | 1): void {
  const n = plan.fronds.length;
  const stride = lod === 0 ? 1 : n > 60 ? 3 : 2;
  const grow = lod === 0 ? 1 : stride === 3 ? 1.9 : 1.4;
  for (let i = 0; i < n; i++) {
    if (stride > 1 && i % stride !== 1 && !(n > 60 && i >= n - 4)) continue;
    const f = plan.fronds[i];
    const lat = norm(cross(f.t, Math.abs(f.t[1]) < 0.95 ? UP : [1, 0, 0]));
    const o = cardOptions(sh, TILE.needles, KIND.needle, rng.next());
    for (const s of [1, -1]) card(b, f.c, mul(rotAxis(lat, f.t, s * 0.6), f.width * 0.5 * grow), mul(f.t, f.len * 0.5 * grow), o);
  }
}

/** A needle spray whose base sits at the cluster centre and whose tip points along a random direction. */
function tuft(b: MeshBuilder, rng: Rng, sh: Shading, cl: Cluster, halfLen: number): void {
  const d = randomDir(rng), side = norm(cross(d, randomDir(rng)));
  card(b, add(cl.c, mul(d, halfLen * 0.85)), mul(side, halfLen * 0.55), mul(d, halfLen), cardOptions(sh, TILE.needles, KIND.needle, rng.next()));
}

/** One sprig card at a random spot inside the cluster ball, facing a mix of the crown normal and a random direction. */
function sprig(b: MeshBuilder, rng: Rng, plan: TreePlan, sh: Shading, cl: Cluster): void {
  const c = add(cl.c, mul(randomDir(rng), cl.r * lerp(0.3, 1, Math.cbrt(rng.next()))));
  const n = sh.normalAt(c), r = randomDir(rng);
  const d = norm([n[0] * 0.6 + r[0] * 0.8, n[1] * 0.6 + r[1] * 0.8, n[2] * 0.6 + r[2] * 0.8]);
  const right0 = norm(cross(d, Math.abs(d[1]) < 0.9 ? UP : [1, 0, 0])), up0 = cross(d, right0);
  const roll = rng.range(0, TAU), cs = Math.cos(roll), sn = Math.sin(roll), h = plan.cardSize * rng.range(0.8, 1.25);
  const right = mul(add(mul(right0, cs), mul(up0, sn)), h), up = mul(add(mul(up0, cs), mul(right0, -sn)), h);
  card(b, c, right, up, cardOptions(sh, TILE.sprig, plan.foliage, rng.next()));
}

function emitClusters(b: MeshBuilder, rng: Rng, plan: TreePlan, sh: Shading, lod: 0 | 1): void {
  for (const cl of plan.clusters) {
    if (plan.radial) {
      const count = lod === 0 ? plan.cardsPerCluster : 3;
      for (let i = 0; i < count; i++) tuft(b, rng, sh, cl, plan.cardSize * cl.r * (lod === 0 ? 1 : 1.3));
    } else if (lod === 0) {
      for (let i = 0; i < plan.cardsPerCluster; i++) sprig(b, rng, plan, sh, cl);
    } else {
      const yaw = rng.range(0, Math.PI), h = cl.r * 1.05, o = cardOptions(sh, TILE.blob, KIND.blob, rng.next());
      for (let k = 0; k < 2; k++) {
        const a = yaw + (k * Math.PI) / 2;
        card(b, cl.c, [Math.cos(a) * h, 0, Math.sin(a) * h], [0, h * 0.9, 0], o);
      }
    }
  }
}

/** 3x3 vertical card spanning the crown; vertex normals sample the crown surface in front of the card so the flat quad shades like a solid volume. */
function billboard(b: MeshBuilder, plan: TreePlan, sh: Shading, yaw: number, tile: number, kind: number, phase: number): void {
  const [cx, cy, cz] = plan.crownC, [rx, ry, rz] = plan.crownR;
  const w = Math.max(rx, rz), y0 = Math.max(cy - ry, 0), hh = (cy + ry - y0) / 2, ym = y0 + hh;
  const rd: Vec3 = [Math.cos(yaw), 0, Math.sin(yaw)], fw: Vec3 = [-Math.sin(yaw), 0, Math.cos(yaw)];
  const [u0, v0, u1, v1] = tileRect(tile);
  const first = b.vertexCount;
  for (let j = 0; j < 3; j++) {
    for (let i = 0; i < 3; i++) {
      const u = i - 1, v = j - 1;
      const p: Vec3 = [cx + rd[0] * w * u, ym + hh * v, cz + rd[2] * w * u];
      const z = rz * Math.sqrt(Math.max(1 - (w * u / rx) ** 2 - (hh * v / ry) ** 2, 0));
      const q = add(p, mul(fw, z));
      b.vertex({ p, n: sh.normalAt(q), u: lerp(u0, u1, i / 2), v: lerp(v1, v0, j / 2), ao: 0.72, sway: sh.swayAt(p[1]), kind, phase });
    }
  }
  for (let j = 0; j < 2; j++) for (let i = 0; i < 2; i++) b.quad(first + j * 3 + i, first + j * 3 + i + 1, first + (j + 1) * 3 + i + 1, first + (j + 1) * 3 + i);
}

/** Trunk stub, three vertical crown billboards 60 degrees apart and a horizontal canopy disc. */
function emitBillboards(b: MeshBuilder, rng: Rng, plan: TreePlan, sh: Shading): void {
  if (plan.species !== 'bush' && plan.species !== 'juniper') {
    const top = Math.max(0.5, Math.min(plan.crownC[1] - plan.crownR[1], 0.5 * plan.height));
    const ys = [-0.3, top * 0.5, top], trunk = plan.limbs[0];
    tube(b, ys.map((y) => trunkAt(trunk, y)), ys.map((y) => trunkRadiusAt(trunk, y)), {
      sides: plan.trunkSides[2], kind: plan.bark, sway: (y) => sh.swayAt(y), ao: () => 1, phase: 0,
    });
  }
  const cone = plan.species === 'spruce';
  const yaw0 = rng.range(0, Math.PI);
  for (let i = 0; i < 3; i++) billboard(b, plan, sh, yaw0 + (i * Math.PI) / 3, cone ? TILE.conifer : TILE.blob, cone ? KIND.cone : KIND.blob, rng.next());
  const [cx, cy, cz] = plan.crownC, [rx, ry, rz] = plan.crownR, y = cy + 0.15 * ry;
  card(b, [cx, y, cz], [rx * 0.85, 0, 0], [0, 0, rz * 0.85], {
    rect: tileRect(TILE.blob), kind: KIND.blob, normalAt: () => UP, aoAt: () => 0.8, swayAt: (p) => sh.swayAt(p[1]), phase: rng.next(),
  });
}

/** The three LOD meshes of one plan (LOD0 full geometry, LOD1 merged foliage, LOD2 billboards). */
export function buildTreeLods(plan: TreePlan, seed: number): [MeshData, MeshData, MeshData] {
  const sh = shading(plan);
  const lods: MeshData[] = [];
  for (const lod of [0, 1, 2] as const) {
    const rng = new Rng(deriveSeed(seed, 0x10d, lod)), b = new MeshBuilder();
    if (lod === 2) emitBillboards(b, rng, plan, sh);
    else {
      emitLimbs(b, rng, plan, sh, lod);
      emitFronds(b, rng, plan, sh, lod);
      emitClusters(b, rng, plan, sh, lod);
    }
    lods.push(b.build());
  }
  return lods as [MeshData, MeshData, MeshData];
}

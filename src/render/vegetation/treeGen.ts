import type { Vec3 } from '../../contracts';
import { Rng, deriveSeed } from '../../world/track/rng';
import { FoliageSpace, type Piece } from './foliageSpace';
import { TILE, sheetFor, shootLayout, sprayLayout, tileOpacity, tileRect } from './leafAtlas';
import { KIND, MeshBuilder, add, anchoredCard, card, cross, len, mul, norm, sub, tube, type CardOptions, type MeshData } from './meshBuilder';
import { smoothstep } from './noise';
import { randomDir, rotAxis, trunkAt, trunkRadiusAt, type Cluster, type Frond, type Limb, type TreePlan } from './treePlan';
import { nearestWood } from './treeAttachments';
import type { SprayLayout } from './treeNeedleShapes';
import { SHEET, SHEET_BASE_V, SHEET_HALF_W, SHEET_STALK_V, SHEET_TIP_V, type ShootLayout } from './treeLeafShapes';

const TAU = Math.PI * 2;
const UP: Vec3 = [0, 1, 0];
const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;
/** Face directions of a regular tetrahedron. */
const TETRAHEDRON: Vec3[] = ([[1, 1, 1], [1, -1, -1], [-1, 1, -1], [-1, -1, 1]] as Vec3[]).map(norm);
/** Half-size of a mid-distance leaf card as a multiple of its cluster radius; four of them cover about what two crossed cards and a flat one did. */
const CLUSTER_CARD = 0.95;

/**
 * Foliage options of a mesh build. `dense` is the extreme tier's crown: about twice the leaf cards and shoots at LOD0, six cluster cards instead
 * of four at LOD1, and a second needle curtain under every conifer frond. It adds cards only, on the same branches: the plan, the bounds the
 * cull uses and everything placement and colliders read are unchanged.
 */
export interface FoliageOptions {
  dense?: boolean;
  /** Called with the near LOD's foliage space once it is built (tests count the leaves that still cross). */
  report?: (space: FoliageSpace) => void;
  /** Receives every foliage piece the near LOD drew (leaves, cards and ribbons as emitted, without the cards that only stood in for a shoot). */
  pieces?: (all: Piece[]) => void;
}

/** Optional geometry audit of the exact near-LOD skeleton and every painted foliage attachment. */
/** Each foliage piece's attachment; `span` is its vertex count, the last vertex being the stationary one on the wood (5, an anchored card, when absent). */
export interface TreeContactAudit { wood: Limb[]; foliage: { point: Vec3; limb: Limb; span?: number }[] }

/** Lighting proxies baked into vertices: crown-shaped normals, interior occlusion and the height-based sway weight. */
interface Shading {
  normalAt: (p: Vec3) => Vec3;
  aoAt: (p: Vec3) => number;
  swayAt: (y: number) => number;
}

/**
 * How much foliage shades a point from the sky: the leaf clusters and sprays of the crown that lie above it, inside a cone opening upward,
 * each counted by its area and less the farther it is. A shoot deep under a heavy crown is in dense shade, one on the sunlit top in none;
 * the result multiplies the crown's ambient occlusion, so a crown reads as a layered, self-shadowed mass rather than evenly lit tufts.
 */
function foliageShade(plan: TreePlan): (p: Vec3) => number {
  const masses: [number, number, number, number][] = [
    ...plan.clusters.map((c): [number, number, number, number] => [c.c[0], c.c[1], c.c[2], c.r * c.r]),
    ...plan.fronds.map((f): [number, number, number, number] => [f.c[0], f.c[1], f.c[2], 0.25 * f.len * f.width]),
  ];
  // The shade varies over metres, so it is worked out once per SHADE_CELL cube and shared by every vertex in it: the extreme tier's
  // per-leaf crowns and finely cut trunks have hundreds of thousands of vertices.
  const memo = new Map<number, number>();
  return (p) => {
    const ix = Math.round(p[0] / SHADE_CELL), iy = Math.round(p[1] / SHADE_CELL), iz = Math.round(p[2] / SHADE_CELL);
    const key = ((ix + 512) * 1024 + (iy + 512)) * 1024 + (iz + 512);
    const known = memo.get(key);
    if (known !== undefined) return known;
    const qx = ix * SHADE_CELL, qy = iy * SHADE_CELL, qz = iz * SHADE_CELL;
    let shade = 0;
    for (const [x, y, z, area] of masses) {
      const up = y - qy;
      if (up < 0.3) continue;
      const side = Math.hypot(x - qx, z - qz);
      if (side > 0.9 * up + 1) continue;
      shade += area / (1 + 0.15 * up * up);
    }
    const out = 1 / (1 + FOLIAGE_SHADE * shade);
    memo.set(key, out);
    return out;
  };
}

/** Strength of the self-shading of a crown (foliageShade): a shoot under about four leaf clusters' worth of crown gets half the sky. */
const FOLIAGE_SHADE = 0.3;
/** Share of the crown-scale occlusion (crown shell, height, foliage above) baked into vertex AO; see aoAt in shading(). */
export const CROWN_AO_SHARE = 0.3;
/** Size (m) of the cubes foliageShade works the shade out for. */
const SHADE_CELL = 0.25;

function shading(plan: TreePlan): Shading {
  const [cx, cy, cz] = plan.crownC, [rx, ry, rz] = plan.crownR;
  const conifer = plan.foliage === KIND.needle;
  const H = plan.height;
  const mass = foliageShade(plan);
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
    // Every tier traces diffuse GI against the crowns' canopy proxies, which already darkens the inside and underside of a crown; baking the
    // whole crown's occlusion as well would count it twice (shaded leaves came out about 30x darker than sunlit grass instead of 4-8x). The
    // bake keeps CROWN_AO_SHARE of the crown-scale terms, so it carries only the local, sub-cluster occlusion the proxies cannot see:
    // outer leaves stay near 1, the deep interior about 0.75.
    aoAt: (p) => 1 - CROWN_AO_SHARE * (1 - (0.38 + 0.62 * smoothstep(0.2, 1, Math.hypot((p[0] - cx) / rx, (p[1] - cy) / ry, (p[2] - cz) / rz))) * (0.7 + 0.3 * smoothstep(-0.9, 0.6, (p[1] - cy) / ry)) * mass(p)),
    swayAt: (y) => Math.min(Math.pow(Math.max(y, 0) / H, 1.6), 1),
  };
}

/** `mirror` flips the tile left to right, which doubles the shoots a crown shows for free (the painted stem is on the tile's centre line). */
function cardOptions(sh: Shading, tile: number, kind: number, phase: number, mirror = false): CardOptions {
  const [u0, v0, u1, v1] = tileRect(tile);
  return { rect: mirror ? [u1, v0, u0, v1] : [u0, v0, u1, v1], kind, normalAt: sh.normalAt, aoAt: sh.aoAt, swayAt: (p) => sh.swayAt(p[1]), phase };
}

/** Leaf tile of a broadleaf shoot card: each species alternates between its two painted shoots (a bush between hazel and hawthorn). */
function shootTile(plan: TreePlan, rng: Rng): number {
  const second = rng.next() < 0.5;
  if (plan.species === 'bush') return second ? TILE.hawthorn : TILE.shrub;
  if (plan.species === 'birch') return second ? TILE.birch2 : TILE.birch;
  if (plan.species === 'beech') return second ? TILE.beech2 : TILE.beech;
  return second ? TILE.oak2 : TILE.sprig;
}

// Bark relief geometry at the extreme tier: limbs at least this thick (m at scale 1) are cut into rings and sides about RELIEF_STEP apart
// (at most RELIEF_MAX_SIDES round), so the displaced plates and furrows of the bark are a few vertices across.
const RELIEF_MIN_RADIUS = 0.15;
const RELIEF_STEP = 0.045;
const RELIEF_MAX_SIDES = 128;
// Only the wood within this height (m at scale 1) is cut finely: above it the relief is too far from a camera on the ground to show.
const RELIEF_MAX_HEIGHT = 9;

/** The limb with extra points on straight lines between its own, so no segment below `maxY` is longer than `step` metres. */
function subdivide(l: Limb, step: number, maxY: number): Limb {
  const pts: Vec3[] = [l.pts[0]], radii: number[] = [l.radii[0]];
  for (let i = 1; i < l.pts.length; i++) {
    const a = l.pts[i - 1], c = l.pts[i], n = Math.min(a[1], c[1]) < maxY ? Math.max(1, Math.ceil(len(sub(c, a)) / step)) : 1;
    for (let k = 1; k <= n; k++) {
      const t = k / n;
      pts.push([a[0] + (c[0] - a[0]) * t, a[1] + (c[1] - a[1]) * t, a[2] + (c[2] - a[2]) * t]);
      radii.push(l.radii[i - 1] + (l.radii[i] - l.radii[i - 1]) * t);
    }
  }
  return { pts, radii, order: l.order };
}

function decimate(l: Limb, stride: number): Limb {
  if (stride === 1) return l;
  const n = l.pts.length, pts: Vec3[] = [], radii: number[] = [];
  for (let i = 0; i < n; i += stride) { pts.push(l.pts[i]); radii.push(l.radii[i]); }
  if ((n - 1) % stride !== 0) { pts.push(l.pts[n - 1]); radii.push(l.radii[n - 1]); }
  return { pts, radii, order: l.order };
}

/** Bark ring count of a branch by its base radius (m) at LOD0: limbs get round cross-sections, thin twigs triangles. */
const sidesFor = (radius: number): number => (radius > 0.06 ? 6 : radius > 0.035 ? 5 : radius > 0.018 ? 4 : 3);

/** Bark tubes: full detail at LOD0; at LOD1 only the trunk and (for small plans) the primary limbs, with few sides. */
function emitLimbs(b: MeshBuilder, plan: TreePlan, sh: Shading, lod: 0 | 1, dense = false): Limb[] {
  const many = plan.limbs.length > 100 && plan.foliage !== KIND.leaf;
  const parents = new Set(plan.limbs.map(limb => limb.parent)), emitted: Limb[] = [];
  plan.limbs.forEach((limb, index) => {
    let sides = plan.trunkSides[lod], stride = 1;
    if (limb.order > 0) {
      // LOD1 keeps the trunk and the living primary limbs; surface roots and dead stubs are left to the root flare.
      if (lod === 1 && (limb.order > 1 || many || limb.root || limb.dead)) return;
      // A thick surface root lies at eye level next to a drone flying low between the trunks: on five sides it reads as a faceted wedge.
      sides = lod === 0 ? (limb.root && limb.radii[0] > 0.06 ? 8 : Math.min(sidesFor(limb.radii[0]), many && limb.order > 1 ? 4 : limb.root ? 5 : 6)) : 3;
      stride = lod === 1 || !parents.has(limb) && (limb.order >= 3 || (many && limb.order === 1)) ? 2 : 1;
    }
    const d = decimate(limb, stride);
    // Leaves attach to living wood only.
    if (!limb.dead) emitted.push(d);
    const trunk = limb.order === 0, gnarl = plan.gnarl ?? 0;
    // At the extreme tier's near LOD a trunk or heavy limb is cut finely enough for the shader to push its bark relief out of the surface
    // (barkDisplacement in tree_bark.wgsl), so plates and furrows have real depth and break the outline.
    const relief = dense && lod === 0 && !limb.root && (trunk || limb.radii[0] > RELIEF_MIN_RADIUS) && limb.pts[0][1] < RELIEF_MAX_HEIGHT;
    const drawn = relief ? subdivide(d, RELIEF_STEP, RELIEF_MAX_HEIGHT) : d;
    if (relief) sides = Math.max(sides, Math.min(RELIEF_MAX_SIDES, Math.round((TAU * Math.max(...d.radii) * (trunk && plan.flare ? 1 + plan.flare.amp : 1)) / RELIEF_STEP)));
    // Bark offsets and swellings come from the limb's index, so both LODs build the same shape and pattern.
    tube(b, drawn.pts, drawn.radii, {
      // Planned radii are authoritative at forks and at the shoot attachments near branch tips.
      sides, kind: limb.dead ? KIND.deadWood : plan.bark, sway: (y) => sh.swayAt(y), ao: sh.aoAt, v0: (index * 7.31) % 20,
      buttress: trunk ? plan.flare : undefined,
      gnarl: gnarl > 0 && (trunk || limb.radii[0] > 0.08) ? { amp: gnarl * (trunk ? 1 : 0.6), seed: (index * 0.618034 + 0.13) % 1 } : undefined,
    });
  });
  return emitted;
}

/** Conifer sprays: two cards crossed along the branch axis; LOD1 keeps every third (or second) one, enlarged. */
function emitFronds(b: MeshBuilder, rng: Rng, plan: TreePlan, sh: Shading, lod: 0 | 1, wood: Limb[], audit?: TreeContactAudit, dense = false): void {
  const n = plan.fronds.length;
  const stride = lod === 0 ? 1 : n > 60 ? 3 : 2;
  const grow = lod === 0 ? 1 : stride === 3 ? 1.9 : 1.4;
  for (let i = 0; i < n; i++) {
    if (stride > 1 && i % stride !== 1 && !(n > 60 && i >= n - 4)) continue;
    const f = plan.fronds[i];
    const lat = norm(cross(f.t, Math.abs(f.t[1]) < 0.95 ? UP : [1, 0, 0]));
    const sprayTile = rng.next() < 0.5 ? TILE.needles2 : TILE.needles;
    const o = cardOptions(sh, sprayTile, KIND.needle, rng.next());
    // At the extreme tier's near LOD a spruce spray is built shoot by shoot (sprayShoots) instead of as two crossed flat cards.
    const realSpray = dense && lod === 0 && plan.species === 'spruce' && shellDepth(plan, f.c) > SPRAY_SHELL;
    if (realSpray) {
      // Placed in the tree as its flat card, keeping room for the drooping shoots either side of it, then built shoot by shoot in that pose.
      const up = mul(f.t, f.len * 0.5), anchor = nearestWood(wood, sub(f.c, mul(up, 0.94))), right = mul(lat, f.width * 0.5);
      const proxy = cardPiece(anchor.point, right, up, 0.97, o, sprayTile);
      proxy.spread = SPRAY_SPREAD * f.len;
      const placed = fit(proxy, poses(anchor.point, [f.t, lat], 0.2, UP, 0.04));
      if (placed) {
        const frame = newPiece(o, sprayTile);
        for (const p of [anchor.point, add(anchor.point, right), add(anchor.point, up)]) pushVertex(frame, p, UP, 0, 0, 0, 0);
        const [a0, r0, u0] = placed.move(frame).pos;
        standIn = placed.piece;
        sprayShoots(b, rng, sh, o, a0, sub(r0, a0), sub(u0, a0), sprayLayout(sprayTile), plan.bark);
      }
    }
    // A juniper's fronds stand round its centre like the pages of an open book: one card each, upright through the frond, so neighbouring
    // fronds meet only near the centre line instead of crossing one another.
    const juniper = plan.species === 'juniper', pair = nextGroup++;
    // At the near LOD a spray is three short shoots along its branch, each cut from its third of the spray tile and tilted alternately
    // either way about the branch, so the spray has depth, and each small enough to follow the wind as a whole branch would (a metre-wide
    // card bends away from it far enough to cut through its neighbours). INNER_SHOOTS more, cut like the first, carry the spray on along
    // the branch toward the trunk, where a spruce's branches are clothed too.
    if (lod === 0 && !realSpray && !juniper) {
      const up = mul(f.t, f.len * 0.5), [u0, v0, u1, v1] = o.rect;
      for (let k = -INNER_SHOOTS; k < FROND_SHOOTS; k++) {
        const y0 = -0.84 + (1.84 * k) / FROND_SHOOTS, part = mul(up, 1 / FROND_SHOOTS), y1 = -0.84 + (1.84 * (Math.max(k, 0) + 1)) / FROND_SHOOTS;
        // Fractions of the card from its top; the top shoot's rounds to just past 1, which would put its v off the tile.
        const vTop = v0 + (v1 - v0) * 0.92 * Math.max(0, 1 - (y1 + 0.84) / 1.84), vBot = v0 + (v1 - v0) * 0.92 * Math.min(1, 1 - (y1 - 1.84 / FROND_SHOOTS + 0.84) / 1.84);
        const anchor = nearestWood(wood, add(f.c, mul(up, y0))), um = (u0 + u1) / 2;
        // Each shoot is cut again down the branch: its side shoots on either side are a half card each, drooping outward from the branch
        // in a shallow V as a spruce spray does, narrow enough to settle among its neighbours and follow the wind.
        for (const h of [1, -1]) {
          const so = { ...o, rect: [h > 0 ? um : u0, vTop, h > 0 ? u1 : um, vTop + (vBot - vTop) / 0.92] as [number, number, number, number] };
          const right = mul(rotAxis(lat, f.t, h * SPRAY_DROOP + (k % 2 === 0 ? 0.15 : -0.15)), f.width * 0.4);
          const piece = cardPiece(anchor.point, right, part, 0.97, so, sprayTile, pair), last = piece.pos.length - 1;
          for (let i = 0; i < last; i++) piece.pos[i] = add(piece.pos[i], mul(right, h));
          const placed = settle(b, piece, anchor.point, [f.t, lat], 0.2, UP, 0.04);
          if (placed) audit?.foliage.push(attached(placed, anchor.limb!));
        }
      }
    }
    for (const s of realSpray || (lod === 0 && !juniper) ? [] : juniper ? [0] : [1, -1]) {
      const right = mul(juniper ? norm(cross(lat, f.t)) : rotAxis(lat, f.t, s * 0.6), f.width * (juniper ? 0.45 : 0.5) * grow), up = mul(f.t, f.len * 0.5 * grow);
      if (lod === 0) {
        const anchor = nearestWood(wood, sub(f.c, mul(up, 0.94)));
        // A juniper page is a grid of two rows, so it bends with the wind as a whole frond would, and it starts a quarter of the frond out
        // from the centre, where the pages crowd together, on a bare stalk from the wood. JUNIPER_PAGE_LENGTH keeps the page, once moved out
        // off the centre line, inside the footprint the park reserves for the frond (src/world/park/planting.ts plantingBounds).
        const piece = juniper ? shapedCard(add(anchor.point, mul(up, 0.5)), mul(right, 1.2), mul(up, JUNIPER_PAGE_LENGTH), 0.97, o, FLAT, 2, sprayTile) : cardPiece(anchor.point, right, up, 0.97, o, sprayTile, pair);
        if (juniper) {
          // A steep frond's page reaches past the centre line with its inner edge, where it would cut through every page on the far side: it
          // moves straight out until that edge stands JUNIPER_AXIS_ROOM off the line.
          const out = norm([f.t[0], 0, f.t[2]]), last = piece.pos.length - 1;
          let inner = Infinity;
          for (let i = 0; i < last; i++) inner = Math.min(inner, dot3(piece.pos[i], out));
          const d = mul(out, Math.max(0, JUNIPER_AXIS_ROOM - inner));
          for (let i = 0; i < last; i++) piece.pos[i] = add(piece.pos[i], d);
          piece.pos[last] = anchor.point;
          juniperShoots(piece, o, sprayTile);
        }
        const placed = settle(b, piece, anchor.point, [f.t, lat], 0.2, UP, 0.04);
        if (placed) audit?.foliage.push(attached(placed, anchor.limb!));
      }
      else card(b, f.c, right, up, o);
    }
    if (plan.species === 'spruce') {
      // A Norway spruce's upturned branches carry a curtain of drooping branchlets, each a bottle-brush of needles all round: curved, crossed
      // ribbons hang from points along the branch and fill the crown with needles in depth: one per branch within budget, six (and two at the
      // far LOD) at the extreme tier.
      const count = lod === 0 ? (dense ? (realSpray ? 5 : 6) : 1) : dense ? 2 : 0;
      for (let k = 0; k < count; k++) branchlet(b, rng, sh, f, lat, (k + rng.range(0.15, 0.85)) / count, k % 2 === 0 ? 1 : -1, lod === 0 && dense, grow, dense ? 4 : 3, lod === 0 ? wood : [], audit);
    }
    if (lod !== 0) continue;
    // Other conifers' side shoots hang from the branch in a curtain under the flat spray: cards pointing down and out from the branch fill the
    // crown with needles in depth instead of one flat layer per branch.
    for (let k = 0; k < (plan.species === 'spruce' || juniper ? 0 : dense ? 2 : 1); k++) {
      const at = sub(f.c, mul(f.t, f.len * rng.range(0.05, 0.3)));
      const hang = norm(add(mul(f.t, rng.range(0.25, 0.6)), [0, -1, 0]));
      const across = norm(cross(hang, lat));
      const right = mul(norm(add(lat, mul(across, rng.range(-0.4, 0.4)))), f.width * rng.range(0.28, 0.36)), down = mul(hang, f.len * rng.range(0.24, 0.34));
      const anchor = nearestWood(wood, at);
      const placed = settle(b, cardPiece(anchor.point, right, down, 0.97, cardOptions(sh, TILE.needles, KIND.needle, rng.next(), rng.next() < 0.5), TILE.needles), anchor.point, [hang], 0.3);
      if (placed) audit?.foliage.push(attached(placed, anchor.limb!));
    }
    if (dense && !realSpray) {
      const anchor = nearestWood(wood, sub(f.c, mul(f.t, f.len * 0.47)));
      const placed = settle(b, cardPiece(anchor.point, mul(lat, f.width * 0.45), mul(f.t, f.len * 0.48), 0.97, cardOptions(sh, TILE.needles, KIND.needle, rng.next(), true), TILE.needles, pair), anchor.point, [f.t], 0.25);
      if (placed) audit?.foliage.push(attached(placed, anchor.limb!));
    }
  }
}

/**
 * A strip along `pts` (base first, on the wood) of half-width `side[i]` at each point, textured from the tile's painted base (v = 0.97) to its
 * top, closed by a stationary root vertex at the base so wind cannot tear it off the branch. Returns its vertex count.
 */
function ribbon(pts: readonly Vec3[], side: readonly Vec3[], o: CardOptions, tile: number, group: number): FPiece {
  const [u0, v0, u1, v1] = o.rect, n = pts.length, piece = newPiece(o, tile, group);
  for (let i = 0; i < n; i++) {
    const f = i / (n - 1), v = lerp(v0 + (v1 - v0) * 0.97, v0 + (v1 - v0) * 0.02, f);
    for (const [s, u] of [[-1, u0], [1, u1]] as const) {
      const p = add(pts[i], mul(side[i], s));
      // Flutter grows from nothing where the branchlet leaves the branch to full at its tip.
      pushVertex(piece, p, o.normalAt(p), u, v, o.aoAt(p), o.swayAt(p) * f);
    }
  }
  for (let i = 0; i < n - 1; i++) { const a = 2 * i; piece.tris.push([a, a + 1, a + 3], [a, a + 3, a + 2]); }
  const root = pushVertex(piece, pts[0], o.normalAt(pts[0]), (u0 + u1) / 2, v0 + (v1 - v0) * 0.97, o.aoAt(pts[0]), 0);
  piece.tris.push([root, 0, 1]);
  return piece;
}

/**
 * One drooping spruce branchlet hanging from fraction `along` of frond `f`, on flank `flank`: a path that leaves the branch down and out and
 * bends further down under its own weight, dressed in a bottle-brush ribbon; at the extreme tier's full detail two crossed ones, so it reads round from any side.
 */
function branchlet(b: MeshBuilder, rng: Rng, sh: Shading, f: Frond, lat: Vec3, along: number, flank: number, crossed: boolean, grow: number, segments: number, wood: Limb[], audit?: TreeContactAudit): void {
  const len = f.len * grow * rng.range(0.6, 0.9) * (1 - 0.3 * along), half = len * rng.range(0.17, 0.22);
  // It hangs from the nearest real wood to its point along the branch (the near LOD's branch tubes; the far LOD has no fine wood to hold it).
  const at = add(add(f.c, mul(f.t, f.len * grow * (along - 0.5) * 0.9)), mul(lat, flank * f.width * grow * 0.08));
  const anchor = wood.length ? nearestWood(wood, at) : null;
  let p = anchor ? anchor.point : at;
  let d = norm(add(add(mul(lat, flank * rng.range(0.3, 0.7)), mul(f.t, rng.range(0.2, 0.45))), [0, -rng.range(0.5, 0.9), 0]));
  const pts: Vec3[] = [p], dirs: Vec3[] = [d];
  for (let i = 0; i < segments; i++) {
    p = add(p, mul(d, len / segments));
    d = norm(add(d, [0, -0.35, 0]));
    pts.push(p); dirs.push(d);
  }
  const tile = rng.next() < 0.5 ? TILE.brush : TILE.brush2, o = cardOptions(sh, tile, KIND.needle, rng.next(), rng.next() < 0.5);
  const turn = rng.range(0, Math.PI), group = nextGroup++;
  for (const r of crossed ? [turn, turn + Math.PI / 2] : [turn]) {
    // A branchlet that would hang through its neighbours swings about its point of attachment.
    const placed = settle(b, ribbon(pts, dirs.map((t) => mul(rotAxis(norm(cross(t, lat)), t, r), half)), o, tile, group), pts[0], [UP, lat], 0.3, lat, 0.04);
    if (anchor && placed) audit?.foliage.push(attached(placed, anchor.limb!));
  }
}

/**
 * A spruce spray as real shoots: the spray tile's leader as a thin tube and each of its side shoots as two crossed bottle-brush ribbons
 * (the brush tiles, which paint a side shoot with its secondary shoots), at the painted shoot's place in the spray, drooping under its own
 * weight toward the tip. From any side the spray has depth and gaps instead of one flat sheet of needles. `right` and `up` are the half
 * extents of the flat card the spray replaces, `anchor` its base on the branch.
 */
function sprayShoots(b: MeshBuilder, rng: Rng, sh: Shading, o: CardOptions, anchor: Vec3, right: Vec3, up: Vec3, layout: SprayLayout, bark: number): void {
  const center = add(anchor, mul(up, 0.94)), face = norm(cross(right, up)), h = len3(right);
  const at = (tu: number, tv: number): Vec3 => add(center, add(mul(right, (tu - 0.5) * 2), mul(up, 1 - 2 * tv)));
  const lead = [0, 5, 10, layout.leader.length - 1].map((i) => at(...layout.leader[i]));
  tube(b, lead, [0.006 * h * 2, 0.005 * h * 2, 0.004 * h * 2, 0.0025 * h * 2], { sides: 3, kind: bark, sway: (y) => sh.swayAt(y), ao: (p) => o.aoAt(p) });
  // The spray was placed in the tree as a whole (emitFronds); its shoots only have to keep out of each other's way.
  const shared = space;
  if (shared) { space = new FoliageSpace(); treeSpace = shared; }
  for (const sh2 of layout.shoots) {
    const a = at(sh2.ax, sh2.ay), e = at(sh2.bx, sh2.by), length = len3(sub(e, a)), sag = length * rng.range(0.15, 0.4);
    const pts: Vec3[] = [a, add(add(a, mul(sub(e, a), 0.5)), [0, -0.35 * sag, 0]), add(e, [0, -sag, 0])];
    const dirs = pts.map((_, i) => norm(sub(pts[Math.min(i + 1, 2)], pts[Math.max(i - 1, 0)])));
    const tile = rng.next() < 0.5 ? TILE.brush : TILE.brush2, ro = cardOptions(sh, tile, KIND.needle, rng.next(), rng.next() < 0.5);
    const half = length * rng.range(0.5, 0.6), turn = rng.range(-0.3, 0.3), group = nextGroup++;
    for (const r of [turn + 0.6, turn - 0.6]) settle(b, ribbon(pts, dirs.map((t) => mul(rotAxis(norm(cross(t, face)), t, r), half)), ro, tile, group), a, [face, dirs[0]], 0.25);
  }
  space = shared;
  treeSpace = standIn = null;
}

/** A far-LOD pine branch end: a card of the branch-end tile whose base sits at the cluster centre and whose tip points along a random direction. */
function tuft(b: MeshBuilder, rng: Rng, sh: Shading, cl: Cluster, halfLen: number): void {
  const d = randomDir(rng), side = norm(cross(d, randomDir(rng)));
  card(b, add(cl.c, mul(d, halfLen * 0.85)), mul(side, halfLen * 0.55), mul(d, halfLen), cardOptions(sh, TILE.pine, KIND.needle, rng.next(), rng.next() < 0.5));
}

/**
 * A Scots pine's branch end at the near LOD: `count` shoots, each a foxtail of needles (the single-shoot pine2 tile) on a straight ribbon
 * that leaves the wood near the cluster out and up, as pine shoots grow; two crossed ribbons each at the extreme tier, so a shoot reads round
 * from any side. The ribbons lie in near-level layers (twisted at most PINE_SHOOT_TWIST about their axis), as a branch end's shoots fan out:
 * twisted at random, neighbours met at steep angles and the wind's bending field pushed them through each other. Under a metre long, they
 * follow that field closely; the two-metre tuft cards these replace bent away from it and cut through their neighbours.
 */
function pineShoots(b: MeshBuilder, rng: Rng, sh: Shading, cl: Cluster, count: number, crossed: boolean, wood: Limb[], audit?: TreeContactAudit): void {
  for (let i = 0; i < count; i++) {
    const target = add(cl.c, mul(randomDir(rng), cl.r * rng.range(0.2, 0.7))), anchor = nearestWood(wood, target);
    const out = sub(target, anchor.point), d = norm(add(len3(out) > 1e-3 ? norm(out) : randomDir(rng), [0, 0.35, 0]));
    const length = Math.max(cl.r, PINE_SHOOT_SCALE_MIN) * rng.range(PINE_SHOOT_LENGTH[0], PINE_SHOOT_LENGTH[1]), d2 = norm(add(d, [0, 0.3, 0]));
    const tip = norm(add(d, d2)), pts: Vec3[] = [anchor.point, add(anchor.point, mul(tip, length))];
    const dirs = [tip, tip];
    // The painted shoot is as long as the tile is high and about as wide, so the ribbon keeps the tile's aspect.
    const half = length * 0.53, o = cardOptions(sh, TILE.pine2, KIND.needle, rng.next(), rng.next() < 0.5);
    const turn = rng.range(-PINE_SHOOT_TWIST, PINE_SHOOT_TWIST), group = nextGroup++;
    for (const r of crossed ? [turn, turn + Math.PI / 2] : [turn]) {
      const side = dirs.map((t) => mul(rotAxis(norm(cross(t, Math.abs(t[1]) < 0.95 ? UP : [1, 0, 0])), t, r), half));
      const placed = settle(b, ribbon(pts, side, o, TILE.pine2, group), anchor.point, [UP, d], 0.3, UP, 0.04);
      if (placed) audit?.foliage.push(attached(placed, anchor.limb!));
    }
  }
}

/** A pine shoot's length as a share of its cluster's radius (at least PINE_SHOOT_SCALE_MIN m: a small clump's shoots are still 35-55 cm
 * long, a real Scots pine shoot's length), how many shoots stand in for each of the plan's branch-end cards, and how far (rad) a shoot's
 * ribbon turns about its axis out of the level. */
const PINE_SHOOT_LENGTH = [0.5, 0.8] as const, PINE_SHOOTS_PER_CARD = 5, PINE_SHOOT_TWIST = 0.35, PINE_SHOOT_SCALE_MIN = 0.7;

/**
 * How far out in the crown a point is: 0 at its centre, 1 on the crown ellipsoid (plan crownC, crownR). Shoots beyond OUTER_SHELL count as
 * on the outside of the crown and are built leaf by leaf at the extreme tier (leafShoot); the rest, mostly hidden, stay cards.
 */
const shellDepth = (plan: TreePlan, p: Vec3): number =>
  Math.hypot((p[0] - plan.crownC[0]) / plan.crownR[0], (p[1] - plan.crownC[1]) / plan.crownR[1], (p[2] - plan.crownC[2]) / plan.crownR[2]);
const OUTER_SHELL = 0.95;

/** How a shoot card is bent out of its plane: tangent of the fold angle along the stem, tip curl and twist, all relative to the card's half size. */
interface CardShape { fold: number; curl: number; twist: number }
const FLAT: CardShape = { fold: 0, curl: 0, twist: 0 };

/**
 * A shoot card bent into a shallow 3D shape, anchored like anchoredCard (a stationary root vertex on the shoot, last). Real sprays are not
 * flat: the two sides rise from the stem in a V, the tip droops and the spray twists along its length. With `rows` 0 it keeps anchoredCard's
 * five vertices and three triangles, so the four corners lift into a cupped bowl around the root at no extra cost; with `rows` > 0 it is a
 * grid of three columns (the middle one on the painted stem) and that many rows above the base row, so the fold and the curl are real
 * creases. Vertex normals follow the bent surface, half blended with the crown normal so a crown still shades as a volume. Returns its
 * vertex count.
 */
function shapedCard(anchor: Vec3, right: Vec3, up: Vec3, stemV: number, o: CardOptions, s: CardShape, rows: number, tile: number): FPiece {
  const h = len3(up), face = norm(cross(right, up)), [u0, v0, u1, v1] = o.rect, piece = newPiece(o, tile);
  const center = add(anchor, mul(up, 2 * stemV - 1));
  // Height above the card plane (m) at card coordinates x (-1..1 across) and y (-0.84 at the base row .. 1 at the tip), and its normal.
  const lift = (x: number, y: number): number => { const t = (y + 0.84) / 1.84; return h * (s.fold * Math.abs(x) - s.curl * t * t + s.twist * x * t); };
  const point = (x: number, y: number): Vec3 => add(add(center, add(mul(right, x), mul(up, y))), mul(face, lift(x, y)));
  const normal = (x: number, y: number, p: Vec3): Vec3 => {
    const t = (y + 0.84) / 1.84;
    const dx = add(right, mul(face, h * (s.fold * Math.sign(x) + s.twist * t))), dy = add(up, mul(face, (h * (-2 * s.curl * t + s.twist * x)) / 1.84));
    const g = norm(cross(dx, dy)), c = o.normalAt(p);
    return norm(add(mul(c, 0.5), mul(dot3(g, c) < 0 ? mul(g, -1) : g, 0.5)));
  };
  const vert = (x: number, y: number): number => {
    const p = point(x, y), u = u0 + (u1 - u0) * (x + 1) / 2, v = v0 + (v1 - v0) * 0.92 * (1 - (y + 0.84) / 1.84);
    return pushVertex(piece, p, normal(x, y, p), u, v, o.aoAt(p), o.swayAt(p));
  };
  const rootVertex = (): number => pushVertex(piece, anchor, o.normalAt(anchor), (u0 + u1) / 2, v0 + (v1 - v0) * stemV, o.aoAt(anchor), 0);
  if (rows === 0) {
    const ids = [[1, -0.84], [1, 1], [-1, 1], [-1, -0.84]].map(([x, y]) => vert(x, y));
    const root = rootVertex();
    for (let i = 0; i < 3; i++) piece.tris.push([root, ids[i], ids[i + 1]]);
    return piece;
  }
  for (let j = 0; j <= rows; j++) for (const x of [-1, 0, 1]) vert(x, -0.84 + (1.84 * j) / rows);
  for (let j = 0; j < rows; j++) for (let i = 0; i < 2; i++) { const a = 3 * j + i; piece.tris.push([a, a + 1, a + 4], [a, a + 4, a + 3]); }
  const root = rootVertex();
  piece.tris.push([root, 1, 0], [root, 2, 1]);
  return piece;
}

/** A foliage piece as it is emitted: the clash-checked geometry plus the vertex attributes the mesh needs. */
interface FPiece extends Piece { nrm: Vec3[]; sway: number[]; ao: number[]; kind: number; phase: number }

/** Near-LOD foliage placed so far in the tree being built (null at the far LODs, where nothing is checked), and the next free group id. */
let space: FoliageSpace | null = null;
/** The near LOD's drawn foliage pieces, collected when FoliageOptions.pieces asks for them. */
let emitted: FPiece[] | null = null;
/** While a shoot is built in its own space (leafShoot, sprayShoots), the whole tree's: its pieces must fit there too. */
let treeSpace: FoliageSpace | null = null;
/** The card that holds that shoot's place in the tree's space (its own pieces may overlap it). */
let standIn: FPiece | null = null;
let nextGroup = 0;
/** Sway weight by height of the tree being built (Shading.swayAt), which a piece's weights follow when the clash pass moves it (resway). */
let heightSway: ((y: number) => number) | null = null;
/** Room the needle pieces of the plant being built keep (NEEDLE_ROOM, or BUSH_NEEDLE_ROOM for a juniper), set by buildTreeLods. */
let needleRoom = 0;
/** Phase (colour tone) of the twig being dressed: the leaves of one shoot are nearly the same shade, as on a real tree. */
let twigPhase = 0;

/**
 * Room (m) a leaf piece keeps from its neighbours, and how far (cells of a 128-cell tile mask) the check looks for paint around each of its
 * probes (about their spacing on a shoot card). Needle shoots look closer, being painted solid and crowded along their branches. A conifer
 * tree's needle shoots keep NEEDLE_ROOM: in a strong wind its tall crown bends a little differently from piece to piece: at 6 mm one pair in
 * a hundred to two hundred pieces brushed through each other, at 15 mm about one in two thousand. A juniper, whose low fronds hardly move, keeps BUSH_NEEDLE_ROOM.
 */
const LEAF_ROOM = 0.01, LEAF_NEAR = 4, NEEDLE_ROOM = 0.015, BUSH_NEEDLE_ROOM = 0.006, NEEDLE_NEAR = 2;
/** At the extreme tier: how far (m) a shoot built leaf by leaf spreads off its card's plane, and the room its leaves keep from each other. */
const SHOOT_SPREAD = 0.035, LEAF_LEAF_ROOM = 0.004;
/** Short shoots a conifer spray is built from at the near LOD (emitFronds). */
const FROND_SHOOTS = 2, INNER_SHOOTS = 1;
/** At the extreme tier, sprays this far out in the crown (shellDepth) are built shoot by shoot (sprayShoots); inside it, as half-shoots. */
const SPRAY_SHELL = 0.85;
/** How far (rad) the two halves of a near-LOD spray shoot droop from the branch's level either side. */
const SPRAY_DROOP = 1.15;
/** How far (m) a juniper's frond pages keep their inner edges off the shrub's centre line, and a page's height as a share of its frond's
 * half-length (emitFronds). */
const JUNIPER_AXIS_ROOM = 0.15, JUNIPER_PAGE_LENGTH = 0.72;
/** How far a spruce spray built shoot by shoot (sprayShoots) spreads off its card's plane, per metre of spray length. */
const SPRAY_SPREAD = 0.15;

function newPiece(o: CardOptions, tile: number, group = nextGroup++): FPiece {
  return { pos: [], nrm: [], uv: [], sway: [], tris: [], ao: [], kind: o.kind, phase: o.phase, opaque: tileOpacity(tile), group,
    ...(o.kind === KIND.needle ? { near: tileOpacity(tile, NEEDLE_NEAR), room: needleRoom } : { near: tileOpacity(tile, LEAF_NEAR), room: LEAF_ROOM }) };
}

function pushVertex(p: FPiece, pos: Vec3, n: Vec3, u: number, v: number, ao: number, sway: number): number {
  p.pos.push(pos); p.nrm.push(norm(n)); p.uv.push([u, v]); p.ao.push(ao); p.sway.push(sway);
  return p.pos.length - 1;
}

/** A copy of a piece turned by `angle` about the line through `pivot` along the unit `axis`. */
function turned(p: FPiece, pivot: Vec3, axis: Vec3, angle: number): FPiece {
  return { ...p, pos: p.pos.map((q) => add(pivot, rotAxis(sub(q, pivot), axis, angle))), nrm: p.nrm.map((n) => rotAxis(n, axis, angle)) };
}

/** A copy of a piece shrunk by `s` toward `pivot`. */
function scaled(p: FPiece, pivot: Vec3, s: number): FPiece {
  return { ...p, pos: p.pos.map((q) => add(pivot, mul(sub(q, pivot), s))) };
}

/** A copy of a piece moved by `d`, except where it is fixed on its wood at `pivot` (its stalk tilts up or down to follow). */
function shifted(p: FPiece, d: Vec3, pivot: Vec3): FPiece {
  return { ...p, pos: p.pos.map((q) => (q[0] === pivot[0] && q[1] === pivot[1] && q[2] === pivot[2] ? q : add(q, d))) };
}

/**
 * Emits a foliage piece where it crosses no other: at the near LOD it is tried as built, then turned about each of `axes` through `pivot`
 * by growing angles both ways, then shrunk, and the first pose that crosses nothing is kept (FoliageSpace). Returns its vertex count, 0 if
 * no pose fits and the piece is left out.
 */
function settle(b: MeshBuilder, base: FPiece, pivot: Vec3, axes: readonly Vec3[], step: number, lift?: Vec3, gap = 0.03, slide: readonly Vec3[] = []): FPiece | null {
  const f = fit(base, poses(pivot, axes, step, lift, gap, slide));
  if (f) emit(b, f.piece);
  return f?.piece ?? null;
}

/** A placed piece's attachment for the contact audit: its stationary root vertex (the last) on `limb`. */
const attached = (p: FPiece, limb: Limb): { point: Vec3; limb: Limb; span: number } => ({ point: p.pos[p.pos.length - 1], limb, span: p.pos.length });

/** Moves that slide a spray from fraction `along` of its straight twig to nearby points on it, by 3, 6 and 9 cm each way. */
function slides(shoot: Limb, along: number): Vec3[] {
  const d = sub(shoot.pts[1], shoot.pts[0]), length = len3(d), out: Vec3[] = [];
  for (const k of [1, -1, 2, -2, 3, -3]) {
    const f = along + (0.03 * k) / length;
    if (f > 0.05 && f < 1) out.push(mul(d, f - along));
  }
  return out;
}

/** The candidate poses settle tries, in order, as moves of a piece. */
function poses(pivot: Vec3, axes: readonly Vec3[], step: number, lift?: Vec3, gap = 0.03, slide: readonly Vec3[] = []): ((q: FPiece) => FPiece)[] {
  // Sliding the piece along its twig (when it can) and lifting it a little off its layer come first, then turning it, then the piece at three quarters
  // and about half its size, in the first few of those poses.
  const moves: ((q: FPiece) => FPiece)[] = slide.map((d) => (q: FPiece) => ({ ...q, pos: q.pos.map((v) => add(v, d)) }));
  if (lift) for (const d of [1, -1, 2, -2, 3, -3]) moves.push((q) => shifted(q, mul(lift, d * gap), pivot));
  for (const axis of axes) for (const d of [1, -1, 2, -2, 4, -4]) moves.push((q) => turned(q, pivot, axis, d * step));
  const smaller = [0.75, 0.55].flatMap((k) => {
    const shrink = (q: FPiece): FPiece => scaled(q, pivot, k);
    return [shrink, ...moves.slice(0, 6).map((f) => (q: FPiece) => f(shrink(q)))];
  });
  return [(q) => q, ...moves, ...smaller];
}

/** The first pose of `base` that crosses nothing, placed in the foliage space, with the move that made it; null if none fits. */
function fit(base: FPiece, moves: readonly ((q: FPiece) => FPiece)[]): { piece: FPiece; move: (q: FPiece) => FPiece } | null {
  if (!space) return { piece: base, move: moves[0] };
  let k = 0;
  const p = space.place((i) => (i < moves.length ? moves[(k = i)](base) : null), treeSpace ?? undefined, standIn ?? undefined) as FPiece | null;
  return p ? { piece: k === 0 ? p : resway(p, base), move: moves[k] } : null;
}

/**
 * A moved piece with its sway weights following its vertices to their new heights (they were set by height where it was built): a piece
 * turned down toward the ground sways as little as the foliage round it there, so the wind moves it with its neighbours.
 */
function resway(p: FPiece, base: FPiece): FPiece {
  if (!heightSway) return p;
  const w = heightSway;
  return { ...p, sway: p.sway.map((s, i) => { const before = w(base.pos[i][1]); return before > 1e-6 ? Math.min(1, (s * w(p.pos[i][1])) / before) : s; }) };
}

/** Adds a piece to the mesh; returns its vertex count. */
function emit(b: MeshBuilder, p: FPiece): number {
  emitted?.push(p);
  const phase = (p.phase % 1 + 1) % 1;
  const first = b.vertexCount;
  for (let i = 0; i < p.pos.length; i++) b.vertex({ p: p.pos[i], n: p.nrm[i], u: p.uv[i][0], v: p.uv[i][1], ao: p.ao[i], sway: p.sway[i], kind: p.kind, phase });
  for (const [i, j, k] of p.tris) b.tri(first + i, first + j, first + k);
  return p.pos.length;
}

/**
 * A juniper frond's side shoots: short cards rising out of either face of its page (a two-row shapedCard grid) from points along its stem,
 * so the shrub is a mass of needles in depth instead of a star of flat pages with air between them. They become part of the page piece,
 * ahead of its root vertex (which stays last, on the wood), and each shoot's foot moves with the wind as the page does where it grows from
 * (foliage sways by height), so the two stay joined.
 */
function juniperShoots(page: FPiece, o: CardOptions, tile: number): void {
  const base = page.pos[1], tip = page.pos[7], stem = sub(tip, base), length = len3(stem);
  const across = sub(page.pos[2], page.pos[0]), face = norm(cross(across, stem)), side = norm(across), width = len3(across);
  const root = page.pos.length - 1, keep = { pos: page.pos[root], nrm: page.nrm[root], uv: page.uv[root], ao: page.ao[root], sway: page.sway[root] };
  for (const key of ['pos', 'nrm', 'uv', 'ao', 'sway'] as const) page[key].pop();
  const rootTris = page.tris.filter((t) => t.includes(root)), tris = page.tris.filter((t) => !t.includes(root));
  for (const [along, s] of JUNIPER_SHOOTS) {
    const foot = add(base, mul(stem, along)), dir = norm(add(mul(norm(stem), Math.cos(JUNIPER_SHOOT_TILT)), mul(face, s * Math.sin(JUNIPER_SHOOT_TILT))));
    const shoot = cardPiece(foot, mul(side, width * 0.22), mul(dir, length * 0.22), 0.97, o, tile);
    shoot.sway[shoot.sway.length - 1] = o.swayAt(foot);
    const first = page.pos.length;
    for (let i = 0; i < shoot.pos.length; i++) pushVertex(page, shoot.pos[i], shoot.nrm[i], shoot.uv[i][0], shoot.uv[i][1], shoot.ao[i], shoot.sway[i]);
    for (const [i, j, k] of shoot.tris) tris.push([first + i, first + j, first + k]);
  }
  const last = page.pos.length;
  page.pos.push(keep.pos); page.nrm.push(keep.nrm); page.uv.push(keep.uv); page.ao.push(keep.ao); page.sway.push(keep.sway);
  for (const t of rootTris) tris.push(t.map((i) => (i === root ? last : i)) as [number, number, number]);
  page.tris = tris;
}

/** Where a juniper page's side shoots grow (fraction of its stem, and which face), and how far (rad) they lean out of it. */
const JUNIPER_SHOOTS: readonly [number, number][] = [[0.45, 1], [0.6, -1], [0.75, 1], [0.9, -1]];
const JUNIPER_SHOOT_TILT = 0.7;

/** anchoredCard (meshBuilder.ts) as a foliage piece: a flat card with a stationary root vertex at the painted stem base, last. */
function cardPiece(anchor: Vec3, right: Vec3, up: Vec3, stemV: number, o: CardOptions, tile: number, group?: number): FPiece {
  const center = add(anchor, mul(up, 2 * stemV - 1)), [u0, v0, u1, v1] = o.rect, piece = newPiece(o, tile, group);
  const ids = [[1, -0.84, u1, v0 + (v1 - v0) * 0.92], [1, 1, u1, v0], [-1, 1, u0, v0], [-1, -0.84, u0, v0 + (v1 - v0) * 0.92]].map(([x, y, u, v]) => {
    const p = add(center, add(mul(right, x), mul(up, y)));
    return pushVertex(piece, p, o.normalAt(p), u, v, o.aoAt(p), o.swayAt(p));
  });
  const root = pushVertex(piece, anchor, o.normalAt(anchor), (u0 + u1) / 2, v0 + (v1 - v0) * stemV, o.aoAt(anchor), 0);
  for (let i = 0; i < 3; i++) piece.tris.push([root, ids[i], ids[i + 1]]);
  return piece;
}

const len3 = (a: Vec3): number => Math.hypot(a[0], a[1], a[2]);
const dot3 = (a: Vec3, c: Vec3): number => a[0] * c[0] + a[1] * c[1] + a[2] * c[2];

/**
 * The atlas's painted stem starts exactly on a physical shoot, rather than inside an unconnected leaf ball. The spray faces its twig's way
 * (`facing`, out of the crown and up toward the light) and fans out in that plane.
 */
function sprig(b: MeshBuilder, rng: Rng, plan: TreePlan, sh: Shading, shoot: Limb, along: number, audit?: TreeContactAudit, dense = false, perLeaf = false, facing: Vec3 = UP): void {
  // The sprays of one twig form a leaf mosaic: they all face the twig's light direction and fan out within that plane, each lying on its own
  // layer (their anchors step along the twig, which climbs through the planes), so neighbours on a twig overlap without ever crossing.
  const tangent = norm(sub(shoot.pts[1], shoot.pts[0])), anchor = add(shoot.pts[0], mul(sub(shoot.pts[1], shoot.pts[0]), along));
  const spread = add(tangent, mul(randomDir(rng), 0.8));
  let direction = sub(spread, mul(facing, dot3(spread, facing)));
  direction = len3(direction) < 1e-3 ? norm(cross(facing, randomDir(rng))) : norm(direction);
  const h = plan.cardSize * rng.range(0.8, 1.25), up = mul(direction, h), right = mul(norm(cross(direction, facing)), h);
  // Flat: bent cards of different directions could not share the layers. The leaves' own fold, curl and tilt are in the atlas normals.
  const shape = FLAT;
  const tile = shootTile(plan, rng), o = cardOptions(sh, tile, plan.foliage, twigPhase + rng.range(-0.015, 0.015), rng.next() < 0.5), mirror = o.rect[0] > o.rect[2];
  // Only shoots on the outside of the crown are built leaf by leaf; the ones inside it, mostly hidden, stay bent cards.
  const outer = perLeaf && shellDepth(plan, anchor) > OUTER_SHELL;
  const layout = outer ? shootLayout(tile) : null, sheet = outer ? sheetFor(tile) : null;
  if (layout && sheet !== null) {
    // The shoot is placed as its card (whose tile paints the same leaves), keeping room for its leaves either side of it, and is then built
    // leaf by leaf in the pose that fitted. Where the whole shoot does not fit, its leaves are fitted one by one into the gaps around it.
    const proxy = shapedCard(anchor, right, up, 0.96, o, shape, 0, tile);
    proxy.spread = SHOOT_SPREAD;
    const placed = fit(proxy, poses(anchor, [facing, direction], 0.25, facing, 0.03, slides(shoot, along)));
    if (!placed) {
      leafShoot(b, rng, plan, sh, o, anchor, right, up, shape, mirror, layout, sheet, true);
      return;
    }
    const frame = newPiece(o, tile);
    for (const p of [anchor, add(anchor, right), add(anchor, up)]) pushVertex(frame, p, UP, 0, 0, 0, 0);
    const [a0, r0, u0] = placed.move(frame).pos;
    standIn = placed.piece;
    leafShoot(b, rng, plan, sh, o, a0, sub(r0, a0), sub(u0, a0), shape, mirror, layout, sheet);
    return;
  }
  // A card that would pass through its neighbours slides along its twig to another layer, lifts, turns about its own stem (spreading the
  // twig's sprays round it) or fans within its plane.
  const placed = settle(b, shapedCard(anchor, right, up, 0.96, o, shape, 0, tile), anchor, [facing, direction], 0.25, facing, 0.03, slides(shoot, along));
  if (placed) audit?.foliage.push(attached(placed, shoot));
}

/**
 * The extreme tier's near shoot as real geometry: the twigs the shoot tile paints, as thin tubes in the bent card's place, and every leaf
 * the tile paints as its own small bent mesh cut from the species' single-leaf sheet, at the painted leaf's place, size and direction but
 * tilted a little on its stalk (facing the shoot's way and up, with a small scatter, so the shoot stays a layer of leaves) and folded along
 * its midrib (two triangles each side; the droop of the tip is in the normals). The end of its stalk stays fixed on the twig.
 */
function leafShoot(b: MeshBuilder, rng: Rng, plan: TreePlan, sh: Shading, o: CardOptions, anchor: Vec3, right: Vec3, up: Vec3, s: CardShape,
  mirror: boolean, layout: ShootLayout, sheet: number, alone = false): void {
  const h = len3(up), face = norm(cross(right, up)), center = add(anchor, mul(up, 0.92)), m = mirror ? -1 : 1;
  // Tile coordinates (u right, v down) to the bent card, as shapedCard places them.
  const at = (tu: number, tv: number): Vec3 => {
    const x = (tu - 0.5) * 2 * m, y = 1 - 2 * tv, t = (y + 0.84) / 1.84;
    return add(add(center, add(mul(right, x), mul(up, y))), mul(face, h * (s.fold * Math.abs(x) - s.curl * t * t + s.twist * x * t)));
  };
  const [u0, v0, u1, v1] = tileRect(sheet), cu = (u1 - u0) / SHEET, cv = (v1 - v0) / SHEET;
  // A shoot placed in the tree as a whole (its card, sprig) only has to keep its leaves out of each other's way; one placed alone fits each
  // leaf among everything else in the tree.
  const shared = space;
  if (!alone && shared) { space = new FoliageSpace(); treeSpace = shared; }
  let leaves = 0;
  for (const l of layout.leaves) {
    const stalk = at(l.bx - l.dx * l.petiole, l.by - l.dy * l.petiole);
    const inPlane = norm(sub(at(l.bx + l.dx * l.len, l.by + l.dy * l.len), at(l.bx, l.by)));
    // The leaf's own facing: the shoot's and a little up toward the light, with a small scatter, and its blade direction kept close to the painted one.
    const n0 = norm(add(add(face, mul(UP, 0.15)), mul(randomDir(rng), 0.2)));
    let a = sub(inPlane, mul(n0, dot3(inPlane, n0)));
    a = len3(a) < 1e-3 ? norm(cross(n0, randomDir(rng))) : norm(add(norm(a), [0, -rng.range(0, 0.35), 0]));
    const n = norm(sub(n0, mul(a, dot3(n0, a)))), lt = cross(n, a);
    const k = (l.len * 2 * h) / (SHEET_BASE_V - SHEET_TIP_V), along = (SHEET_STALK_V - SHEET_TIP_V) * k, half = SHEET_HALF_W * k;
    const fold = Math.tan(rng.range(8, 18) * Math.PI / 180), curl = rng.range(0.05, 0.2), twist = rng.range(-0.15, 0.15), flip = rng.next() < 0.5 ? -1 : 1;
    const cell = rng.int(0, SHEET * SHEET - 1), cx = cell % SHEET, cy = Math.floor(cell / SHEET);
    const piece = newPiece({ ...o, phase: o.phase + rng.range(-0.02, 0.02) }, sheet);
    piece.room = LEAF_LEAF_ROOM; piece.near = tileOpacity(sheet, 2);
    for (const q of [0, 1]) {
      for (const c of [-1, 0, 1]) {
        const p = add(add(add(stalk, mul(a, q * along)), mul(lt, c * half)), mul(n, fold * Math.abs(c) * half - curl * q * q * along + twist * c * q * half));
        const g = norm(add(sub(n, mul(lt, fold * Math.sign(c) + twist * q)), mul(a, 2 * curl * q - 0.5 * twist * c))), cn = o.normalAt(p);
        pushVertex(piece, p, add(mul(cn, 0.5), mul(dot3(g, cn) < 0 ? mul(g, -1) : g, 0.5)),
          u0 + cu * (cx + 0.5 + c * SHEET_HALF_W * flip), v0 + cv * (cy + SHEET_STALK_V - q * (SHEET_STALK_V - SHEET_TIP_V)), o.aoAt(p), q === 0 ? 0 : o.swayAt(p) * q);
      }
    }
    for (let i = 0; i < 2; i++) piece.tris.push([i, i + 1, i + 4], [i, i + 4, i + 3]);
    // A leaf that would pass through a neighbour lifts over or under it, swings aside on its stalk or rolls about its midrib, staying close to
    // the shoot's plane (within SHOOT_SPREAD of it).
    // Filling a gap among the rest of the tree, it only tries its own pose and small lifts: most gaps a leaf fits at all, it fits as it is.
    if (alone) { const f = fit(piece, poses(stalk, [], 0, n, 0.008).slice(0, 5)); if (f) { emit(b, f.piece); leaves++; } }
    else if (settle(b, piece, stalk, [n, a], 0.15, n, 0.008)) leaves++;
  }
  space = shared;
  treeSpace = standIn = null;
  // The twigs carry the leaves' stalks, so they are drawn whenever any leaf is (never a leaf left floating), and not for a shoot left bare.
  if (leaves === 0) return;
  for (const t of layout.twigs) {
    tube(b, [at(t.ax, t.ay), at(t.bx, t.by)], [t.r0 * 2 * h, t.r1 * 2 * h], { sides: 3, kind: plan.bark, sway: (y) => sh.swayAt(y), ao: (p) => o.aoAt(p) });
  }
}

function emitClusters(b: MeshBuilder, rng: Rng, plan: TreePlan, sh: Shading, lod: 0 | 1, wood: Limb[], audit?: TreeContactAudit, dense = false): void {
  // The extreme tier's near LOD builds every leaf of its shoots as geometry (leafShoot).
  const perLeaf = dense && lod === 0;
  const clusters = lod === 1 && !dense && plan.midClusters !== undefined ? plan.clusters.slice(0, plan.midClusters) : plan.clusters;
  for (const cl of clusters) {
    if (plan.radial) {
      if (lod === 0) pineShoots(b, rng, sh, cl, plan.cardsPerCluster * PINE_SHOOTS_PER_CARD, dense, wood, audit);
      else for (let i = 0; i < (dense ? 5 : 3); i++) tuft(b, rng, sh, cl, plan.cardSize * cl.r * 1.3);
    } else if (lod === 0) {
      const attachment = nearestWood(wood, cl.c);
      // One fine shoot per cluster bounds the added geometry; card corners retain the old cluster envelope. A dense crown grows a second
      // shoot from the same twig toward another side, so the cluster fills out to a ball of leaves instead of a fan.
      const reach = Math.max(0.03, cl.r - plan.cardSize * 1.25 * (Math.hypot(1, 1.92) - Math.SQRT2));
      // The per-leaf shoots of the extreme tier are full on their own, so they keep one shoot per cluster.
      for (let s = 0; s < (dense && !perLeaf ? 2 : 1); s++) {
        twigPhase = rng.next();
        const direction = norm(add(sh.normalAt(cl.c), mul(randomDir(rng), 1.5)));
        const shoot: Limb = { pts: [attachment.point, add(cl.c, mul(direction, reach))], radii: [Math.min(0.007, attachment.radius * 0.45), 0.0015], order: 5 };
        tube(b, shoot.pts, shoot.radii, { sides: 3, kind: plan.bark, sway: y => sh.swayAt(y), ao: sh.aoAt });
        audit?.wood.push(shoot);
        // The twig's leaves face out of the crown and up toward the light (so a crown seen from the side shows leaf faces, not edges); the
        // twig must climb through that plane steeply enough that its sprays, evenly spaced along it, sit on separate layers.
        const t = norm(sub(shoot.pts[1], shoot.pts[0]));
        let facing = norm(add(add(mul(UP, 0.6), sh.normalAt(cl.c)), mul(randomDir(rng), 0.35)));
        if (Math.abs(dot3(t, facing)) < 0.4) facing = norm(add(facing, mul(t, (dot3(t, facing) < 0 ? -1 : 1) * 0.6)));
        for (let i = 0; i < plan.cardsPerCluster; i++) sprig(b, rng, plan, sh, shoot, 0.15 + 0.8 * (i + 0.35 + 0.3 * rng.next()) / plan.cardsPerCluster, audit, dense, perLeaf, facing);
      }
    } else {
      // Four cards whose faces point along the corners of a tetrahedron, turned at random: no two are parallel or square to each other, so a
      // cluster keeps a leafy outline from every side, from above included, instead of the thin cross that three square cards leave edge-on.
      const h = cl.r * CLUSTER_CARD, spin = randomDir(rng), turn = rng.range(0, TAU), o = cardOptions(sh, TILE.blob, KIND.blob, rng.next());
      for (const corner of dense ? [...TETRAHEDRON, randomDir(rng), randomDir(rng)] : TETRAHEDRON) {
        const n = rotAxis(corner, spin, turn), across = norm(cross(n, Math.abs(n[1]) < 0.9 ? UP : [1, 0, 0]));
        const right = rotAxis(across, n, rng.range(0, TAU));
        card(b, cl.c, mul(right, h), mul(cross(n, right), h), o);
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

/** Clumps of cards a broadleaf's far LOD crown is built from. */
const LOD2_CLUMPS = 5;

/**
 * The crown's main leaf masses: its leaf clusters grouped into `k` by distance (weighted by cluster volume), each a centre and the radius
 * that covers its clusters. Deterministic: the groups start from clusters spread round the crown by angle and height.
 */
function crownClumps(plan: TreePlan, k: number): Cluster[] {
  const cl = plan.clusters, [cx, , cz] = plan.crownC;
  const order = cl.map((c, i) => ({ i, key: Math.atan2(c.c[2] - cz, c.c[0] - cx) + 0.3 * c.c[1] })).sort((a, b) => a.key - b.key);
  let centres: Vec3[] = Array.from({ length: k }, (_, j) => cl[order[Math.floor(((j + 0.5) * cl.length) / k)].i].c);
  const owner = new Int32Array(cl.length);
  for (let iteration = 0; iteration < 12; iteration++) {
    const sums = centres.map(() => [0, 0, 0, 0]);
    cl.forEach((c, i) => {
      let best = 0, bd = Infinity;
      centres.forEach((m, j) => { const d = (c.c[0] - m[0]) ** 2 + (c.c[1] - m[1]) ** 2 + (c.c[2] - m[2]) ** 2; if (d < bd) { bd = d; best = j; } });
      owner[i] = best;
      const w = c.r ** 3, s = sums[best];
      s[0] += c.c[0] * w; s[1] += c.c[1] * w; s[2] += c.c[2] * w; s[3] += w;
    });
    centres = centres.map((m, j) => (sums[j][3] > 0 ? [sums[j][0] / sums[j][3], sums[j][1] / sums[j][3], sums[j][2] / sums[j][3]] : m));
  }
  return centres.map((c, j) => {
    let reach = 0;
    cl.forEach((m, i) => { if (owner[i] === j) reach = Math.max(reach, len3(sub(m.c, c)) + m.r); });
    return { c, r: Math.max(reach, 0.3) };
  }).filter((_, j) => owner.includes(j));
}

/** Trunk stub and the crown: clumps of cards for a broadleaf (crownClumps), otherwise three vertical billboards 60 degrees apart and a horizontal canopy disc. */
function emitBillboards(b: MeshBuilder, rng: Rng, plan: TreePlan, sh: Shading): void {
  const bare = plan.clusters.length === 0 && plan.fronds.length === 0;
  if (plan.species !== 'bush' && plan.species !== 'juniper') {
    // The stub runs on into the crown so there is wood between the ground and the leaves, not a gap that the cards float above; a bare snag
    // is all trunk. It starts as deep as the near trunk so it meets sloping ground the same way.
    const trunk = plan.limbs[0], base = trunk.pts[0][1];
    const top = bare ? trunk.pts[trunk.pts.length - 1][1] : Math.max(0.5, Math.min(plan.crownC[1] + 0.3, 0.6 * plan.height));
    const ys = [base, 0.4, top * 0.5, top];
    tube(b, ys.map((y) => trunkAt(trunk, y)), ys.map((y) => trunkRadiusAt(trunk, y)), {
      sides: plan.trunkSides[2], kind: plan.bark, sway: (y) => sh.swayAt(y), ao: () => 1,
    });
  }
  if (bare) return;
  const cone = plan.species === 'spruce';
  if (!cone && plan.foliage === KIND.leaf && plan.clusters.length >= LOD2_CLUMPS) {
    // A broadleaf crown seen from afar is a heap of leaf masses with dark hollows and sky between them, not one smooth ball: a few clumps
    // of cards at the crown's main leaf masses (three cards each, turned so a clump reads from above as well as from the side), each as
    // large as its mass, so the outline is irregular and the inner and lower clumps come out darker than the outer ones.
    // How far the mid LOD's cluster cards reach from the axis (a card's corner at 1.05 r * sqrt 2 from its cluster's centre).
    const reach = Math.max(...plan.clusters.map((c) => Math.hypot(c.c[0], c.c[2]) + c.r * 1.05 * Math.SQRT2));
    for (const clump of crownClumps(plan, LOD2_CLUMPS)) {
      const o = cardOptions(sh, TILE.blob, KIND.blob, rng.next());
      // The far crown keeps twice the bake's share of the crown occlusion: it has no GI proxies and no finer leaves to carry the depth.
      o.aoAt = (p) => 1 - 2 * (1 - sh.aoAt(p));
      // A card's corner reaches 1.4 times its half size from the clump's centre: kept under the crown's top and inside the reach of the
      // mid LOD's cards round the axis (so the far crown is no wider than the near one, nor than a park planting's footprint).
      const top = plan.crownC[1] + plan.crownR[1], spin = randomDir(rng), turn = rng.range(0, TAU);
      const side = (reach - Math.hypot(clump.c[0], clump.c[2])) / 1.42;
      const h = Math.max(0.2, Math.min(0.8 * clump.r, (top - clump.c[1]) / 1.42, side));
      for (const corner of TETRAHEDRON.slice(0, 3)) {
        const n = rotAxis(corner, spin, turn), across = norm(cross(n, Math.abs(n[1]) < 0.9 ? UP : [1, 0, 0]));
        card(b, clump.c, mul(across, h), mul(cross(n, across), h), o);
      }
    }
    return;
  }
  const yaw0 = rng.range(0, Math.PI);
  for (let i = 0; i < 3; i++) billboard(b, plan, sh, yaw0 + (i * Math.PI) / 3, cone ? TILE.conifer : TILE.blob, cone ? KIND.cone : KIND.blob, rng.next());
  const [cx, cy, cz] = plan.crownC, [rx, ry, rz] = plan.crownR, y = cy + 0.15 * ry;
  card(b, [cx, y, cz], [rx * 0.85, 0, 0], [0, 0, rz * 0.85], {
    rect: tileRect(TILE.blob), kind: KIND.blob, normalAt: () => UP, aoAt: () => 0.8, swayAt: (p) => sh.swayAt(p[1]), phase: rng.next(),
  });
}

/** The three LOD meshes of one plan (LOD0 full geometry, LOD1 merged foliage, LOD2 billboards). */
export function buildTreeLods(plan: TreePlan, seed: number, audit?: TreeContactAudit, foliage: FoliageOptions = {}): [MeshData, MeshData, MeshData] {
  const dense = foliage.dense === true;
  const sh = shading(plan);
  const lods: MeshData[] = [];
  heightSway = sh.swayAt;
  needleRoom = plan.species === 'juniper' ? BUSH_NEEDLE_ROOM : NEEDLE_ROOM;
  for (const lod of [0, 1, 2] as const) {
    const rng = new Rng(deriveSeed(seed, 0x10d, lod)), b = new MeshBuilder();
    space = lod === 0 ? new FoliageSpace() : null;
    emitted = lod === 0 && foliage.pieces ? [] : null;
    if (lod === 2) emitBillboards(b, rng, plan, sh);
    else {
      const wood = emitLimbs(b, plan, sh, lod, dense);
      const nearAudit = lod === 0 ? audit : undefined; nearAudit?.wood.push(...wood);
      emitFronds(b, rng, plan, sh, lod, wood, nearAudit, dense);
      emitClusters(b, rng, plan, sh, lod, wood, nearAudit, dense);
    }
    if (space) foliage.report?.(space);
    if (emitted) foliage.pieces?.(emitted);
    emitted = null;
    space = null;
    lods.push(b.build());
  }
  heightSway = null;
  return lods as [MeshData, MeshData, MeshData];
}

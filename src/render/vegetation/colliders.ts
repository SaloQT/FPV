import type { ObstacleCollider, Vec3 } from '../../contracts';
import type { RTMaterial, RTPrimitive } from '../contracts';
import { MAX_PRIMS } from '../rt/bvh';
import type { InstanceSet, VegPlacement } from './placement';
import { RT_FOLIAGE, plantCanopyShadows, plantWoodShadows } from './plantShadows';
import { rockAssets } from './rockGen';
import { BREAST_HEIGHT, type Limb, type TreePlan } from './treePlan';
import { VARIANT_DEFS, layoutCrown, variantPlan } from './variants';

/** The brief keeps the collider count below 2500; the nearest ones win when a track is very wooded. */
export const MAX_COLLIDERS = 2400;
/** Trees closer than this to the racing line get a trunk box. */
export const TREE_COLLIDER_RANGE = 60;
export const ROCK_COLLIDER_RANGE = 40;
/** Rocks smaller than this radius are not worth a collider. */
export const MIN_BOULDER_RADIUS = 0.6;
/**
 * Trunk box half-width limits (m): thin stems still get a box a drone can hit, and the cap is above the girth of the oldest oaks, so a box
 * always covers its drawn trunk.
 */
export const TRUNK_HALF_MIN = 0.15;
export const TRUNK_HALF_MAX = 1.2;
/** Trunk boxes stop a little below the tip, where the stem is too thin to matter. */
const TRUNK_HEIGHT_FRACTION = 0.9;
/** A boulder's box covers this fraction of its radius on each side of the centre. */
const BOULDER_HALF = 0.7;

/** Most ray-tracing primitives the natural forest gets: trees, bushes and rocks nearest the focus, whole plants only. */
export const RT_PRIM_CAP = 1500;
/**
 * The extreme tier's forest proxies: every plant within about 100 m of a race line (13-14k primitives on the 1024-cell worlds), ranked by
 * distance to the line. A tree without proxies is open sky to the GI rays from its own leaves, so its crown is lit as brightly inside as out.
 */
export const RT_PRIM_CAP_EXTREME = 16000;
/**
 * Of the extreme tier's forest budget, the share kept for the plants nearest the camera that the race-line set leaves out (lone trees,
 * park and free-flight views off the line): about a 50 m round of trees, in the dynamic tree so moving it never rebuilds the static one.
 */
export const RT_CAMERA_PRIMS = 3000;
/** The camera's set is re-ranked once the camera has moved this far (m) from where it was last ranked. */
export const RT_CAMERA_RERANK = 50;
/** Plants farther than this (m) from the camera are not ranked for its set (a re-rank sorts only the near ones). */
export const RT_CAMERA_WITHIN = 150;

/** How an extreme-tier forest budget splits between the race line and the camera's round. */
export const cameraShare = (cap: number): number => Math.min(RT_CAMERA_PRIMS, Math.floor(cap / 4));

/** Primitives left free under the BVH's MAX_PRIMS when the forest takes what the other groups (park, track) leave. */
export const RT_PRIM_MARGIN = 1024;

/** The forest's primitive budget for the tier, given how many the other static groups already use, so the whole scene stays under MAX_PRIMS. */
export function forestRtCap(extreme: boolean, usedByOthers: number): number {
  return Math.max(0, Math.min(extreme ? RT_PRIM_CAP_EXTREME : RT_PRIM_CAP, MAX_PRIMS - RT_PRIM_MARGIN - usedByOthers));
}
export { RT_FOLIAGE };
const RT_ROCK: RTMaterial = { albedo: [0.27, 0.26, 0.24], roughness: 0.95, metalness: 0 };

interface Candidate {
  dist: number;
  key: number;
  box: ObstacleCollider;
}

/**
 * One trunk box in a tree's own frame at scale 1: centre x and z, the heights it spans, the stem radius it wraps and how far the stem's
 * centreline strays sideways inside it.
 */
export interface StemBox { x: number; z: number; y0: number; y1: number; radius: number; spread: number }

/** Most boxes a tree's trunk is cut into where it leans or bends, shared between the stems of a clump. */
export const MAX_TRUNK_BOXES = 6;
const MAX_STEM_BOXES = 4;
/** A stem's box is cut in two while its centreline strays more than this share of the stem radius (or STRAY_MIN metres) inside one box. */
const SPREAD_OF_RADIUS = 0.6;
const STRAY_MIN = 0.25;

const stemCache = new Map<number, StemBox[]>();

/** Centreline point and radius of a stem at height y (its points rise monotonically). */
function stemSample(stem: Limb, y: number): [number, number, number] {
  const p = stem.pts;
  let i = 0;
  while (i < p.length - 2 && p[i + 1][1] < y) i++;
  const t = Math.min(Math.max((y - p[i][1]) / Math.max(p[i + 1][1] - p[i][1], 1e-6), 0), 1);
  return [p[i][0] + (p[i + 1][0] - p[i][0]) * t, p[i][2] + (p[i + 1][2] - p[i][2]) * t, stem.radii[i] + (stem.radii[i + 1] - stem.radii[i]) * t];
}

/**
 * The trunk boxes of a tree variant at scale 1: every stem (a birch clump has several) from the ground up to the crown's top, never into the
 * whisker-thin tip, cut into up to MAX_STEM_BOXES stacked boxes (MAX_TRUNK_BOXES for all the stems of a clump) so a leaning or crooked stem stays inside them. The radius of the lowest box
 * is the breast-height radius (the root flare below it is left out), higher boxes take the stem's radius at their middle.
 */
export function stemBoxes(variant: number): StemBox[] {
  let fit = stemCache.get(variant);
  if (fit) return fit;
  const plan = variantPlan(variant) as TreePlan, out: StemBox[] = [];
  const crownTop = Math.min(plan.height * TRUNK_HEIGHT_FRACTION, layoutCrown(variant)?.crownTop ?? plan.crownC[1] + plan.crownR[1]);
  const stems = plan.limbs.filter((l) => l.order === 0), most = Math.min(MAX_STEM_BOXES, Math.max(1, Math.floor(MAX_TRUNK_BOXES / stems.length)));
  for (const stem of stems) {
    // Above a broadleaf's fork the column carries on straight up from the top of the bole, through the solid core of the crown.
    const top = crownTop;
    const piece = (y0: number, y1: number, first: boolean): StemBox => {
      let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
      for (let k = 0; k <= 16; k++) {
        const [x, z] = stemSample(stem, y0 + ((y1 - y0) * k) / 16);
        x0 = Math.min(x0, x); x1 = Math.max(x1, x); z0 = Math.min(z0, z); z1 = Math.max(z1, z);
      }
      const radius = first ? stemSample(stem, Math.min(BREAST_HEIGHT, top))[2] : stemSample(stem, (y0 + y1) / 2)[2];
      return { x: (x0 + x1) / 2, z: (z0 + z1) / 2, y0, y1, radius, spread: Math.max(x1 - x0, z1 - z0) / 2 };
    };
    let boxes: StemBox[] = [];
    for (let n = 1; n <= most; n++) {
      boxes = Array.from({ length: n }, (_, k) => piece((top * k) / n, (top * (k + 1)) / n, k === 0));
      if (boxes.every((b) => b.spread <= Math.max(SPREAD_OF_RADIUS * b.radius, STRAY_MIN))) break;
    }
    out.push(...boxes);
  }
  stemCache.set(variant, out);
  return out;
}

/** Boxes around the solid part of a placed tree: one per stem box, each as wide as its stem (within the trunk limits) plus the stem's stray. */
function trunkBoxes(place: InstanceSet, i: number): ObstacleCollider[] {
  const s = place.scale[i], yaw = place.yaw[i], c = Math.cos(yaw), sn = Math.sin(yaw);
  return stemBoxes(place.variant[i]).map((b): ObstacleCollider => {
    const half = Math.min(Math.max(b.radius * s, TRUNK_HALF_MIN), TRUNK_HALF_MAX) + b.spread * s;
    const x = b.x * s, z = b.z * s, h = 0.5 * (b.y1 - b.y0) * s;
    return { kind: 'box', center: [place.pos[i * 3] + c * x + sn * z, place.pos[i * 3 + 1] + b.y0 * s + h, place.pos[i * 3 + 2] - sn * x + c * z], half: [half, h, half], yaw };
  });
}

function boulderBox(place: InstanceSet, i: number): ObstacleCollider {
  const s = place.scale[i], rock = rockAssets()[VARIANT_DEFS[place.variant[i]].rock];
  const h = 0.5 * rock.height * s;
  return { kind: 'box', center: [place.pos[i * 3], place.pos[i * 3 + 1] + h, place.pos[i * 3 + 2]], half: [BOULDER_HALF * s, h, BOULDER_HALF * s], yaw: place.yaw[i] };
}

/**
 * Trunk boxes (one or more per tree, see stemBoxes) for the trees along the racing line and boxes for the boulders next to it, nearest first, at most MAX_COLLIDERS.
 * The order is a pure function of the placement, so equal seeds give identical lists.
 */
export function buildColliders(place: VegPlacement): ObstacleCollider[] {
  const out: Candidate[] = [];
  const { plants, rocks } = place;
  for (let i = 0; i < plants.count; i++) {
    if (VARIANT_DEFS[plants.variant[i]].group !== 'tree' || !(plants.pathDist[i] <= TREE_COLLIDER_RANGE)) continue;
    for (const box of trunkBoxes(plants, i)) out.push({ dist: plants.pathDist[i], key: i, box });
  }
  for (let i = 0; i < rocks.count; i++) {
    if (rocks.scale[i] < MIN_BOULDER_RADIUS || !(rocks.pathDist[i] <= ROCK_COLLIDER_RANGE)) continue;
    out.push({ dist: rocks.pathDist[i], key: plants.count + i, box: boulderBox(rocks, i) });
  }
  out.sort((a, b) => a.dist - b.dist || a.key - b.key);
  if (out.length > MAX_COLLIDERS) out.length = MAX_COLLIDERS;
  return out.map((c) => c.box);
}

/** Rocks smaller than this radius (metres) cast no ray-traced shadow. */
export const MIN_SHADOW_ROCK_RADIUS = 0.3;

const rockFits: { center: Vec3; half: Vec3 }[] = [];

/** The ellipsoid that spans a rock's drawn mesh at scale 1 (the box round the finest level of detail, rounded to an ellipsoid). */
function rockEllipsoid(shape: number): { center: Vec3; half: Vec3 } {
  if (!rockFits[shape]) {
    const mesh = rockAssets()[shape].lods[0], lo: Vec3 = [Infinity, Infinity, Infinity], hi: Vec3 = [-Infinity, -Infinity, -Infinity];
    for (let v = 0; v < mesh.vertexCount; v++) for (let k = 0; k < 3; k++) { lo[k] = Math.min(lo[k], mesh.pos[v * 3 + k]); hi[k] = Math.max(hi[k], mesh.pos[v * 3 + k]); }
    rockFits[shape] = { center: [(lo[0] + hi[0]) / 2, (lo[1] + hi[1]) / 2, (lo[2] + hi[2]) / 2], half: [(hi[0] - lo[0]) / 2, (hi[1] - lo[1]) / 2, (hi[2] - lo[2]) / 2] };
  }
  return rockFits[shape];
}

/** Rank offset of a plant with no line distance when ranking along the line: past any distance a line can have. */
const OFF_LINE = 1e6;

/** A plant's or a rock's key in RtProxyOptions' skip and taken sets. */
export const proxyKey = (i: number, rock: boolean): number => (rock ? -1 - i : i);

export interface RtProxyOptions {
  /** Rank by distance to the racing line, where the camera flies (falling back to `focus` with no line), instead of to `focus`. */
  alongLine?: boolean;
  /** Only what stands within this distance (m) of `focus` (or of the line). */
  within?: number;
  /** Plants and rocks (proxyKey) to leave out: another set has them already. */
  skip?: ReadonlySet<number>;
  /** Filled with the proxyKey of every plant and rock that got proxies. */
  taken?: Set<number>;
}

/**
 * Ray-tracing proxies for what stands nearest `focus` (see RtProxyOptions), `cap` primitives at most. A tree gets a capsule along its leaning trunk and the canopy spheres fitted to its
 * leaves; a bush gets its canopy spheres; a rock gets an ellipsoid over its mesh. Each is laid out with the instance's own yaw and scale.
 */
export function buildRtProxies(place: VegPlacement, focus: Vec3, cap = RT_PRIM_CAP, o: RtProxyOptions = {}): RTPrimitive[] {
  const { plants, rocks } = place;
  const near: { d: number; i: number; rock: boolean }[] = [];
  // Along the line, plants with no line distance (placement measures it only near the line) come after every plant that has one, nearest
  // `focus` first.
  const toFocus = (set: InstanceSet, i: number): number => Math.hypot(set.pos[i * 3] - focus[0], set.pos[i * 3 + 2] - focus[2]);
  const dist = (set: InstanceSet, i: number): number =>
    !o.alongLine ? toFocus(set, i) : Number.isFinite(set.pathDist[i]) ? set.pathDist[i] : OFF_LINE + toFocus(set, i);
  const within = o.within ?? Infinity;
  const consider = (i: number, rock: boolean, d: number): void => { if (d <= within && !o.skip?.has(proxyKey(i, rock))) near.push({ d, i, rock }); };
  for (let i = 0; i < plants.count; i++) consider(i, false, dist(plants, i));
  for (let i = 0; i < rocks.count; i++) if (rocks.scale[i] >= MIN_SHADOW_ROCK_RADIUS) consider(i, true, dist(rocks, i));
  near.sort((a, b) => a.d - b.d || +a.rock - +b.rock || a.i - b.i);
  const prims: RTPrimitive[] = [];
  for (const { i, rock } of near) {
    if (prims.length >= cap) break;
    const set = rock ? rocks : plants, variant = set.variant[i], pos: Vec3 = [set.pos[i * 3], set.pos[i * 3 + 1], set.pos[i * 3 + 2]];
    const at = { pos, yaw: set.yaw[i], scale: set.scale[i] };
    let made: RTPrimitive[];
    if (rock) {
      const fit = rockEllipsoid(VARIANT_DEFS[variant].rock), c = Math.cos(at.yaw), s = Math.sin(at.yaw);
      const x = fit.center[0] * at.scale, z = fit.center[2] * at.scale;
      made = [{ type: 'ellipsoid', center: [pos[0] + c * x + s * z, pos[1] + fit.center[1] * at.scale, pos[2] - s * x + c * z], half: fit.half.map(h => h * at.scale) as Vec3,
        rot: [0, Math.sin(at.yaw / 2), 0, Math.cos(at.yaw / 2)], material: RT_ROCK }];
    } else if (!variantPlan(variant)) continue;
    else made = [...plantWoodShadows(variant, at, false), ...plantCanopyShadows(variant, at)];
    // A plant is all or nothing: half a tree would be a trunk with no crown.
    if (prims.length + made.length > cap) break;
    prims.push(...made);
    o.taken?.add(proxyKey(i, rock));
  }
  return prims;
}

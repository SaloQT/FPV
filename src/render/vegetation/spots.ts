import type { InstanceSet, VegPlacement } from './placement';
import { VARIANT_DEFS } from './variants';

/** A camera standing point on the ground and the compass heading (degrees clockwise from -Z) to look along. */
export interface ViewSpot {
  x: number;
  z: number;
  yaw: number;
}

const BUCKET = 30;
const LATTICE = 12;
const MIN_TRUNK_GAP = 4;
const MIN_NEIGHBOURS = 40;
const DIRECTIONS = 24;
const CORRIDOR_HALF = 2.5;
const CORRIDOR_START = 3;
const CORRIDOR_END = 30;
const SIDE_BAND = 12;
const DEG = 180 / Math.PI;
const MIN_FIELD_ROCKS = 8;
const BOULDER_WEIGHT = 8;

/** Bucketed positions of the given instances so radius queries touch a handful of cells. */
class Buckets {
  private readonly cells = new Map<number, number[]>();
  private readonly out: number[] = [];

  constructor(private readonly set: InstanceSet, pick: (i: number) => boolean) {
    for (let i = 0; i < set.count; i++) {
      if (!pick(i)) continue;
      const key = this.key(Math.floor(set.pos[i * 3] / BUCKET), Math.floor(set.pos[i * 3 + 2] / BUCKET));
      const list = this.cells.get(key);
      if (list) list.push(i); else this.cells.set(key, [i]);
    }
  }

  private key(cx: number, cz: number): number {
    return (cx + 512) * 1024 + (cz + 512);
  }

  /** Indices of the picked instances in the 3 x 3 buckets around (x, z); reused between calls. */
  near(x: number, z: number): number[] {
    const out = this.out;
    out.length = 0;
    const cx = Math.floor(x / BUCKET), cz = Math.floor(z / BUCKET);
    for (let j = cz - 1; j <= cz + 1; j++) {
      for (let i = cx - 1; i <= cx + 1; i++) {
        const list = this.cells.get(this.key(i, j));
        if (list) for (const k of list) out.push(k);
      }
    }
    return out;
  }
}

/**
 * A clearing inside a wood: at least MIN_TRUNK_GAP from any tree, with a trunk-free lane of CORRIDOR_HALF either side straight ahead
 * and as many trees as possible flanking it. Deterministic (lattice scan, first best wins); null when the placement has no such spot.
 */
export function forestSpot(place: VegPlacement): ViewSpot | null {
  const set = place.plants;
  const trees = new Buckets(set, (i) => VARIANT_DEFS[set.variant[i]].group === 'tree');
  let best: (ViewSpot & { score: number }) | null = null;
  const sin = new Float64Array(DIRECTIONS), cos = new Float64Array(DIRECTIONS);
  for (let d = 0; d < DIRECTIONS; d++) { sin[d] = Math.sin((d / DIRECTIONS) * 2 * Math.PI); cos[d] = -Math.cos((d / DIRECTIONS) * 2 * Math.PI); }
  const blocked = new Uint8Array(DIRECTIONS), flank = new Uint16Array(DIRECTIONS);

  let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
  for (let i = 0; i < set.count; i++) {
    minX = Math.min(minX, set.pos[i * 3]); maxX = Math.max(maxX, set.pos[i * 3]);
    minZ = Math.min(minZ, set.pos[i * 3 + 2]); maxZ = Math.max(maxZ, set.pos[i * 3 + 2]);
  }
  for (let z = minZ; z <= maxZ; z += LATTICE) {
    for (let x = minX; x <= maxX; x += LATTICE) {
      const list = trees.near(x, z);
      if (list.length < MIN_NEIGHBOURS) continue;
      blocked.fill(0); flank.fill(0);
      let tooClose = false;
      for (const i of list) {
        const dx = set.pos[i * 3] - x, dz = set.pos[i * 3 + 2] - z;
        const r2 = dx * dx + dz * dz;
        if (r2 < MIN_TRUNK_GAP * MIN_TRUNK_GAP) { tooClose = true; break; }
        if (r2 > CORRIDOR_END * CORRIDOR_END) continue;
        for (let d = 0; d < DIRECTIONS; d++) {
          const along = dx * sin[d] + dz * cos[d], across = Math.abs(-dx * cos[d] + dz * sin[d]);
          if (along < CORRIDOR_START || along > CORRIDOR_END) continue;
          if (across < CORRIDOR_HALF) blocked[d] = 1;
          else if (across < SIDE_BAND) flank[d]++;
        }
      }
      if (tooClose) continue;
      for (let d = 0; d < DIRECTIONS; d++) {
        if (blocked[d] === 0 && (best === null || flank[d] > best.score)) best = { x, z, yaw: (d / DIRECTIONS) * 360, score: flank[d] };
      }
    }
  }
  return best ? { x: best.x, z: best.z, yaw: best.yaw } : null;
}

/** The camera stands in front of the biggest boulder that has a rock field around it, on the side away from the field's centre, looking at it. */
export function rockSpot(place: VegPlacement): ViewSpot | null {
  const set = place.rocks;
  const buckets = new Buckets(set, () => true);
  let bestScore = 0, bestI = -1, cx = 0, cz = 0;
  for (let i = 0; i < set.count; i++) {
    if (set.scale[i] < 0.8) continue;
    const x = set.pos[i * 3], z = set.pos[i * 3 + 2];
    let n = 0, sx = 0, sz = 0;
    for (const k of buckets.near(x, z)) {
      if (Math.hypot(set.pos[k * 3] - x, set.pos[k * 3 + 2] - z) > 25) continue;
      n++; sx += set.pos[k * 3]; sz += set.pos[k * 3 + 2];
    }
    const score = n >= MIN_FIELD_ROCKS ? n + BOULDER_WEIGHT * set.scale[i] : 0;
    if (score > bestScore) { bestScore = score; bestI = i; cx = sx / n; cz = sz / n; }
  }
  if (bestI < 0) return null;
  const rx = set.pos[bestI * 3], rz = set.pos[bestI * 3 + 2];
  let ax = rx - cx, az = rz - cz;
  const len = Math.hypot(ax, az);
  if (len < 1e-3) { ax = 0; az = 1; } else { ax /= len; az /= len; }
  const stand = 2 + 2.2 * set.scale[bestI];
  const x = rx + ax * stand, z = rz + az * stand;
  return { x, z, yaw: Math.atan2(rx - x, -(rz - z)) * DEG };
}

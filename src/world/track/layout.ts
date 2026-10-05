/** Layout: the abstract gate plan a style generator produces before it is turned into a smooth, validated track. */
import type { ObstacleKind, TerrainSampler, TrackFeature, TrackRecipe, Vec3 } from '../../contracts';
import { gateSiteSlope } from './clearance';
import type { Rng } from './rng';
import { MAX_DIVE_GATE_SLOPE, MAX_GATE_SLOPE, WATER_MARGIN, type GateSpec, type StyleSpec } from './styles';

export interface LayoutGate {
  x: number;
  z: number;
  spec: GateSpec;
  /** Wanted height of the opening's lowest edge above the highest ground under it. */
  clear: number;
  roll: number;
  /** Dive gates fix their travel axis; the path is forced through them along it. */
  dive?: { yaw: number; pitch: number };
  /**
   * A fixed travel axis (feature gates): orient, relax and lift never turn or move the gate on its own. Without `group` the path
   * is pulled through it along the axis by pull-in and pull-out arcs (above it for a dive, below it for a climb).
   */
  fixed?: { yaw: number; pitch: number };
  /** The manoeuvre the gate belongs to (copied to TrackGate.feature). */
  feature?: TrackFeature;
  /**
   * Rigid feature group: the gates and control points of one group keep their positions and their height differences `dy`
   * exactly; the group's base height is the lowest that gives every gate its `clear`, and the lift pass raises the group whole.
   */
  group?: number;
  /** Height of the gate centre above the group's base. */
  dy?: number;
  /** Extra path control points just before / after the gate (same group, heights relative to the group's base). */
  pre?: FeatureCtrl[];
  post?: FeatureCtrl[];
  /** Tunnel gates: sleeve length (TrackGate.depth). */
  depth?: number;
}

/** A path control point of a feature group: absolute ground position, height above the group's base. */
export interface FeatureCtrl {
  x: number;
  z: number;
  dy: number;
}

/** A path bend between gates (the corner of a skeleton): a waypoint `agl` metres above the ground after gate `gap`. */
export interface LayoutBend {
  gap: number;
  /** Order among the bends of the same gap. */
  order: number;
  x: number;
  z: number;
  agl: number;
}

/** An obstacle a layout asks for (the pylon of a hairpin), placed first and through the same rules as all others. */
export interface LayoutProp {
  kind: ObstacleKind;
  x: number;
  z: number;
  yaw: number;
  size: Vec3;
  /** Placed instead when this prop does not fit (a hairpin's flagpole in place of its pillar or wall). */
  alt?: LayoutProp;
}

export interface Layout {
  closed: boolean;
  gates: LayoutGate[];
  bends?: LayoutBend[];
  props?: LayoutProp[];
  /** False when the layout's plain gates sit where its drawing wants them: the relax pass leaves them alone. */
  relax?: boolean;
}

export interface LayoutCtx {
  sampler: TerrainSampler;
  spec: StyleSpec;
  difficulty: number;
  gateCount: number;
  /** Map centre and full side length. */
  cx: number;
  cz: number;
  extent: number;
  /** Ground height below which gates and obstacles are not placed. */
  waterFloor: number;
  rng: Rng;
  /** The recipe of a custom track. */
  recipe?: TrackRecipe;
}

export function makeCtx(sampler: TerrainSampler, spec: StyleSpec, difficulty: number, gateCount: number, rng: Rng, recipe?: TrackRecipe): LayoutCtx {
  const d = sampler.data;
  const extent = d.resolution * d.cellSize;
  return {
    sampler,
    spec,
    difficulty,
    gateCount,
    cx: d.origin[0] + extent / 2,
    cz: d.origin[1] + extent / 2,
    extent,
    waterFloor: d.waterLevel + WATER_MARGIN,
    rng,
    ...(recipe ? { recipe } : {}),
  };
}

/** True when a gate may stand here: inside the corridor, dry, and the ground around it is not too steep. */
export function siteOk(c: LayoutCtx, x: number, z: number, dive: boolean): boolean {
  if (Math.hypot(x - c.cx, z - c.cz) > c.spec.corridor * c.extent) return false;
  const s = c.sampler;
  if (s.heightAt(x, z) < c.waterFloor) return false;
  for (let k = 0; k < 4; k++) {
    const a = (k * Math.PI) / 2;
    if (s.heightAt(x + 3 * Math.cos(a), z + 3 * Math.sin(a)) < c.waterFloor) return false;
  }
  return gateSiteSlope(s, x, z) <= (dive ? MAX_DIVE_GATE_SLOPE : MAX_GATE_SLOPE);
}

/** Mean of the ground height on a ring around (x, z) minus the height at the centre: > 0 in bowls and valleys, < 0 on ridges and hills. */
export function localConcavity(s: TerrainSampler, x: number, z: number, radius: number): number {
  let sum = 0;
  for (let k = 0; k < 8; k++) {
    const a = (k * Math.PI) / 4;
    sum += s.heightAt(x + radius * Math.cos(a), z + radius * Math.sin(a));
  }
  return sum / 8 - s.heightAt(x, z);
}

/** Terrain roughness over a disc: standard deviation of heights plus worst slope, used to pick where to build. */
export function areaRoughness(s: TerrainSampler, x: number, z: number, radius: number): number {
  let sum = 0;
  let sum2 = 0;
  let maxSlope = 0;
  let n = 0;
  for (let ring = 0; ring < 3; ring++) {
    const r = (radius * ring) / 2;
    const k = ring === 0 ? 1 : 12;
    for (let i = 0; i < k; i++) {
      const a = (i / k) * 2 * Math.PI;
      const px = x + r * Math.cos(a);
      const pz = z + r * Math.sin(a);
      const h = s.heightAt(px, pz);
      sum += h;
      sum2 += h * h;
      n++;
      const sl = s.slopeAt(px, pz);
      if (sl > maxSlope) maxSlope = sl;
    }
  }
  const mean = sum / n;
  return Math.sqrt(Math.max(sum2 / n - mean * mean, 0)) + 25 * maxSlope;
}

export function nearest2D(list: { x: number; z: number }[], x: number, z: number, skip = -1): number {
  let best = Infinity;
  for (let i = 0; i < list.length; i++) {
    if (i === skip) continue;
    const d = Math.hypot(list[i].x - x, list[i].z - z);
    if (d < best) best = d;
  }
  return best;
}

/** Distance from (x, z) to the nearest [x, z] pair in `list`. */
export function nearestPair(list: [number, number][], x: number, z: number): number {
  let best = Infinity;
  for (const p of list) {
    const d = Math.hypot(p[0] - x, p[1] - z);
    if (d < best) best = d;
  }
  return best;
}

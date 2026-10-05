/**
 * Scenery scattered near (never on) the line: trees, rocks and walls with >= 4 m of clearance on the original styles; on the
 * feature styles also structures (containers, towers, pillars, scaffolds beside the line; beams and bridges across low straight
 * stretches, flown under). A custom track scatters its recipe's objects at its recipe's density.
 */
import type { ObstacleKind, TrackStyle, Vec3 } from '../../contracts';
import { BEAM_DEPTH, BRIDGE_DECK, CONTAINER_UNIT, FLY_UNDER_CLEARANCE, OBSTACLE_SIZES } from './kindGeometry';
import type { Placer } from './placer';
import { RECIPE_OBJECT_KINDS } from './recipe';
import type { Rng } from './rng';
import { pathCurvature, pathTangent } from './spline';
import { featureZones } from './validateFeatures';

/** Large obstacles wanted per original style, and the share of trees and of rocks; the rest are walls. */
const MIX = {
  race: { count: 28, tree: 0.55, rock: 0.3 },
  sprint: { count: 16, tree: 0.55, rock: 0.3 },
  freestyle: { count: 22, tree: 0.5, rock: 0.4 },
  mountain: { count: 36, tree: 0.3, rock: 0.65 },
};

/** Scenery wanted per feature style and the relative weight of each kind. */
const FEATURE_MIX: Record<'technical' | 'acro' | 'industrial', { count: number; weights: Partial<Record<ObstacleKind, number>> }> = {
  technical: { count: 22, weights: { tree: 0.35, rock: 0.2, wall: 0.2, container: 0.15, pillar: 0.1 } },
  acro: { count: 20, weights: { tree: 0.4, rock: 0.35, tower: 0.1, pillar: 0.15 } },
  industrial: { count: 32, weights: { container: 0.3, tower: 0.08, pillar: 0.14, scaffold: 0.14, beam: 0.12, bridge: 0.07, wall: 0.1, rock: 0.05 } },
};

/** Most scenery a custom track asks for (at recipe obstacles = 1). */
const CUSTOM_MAX = 40;
/** What a recipe scatters when every object weight is zero (TrackRecipe.objects: all zero = trees and rocks). */
const NO_OBJECTS: Partial<Record<ObstacleKind, number>> = { tree: 0.6, rock: 0.4 };

const CONE: Vec3 = [0.15, 0.45, 0.15];
const POLE: Vec3 = [0.025, 2, 0.025];
const FLAGPOLE: Vec3 = [0.02, 3, 0.02];
/** A beam or bridge spans a stretch whose curvature stays under this for CROSSING_WINDOW samples either side. */
const CROSSING_CURVATURE = 1 / 40;
const CROSSING_WINDOW = 14;
/** Highest the ground under a crossing's corners may stand above or below its centre. */
const CROSSING_RELIEF = 1.2;
/** Spots tried for each beam or bridge the scatter picks. */
const CROSSING_TRIES = 6;

function tree(p: Placer, rng: Rng, x: number, z: number): boolean {
  const r = rng.range(0.22, 0.5);
  return p.add('tree', x, z, 0, [r, rng.range(5, 13), r]);
}

function rock(p: Placer, rng: Rng, x: number, z: number): boolean {
  const w = rng.range(1.4, 4.5);
  const size: Vec3 = [w, rng.range(0.8, 2.6), w * rng.range(0.6, 1.1)];
  return p.add('rock', x, z, rng.range(0, Math.PI), size);
}

/** A wall runs roughly parallel to the line, like a field boundary. */
function wall(p: Placer, rng: Rng, x: number, z: number, heading: number): boolean {
  const size: Vec3 = [rng.range(3, 8), rng.range(0.8, 1.6), rng.range(0.3, 0.5)];
  return p.add('wall', x, z, heading + rng.range(-0.25, 0.25), size);
}

/** A grove: the first tree plus a few neighbours a few metres away. Returns whether the first tree stood. */
function grove(p: Placer, rng: Rng, x: number, z: number): boolean {
  if (!tree(p, rng, x, z)) return false;
  for (let k = rng.int(1, 4); k > 0; k--) {
    const a = rng.range(0, 2 * Math.PI);
    const d = rng.range(2.5, 7);
    tree(p, rng, x + d * Math.cos(a), z + d * Math.sin(a));
  }
  return true;
}

export function scatterScenery(p: Placer, rng: Rng): void {
  const style = p.track.style;
  if (style === 'race' || style === 'sprint' || style === 'freestyle' || style === 'mountain') {
    scatterOriginal(p, rng, MIX[style]);
    return;
  }
  const mix = featureMix(style, p);
  scatterFeature(p, rng, mix.count, mix.weights);
}

function featureMix(style: Exclude<TrackStyle, 'race' | 'sprint' | 'freestyle' | 'mountain'>, p: Placer): { count: number; weights: Partial<Record<ObstacleKind, number>> } {
  if (style !== 'custom') return FEATURE_MIX[style];
  const r = p.track.recipe;
  const weights = r && Object.values(r.objects).some((w) => (w ?? 0) > 0) ? r.objects : NO_OBJECTS;
  return { count: Math.round(CUSTOM_MAX * (r?.obstacles ?? 0.5)), weights };
}

function scatterOriginal(p: Placer, rng: Rng, mix: { count: number; tree: number; rock: number }): void {
  const { path, closed } = p.track;
  const m = path.length;
  const t: Vec3 = [0, 0, 0];
  for (let tries = 0; tries < mix.count * 10 && !p.full; tries++) {
    if (placedLarge(p) >= mix.count) return;
    const i = rng.int(0, m - 1);
    pathTangent(path, i, closed, t);
    const len = Math.hypot(t[0], t[2]);
    if (len < 0.2) continue;
    const off = (5 + rng.next() * rng.next() * 30) * rng.sign();
    const x = path[i][0] - (t[2] / len) * off;
    const z = path[i][2] + (t[0] / len) * off;
    const r = rng.next();
    if (r < mix.tree) grove(p, rng, x, z);
    else if (r < mix.tree + mix.rock) rock(p, rng, x, z);
    else wall(p, rng, x, z, Math.atan2(-t[0], -t[2]) + Math.PI / 2);
  }
}

function placedLarge(p: Placer): number {
  let n = 0;
  for (const o of p.out) if (o.kind === 'tree' || o.kind === 'rock' || o.kind === 'wall') n++;
  return n;
}

function pick(weights: Partial<Record<ObstacleKind, number>>, rng: Rng): ObstacleKind | null {
  let sum = 0;
  for (const k of RECIPE_OBJECT_KINDS) sum += weights[k] ?? 0;
  if (sum <= 0) return null;
  let x = rng.next() * sum;
  for (const k of RECIPE_OBJECT_KINDS) {
    x -= weights[k] ?? 0;
    if (x < 0 && (weights[k] ?? 0) > 0) return k;
  }
  return null;
}

const span = (r: readonly [number, number], rng: Rng): number => (r[0] === r[1] ? r[0] : rng.range(r[0], r[1]));

/** Scenery of a feature track: `count` objects of the weighted kinds, each beside the line (or across it, for beams and bridges). */
function scatterFeature(p: Placer, rng: Rng, count: number, weights: Partial<Record<ObstacleKind, number>>): void {
  const { path, closed } = p.track;
  const m = path.length;
  if (count <= 0 || m < 10) return;
  const spots = crossingSpots(p);
  const t: Vec3 = [0, 0, 0];
  let placed = 0;
  for (let tries = 0; tries < count * 12 && placed < count && !p.full; tries++) {
    const kind = pick(weights, rng);
    if (!kind) return;
    const i = rng.int(0, m - 1);
    pathTangent(path, i, closed, t);
    const len = Math.hypot(t[0], t[2]);
    if (len < 0.2) continue;
    const heading = Math.atan2(-t[0], -t[2]);
    const side = rng.sign();
    /** A point `off` metres to the side of sample i. */
    const at = (off: number): [number, number] => [path[i][0] - (t[2] / len) * off * side, path[i][2] + (t[0] / len) * off * side];
    let ok = false;
    switch (kind) {
      case 'tree':
        ok = grove(p, rng, ...at(5 + rng.next() * rng.next() * 30));
        break;
      case 'rock':
        ok = rock(p, rng, ...at(5 + rng.next() * rng.next() * 30));
        break;
      case 'wall':
        ok = wall(p, rng, ...at(5 + rng.next() * rng.next() * 30), heading + Math.PI / 2);
        break;
      case 'cone':
        ok = p.add('cone', ...at(rng.range(2.4, 5)), 0, CONE);
        break;
      case 'pole':
        ok = p.add('pole', ...at(rng.range(2.6, 6)), 0, POLE);
        break;
      case 'flagpole':
        ok = p.add('flagpole', ...at(rng.range(2.6, 6)), 0, FLAGPOLE);
        break;
      case 'container': {
        const n = rng.chance(0.35) ? 2 : 1;
        const yaw = heading + (rng.chance(0.6) ? Math.PI / 2 : 0) + rng.range(-0.15, 0.15);
        ok = p.add('container', ...at(rng.range(7.5, 9) + rng.next() * rng.next() * 24), yaw, [OBSTACLE_SIZES.container.x[0], n * CONTAINER_UNIT, OBSTACLE_SIZES.container.z[0]]);
        break;
      }
      case 'tower': {
        const w = span(OBSTACLE_SIZES.tower.x, rng);
        ok = p.add('tower', ...at(rng.range(9, 12) + rng.next() * rng.next() * 30), rng.range(0, Math.PI / 2), [w, span(OBSTACLE_SIZES.tower.y, rng), w]);
        break;
      }
      case 'pillar': {
        const w = span(OBSTACLE_SIZES.pillar.x, rng);
        ok = p.add('pillar', ...at(rng.range(6, 8) + rng.next() * rng.next() * 26), rng.range(0, Math.PI / 2), [w, span(OBSTACLE_SIZES.pillar.y, rng), w]);
        break;
      }
      case 'scaffold': {
        const size: Vec3 = [span(OBSTACLE_SIZES.scaffold.x, rng), span(OBSTACLE_SIZES.scaffold.y, rng), OBSTACLE_SIZES.scaffold.z[0]];
        ok = p.add('scaffold', ...at(rng.range(6.5, 8) + rng.next() * rng.next() * 20), heading + Math.PI / 2 + rng.range(-0.1, 0.1), size);
        break;
      }
      case 'beam':
      case 'bridge':
        for (let k = 0; k < CROSSING_TRIES && !ok && spots.length > 0; k++) ok = crossing(p, rng, kind, spots[rng.int(0, spots.length - 1)]);
        break;
      default:
        break;
    }
    if (ok) placed++;
  }
}

/** Path samples a beam or bridge may cross at: straight for CROSSING_WINDOW samples either side and outside every feature zone. */
function crossingSpots(p: Placer): number[] {
  const { path, closed } = p.track;
  const m = path.length;
  const kappa = pathCurvature(path, closed, 2);
  const zone = featureZones(p.track).sampleZone;
  const out: number[] = [];
  for (let i = 0; i < m; i++) {
    let ok = true;
    for (let o = -CROSSING_WINDOW; o <= CROSSING_WINDOW && ok; o++) {
      const j = closed ? (i + o + m) % m : i + o;
      ok = j >= 0 && j < m && kappa[j] <= CROSSING_CURVATURE && zone[j] < 0;
    }
    if (ok) out.push(i);
  }
  return out;
}

/**
 * A beam or bridge across the line at sample i, square to it. Its deck goes high enough that every path sample under it keeps
 * FLY_UNDER_CLEARANCE (plus the placer's margin) below the underside; the posts or piers stand well out to either side. Fails
 * when the line flies too high there for the kind's tallest size, or the ground under it is not level.
 */
function crossing(p: Placer, rng: Rng, kind: 'beam' | 'bridge', i: number): boolean {
  const { path, closed } = p.track;
  const t = pathTangent(path, i, closed, [0, 0, 0]);
  if (Math.hypot(t[0], t[2]) < 0.2) return false;
  const heading = Math.atan2(-t[0], -t[2]);
  const sizes = OBSTACLE_SIZES[kind];
  const sx = kind === 'beam' ? rng.range(8, sizes.x[1]) : rng.range(14, sizes.x[1]);
  const sz = span(sizes.z, rng);
  const x = path[i][0];
  const z = path[i][2];
  const ground = p.sampler.heightAt(x, z);
  const c = Math.cos(heading);
  const s = Math.sin(heading);
  for (const [u, w] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
    const h = p.sampler.heightAt(x + c * u * sx * 0.5 + s * w * sz * 0.5, z - s * u * sx * 0.5 + c * w * sz * 0.5);
    if (Math.abs(h - ground) > CROSSING_RELIEF) return false;
  }
  // Highest path sample under (or near) the deck, relative to the ground at the centre.
  const hits: number[] = [];
  p.index.collectXZ(x, z, Math.hypot(sx, sz) / 2 + 3, hits);
  let high = -Infinity;
  for (const j of hits) {
    const dx = path[j][0] - x;
    const dz = path[j][2] - z;
    const lx = c * dx - s * dz;
    const lz = s * dx + c * dz;
    if (Math.abs(lx) <= sx / 2 + 1 && Math.abs(lz) <= sz / 2 + 2) high = Math.max(high, path[j][1] - ground);
  }
  if (!Number.isFinite(high)) return false;
  const under = high + FLY_UNDER_CLEARANCE + 0.6;
  const sy = Math.max(sizes.y[0], under + (kind === 'beam' ? BEAM_DEPTH : BRIDGE_DECK) + rng.range(0, 0.6));
  if (sy > sizes.y[1]) return false;
  return p.add(kind, x, z, heading, [sx, sy, sz]);
}

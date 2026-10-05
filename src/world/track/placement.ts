/**
 * Obstacles along a finished track: launch-pad cones, flagpoles beside gates, cones on the inside of corners, poles between
 * gates, and (in scatter.ts) trees, rocks and walls near the line. Everything goes through Placer, which enforces the rules.
 * Physical sizes: cone 0.3 m dia x 0.45 m, pole 0.05 x 2 m, flagpole 0.04 x 3 m (round obstacles store radius, height, radius).
 */
import type { TerrainSampler, TrackGate, TrackObstacle, Vec3 } from '../../contracts';
import type { LayoutProp } from './layout';
import { Placer, type PlacementInput } from './placer';
import type { Rng } from './rng';
import { scatterScenery } from './scatter';
import { pathCurvature, pathTangent } from './spline';
import { featureZones } from './validateFeatures';

const CONE: Vec3 = [0.15, 0.45, 0.15];
const POLE: Vec3 = [0.025, 2, 0.025];
const FLAGPOLE: Vec3 = [0.02, 3, 0.02];
/** Corners tighter than a 28 m radius get inside cones. */
const CORNER_CURVATURE = 1 / 28;
/** Distances from the pad centre at which the four launch-pad cones are tried, nearest first. */
const PAD_HALF_WIDTHS = [2.4, 3, 3.6];
/** Markers are only placed where the pilot flies low enough to see them. */
const LOW_AGL = 8;

const MARKERS_PER_STYLE = { race: 0.85, sprint: 0.7, freestyle: 0.35, mountain: 0, technical: 0.8, acro: 0.3, industrial: 0.5 };

/**
 * Share of gates and gaps that get markers: per style, or from a custom recipe's obstacle density (0 none, 0.5 half, 1 the
 * race style's 0.85). Start and finish flagpoles, the pad cones and a hairpin's pylon belong to the course and always stand.
 */
function markerChance(track: PlacementInput): number {
  if (track.style !== 'custom') return MARKERS_PER_STYLE[track.style];
  const o = Math.min(Math.max(track.recipe?.obstacles ?? 0.5, 0), 1);
  return o * (1.15 - 0.3 * o);
}

/** Gate kinds that never get flagpoles beside them: a flag is one, a dive or drop is in the air, the others are their own structure. */
function skipsFlagpoles(kind: TrackGate['kind']): boolean {
  return kind === 'flag' || kind === 'dive' || kind === 'drop' || kind === 'ladder' || kind === 'tunnel' || kind === 'window';
}

function padCones(p: Placer): void {
  const { pos, yaw } = p.track.start;
  const fx = -Math.sin(yaw);
  const fz = -Math.cos(yaw);
  const rx = Math.cos(yaw);
  const rz = -Math.sin(yaw);
  for (const [s, f] of [[-1, -1], [1, -1], [-1, 1.4], [1, 1.4]]) {
    // A closed course flies right over the pad, so a corner cone steps outwards until it clears the line.
    for (const w of PAD_HALF_WIDTHS) if (p.add('cone', pos[0] + rx * w * s + fx * f, pos[2] + rz * w * s + fz * f, 0, CONE, true)) break;
  }
}

/** One or two flagpoles beside the low gates, in the gate plane just outside the frame. */
function gateFlagpoles(p: Placer, rng: Rng): void {
  const chance = markerChance(p.track);
  for (const g of p.track.gates) {
    if (skipsFlagpoles(g.kind)) continue;
    const always = g.kind === 'start' || g.kind === 'finish';
    if (!always && !rng.chance(chance * 0.6)) continue;
    if (g.pos[1] - p.sampler.heightAt(g.pos[0], g.pos[2]) > 10) continue;
    const off = g.width / 2 + rng.range(1.4, 2.2);
    const sides = always || rng.chance(0.4) ? [-1, 1] : [rng.sign()];
    for (const s of sides) p.add('flagpole', g.pos[0] + Math.cos(g.yaw) * off * s, g.pos[2] - Math.sin(g.yaw) * off * s, 0, FLAGPOLE);
  }
}

/** Cones just inside the tightest low corners: three in a row, hugging the apex. */
function apexCones(p: Placer, kappa: Float32Array, zone: Int16Array | null): void {
  // A custom recipe with obstacle density 0 asks for no markers at all.
  if (p.track.style === 'custom' && markerChance(p.track) <= 0) return;
  const { path, closed } = p.track;
  const m = path.length;
  const t: Vec3 = [0, 0, 0];
  const a: Vec3 = [0, 0, 0];
  const b: Vec3 = [0, 0, 0];
  let last = -1000;
  for (let i = 0; i < m; i++) {
    if (kappa[i] < CORNER_CURVATURE || i - last < 30 || (zone && zone[i] >= 0)) continue;
    let peak = true;
    for (let o = -6; o <= 6 && peak; o++) {
      const j = closed ? (i + o + m) % m : i + o;
      if (j >= 0 && j < m && kappa[j] > kappa[i]) peak = false;
    }
    if (!peak || path[i][1] - p.sampler.heightAt(path[i][0], path[i][2]) > LOW_AGL) continue;
    last = i;
    pathTangent(path, closed ? (i - 5 + m) % m : Math.max(i - 5, 0), closed, a);
    pathTangent(path, closed ? (i + 5) % m : Math.min(i + 5, m - 1), closed, b);
    const turn = Math.sign(a[0] * b[2] - a[2] * b[0]);
    for (const k of [-4, 0, 4]) {
      const j = closed ? (i + k + m) % m : Math.min(Math.max(i + k, 0), m - 1);
      pathTangent(path, j, closed, t);
      const len = Math.hypot(t[0], t[2]) || 1;
      const off = k === 0 ? 2.8 : 3.3;
      p.add('cone', path[j][0] - (t[2] / len) * off * turn, path[j][2] + (t[0] / len) * off * turn, 0, CONE);
    }
  }
}

/** Poles alternating either side of the line half way between consecutive gates. */
function gatePoles(p: Placer, rng: Rng, zone: Int16Array | null): void {
  const { gates, path, closed } = p.track;
  const m = path.length;
  const chance = markerChance(p.track);
  const t: Vec3 = [0, 0, 0];
  let side = rng.sign();
  const at = gates.map((g) => p.index.nearest(g.pos[0], g.pos[1], g.pos[2]));
  for (let i = 0; i < (closed ? gates.length : gates.length - 1); i++) {
    if (!rng.chance(chance)) continue;
    const from = at[i];
    let to = at[(i + 1) % gates.length];
    if (to <= from) to += m;
    const mid = Math.floor((from + to) / 2) % m;
    if (zone && zone[mid] >= 0) continue;
    if (path[mid][1] - p.sampler.heightAt(path[mid][0], path[mid][2]) > LOW_AGL) continue;
    pathTangent(path, mid, closed, t);
    const len = Math.hypot(t[0], t[2]) || 1;
    const off = rng.range(3.2, 4.6) * side;
    if (p.add('pole', path[mid][0] - (t[2] / len) * off, path[mid][2] + (t[0] / len) * off, 0, POLE)) side = -side;
  }
}

/**
 * All obstacles for a track (gates, path and start already final). Deterministic in `rng`; at most 250. `props` are the
 * obstacles the layout asked for (a hairpin's pylon): they go first, through the same rules as everything else.
 */
export function placeObstacles(track: PlacementInput, sampler: TerrainSampler, rng: Rng, props: readonly LayoutProp[] = []): TrackObstacle[] {
  const p = new Placer(track, sampler);
  for (const q of props) if (!p.add(q.kind, q.x, q.z, q.yaw, q.size) && q.alt) p.add(q.alt.kind, q.alt.x, q.alt.z, q.alt.yaw, q.alt.size);
  // Markers stay out of the feature zones: cones and poles there would sit under a loop or beside a ladder.
  const zone = p.exact ? featureZones(track).sampleZone : null;
  padCones(p);
  gateFlagpoles(p, rng);
  apexCones(p, pathCurvature(track.path, track.closed, 2), zone);
  gatePoles(p, rng, zone);
  scatterScenery(p, rng);
  return p.out;
}

/**
 * Validation rules of the tracks built from manoeuvres (StyleSpec.features: technical, acro, industrial, custom). A manoeuvre's
 * gates carry its TrackFeature tag; a run of consecutive gates with the same tag, widened by the feature's lead-in and run-out
 * (FEATURE_RULES), is its zone. Inside a zone the path may turn as tightly as the feature allows and stretches of path may pass
 * close to each other in 3D (a loop over its own entry, ladder rungs above each other); outside every zone the original limits hold.
 */
import type { ObstacleCollider, TerrainSampler, TrackData, TrackFeature, TrackGate } from '../../contracts';
import { gateClearance } from './clearance';
import { distanceToBox, gateColliders, trackColliders } from './colliders';
import { FEATURE_RULES } from './features';
import { DROP_HEIGHT, DROP_PITCH, HURDLE_SILL, LADDER_MIN_GAP, TUNNEL_MIN_SILL, TUNNEL_MIN_SIZE, TUNNEL_PATH_MARGIN, WINDOW_MIN_SILL, isUprightKind, ladderGroups } from './kindGeometry';
import { PathIndex } from './pathIndex';
import { FEATURE_GATE_SPACING, FEATURE_SEPARATION, MAX_CURVATURE, MIN_FEATURE_TURN_RADIUS, MIN_GATE_SPACING, VERTICAL_SEPARATION } from './styles';
import { BLOCK_MARGIN, MIN_PATH_SEPARATION, SAME_PASS, SEPARATION_PROBE } from './validateParts';
import type { TrackStats } from './validate';

type Err = (message: string) => void;

/** Steepest pitch a dive (or climb) gate may have; drops are exactly vertical instead. */
export const MAX_DIVE_PITCH = 1.4;
/** Gates of one feature run are at most this many path samples apart. */
const MAX_RUN_GAP = 90;

export interface FeatureZone {
  feature: TrackFeature;
  /** Array positions of the zone's gates. */
  gates: number[];
  /** Path sample range (from may be < 0 and to >= path length on a closed track: they wrap). */
  from: number;
  to: number;
}

export interface ZoneInfo {
  zones: FeatureZone[];
  /** Per gate: its zone, or -1. */
  gateZone: Int16Array;
  /** Per path sample: the zone covering it (the first when several overlap), or -1. */
  sampleZone: Int16Array;
  /** Per path sample: the largest curvature allowed there. */
  limit: Float32Array;
}

type ZoneInput = Pick<TrackData, 'gates' | 'path' | 'closed'>;

const cache = new WeakMap<object, { gates: readonly TrackGate[]; key: string; closed: boolean; info: ZoneInfo }>();

/** What the zones depend on in the gates: every gate's position and feature tag. */
function gatesKey(gates: readonly TrackGate[]): string {
  let s = '';
  for (const g of gates) s += `${g.pos[0]},${g.pos[1]},${g.pos[2]},${g.feature ?? ''};`;
  return s;
}

/** The feature zones of a track (cached per path array while the gates and their tags stay the same). */
export function featureZones(track: ZoneInput, index?: PathIndex): ZoneInfo {
  const key = gatesKey(track.gates);
  const hit = cache.get(track.path);
  if (hit && hit.gates === track.gates && hit.closed === track.closed && hit.key === key) return hit.info;
  const info = computeZones(track, index ?? new PathIndex(track.path));
  cache.set(track.path, { gates: track.gates, key, closed: track.closed, info });
  return info;
}

function computeZones(track: ZoneInput, index: PathIndex): ZoneInfo {
  const { gates, path, closed } = track;
  const m = path.length;
  const at = gates.map((g) => index.nearest(g.pos[0], g.pos[1], g.pos[2]));
  const along = (a: number, b: number): number => (closed ? (b - a + m) % m : b - a);
  const zones: FeatureZone[] = [];
  const gateZone = new Int16Array(gates.length).fill(-1);
  let cur: FeatureZone | null = null;
  for (let i = 0; i < gates.length; i++) {
    const f = gates[i].feature;
    if (!f) {
      cur = null;
      continue;
    }
    if (cur && cur.feature === f && along(at[cur.gates[cur.gates.length - 1]], at[i]) <= MAX_RUN_GAP) cur.gates.push(i);
    else {
      cur = { feature: f, gates: [i], from: 0, to: 0 };
      zones.push(cur);
    }
    gateZone[i] = zones.length - 1;
  }
  const sampleZone = new Int16Array(m).fill(-1);
  const limit = new Float32Array(m).fill(MAX_CURVATURE);
  zones.forEach((z, zi) => {
    const rule = FEATURE_RULES[z.feature];
    const a = at[z.gates[0]];
    const b = a + along(a, at[z.gates[z.gates.length - 1]]);
    z.from = closed ? a - rule.before : Math.max(a - rule.before, 0);
    z.to = closed ? b + rule.after : Math.min(b + rule.after, m - 1);
    const k = 1 / Math.max(rule.minRadius, MIN_FEATURE_TURN_RADIUS);
    for (let s = z.from; s <= z.to && s - z.from < m; s++) {
      const j = ((s % m) + m) % m;
      if (sampleZone[j] < 0) sampleZone[j] = zi;
      if (k > limit[j]) limit[j] = k;
    }
  });
  return { zones, gateZone, sampleZone, limit };
}

/** Pitch and roll a gate of this kind may have on a feature track; null when it is fine. */
export function pitchProblem(g: TrackGate): string | null {
  if (g.kind === 'drop') return g.pitch === DROP_PITCH ? null : `drop gates must be pitched exactly ${DROP_PITCH.toFixed(4)}`;
  if (g.kind === 'dive') return Math.abs(g.pitch) <= MAX_DIVE_PITCH ? null : `dive pitch ${g.pitch.toFixed(2)} steeper than ${MAX_DIVE_PITCH}`;
  if (isUprightKind(g.kind)) return g.pitch === 0 && g.roll === 0 ? null : `${g.kind} gates stand upright (pitch and roll 0)`;
  return g.pitch === 0 ? null : 'only dive and drop gates may be pitched';
}

/** Per-gate rules of feature tracks: pitch, the new kinds' sizes and sills, gate spacing per zone and ladder rung gaps. */
export function checkFeatureGates(track: TrackData, sampler: TerrainSampler, info: ZoneInfo, stats: TrackStats, err: Err): void {
  const { gates } = track;
  const ladder = new Int16Array(gates.length).fill(-1);
  ladderGroups(gates).forEach((grp, gi) => {
    for (const r of grp.rungs) ladder[r] = gi;
    for (let k = 1; k < grp.rungs.length; k++) {
      const lo = gates[grp.rungs[k - 1]];
      const hi = gates[grp.rungs[k]];
      const need = (lo.height + hi.height) / 2 + LADDER_MIN_GAP;
      if (hi.pos[1] - lo.pos[1] < need - 1e-3) err(`ladder gates ${lo.index} and ${hi.index}: only ${(hi.pos[1] - lo.pos[1]).toFixed(2)} m apart vertically`);
    }
  });
  for (let i = 0; i < gates.length; i++) {
    const g = gates[i];
    const p = pitchProblem(g);
    if (p) err(`gate ${i}: ${p}`);
    if (g.kind === 'window' || g.kind === 'tunnel') {
      const clear = gateClearance(g, sampler);
      const sill = g.kind === 'window' ? WINDOW_MIN_SILL : TUNNEL_MIN_SILL;
      if (clear < sill - 1e-3) err(`gate ${i}: ${g.kind} sill only ${clear.toFixed(2)} m`);
    }
    if (g.kind === 'tunnel' && (g.width < TUNNEL_MIN_SIZE - 1e-6 || g.height < TUNNEL_MIN_SIZE - 1e-6)) err(`gate ${i}: tunnel smaller than ${TUNNEL_MIN_SIZE} m`);
    if (g.kind === 'hurdle') {
      const sill = gateClearance(g, sampler);
      if (sill < HURDLE_SILL[0] - 1e-3 || sill > HURDLE_SILL[1] + 1e-3) err(`gate ${i}: hurdle sill ${sill.toFixed(2)} m outside ${HURDLE_SILL[0]}..${HURDLE_SILL[1]}`);
    }
    if (g.kind === 'drop') {
      const h = g.pos[1] - sampler.heightAt(g.pos[0], g.pos[2]);
      if (h < DROP_HEIGHT[0] - 1e-3 || h > DROP_HEIGHT[1] + 1e-3) err(`gate ${i}: drop ring centre ${h.toFixed(2)} m above the ground, outside ${DROP_HEIGHT[0]}..${DROP_HEIGHT[1]}`);
    }
    for (let j = 0; j < i; j++) {
      const h = gates[j];
      const s = Math.hypot(g.pos[0] - h.pos[0], g.pos[1] - h.pos[1], g.pos[2] - h.pos[2]);
      stats.minGateSpacing = Math.min(stats.minGateSpacing, s);
      if (ladder[i] >= 0 && ladder[i] === ladder[j]) continue;
      const near = info.gateZone[i] >= 0 && info.gateZone[i] === info.gateZone[j] ? FEATURE_GATE_SPACING : MIN_GATE_SPACING;
      if (s < near) err(`gates ${j} and ${i}: only ${s.toFixed(1)} m apart`);
    }
  }
}

/** Curvature: the original limit outside every zone, the feature's own (never below MIN_FEATURE_TURN_RADIUS) inside one. */
export function checkFeatureCurvature(kappa: Float32Array, info: ZoneInfo, err: Err): void {
  let worst = -1;
  let ratio = 1;
  for (let i = 0; i < kappa.length; i++) {
    const r = kappa[i] / info.limit[i];
    if (r > ratio) {
      ratio = r;
      worst = i;
    }
  }
  if (worst >= 0) err(`path curvature ${kappa[worst].toFixed(3)} at sample ${worst} exceeds ${info.limit[worst].toFixed(3)} (radius ${(1 / kappa[worst]).toFixed(1)} m)`);
}

/**
 * Self-separation in 3D: stretches far apart along the path pass when they are MIN_PATH_SEPARATION apart horizontally, or
 * VERTICAL_SEPARATION apart vertically, or (when either is inside a zone) FEATURE_SEPARATION apart in 3D.
 */
export function checkFeatureSeparation(track: TrackData, index: PathIndex, info: ZoneInfo, stats: TrackStats, err: Err): void {
  const path = track.path;
  const m = path.length;
  const hits: number[] = [];
  let worst = Infinity;
  for (let i = 0; i < m; i++) {
    hits.length = 0;
    index.collectXZ(path[i][0], path[i][2], SEPARATION_PROBE, hits);
    for (const j of hits) {
      if (j <= i) continue;
      const apart = track.closed ? Math.min(j - i, m - (j - i)) : j - i;
      if (apart <= SAME_PASS) continue;
      const dy = Math.abs(path[j][1] - path[i][1]);
      if (dy >= VERTICAL_SEPARATION) continue;
      const xz = Math.hypot(path[j][0] - path[i][0], path[j][2] - path[i][2]);
      if ((info.sampleZone[i] >= 0 || info.sampleZone[j] >= 0) && Math.hypot(xz, dy) >= FEATURE_SEPARATION) continue;
      if (xz < stats.minPathSeparation) stats.minPathSeparation = xz;
      if (xz < worst) worst = xz;
    }
  }
  if (worst < MIN_PATH_SEPARATION) err(`path passes itself within ${worst.toFixed(1)} m`);
}

/** Every path sample keeps BLOCK_MARGIN from every gate frame (TUNNEL_PATH_MARGIN from tunnel sleeves), not just near its own gate. */
export function checkFramesClear(track: TrackData, sampler: TerrainSampler, index: PathIndex, err: Err): void {
  const path = track.path;
  const hits: number[] = [];
  const test = (boxes: ObstacleCollider[], margin: number, what: string): boolean => {
    for (const b of boxes) {
      hits.length = 0;
      index.collectXZ(b.center[0], b.center[2], Math.hypot(b.half[0], b.half[2]) + margin + 0.1, hits);
      for (const j of hits) {
        if (distanceToBox(b, path[j][0], path[j][1], path[j][2]) < margin) {
          err(`${what} blocks the path at sample ${j}`);
          return false;
        }
      }
    }
    return true;
  };
  if (!test(trackColliders({ ...track, obstacles: [] }, sampler), BLOCK_MARGIN, 'a gate frame')) return;
  for (const g of track.gates) if (g.kind === 'tunnel' && !test(gateColliders(g, sampler), TUNNEL_PATH_MARGIN, `tunnel ${g.index}`)) return;
}

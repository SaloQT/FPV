import type { Vec3 } from '../../contracts';
import { classifyOverlap, Contracts, CONTACT_TOLERANCE, ownerRide, type Finding, type WorldScene } from './constructionAudit';
import { gjk, intrusion, solidBounds, solidOf, type Solid } from './interference';
import { pose } from './math';
import { partSource } from './parts';
import { PARK_DT } from './ridePhysics';
import { ParkRuntime } from './runtime';
import type { BodyPose, ParkData } from './types';

/** Translational acceleration envelope used between samples, m/s². The coaster preflight rejects designs
 * above 5.5 g; 6 g bounds every operating body. This is a simulation envelope, not a certified figure. */
export const MOTION_ACCELERATION_BOUND = 6 * 9.80665;

export interface MotionOptions { step?: number; span?: number; start?: number; tolerance?: number; families?: string[]; focus?: (part: number) => boolean }
export interface MotionReport {
  findings: Finding[];
  samples: number;
  pairs: number;
  refinedWindows: number;
  /** Pairs whose clearance could not be certified between ticks even at the fixed simulation step. */
  uncertified: { parts: [number, number]; time: number; distance: number; bound: number }[];
  minimumClearance: { parts: [number, number]; distance: number; time: number } | null;
  method: string;
}

/** Moving parts of selected rides against static structures and against other bodies, over a real
 * operating cycle. Each pair's separation d(t) changes no faster than the relative point speed L,
 * so no contact occurs between samples when d(t0) + d(t1) > L·Δt. Pairs that fail that bound are
 * re-run at every 4 ms fixed tick from a deterministic restart of the same simulation. */
export function auditMotion(park: ParkData, options: MotionOptions = {}): MotionReport {
  const step = options.step ?? 0.05, span = options.span ?? 120, start = options.start ?? 0, tol = options.tolerance ?? CONTACT_TOLERANCE;
  const families = options.families ? new Set(options.families) : null;
  const rideOf = (i: number) => ownerRide(park, i);
  const selected = (i: number) => park.parts[i].render !== false && (!families || (rideOf(i) >= 0 && families.has(park.rides[rideOf(i)].family))) && (options.focus?.(i) ?? true);
  const moving = park.parts.map((p, i) => i).filter(i => park.parts[i].body >= 0 && selected(i));
  const statics = park.parts.map((p, i) => i).filter(i => park.parts[i].body < 0 && park.parts[i].render !== false);
  const contracts = new Contracts(park);
  // Static solids are fixed: one AABB grid for all samples.
  const staticSolids = new Map<number, Solid>(statics.map(i => [i, solidOf(park.parts[i], i)]));
  const cell = 4, grid = new Map<string, number[]>();
  const box = new Float64Array(6);
  for (const i of statics) { solidBounds(staticSolids.get(i)!, box); for (let x = Math.floor(box[0] / cell); x <= Math.floor(box[3] / cell); x++) for (let y = Math.floor(box[1] / cell); y <= Math.floor(box[4] / cell); y++) for (let z = Math.floor(box[2] / cell); z <= Math.floor(box[5] / cell); z++) { const k = `${x},${y},${z}`; (grid.get(k) ?? grid.set(k, []).get(k)!).push(i); } }
  const reach = new Float64Array(park.parts.length);
  for (const i of moving) { const p = park.parts[i]; reach[i] = Math.hypot(...p.pos) + Math.hypot(...p.half); }
  const findings = new Map<string, Finding>(), uncertified: MotionReport['uncertified'] = [];
  let minimum: MotionReport['minimumClearance'] = null, samples = 0, pairsChecked = 0;
  const last = new Map<string, { d: number; speed: number; time: number }>(), refine = new Map<number, Set<string>>();

  function evaluate(runtime: ParkRuntime, poses: BodyPose[], time: number, only?: Set<string>, interval = step): void {
    for (let b = 0; b < poses.length; b++) runtime.bodyPose(b, time, poses[b]);
    const solids = new Map<number, Solid>(), speed = new Float64Array(park.parts.length), bounds = new Float64Array(6);
    for (const i of moving) {
      const p = park.parts[i], body = poses[p.body]; solids.set(i, solidOf(p, i, body));
      speed[i] = Math.hypot(...body.vel) + Math.hypot(...body.omega) * reach[i] + MOTION_ACCELERATION_BOUND * interval;
    }
    const scene: WorldScene = { solids: [], bounds: new Float64Array(0) };
    const solidAt = (i: number) => solids.get(i) ?? staticSolids.get(i)!;
    scene.solids = new Proxy([] as Solid[], { get: (_, key) => typeof key === 'string' && /^\d+$/.test(key) ? solidAt(Number(key)) : undefined });
    const visit = (i: number, j: number) => {
      const key = i < j ? `${i},${j}` : `${j},${i}`; if (only && !only.has(key)) return;
      pairsChecked++;
      const a = solidAt(i), c = solidAt(j), g = gjk(a, c), relative = speed[i] + (park.parts[j].body >= 0 ? speed[j] : 0);
      let distance = g.intersect ? 0 : g.distance;
      if (g.intersect) {
        const depth = Math.max(intrusion(a, c, 16).lower, intrusion(c, a, 16).lower);
        distance = -depth;
        if (depth > tol) {
          const verdict = classifyOverlap(scene, contracts, i, j, depth, tol);
          if (!verdict.explained) {
            const existing = findings.get(key);
            if (!existing || existing.measured < depth) {
              const ride = rideOf(i) >= 0 ? rideOf(i) : rideOf(j);
              findings.set(key, { kind: 'motion-interference', severity: 'defect', parts: [i, j], sources: [partSource(park.parts[i]), partSource(park.parts[j])], ride, family: ride >= 0 ? park.rides[ride].family : 'static',
                measured: depth, location: a.c, time, detail: `${verdict.detail} during operation at t=${time.toFixed(3)} s (${verdict.kind}).`,
                view: { name: `motion-${i}-${j}`, time, part: i, dir: [1, 0.6, 1], distance: Math.max(1.5, 3 * Math.hypot(...park.parts[i].half)), highlight: [i, j] } });
            }
          }
          return;
        }
      } else if (!minimum || distance < minimum.distance) minimum = { parts: [i, j], distance, time };
      const previous = last.get(key);
      if (previous && Math.max(0, previous.d) + Math.max(0, distance) <= Math.max(previous.speed, relative) * (time - previous.time)) {
        if (only) uncertified.push({ parts: [i, j], time, distance, bound: Math.max(previous.speed, relative) * (time - previous.time) });
        else { const w = Math.round((previous.time - start) / step); (refine.get(w) ?? refine.set(w, new Set()).get(w)!).add(key); }
      }
      last.set(key, { d: distance, speed: relative, time });
    };
    for (const i of moving) {
      const s = solids.get(i)!; solidBounds(s, bounds); const margin = speed[i] * interval;
      const seen = new Set<number>();
      for (let x = Math.floor((bounds[0] - margin) / cell); x <= Math.floor((bounds[3] + margin) / cell); x++) for (let y = Math.floor((bounds[1] - margin) / cell); y <= Math.floor((bounds[4] + margin) / cell); y++) for (let z = Math.floor((bounds[2] - margin) / cell); z <= Math.floor((bounds[5] + margin) / cell); z++) {
        for (const j of grid.get(`${x},${y},${z}`) ?? []) if (!seen.has(j)) { seen.add(j); const o = staticBox(j); if (o[0] - margin > bounds[3] || o[3] + margin < bounds[0] || o[1] - margin > bounds[4] || o[4] + margin < bounds[1] || o[2] - margin > bounds[5] || o[5] + margin < bounds[2]) continue; visit(i, j); }
      }
    }
    // Moving against moving, across different bodies.
    const order = [...moving].sort((a, b) => solids.get(a)!.c[0] - solids.get(b)!.c[0]), extent = new Map<number, Float64Array>();
    for (const i of moving) extent.set(i, solidBounds(solids.get(i)!));
    for (let x = 0; x < order.length; x++) {
      const i = order[x], bi = extent.get(i)!, mi = speed[i] * interval;
      for (let y = x + 1; y < order.length; y++) {
        const j = order[y], bj = extent.get(j)!, m = mi + speed[j] * interval;
        if (bj[0] - m > bi[3] + 40) break;
        if (park.parts[i].body === park.parts[j].body) continue;
        if (bi[0] - m > bj[3] || bi[3] + m < bj[0] || bi[1] - m > bj[4] || bi[4] + m < bj[1] || bi[2] - m > bj[5] || bi[5] + m < bj[2]) continue;
        visit(i, j);
      }
    }
    samples++;
  }
  const staticBoxes = new Map<number, Float64Array>();
  function staticBox(j: number): Float64Array { let b = staticBoxes.get(j); if (!b) staticBoxes.set(j, b = solidBounds(staticSolids.get(j)!)); return b; }

  let runtime = new ParkRuntime(park), poses = park.bodies.map(() => pose());
  const steps = Math.round(span / step);
  for (let k = 0; k <= steps; k++) {
    const time = start + k * step;
    while (runtime.elapsed < time - 1e-9) runtime.advance(Math.min(PARK_DT, time - runtime.elapsed));
    evaluate(runtime, poses, runtime.elapsed);
  }
  // Refinement: deterministic restart, every fixed tick inside each uncertified window, only for the pairs concerned.
  const windows = [...refine.keys()].sort((a, b) => a - b);
  if (windows.length) {
    runtime = new ParkRuntime(park); poses = park.bodies.map(() => pose()); last.clear();
    for (const w of windows) {
      const from = start + w * step, to = from + step;
      while (runtime.elapsed < from - 1e-9) runtime.advance(Math.min(PARK_DT, from - runtime.elapsed));
      for (let time = runtime.elapsed; time <= to + 1e-9; time += PARK_DT) {
        while (runtime.elapsed < time - 1e-9) runtime.advance(PARK_DT);
        evaluate(runtime, poses, runtime.elapsed, refine.get(w)!, PARK_DT);
      }
    }
  }
  return { findings: [...findings.values()], samples, pairs: pairsChecked, refinedWindows: windows.length, uncertified, minimumClearance: minimum,
    method: `Sampled every ${step} s over ${span} s from t=${start} s. Between samples a pair is cleared when d0 + d1 > L·Δt, L = |v| + |ω|·r + ${MOTION_ACCELERATION_BOUND.toFixed(1)}·Δt per body. Windows that fail the bound are re-sampled at the ${PARK_DT * 1000} ms fixed tick; any remaining are listed as uncertified. Sampling does not see contacts inside an uncertified window.` };
}
export type { Vec3 };

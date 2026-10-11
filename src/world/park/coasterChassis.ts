import type { Vec3 } from '../../contracts';
import { railSample, sampleRail, type RailSample } from './curve';
import { basisQuat, cross, dot, mul, pose, unit, wrap } from './math';
import { seatOnBuiltRails } from './railTube';
import type { BodyPose, CoasterCurve } from './types';

export interface ChassisSolution { front: RailSample; rear: RailSample; body: BodyPose; arcHalf: number; residual: number; iterations: number }
export function chassisSolution(): ChassisSolution { return { front: railSample(), rear: railSample(), body: pose(), arcHalf: 0, residual: 0, iterations: 0 }; }

/** Two rail-following bogies constrain a rigid chassis through spherical kingpins.
 * Arc spacing is solved from fixed physical pin separation; equal arc spacing is not equal chord length on bends. */
export function solveChassis(curve: CoasterCurve, at: number, wheelbase: number, pivot: number, out: ChassisSolution): ChassisSolution {
  // Reduce lap distance before adding small bogie offsets; otherwise long runs lose offset precision.
  at = wrap(at, curve.length);
  const f = out.front, r = out.rear, front: Vec3 = [0, 0, 0], rear: Vec3 = [0, 0, 0], chord: Vec3 = [0, 0, 0];
  const evaluate = (offset: number) => {
    sampleRail(curve, at + offset, f); sampleRail(curve, at - offset, r);
    // The bogies ride on the rail lengths as built, which cut up to RAIL.chordError inside the exact curve.
    seatOnBuiltRails(curve, at + offset, f); seatOnBuiltRails(curve, at - offset, r);
    for (let k = 0; k < 3; k++) { front[k] = f.pos[k] + pivot * f.up[k]; rear[k] = r.pos[k] + pivot * r.up[k]; chord[k] = front[k] - rear[k]; }
    return Math.hypot(...chord);
  };
  let lo = 0, hi = wheelbase, length = evaluate(hi);
  if (!(length > wheelbase)) throw new Error('Track curvature cannot accommodate this rigid coaster wheelbase');
  let offset = out.arcHalf > lo && out.arcHalf < hi ? out.arcHalf : wheelbase / 2;
  let tolerance = 0;
  for (let i = 0; i < 48; i++) {
    length = evaluate(offset); out.residual = length - wheelbase; out.iterations = i + 1;
    // Position/frame arithmetic plus the two arc-table coordinate additions have separate roundoff scales.
    tolerance = Number.EPSILON * (16 * Math.max(1, ...front.map(Math.abs), ...rear.map(Math.abs), wheelbase) + 4 * curve.length);
    if (Math.abs(out.residual) <= tolerance) break;
    if (out.residual > 0) hi = offset; else lo = offset;
    // The rail tangent is a preconditioner, not an assumed exact derivative of the elevated kingpin curve.
    // A maintained bracket guarantees convergence when changing bank or sampled arc knots perturb that derivative.
    const slope = dot(chord, f.tangent) / length + dot(chord, r.tangent) / length;
    const next = offset - out.residual / slope;
    offset = Number.isFinite(next) && next > lo && next < hi ? next : (lo + hi) / 2;
  }
  if (Math.abs(out.residual) > tolerance) throw new Error(`Coaster wheelbase constraint did not converge: ${out.residual}m`);
  out.arcHalf = offset;
  const forward = mul(chord, 1 / length), averageUp: Vec3 = [f.up[0] + r.up[0], f.up[1] + r.up[1], f.up[2] + r.up[2]];
  const right = unit(cross(forward, averageUp)), up = cross(right, forward);
  out.body.rot = basisQuat(right, up, mul(forward, -1));
  for (let k = 0; k < 3; k++) out.body.pos[k] = (front[k] + rear[k]) / 2 - pivot * up[k];
  return out;
}

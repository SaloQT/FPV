import type { Vec3 } from '../../contracts';
import { chassisSolution, solveChassis, type ChassisSolution } from './coasterChassis';
import { basisQuat, cross, dot, pose, rotate, unit, wrap } from './math';
import { coasterCouplerLength, coasterCouplerPin, coasterWheelbase } from './rideDimensions';
import type { BodyPose, CoasterCurve } from './types';

export interface TrainChassisSolution {
  cars: ChassisSolution[]; couplers: BodyPose[]; stations: Float64Array; spacing: Float64Array;
  residuals: Float64Array; iterations: Uint8Array; maxArcDiscrepancy: number;
  scratch: { a: Vec3; b: Vec3; delta: Vec3; back: Vec3; pin: Vec3 };
}
export function trainChassisSolution(count: number): TrainChassisSolution {
  return { cars: Array.from({ length: count }, chassisSolution), couplers: Array.from({ length: Math.max(0, count - 1) }, pose),
    stations: new Float64Array(count), spacing: new Float64Array(count), residuals: new Float64Array(count), iterations: new Uint8Array(count), maxArcDiscrepancy: 0,
    scratch: { a: [0, 0, 0], b: [0, 0, 0], delta: [0, 0, 0], back: [0, 0, 0], pin: [0, 0, 0] } };
}

/** Rail-following cars linked by fixed-length drawbars and spherical joints.
 * This constrains geometry; longitudinal force integration still uses nominal equal arc spacing. */
export function solveTrainChassis(curve: CoasterCurve, headS: number, carLength: number, pivot: number, pinY: number, out: TrainChassisSolution, requiredCars = out.cars.length, startCar = 0): TrainChassisSolution {
  if (!Number.isInteger(startCar) || !Number.isInteger(requiredCars) || startCar < 0 || requiredCars < 1 || startCar > requiredCars || requiredCars > out.cars.length) throw new Error('Invalid coaster prefix');
  const head = wrap(headS, curve.length), pinZ = coasterCouplerPin(carLength), drawbar = coasterCouplerLength(carLength), wheelbase = coasterWheelbase(carLength);
  const { a, b, delta, back, pin } = out.scratch;
  // A fixed head coordinate can be extended for later body requests without recomputing its solved leaders.
  if (startCar === 0) { out.stations[0] = head; out.maxArcDiscrepancy = 0; solveChassis(curve, head, wheelbase, pivot, out.cars[0]); }
  else if (out.stations[0] !== head) throw new Error('Cannot extend a coaster prefix at a different head coordinate');
  for (let i = Math.max(1, startCar); i < requiredCars; i++) {
    const leader = out.cars[i - 1].body, follower = out.cars[i], station = out.stations[i - 1];
    pin[0] = 0; pin[1] = pinY; pin[2] = pinZ; rotate(leader.rot, pin, a);
    for (let k = 0; k < 3; k++) a[k] += leader.pos[k];
    let length = 0, residual = 0, evaluations = 0;
    const evaluate = (spacing: number) => {
      solveChassis(curve, station - spacing, wheelbase, pivot, follower); evaluations++;
      pin[2] = -pinZ; rotate(follower.body.rot, pin, b);
      for (let k = 0; k < 3; k++) { b[k] += follower.body.pos[k]; delta[k] = b[k] - a[k]; }
      length = Math.hypot(...delta); residual = length - drawbar; return residual;
    };
    const tolerance = Number.EPSILON * (32 * Math.max(1, Math.abs(a[0]), Math.abs(a[1]), Math.abs(a[2]), carLength) + 8 * curve.length);
    let lo = 2 * pinZ, hi = lo + 2 * drawbar, spacing = out.spacing[i] || carLength;
    evaluate(spacing);
    // Cached positions change only slightly per fixed step. Try a few bounded Newton corrections
    // before paying for both bracket endpoints; convergence still uses the exact pin-distance residual.
    for (let warm = 0; warm < 3 && Math.abs(residual) > tolerance; warm++) {
      pin[0] = 0; pin[1] = 0; pin[2] = 1; rotate(follower.body.rot, pin, back); pin[1] = pinY;
      const slope = dot(delta, back) / length, candidate = spacing - residual / slope;
      if (!Number.isFinite(candidate) || candidate <= lo || candidate >= hi) break;
      const previousResidual = Math.abs(residual); spacing = candidate; evaluate(spacing);
      if (Math.abs(residual) > previousResidual) break;
    }
    if (Math.abs(residual) > tolerance) {
      if (evaluate(lo) > 0 || evaluate(hi) < 0) throw new Error('Track cannot accommodate the specified coaster drawbar');
      evaluate(spacing);
      for (let iteration = 0; iteration < 40 && Math.abs(residual) > tolerance; iteration++) {
        if (residual > 0) hi = spacing; else lo = spacing;
        // Body-back direction preconditions the pin-distance derivative; a bracket handles curvature and bank knots.
        pin[0] = 0; pin[1] = 0; pin[2] = 1; rotate(follower.body.rot, pin, back); pin[1] = pinY;
        const slope = dot(delta, back) / length, candidate = spacing - residual / slope;
        spacing = Number.isFinite(candidate) && candidate > lo && candidate < hi ? candidate : (lo + hi) / 2;
        evaluate(spacing);
      }
    }
    if (Math.abs(residual) > tolerance) throw new Error(`Coaster drawbar constraint did not converge: ${residual} m`);
    out.spacing[i] = spacing; out.stations[i] = station - spacing; out.residuals[i] = residual; out.iterations[i] = evaluations;
    out.maxArcDiscrepancy = Math.max(out.maxArcDiscrepancy, Math.abs(out.stations[i] - (head - i * carLength)));
    const body = out.couplers[i - 1], up: Vec3 = [delta[0] / length, delta[1] / length, delta[2] / length];
    const reference = rotate(leader.rot, [0, 1, 0], back), right = unit(cross(up, reference));
    if (Math.hypot(...right) < 0.5) throw new Error('Drawbar axis is incompatible with the leading chassis frame');
    body.rot = basisQuat(right, up, cross(right, up));
    for (let k = 0; k < 3; k++) body.pos[k] = (a[k] + b[k]) / 2;
  }
  return out;
}

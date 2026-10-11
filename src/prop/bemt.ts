/**
 * Blade element momentum theory for a hovering or climbing propeller. The blade is cut into rings; on each ring the
 * lift and drag of the section (from the airfoil polar) must agree with the momentum the ring pushes through the disk.
 * The two are solved together for the air speed the blade sees (axial and swirl), with Prandtl tip and hub loss.
 *
 * Method: Adkins and Liebeck, "Design of optimum propellers", J. Propulsion and Power 10(5), 1994, and the usual
 * blade element treatment in Leishman, "Principles of Helicopter Aerodynamics", 2nd ed., ch. 3. Compressibility is the
 * Prandtl-Glauert factor on the lift slope.
 */
import { chordAt, twistAt, type PropDesign } from './design';

const SPEED_OF_SOUND = 343;
const RINGS = 24;
const ITERATIONS = 80;

export interface PropPoint {
  /** N. */
  thrust: number;
  /** Shaft torque, N m. */
  torque: number;
  /** Shaft power, W. */
  power: number;
  /** Thrust coefficient T / (rho n^2 D^4). */
  ct: number;
  /** Torque coefficient Q / (rho n^2 D^5). */
  cq: number;
  /** Advance ratio V / (n D). */
  j: number;
  /** Propulsive efficiency T V / P (zero at standstill). */
  etaProp: number;
  /** Thrust per shaft watt, N/W (g/W is this times 101.97). */
  thrustPerWatt: number;
  /** Tip Mach number from rotation and inflow. */
  tipMach: number;
  /** Mean induced axial speed at the disk, m/s. */
  inducedSpeed: number;
  /** Moment of the blade's thrust about its root, N m (summed over all blades). */
  rootBending: number;
}

/** Lift and drag coefficients for an angle of attack, with a soft stall into flat-plate behaviour. */
export function polar(d: PropDesign, alpha: number, mach: number): { cl: number; cd: number } {
  const a = d.airfoil;
  const pg = 1 / Math.sqrt(Math.max(0.2, 1 - Math.min(0.85, mach) ** 2));
  const linear = a.clAlpha * pg * (alpha - a.alpha0);
  const stallAlpha = a.alpha0 + a.clMax / (a.clAlpha * pg);
  let cl: number;
  let cd: number;
  if (Math.abs(alpha - a.alpha0) <= stallAlpha - a.alpha0 && alpha > -0.6) {
    cl = linear;
    cd = a.cd0 + a.cdK * cl * cl;
  } else {
    // Past the stall: blend the clipped lift into the flat plate values (cl = sin 2a, cd = 2 sin^2 a).
    const sgn = alpha >= a.alpha0 ? 1 : -1;
    const over = Math.min(1, (Math.abs(alpha - a.alpha0) - (stallAlpha - a.alpha0)) / 0.7);
    const clStall = sgn * a.clMax;
    const clPlate = Math.sin(2 * alpha);
    cl = clStall * (1 - over) + clPlate * over;
    const cdStall = a.cd0 + a.cdK * a.clMax * a.clMax;
    cd = cdStall * (1 - over) + 2 * Math.sin(alpha) ** 2 * over + 0.02 * over;
    cd = Math.max(cd, cdStall);
  }
  return { cl, cd };
}

/** Thrust, torque and power at shaft speed `omega` (rad/s) and axial inflow `vAxial` (m/s, positive is climbing). */
export function bemt(d: PropDesign, omega: number, vAxial: number, rho = 1.225): PropPoint {
  const R = d.diameter * 0.5;
  const B = d.blades;
  const xh = d.hubRatio;
  const dx = (1 - xh) / RINGS;
  let thrust = 0;
  let torque = 0;
  let bending = 0;
  let viSum = 0;
  let mWeight = 0;
  for (let k = 0; k < RINGS; k++) {
    const x = xh + (k + 0.5) * dx;
    const r = x * R;
    const dr = dx * R;
    const c = chordAt(d, x);
    const beta = twistAt(d, x);
    const Ut0 = omega * r;
    let vi = Math.max(0.5, 0.05 * omega * R);
    let vt = 0;
    let dT = 0;
    let dQ = 0;
    for (let it = 0; it < ITERATIONS; it++) {
      const Ua = Math.max(1e-3, vAxial + vi);
      const Ut = Math.max(1e-3, Ut0 - vt);
      const phi = Math.atan2(Ua, Ut);
      const W = Math.hypot(Ua, Ut);
      const { cl, cd } = polar(d, beta - phi, W / SPEED_OF_SOUND);
      const cn = cl * Math.cos(phi) - cd * Math.sin(phi);
      const ct = cl * Math.sin(phi) + cd * Math.cos(phi);
      const q = 0.5 * rho * W * W * B * c;
      dT = q * cn;
      dQ = q * ct * r;
      // Prandtl loss at the tip and at the hub.
      const sinPhi = Math.max(0.02, Math.sin(phi));
      const ftip = (2 / Math.PI) * Math.acos(Math.min(1, Math.exp((-B / 2) * ((1 - x) / (x * sinPhi)))));
      const fhub = (2 / Math.PI) * Math.acos(Math.min(1, Math.exp((-B / 2) * ((x - xh) / (xh * sinPhi)))));
      const F = Math.max(0.02, ftip * fhub);
      // Momentum: dT = 4 pi r rho F (V + vi) vi, and dQ = 4 pi r^2 rho F (V + vi) vt.
      const K = dT / (4 * Math.PI * r * rho * F);
      const disc = Math.max(0, vAxial * vAxial + 4 * K);
      const viNew = (-vAxial + Math.sqrt(disc)) / 2;
      const vtNew = dQ / (4 * Math.PI * r * r * rho * F * Ua);
      const dv = Math.abs(viNew - vi) + Math.abs(vtNew - vt);
      vi += 0.4 * (viNew - vi);
      vt += 0.4 * (Math.min(vtNew, 0.9 * Ut0) - vt);
      if (dv < 1e-4 * (1 + Ut0)) break;
    }
    thrust += dT * dr;
    torque += dQ * dr;
    bending += dT * dr * (r - xh * R);
    viSum += vi * r;
    mWeight += r;
  }
  const n = omega / (2 * Math.PI);
  const D = d.diameter;
  const power = torque * omega;
  const tipSpeed = Math.hypot(omega * R, vAxial);
  return {
    thrust, torque, power,
    ct: thrust / (rho * n * n * D ** 4),
    cq: torque / (rho * n * n * D ** 5),
    j: n > 0 ? vAxial / (n * D) : 0,
    etaProp: power > 1e-9 ? (thrust * vAxial) / power : 0,
    thrustPerWatt: power > 1e-9 ? thrust / power : 0,
    tipMach: tipSpeed / SPEED_OF_SOUND,
    inducedSpeed: viSum / mWeight,
    rootBending: bending,
  };
}

/** Centrifugal stress at the blade root, Pa: the pull of the blade's own mass flung outward, over the root cross section. */
export function rootStress(d: PropDesign, omega: number, thrustAtOmega: number): number {
  const R = d.diameter * 0.5;
  const dx = (1 - d.hubRatio) / RINGS;
  let pull = 0;
  let areaRoot = 0;
  for (let k = 0; k < RINGS; k++) {
    const x = d.hubRatio + (k + 0.5) * dx;
    const c = chordAt(d, x);
    const area = 0.75 * c * c * d.thicknessRatio;
    if (k === 0) areaRoot = area;
    pull += d.density * area * omega * omega * x * R * dx * R;
  }
  const c0 = chordAt(d, d.hubRatio);
  const t0 = c0 * d.thicknessRatio;
  // Bending of one blade by its share of the thrust, as a plank of root chord c0 and thickness t0.
  const bendMoment = (thrustAtOmega / d.blades) * 0.6 * R * (1 - d.hubRatio);
  const inertia = (c0 * t0 ** 3) / 12 * 0.8;
  const bend = (bendMoment * (t0 / 2)) / Math.max(1e-14, inertia);
  return pull / Math.max(1e-9, areaRoot) + bend;
}

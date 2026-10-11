import { G0 } from '../../sim/math3d';
import { clamp, TAU, wrap } from './math';
import { PAVING_RISE } from './surfaces';

/** Dimensions in metres. Inertia and masses are explicit simulation assumptions. */
export const ENTERPRISE_RADIUS = 7.5;
export const ENTERPRISE_HUB = 2.6;
export const ENTERPRISE_HINGE = 1.15;
/** Top of the Enterprise's boarding deck: a ring slab around an open pit, with a slot where the lift boom lies. */
export const ENTERPRISE_BASE_TOP = 1.3;
/** Enterprise boarding deck, ride-local metres: a ring of `segments` cast segments around the open pit. The boom lies
 * in a notch toward -z where `notch` segments are left out; `corridor` is the half-width the boom rails and pivot blocks need. */
export const ENTERPRISE_DECK = { inner: 6.2, outer: 10.5, segments: 40, notch: 5, corridor: 2 } as const;
/** Whether deck segment `k` (centred at angle k * TAU / segments, from +x toward +z) is left out for the boom. */
export function enterpriseDeckGap(k: number): boolean {
  const step = TAU / ENTERPRISE_DECK.segments, a = k * step;
  return Math.abs(Math.atan2(Math.sin(a + Math.PI / 2), Math.cos(a + Math.PI / 2))) < ENTERPRISE_DECK.notch * step / 2;
}
export const ENTERPRISE_CABINS = 20;
/** Whether a docked cabin hangs over the boom slot, where no deck reaches it. Guests board only the other cabins. */
export function enterpriseCabinOverSlot(cabin: number): boolean {
  return enterpriseDeckGap(Math.round(cabin * ENTERPRISE_DECK.segments / ENTERPRISE_CABINS));
}
/** Floor of the pit and the boom slot: a slab cast on the paving. */
export const ENTERPRISE_PIT_FLOOR = PAVING_RISE + 0.2;
/**
 * Lift boom pivot, ride-local. It stands outside the gondola ring and low enough that the
 * resting gondolas pass over the boom lying in its slot. The frame body's origin is this point.
 */
export const ENTERPRISE_PIVOT: readonly [number, number, number] = [0, 0.9, -9];
/** Wheel centre in the boom's frame: a hub column at the boom's end lifts the wheel to its resting height. */
export const ENTERPRISE_BOOM: readonly [number, number, number] = [0, ENTERPRISE_HUB - ENTERPRISE_PIVOT[1], -ENTERPRISE_PIVOT[2]];
/** Lift ram: outer sleeve radius, foot pin on the pit floor (ride-local), head pin on the boom (boom frame). */
export const ENTERPRISE_RAM_RADIUS = 0.28;
export const ENTERPRISE_RAM_FOOT_PIN = 0.33;
export const ENTERPRISE_RAM_FOOT: readonly [number, number, number] = [0, ENTERPRISE_PIT_FLOOR + ENTERPRISE_RAM_FOOT_PIN + 0.1, ENTERPRISE_PIVOT[2] + 6.2];
export const ENTERPRISE_RAM_HEAD: readonly [number, number, number] = [0, 0.8, 3];
/** Full lift angle, radians. */
export const ENTERPRISE_MAX_TILT = 1.48;

/** A point fixed to the tilting boom, from boom-frame coordinates to ride-local ones at tilt `phi`. */
export function enterpriseBoomPoint(phi: number, local: readonly [number, number, number]): [number, number, number] {
  const c = Math.cos(phi), s = Math.sin(phi);
  return [local[0], ENTERPRISE_PIVOT[1] + local[1] * c + local[2] * s, ENTERPRISE_PIVOT[2] - local[1] * s + local[2] * c];
}
export const TOPSPIN_ARM = 5.5;
export const TOPSPIN_PIVOT = 9.5;
export const TOPSPIN_COM = 1.15;
/**
 * Scrambler layout, built the way Eli Bridge's service bulletins describe it (docs/park-construction-sources.md): a
 * stationary centre pole with sweep bearings at its top and bottom, top sweeps held by tie rods, bottom sweeps
 * about 3.5 in above the walkway, a unit pole at each arm tip, and four seat sweeps on each unit carrying a car
 * each, twelve cars on three arms. Heights and sizes are not in the sources and are chosen here.
 * `reach` and `offset` are fractions of the ride radius (arm tip, and car centre from its unit pole); heights are
 * ride-local metres. Car bodies sit `bodyY` up, on the floor underside. A car is `carHalf` either side of its
 * centre, its back toward the unit pole; riders face out. On the 12 m ride a car's outer corner sweeps 2.99 m
 * round its unit, so units clear each other by 3.4 m and the mast by 1.6 m, and each car rides 0.1 m above the
 * bottom sweep it passes over.
 */
export const SCRAMBLER = {
  reach: 0.45, offset: 0.175, armY: 3.5, units: 3, carsPerUnit: 4,
  /** Bottom sweeps: radius, and centre height 3.5 in above the walkway. */
  bottomRadius: 0.1, bottomY: PAVING_RISE + 3.5 * 0.0254 + 0.1,
  /** Seat sweep height and radius; the car floor is centred on the seat sweep. */
  sweepY: 0.65, sweepRadius: 0.05,
  bodyY: 0.59, floorHalf: 0.06, carHalf: [0.74, 0.8] as const,
  /** Seats in the car frame: two side by side, facing -z (out from the unit). */
  seatX: 0.31, seatY: 0.42, seatZ: 0.23,
} as const;
/** The gondola's floor frame (1.25 m below its axis, 1.3 m either side of it) sweeps 0.55 m below the
 * boarding level as it turns; the loading floor lowers that much plus 150 mm once the restraints lock. */
export const TOPSPIN_PLATFORM_DROP = Math.hypot(1.25, 1.3) - 1.25 + 0.15;

export interface RotaryState { theta: number; omega: number; angularA: number }
export interface EnterpriseState extends RotaryState {
  phi: number; phiV: number; tiltA: number; hinges: Float64Array; hingeV: Float64Array;
}

/** Torque-limited velocity governor, viscous drag and a physical drive power ceiling. */
export function rotaryAcceleration(omega: number, target: number, inertia: number, torque: number, power: number, externalTorque = 0): number {
  const requested = (target - omega) * inertia * 0.85 - externalTorque;
  const limit = requested * omega > 0 ? Math.min(torque, power / Math.max(Math.abs(omega), 0.1)) : torque;
  return (clamp(requested, -limit, limit) + externalTorque - omega * inertia * 0.018) / inertia;
}

export function dockAngle(theta: number): number { return wrap(-theta + Math.PI, TAU) - Math.PI; }

/** A point-mass pendulum on an accelerating pivot with a finite centre-of-mass inertia. */
export function pivotPendulumAcceleration(angle: number, speed: number, pivotAY: number, pivotAZ: number, length: number, radiusOfGyration: number, damping: number): number {
  return (-(G0 + pivotAY) * Math.sin(angle) + pivotAZ * Math.cos(angle)) * length / (length * length + radiusOfGyration * radiusOfGyration) - damping * speed;
}

/**
 * Each Enterprise cabin swings independently on its tangent-axis hinge. The
 * generalized force projects gravity, hub acceleration and rotating-frame
 * acceleration onto the actual hinge tangent. No cabin orientation is keyed
 * to a prescribed animation or to the camera.
 */
export function stepEnterpriseHinges(s: EnterpriseState, dt: number, damping = 0.65): void {
  const r = ENTERPRISE_RADIUS, l = ENTERPRISE_HINGE;
  const sp = Math.sin(s.phi), cp = Math.cos(s.phi), pv2 = s.phiV * s.phiV;
  // Wheel centre acceleration: the boom vector (height h, length b) turns about the pivot.
  const h = ENTERPRISE_BOOM[1], b = ENTERPRISE_BOOM[2];
  const cy = (b * cp - h * sp) * s.tiltA - (h * cp + b * sp) * pv2, cz = -(h * cp + b * sp) * s.tiltA - (b * cp - h * sp) * pv2;
  const nyy = -cp * pv2 - sp * s.tiltA, nzz = sp * pv2 - cp * s.tiltA;
  for (let i = 0; i < s.hinges.length; i++) {
    const a = s.theta + i * TAU / s.hinges.length, ca = Math.cos(a), sa = Math.sin(a);
    const beta = s.hinges[i], sb = Math.sin(beta), cb = Math.cos(beta);
    const zaa = ca * s.angularA - sa * s.omega * s.omega;
    const exx = -ca * s.omega * s.omega - sa * s.angularA;
    const eyy = (-sp * pv2 + cp * s.tiltA) * sa + 2 * cp * s.phiV * ca * s.omega + sp * zaa;
    const ezz = (-cp * pv2 - sp * s.tiltA) * sa - 2 * sp * s.phiV * ca * s.omega + cp * zaa;
    const tx = cb * ca, ty = cb * sp * sa + sb * cp, tz = cb * cp * sa - sb * sp;
    const hingeForce = -r * exx * tx + (-G0 - cy - r * eyy) * ty + (-cz - r * ezz) * tz;
    const frameForce = sb * exx * tx + (sb * eyy - cb * nyy) * ty + (sb * ezz - cb * nzz) * tz;
    // Distributed cabin mass contributes a 0.42 m radius of gyration.
    const acceleration = (l * hingeForce - l * l * frameForce) / (l * l + 0.42 ** 2) - damping * s.hingeV[i];
    s.hingeV[i] += acceleration * dt;
    s.hinges[i] += s.hingeV[i] * dt;
  }
}

import type { Vec3 } from '../../contracts';
import { GUEST_ANKLE_Y, guestLegPose } from './guestPose';
import { rotate, smooth } from './math';
import type { ParkData, ParkPart } from './types';

/** Conservative shoe footprint across every mesh LOD and the full procedural body-depth range. */
// Includes hero spline overshoot (.10374/.04757), not only the authored shoe ring radii.
export const STAIR_SHOE_FRONT = 0.104 * 1.2, STAIR_SHOE_BACK = 0.049 * 1.2;
export const STAIR_LANDING_BLEND = 0.8, STAIR_SWING_CLEARANCE = 0.045;
export const STAIR_PELVIS_FLEX = 0.025;
// Tested against all animated mesh LODs at maximum build and height, plus behavioural clearance.
// A step is 0.9 m at the 1.5 m/s boarding walk, so a guest spans about 1.45 m from rear toe to front toe and the next guest must stay behind that.
export const STAIR_HEADWAY = 1.55, STAIR_LANE = 0.5;
export interface StairTread { min: number; max: number; top: number; part: ParkPart }

/** Compiled once from the actual, oriented solid tread boxes. Coordinates increase uphill. */
export class GuestStairFlight {
  readonly origin: Vec3;
  readonly forward: Vec3;
  readonly treads: StairTread[];
  readonly going: number;
  readonly length: number;
  readonly bottom: number;
  readonly top: number;
  readonly halfWidth: number;
  constructor(parts: ParkPart[]) {
    parts.sort((a, b) => a.pos[1] - b.pos[1]);
    const first = parts[0], back = rotate(first.rot, [0, 0, 1]);
    this.forward = [-back[0], 0, -back[2]];
    this.origin = [first.pos[0] + back[0] * first.half[2], 0, first.pos[2] + back[2] * first.half[2]];
    this.bottom = first.pos[1] - first.half[1]; this.going = first.half[2] * 2;
    this.halfWidth = Math.min(...parts.map(p => p.half[0]));
    this.treads = parts.map(part => { const center = this.project(part.pos); return { min: center - part.half[2], max: center + part.half[2], top: part.pos[1] + part.half[1], part }; });
    this.length = this.treads.at(-1)!.max; this.top = this.treads.at(-1)!.top;
  }
  project(p: ArrayLike<number>): number { return (p[0] - this.origin[0]) * this.forward[0] + (p[2] - this.origin[2]) * this.forward[2]; }
  lateral(p: ArrayLike<number>): number { return (p[0] - this.origin[0]) * this.forward[2] - (p[2] - this.origin[2]) * this.forward[0]; }
  /** Level extensions are the planes shared by the first tread underside and the last tread top. */
  support(t: number): number {
    if (t < 0) return this.bottom;
    for (const tread of this.treads) if (t < tread.max - 1e-9) return tread.top;
    return this.top;
  }
  contains(p: ArrayLike<number>): boolean {
    const t = this.project(p), side = this.lateral(p);
    return t > -STAIR_LANDING_BLEND - 0.35 && t < this.length + STAIR_LANDING_BLEND + 0.35 && Math.abs(side) < this.halfWidth - 0.3;
  }
  lead(direction = 1): Vec3 { return this.routePoint([this.origin[0] - this.forward[0] * (STAIR_LANDING_BLEND + 0.4), this.bottom, this.origin[2] - this.forward[2] * (STAIR_LANDING_BLEND + 0.4)], direction); }
  /** Keep opposing flows apart on the existing stair width; adjacent ride/seat waypoints are untouched. */
  routePoint(p: Vec3, direction: number): Vec3 {
    const t = this.project(p), side = this.lateral(p);
    if (t < -1.3 || t > this.length + 1.5 || Math.abs(side) > this.halfWidth) return [...p];
    const shift = direction * STAIR_LANE - side;
    return [p[0] + this.forward[2] * shift, p[1], p[2] - this.forward[0] * shift];
  }
  /** Extend admission headway along the approach line, so a backed-up landing cannot spill overlapping guests upstream. */
  trafficContains(p: ArrayLike<number>): boolean { return Math.abs(this.lateral(p)) < this.halfWidth + 0.3; }
  weight(position: ArrayLike<number>): number {
    const t = this.project(position), margin = 0.35;
    return smooth(Math.min((t + margin + STAIR_LANDING_BLEND) / STAIR_LANDING_BLEND, (this.length + margin + STAIR_LANDING_BLEND - t) / STAIR_LANDING_BLEND));
  }

  /** Plant on complete tread footprints; lift in place, cross above all risers, then lower in place. */
  contacts(position: ArrayLike<number>, yaw: number, height: number, time: number, speed: number, out: Float32Array | Float64Array, activity = 1): boolean {
    const t = this.project(position), alignment = -Math.sin(yaw) * this.forward[0] - Math.cos(yaw) * this.forward[2];
    if (!this.contains(position) || Math.abs(alignment) < 0.995) return false;
    const weight = this.weight(position);
    if (weight <= 0) return false;
    const direction = alignment > 0 ? 1 : -1, travel = direction > 0 ? t : this.length - t, step = Math.floor(travel / this.going), phase = travel / this.going - step;
    const swing = smooth((phase - 0.25) / 0.5), stanceRight = ((step % 2 + 2) % 2) !== 0;
    const offset = (STAIR_SHOE_FRONT - STAIR_SHOE_BACK) * height / 2;
    // The largest shoe may overhang the lower tread by a few millimetres; keep its uphill edge off the next riser.
    const downhill = Math.max(0, (STAIR_SHOE_FRONT + STAIR_SHOE_BACK) * height / 2 - this.going / 2) + 0.003;
    const toT = (u: number) => direction > 0 ? u : this.length - u;
    const source = toT((step - 0.5) * this.going), destination = toT((step + 1.5) * this.going);
    const sourceY = this.support(source), destinationY = this.support(destination);
    const stanceY = this.support(toT((step + 0.5) * this.going));
    let clear = Math.max(sourceY, destinationY);
    for (const tread of this.treads) if (tread.max > Math.min(source, destination) && tread.min < Math.max(source, destination)) clear = Math.max(clear, tread.top);
    clear += STAIR_SWING_CLEARANCE;
    // Clear the first riser before translating, then clear the second before the toe/heel crosses it.
    // This avoids throwing the entire two-riser elevation into a very short initial/final lift.
    const early = Math.max(sourceY, stanceY) + STAIR_SWING_CLEARANCE, late = Math.max(destinationY, stanceY) + STAIR_SWING_CLEARANCE;
    const swingY = phase < 0.25 ? sourceY + (early - sourceY) * smooth(phase / 0.25)
      : phase < 0.5 ? early + (clear - early) * smooth((phase - 0.25) / 0.23)
      : phase < 0.75 ? clear + (late - clear) * smooth((phase - 0.52) / 0.23)
      : late + (destinationY - late) * smooth((phase - 0.75) / 0.25);
    let settledSum = 0;
    for (let side = 0; side < 2; side++) {
      const stance = !!side === stanceRight, footT = stance ? toT((step + 0.5) * this.going) : source + (destination - source) * swing;
      const ankleT = footT - direction * offset - downhill;
      const settled = this.support(Math.max(ankleT + direction * STAIR_SHOE_FRONT * height, ankleT - direction * STAIR_SHOE_BACK * height) - 1e-8);
      settledSum += settled;
      const sole = stance ? this.support(footT) : Math.max(settled, settled + (swingY - settled) * activity);
      const flat = guestLegPose(time, speed, height, !!side), o = side * 2;
      out[o] = (1 - weight) * (flat.ankle[0] - GUEST_ANKLE_Y - flat.drop) + weight * (sole - position[1]) / height;
      out[o + 1] = (1 - weight) * flat.ankle[1] + weight * (-direction * (ankleT - t) / height);
    }
    // Blending two different cadences on a level landing must retain a planted support foot.
    if (weight < 1) { const floor = (t < 0 ? this.bottom : this.top) - position[1], lift = Math.min(out[0], out[2]) - floor / height; out[0] -= lift; out[2] -= lift; }
    // The support datum follows planted endpoints, excluding swing clearance and the arbitrary route-root height.
    const movingDatum = (stanceY + sourceY + (destinationY - sourceY) * smooth(phase)) / 2;
    const supportDatum = movingDatum * activity + settledSum * 0.5 * (1 - activity);
    out[4] = weight * (STAIR_PELVIS_FLEX - (supportDatum - position[1]) / height);
    return true;
  }
}

export function compileGuestStairs(park: ParkData): (GuestStairFlight | undefined)[] {
  const parts: ParkPart[][] = park.rides.map(() => []);
  for (const part of park.parts) if (part.walkSurface?.kind === 'tread' && part.shape === 'box' && part.body < 0 && part.solid) parts[part.walkSurface.ride]?.push(part);
  return parts.map(treads => treads.length ? new GuestStairFlight(treads) : undefined);
}

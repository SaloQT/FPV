import { G0 } from '../../sim/math3d';
import { railSample, sampleRail } from './curve';
import { clamp, wrap } from './math';
import type { RideDefinition, RidePhase } from './types';

export const PARK_HZ = 250;
export const PARK_DT = 1 / PARK_HZ;
export interface TrainState {
  s: number;
  v: number;
  acceleration: number;
  drive: number;
  brake: number;
  passengerMass?: number;
  phase: RidePhase;
  phaseTime: number;
  laps: number;
  passengers: number;
  seatIds: Int32Array;
  restraint: number;
  previousS: number;
  previousV: number;
}
export function newTrain(ride: RideDefinition): TrainState {
  return { s: ride.curve ? ride.curve.stationEnd - 6 : 0, v: 0, acceleration: 0, drive: 0, brake: 0, phase: 'boarding', phaseTime: 0, laps: 0, passengers: 0, seatIds: new Int32Array(ride.capacity).fill(-1), restraint: 0, previousS: 0, previousV: 0 };
}

/** A finite train of rail-constrained masses. Every car contributes its actual local slope and losses. */
export class TrainDynamics {
  private readonly sample = railSample();
  constructor(readonly ride: RideDefinition) {}
  mass(passengers: number, payload = passengers * 72): number { return this.ride.cars * this.ride.emptyCarMass + payload; }
  acceleration(s: number, v: number, passengers: number, drive: number, brakes = true, payload?: number, appliedBrake?: number): number {
    const ride = this.ride, curve = ride.curve!, carMass = this.mass(passengers, payload) / ride.cars;
    let f = drive, total = 0;
    for (let i = 0; i < ride.cars; i++) {
      const at = wrap(s - i * ride.carLength, curve.length);
      const p = sampleRail(curve, at, this.sample), t = p.tangent;
      f -= carMass * G0 * t[1];
      const ax = p.curvature[0] * v * v, ay = p.curvature[1] * v * v + G0, az = p.curvature[2] * v * v;
      const normal = Math.hypot(ax, ay, az);
      f -= Math.sign(v) * ride.rolling * carMass * normal;
      f -= 0.5 * 1.225 * ride.dragArea * v * Math.abs(v) / ride.cars;
      total += carMass;
    }
    if (brakes) f += appliedBrake ?? this.brakeForce(s, v, total);
    return f / total;
  }
  private brakeForce(s: number, v: number, total: number): number {
      const ride = this.ride, curve = ride.curve!;
      const at = wrap(s, curve.length), stop = curve.stationEnd - 6;
      if (at >= stop && at < curve.stationEnd + 30) return -Math.min(ride.brakeForce, total * Math.max(0, v * 4));
      // Distributed brake run and station drive tyres: physically bounded stopping controller.
      if (at > curve.brakeStart || at < stop) {
        const remaining = wrap(stop - at, curve.length);
        if (remaining < curve.length * 0.35) {
          const target = Math.min(4, Math.max(0, remaining - 0.05) * 0.65);
          return clamp((target - v) * total * 3.5, -Math.min(ride.brakeForce, total * 3), total * 1.5);
        }
      }
    return 0;
  }
  motorForce(s: number, v: number, passengers: number): number {
    const ride = this.ride, c = ride.curve!, at = wrap(s, c.length);
    if (at > c.liftEnd) return 0;
    const target = ride.liftSpeed, total = this.mass(passengers);
    const powerLimit = ride.motorPower / Math.max(Math.abs(v), 0.5);
    return clamp(total * (target - v) * 5 + total * G0 * 0.45, 0, Math.min(ride.motorForce, powerLimit));
  }
  step(train: TrainState, dt: number, powered = true, brakes = true): void {
    train.previousS = train.s; train.previousV = train.v;
    const total = this.mass(train.passengers, train.passengerMass);
    const target = powered && train.phase !== 'braking' ? this.motorForce(train.s, train.v, train.passengers) : 0;
    // Motor current and brake pressure have finite slew: no acceleration discontinuity at a block boundary.
    train.drive += clamp(target - train.drive, -total * dt * 10, total * dt * 10);
    const brake = brakes ? this.brakeForce(train.s, train.v, total) : 0;
    train.brake += clamp(brake - train.brake, -total * dt * 12, total * dt * 12);
    const s = train.s, v = train.v, drive = train.drive, mass = train.passengers, payload = train.passengerMass;
    const a1 = this.acceleration(s, v, mass, drive, brakes, payload, train.brake);
    const a2 = this.acceleration(s + v * dt / 2, v + a1 * dt / 2, mass, drive, brakes, payload, train.brake);
    const a3 = this.acceleration(s + (v + a1 * dt / 2) * dt / 2, v + a2 * dt / 2, mass, drive, brakes, payload, train.brake);
    const a4 = this.acceleration(s + (v + a2 * dt / 2) * dt, v + a3 * dt, mass, drive, brakes, payload, train.brake);
    train.s += dt * (v + 2 * (v + a1 * dt / 2) + 2 * (v + a2 * dt / 2) + (v + a3 * dt)) / 6;
    train.v += dt * (a1 + 2 * a2 + 2 * a3 + a4) / 6;
    train.acceleration = (a1 + 2 * a2 + 2 * a3 + a4) / 6;
    // The chain pawl is a unilateral constraint, not an injected forward speed.
    if (powered && wrap(train.s, this.ride.curve!.length) < this.ride.curve!.liftEnd && train.v < 0) train.v = 0;
  }
  energy(train: TrainState): number {
    const mass = this.mass(train.passengers, train.passengerMass), car = mass / this.ride.cars;
    let e = 0.5 * mass * train.v * train.v;
    for (let i = 0; i < this.ride.cars; i++) e += car * G0 * sampleRail(this.ride.curve!, train.s - i * this.ride.carLength, this.sample).pos[1];
    return e;
  }
}

/** The generation preflight uses exactly the same force solver as the running park. */
export function preflightCoaster(ride: RideDefinition): NonNullable<RideDefinition['preflight']> {
  const solver = new TrainDynamics(ride), p = railSample();
  let maxG = 0, maxJerk = 0, minSpeed = Infinity, duration = 0, maxAt = 0, maxSpeed = 0;
  const cycle: number[] = [];
  for (const passengers of [0, ride.capacity]) {
    const train = newTrain(ride); train.phase = 'running'; train.passengers = passengers;
    const start = train.s, end = start + ride.curve!.length;
    let previousForce = [0, 0, 0], lastRecorded = -1;
    for (let tick = 0; tick < PARK_HZ * 240; tick++) {
      if (wrap(train.s, ride.curve!.length) > ride.curve!.brakeStart) train.phase = 'braking';
      solver.step(train, PARK_DT, true, true);
      if (!Number.isFinite(train.s + train.v)) throw new Error(`${ride.name}: non-finite coaster dynamics`);
      if (train.v < -0.1) throw new Error(`${ride.name}: train rolls back outside the lift`);
      if (tick > PARK_HZ * 30 && train.v < 0.01 && train.s < end - 3) throw new Error(`${ride.name}: train stalls at ${wrap(train.s, ride.curve!.length).toFixed(1)} / ${ride.curve!.length.toFixed(1)} (lift ${ride.curve!.liftEnd.toFixed(1)})`);
      const s = sampleRail(ride.curve!, train.s, p);
      const force = [s.curvature[0] * train.v ** 2 + s.tangent[0] * train.acceleration, s.curvature[1] * train.v ** 2 + s.tangent[1] * train.acceleration + G0, s.curvature[2] * train.v ** 2 + s.tangent[2] * train.acceleration];
      if (tick > 5) { const g = Math.hypot(...force) / G0; if (g > maxG) { maxG = g; maxAt = wrap(train.s, ride.curve!.length); } maxSpeed = Math.max(maxSpeed, train.v); maxJerk = Math.max(maxJerk, Math.hypot(force[0] - previousForce[0], force[1] - previousForce[1], force[2] - previousForce[2]) / PARK_DT); }
      previousForce = force;
      if (train.s > ride.curve!.liftEnd + 20 && train.s < ride.curve!.brakeStart) minSpeed = Math.min(minSpeed, train.v);
      const seconds = (tick + 1) * PARK_DT;
      if (passengers > 0 && seconds - lastRecorded >= 0.1) { cycle.push(seconds, train.s, train.v); lastRecorded = seconds; }
      if (train.s >= end - 0.1 || (train.s > end - 2 && train.v < 0.3)) { duration = Math.max(duration, seconds); break; }
      if (tick === PARK_HZ * 240 - 1) throw new Error(`${ride.name}: coaster cannot complete its circuit`);
    }
  }
  return { duration, maxG, maxJerk, minSpeed, maxAt, maxSpeed, cycle: new Float64Array(cycle) };
}

import type { Quat, Vec3 } from '../../contracts';
import { G0 } from '../../sim/math3d';
import { Crowd, GuestMode } from './crowd';
import { GUEST_SEAT_PAN_FRONT, GUEST_SEAT_Y, GUEST_SWING_PAN_FRONT, GUEST_TRANSFER_SECONDS, GUEST_TURN_RATE, GUEST_WALK_ACCEL, guestContactLeg, guestSeatAngle, guestTransferLift } from './guestPose';
import { compileGuestStairs, STAIR_HEADWAY, type GuestStairFlight } from './guestStairs';
import { ParkCollision } from './collision';
import type { ChassisSolution } from './coasterChassis';
import { trainChassisSolution, solveTrainChassis, type TrainChassisSolution } from './coasterTrain';
import { add, axisAngle, basisQuat, clamp, cross, inverseRotate, mul, pose, qmul, rotate, smooth, TAU, wrap, yawPoint } from './math';
import { CAROUSEL_MOUNT, CAROUSEL_WITHERS, shipSeat, carouselLift, COASTER_FLOOR, COASTER_SEAT, coasterBogiePivot, coasterCouplerHeight, coasterSeatHeight, SEAT_PAN, SWING_ANCHOR, SWING_CHAIN, TEACUP_BASE, TEACUPS, teacupSeatAngle, WHEEL_HINGE, WHEEL_SEAT } from './rideDimensions';
import { newTrain, PARK_DT, TrainDynamics, type TrainState } from './ridePhysics';
import { SCRAMBLER, dockAngle, enterpriseCabinOverSlot,ENTERPRISE_BOOM, ENTERPRISE_PIVOT, ENTERPRISE_RAM_FOOT, ENTERPRISE_RAM_HEAD, ENTERPRISE_HINGE, ENTERPRISE_RADIUS, enterpriseBoomPoint, pivotPendulumAcceleration, rotaryAcceleration, stepEnterpriseHinges, TOPSPIN_ARM, TOPSPIN_COM, TOPSPIN_PLATFORM_DROP, TOPSPIN_PIVOT } from './flatPhysics';
import type { BodyPose, ParkData, RideDefinition, RidePhase } from './types';
import { PAVING_RISE } from './surfaces';
import { ENTERPRISE_CABIN_FLOOR, ENTERPRISE_CABIN_SEATS, ENTERPRISE_SEAT_Y, topSpinSeatX } from './newFlatAssets';

export interface RideState {
  phase: RidePhase; phaseTime: number; theta: number; omega: number; phi: number; phiV: number; y: number; vy: number; verticalA: number;
  previousTheta: number; previousPhi: number; previousY: number; dock: number;
  angularA: number; tiltA: number; hinges: Float64Array; hingeV: Float64Array; previousHinges: Float64Array; previousRestraints: Float64Array;
  trains: TrainState[]; solver: TrainDynamics | null; completed: number;
}

/** Authoritative multi-rate simulation. Neither camera distance nor render resolution enters this class. */
export class ParkRuntime {
  readonly crowd: Crowd;
  readonly rides: RideState[];
  readonly bodies: BodyPose[];
  readonly previousBodies: BodyPose[];
  readonly collision: ParkCollision;
  elapsed = 0;
  private elapsedCompensation = 0;
  tick = 0;
  renderTime = 0;
  alpha = 0;
  drone: Vec3 | null = null;
  private readonly trainFrames: (TrainChassisSolution | null)[][];
  private readonly trainFramesAt: Float64Array[];
  private readonly trainFramesCount: Uint16Array[];
  private readonly seatPose = pose();
  private readonly seatBody = pose();
  private readonly local: Vec3 = [0, 0, 0];
  private readonly transitionStage: Int16Array;
  /** Current pace of each guest on a boarding or exit path, metres per second; negative until the walk starts. */
  private readonly walkSpeed: Float64Array;
  private readonly releaseStage: Uint8Array;
  private readonly seatBodies: Int32Array[];
  /** Seats in the order guests fill them; Enterprise cabins hanging over the boom slot have no deck to board from. */
  private readonly boardingOrder: number[][];
  private readonly boardingPaths: Vec3[][];
  private readonly transferProgress: Float64Array;
  private readonly transferOrigin: Float64Array;
  private readonly transferRotation: Float64Array;
  private readonly stairFlights: (GuestStairFlight | undefined)[];
  private readonly stairContacts = new Float64Array(8);
  private nextGuest = 0;
  private readonly interpolatedBodies: BodyPose[];
  private readonly interpolatedStamp: Uint32Array;
  private poseEpoch = 0;
  private poseTick = -1;
  private poseAlpha = -1;

  constructor(readonly park: ParkData) {
    this.crowd = new Crowd(park);
    this.stairFlights = compileGuestStairs(park);
    this.transitionStage = new Int16Array(this.crowd.count);
    this.walkSpeed = new Float64Array(this.crowd.count).fill(-1);
    this.releaseStage = new Uint8Array(this.crowd.count).fill(1);
    this.boardingPaths = Array.from({ length: this.crowd.count }, () => []);
    this.transferProgress = new Float64Array(this.crowd.count);
    this.transferOrigin = new Float64Array(this.crowd.count * 3);
    this.transferRotation = new Float64Array(this.crowd.count * 4);
    this.seatBodies = park.rides.map(r => {
      const ids = new Int32Array(r.capacity * r.trains), definitions = park.bodies;
      for (let train = 0; train < r.trains; train++) for (let seat = 0; seat < r.capacity; seat++) {
        const role = r.curve ? 'car' : r.family === 'wheel' || r.family === 'enterprise' || r.family === 'topspin' || r.family === 'ship' || r.family === 'pendulum' ? 'gondola' : r.family === 'teacups' || r.family === 'scrambler' ? 'cup' : r.family === 'drop' || r.family === 'observation' ? 'tower' : 'seat';
        const index = r.family === 'scrambler' ? Math.floor(seat / 2) : r.curve || r.family === 'wheel' || role === 'cup' ? Math.floor(seat / 4) : r.family === 'enterprise' ? Math.floor(seat / 2) : role === 'seat' ? seat : 0;
        ids[train * r.capacity + seat] = r.bodies.find(i => definitions[i].role === role && definitions[i].index === index && (!r.curve || definitions[i].train === train)) ?? r.bodies[0];
      }
      return ids;
    });
    this.boardingOrder = park.rides.map(r => Array.from({ length: r.capacity }, (_, seat) => seat).filter(seat => r.family !== 'enterprise' || !enterpriseCabinOverSlot(Math.floor(seat / 2))));
    this.bodies = park.bodies.map(() => pose()); this.previousBodies = park.bodies.map(() => pose());
    this.trainFrames = park.rides.map(r => Array.from({ length: r.trains }, () => r.curve ? trainChassisSolution(r.cars) : null));
    this.trainFramesAt = park.rides.map(r => new Float64Array(r.trains).fill(NaN));
    this.trainFramesCount = park.rides.map(r => new Uint16Array(r.trains));
    this.interpolatedBodies = park.bodies.map(() => pose()); this.interpolatedStamp = new Uint32Array(park.bodies.length);
    this.rides = park.rides.map(r => ({ phase: 'boarding', phaseTime: 0, theta: r.family === 'wheel' ? -Math.PI / 2 : 0, omega: 0, phi: 0, phiV: 0, y: r.family === 'swings' ? 5.6 : 2, vy: 0, verticalA: 0, previousTheta: 0, previousPhi: 0, previousY: 2, dock: 0,
      angularA: 0, tiltA: 0, hinges: new Float64Array(r.family === 'enterprise' ? 20 : 0), hingeV: new Float64Array(r.family === 'enterprise' ? 20 : 0), previousHinges: new Float64Array(r.family === 'enterprise' ? 20 : 0), previousRestraints: new Float64Array(r.trains),
      trains: Array.from({ length: r.trains }, () => newTrain(r)), solver: r.curve ? new TrainDynamics(r) : null, completed: 0 }));
    // Seed a coherent operating snapshot: real preflight states supply moving trains, unique guests supply their load.
    for (const r of park.rides) {
      const state = this.rides[r.id];
      for (let t = 0; t < state.trains.length; t++) {
        const train = state.trains[t];
        const operating = r.curve ? t === state.trains.length - 1 : r.id % 3 !== 0;
        if (!operating || this.nextGuest >= this.crowd.count) continue;
        const order = this.boardingOrder[r.id], seats = Math.min(order.length, this.crowd.count - this.nextGuest);
        for (let seat = 0; seat < seats; seat++) this.assign(this.nextGuest++, r.id, t, order[seat], true);
        train.passengers = seats;
        train.restraint = 1;
        if (r.curve && r.preflight) {
          const c = r.preflight.cycle, offset = Math.floor((0.25 + (r.id % 5) * 0.09) * (c.length / 3 - 1)) * 3;
          train.s = c[offset + 1]; train.v = c[offset + 2]; train.phase = 'running'; train.phaseTime = c[offset];
        } else { state.phase = 'running'; state.omega = r.targetOmega; state.phaseTime = r.duration * 0.3; state.phi = r.family === 'ship' || r.family === 'pendulum' ? 0.6 : 0; state.y = r.family === 'drop' || r.family === 'observation' ? r.height * 0.6 : r.family === 'swings' ? r.height : 2;
          if (r.family === 'enterprise') state.hinges.fill(Math.atan(r.targetOmega ** 2 * ENTERPRISE_RADIUS / G0));
        }
      }
      // Every train still standing at the station stop is the first in line; each further one waits on the brake run behind it,
      // a train length plus the block gap back from the one in front, which is where the block system would hold it.
      if (r.curve) {
        const curve = r.curve, stop = curve.stationEnd - 6, length = r.cars * r.carLength;
        let ahead = 0;
        for (const train of state.trains) {
          if (train.phase !== 'boarding' || train.s !== stop) continue;
          if (ahead > 0) { train.s = wrap(stop - ahead * (length + 30), curve.length); train.phase = 'braking'; }
          ahead++;
        }
      }
    }
    for (const state of this.rides) this.copyCoordinates(state);
    this.updateBodies(); for (const b of this.bodies) { b.vel.fill(0); b.omega.fill(0); } this.copyBodies(); this.updateRiders(0); this.crowd.previous.set(this.crowd.pos); this.crowd.reindex();
    this.collision = new ParkCollision(this);
  }
  private assign(guest: number, ride: number, train: number, seat: number, immediately = false): void {
    const c = this.crowd, t = this.rides[ride].trains[train];
    t.seatIds[seat] = guest; c.mode[guest] = immediately ? GuestMode.Riding : GuestMode.Boarding; c.ride[guest] = ride; c.train[guest] = train; c.seat[guest] = seat; c.transition[guest] = 0;
    this.transferProgress[guest] = c.seatBlend[guest] = c.previousSeatBlend[guest] = immediately ? 1 : 0;
    t.passengerMass = (t.passengerMass ?? 0) + c.mass[guest];
    this.transitionStage[guest] = 0; this.walkSpeed[guest] = -1;
    const r = this.park.rides[ride], stair = this.stairFlights[ride], path = r.boarding.map(p => stair ? stair.routePoint(p, 1) : [...p] as Vec3);
    if (stair) path.unshift(stair.lead());
    c.stairActivity[guest] = c.previousStairActivity[guest] = 1;
    const clearance = r.curve ? r.family === 'inverted' ? 1.1 : COASTER_SEAT - COASTER_FLOOR : r.family === 'teacups' ? TEACUPS.seatY + SEAT_PAN - TEACUPS.floorTop : r.family === 'scrambler' ? SCRAMBLER.seatY + SEAT_PAN - 2 * SCRAMBLER.floorHalf : r.family === 'wheel' ? WHEEL_SEAT + SEAT_PAN + 0.6 : r.family === 'ship' || r.family === 'pendulum' ? 0.7 + SEAT_PAN - 0.45 : r.family === 'drop' || r.family === 'observation' ? 0.7 + SEAT_PAN - 0.35 : r.family === 'swings' ? 0.55 : r.family === 'topspin' ? -0.85 + SEAT_PAN + 0.98 : r.family === 'enterprise' ? ENTERPRISE_SEAT_Y + SEAT_PAN - ENTERPRISE_CABIN_FLOOR : 1.81;
    c.seatAngle[guest] = guestSeatAngle(c.height[guest], clearance); c.straddle[guest] = r.family === 'carousel' ? 1 : 0; c.seatFront[guest] = r.family === 'swings' ? GUEST_SWING_PAN_FRONT : GUEST_SEAT_PAN_FRONT;
    if (r.family === 'enterprise') {
      const destination = Math.floor(seat / 2) * TAU / 20, delta = wrap(destination - Math.PI / 2 + Math.PI, TAU) - Math.PI;
      const steps = Math.max(1, Math.ceil(Math.abs(delta) / 0.25));
      for (let i = 0; i <= steps; i++) { const a = Math.PI / 2 + delta * i / steps; path.push(yawPoint(r.pos, r.yaw, [Math.cos(a) * 9.9, 1.3, Math.sin(a) * 9.9])); }
    }
    if (r.curve && r.family !== 'inverted') path.push([0, 0, 0], [0, 0, 0]);
    this.releaseStage[guest] = r.curve && r.family !== 'inverted' ? 2 : 1;
    path.push([0, 0, 0]); this.boardingPaths[guest] = path;
    c.vel[guest * 3] = c.vel[guest * 3 + 2] = 0;
  }
  advance(dt: number): void {
    if (!(dt > 0) || !Number.isFinite(dt)) return;
    // Compensated time accumulation prevents a repeated exact fixed step from
    // occasionally executing zero or two ride ticks after tens of seconds.
    const increment = dt - this.elapsedCompensation, elapsed = this.elapsed + increment;
    this.elapsedCompensation = (elapsed - this.elapsed) - increment; this.elapsed = elapsed;
    // Bracketing fixed states allow collision sampling at every quad substep, including arbitrary physics rates.
    while (this.tick * PARK_DT < this.elapsed - 1e-12 * Math.max(1, this.elapsed)) this.step();
    this.alpha = clamp((this.elapsed - (this.tick - 1) * PARK_DT) / PARK_DT, 0, 1);
  }
  present(quadAlpha: number, quadDt: number): void { this.renderTime = Math.max(0, this.elapsed - quadDt + quadAlpha * quadDt); }
  private copyBodies(): void {
    for (let i = 0; i < this.bodies.length; i++) {
      const p = this.previousBodies[i], b = this.bodies[i];
      for (let k = 0; k < 3; k++) { p.pos[k] = b.pos[k]; p.vel[k] = b.vel[k]; p.omega[k] = b.omega[k]; }
      for (let k = 0; k < 4; k++) p.rot[k] = b.rot[k];
    }
  }
  private copyCoordinates(s: RideState): void {
    s.previousTheta = s.theta; s.previousPhi = s.phi; s.previousY = s.y; s.previousHinges.set(s.hinges);
    for (let i = 0; i < s.trains.length; i++) { const train = s.trains[i]; train.previousS = train.s; train.previousV = train.v; s.previousRestraints[i] = train.restraint; }
  }
  private step(): void {
    this.copyBodies();
    if (this.tick % 10 === 0) this.crowd.steer(0.04, this.drone);
    if (this.tick % 250 === 0) this.crowd.decide(1);
    for (const r of this.park.rides) {
      const s = this.rides[r.id]; this.copyCoordinates(s);
      if (r.curve) for (let t = 0; t < s.trains.length; t++) this.stepTrain(r, s, s.trains[t], t);
      else this.stepFlat(r, s);
    }
    this.crowd.move(PARK_DT); this.updateBodies(); this.updateRiders(PARK_DT); this.tick++;
  }
  private board(r: RideDefinition, train: TrainState, t: number, phaseTime: number, limit = r.capacity): boolean {
    const queue = this.crowd.queue[r.id], order = this.boardingOrder[r.id]; limit = Math.min(limit, order.length);
    const head = queue[0], c = this.crowd, headReady = head !== undefined && c.queueProgress[head] < 0.5 && Math.hypot(c.pos[head * 3] - r.queue[0][0], c.pos[head * 3 + 2] - r.queue[0][2]) < 1;
    if (train.passengers < limit && headReady && Math.floor(phaseTime / 0.65) > train.passengers) {
      const guest = queue.shift()!; this.assign(guest, r.id, t, order[train.passengers]); train.passengers++;
    }
    let seated = true; for (const id of train.seatIds) if (id >= 0 && this.crowd.mode[id] !== GuestMode.Riding) seated = false;
    return seated && (train.passengers >= order.length || (phaseTime > 15 && train.passengers > 0) || phaseTime > 24);
  }
  private unload(r: RideDefinition, train: TrainState, dt: number): boolean {
    train.restraint = Math.max(0, train.restraint - dt / (r.family === 'topspin' ? 4 : 2));
    if (train.restraint > 0) return false;
    train.phaseTime += dt;
    if (train.phaseTime >= 0.35 && train.passengers > 0) {
      train.phaseTime = 0;
      const dock = this.rides[r.id].dock;
      const seat = train.seatIds.findIndex((id, index) => id >= 0 && this.crowd.mode[id] === GuestMode.Riding && (r.family !== 'wheel' || Math.floor(index / 4) === dock)), id = train.seatIds[seat];
      if (id >= 0) {
        const c = this.crowd, seatPose = this.guestSeat(id, this.seatPose), staging = this.guestStagingPoint(id, seatPose);
        this.captureTransfer(id, seatPose, staging, seatPose.rot);
        c.mode[id] = GuestMode.Exit; c.transition[id] = 0; this.transitionStage[id] = 0; this.walkSpeed[id] = -1;
        this.transferProgress[id] = c.seatBlend[id] = 1;
        const path = this.boardingPaths[id]; this.updateEntryPoints(id, path);
        const stair = this.stairFlights[r.id];
        this.boardingPaths[id] = path.slice(0, -1).reverse().map(p => stair ? stair.routePoint(p, -1) : p).concat(r.exit);
      }
    }
    return train.passengers === 0;
  }
  private stepTrain(r: RideDefinition, state: RideState, t: TrainState, index: number): void {
    t.phaseTime += PARK_DT;
    const curve = r.curve!;
    if (t.phase === 'boarding') { if (this.board(r, t, index, t.phaseTime)) { t.phase = 'restraints'; t.phaseTime = 0; } return; }
    if (t.phase === 'restraints') { t.restraint = Math.min(1, t.phaseTime / 2); if (t.phaseTime > 2) { t.phase = 'dispatch'; t.phaseTime = 0; } return; }
    if (t.phase === 'unloading') { if (this.unload(r, t, PARK_DT)) { t.phase = 'boarding'; t.phaseTime = 0; t.restraint = 0; } return; }
    if (t.phase === 'dispatch') {
      const clear = state.trains.every(other => other === t || wrap(other.s - t.s, curve.length) > Math.max(curve.length / 3, r.cars * r.carLength + 30));
      if (!clear) return; t.phase = 'running'; t.phaseTime = 0;
    }
    // Braking blocks reserve a stopping-distance margin behind the preceding complete train.
    let emergency = false;
    for (const other of state.trains) if (other !== t) {
      const gap = wrap(other.s - t.s, curve.length) - r.cars * r.carLength;
      if (gap < Math.max(25, t.v * t.v / 5 + 12)) emergency = true;
    }
    state.solver!.step(t, PARK_DT, !emergency, true);
    if (emergency) t.v = Math.max(0, t.v - Math.min(r.brakeForce / state.solver!.mass(t.passengers), 5) * PARK_DT);
    const at = wrap(t.s, curve.length), stop = curve.stationEnd - 6;
    if (at > curve.brakeStart) t.phase = 'braking';
    if (t.phase === 'braking' && at >= stop - 1.2 && at < curve.stationEnd + 30 && Math.abs(t.v) < 0.8) {
      t.v = 0; t.phase = 'unloading'; t.phaseTime = 0; t.laps++; state.completed++;
    }
  }
  private stepFlat(r: RideDefinition, s: RideState): void {
    const t = s.trains[0]; s.phaseTime += PARK_DT;
    const wheel = r.family === 'wheel';
    if (wheel && s.phase === 'boarding' && t.passengers >= (s.dock + 1) * 4 && t.seatIds.every(id => id < 0 || this.crowd.mode[id] === GuestMode.Riding)) s.dock = Math.min(11, s.dock + 1);
    if (wheel && s.phase === 'unloading') { const first = t.seatIds.findIndex(id => id >= 0); if (first >= 0) s.dock = Math.floor(first / 4); }
    const dockError = wrap(-Math.PI / 2 - s.dock * TAU / 12 - s.theta + Math.PI, TAU) - Math.PI;
    const docked = !wheel || Math.abs(dockError) < 0.004 && Math.abs(s.omega) < 0.006;
    if (s.phase === 'boarding') { if (docked && this.board(r, t, 0, s.phaseTime, wheel ? (s.dock + 1) * 4 : r.capacity)) { s.phase = 'restraints'; s.phaseTime = 0; } }
    else if (s.phase === 'restraints') { const seconds = r.family === 'topspin' ? 4 : 2; t.restraint = Math.min(1, s.phaseTime / seconds); if (s.phaseTime > seconds) { s.phase = 'running'; s.phaseTime = 0; } }
    else if (s.phase === 'running' && s.phaseTime > r.duration) { s.phase = 'braking'; s.phaseTime = 0; }
    else if (s.phase === 'unloading') { if (docked && this.unload(r, t, PARK_DT)) { s.phase = 'boarding'; s.phaseTime = 0; t.restraint = 0; s.dock = 0; } }
    const running = s.phase === 'running', braking = s.phase === 'braking';
    const payload = t.passengerMass ?? t.passengers * 72;
    const inertia = r.inertia + payload * (r.family === 'enterprise' ? ENTERPRISE_RADIUS ** 2 : r.family === 'topspin' ? TOPSPIN_ARM ** 2 : r.radius * r.radius * 0.5);
    const target = running ? r.targetOmega : r.family === 'enterprise' && s.phi > 0.025 ? r.targetOmega : r.family === 'topspin' || r.family === 'enterprise' ? clamp(dockAngle(s.theta) * 0.75, -0.35, 0.35) : wheel && (s.phase === 'boarding' || s.phase === 'unloading') ? clamp(dockError * 0.6, -0.12, 0.12) : 0;
    const gravityTorque = r.family === 'topspin' ? -(1800 + payload) * G0 * TOPSPIN_ARM * Math.sin(s.theta) : 0;
    const drivePower = r.motorPower * (r.family === 'topspin' ? 0.8 : r.family === 'enterprise' ? 0.65 : 1);
    const acceleration = rotaryAcceleration(s.omega, target, inertia, r.motorTorque, drivePower, gravityTorque);
    const smoothA = s.angularA + clamp(acceleration - s.angularA, -0.6 * PARK_DT, 0.6 * PARK_DT);
    const requestedTorque = (smoothA + s.omega * 0.018) * inertia - gravityTorque;
    const driveLimit = requestedTorque * s.omega > 0 ? Math.min(r.motorTorque, drivePower / Math.max(Math.abs(s.omega), 0.1)) : r.motorTorque;
    s.angularA = (clamp(requestedTorque, -driveLimit, driveLimit) + gravityTorque) / inertia - s.omega * 0.018;
    s.omega += s.angularA * PARK_DT; s.theta += s.omega * PARK_DT;
    if (r.family === 'enterprise') {
      // Keep centrifugal support while lowering; stop only after the disk is level.
      const targetTilt = running && Math.abs(s.omega) > 1.15 ? 1.48 : 0;
      // Boom-plus-wheel mass at the wheel centre, plus the disk turning about a diameter.
      const tiltInertia = (9000 + payload) * (ENTERPRISE_BOOM[1] ** 2 + ENTERPRISE_BOOM[2] ** 2 + 0.5 * ENTERPRISE_RADIUS ** 2);
      const gravity = -(9000 + payload) * G0 * (enterpriseBoomPoint(s.phi, ENTERPRISE_BOOM)[2] - ENTERPRISE_PIVOT[2]);
      const requested = ((targetTilt - s.phi) * 0.25 - s.phiV * 0.95) * tiltInertia - gravity;
      // Lowering dissipates potential energy through the hydraulic brake; it
      // must not lose holding torque when the pump's input-power cap is reached.
      const actuatorLimit = requested * s.phiV > 0 ? Math.min(1400000, r.motorPower * 0.35 / Math.max(Math.abs(s.phiV), 0.01)) : 1400000;
      const a = clamp((clamp(requested, -actuatorLimit, actuatorLimit) + gravity) / tiltInertia, -0.055, 0.055);
      s.tiltA += clamp(a - s.tiltA, -0.12 * PARK_DT, 0.12 * PARK_DT);
      s.phiV += s.tiltA * PARK_DT; s.phi += s.phiV * PARK_DT;
      stepEnterpriseHinges(s, PARK_DT, running ? 0.65 : 1.8);
    } else if (r.family === 'topspin') {
      const pivotAY = TOPSPIN_ARM * (Math.cos(s.theta) * s.omega ** 2 + Math.sin(s.theta) * s.angularA);
      const pivotAZ = TOPSPIN_ARM * (Math.sin(s.theta) * s.omega ** 2 - Math.cos(s.theta) * s.angularA);
      const freeA = pivotPendulumAcceleration(s.phi, s.phiV, pivotAY, pivotAZ, TOPSPIN_COM, 0.55, 0.13);
      const part = s.phaseTime % 26, engaged = !running || part < 8 || part > 20;
      const targetAngle = running && part < 8 ? s.theta : 0, targetV = running && part < 8 ? s.omega : 0;
      const gondolaInertia = (2200 + payload) * (TOPSPIN_COM ** 2 + 0.55 ** 2);
      const command = (dockAngle(s.phi - targetAngle) * 5.5 + (targetV - s.phiV) * 3.8 - freeA) * gondolaInertia;
      const limit = command * s.phiV > 0 ? Math.min(65000, r.motorPower * 0.2 / Math.max(Math.abs(s.phiV), 0.15)) : 65000;
      s.phiV += (freeA + (engaged ? clamp(command, -limit, limit) / gondolaInertia : 0)) * PARK_DT;
      s.phi += s.phiV * PARK_DT;
    } else if (r.family === 'ship' || r.family === 'pendulum') {
      const desiredAmplitude = running ? r.family === 'ship' ? 0.95 : 1.3 : 0;
      const energy = 0.5 * r.radius * r.radius * s.phiV ** 2 + G0 * r.radius * (1 - Math.cos(s.phi));
      const desiredEnergy = G0 * r.radius * (1 - Math.cos(desiredAmplitude));
      const motor = running ? clamp((desiredEnergy - energy) * 0.008, -1.2, 1.2) * (s.phiV >= 0 ? 1 : -1) : -s.phiV * 2;
      const a = -G0 / r.radius * Math.sin(s.phi) - s.phiV * 0.025 + motor;
      s.phiV += a * PARK_DT; s.phi += s.phiV * PARK_DT;
    } else if (r.family === 'swings') {
      const targetY = running ? r.height : 5.6;
      s.vy += clamp((targetY - s.y) * 0.6 - s.vy * 1.7, -1.1, 1.1) * PARK_DT; s.y += s.vy * PARK_DT;
      const length = SWING_CHAIN, a = s.omega ** 2 * (r.radius * SWING_ANCHOR + length * Math.sin(s.phi)) * Math.cos(s.phi) / length - G0 * Math.sin(s.phi) / length - 0.8 * s.phiV;
      s.phiV += a * PARK_DT; s.phi += s.phiV * PARK_DT;
    } else if (r.family === 'wheel') {
      const a = -G0 / 2.2 * Math.sin(s.phi) - 0.45 * s.phiV + s.omega ** 2 * 0.08;
      s.phiV += a * PARK_DT; s.phi += s.phiV * PARK_DT;
    }
    if (r.family === 'drop' || r.family === 'observation') {
      const mass = 1600 + (t.passengerMass ?? t.passengers * 72);
      let acceleration: number;
      if (!running) acceleration = clamp((2 - s.y) * 0.7 - 2.5 * s.vy, -4, 4);
      else if (r.family === 'observation') { const targetY = s.phaseTime < r.duration * 0.7 ? r.height : 2; acceleration = clamp((targetY - s.y) * 0.3 - 2 * s.vy, -1.4, 1.4); }
      else if (s.phaseTime < r.duration * 0.6) acceleration = clamp((r.height - s.y) * 0.25 - 2 * s.vy, -2, 2);
      else { const brake = s.y < 40 ? clamp(mass * (G0 + s.vy * s.vy / (2 * Math.max(0.02, s.y - 2))) - s.vy * 150, 0, Math.min(r.brakeForce, mass * G0 * 3)) / mass : 0; acceleration = -G0 + brake; }
      s.verticalA += clamp(acceleration - s.verticalA, -50 * PARK_DT, 50 * PARK_DT);
      s.vy += s.verticalA * PARK_DT; s.y += s.vy * PARK_DT;
      if (s.y < 2) { s.y = 2; s.vy = 0; if (running) { s.phase = 'braking'; s.phaseTime = 0; } }
    }
    const mechanismDocked = r.family !== 'enterprise' && r.family !== 'topspin' || Math.abs(dockAngle(s.theta)) < 0.015;
    const hingesDocked = s.hinges.every((angle, i) => Math.abs(dockAngle(angle)) < 0.025 && Math.abs(s.hingeV[i]) < 0.03);
    if (braking && mechanismDocked && hingesDocked && Math.abs(s.omega) < 0.015 && Math.abs(dockAngle(s.phi)) < 0.025 && Math.abs(s.phiV) < 0.03 && (r.family !== 'drop' && r.family !== 'observation' || Math.abs(s.y - 2) < 0.1) && (r.family !== 'swings' || Math.abs(s.y - 5.6) < 0.05 && Math.abs(s.vy) < 0.03)) {
      s.phase = 'unloading'; s.phaseTime = 0; t.phaseTime = 0; s.completed++;
    }
  }
  private trainChassis(ride: number, trainIndex: number, alpha: number, requiredCars: number): TrainChassisSolution {
    const r = this.park.rides[ride], train = this.rides[ride].trains[trainIndex];
    const at = alpha === 1 ? train.s : train.previousS + alpha * (train.s - train.previousS);
    const solution = this.trainFrames[ride][trainIndex]!;
    const previousCount = this.trainFramesAt[ride][trainIndex] === at ? this.trainFramesCount[ride][trainIndex] : 0;
    if (previousCount < requiredCars) {
      solveTrainChassis(r.curve!, at, r.carLength, coasterBogiePivot(r.family), coasterCouplerHeight(r.family), solution, requiredCars, previousCount);
      this.trainFramesAt[ride][trainIndex] = at;
      this.trainFramesCount[ride][trainIndex] = requiredCars;
    }
    return solution;
  }
  private carChassis(index: number, alpha: number): ChassisSolution {
    const def = this.park.bodies[index];
    return this.trainChassis(def.ride, def.train ?? 0, alpha, def.index + 1).cars[def.index];
  }
  /** Forward kinematics is shared by fixed-step physics and presentation/collision sampling.
   * Interpolating independent world poses breaks joints: each child follows a chord while its parent rotates.
   * Generalized angles/distances are unwrapped and interpolated first; every connected frame is then evaluated together. */
  private evaluateBody(index: number, alpha: number, out: BodyPose): void {
    const def = this.park.bodies[index], r = this.park.rides[def.ride], s = this.rides[def.ride];
    const theta = s.previousTheta + alpha * (s.theta - s.previousTheta), phi = s.previousPhi + alpha * (s.phi - s.previousPhi), height = s.previousY + alpha * (s.y - s.previousY);
    const trainIndex = def.train ?? 0, restraint = s.previousRestraints[trainIndex] + alpha * (s.trains[trainIndex].restraint - s.previousRestraints[trainIndex]);
    const base = axisAngle([0, 1, 0], r.yaw);
    let p: Vec3 = [0, 0, 0], q: Quat = base;
    if (def.role === 'car' || def.role === 'bogie') {
      const chassis = this.carChassis(def.role === 'car' ? index : def.parent!, alpha);
      if (def.role === 'car') { p = chassis.body.pos; q = chassis.body.rot; }
      else { const rail = def.index === 0 ? chassis.front : chassis.rear; p = rail.pos; q = basisQuat(cross(rail.tangent, rail.up), rail.up, mul(rail.tangent, -1)); }
    } else if (def.role === 'coupler') {
      const link = this.trainChassis(def.ride, trainIndex, alpha, def.index + 1).couplers[def.index - 1];
      p = link.pos; q = link.rot;
    } else if (def.role === 'restraint') {
      const parent = alpha === 1 ? this.bodies[def.parent!] : this.interpolateBody(def.parent!, alpha), angle = -1.3 * (1 - restraint);
      p = add(parent.pos, rotate(parent.rot, def.local)); q = qmul(def.localRot ? qmul(parent.rot, def.localRot) : parent.rot, axisAngle([1, 0, 0], angle));
    } else if (r.family === 'enterprise') {
      const tilt = axisAngle([1, 0, 0], -phi), center: Vec3 = enterpriseBoomPoint(phi, ENTERPRISE_BOOM);
      if (def.role === 'frame') { p = [...ENTERPRISE_PIVOT]; q = qmul(base, tilt); }
      else if (def.role === 'actuator') {
        const foot: Vec3 = [...ENTERPRISE_RAM_FOOT], top = enterpriseBoomPoint(phi, ENTERPRISE_RAM_HEAD);
        const dy = top[1] - foot[1], dz = top[2] - foot[2], length = Math.hypot(dy, dz), offset = 1.6 + def.index * Math.max(0, length - 3.2) / 2;
        p = [0, foot[1] + dy / length * offset, foot[2] + dz / length * offset]; q = qmul(base, axisAngle([1, 0, 0], Math.atan2(dz, dy)));
      } else if (def.role === 'rotor') { p = center; q = qmul(qmul(base, tilt), axisAngle([0, 1, 0], -theta)); }
      else {
        const a = theta + def.index * TAU / 20;
        const hinge = add(center, rotate(tilt, [Math.cos(a) * ENTERPRISE_RADIUS, 0, Math.sin(a) * ENTERPRISE_RADIUS]));
        const cabin = qmul(qmul(tilt, axisAngle([0, 1, 0], -a)), axisAngle([0, 0, 1], (s.previousHinges[def.index] + alpha * (s.hinges[def.index] - s.previousHinges[def.index]))));
        p = add(hinge, rotate(cabin, [0, -ENTERPRISE_HINGE, 0])); q = qmul(base, cabin);
      }
    } else if (r.family === 'topspin') {
      if (def.role === 'platform') p = [0, -TOPSPIN_PLATFORM_DROP * smooth(restraint), 0];
      else if (def.role === 'rotor') { p = [0, TOPSPIN_PIVOT, 0]; q = qmul(base, axisAngle([1, 0, 0], theta)); }
      else { p = [0, TOPSPIN_PIVOT - TOPSPIN_ARM * Math.cos(theta), -TOPSPIN_ARM * Math.sin(theta)]; q = qmul(base, axisAngle([1, 0, 0], phi)); }
    } else if (r.family === 'wheel') {
      if (def.role === 'rotor') { p = [0, r.radius + 5, 0]; q = qmul(base, axisAngle([0, 0, 1], theta)); }
      else { const a = theta + def.index * TAU / 12, tilt = axisAngle([0, 0, 1], phi); p = add([Math.cos(a) * r.radius, r.radius + 5 + Math.sin(a) * r.radius, 0], rotate(tilt, [0, -WHEEL_HINGE, 0])); q = qmul(base, tilt); }
    } else if (r.family === 'ship' || r.family === 'pendulum') {
      p = def.role === 'rotor' ? [0, r.height, 0] : [Math.sin(phi) * r.radius, r.height - Math.cos(phi) * r.radius, 0];
      q = qmul(base, axisAngle([0, 0, 1], phi)); if (def.role === 'gondola' && r.family === 'pendulum') q = qmul(q, axisAngle([0, 1, 0], theta));
    } else if ((r.family === 'drop' || r.family === 'observation') && (def.role === 'tower' || def.role === 'frame')) { p = [0, height, 0]; if (r.family === 'observation' && def.role === 'tower') q = qmul(base, axisAngle([0, 1, 0], theta)); }
    else if (r.family === 'scrambler' && def.role !== 'rotor') {
      const group = def.role === 'frame' ? def.index : Math.floor(def.index / SCRAMBLER.carsPerUnit), a = theta + group * TAU / SCRAMBLER.units, secondary = -theta * 2.2;
      p = [Math.cos(a) * r.radius * SCRAMBLER.reach, SCRAMBLER.bodyY, Math.sin(a) * r.radius * SCRAMBLER.reach];
      // A car's back (+z) faces its unit pole.
      if (def.role === 'cup') { const c = secondary + (def.index % SCRAMBLER.carsPerUnit) * TAU / SCRAMBLER.carsPerUnit; p[0] += Math.cos(c) * r.radius * SCRAMBLER.offset; p[2] += Math.sin(c) * r.radius * SCRAMBLER.offset; q = qmul(base, axisAngle([0, 1, 0], -c - Math.PI / 2)); }
      else q = qmul(base, axisAngle([0, 1, 0], -secondary));
    }
    else if (r.family === 'teacups' && def.role !== 'rotor') {
      // Small turntables ride the main turntable and turn against it; each cup turns on its own bearing on its table.
      const T = TEACUPS, group = def.role === 'frame' ? def.index : Math.floor(def.index / T.cupsPerTable), a = theta + group * TAU / T.tables, table = theta * T.tableRate;
      p = [Math.cos(a) * r.radius * T.tableReach, 0, Math.sin(a) * r.radius * T.tableReach];
      if (def.role === 'cup') { const c = table + (def.index % T.cupsPerTable) * TAU / T.cupsPerTable; p = [p[0] + Math.cos(c) * T.cupOffset, TEACUP_BASE, p[2] + Math.sin(c) * T.cupOffset]; q = qmul(base, axisAngle([0, 1, 0], -c + theta * 2.2)); }
      else q = qmul(base, axisAngle([0, 1, 0], -table));
    }
    else if (def.role === 'rotor') { q = qmul(base, axisAngle([0, 1, 0], -theta)); if (r.family === 'swings') p[1] = height - r.height; }
    else {
      const count = def.role === 'cup' ? 6 : 16, a = theta + def.index * TAU / count;
      const rr = r.radius * SWING_ANCHOR + (r.family === 'swings' ? SWING_CHAIN * Math.sin(phi) : 0);
      const y = r.family === 'swings' ? height - SWING_CHAIN * Math.cos(phi) : r.family === 'carousel' ? CAROUSEL_MOUNT + carouselLift(theta, def.index) : TEACUP_BASE;
      p = [Math.cos(a) * rr, y, Math.sin(a) * rr]; q = qmul(base, axisAngle([0, 1, 0], -a + (def.role === 'cup' ? theta * 2.2 : Math.PI / 2)));
      if (r.family === 'swings') q = qmul(q, axisAngle([1, 0, 0], -phi));
    }
    if (def.role !== 'car' && def.role !== 'bogie' && def.role !== 'coupler' && def.role !== 'restraint') p = yawPoint(r.pos, r.yaw, p);

    for (let k = 0; k < 3; k++) out.pos[k] = p[k];
    for (let k = 0; k < 4; k++) out.rot[k] = q[k];
  }
  private updateBodies(): void {
    for (let i = 0; i < this.park.bodies.length; i++) {
      const out = this.bodies[i], previous = this.previousBodies[i]; this.evaluateBody(i, 1, out);
      for (let k = 0; k < 3; k++) out.vel[k] = (out.pos[k] - previous.pos[k]) / PARK_DT;
      const prev = previous.rot, dq = qmul(out.rot, [-prev[0], -prev[1], -prev[2], prev[3]]), sign = dq[3] < 0 ? -1 : 1;
      for (let k = 0; k < 3; k++) out.omega[k] = 2 * sign * dq[k] / PARK_DT;
    }
  }
  private interpolateBody(index: number, alpha: number): BodyPose {
    const out = this.interpolatedBodies[index];
    if (this.interpolatedStamp[index] !== this.poseEpoch) {
      this.evaluateBody(index, alpha, out); this.interpolatedStamp[index] = this.poseEpoch;
    }
    return out;
  }
  bodyPose(index: number, time: number, out: BodyPose): BodyPose {
    const alpha = clamp((time - (this.tick - 1) * PARK_DT) / PARK_DT, 0, 1);
    if (this.poseTick !== this.tick || this.poseAlpha !== alpha) {
      this.poseTick = this.tick; this.poseAlpha = alpha; this.poseEpoch = (this.poseEpoch + 1) >>> 0;
      if (this.poseEpoch === 0) { this.interpolatedStamp.fill(0); this.poseEpoch = 1; }
    }
    const b = this.bodies[index], source = alpha === 1 ? b : alpha === 0 ? this.previousBodies[index] : this.interpolateBody(index, alpha);
    for (let k = 0; k < 3; k++) { out.pos[k] = source.pos[k]; out.vel[k] = b.vel[k]; out.omega[k] = b.omega[k]; }
    for (let k = 0; k < 4; k++) out.rot[k] = source.rot[k];
    return out;
  }
  guestSeat(guest: number, out: BodyPose, time?: number): BodyPose {
    const c = this.crowd, ride = this.park.rides[c.ride[guest]], seat = c.seat[guest], train = c.train[guest];
    const id = this.seatBodies[ride.id][train * ride.capacity + seat];
    const b = time === undefined ? this.bodies[id] : this.bodyPose(id, time, this.seatBody); for (let k = 0; k < 4; k++) out.rot[k] = b.rot[k];
    let local: Vec3;
    if (ride.curve) local = [(seat % 2 ? 1 : -1) * 0.47, coasterSeatHeight(ride.family), seat % 4 < 2 ? -0.65 : 0.65];
    else if (ride.family === 'wheel') { local = [(seat % 2 ? 1 : -1) * 0.65, WHEEL_SEAT + SEAT_PAN, seat % 4 < 2 ? -0.5 : 0.5]; if (seat % 4 < 2) out.rot = qmul(out.rot, axisAngle([0, 1, 0], Math.PI)); }
    else if (ride.family === 'enterprise') { const s = ENTERPRISE_CABIN_SEATS[seat % 2]; local = [0, ENTERPRISE_SEAT_Y + SEAT_PAN, s.z]; if (s.yaw) out.rot = qmul(out.rot, axisAngle([0, 1, 0], s.yaw)); }
    else if (ride.family === 'topspin') { local = [topSpinSeatX(seat), -0.85 + SEAT_PAN, seat < 20 ? -0.6 : 0.6]; if (seat >= 20) out.rot = qmul(out.rot, axisAngle([0, 1, 0], Math.PI)); }
    else if (ride.family === 'swings' || ride.family === 'carousel') local = ride.family === 'carousel' ? [0, 0.86, CAROUSEL_WITHERS] : [0, 0.25, 0];
    else if (ride.family === 'ship') { const [x, z] = shipSeat(seat); local = [x, 0.7 + SEAT_PAN, z]; out.rot = qmul(out.rot, axisAngle([0, 1, 0], Math.PI / 2)); }
    else if (ride.family === 'scrambler') local = [(seat % 2 ? 1 : -1) * SCRAMBLER.seatX, SCRAMBLER.seatY + SEAT_PAN, SCRAMBLER.seatZ];
    else { const cup = ride.family === 'teacups', a = cup ? teacupSeatAngle(seat) : seat * TAU / ride.capacity, rr = cup ? TEACUPS.seatRadius : 4.5; local = [Math.cos(a) * rr, (cup ? TEACUPS.seatY : 0.7) + SEAT_PAN, Math.sin(a) * rr]; out.rot = qmul(out.rot, axisAngle([0, 1, 0], cup ? Math.PI / 2 - a : -a - Math.PI / 2)); }
    rotate(b.rot, local, out.pos);
    const rx = out.pos[0], ry = out.pos[1], rz = out.pos[2];
    out.vel[0] = b.vel[0] + b.omega[1] * rz - b.omega[2] * ry; out.vel[1] = b.vel[1] + b.omega[2] * rx - b.omega[0] * rz; out.vel[2] = b.vel[2] + b.omega[0] * ry - b.omega[1] * rx;
    for (let k = 0; k < 3; k++) { out.pos[k] += b.pos[k]; out.omega[k] = b.omega[k]; } return out;
  }
  /** Standing staging point on the station/cabin floor, never the seated mesh origin. */
  private guestStagingPoint(i: number, seat: BodyPose): Vec3 {
    const c = this.crowd, r = this.park.rides[c.ride[i]], deck = r.boarding[r.boarding.length - 1];
    if (r.curve) {
      const body = this.bodies[this.seatBodies[r.id][c.train[i] * r.capacity + c.seat[i]]];
      const target = rotate(body.rot, [(c.seat[i] % 2 ? 1 : -1) * 0.47, COASTER_FLOOR, (c.seat[i] % 4 < 2 ? -0.65 : 0.65) - 0.6]);
      for (let k = 0; k < 3; k++) target[k] += body.pos[k];
      if (r.family === 'inverted') target[1] = deck[1];
      return target;
    }
    const target = rotate(seat.rot, [0, 0, -0.6]);
    for (let k = 0; k < 3; k++) target[k] += seat.pos[k];
    let floor = deck[1];
    if (r.family === 'teacups' || r.family === 'scrambler') {
      const body = this.bodies[this.seatBodies[r.id][c.train[i] * r.capacity + c.seat[i]]];
      // Cup door is +Z; scrambler car entrance is its open front. Approach on the actual supporting surface.
      const local: Vec3 = r.family === 'teacups' ? [0, 0, TEACUPS.wallRadius + TEACUPS.wallHalf + 0.4] : [(c.seat[i] % 2 ? 1 : -1) * SCRAMBLER.seatX, 0, -SCRAMBLER.carHalf[1] - 0.4];
      rotate(body.rot, local, target); for (let k = 0; k < 3; k++) target[k] += body.pos[k];
      target[1] = r.pos[1] + PAVING_RISE;
      if (r.family === 'teacups') {
        // The cup door may open onto its small turntable or onto the main turntable round it.
        const group = Math.floor(Math.floor(c.seat[i] / 4) / TEACUPS.cupsPerTable), table = this.bodies[r.bodies.find(id => this.park.bodies[id].role === 'frame' && this.park.bodies[id].index === group)!];
        target[1] = r.pos[1] + (Math.hypot(target[0] - table.pos[0], target[2] - table.pos[2]) <= TEACUPS.tableRadius ? TEACUPS.tableTop : 0.8);
      }
      return target;
    }
    if (r.family === 'carousel') floor = r.pos[1] + 0.8;
    else if (r.family === 'wheel' || r.family === 'ship' || r.family === 'pendulum' || r.family === 'drop' || r.family === 'observation') {
      const body = this.bodies[this.seatBodies[r.id][c.train[i] * r.capacity + c.seat[i]]];
      const localFloor = r.family === 'wheel' ? -0.6 : r.family === 'ship' || r.family === 'pendulum' ? 0.45 : 0.35;
      const onBody = inverseRotate(body.rot, [target[0] - body.pos[0], target[1] - body.pos[1], target[2] - body.pos[2]]);
      onBody[1] = localFloor; rotate(body.rot, onBody, target);
      for (let k = 0; k < 3; k++) target[k] += body.pos[k];
      floor = target[1];
    }
    target[1] = floor; return target;
  }
  private updateEntryPoints(i: number, path: Vec3[]): void {
    const c = this.crowd, r = this.park.rides[c.ride[i]];
    if (!r.curve || r.family === 'inverted') return;
    const body = this.bodies[this.seatBodies[r.id][c.train[i] * r.capacity + c.seat[i]]], z = (c.seat[i] % 4 < 2 ? -0.65 : 0.65) - 0.6;
    const outside = path[path.length - 3], inside = path[path.length - 2];
    rotate(body.rot, [1.4, 0, z], outside); rotate(body.rot, [0.94, COASTER_FLOOR, z], inside);
    for (let k = 0; k < 3; k++) { outside[k] += body.pos[k]; inside[k] += body.pos[k]; }
    outside[1] = r.boarding[r.boarding.length - 1][1];
  }
  private captureTransfer(i: number, seat: BodyPose, standing: Vec3, rotation: Quat): void {
    const local = inverseRotate(seat.rot, [standing[0] - seat.pos[0], standing[1] - seat.pos[1], standing[2] - seat.pos[2]]);
    this.transferOrigin.set(local, i * 3);
    this.transferRotation.set(qmul([-seat.rot[0], -seat.rot[1], -seat.rot[2], seat.rot[3]], rotation), i * 4);
  }
  /** Attached transfer pose; evaluating the seat at render time preserves a moving assembly's contact. */
  guestTransferPose(i: number, seating: number, out: BodyPose, time?: number): BodyPose {
    this.guestSeat(i, out, time);
    const o = i * 3, q = i * 4, h = this.crowd.height[i], local: Vec3 = [this.transferOrigin[o] * (1 - seating), this.transferOrigin[o + 1] * (1 - seating) - h * GUEST_SEAT_Y * seating + guestTransferLift(seating, h, this.crowd.seatAngle[i]), this.transferOrigin[o + 2] * (1 - seating)];
    rotate(out.rot, local, local); for (let k = 0; k < 3; k++) out.pos[k] += local[k];
    const standing = qmul(out.rot, [...this.transferRotation.subarray(q, q + 4)] as Quat), sign = standing.reduce((sum, v, k) => sum + v * out.rot[k], 0) < 0 ? -1 : 1;
    for (let k = 0; k < 4; k++) out.rot[k] = standing[k] * (1 - seating) + out.rot[k] * sign * seating;
    const norm = Math.hypot(...out.rot); for (let k = 0; k < 4; k++) out.rot[k] /= norm;
    return out;
  }
  /** The same oriented torso capsule is used by drone contact and ray tracing, including inverted riders. */
  guestCapsule(guest: number, a: Vec3, b: Vec3, time = this.elapsed): void {
    const c = this.crowd, o = guest * 3, h = c.height[guest];
    const alpha = clamp((time - (this.tick - 1) * PARK_DT) / PARK_DT, 0, 1), blend = c.previousSeatBlend[guest] + alpha * (c.seatBlend[guest] - c.previousSeatBlend[guest]);
    if (c.mode[guest] === GuestMode.Riding && blend === 1) {
      const seat = this.guestSeat(guest, this.seatPose, time);
      rotate(seat.rot, [0, 0.04, 0], a); rotate(seat.rot, [0, h * 0.4, 0], b);
      for (let k = 0; k < 3; k++) { a[k] += seat.pos[k]; b[k] += seat.pos[k]; }
    } else if (c.seatBlend[guest] > 0 || c.previousSeatBlend[guest] > 0) {
      const transfer = this.guestTransferPose(guest, blend, this.seatPose, time);
      rotate(transfer.rot, [0, 0.27 * (1 - blend) + (h * GUEST_SEAT_Y + 0.04) * blend, 0], a);
      rotate(transfer.rot, [0, h - 0.24 + (0.24 - h * 0.12) * blend, 0], b);
      for (let k = 0; k < 3; k++) { a[k] += transfer.pos[k]; b[k] += transfer.pos[k]; }
    } else {
      for (let k = 0; k < 3; k++) a[k] = b[k] = c.previous[o + k] + alpha * (c.pos[o + k] - c.previous[o + k]);
      if (c.stairFlight[guest] >= 0 && this.guestStairContacts(guest, a, time, this.stairContacts)) {
        const drop = guestContactLeg(this.stairContacts, false, Math.hypot(c.vel[o], c.vel[o + 2])).drop * h; a[1] -= drop; b[1] -= drop;
      }
      a[1] += 0.27; b[1] += h - 0.24;
    }
  }
  guestStairContacts(i: number, position: ArrayLike<number>, time: number, out: Float32Array | Float64Array): boolean {
    const c = this.crowd, flight = this.stairFlights[c.stairFlight[i]], o = i * 3;
    const alpha = clamp((time - (this.tick - 1) * PARK_DT) / PARK_DT, 0, 1), activity = c.previousStairActivity[i] + alpha * (c.stairActivity[i] - c.previousStairActivity[i]);
    return !!flight && flight.contacts(position, c.yaw[i], c.height[i], time + i * 0.71, Math.hypot(c.vel[o], c.vel[o + 2]), out, activity);
  }
  /** Eases a guest on a boarding or exit path up to the cruise pace and, when the path ends at a seat, down to a stop there, so strides grow and shrink and the feet never jump. */
  private rampWalkSpeed(i: number, path: Vec3[], stage: number, cruise: number, dt: number, stopAtEnd: boolean): number {
    const c = this.crowd, o = i * 3;
    if (this.walkSpeed[i] < 0) this.walkSpeed[i] = Math.min(cruise, Math.hypot(c.vel[o], c.vel[o + 2]));
    let target = cruise;
    if (stopAtEnd) {
      let left = 0, x = c.pos[o], y = c.pos[o + 1], z = c.pos[o + 2];
      for (let s = stage; s < path.length; s++) { left += Math.hypot(path[s][0] - x, path[s][1] - y, path[s][2] - z); x = path[s][0]; y = path[s][1]; z = path[s][2]; }
      target = Math.min(cruise, Math.sqrt(2 * GUEST_WALK_ACCEL * Math.max(0, left - 0.015)));
    }
    const step = GUEST_WALK_ACCEL * dt;
    return this.walkSpeed[i] = clamp(target, this.walkSpeed[i] - step, this.walkSpeed[i] + step);
  }
  private walkTransition(i: number, path: Vec3[], dt: number, stopAtEnd = false): boolean {
    const c = this.crowd, o = i * 3, stage = this.transitionStage[i];
    if (stage >= path.length) return true;
    const target = path[stage], dx = target[0] - c.pos[o], dy = target[1] - c.pos[o + 1], dz = target[2] - c.pos[o + 2], length = Math.hypot(dx, dy, dz);
    const flight = this.stairFlights[c.ride[i]], onStairs = flight?.contains(c.pos.subarray(o, o + 3));
    const speed = this.rampWalkSpeed(i, path, stage, onStairs ? 1.5 - 0.85 * flight!.weight(c.pos.subarray(o, o + 3)) : 1.5, dt, stopAtEnd);
    let advance = speed * dt;
    c.previousStairActivity[i] = c.stairActivity[i];
    if (flight && flight.trafficContains(c.pos.subarray(o, o + 3))) {
      const t = flight.project(c.pos.subarray(o, o + 3)), side = flight.lateral(c.pos.subarray(o, o + 3)), direction = dx * flight.forward[0] + dz * flight.forward[2] < 0 ? -1 : 1;
      c.neighbors(c.pos[o], c.pos[o + 2], 2, j => {
        if (j === i || c.ride[j] !== c.ride[i] || c.seatBlend[j] > 0 || c.mode[j] !== GuestMode.Boarding && c.mode[j] !== GuestMode.Exit) return;
        const p = c.pos.subarray(j * 3, j * 3 + 3); if (!flight.trafficContains(p) || Math.abs(flight.lateral(p) - side) > 0.95 || Math.abs(p[1] - c.pos[o + 1]) > 1.5) return;
        // Only a walker going the same way holds this one back. Someone leaving the stair foot sideways counts as going up the flight's axis,
        // so two walkers facing each other 1.55 m apart would otherwise each wait for the other for ever.
        const next = this.boardingPaths[j][this.transitionStage[j]];
        if (next && ((next[0] - p[0]) * flight.forward[0] + (next[2] - p[2]) * flight.forward[2] < 0 ? -1 : 1) !== direction) return;
        const ahead = direction * (flight.project(p) - t);
        if (ahead > 1e-6 || Math.abs(ahead) <= 1e-6 && j < i) advance = Math.min(advance, Math.max(0, ahead - STAIR_HEADWAY));
      });
    }
    const walking = advance > 1e-6 || length < 0.015;
    c.stairActivity[i] = clamp(c.stairActivity[i] + (walking ? 1 : -1) * dt / 0.25, 0, 1);
    // Raise a settled swing shoe before resuming horizontal travel across a riser.
    if (c.stairActivity[i] < 1) advance = 0;
    if (dt > 0) this.walkSpeed[i] = Math.min(this.walkSpeed[i], advance / dt);
    const f = Math.min(1, advance / (length || 1));
    c.pos[o] += dx * f; c.pos[o + 1] += dy * f; c.pos[o + 2] += dz * f;
    if (flight && flight.contains(c.pos.subarray(o, o + 3))) {
      c.stairFlight[i] = c.ride[i];
      const progress = clamp(flight.project(c.pos.subarray(o, o + 3)) / flight.length, 0, 1);
      c.pos[o + 1] = flight.bottom + progress * (flight.top - flight.bottom);
    }
    if (dt > 0) for (let k = 0; k < 3; k++) c.vel[o + k] = (c.pos[o + k] - c.previous[o + k]) / dt;
    if (Math.hypot(dx, dz) > 0.01) { const want = Math.atan2(-dx, -dz), turn = GUEST_TURN_RATE * dt; c.yaw[i] = dt > 0 ? c.yaw[i] + clamp(wrap(want - c.yaw[i] + Math.PI, TAU) - Math.PI, -turn, turn) : want; }
    if (length * (1 - f) < 0.015) { for (let k = 0; k < 3; k++) c.pos[o + k] = target[k]; this.transitionStage[i]++; }
    return this.transitionStage[i] >= path.length;
  }
  private updateRiders(dt: number): void {
    const c = this.crowd;
    for (let i = 0; i < c.count; i++) {
      const mode = c.mode[i]; if (mode === GuestMode.Walk || mode === GuestMode.Queue || mode === GuestMode.Rest) continue;
      c.stairFlight[i] = -1;
      c.transition[i] += dt; const o = i * 3;
      if (mode === GuestMode.Boarding || mode === GuestMode.Riding) {
        const seat = this.guestSeat(i, this.seatPose);
        if (mode === GuestMode.Boarding) {
          const path = this.boardingPaths[i], target = path[path.length - 1];
          if (this.transitionStage[i] < path.length) {
            this.updateEntryPoints(i, path);
            const staging = this.guestStagingPoint(i, seat); for (let k = 0; k < 3; k++) target[k] = staging[k];
            if (this.walkTransition(i, path, dt, true)) { this.captureTransfer(i, seat, target, axisAngle([0, 1, 0], c.yaw[i])); c.vel.fill(0, o, o + 3); }
          } else {
            this.transferProgress[i] = Math.min(1, this.transferProgress[i] + dt / GUEST_TRANSFER_SECONDS); c.seatBlend[i] = smooth(this.transferProgress[i]);
            const transfer = this.guestTransferPose(i, c.seatBlend[i], this.seatPose);
            for (let k = 0; k < 3; k++) { c.pos[o + k] = transfer.pos[k]; c.vel[o + k] = dt > 0 ? (c.pos[o + k] - c.previous[o + k]) / dt : 0; }
            if (this.transferProgress[i] === 1) c.mode[i] = GuestMode.Riding;
          }
        } else {
          // Feet origin puts the procedural seated pelvis on the actual seat.
          rotate(seat.rot, [0, -c.height[i] * GUEST_SEAT_Y, 0], this.local);
          for (let k = 0; k < 3; k++) { c.pos[o + k] = seat.pos[k] + this.local[k]; c.vel[o + k] = seat.vel[k]; }
        }
      } else if (mode === GuestMode.Exit) {
        const r = this.park.rides[c.ride[i]], path = this.boardingPaths[i];
        if (this.transferProgress[i] > 0) {
          this.transferProgress[i] = Math.max(0, this.transferProgress[i] - dt / GUEST_TRANSFER_SECONDS); c.seatBlend[i] = smooth(this.transferProgress[i]);
          const transfer = this.guestTransferPose(i, c.seatBlend[i], this.seatPose);
          for (let k = 0; k < 3; k++) { c.pos[o + k] = transfer.pos[k]; c.vel[o + k] = dt > 0 ? (c.pos[o + k] - c.previous[o + k]) / dt : 0; }
          const forward = rotate(transfer.rot, [0, 0, -1]); c.yaw[i] = Math.atan2(-forward[0], -forward[2]);
        } else {
          const done = this.walkTransition(i, path, dt);
          // Keep the ride interlocked until the guest has reached the fixed landing, beyond the moving cabin.
          if (this.transitionStage[i] >= this.releaseStage[i]) {
            const train = this.rides[r.id].trains[c.train[i]], seat = c.seat[i];
            if (train.seatIds[seat] === i) { train.seatIds[seat] = -1; train.passengers--; train.passengerMass = Math.max(0, (train.passengerMass ?? 0) - c.mass[i]); }
          }
          if (done) { c.mode[i] = GuestMode.Walk; c.stairFlight[i] = -1; c.seat[i] = -1; c.node[i] = r.station; this.crowd.chooseDestination(i); const next = c.nextHop[r.station * this.park.nodes.length + c.goal[i]]; c.target[i] = next >= 0 ? next : this.park.nodes[r.station].links[0]; }
        }
      }
    }
  }
}

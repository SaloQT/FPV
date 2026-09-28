import type { ObstacleCollider, Physics, Quat, QuadState, StickInput, TerrainSampler, Vec3 } from '../contracts';
import { angularDrag, bodyDrag } from './aero';
import { Battery } from './battery';
import { CollisionWorld } from './collision';
import { FlightController } from './fc/controller';
import { ImuSensor } from './imu';
import { G0, Rng, quatIntegrateBody, quatRotate, quatRotateInv, quatSetYaw, quatToMat3 } from './math3d';
import { Motor } from './motor';
import { QUAD_5IN_6S, type QuadConfig } from './presets';
import { Propeller, airDensity, groundEffect } from './propeller';
import { Wind, windDefaults, type WindConfig } from './wind';

const CRASH_HOLD = 1 / 60;
const WIND_DIVIDER = 8;
const NEWTON_ITERATIONS = 3;
const GROUND_EFFECT_REACH = 0.5;
const FAR_CLEARANCE = 2;
const WIND_RAMP_HEIGHT = 8;
const WIND_GROUND_FACTOR = 0.4;
const PACK_WARMTH_C = 10;

/**
 * Full quad model: rigid body, four motor/ESC/propeller units, the flight battery, wind, contacts, the IMU and the
 * Betaflight-style flight controller. `step` advances everything; one call costs about one FC loop iteration.
 */
export class QuadPhysics implements Physics {
  readonly state: QuadState = {
    time: 0,
    pos: [0, 0, 0],
    vel: [0, 0, 0],
    quat: [0, 0, 0, 1],
    angVel: [0, 0, 0],
    motorOmega: [0, 0, 0, 0],
    motorCmd: [0, 0, 0, 0],
    batteryVoltage: 0,
    batteryCurrent: 0,
    batteryMah: 0,
    gForce: [0, 1, 0],
    armed: false,
    onGround: false,
    crashed: false,
    impactSpeed: 0,
  };
  readonly fc: FlightController;
  readonly battery: Battery;
  readonly wind: Wind;
  readonly collision: CollisionWorld;
  readonly imu: ImuSensor;
  readonly motors: Motor[] = [];
  readonly props: Propeller[] = [];
  /** Longest sub-step taken by `step`; longer calls are split evenly. */
  maxSubstep = 1 / 2000;
  /** Number of separate crash events since construction. */
  crashCount = 0;

  private readonly washRng: Rng;
  private readonly washSeed: number;
  private readonly invMass: number;
  private readonly invI: Vec3;
  private readonly rPos = new Float64Array(12);
  private readonly spin = new Float64Array(4);
  private readonly rotorInertia: number;
  private readonly propRadius: number;
  private readonly R = new Float64Array(9);
  private readonly vb: Vec3 = [0, 0, 0];
  private readonly windVel: Vec3 = [0, 0, 0];
  private readonly drag: Vec3 = [0, 0, 0];
  private readonly adrag: Vec3 = [0, 0, 0];
  private readonly fw: Vec3 = [0, 0, 0];
  private readonly accelTrue: Vec3 = [0, G0, 0];
  private readonly torque = new Float64Array(3);
  private readonly alpha1 = new Float64Array(3);
  private readonly alpha2 = new Float64Array(3);
  private readonly zero: Vec3 = [0, 0, 0];
  private readonly restAccel: Vec3 = [0, G0, 0];
  private rotorMomentum = 0;
  private tick = 0;
  private rho = 1.225;
  private baseAltitude = 0;
  private tempC = 15;
  private vBus = 0;
  private groundH = 0;
  private clearance = 0;
  private crashTimer = 0;

  constructor(readonly config: QuadConfig = QUAD_5IN_6S, terrain: TerrainSampler | null = null, seed: number = config.seed) {
    this.washSeed = seed ^ 0x2c1b3c6d;
    this.washRng = new Rng(this.washSeed);
    for (let i = 0; i < 4; i++) {
      this.motors.push(new Motor(config.motor));
      this.props.push(new Propeller(config.prop, this.washRng));
      const p = config.motorPos[i];
      this.rPos[3 * i] = p[0];
      this.rPos[3 * i + 1] = p[1];
      this.rPos[3 * i + 2] = p[2];
      this.spin[i] = config.motorSpin[i];
    }
    this.battery = new Battery(config.battery);
    this.wind = new Wind(seed, windDefaults);
    this.collision = new CollisionWorld(config.collision);
    this.collision.terrain = terrain;
    this.imu = new ImuSensor(config.imu, seed);
    this.fc = new FlightController(config.fc);
    this.invMass = 1 / config.mass;
    this.invI = [1 / config.inertia[0], 1 / config.inertia[1], 1 / config.inertia[2]];
    this.rotorInertia = config.motor.inertia;
    this.propRadius = config.prop.diameter * 0.5;
    this.setAtmosphere(0, 15);
    this.reset([0, 0, 0], 0);
  }

  /** Put the quad at rest, disarmed, on a fresh battery, at `pos` facing `yawRad` (0 faces -Z, positive turns left). */
  reset(pos: Vec3, yawRad: number): void {
    const s = this.state;
    s.pos[0] = pos[0];
    s.pos[1] = pos[1];
    s.pos[2] = pos[2];
    s.vel.fill(0);
    s.angVel.fill(0);
    quatSetYaw(s.quat, yawRad);
    s.time = 0;
    s.motorOmega.fill(0);
    s.motorCmd.fill(0);
    s.armed = false;
    s.onGround = false;
    s.crashed = false;
    s.impactSpeed = 0;
    s.gForce[0] = 0;
    s.gForce[1] = 1;
    s.gForce[2] = 0;
    this.washRng.reseed(this.washSeed);
    for (let i = 0; i < 4; i++) {
      this.motors[i].reset();
      this.props[i].reset();
    }
    this.battery.reset();
    this.wind.reset();
    this.imu.reset();
    this.imu.prime(this.zero, this.restAccel);
    this.fc.reset(s.quat);
    this.collision.motorLoad.fill(0);
    this.accelTrue[0] = 0;
    this.accelTrue[1] = G0;
    this.accelTrue[2] = 0;
    this.vBus = this.battery.emf();
    s.batteryVoltage = this.vBus;
    s.batteryCurrent = 0;
    s.batteryMah = 0;
    this.tick = 0;
    this.crashTimer = 0;
    this.groundH = this.collision.groundHeight(pos[0], pos[2]);
    this.clearance = pos[1] - this.groundH;
    this.refreshDensity();
    this.windVel.fill(0);
  }

  setColliders(colliders: ObstacleCollider[]): void {
    this.collision.setColliders(colliders);
  }

  setTerrain(terrain: TerrainSampler | null): void {
    this.collision.terrain = terrain;
    this.groundH = this.collision.groundHeight(this.state.pos[0], this.state.pos[2]);
  }

  setWind(cfg: Partial<WindConfig>): void {
    const c = this.wind.cfg;
    this.wind.setMean(cfg.meanSpeed ?? c.meanSpeed, cfg.fromDirection ?? c.fromDirection);
    this.wind.setTurbulence(cfg.turbulence ?? c.turbulence, cfg.gustsPerMinute ?? c.gustsPerMinute);
    if (cfg.gustFactor !== undefined) c.gustFactor = cfg.gustFactor;
  }

  /** Altitude of the world's y = 0 plane above sea level (m) and the air temperature (C); the pack sits a little warmer. */
  setAtmosphere(altitudeM: number, tempC: number): void {
    this.baseAltitude = altitudeM;
    this.tempC = tempC;
    this.battery.tempC = tempC + PACK_WARMTH_C;
    this.refreshDensity();
  }

  /** Force the true attitude (and the FC's estimate of it), for tests and scripted starts. */
  setAttitude(q: Quat): void {
    const s = this.state.quat;
    s[0] = q[0];
    s[1] = q[1];
    s[2] = q[2];
    s[3] = q[3];
    this.fc.syncAttitude(s);
  }

  private refreshDensity(): void {
    this.rho = airDensity(this.baseAltitude + this.state.pos[1], this.tempC);
  }

  step(dt: number, input: StickInput): void {
    if (dt > this.maxSubstep + 1e-9) {
      const n = Math.ceil(dt / this.maxSubstep - 1e-9);
      const h = dt / n;
      for (let i = 0; i < n; i++) this.advance(h, input);
    } else {
      this.advance(dt, input);
    }
  }

  private advance(dt: number, input: StickInput): void {
    const s = this.state;
    const pos = s.pos, vel = s.vel, q = s.quat, w = s.angVel;
    const cfg = this.config;
    const coll = this.collision;
    const R = this.R, vb = this.vb, wv = this.windVel;
    if ((this.tick & 31) === 0) this.refreshDensity();
    if (this.clearance < FAR_CLEARANCE || (this.tick & 15) === 0) this.groundH = coll.groundHeight(pos[0], pos[2]);
    this.clearance = pos[1] - this.groundH;
    if (this.tick % WIND_DIVIDER === 0) this.updateWind(dt * WIND_DIVIDER);
    this.tick++;

    quatRotateInv(q, vel[0] - wv[0], vel[1] - wv[1], vel[2] - wv[2], vb);
    quatToMat3(q, R);
    this.imu.sample(dt, w, this.accelTrue, s.motorOmega);
    this.fc.update(dt, input, this.imu.gyro, this.imu.accel, s.motorOmega);
    const v = this.solveBus(dt);

    const rho = this.rho;
    const tq = this.torque;
    let fx = 0, fy = 0, fz = 0, tx = 0, ty = 0, tz = 0, hy = 0, cur = cfg.avionicsCurrent;
    const w0 = w[0], w1 = w[1], w2 = w[2];
    for (let i = 0; i < 4; i++) {
      const rx = this.rPos[3 * i], ry = this.rPos[3 * i + 1], rz = this.rPos[3 * i + 2];
      const m = this.motors[i];
      const prop = this.props[i];
      const vhx = vb[0] + w1 * rz - w2 * ry;
      const vhy = vb[1] + w2 * rx - w0 * rz;
      const vhz = vb[2] + w0 * ry - w1 * rx;
      let ge = 1;
      if (R[4] > 0.2) {
        const z = pos[1] + R[3] * rx + R[4] * ry + R[5] * rz - this.groundH;
        if (z < GROUND_EFFECT_REACH) ge = groundEffect(z, this.propRadius);
      }
      prop.evaluate(m.omega, rho, vhy, ge, dt);
      m.advance(dt, v, prop.torque, coll.motorLoad[i]);
      const thrust = prop.thrust;
      const hx = -prop.hDrag * vhx;
      const hz = -prop.hDrag * vhz;
      const sp = this.spin[i];
      fx += hx;
      fy += thrust;
      fz += hz;
      tx += ry * hz - rz * thrust - prop.flapGain * vhz;
      ty += rz * hx - rx * hz - sp * (this.rotorInertia * m.omegaDot + prop.torque);
      tz += rx * thrust - ry * hx + prop.flapGain * vhx;
      hy += this.rotorInertia * sp * m.omega;
      cur += m.batteryCurrent();
    }
    bodyDrag(cfg.aero, rho, vb[0], vb[1], vb[2], this.drag);
    angularDrag(cfg.aero, w0, w1, w2, this.adrag);
    tq[0] = tx + this.adrag[0];
    tq[1] = ty + this.adrag[1];
    tq[2] = tz + this.adrag[2];
    this.rotorMomentum = hy;

    quatRotate(q, fx + this.drag[0], fy + this.drag[1], fz + this.drag[2], this.fw);
    const v0x = vel[0], v0y = vel[1], v0z = vel[2];
    const k = dt * this.invMass;
    vel[0] += this.fw[0] * k;
    vel[1] += this.fw[1] * k - G0 * dt;
    vel[2] += this.fw[2] * k;
    pos[0] += vel[0] * dt;
    pos[1] += vel[1] * dt;
    pos[2] += vel[2] * dt;
    this.integrateAttitude(dt);

    coll.resolve(dt, this.invMass, this.invI, pos, vel, q, w);
    quatRotateInv(q, (vel[0] - v0x) / dt, (vel[1] - v0y) / dt + G0, (vel[2] - v0z) / dt, this.accelTrue);
    this.battery.step(dt, cur);
    this.publish(dt);
  }

  private updateWind(dt: number): void {
    const s = this.state;
    const vx = s.vel[0] - this.windVel[0], vy = s.vel[1] - this.windVel[1], vz = s.vel[2] - this.windVel[2];
    this.wind.update(dt, Math.sqrt(vx * vx + vy * vy + vz * vz), s.time);
    this.wind.sample(s.pos, s.time, this.windVel);
    const k = WIND_GROUND_FACTOR + (1 - WIND_GROUND_FACTOR) * Math.min(Math.max(this.clearance, 0) / WIND_RAMP_HEIGHT, 1);
    this.windVel[0] *= k;
    this.windVel[1] *= k;
    this.windVel[2] *= k;
  }

  /** Bus voltage where the pack's source-minus-sag equals the terminal voltage the motors see (Newton, warm-started). */
  private solveBus(dt: number): number {
    const b = this.battery;
    const emf = b.emf(), rs = b.seriesResistance();
    const avionics = this.config.avionicsCurrent;
    let v = this.vBus;
    for (let it = 0; it < NEWTON_ITERATIONS; it++) {
      let cur = avionics, slope = 0;
      for (let i = 0; i < 4; i++) {
        const m = this.motors[i];
        if (it === 0) m.updateDuty(dt, this.fc.motors[i]);
        cur += m.busCurrentAt(v);
        slope += m.busSlopeAt(v);
      }
      v -= (v - emf + rs * cur) / (1 + rs * slope);
    }
    if (v < 0) v = 0;
    this.vBus = v;
    return v;
  }

  private angAccel(wx: number, wy: number, wz: number, out: Float64Array): void {
    const I = this.config.inertia, t = this.torque, h = this.rotorMomentum;
    out[0] = (t[0] + wz * h - wy * wz * (I[2] - I[1])) / I[0];
    out[1] = (t[1] - wz * wx * (I[0] - I[2])) / I[1];
    out[2] = (t[2] - wx * h - wx * wy * (I[1] - I[0])) / I[2];
  }

  /** Midpoint (RK2) step of I dw/dt = T - w x (I w) - w x h, then an exact rotation by the mean rate. */
  private integrateAttitude(dt: number): void {
    const w = this.state.angVel;
    const a1 = this.alpha1, a2 = this.alpha2;
    const h = dt * 0.5;
    this.angAccel(w[0], w[1], w[2], a1);
    this.angAccel(w[0] + h * a1[0], w[1] + h * a1[1], w[2] + h * a1[2], a2);
    const n0 = w[0] + dt * a2[0], n1 = w[1] + dt * a2[1], n2 = w[2] + dt * a2[2];
    quatIntegrateBody(this.state.quat, 0.5 * (w[0] + n0), 0.5 * (w[1] + n1), 0.5 * (w[2] + n2), dt);
    w[0] = n0;
    w[1] = n1;
    w[2] = n2;
  }

  private publish(dt: number): void {
    const s = this.state;
    const coll = this.collision;
    s.time += dt;
    const inv = 1 / G0;
    s.gForce[0] = this.accelTrue[0] * inv;
    s.gForce[1] = this.accelTrue[1] * inv;
    s.gForce[2] = this.accelTrue[2] * inv;
    for (let i = 0; i < 4; i++) {
      s.motorOmega[i] = Math.abs(this.motors[i].omega);
      const c = Math.abs(this.fc.motors[i]);
      s.motorCmd[i] = c > 1 ? 1 : c;
    }
    s.batteryVoltage = this.battery.voltage();
    s.batteryCurrent = this.battery.current;
    s.batteryMah = this.battery.mah;
    s.armed = this.fc.armed;
    s.onGround = coll.onGround;
    if (coll.impactSpeed > this.config.collision.crashSpeed) {
      if (!s.crashed) this.crashCount++;
      s.crashed = true;
      if (coll.impactSpeed > s.impactSpeed) s.impactSpeed = coll.impactSpeed;
      this.crashTimer = CRASH_HOLD;
    } else if (s.crashed) {
      this.crashTimer -= dt;
      if (this.crashTimer <= 0) {
        s.crashed = false;
        s.impactSpeed = 0;
      }
    }
  }
}

/** Turns the per-frame quad state into discrete sound events (edges, timers, thresholds). Pure and allocation free. */
import type { QuadState } from '../contracts';
import { clamp, smoothingAlpha, smoothstep } from './dsp';
import { Rng } from './noise';

export type EventInput = Pick<
  QuadState,
  'time' | 'pos' | 'vel' | 'angVel' | 'motorOmega' | 'batteryVoltage' | 'armed' | 'onGround' | 'crashed' | 'impactSpeed'
>;

export interface FlightFlags {
  armed: boolean;
  disarmed: boolean;
  crash: boolean;
  /** Closing speed of the crash in m/s (valid while `crash`). */
  crashSpeed: number;
  /** The crash happened with spinning props, so plastic hits the ground too. */
  propStrike: boolean;
  /** Touchdown too gentle to count as a crash. */
  landing: boolean;
  /** 0..1 loudness of the touchdown. */
  landingLevel: number;
  /** One clack of the tumbling frame. */
  tumble: boolean;
  tumbleLevel: number;
  lowBattery: boolean;
  beacon: boolean;
  /** The state jumped (respawn or time rewound): trackers were re-seeded and no other flag is set. */
  reset: boolean;
}

const LOW_CELL_V = 3.5;
const LOW_CELL_RECOVER_V = 3.65;
const LOW_REPEAT_S = 3;
const VOLTAGE_TAU = 1.5;
const FULL_CELL_V = 4.25;
const BEACON_DELAY_S = 20;
const BEACON_REPEAT_S = 4;
const TELEPORT_M = 50;
const SPIN_OMEGA = 300;
const PROP_STRIKE_SPEED = 3;
const SOFT_LANDING_VY = 1.2;
/** Sink rate that surely exceeds the sim's 4 m/s crash threshold even after the last frame's braking. */
const HARD_LANDING_VY = 5;
const CRASH_DEDUPE_S = 0.3;
const TUMBLE_SPIN = 3;
const TUMBLE_SPEED = 1;

function makeFlags(): FlightFlags {
  return {
    armed: false, disarmed: false, crash: false, crashSpeed: 0, propStrike: false, landing: false, landingLevel: 0,
    tumble: false, tumbleLevel: 0, lowBattery: false, beacon: false, reset: false,
  };
}

export class FlightEvents {
  readonly flags = makeFlags();
  private readonly rng = new Rng(0x51ed);
  private cells = 0;
  private fixedCells = false;
  private started = false;
  private lastTime = 0;
  private prevX = 0;
  private prevY = 0;
  private prevZ = 0;
  private prevVy = 0;
  private prevArmed = false;
  private prevOnGround = false;
  private prevCrashed = false;
  private volts = 0;
  private lowActive = false;
  private lowTimer = 0;
  private tumbleTimer = 0;
  private crashedSinceArm = false;
  private sinceCrash = Infinity;
  private groundIdle = 0;
  private beaconTimer = 0;

  /** Fixes the pack size; without it the cell count is inferred from the highest voltage seen. */
  setCells(n: number): void {
    this.cells = Math.max(1, Math.round(n));
    this.fixedCells = true;
  }

  reset(): void {
    this.started = false;
  }

  update(s: EventInput, dt: number): FlightFlags {
    const f = this.flags;
    f.armed = f.disarmed = f.crash = f.propStrike = f.landing = f.tumble = f.lowBattery = f.beacon = f.reset = false;
    f.crashSpeed = f.landingLevel = f.tumbleLevel = 0;
    const step = clamp(dt, 1e-4, 0.25);
    const pos = s.pos, vel = s.vel;
    const jumped = Math.hypot(pos[0] - this.prevX, pos[1] - this.prevY, pos[2] - this.prevZ) > TELEPORT_M || s.time < this.lastTime - 1e-6;

    if (!this.started || jumped) {
      f.reset = this.started;
      this.seed(s);
      return f;
    }
    this.lastTime = s.time;

    if (s.armed !== this.prevArmed) {
      if (s.armed) {
        f.armed = true;
        this.crashedSinceArm = false;
        this.groundIdle = 0;
      } else {
        f.disarmed = true;
      }
    }

    this.sinceCrash += step;
    if (s.crashed && !this.prevCrashed) {
      this.crash(s, s.impactSpeed > 0 ? s.impactSpeed : 0);
    } else if (s.onGround && !this.prevOnGround && -this.prevVy > SOFT_LANDING_VY) {
      // The sim holds `crashed` for one physics tick only, so a slow frame can miss a hard touchdown.
      if (-this.prevVy > HARD_LANDING_VY && this.sinceCrash > CRASH_DEDUPE_S) {
        this.crash(s, -this.prevVy);
      } else {
        f.landing = true;
        f.landingLevel = smoothstep(SOFT_LANDING_VY, 6, -this.prevVy);
      }
    }

    this.tumble(s, step);
    this.battery(s, step);
    this.beacon(s, step);

    this.prevX = pos[0]; this.prevY = pos[1]; this.prevZ = pos[2];
    this.prevVy = vel[1];
    this.prevArmed = s.armed;
    this.prevOnGround = s.onGround;
    this.prevCrashed = s.crashed;
    return f;
  }

  private crash(s: EventInput, speed: number): void {
    const f = this.flags;
    f.crash = true;
    f.crashSpeed = speed;
    f.propStrike = speed > PROP_STRIKE_SPEED && meanOmega(s) > SPIN_OMEGA;
    this.crashedSinceArm = true;
    this.sinceCrash = 0;
  }

  private seed(s: EventInput): void {
    this.started = true;
    this.lastTime = s.time;
    this.prevX = s.pos[0]; this.prevY = s.pos[1]; this.prevZ = s.pos[2];
    this.prevVy = s.vel[1];
    this.prevArmed = s.armed;
    this.prevOnGround = s.onGround;
    this.prevCrashed = s.crashed;
    this.volts = s.batteryVoltage;
    this.lowActive = false;
    this.lowTimer = 0;
    this.tumbleTimer = 0;
    this.crashedSinceArm = false;
    this.sinceCrash = Infinity;
    this.groundIdle = 0;
    this.beaconTimer = 0;
    if (!this.fixedCells) this.cells = 0;
  }

  private tumble(s: EventInput, step: number): void {
    const w = s.angVel;
    const spin = Math.hypot(w[0], w[1], w[2]);
    const speed = Math.hypot(s.vel[0], s.vel[1], s.vel[2]);
    if (!(s.onGround && spin > TUMBLE_SPIN && speed > TUMBLE_SPEED)) {
      this.tumbleTimer = 0;
      return;
    }
    this.tumbleTimer -= step;
    if (this.tumbleTimer > 0) return;
    this.flags.tumble = true;
    this.flags.tumbleLevel = smoothstep(TUMBLE_SPEED, 12, speed);
    this.tumbleTimer = this.rng.range(0.1, 0.3);
  }

  private battery(s: EventInput, step: number): void {
    const v = s.batteryVoltage;
    if (!(v > 0)) return;
    if (!this.fixedCells) this.cells = Math.max(this.cells, Math.ceil(v / FULL_CELL_V));
    this.volts += (v - this.volts) * smoothingAlpha(step, VOLTAGE_TAU);
    const perCell = this.volts / Math.max(1, this.cells);
    if (!s.armed) {
      this.lowActive = false;
      this.lowTimer = 0;
      return;
    }
    if (perCell < LOW_CELL_V) this.lowActive = true;
    else if (perCell > LOW_CELL_RECOVER_V) this.lowActive = false;
    if (!this.lowActive) {
      this.lowTimer = 0;
      return;
    }
    this.lowTimer -= step;
    if (this.lowTimer > 0) return;
    this.flags.lowBattery = true;
    this.lowTimer = LOW_REPEAT_S;
  }

  private beacon(s: EventInput, step: number): void {
    if (s.armed || !s.onGround || !this.crashedSinceArm) {
      this.groundIdle = 0;
      this.beaconTimer = 0;
      return;
    }
    this.groundIdle += step;
    if (this.groundIdle < BEACON_DELAY_S) return;
    this.beaconTimer -= step;
    if (this.beaconTimer > 0) return;
    this.flags.beacon = true;
    this.beaconTimer = BEACON_REPEAT_S;
  }
}

function meanOmega(s: EventInput): number {
  const w = s.motorOmega;
  let sum = 0;
  for (let i = 0; i < 4; i++) if (w[i] > 0) sum += w[i];
  return sum * 0.25;
}

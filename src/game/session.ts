import type { Physics, QuadState, Quat, StickInput, TrackData, Vec3 } from '../contracts';
import type { InputAction, InputSource } from '../input/types';
import { createPlacement, padPlacement, respawnPlacement, type GroundHeightFn, type Placement } from './checkpoint';
import { SimClock, TIME_STEP_MINUTES } from './clock';
import { GateTimer, type GateEvent } from './gateTimer';
import { quatSlerp } from './quat';
import {
  ARM_THROTTLE_MAX, AUTO_DISARM_S, createSessionSnapshot, HOVER_THROTTLE, RESPAWN_OFFER_S, TAKEOFF_THROTTLE,
  type SessionOptions, type SessionSettings, type SessionSnapshot, type SessionStats,
} from './sessionTypes';
import { GameStateMachine, type GameEvent, type GameState } from './stateMachine';
import { FixedStepper } from './stepper';

const IDLE_SPEED = 0.3;
const IDLE_SPIN = 0.5;
const NOTICE_S = 2;
/** A frame longer than this (tab switch, breakpoint) does not fast-forward the sky either. */
const MAX_FRAME_S = 0.25;

function copy3(a: Vec3, b: Vec3): void {
  a[0] = b[0];
  a[1] = b[1];
  a[2] = b[2];
}

function lerp3(a: Vec3, b: Vec3, t: number, out: Vec3): void {
  out[0] = a[0] + (b[0] - a[0]) * t;
  out[1] = a[1] + (b[1] - a[1]) * t;
  out[2] = a[2] + (b[2] - a[2]) * t;
}

/**
 * Runs the sim: a fixed-step physics accumulator with interpolated render state, the start/fly/crash/finish state
 * machine, gate timing, respawns and the simulated clock. It owns consuming the input actions (`update` drains them).
 */
export class GameSession {
  readonly physics: Physics;
  readonly input: InputSource;
  readonly clock: SimClock;
  readonly stepper = new FixedStepper();
  readonly stats: SessionStats = { stepsThisFrame: 0, physicsMs: 0, droppedSteps: 0, totalSteps: 0 };
  groundHeightAt: GroundHeightFn | undefined;
  autoRespawn: boolean;
  /** Fired after every state change; the app shows the menu and grabs or frees the pointer from it. */
  onStateChange: ((state: GameState, prev: GameState) => void) | null = null;
  /** Fired for each gate event with the index of the gate that was cleared (or, for a miss, the one still due). */
  onGate: ((event: GateEvent, gate: number) => void) | null = null;
  /** Fired for every input action after the session handled its own (camera, help, perf and new-track are the app's). */
  onAction: ((action: InputAction) => void) | null = null;

  private readonly machine = new GameStateMachine();
  private readonly now: () => number;
  private readonly cmd: StickInput = { roll: 0, pitch: 0, yaw: 0, throttle: 0, armed: false, mode: 'acro', turtle: false };
  private readonly render: QuadState;
  private readonly placement = createPlacement();
  private readonly prevPos: Vec3 = [0, 0, 0];
  private readonly prevVel: Vec3 = [0, 0, 0];
  private readonly prevAngVel: Vec3 = [0, 0, 0];
  private readonly prevQuat: Quat = [0, 0, 0, 1];
  private track: TrackData | null;
  private timer: GateTimer;
  private simTime = 0;
  private realTime = 0;
  private armedTime = 0;
  private crashTime = -Infinity;
  private wasCrashed = false;
  private idleTime = 0;
  private airArm = false;
  private throttleHighAt = -Infinity;
  private notice = '';
  private noticeUntil = 0;
  private leftMenu = false;

  constructor(opts: SessionOptions) {
    this.physics = opts.physics;
    this.input = opts.input;
    this.track = opts.track;
    this.timer = new GateTimer(opts.track);
    this.groundHeightAt = opts.groundHeightAt;
    this.now = opts.now ?? (() => performance.now());
    this.autoRespawn = opts.settings.autoRespawn;
    this.clock = new SimClock(opts.settings.timeMs, opts.settings.timeScale);
    this.stepper.setRate(opts.settings.physicsHz);
    const s = opts.physics.state;
    this.render = { ...s, pos: [0, 0, 0], vel: [0, 0, 0], quat: [0, 0, 0, 1], angVel: [0, 0, 0], motorOmega: [0, 0, 0, 0], motorCmd: [0, 0, 0, 0], gForce: [0, 0, 0] };
    this.input.setEnabled(false);
    this.place(padPlacement(opts.track, this.placement), 'reset');
  }

  get state(): GameState {
    return this.machine.state;
  }

  /** False until the start screen was left once. */
  get started(): boolean {
    return this.leftMenu;
  }

  get raceTrack(): TrackData | null {
    return this.track;
  }

  /** Blend factor between the previous and current physics state for `renderState`, in [0, 1). */
  get alpha(): number {
    return this.stepper.alpha;
  }

  /** Applies the settings a running session can follow: physics rate, auto-respawn and the clock. */
  applySettings(patch: Partial<SessionSettings>): void {
    if (patch.physicsHz !== undefined) this.stepper.setRate(patch.physicsHz);
    if (patch.autoRespawn !== undefined) this.autoRespawn = patch.autoRespawn;
    if (patch.timeMs !== undefined) this.clock.timeMs = patch.timeMs;
    if (patch.timeScale !== undefined) this.clock.timeScale = patch.timeScale;
  }

  /** Swaps the track and puts the quad back on its start pad with a fresh race. */
  setTrack(track: TrackData | null): void {
    this.track = track;
    this.timer = new GateTimer(track);
    this.resetTrack();
  }

  openMenu(): void {
    this.send('open-menu');
  }

  /** Leaves the menu; the first call also starts the session ("Click to fly"). */
  closeMenu(): void {
    this.send('close-menu');
  }

  togglePause(): void {
    this.send('toggle-pause');
  }

  /** Back to the last cleared gate (or the pad); after a finished race, a fresh start. */
  respawn(): void {
    if (this.timer.isFinished) this.resetTrack();
    else this.place(respawnPlacement(this.track, this.timer.lastGate, this.groundHeightAt, this.placement), null);
  }

  /** Puts the quad on the start pad, disarmed, and restarts the race and flight timers. */
  resetTrack(): void {
    this.timer.reset();
    this.armedTime = 0;
    this.place(padPlacement(this.track, this.placement), 'reset');
  }

  /** Consumes one input action. `update` calls this for everything the input source queued. */
  handleAction(action: InputAction): void {
    switch (action) {
      case 'toggle-menu':
        if (this.machine.state !== 'menu') this.openMenu();
        else if (this.started) this.closeMenu();
        break;
      case 'pause':
        this.togglePause();
        break;
      case 'arm-toggle':
        this.toggleArm();
        break;
      case 'respawn':
        if (this.machine.simulating) this.respawn();
        break;
      case 'reset-track':
        if (this.machine.simulating) this.resetTrack();
        break;
      case 'time-forward':
        this.clock.nudge(TIME_STEP_MINUTES);
        break;
      case 'time-back':
        this.clock.nudge(-TIME_STEP_MINUTES);
        break;
      default:
        break;
    }
    this.onAction?.(action);
  }

  /** Convenience for the frame loop: poll the input, then `update`. Returns the polled stick (reused by the input source). */
  frame(realDt: number): StickInput {
    const stick = this.input.poll(realDt);
    this.update(realDt, stick);
    return stick;
  }

  /** Advances the session by one render frame of `realDt` seconds with the pilot's current stick. */
  update(realDt: number, stick: StickInput): void {
    const dt = realDt > 0 ? Math.min(realDt, MAX_FRAME_S) : 0;
    this.realTime += dt;
    const cmd = this.cmd;
    cmd.roll = stick.roll;
    cmd.pitch = stick.pitch;
    cmd.yaw = stick.yaw;
    cmd.throttle = stick.throttle;
    cmd.mode = stick.mode;
    cmd.turtle = stick.turtle;
    for (const action of this.input.takeActions()) this.handleAction(action);
    cmd.armed = this.input.armed;
    if (this.machine.state !== 'paused') this.clock.advance(dt);
    this.stats.stepsThisFrame = 0;
    this.stats.physicsMs = 0;
    if (!this.machine.simulating) return;
    const steps = this.stepper.advance(realDt);
    const t0 = this.now();
    for (let i = 0; i < steps; i++) this.step(cmd);
    this.stats.physicsMs = this.now() - t0;
    this.stats.stepsThisFrame = steps;
    this.stats.totalSteps += steps;
    this.stats.droppedSteps = this.stepper.droppedSteps;
    this.afterSteps(steps * this.stepper.dt);
  }

  /** The physics state blended between the last two steps; the returned object is reused every call. */
  renderState(alpha: number = this.stepper.alpha): QuadState {
    const s = this.physics.state;
    const o = this.render;
    const a = alpha < 0 ? 0 : alpha > 1 ? 1 : alpha;
    o.time = s.time;
    o.batteryVoltage = s.batteryVoltage;
    o.batteryCurrent = s.batteryCurrent;
    o.batteryMah = s.batteryMah;
    o.armed = s.armed;
    o.onGround = s.onGround;
    o.crashed = s.crashed;
    o.impactSpeed = s.impactSpeed;
    copy3(o.gForce, s.gForce);
    for (let i = 0; i < 4; i++) {
      o.motorOmega[i] = s.motorOmega[i];
      o.motorCmd[i] = s.motorCmd[i];
    }
    lerp3(this.prevPos, s.pos, a, o.pos);
    lerp3(this.prevVel, s.vel, a, o.vel);
    lerp3(this.prevAngVel, s.angVel, a, o.angVel);
    quatSlerp(this.prevQuat, s.quat, a, o.quat);
    return o;
  }

  /** Fills the HUD's view of the session (state, timers, warnings, race) in place. */
  snapshot(out: SessionSnapshot = createSessionSnapshot()): SessionSnapshot {
    out.state = this.machine.state;
    out.simTime = this.simTime;
    out.flightTime = this.armedTime;
    out.throttleHigh = this.realTime - this.throttleHighAt < NOTICE_S;
    out.throttle = this.cmd.throttle;
    out.turtle = this.cmd.turtle;
    out.respawnOffered = this.machine.state === 'crashed' && this.simTime - this.crashTime >= RESPAWN_OFFER_S;
    out.message = this.realTime < this.noticeUntil ? this.notice : '';
    this.timer.fill(out.race, this.simTime);
    return out;
  }

  private send(event: GameEvent): void {
    const prev = this.machine.state;
    const next = this.machine.send(event);
    if (next === prev) return;
    if (next !== 'menu') this.leftMenu = true;
    this.input.setEnabled(next !== 'menu');
    this.onStateChange?.(next, prev);
  }

  private say(text: string): void {
    this.notice = text;
    this.noticeUntil = this.realTime + NOTICE_S;
  }

  private toggleArm(): void {
    if (!this.machine.simulating) return;
    if (this.input.armed) {
      this.input.setArmed(false);
    } else if (this.cmd.throttle >= ARM_THROTTLE_MAX) {
      this.throttleHighAt = this.realTime;
    } else {
      this.input.setArmed(true);
    }
  }

  /** Teleports the quad. A mid-air checkpoint arms it on the spot, with hover throttle once the flight controller accepted it. */
  private place(p: Placement, event: GameEvent | null): void {
    this.physics.reset(p.pos, p.yaw);
    const s = this.physics.state;
    copy3(this.prevPos, s.pos);
    copy3(this.prevVel, s.vel);
    copy3(this.prevAngVel, s.angVel);
    for (let i = 0; i < 4; i++) this.prevQuat[i] = s.quat[i];
    this.stepper.reset();
    this.wasCrashed = false;
    this.crashTime = -Infinity;
    this.idleTime = 0;
    this.airArm = p.airborne;
    this.input.setThrottle(0);
    this.input.setArmed(p.airborne);
    this.cmd.armed = p.airborne;
    this.send(event ?? (p.airborne ? 'respawn-air' : 'respawn-ready'));
  }

  private step(cmd: StickInput): void {
    const s = this.physics.state;
    const dt = this.stepper.dt;
    copy3(this.prevPos, s.pos);
    copy3(this.prevVel, s.vel);
    copy3(this.prevAngVel, s.angVel);
    for (let i = 0; i < 4; i++) this.prevQuat[i] = s.quat[i];
    const t = this.simTime;
    if (this.airArm) cmd.throttle = 0;
    this.physics.step(dt, cmd);
    this.simTime = t + dt;
    if (this.airArm && s.armed) {
      this.airArm = false;
      cmd.throttle = HOVER_THROTTLE;
      this.input.setThrottle(HOVER_THROTTLE);
    }
    if (s.crashed && !this.wasCrashed && (this.machine.state === 'flying' || this.machine.state === 'ready')) {
      this.send('crash');
      this.crashTime = this.simTime;
    }
    this.wasCrashed = s.crashed;
    if (this.timer.gateCount === 0) return;
    const ev = this.timer.check(this.prevPos, s.pos, t, this.simTime);
    if (ev === 'none') return;
    this.onGate?.(ev, ev === 'missed' ? this.timer.nextGate : this.timer.lastGate);
    if (ev === 'finish' && this.machine.state === 'flying') this.send('finish');
  }

  private afterSteps(simDt: number): void {
    const s = this.physics.state;
    if (s.armed) this.armedTime += simDt;
    const launching = s.armed && !this.cmd.turtle && this.cmd.throttle > TAKEOFF_THROTTLE;
    if (this.machine.state === 'ready') {
      if (launching) this.send('takeoff');
    } else if (this.machine.state === 'crashed') {
      if (this.simTime - this.crashTime >= RESPAWN_OFFER_S) {
        if (this.autoRespawn) {
          this.respawn();
          return;
        }
        if (launching) {
          this.send('takeoff');
          return;
        }
      }
      this.autoDisarm(simDt);
    }
  }

  private autoDisarm(simDt: number): void {
    const s = this.physics.state;
    const still = Math.hypot(s.vel[0], s.vel[1], s.vel[2]) < IDLE_SPEED && Math.hypot(s.angVel[0], s.angVel[1], s.angVel[2]) < IDLE_SPIN;
    if (!(s.armed && s.onGround && still && this.cmd.throttle < ARM_THROTTLE_MAX)) {
      this.idleTime = 0;
      return;
    }
    this.idleTime += simDt;
    if (this.idleTime < AUTO_DISARM_S) return;
    this.idleTime = 0;
    this.input.setArmed(false);
    this.input.setThrottle(0);
    this.say('AUTO DISARM');
  }
}

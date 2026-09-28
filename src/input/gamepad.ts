import type { FlightMode } from '../contracts';
import { createPadSample, mapGamepad, resolveThrottleMode, type GamepadConfig, type PadLike, type PadSample } from './gamepadMap';

/** How long after the last stick movement the pad still overrides keyboard and mouse. */
export const ACTIVITY_WINDOW_MS = 2000;
/** Raw axis change per poll that counts as movement (ignores sensor noise). */
export const AXIS_ACTIVITY_DELTA = 0.03;
/** Calibrated roll/pitch/yaw magnitude that counts as movement (a held, off-centre stick). */
export const STICK_ACTIVITY = 0.05;
const MAX_TRACKED_AXES = 16;
/** Pads with fewer axes (mice, keyboards and LED strips that enumerate as HID gamepads) are ignored. */
const MIN_AXES = 4;

export type PadProvider = () => ArrayLike<PadLike | null | undefined>;

/** One-poll edge flags, valid until the next `poll`. Nothing fires on the poll that first sees a pad. */
export interface PadEdges {
  arm: boolean;
  camera: boolean;
  respawn: boolean;
  modeCycle: boolean;
  menu: boolean;
  armSwitchOn: boolean;
  armSwitchOff: boolean;
  modeSwitchChanged: boolean;
}

const NO_AXES: readonly number[] = [];

export function browserPads(): ArrayLike<PadLike | null> {
  return typeof navigator !== 'undefined' && typeof navigator.getGamepads === 'function' ? navigator.getGamepads() : [];
}

function usable(p: PadLike | null | undefined): p is PadLike {
  return p !== null && p !== undefined && p.connected !== false && p.axes.length >= MIN_AXES;
}

/** Polls the Gamepad API once per frame and reports the mapped sample, activity and button edges without allocating. */
export class GamepadInput {
  readonly sample: PadSample = createPadSample();
  readonly edges: PadEdges = { arm: false, camera: false, respawn: false, modeCycle: false, menu: false, armSwitchOn: false, armSwitchOff: false, modeSwitchChanged: false };
  connected = false;
  /** True while the pad has moved within the activity window. */
  active = false;
  padId = '';
  /** Live raw axes of the selected pad, for the calibration readout. */
  raw: ArrayLike<number> = NO_AXES;
  private index = -1;
  private hasPrev = false;
  private lastActiveMs = -Infinity;
  private readonly prevAxes = new Float32Array(MAX_TRACKED_AXES);
  private prevArm = false;
  private prevCamera = false;
  private prevRespawn = false;
  private prevModeCycle = false;
  private prevMenu = false;
  private prevArmSwitch = false;
  private prevMode: FlightMode = 'acro';

  constructor(private readonly provider: PadProvider = browserPads) {}

  poll(cfg: GamepadConfig, nowMs: number): void {
    const e = this.edges;
    e.arm = e.camera = e.respawn = e.modeCycle = e.menu = e.armSwitchOn = e.armSwitchOff = e.modeSwitchChanged = false;
    const pad = this.select(this.provider());
    if (pad === null) {
      this.connected = false;
      this.active = false;
      this.hasPrev = false;
      this.raw = NO_AXES;
      return;
    }
    if (!this.connected) this.hasPrev = false;
    this.connected = true;
    this.padId = pad.id ?? '';
    this.raw = pad.axes;
    const s = this.sample;
    mapGamepad(pad, cfg, s);
    let moved = Math.abs(s.roll) > STICK_ACTIVITY || Math.abs(s.pitch) > STICK_ACTIVITY || Math.abs(s.yaw) > STICK_ACTIVITY;
    // A spring-centred throttle held off-centre is still being flown (latched mode keeps integrating it).
    if (!moved && resolveThrottleMode(cfg, s.profile) !== 'direct') moved = Math.abs(s.throttleDefl) > STICK_ACTIVITY;
    const n = Math.min(pad.axes.length, MAX_TRACKED_AXES);
    for (let i = 0; i < n; i++) {
      const v = pad.axes[i];
      if (this.hasPrev && Math.abs(v - this.prevAxes[i]) > AXIS_ACTIVITY_DELTA) moved = true;
      this.prevAxes[i] = v;
    }
    for (let i = 0; i < pad.buttons.length; i++) if (pad.buttons[i].pressed) moved = true;
    if (moved) this.lastActiveMs = nowMs;
    this.active = nowMs - this.lastActiveMs <= ACTIVITY_WINDOW_MS;
    if (this.hasPrev) {
      e.arm = s.arm && !this.prevArm;
      e.camera = s.camera && !this.prevCamera;
      e.respawn = s.respawn && !this.prevRespawn;
      e.modeCycle = s.modeCycle && !this.prevModeCycle;
      e.menu = s.menu && !this.prevMenu;
      e.armSwitchOn = s.hasArmSwitch && s.armSwitch && !this.prevArmSwitch;
      e.armSwitchOff = s.hasArmSwitch && !s.armSwitch && this.prevArmSwitch;
      e.modeSwitchChanged = s.hasModeSwitch && s.modeSwitch !== this.prevMode;
    }
    this.prevArm = s.arm;
    this.prevCamera = s.camera;
    this.prevRespawn = s.respawn;
    this.prevModeCycle = s.modeCycle;
    this.prevMenu = s.menu;
    this.prevArmSwitch = s.armSwitch;
    this.prevMode = s.modeSwitch;
    this.hasPrev = true;
  }

  private select(pads: ArrayLike<PadLike | null | undefined>): PadLike | null {
    const kept = this.index >= 0 && this.index < pads.length ? pads[this.index] : null;
    if (usable(kept)) return kept;
    for (let i = 0; i < pads.length; i++) {
      const p = pads[i];
      if (usable(p)) {
        this.index = i;
        this.hasPrev = false;
        return p;
      }
    }
    this.index = -1;
    return null;
  }
}

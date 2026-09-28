import type { FlightMode } from '../contracts';
import { clamp, shapeStick } from './curves';

/** The parts of a Gamepad the mapping needs, so tests can pass plain objects. */
export interface PadLike {
  readonly axes: ArrayLike<number>;
  readonly buttons: ArrayLike<{ readonly pressed: boolean; readonly value: number }>;
  readonly mapping?: string;
  readonly id?: string;
  readonly connected?: boolean;
}

export type GamepadProfile = 'auto' | 'standard' | 'radio';
export type ThrottleMode = 'auto' | 'direct' | 'latched' | 'hover';
export type RadioOrder = 'AETR' | 'TAER';
export type StickRole = 'roll' | 'pitch' | 'yaw' | 'throttle' | 'arm' | 'mode';

/** Raw axis range: `center` is the resting value of a spring stick, `min`/`max` the travel ends. */
export interface AxisCal {
  min: number;
  center: number;
  max: number;
  invert: boolean;
}

export interface PadButtons {
  arm: number;
  turtle: number;
  camera: number;
  respawn: number;
  modeCycle: number;
  menu: number;
}

export interface GamepadConfig {
  profile: GamepadProfile;
  throttleMode: ThrottleMode;
  deadzone: number;
  expo: number;
  radioOrder: RadioOrder;
  /** Throttle at stick centre in 'hover' mode. */
  hoverThrottle: number;
  cal: Record<StickRole, AxisCal>;
  /** Button indices (standard layout: A, B, X, Y, LB, Start); -1 disables a button. */
  buttons: PadButtons;
}

const cal = (): AxisCal => ({ min: -1, center: 0, max: 1, invert: false });

export function defaultGamepadConfig(): GamepadConfig {
  return {
    profile: 'auto',
    throttleMode: 'auto',
    deadzone: 0.05,
    expo: 0,
    radioOrder: 'AETR',
    hoverThrottle: 0.3,
    cal: { roll: cal(), pitch: cal(), yaw: cal(), throttle: cal(), arm: cal(), mode: cal() },
    buttons: { arm: 0, turtle: 1, camera: 2, respawn: 3, modeCycle: 4, menu: 9 },
  };
}

export const DEFAULT_GAMEPAD: GamepadConfig = defaultGamepadConfig();

/** Raw axis index per role. USB radios (RadioMaster, Jumper, FrSky) enumerate AETR; TAER is the Spektrum/Futaba order. */
export const AXIS_LAYOUTS: Record<'standard' | RadioOrder, Record<StickRole, number>> = {
  standard: { yaw: 0, throttle: 1, roll: 2, pitch: 3, arm: -1, mode: -1 },
  AETR: { roll: 0, pitch: 1, throttle: 2, yaw: 3, arm: 4, mode: 5 },
  TAER: { throttle: 0, roll: 1, pitch: 2, yaw: 3, arm: 4, mode: 5 },
};

/** Standard-mapping pads report stick-up as -1, so throttle and pitch flip; radios report up/forward as +1. */
const STANDARD_INVERT: Record<StickRole, boolean> = { roll: false, pitch: true, yaw: false, throttle: true, arm: false, mode: false };

export interface PadSample {
  roll: number;
  pitch: number;
  yaw: number;
  /** Direct throttle 0..1 (radio stick position). */
  throttleDirect: number;
  /** Spring-stick deflection -1..1 after deadzone (for latched and hover throttle). */
  throttleDefl: number;
  /** Aux switch state (radio only). */
  hasArmSwitch: boolean;
  armSwitch: boolean;
  hasModeSwitch: boolean;
  modeSwitch: FlightMode;
  arm: boolean;
  turtle: boolean;
  camera: boolean;
  respawn: boolean;
  modeCycle: boolean;
  menu: boolean;
  profile: 'standard' | 'radio';
}

export function createPadSample(): PadSample {
  return {
    roll: 0, pitch: 0, yaw: 0, throttleDirect: 0, throttleDefl: 0,
    hasArmSwitch: false, armSwitch: false, hasModeSwitch: false, modeSwitch: 'acro',
    arm: false, turtle: false, camera: false, respawn: false, modeCycle: false, menu: false, profile: 'radio',
  };
}

export function resolveProfile(pad: PadLike, cfg: GamepadConfig): 'standard' | 'radio' {
  if (cfg.profile !== 'auto') return cfg.profile;
  return pad.mapping === 'standard' ? 'standard' : 'radio';
}

export function resolveThrottleMode(cfg: GamepadConfig, profile: 'standard' | 'radio'): Exclude<ThrottleMode, 'auto'> {
  if (cfg.throttleMode !== 'auto') return cfg.throttleMode;
  return profile === 'radio' ? 'direct' : 'latched';
}

/** Raw -> -1..1 around the calibrated centre, each half scaled by its own travel. `flip` inverts on top of `c.invert`. */
export function normSigned(raw: number, c: AxisCal, flip = false): number {
  const span = raw >= c.center ? c.max - c.center : c.center - c.min;
  const v = span > 1e-6 ? (raw - c.center) / span : 0;
  return clamp(c.invert !== flip ? -v : v, -1, 1);
}

/** Raw -> 0..1 across the calibrated travel (throttle sticks without a spring). */
export function normUnit(raw: number, c: AxisCal, flip = false): number {
  const span = c.max - c.min;
  const v = span > 1e-6 ? (raw - c.min) / span : 0;
  return clamp(c.invert !== flip ? 1 - v : v, 0, 1);
}

export function switchMode(v: number): FlightMode {
  return v < -0.33 ? 'acro' : v > 0.33 ? 'horizon' : 'angle';
}

function axisAt(pad: PadLike, index: number): number | null {
  if (index < 0 || index >= pad.axes.length) return null;
  const v = pad.axes[index];
  return Number.isFinite(v) ? v : null;
}

function pressed(pad: PadLike, index: number): boolean {
  return index >= 0 && index < pad.buttons.length && pad.buttons[index].pressed;
}

function stickValue(pad: PadLike, cfg: GamepadConfig, layout: Record<StickRole, number>, role: StickRole, flip: boolean): number {
  const raw = axisAt(pad, layout[role]);
  return raw === null ? 0 : shapeStick(normSigned(raw, cfg.cal[role], flip), cfg.deadzone, cfg.expo);
}

/** Applies calibration, deadzone and expo. Pure: same pad + config always gives the same sample. */
export function mapGamepad(pad: PadLike, cfg: GamepadConfig, out: PadSample): void {
  const profile = resolveProfile(pad, cfg);
  const std = profile === 'standard';
  const layout = AXIS_LAYOUTS[std ? 'standard' : cfg.radioOrder];
  out.profile = profile;
  out.roll = stickValue(pad, cfg, layout, 'roll', std && STANDARD_INVERT.roll);
  out.pitch = stickValue(pad, cfg, layout, 'pitch', std && STANDARD_INVERT.pitch);
  out.yaw = stickValue(pad, cfg, layout, 'yaw', std && STANDARD_INVERT.yaw);
  const tRaw = axisAt(pad, layout.throttle);
  if (tRaw === null) {
    out.throttleDirect = 0;
    out.throttleDefl = 0;
  } else {
    const flip = std && STANDARD_INVERT.throttle;
    out.throttleDirect = normUnit(tRaw, cfg.cal.throttle, flip);
    out.throttleDefl = shapeStick(normSigned(tRaw, cfg.cal.throttle, flip), cfg.deadzone, 0);
  }
  const armRaw = axisAt(pad, layout.arm);
  out.hasArmSwitch = armRaw !== null;
  out.armSwitch = armRaw !== null && normSigned(armRaw, cfg.cal.arm) > 0.5;
  const modeRaw = axisAt(pad, layout.mode);
  out.hasModeSwitch = modeRaw !== null;
  out.modeSwitch = modeRaw === null ? 'acro' : switchMode(normSigned(modeRaw, cfg.cal.mode));
  const b = cfg.buttons;
  out.arm = pressed(pad, b.arm);
  out.turtle = pressed(pad, b.turtle);
  out.camera = pressed(pad, b.camera);
  out.respawn = pressed(pad, b.respawn);
  out.modeCycle = pressed(pad, b.modeCycle);
  out.menu = pressed(pad, b.menu);
}

/** Full-deflection ramp rate of a latched (spring-return) throttle stick, per second. */
export const LATCHED_RATE = 0.8;

/** Next throttle for the chosen mode; direct and hover are absolute, latched integrates the stick deflection. */
export function padThrottle(mode: Exclude<ThrottleMode, 'auto'>, s: PadSample, current: number, dt: number, hover: number): number {
  switch (mode) {
    case 'direct':
      return s.throttleDirect;
    case 'latched':
      return clamp(current + s.throttleDefl * LATCHED_RATE * dt, 0, 1);
    case 'hover':
      return clamp(s.throttleDefl >= 0 ? hover + s.throttleDefl * (1 - hover) : hover + s.throttleDefl * hover, 0, 1);
  }
}

const RANGE_ROLES = ['roll', 'pitch', 'yaw', 'throttle'] as const;

function withCal(cfg: GamepadConfig, profile: 'standard' | 'radio', raw: ArrayLike<number>, roles: readonly StickRole[], edit: (c: AxisCal, v: number) => AxisCal): GamepadConfig {
  const layout = AXIS_LAYOUTS[profile === 'standard' ? 'standard' : cfg.radioOrder];
  const next: GamepadConfig = { ...cfg, cal: { ...cfg.cal } };
  for (const role of roles) {
    const i = layout[role];
    if (i >= 0 && i < raw.length) next.cal[role] = edit(cfg.cal[role], raw[i]);
  }
  return next;
}

/** Calibration helpers for the settings screen: capture resting values, then sweep to record the travel. */
export function centerFromRaw(cfg: GamepadConfig, profile: 'standard' | 'radio', raw: ArrayLike<number>): GamepadConfig {
  return withCal(cfg, profile, raw, ['roll', 'pitch', 'yaw'], (c, v) => ({ ...c, center: v }));
}

/** Starts a range sweep: min and max collapse onto the current position and grow with `extendRange`. */
export function beginRange(cfg: GamepadConfig, profile: 'standard' | 'radio', raw: ArrayLike<number>): GamepadConfig {
  return withCal(cfg, profile, raw, RANGE_ROLES, (c, v) => ({ ...c, min: v, max: v }));
}

export function extendRange(cfg: GamepadConfig, profile: 'standard' | 'radio', raw: ArrayLike<number>): GamepadConfig {
  return withCal(cfg, profile, raw, RANGE_ROLES, (c, v) => ({ ...c, min: Math.min(c.min, v), max: Math.max(c.max, v) }));
}

import type { FlightMode } from '../contracts';
import { clamp, shapeStick } from './curves';
import { defaultActionBinds, bindOn, PAD_ACTIONS, type ActionBinds, type PadAction } from './padActions';

export interface PadButton {
  readonly pressed: boolean;
  readonly value: number;
}

/** The parts of a Gamepad the mapping needs, so tests can pass plain objects. */
export interface PadLike {
  readonly axes: ArrayLike<number>;
  readonly buttons: ArrayLike<PadButton>;
  readonly mapping?: string;
  readonly id?: string;
  readonly connected?: boolean;
}

export type GamepadProfile = 'auto' | 'standard' | 'radio';
export type ThrottleMode = 'auto' | 'direct' | 'latched' | 'hover';

/**
 * Which stick layout to read when a role is not bound by hand. `auto` follows the reported mapping, the
 * rest name a device or a radio channel order.
 */
export type StickLayout = 'auto' | 'standard' | 'AETR' | 'TAER' | 'X56';

export type StickRole = 'roll' | 'pitch' | 'yaw' | 'throttle' | 'arm' | 'mode';

/** Every role, in the order the settings screen and the config sanitiser walk them. */
export const ROLES: readonly StickRole[] = ['roll', 'pitch', 'yaw', 'throttle', 'arm', 'mode'];

/** Raw axis range: `center` is the resting value of a spring stick, `min`/`max` the travel ends. */
export interface AxisCal {
  min: number;
  center: number;
  max: number;
  invert: boolean;
}

export interface GamepadConfig {
  profile: GamepadProfile;
  throttleMode: ThrottleMode;
  deadzone: number;
  expo: number;
  /** The stick layout used for any role the pilot has not bound by hand. */
  layout: StickLayout;
  /** Throttle at stick centre in 'hover' mode. */
  hoverThrottle: number;
  cal: Record<StickRole, AxisCal>;
  /**
   * Per-role raw axis picked by the pilot in the Controls tab; -1 means "use the layout's
   * axis for this role". A stick moved by hand is what sets it, so a controller that enumerates its
   * axes in an order no named layout describes can still be flown.
   */
  axisMap: Record<StickRole, number>;
  /** What every switch and button drives. */
  actions: ActionBinds;
}

const cal = (): AxisCal => ({ min: -1, center: 0, max: 1, invert: false });

/** Every role unbound, so the layout decides until the pilot moves a stick. */
export const unboundAxes: Record<StickRole, number> = { roll: -1, pitch: -1, yaw: -1, throttle: -1, arm: -1, mode: -1 };

export function defaultGamepadConfig(): GamepadConfig {
  return {
    profile: 'auto',
    throttleMode: 'auto',
    deadzone: 0.05,
    expo: 0,
    layout: 'AETR',
    hoverThrottle: 0.3,
    cal: { roll: cal(), pitch: cal(), yaw: cal(), throttle: cal(), arm: cal(), mode: cal() },
    axisMap: { ...unboundAxes },
    actions: defaultActionBinds(),
  };
}

export const DEFAULT_GAMEPAD: GamepadConfig = defaultGamepadConfig();

/**
 * Raw axis index per role. USB radios (RadioMaster, Jumper, FrSky) enumerate AETR; TAER is the
 * Spektrum/Futaba order. `standard` is the Gamepad API's own left-stick-first layout.
 *
 * The X-56 Rhino has one main stick, a long throttle lever, a small lever and a twist handle on that
 * grip, plus a hat and a slider. Its axis order is set by the driver rather than by the device, so this
 * entry is a starting point and the pilot corrects any of it by moving the control they want, which the
 * Controls tab records. Yaw is the twist handle because the Rhino has no second stick.
 */
export const AXIS_LAYOUTS: Record<'standard' | Exclude<StickLayout, 'auto'>, Record<StickRole, number>> = {
  standard: { yaw: 0, throttle: 1, roll: 2, pitch: 3, arm: -1, mode: -1 },
  AETR: { roll: 0, pitch: 1, throttle: 2, yaw: 3, arm: 4, mode: 5 },
  TAER: { throttle: 0, roll: 1, pitch: 2, yaw: 3, arm: 4, mode: 5 },
  X56: { roll: 0, pitch: 1, throttle: 3, yaw: 6, arm: 4, mode: 5 },
};

/** The named layouts, in the order the settings screen offers them. */
export const STICK_LAYOUTS: readonly StickLayout[] = ['auto', 'standard', 'AETR', 'TAER', 'X56'];

export const STICK_LAYOUT_LABELS: Readonly<Record<StickLayout, string>> = {
  auto: 'Detect from the device',
  standard: 'Game controller (standard mapping)',
  AETR: 'Radio AETR (RadioMaster, Jumper, FrSky)',
  TAER: 'Radio TAER (Spektrum, Futaba)',
  X56: 'X-56 Rhino stick (Saitek / Thrustmaster)',
};

export const STICK_LAYOUT_HINTS: Readonly<Record<StickLayout, string>> = {
  auto: 'Follows what the pad reports: a standard mapping reads the game-controller layout, anything else the AETR radio layout.',
  standard: 'The Gamepad API layout: left stick first, then the right stick.',
  AETR: 'Roll, pitch, throttle, yaw, then the two aux switches.',
  TAER: 'The Spektrum and Futaba order: throttle first.',
  X56: 'One stick, a throttle lever, a twist handle and switches. The axis order comes from the driver, so check the raw axes and rebind anything that is in the wrong place.',
};

/** Standard-mapping pads report stick-up as -1, so throttle and pitch flip; radios report up/forward as +1. */
const STANDARD_INVERT: Record<StickRole, boolean> = { roll: false, pitch: true, yaw: false, throttle: true, arm: false, mode: false };

/** The raw axis a role reads: the pilot's binding when there is one, else the layout's. */
export function axisFor(cfg: GamepadConfig, layout: Record<StickRole, number>, role: StickRole): number {
  const bound = cfg.axisMap[role];
  return Number.isInteger(bound) && bound >= 0 ? bound : layout[role];
}

/** The layout to read: a standard-mapped pad always uses the game-controller layout, 'auto' otherwise means AETR. */
export function layoutFor(cfg: GamepadConfig, profile: 'standard' | 'radio'): Record<StickRole, number> {
  return AXIS_LAYOUTS[profile === 'standard' ? 'standard' : cfg.layout === 'auto' ? 'AETR' : cfg.layout];
}

/** The axis every role currently reads, for showing the pilot what is bound. */
export function resolvedAxisMap(cfg: GamepadConfig, profile: 'standard' | 'radio'): Record<StickRole, number> {
  const layout = layoutFor(cfg, profile);
  const out = {} as Record<StickRole, number>;
  for (const role of ROLES) out[role] = axisFor(cfg, layout, role);
  return out;
}

/**
 * How far an axis must travel from the value it held when listening began before it counts as the
 * one the pilot moved. Comfortably above the drift an idle stick shows and below half travel.
 */
export const AXIS_DETECT_THRESHOLD = 0.3;

/**
 * The axis that has moved furthest from `baseline`, or -1 when none has moved far enough to be
 * sure. Direction is deliberately ignored: a stick is "moved" whether it is pushed or pulled.
 */
export function detectMovedAxis(baseline: ArrayLike<number>, current: ArrayLike<number>, threshold = AXIS_DETECT_THRESHOLD): number {
  const n = Math.min(baseline.length, current.length);
  let best = -1;
  let bestMove = threshold;
  for (let i = 0; i < n; i++) {
    const from = baseline[i], to = current[i];
    if (!Number.isFinite(from) || !Number.isFinite(to)) continue;
    const move = Math.abs(to - from);
    if (move > bestMove) {
      bestMove = move;
      best = i;
    }
  }
  return best;
}

/** A pad input the pilot moved or pressed. */
export type PadInput = { kind: 'axis'; index: number } | { kind: 'button'; index: number };

function down(b: PadButton): boolean {
  return b.pressed || b.value > 0.5;
}

/**
 * The pad input that changed most since listening began, or null when nothing has moved far enough to be
 * sure. A button press wins outright: it is the deliberate thing the pilot just did, and an axis drifting
 * under a thumb can be moving at the same time. Direction is ignored, so a stick counts whether it is
 * pushed or pulled.
 */
export function detectPadInput(
  baseline: { axes: ArrayLike<number>; buttons: ArrayLike<PadButton> },
  current: { axes: ArrayLike<number>; buttons: ArrayLike<PadButton> },
  threshold = AXIS_DETECT_THRESHOLD,
): PadInput | null {
  const n = Math.min(baseline.buttons.length, current.buttons.length);
  for (let i = 0; i < n; i++) if (down(current.buttons[i]) && !down(baseline.buttons[i])) return { kind: 'button', index: i };
  const axis = detectMovedAxis(baseline.axes, current.axes, threshold);
  return axis >= 0 ? { kind: 'axis', index: axis } : null;
}

/**
 * Binds `role` to raw axis `axis`. One axis drives one role, so any other role already bound to it
 * is put back on the layout instead of being left fighting it for the same input.
 */
export function bindAxis(cfg: GamepadConfig, role: StickRole, axis: number): GamepadConfig {
  if (!Number.isInteger(axis) || axis < 0) return cfg;
  const axisMap = { ...cfg.axisMap, [role]: axis };
  for (const other of ROLES) if (other !== role && axisMap[other] === axis) axisMap[other] = -1;
  return { ...cfg, axisMap };
}

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
  /** Every bound action, on or off right now. `arm` is a press; an arm bound to a switch reads `armSwitch` instead. */
  aux: Record<PadAction, boolean>;
  profile: 'standard' | 'radio';
}

export function createPadSample(): PadSample {
  return {
    roll: 0, pitch: 0, yaw: 0, throttleDirect: 0, throttleDefl: 0,
    hasArmSwitch: false, armSwitch: false, hasModeSwitch: false, modeSwitch: 'acro',
    aux: emptyAux(), profile: 'radio',
  };
}

function emptyAux(): Record<PadAction, boolean> {
  const out = {} as Record<PadAction, boolean>;
  for (const a of PAD_ACTIONS) out[a] = false;
  return out;
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

function stickValue(pad: PadLike, cfg: GamepadConfig, layout: Record<StickRole, number>, role: StickRole, flip: boolean): number {
  const raw = axisAt(pad, axisFor(cfg, layout, role));
  return raw === null ? 0 : shapeStick(normSigned(raw, cfg.cal[role], flip), cfg.deadzone, cfg.expo);
}

/** Applies calibration, deadzone and expo, then reads every bound action. Pure: same pad + config always gives the same sample. */
export function mapGamepad(pad: PadLike, cfg: GamepadConfig, out: PadSample): void {
  const profile = resolveProfile(pad, cfg);
  const std = profile === 'standard';
  const layout = layoutFor(cfg, profile);
  out.profile = profile;
  out.roll = stickValue(pad, cfg, layout, 'roll', std && STANDARD_INVERT.roll);
  out.pitch = stickValue(pad, cfg, layout, 'pitch', std && STANDARD_INVERT.pitch);
  out.yaw = stickValue(pad, cfg, layout, 'yaw', std && STANDARD_INVERT.yaw);
  const tRaw = axisAt(pad, axisFor(cfg, layout, 'throttle'));
  if (tRaw === null) {
    out.throttleDirect = 0;
    out.throttleDefl = 0;
  } else {
    const flip = std && STANDARD_INVERT.throttle;
    out.throttleDirect = normUnit(tRaw, cfg.cal.throttle, flip);
    out.throttleDefl = shapeStick(normSigned(tRaw, cfg.cal.throttle, flip), cfg.deadzone, 0);
  }
  const armRaw = axisAt(pad, axisFor(cfg, layout, 'arm'));
  out.hasArmSwitch = armRaw !== null;
  out.armSwitch = armRaw !== null && normSigned(armRaw, cfg.cal.arm) > 0.5;
  const modeRaw = axisAt(pad, axisFor(cfg, layout, 'mode'));
  out.hasModeSwitch = modeRaw !== null;
  out.modeSwitch = modeRaw === null ? 'acro' : switchMode(normSigned(modeRaw, cfg.cal.mode));

  for (const action of PAD_ACTIONS) out.aux[action] = bindOn(pad, cfg.actions[action]);
  // Arm bound to a two-position switch is positional rather than a press: the caller toggles on the
  // crossing, so the state is reported as `armSwitch` and the press edge is suppressed to avoid a double toggle.
  if (cfg.actions.arm.kind === 'switch2') {
    out.aux.arm = false;
    out.hasArmSwitch = true;
    out.armSwitch = bindOn(pad, cfg.actions.arm);
  }
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
  const layout = layoutFor(cfg, profile);
  const next: GamepadConfig = { ...cfg, cal: { ...cfg.cal } };
  for (const role of roles) {
    // Calibration has to read the axis the role actually uses, or a remapped stick calibrates its neighbour.
    const i = axisFor(cfg, layout, role);
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

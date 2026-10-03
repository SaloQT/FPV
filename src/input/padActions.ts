/**
 * Which pad input drives each action, and how it is read.
 *
 * A radio's aux switch, a hat switch, a throttle-lever toggle and a plain button are all "some axis or
 * button, read this way", so one table covers every device. The stick roles in gamepadMap.ts decide where
 * roll, pitch, yaw and throttle come from; this decides what the switches and buttons do.
 */
import type { PadLike } from './gamepadMap';

/** The actions a pilot can put on a switch, a hat or a button. */
export type PadAction = 'arm' | 'turtle' | 'camera' | 'respawn' | 'resetTrack' | 'newTrack' | 'modeCycle' | 'menu' | 'help' | 'perf';

/** Every action, in the order the settings screen lists them. */
export const PAD_ACTIONS: readonly PadAction[] = [
  'arm', 'turtle', 'camera', 'respawn', 'resetTrack', 'newTrack', 'modeCycle', 'menu', 'help', 'perf',
];

/** How a bound input is read: nothing, a digital press, a two-position switch or a three-position switch. */
export type BindKind = 'none' | 'button' | 'switch2' | 'switch3';

/** How far a two-position switch must travel before it counts as on. */
export const SWITCH_ON_THRESHOLD = 0.5;
/** Where a three-position switch's outer detents sit, as a fraction of travel. */
export const SWITCH3_OUTER = 0.33;

export interface ActionBind {
  kind: BindKind;
  /** Index into the pad's buttons or axes; -1 leaves the action to the keyboard. */
  index: number;
  /** switch2 only: which end of the travel is on, +1 or -1. */
  dir: 1 | -1;
  /** switch3 only: which third is on, 0 low, 1 middle, 2 high. */
  step: 0 | 1 | 2;
}

export type ActionBinds = Record<PadAction, ActionBind>;

const UNBOUND: ActionBind = { kind: 'none', index: -1, dir: 1, step: 1 };

function button(index: number): ActionBind {
  return { kind: 'button', index, dir: 1, step: 1 };
}

/**
 * The default wiring: the standard-mapping button numbers the sim has always used, and the four actions
 * that were keyboard-only until now left unbound so a pad never steals a key the pilot is already using.
 */
export function defaultActionBinds(): ActionBinds {
  return {
    arm: button(0),
    turtle: button(1),
    camera: button(2),
    respawn: button(3),
    resetTrack: UNBOUND,
    newTrack: UNBOUND,
    modeCycle: button(4),
    menu: button(9),
    help: UNBOUND,
    perf: UNBOUND,
  };
}

export interface PadActionInfo {
  label: string;
  hint: string;
  /** The keyboard key that does the same thing, so the default of "unbound" still has a way in. */
  key: string;
}

/** What each action does, for the settings screen. */
export const PAD_ACTION_INFO: Readonly<Record<PadAction, PadActionInfo>> = {
  arm: { label: 'Arm / disarm', hint: 'Toggles arming. Leave it on a switch if your radio has a kill switch.', key: 'Space' },
  turtle: { label: 'Turtle mode', hint: 'Held: spins the motors in reverse to flip a quad that landed upside down.', key: 'T' },
  camera: { label: 'Camera', hint: 'Cycles the FPV, chase and orbit views.', key: 'C' },
  respawn: { label: 'Respawn', hint: 'Puts the quad back on the pad.', key: 'R' },
  resetTrack: { label: 'Reset track', hint: 'Back to the start gate with the timer and the gates reset.', key: 'Backspace' },
  newTrack: { label: 'New track', hint: 'Generates a fresh track on the same terrain.', key: 'N' },
  modeCycle: { label: 'Flight mode', hint: 'Cycles acro, angle and horizon.', key: 'V' },
  menu: { label: 'Menu', hint: 'Opens and closes the settings.', key: 'Esc' },
  help: { label: 'Help sheet', hint: 'Shows the keyboard and control reference.', key: 'F1' },
  perf: { label: 'Performance overlay', hint: 'Shows frame times and the render budget.', key: 'F3' },
};

export const BIND_KIND_LABELS: Readonly<Record<BindKind, string>> = {
  none: 'Unbound',
  button: 'Button',
  switch2: '2-position',
  switch3: '3-position',
};

export function unboundBind(): ActionBind {
  return { ...UNBOUND };
}

/** Is the bound input on right now? `none` is always off, and a bad index reads as off rather than throwing. */
export function bindOn(pad: PadLike, bind: ActionBind): boolean {
  if (bind.index < 0) return false;
  if (bind.kind === 'button') return bind.index < pad.buttons.length && pad.buttons[bind.index].pressed;
  if (bind.index >= pad.axes.length) return false;
  const v = pad.axes[bind.index];
  if (!Number.isFinite(v)) return false;
  if (bind.kind === 'switch2') return v * bind.dir > SWITCH_ON_THRESHOLD;
  if (bind.kind === 'switch3') return v < -SWITCH3_OUTER ? bind.step === 0 : v > SWITCH3_OUTER ? bind.step === 2 : bind.step === 1;
  return false;
}

/** The same input, read the other way round: for flipping which end of a two-position switch is on. */
export function flipBind(bind: ActionBind): ActionBind {
  return bind.kind === 'switch2' ? { ...bind, dir: bind.dir === 1 ? -1 : 1 } : bind;
}

/** The next three-position detent, for cycling a hat switch through low, middle and high. */
export function nextStep(bind: ActionBind): ActionBind {
  return bind.kind === 'switch3' ? { ...bind, step: ((bind.step + 1) % 3) as 0 | 1 | 2 } : bind;
}

/** "Button 4" or "Axis 3, high end", for the chip that shows the current binding. */
export function describeBind(bind: ActionBind): string {
  if (bind.kind === 'none' || bind.index < 0) return 'not set';
  const where = `${bind.kind === 'button' ? 'Button' : 'Axis'} ${bind.index + 1}`;
  if (bind.kind === 'switch2') return `${where}, ${bind.dir === 1 ? 'high' : 'low'} end`;
  if (bind.kind === 'switch3') return `${where}, ${['low', 'middle', 'high'][bind.step]} detent`;
  return where;
}

const KINDS: readonly BindKind[] = ['none', 'button', 'switch2', 'switch3'];

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function sanitizeBind(v: unknown, fallback: ActionBind): ActionBind {
  if (!isRecord(v)) return { ...fallback };
  const kind = KINDS.includes(v.kind as BindKind) ? (v.kind as BindKind) : fallback.kind;
  const index = typeof v.index === 'number' && Number.isInteger(v.index) ? Math.min(Math.max(v.index, -1), 63) : fallback.index;
  const dir = v.dir === -1 ? -1 : 1;
  const step = v.step === 0 || v.step === 2 ? v.step : 1;
  return { kind, index: kind === 'none' ? -1 : index, dir, step };
}

/**
 * Validates stored action bindings over the defaults. Accepts the old `buttons: {arm: 0, ...}` shape so
 * settings saved before this table existed keep their working wiring.
 */
export function sanitizeActionBinds(raw: unknown, legacyButtons?: unknown): ActionBinds {
  const d = defaultActionBinds();
  const legacy = isRecord(legacyButtons) ? legacyButtons : {};
  for (const action of PAD_ACTIONS) {
    const fromTable = isRecord(raw) ? raw[action] : undefined;
    if (fromTable === undefined) {
      // Pre-table settings only had button indices, where -1 meant the pilot had unbound it.
      const old = legacy[action];
      if (typeof old === 'number' && Number.isInteger(old)) d[action] = old < 0 ? unboundBind() : button(Math.min(old, 63));
      continue;
    }
    d[action] = sanitizeBind(fromTable, d[action]);
  }
  return d;
}

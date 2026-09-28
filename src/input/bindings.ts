import type { InputAction } from './types';

/** Held-key axes: values are `KeyboardEvent.code`s, so bindings are layout independent. */
export type KeyAxisId =
  | 'throttleUp'
  | 'throttleDown'
  | 'throttleCut'
  | 'boost'
  | 'yawLeft'
  | 'yawRight'
  | 'rollLeft'
  | 'rollRight'
  | 'pitchUp'
  | 'pitchDown'
  | 'turtle';

export interface Bindings {
  actions: Record<InputAction, readonly string[]>;
  axes: Record<KeyAxisId, readonly string[]>;
}

export const DEFAULT_BINDINGS: Bindings = {
  actions: {
    'arm-toggle': ['Space'],
    respawn: ['KeyR'],
    'reset-track': ['Backspace'],
    'new-track': ['KeyN'],
    'camera-cycle': ['KeyC'],
    'mode-cycle': ['KeyV'],
    'toggle-menu': ['Escape'],
    'toggle-help': ['F1'],
    'toggle-perf': ['F3'],
    'time-forward': ['Period'],
    'time-back': ['Comma'],
    pause: ['KeyP'],
  },
  axes: {
    throttleUp: ['KeyW'],
    throttleDown: ['KeyS'],
    throttleCut: ['KeyX'],
    boost: ['ShiftLeft', 'ShiftRight'],
    yawLeft: ['KeyA'],
    yawRight: ['KeyD'],
    rollLeft: ['KeyQ', 'ArrowLeft'],
    rollRight: ['KeyE', 'ArrowRight'],
    pitchUp: ['ArrowUp'],
    pitchDown: ['ArrowDown'],
    turtle: ['KeyT'],
  },
};

/** Actions that keep firing while their key is held (browser key repeat). */
export const REPEATABLE_ACTIONS: ReadonlySet<InputAction> = new Set<InputAction>(['time-forward', 'time-back']);

/** UI-level actions stay live while a text field has focus or the menu is open. */
export const UI_ACTIONS: ReadonlySet<InputAction> = new Set<InputAction>(['toggle-menu', 'toggle-help', 'toggle-perf']);

/** Unbound keys whose browser default (focus jump) must still be suppressed while flying; bound keys are always suppressed. */
export const SWALLOWED_KEYS: ReadonlySet<string> = new Set(['Tab']);

export interface CompiledBindings {
  action: Map<string, InputAction>;
  axis: Map<string, KeyAxisId>;
}

export function compileBindings(b: Bindings): CompiledBindings {
  const action = new Map<string, InputAction>();
  const axis = new Map<string, KeyAxisId>();
  for (const id of Object.keys(b.actions) as InputAction[]) for (const code of b.actions[id]) action.set(code, id);
  for (const id of Object.keys(b.axes) as KeyAxisId[]) for (const code of b.axes[id]) axis.set(code, id);
  return { action, axis };
}

const SPECIAL_LABELS: Record<string, string> = {
  Space: 'Space',
  Escape: 'Esc',
  ShiftLeft: 'Shift',
  ShiftRight: 'Shift',
  ArrowUp: 'Up',
  ArrowDown: 'Down',
  ArrowLeft: 'Left',
  ArrowRight: 'Right',
  Comma: ',',
  Period: '.',
  Backspace: 'Backspace',
  Tab: 'Tab',
};

export function keyLabel(code: string): string {
  const special = SPECIAL_LABELS[code];
  if (special !== undefined) return special;
  if (code.startsWith('Key')) return code.slice(3);
  if (code.startsWith('Digit')) return code.slice(5);
  return code;
}

/** Distinct labels for a binding list ("Shift" for both shift keys), joined for display. */
export function keysLabel(codes: readonly string[]): string {
  const seen: string[] = [];
  for (const c of codes) {
    const l = keyLabel(c);
    if (!seen.includes(l)) seen.push(l);
  }
  return seen.join(' / ');
}

export const ACTION_LABELS: Record<InputAction, string> = {
  'arm-toggle': 'Arm / disarm',
  respawn: 'Respawn at last gate',
  'reset-track': 'Restart run',
  'new-track': 'Generate new track',
  'camera-cycle': 'Cycle camera (FPV / chase / free)',
  'mode-cycle': 'Cycle flight mode (Acro / Angle / Horizon)',
  'toggle-menu': 'Menu and settings',
  'toggle-help': 'Controls cheat sheet',
  'toggle-perf': 'Performance overlay',
  'time-forward': 'Time of day +15 min (hold to repeat)',
  'time-back': 'Time of day -15 min (hold to repeat)',
  pause: 'Pause',
};

export const AXIS_LABELS: Record<KeyAxisId, string> = {
  throttleUp: 'Throttle up (latched, hold to ramp)',
  throttleDown: 'Throttle down',
  throttleCut: 'Throttle cut to zero',
  boost: 'Faster throttle ramp (x2.5)',
  yawLeft: 'Yaw left',
  yawRight: 'Yaw right',
  rollLeft: 'Roll left',
  rollRight: 'Roll right',
  pitchUp: 'Pitch nose up',
  pitchDown: 'Pitch nose down',
  turtle: 'Turtle mode (hold, flips an upside-down quad)',
};

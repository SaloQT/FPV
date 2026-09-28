import { ACTION_LABELS, AXIS_LABELS, DEFAULT_BINDINGS, keyLabel, type Bindings, type KeyAxisId } from '../input/bindings';
import { defaultGamepadConfig, type PadButtons } from '../input/gamepadMap';
import type { InputAction } from '../input/types';

export interface HelpRow {
  /** One entry per key cap; empty when the action has no binding. */
  keys: readonly string[];
  label: string;
}

export interface HelpSection {
  title: string;
  rows: readonly HelpRow[];
}

/** Button names of the standard gamepad layout, by index. */
const PAD_BUTTON_NAMES = ['A', 'B', 'X', 'Y', 'LB', 'RB', 'LT', 'RT', 'Back', 'Start', 'L3', 'R3'];

const PAD_BUTTON_LABELS: Record<keyof PadButtons, string> = {
  arm: 'Arm / disarm',
  turtle: 'Turtle mode (hold)',
  camera: 'Cycle camera',
  respawn: 'Respawn',
  modeCycle: 'Cycle flight mode',
  menu: 'Menu and settings',
};

const FLIGHT: readonly InputAction[] = ['arm-toggle', 'respawn', 'reset-track', 'mode-cycle', 'pause'];
const WORLD: readonly InputAction[] = ['camera-cycle', 'new-track', 'time-back', 'time-forward'];
const INTERFACE: readonly InputAction[] = ['toggle-menu', 'toggle-help', 'toggle-perf'];
const STICK_KEYS: readonly KeyAxisId[] = [
  'throttleUp', 'throttleDown', 'throttleCut', 'boost', 'yawLeft', 'yawRight', 'rollLeft', 'rollRight', 'pitchUp', 'pitchDown', 'turtle',
];

/** Distinct key caps for a binding list; both Shift keys read "Shift" once. */
export function keyCaps(codes: readonly string[]): string[] {
  const caps: string[] = [];
  for (const c of codes) {
    const l = keyLabel(c);
    if (!caps.includes(l)) caps.push(l);
  }
  return caps;
}

function padRows(): HelpRow[] {
  const buttons = defaultGamepadConfig().buttons;
  const rows: HelpRow[] = [{ keys: ['Sticks'], label: 'Roll, pitch, yaw, throttle (calibrate in Settings)' }];
  for (const id of Object.keys(PAD_BUTTON_LABELS) as (keyof PadButtons)[]) {
    const name = PAD_BUTTON_NAMES[buttons[id]];
    if (name !== undefined) rows.push({ keys: [name], label: PAD_BUTTON_LABELS[id] });
  }
  return rows;
}

/**
 * Everything the F1 cheat sheet shows, computed from the live bindings so a rebinding shows up here. The order is chosen so
 * the sheet's CSS columns come out level: keyboard sticks, then the in-game actions, then the other input devices.
 */
export function buildHelp(bindings: Bindings = DEFAULT_BINDINGS): readonly HelpSection[] {
  const actions = (ids: readonly InputAction[]): HelpRow[] => ids.map((id) => ({ keys: keyCaps(bindings.actions[id]), label: ACTION_LABELS[id] }));
  return [
    { title: 'Keyboard sticks', rows: STICK_KEYS.map((id) => ({ keys: keyCaps(bindings.axes[id]), label: AXIS_LABELS[id] })) },
    { title: 'Flight', rows: actions(FLIGHT) },
    { title: 'Camera, track and time', rows: actions(WORLD) },
    { title: 'Interface', rows: actions(INTERFACE) },
    {
      title: 'Mouse',
      rows: [
        { keys: ['Click'], label: 'Capture the mouse; Esc gives it back' },
        { keys: ['Move'], label: 'Roll and pitch (mouse up is nose up)' },
        { keys: ['Drag'], label: 'Orbit the quad in the free camera' },
        { keys: ['Wheel'], label: 'Zoom the free camera' },
      ],
    },
    { title: 'Gamepad or radio', rows: padRows() },
  ];
}

/** The handful of controls the start screen shows before the pilot has opened the full cheat sheet. */
export function startSummary(bindings: Bindings = DEFAULT_BINDINGS): readonly HelpRow[] {
  const a = (id: InputAction): string[] => keyCaps(bindings.actions[id]);
  const ax = (...ids: KeyAxisId[]): string[] => keyCaps(ids.flatMap((id) => bindings.axes[id]));
  return [
    { keys: ['Mouse'], label: 'Roll and pitch' },
    { keys: ax('throttleUp', 'throttleDown'), label: 'Throttle up and down' },
    { keys: ax('yawLeft', 'yawRight'), label: 'Yaw' },
    { keys: a('arm-toggle'), label: 'Arm and disarm' },
    { keys: a('respawn'), label: 'Respawn' },
    { keys: a('camera-cycle'), label: 'Change camera' },
    { keys: a('toggle-menu'), label: 'Pause and settings' },
    { keys: a('toggle-help'), label: 'All controls' },
  ];
}

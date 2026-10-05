import type { FlightMode, StickInput } from '../contracts';
import type { GamepadConfig } from './gamepadMap';

/** Edge-triggered events produced by input; `turtle` is a held state carried in StickInput instead. */
export type InputAction =
  | 'arm-toggle'
  | 'respawn'
  | 'reset-track'
  | 'new-track'
  | 'camera-cycle'
  | 'mode-cycle'
  | 'toggle-menu'
  | 'toggle-help'
  | 'toggle-perf'
  | 'time-forward'
  | 'time-back'
  | 'pause';

/** What the game session needs from the pilot's controls (InputManager implements it; tests can fake it). */
export interface InputSource {
  poll(dt: number): StickInput;
  takeActions(): readonly InputAction[];
  readonly armed: boolean;
  setArmed(armed: boolean): void;
  /** Overwrites the latched throttle (0..1), e.g. to cut it after a crash or preset a hover value on respawn. */
  setThrottle(value: number): void;
  /** Centres the mouse and keyboard roll, pitch and yaw (on respawn); a key still held deflects them again on the next poll. */
  recenter(): void;
  readonly pointerLocked: boolean;
  /** False while a menu is open: sticks read zero, game keys pass through to the page, and only menu/help/perf actions fire. */
  setEnabled(enabled: boolean): void;
}

/** The slice of the settings the input layer reads. The UI's `SettingsStore` satisfies it structurally. */
export interface InputSettings {
  mode: FlightMode;
  mouseSensitivity: number;
  mouseCentering: number;
  mouseExpo: number;
  mouseDeadzone: number;
  invertY: boolean;
  gamepad: GamepadConfig;
}

export interface InputSettingsStore {
  get(): InputSettings;
  patch(partial: Partial<InputSettings>): void;
}

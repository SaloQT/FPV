import { localSolarHours } from '../game/clock';
import type { BuiltControl, ControlHost } from './menuHost';
import type { AppSettings } from './settingsSchema';

/** What a menu button asks the app to do; values are changed through `onChange` instead. */
export type MenuAction = 'start' | 'resume' | 'restart' | 'new-track' | 'reset-settings' | 'open-builder';
export type TabId = 'graphics' | 'camera' | 'controls' | 'simulation' | 'audio' | 'ai';

export interface SelectOption {
  value: string;
  label: string;
}

export interface MenuPreset {
  id: string;
  label: string;
}

interface Base {
  id: string;
  label: string;
  hint?: string;
}

export interface SliderControl extends Base {
  kind: 'slider';
  min: number;
  max: number;
  step: number;
  read(s: AppSettings): number;
  write(value: number, s: AppSettings): Partial<AppSettings>;
  format(value: number): string;
}

export interface ToggleControl extends Base {
  kind: 'toggle';
  read(s: AppSettings): boolean;
  write(value: boolean, s: AppSettings): Partial<AppSettings>;
}

export interface SelectControl extends Base {
  kind: 'select';
  options: readonly SelectOption[];
  read(s: AppSettings): string;
  write(value: string, s: AppSettings): Partial<AppSettings>;
}

export interface NumberControl extends Base {
  kind: 'number';
  min: number;
  max: number;
  read(s: AppSettings): number;
  write(value: number, s: AppSettings): Partial<AppSettings>;
  /** Offers a button that picks a random value. */
  random: boolean;
}

export interface DateControl extends Base {
  kind: 'date';
  read(s: AppSettings): string;
  write(value: string, s: AppSettings): Partial<AppSettings>;
}

export interface ButtonControl extends Base {
  kind: 'button';
  action: MenuAction;
  tone: 'default' | 'primary' | 'danger';
}

/** The live gamepad readout with the calibration buttons. */
export interface GamepadControl extends Base {
  kind: 'gamepad';
}

/** A control that builds its own DOM against the host: for settings that are not plain `AppSettings` keys. */
export interface CustomControl extends Base {
  kind: 'custom';
  build(host: ControlHost): BuiltControl;
}

export type Control = SliderControl | ToggleControl | SelectControl | NumberControl | DateControl | ButtonControl | GamepadControl | CustomControl;

export interface MenuSection {
  title: string;
  controls: readonly Control[];
}

export interface MenuTab {
  id: TabId;
  label: string;
  sections: readonly MenuSection[];
}

type KeyOf<T> = { [K in keyof AppSettings]: AppSettings[K] extends T ? K : never }[keyof AppSettings];

function set<K extends keyof AppSettings>(key: K, value: AppSettings[K]): Partial<AppSettings> {
  return { [key]: value } as Partial<AppSettings>;
}

export function slider(key: KeyOf<number>, label: string, min: number, max: number, step: number, format: (v: number) => string, hint?: string): SliderControl {
  return { kind: 'slider', id: key, label, hint, min, max, step, format, read: (s) => s[key], write: (v) => set(key, v) };
}

export function toggle(key: KeyOf<boolean>, label: string, hint?: string): ToggleControl {
  return { kind: 'toggle', id: key, label, hint, read: (s) => s[key], write: (v) => set(key, v) };
}

export function choice<K extends KeyOf<string>>(key: K, label: string, options: readonly SelectOption[], hint?: string): SelectControl {
  return { kind: 'select', id: key, label, hint, options, read: (s) => s[key] as string, write: (v) => set(key, v as AppSettings[K]) };
}

export function numberChoice(key: KeyOf<number>, label: string, options: readonly { value: number; label: string }[], hint?: string): SelectControl {
  return {
    kind: 'select', id: key, label, hint, options: options.map((o) => ({ value: String(o.value), label: o.label })),
    read: (s) => String(s[key]), write: (v) => set(key, Number(v)),
  };
}

export function button(id: string, label: string, action: MenuAction, tone: ButtonControl['tone'] = 'default', hint?: string): ButtonControl {
  return { kind: 'button', id, label, hint, action, tone };
}

export function percent(v: number): string {
  return `${Math.round(v * 100)}%`;
}

export function fixed(digits: number, unit = ''): (v: number) => string {
  return (v) => `${v.toFixed(digits)}${unit}`;
}

const POINTS = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'] as const;

/** "270° W": a bearing with its nearest of the eight compass points. */
export function bearing(deg: number): string {
  const d = ((deg % 360) + 360) % 360;
  return `${Math.round(d) % 360}° ${POINTS[Math.round(d / 45) % 8]}`;
}

const HOUR_MS = 3600000;
export const MIN_DATE_YEAR = 1950;
export const MAX_DATE_YEAR = 2100;

function pad(n: number, width: number): string {
  return String(n).padStart(width, '0');
}

/** Calendar date (YYYY-MM-DD) of the simulated local solar day at a longitude. */
export function solarDate(timeMs: number, longitudeDeg: number): string {
  const d = new Date(timeMs + (longitudeDeg / 15) * HOUR_MS);
  return `${pad(d.getUTCFullYear(), 4)}-${pad(d.getUTCMonth() + 1, 2)}-${pad(d.getUTCDate(), 2)}`;
}

/** Moves the simulated time to another calendar day, keeping the solar time of day; unusable text returns `timeMs` unchanged. */
export function withSolarDate(timeMs: number, longitudeDeg: number, ymd: string): number {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(ymd);
  if (m === null) return timeMs;
  const y = Number(m[1]), mo = Number(m[2]), day = Number(m[3]);
  if (y < MIN_DATE_YEAR || y > MAX_DATE_YEAR) return timeMs;
  const start = Date.UTC(y, mo - 1, day);
  const back = new Date(start);
  if (back.getUTCMonth() !== mo - 1 || back.getUTCDate() !== day) return timeMs;
  const hours = localSolarHours(timeMs, longitudeDeg);
  return start + hours * HOUR_MS - (longitudeDeg / 15) * HOUR_MS;
}

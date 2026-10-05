import { DEFAULT_SETTINGS, GENERATED_STYLES, type FlightMode, type GeneratedStyle, type Observer, type RenderQuality, type Settings } from '../contracts';
import { defaultGamepadConfig, type GamepadConfig } from '../input/gamepadMap';
import { sanitizeGamepadConfig } from '../input/gamepadConfig';
import { defaultRateSettings, sanitizeRateSettings, type RateSettings } from '../sim/fc/ratePresets';

/** Settings the pilot controls that the shared `Settings` contract has no room for. */
export interface UiSettings {
  /** 0..1 strength of the mouse stick's spring back to centre; 0 holds the stick where the mouse left it. */
  mouseCentering: number;
  /** 0..1 stick response curve: 0 is linear, 1 is soft around the centre. */
  mouseExpo: number;
  /** 0..0.3 stick deadzone. */
  mouseDeadzone: number;
  invertY: boolean;
  /** 0..1 strength of the motor buzz in the FPV picture. */
  camVibration: number;
  masterVolume: number;
  motorVolume: number;
  windVolume: number;
  gamepad: GamepadConfig;
  /** The radio's stick-to-rate curve: how far the quad is told to turn for a given stick deflection. */
  rates: RateSettings;
  /** Key into the airframe presets of the physics module. */
  quadPreset: string;
  /** Mean wind in m/s. */
  windSpeed: number;
  /** Compass bearing the wind blows FROM, degrees clockwise from north. */
  windDirDeg: number;
  gateCount: number;
  laps: number;
  /** 0..1 track difficulty. */
  difficulty: number;
  /** 0.5..2 multiplier on the OSD text size. */
  osdScale: number;
  showOsd: boolean;
  /** Fixed physics step rate. */
  physicsHz: number;
  /** Respawn on its own once the crash cooldown is over instead of waiting for R. */
  autoRespawn: boolean;
}

export type AppSettings = Settings & UiSettings;

export const SETTINGS_KEY = 'fpv.settings.v1';
export const SETTINGS_VERSION = 2;

/** Keys that are not written to storage: the sim clock always starts from the default time of day. */
export const TRANSIENT_KEYS: ReadonlySet<keyof AppSettings> = new Set<keyof AppSettings>(['timeMs']);

export function defaultAppSettings(): AppSettings {
  return {
    ...DEFAULT_SETTINGS,
    observer: { ...DEFAULT_SETTINGS.observer },
    mouseCentering: 0.6,
    mouseExpo: 0,
    mouseDeadzone: 0.02,
    invertY: true,
    camVibration: 0.15,
    masterVolume: 0.8,
    motorVolume: 1,
    windVolume: 1,
    gamepad: defaultGamepadConfig(),
    rates: defaultRateSettings(),
    quadPreset: 'QUAD_5IN_6S',
    windSpeed: 0,
    windDirDeg: 0,
    gateCount: 12,
    laps: 3,
    difficulty: 0.4,
    osdScale: 1,
    showOsd: true,
    physicsHz: 4000,
    autoRespawn: false,
  };
}

type Rules = { [K in keyof AppSettings]: (value: unknown, fallback: AppSettings[K]) => AppSettings[K] };

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function num(min: number, max: number, integer = false): (v: unknown, fb: number) => number {
  return (v, fb) => {
    if (typeof v !== 'number' || !Number.isFinite(v)) return fb;
    const c = Math.min(Math.max(v, min), max);
    return integer ? Math.round(c) : c;
  };
}

function bool(v: unknown, fb: boolean): boolean {
  return typeof v === 'boolean' ? v : fb;
}

/** 0 means "follow the display"; anything else is clamped to [min, max]. */
function zeroOr(min: number, max: number): (v: unknown, fb: number) => number {
  const clamp = num(min, max, true);
  return (v, fb) => (v === 0 ? 0 : clamp(v, fb));
}

function oneOf<T extends string>(values: readonly T[]): (v: unknown, fb: T) => T {
  return (v, fb) => (typeof v === 'string' && (values as readonly string[]).includes(v) ? (v as T) : fb);
}

function observer(v: unknown, fb: Observer): Observer {
  if (!isRecord(v)) return { ...fb };
  return {
    latitudeDeg: num(-90, 90)(v.latitudeDeg, fb.latitudeDeg),
    longitudeDeg: num(-180, 180)(v.longitudeDeg, fb.longitudeDeg),
    altitudeM: num(-500, 9000)(v.altitudeM, fb.altitudeM),
  };
}

function name(v: unknown, fb: string): string {
  return typeof v === 'string' && v.length > 0 && v.length <= 64 ? v : fb;
}

export const QUALITY_TIERS: readonly RenderQuality[] = ['low', 'medium', 'high', 'ultra'];
export const FLIGHT_MODES: readonly FlightMode[] = ['acro', 'angle', 'horizon'];
export const TRACK_STYLES: readonly GeneratedStyle[] = GENERATED_STYLES;
export const TIME_SCALES: readonly number[] = [0, 1, 10, 60, 600];
/** Largest magnitude `Date` accepts (ms). */
const MAX_TIME_MS = 8.64e15;

const RULES: Rules = {
  quality: oneOf(QUALITY_TIERS),
  targetFps: zeroOr(30, 1000),
  frameCap: zeroOr(15, 1000),
  performance240: bool,
  dynamicResolution: bool,
  renderScale: num(0.25, 1),
  fov: num(30, 150),
  cameraTiltDeg: num(-10, 60),
  lensDistortion: num(0, 1),
  videoNoise: num(0, 1),
  mode: oneOf(FLIGHT_MODES),
  timeMs: num(-MAX_TIME_MS, MAX_TIME_MS),
  timeScale: num(0, 3600),
  observer,
  seed: num(0, 4294967295, true),
  trackStyle: oneOf(TRACK_STYLES),
  mouseSensitivity: num(0.1, 5),
  mouseCentering: num(0, 1),
  mouseExpo: num(0, 1),
  mouseDeadzone: num(0, 0.3),
  invertY: bool,
  camVibration: num(0, 1),
  masterVolume: num(0, 1),
  motorVolume: num(0, 1),
  windVolume: num(0, 1),
  gamepad: (v, fb) => (isRecord(v) ? sanitizeGamepadConfig(v) : fb),
  rates: (v, fb) => sanitizeRateSettings(v, fb),
  quadPreset: name,
  windSpeed: num(0, 30),
  windDirDeg: num(0, 360),
  gateCount: num(4, 40, true),
  laps: num(1, 10, true),
  difficulty: num(0, 1),
  osdScale: num(0.5, 2),
  showOsd: bool,
  physicsHz: num(250, 16000, true),
  autoRespawn: bool,
};

export const SETTING_KEYS = Object.keys(RULES) as (keyof AppSettings)[];

/** Validates one value against the schema: wrong types fall back to `fallback`, numbers are clamped. */
export function sanitizeValue<K extends keyof AppSettings>(key: K, value: unknown, fallback: AppSettings[K]): AppSettings[K] {
  return RULES[key](value, fallback);
}

/** Validates a whole untrusted object over `base`: unknown keys are dropped, bad values keep the base's. */
export function sanitizeSettings(raw: unknown, base: AppSettings): AppSettings {
  const out = { ...base };
  if (!isRecord(raw)) return out;
  const target = out as Record<keyof AppSettings, unknown>;
  for (const key of SETTING_KEYS) if (Object.prototype.hasOwnProperty.call(raw, key)) target[key] = sanitizeValue(key, raw[key], base[key]);
  return out;
}

/** Storage payload: current versions are wrapped as `{version, settings}`; older builds saved the settings bare. */
export function migrateStored(raw: unknown): Record<string, unknown> | null {
  if (!isRecord(raw)) return null;
  if (typeof raw.version === 'number' && isRecord(raw.settings)) {
    // Version 1 saved the old non-inverted default, indistinguishably from a chosen value.
    return raw.version < 2 ? { ...raw.settings, invertY: true } : raw.settings;
  }
  return { ...raw, invertY: true };
}

/** Structural equality for plain JSON-like values; object key order does not matter. */
export function isSameValue(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeof a !== 'object' || typeof b !== 'object' || a === null || b === null) return false;
  if (Array.isArray(a) || Array.isArray(b)) {
    if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return false;
    return a.every((v, i) => isSameValue(v, b[i]));
  }
  const ka = Object.keys(a);
  if (ka.length !== Object.keys(b).length) return false;
  const rb = b as Record<string, unknown>;
  return ka.every((k) => Object.prototype.hasOwnProperty.call(rb, k) && isSameValue((a as Record<string, unknown>)[k], rb[k]));
}

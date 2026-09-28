import { clamp } from './curves';
import { defaultGamepadConfig, type AxisCal, type GamepadConfig, type PadButtons, type StickRole } from './gamepadMap';

const PROFILES = ['auto', 'standard', 'radio'] as const;
const THROTTLE_MODES = ['auto', 'direct', 'latched', 'hover'] as const;
const ORDERS = ['AETR', 'TAER'] as const;
const ROLES: readonly StickRole[] = ['roll', 'pitch', 'yaw', 'throttle', 'arm', 'mode'];
const BUTTON_KEYS: readonly (keyof PadButtons)[] = ['arm', 'turtle', 'camera', 'respawn', 'modeCycle', 'menu'];

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function num(v: unknown, fallback: number, lo: number, hi: number): number {
  return typeof v === 'number' && Number.isFinite(v) ? clamp(v, lo, hi) : fallback;
}

function pick<T extends string>(v: unknown, allowed: readonly T[], fallback: T): T {
  return typeof v === 'string' && (allowed as readonly string[]).includes(v) ? (v as T) : fallback;
}

function sanitizeCal(v: unknown, fallback: AxisCal): AxisCal {
  if (!isRecord(v)) return { ...fallback };
  const min = num(v.min, fallback.min, -4, 4);
  const max = num(v.max, fallback.max, -4, 4);
  if (max - min < 0.05) return { ...fallback };
  return { min, max, center: clamp(num(v.center, fallback.center, -4, 4), min, max), invert: typeof v.invert === 'boolean' ? v.invert : fallback.invert };
}

/** Validates untrusted (persisted) gamepad settings: unknown keys are dropped and every number is clamped. */
export function sanitizeGamepadConfig(v: unknown): GamepadConfig {
  const d = defaultGamepadConfig();
  if (!isRecord(v)) return d;
  const cal = isRecord(v.cal) ? v.cal : {};
  const buttons = isRecord(v.buttons) ? v.buttons : {};
  for (const role of ROLES) d.cal[role] = sanitizeCal(cal[role], d.cal[role]);
  for (const key of BUTTON_KEYS) d.buttons[key] = typeof buttons[key] === 'number' && Number.isInteger(buttons[key]) ? clamp(buttons[key] as number, -1, 31) : d.buttons[key];
  d.profile = pick(v.profile, PROFILES, d.profile);
  d.throttleMode = pick(v.throttleMode, THROTTLE_MODES, d.throttleMode);
  d.radioOrder = pick(v.radioOrder, ORDERS, d.radioOrder);
  d.deadzone = num(v.deadzone, d.deadzone, 0, 0.4);
  d.expo = num(v.expo, d.expo, 0, 1);
  d.hoverThrottle = num(v.hoverThrottle, d.hoverThrottle, 0.1, 0.6);
  return d;
}

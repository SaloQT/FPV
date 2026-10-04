import { clamp } from './curves';
import { defaultGamepadConfig, ROLES, STICK_LAYOUTS, type AxisCal, type GamepadConfig, type StickRole } from './gamepadMap';
import { sanitizeActionBinds } from './padActions';

const PROFILES = ['auto', 'standard', 'radio'] as const;
const THROTTLE_MODES = ['auto', 'direct', 'latched', 'hover'] as const;

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
  const axisMap = isRecord(v.axisMap) ? v.axisMap : {};
  for (const role of ROLES) d.cal[role] = sanitizeCal(cal[role], d.cal[role]);
  for (const role of ROLES) {
    const a = axisMap[role];
    d.axisMap[role] = typeof a === 'number' && Number.isInteger(a) ? clamp(a, -1, 31) : -1;
  }
  // `buttons` is what older builds saved; the table takes over when it is present and it fills the gaps when it is not.
  d.actions = sanitizeActionBinds(v.actions, v.buttons);
  d.profile = pick(v.profile, PROFILES, d.profile);
  d.throttleMode = pick(v.throttleMode, THROTTLE_MODES, d.throttleMode);
  // `radioOrder` is the old name for the two radio layouts, so a saved TAER still reads as TAER.
  const layout = v.layout !== undefined ? v.layout : v.radioOrder;
  d.layout = pick(layout, STICK_LAYOUTS, d.layout);
  d.deadzone = num(v.deadzone, d.deadzone, 0, 0.4);
  d.expo = num(v.expo, d.expo, 0, 1);
  d.hoverThrottle = num(v.hoverThrottle, d.hoverThrottle, 0.1, 0.6);
  return d;
}

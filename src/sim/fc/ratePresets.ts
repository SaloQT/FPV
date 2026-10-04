/**
 * Named rate curves, the pilot's stored rate settings and the stick-to-rate response table.
 *
 * The WebFPV rate calculator names presets like SALOQT by their Betaflight numbers, and `rates.ts` already evaluates
 * Betaflight's own formula, so a preset here maps one-to-one: the deg/s figures the calculator prints come out of the
 * same expression the flight controller flies. Nothing here approximates a curve.
 */
import { RATE_TYPES, stickToRate, type AxisRates, type RateProfile, type RateType } from './rates';

/** The rate settings a pilot keeps: a profile plus Betaflight's "separate pitch" switch. */
export interface RateSettings extends RateProfile {
  /** Betaflight's "separate pitch": off makes the pitch axis follow the roll rates. */
  separatePitch: boolean;
}

/** The number, range and step of one rate field, which depend on the rate type's units. */
export interface RateField {
  min: number;
  max: number;
  step: number;
}

export type RateFieldName = 'rcRate' | 'superRate' | 'expo';
export type RateAxis = 'roll' | 'pitch' | 'yaw';

const DEG_S_FIELDS: Readonly<Record<RateFieldName, RateField>> = {
  rcRate: { min: 0, max: 400, step: 1 },
  superRate: { min: 0, max: 2000, step: 5 },
  expo: { min: 0, max: 1, step: 0.01 },
};
/** Betaflight's rc rate is a multiplier on 200 deg/s and its super rate a 0..0.99 curve knee, not a deg/s figure. */
const BETAFLIGHT_FIELDS: Readonly<Record<RateFieldName, RateField>> = {
  rcRate: { min: 0, max: 5, step: 0.01 },
  superRate: { min: 0, max: 0.99, step: 0.01 },
  expo: { min: 0, max: 1, step: 0.01 },
};

/** The slider range of every rate field, per rate type. */
export const RATE_FIELDS: Readonly<Record<RateType, Readonly<Record<RateFieldName, RateField>>>> = {
  actual: DEG_S_FIELDS,
  quick: DEG_S_FIELDS,
  betaflight: BETAFLIGHT_FIELDS,
};

/** Stick deflections the response table quotes, as fractions of full stick. */
export const RESPONSE_STICKS: readonly number[] = [0.25, 0.5, 1];

export function cloneAxisRates(r: AxisRates): AxisRates {
  return { rcRate: r.rcRate, superRate: r.superRate, expo: r.expo };
}

export function cloneRateSettings(s: RateSettings): RateSettings {
  return { type: s.type, separatePitch: s.separatePitch, roll: cloneAxisRates(s.roll), pitch: cloneAxisRates(s.pitch), yaw: cloneAxisRates(s.yaw) };
}

/**
 * The WebFPV SALOQT preset: Betaflight rates with separate pitch, 1.80 / 0.64 / 0.25 on roll and pitch and
 * 1.00 / 0.64 / 0.25 on yaw. It answers 81 / 207 / 1000 deg/s on roll and pitch and 45 / 115 / 556 deg/s on yaw.
 */
export const SALOQT_RATES: RateSettings = {
  type: 'betaflight',
  separatePitch: true,
  roll: { rcRate: 1.8, superRate: 0.64, expo: 0.25 },
  pitch: { rcRate: 1.8, superRate: 0.64, expo: 0.25 },
  yaw: { rcRate: 1, superRate: 0.64, expo: 0.25 },
};

/** The sim's own rates before the pilot touched them: 70 deg/s at stick centre, easing out to 670 / 600 at full stick. */
export const SIM_RATES: RateSettings = {
  type: 'actual',
  separatePitch: true,
  roll: { rcRate: 70, superRate: 670, expo: 0 },
  pitch: { rcRate: 70, superRate: 670, expo: 0 },
  yaw: { rcRate: 70, superRate: 600, expo: 0 },
};

export interface RatePreset {
  id: string;
  label: string;
  hint: string;
  settings: RateSettings;
}

export const RATE_PRESETS: readonly RatePreset[] = [
  {
    id: 'saloqt',
    label: 'SALOQT (WebFPV)',
    hint: 'The WebFPV SALOQT preset: Betaflight rates, separate pitch, 1.80 / 0.64 / 0.25 on roll and pitch and 1.00 / 0.64 / 0.25 on yaw.',
    settings: SALOQT_RATES,
  },
  {
    id: 'sim',
    label: 'Sim default',
    hint: 'The sim\'s own default rates: 70 deg/s at stick centre, easing out to 670 deg/s on roll and pitch and 600 deg/s on yaw at full stick.',
    settings: SIM_RATES,
  },
];

/** The preset name when the pilot's numbers match none of them. */
export const CUSTOM_RATES = 'custom';

/** What the sim starts a fresh pilot with. */
export function defaultRateSettings(): RateSettings {
  return cloneRateSettings(SALOQT_RATES);
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function numberIn(v: unknown, fb: number, f: RateField): number {
  if (typeof v !== 'number' || !Number.isFinite(v)) return fb;
  return Math.min(Math.max(v, f.min), f.max);
}

function axisIn(v: unknown, fb: AxisRates, fields: Readonly<Record<RateFieldName, RateField>>): AxisRates {
  if (!isRecord(v)) return cloneAxisRates(fb);
  return {
    rcRate: numberIn(v.rcRate, fb.rcRate, fields.rcRate),
    superRate: numberIn(v.superRate, fb.superRate, fields.superRate),
    expo: numberIn(v.expo, fb.expo, fields.expo),
  };
}

/**
 * Validates stored rate settings over `base`. The clamp depends on the rate type, because the same field means
 * 200 deg/s per unit under "actual" and a 0..0.99 knee under "betaflight".
 */
export function sanitizeRateSettings(raw: unknown, base: RateSettings): RateSettings {
  if (!isRecord(raw)) return cloneRateSettings(base);
  const type = RATE_TYPES.includes(raw.type as RateType) ? (raw.type as RateType) : base.type;
  const fields = RATE_FIELDS[type];
  return {
    type,
    separatePitch: typeof raw.separatePitch === 'boolean' ? raw.separatePitch : base.separatePitch,
    roll: axisIn(raw.roll, base.roll, fields),
    pitch: axisIn(raw.pitch, base.pitch, fields),
    yaw: axisIn(raw.yaw, base.yaw, fields),
  };
}

function sameAxis(a: AxisRates, b: AxisRates): boolean {
  return a.rcRate === b.rcRate && a.superRate === b.superRate && a.expo === b.expo;
}

function sameSettings(a: RateSettings, b: RateSettings): boolean {
  return a.type === b.type && a.separatePitch === b.separatePitch && sameAxis(a.roll, b.roll) && sameAxis(a.pitch, b.pitch) && sameAxis(a.yaw, b.yaw);
}

/** The id of the preset the numbers match, or `CUSTOM_RATES`. */
export function matchRatePreset(settings: RateSettings, presets: readonly RatePreset[] = RATE_PRESETS): string {
  for (const p of presets) if (sameSettings(settings, p.settings)) return p.id;
  return CUSTOM_RATES;
}

/** The profile the flight controller flies: with separate pitch off, pitch follows roll. */
export function rateProfileOf(s: RateSettings): RateProfile {
  return { type: s.type, roll: s.roll, pitch: s.separatePitch ? s.pitch : s.roll, yaw: s.yaw };
}

/** The rate setpoint in deg/s at each of `RESPONSE_STICKS`, rounded like the WebFPV calculator's table. */
export function rateResponse(profile: RateProfile, axis: RateAxis): number[] {
  return RESPONSE_STICKS.map((f) => Math.round(stickToRate(profile.type, profile[axis], f)));
}

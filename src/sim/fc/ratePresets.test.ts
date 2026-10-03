import { describe, expect, it } from 'vitest';
import {
  CUSTOM_RATES, RATE_PRESETS, SALOQT_RATES, SIM_RATES, cloneRateSettings, defaultRateSettings, matchRatePreset,
  rateProfileOf, rateResponse, sanitizeRateSettings, type RateSettings,
} from './ratePresets';
import { maxRate, stickToRate } from './rates';

/** The deg/s figures the WebFPV rate calculator prints for the SALOQT preset. */
const SALOQT_RESPONSE = { roll: [81, 207, 1000], pitch: [81, 207, 1000], yaw: [45, 115, 556] };

describe('SALOQT preset', () => {
  it('holds the numbers the preset is named for', () => {
    expect(SALOQT_RATES.type).toBe('betaflight');
    expect(SALOQT_RATES.separatePitch).toBe(true);
    expect(SALOQT_RATES.roll).toEqual({ rcRate: 1.8, superRate: 0.64, expo: 0.25 });
    expect(SALOQT_RATES.pitch).toEqual({ rcRate: 1.8, superRate: 0.64, expo: 0.25 });
    expect(SALOQT_RATES.yaw).toEqual({ rcRate: 1, superRate: 0.64, expo: 0.25 });
  });

  it('answers the same deg/s as the WebFPV calculator at 25, 50 and 100% stick', () => {
    const profile = rateProfileOf(SALOQT_RATES);
    expect(rateResponse(profile, 'roll')).toEqual(SALOQT_RESPONSE.roll);
    expect(rateResponse(profile, 'pitch')).toEqual(SALOQT_RESPONSE.pitch);
    expect(rateResponse(profile, 'yaw')).toEqual(SALOQT_RESPONSE.yaw);
  });

  it('reaches those figures from the real stick-to-rate function, not only the rounded table', () => {
    const profile = rateProfileOf(SALOQT_RATES);
    // The table rounds to whole deg/s; the curve itself sits within half a degree per second of every printed figure.
    for (const [axis, [quarter, half, full]] of Object.entries(SALOQT_RESPONSE) as [keyof typeof SALOQT_RESPONSE, number[]][]) {
      expect(stickToRate(profile.type, profile[axis], 0.25)).toBeCloseTo(quarter, 0);
      expect(stickToRate(profile.type, profile[axis], 0.5)).toBeCloseTo(half, 0);
      expect(stickToRate(profile.type, profile[axis], 1)).toBeCloseTo(full, 0);
    }
  });

  it('is symmetric about the stick centre', () => {
    const profile = rateProfileOf(SALOQT_RATES);
    for (const s of [0.1, 0.25, 0.5, 0.75, 1]) {
      expect(stickToRate(profile.type, profile.roll, -s)).toBeCloseTo(-stickToRate(profile.type, profile.roll, s), 9);
    }
  });

  it('answers 1000 deg/s at full stick on roll, as the preset promises', () => {
    expect(maxRate('betaflight', SALOQT_RATES.roll)).toBeCloseTo(1000, 6);
  });

  it('survives a round trip through the settings sanitiser unchanged', () => {
    expect(sanitizeRateSettings(JSON.parse(JSON.stringify(SALOQT_RATES)), SIM_RATES)).toEqual(SALOQT_RATES);
  });
});

describe('separate pitch', () => {
  it('follows the roll numbers when it is off', () => {
    const off: RateSettings = { ...cloneRateSettings(SALOQT_RATES), separatePitch: false };
    off.pitch = { rcRate: 1, superRate: 0.2, expo: 0.9 };
    const profile = rateProfileOf(off);
    expect(profile.pitch).toBe(profile.roll);
    expect(rateResponse(profile, 'pitch')).toEqual(rateResponse(profile, 'roll'));
  });

  it('keeps its own numbers when it is on', () => {
    const profile = rateProfileOf(SALOQT_RATES);
    expect(profile.pitch).toBe(SALOQT_RATES.pitch);
    expect(profile.pitch).not.toBe(profile.roll);
  });
});

describe('rate presets', () => {
  it('matches a preset when every number agrees and reports Custom otherwise', () => {
    expect(matchRatePreset(SALOQT_RATES)).toBe('saloqt');
    expect(matchRatePreset(SIM_RATES)).toBe('sim');
    const nudged = cloneRateSettings(SALOQT_RATES);
    nudged.roll.rcRate = 1.81;
    expect(matchRatePreset(nudged)).toBe(CUSTOM_RATES);
  });

  it('counts the type and the separate-pitch switch as part of the match', () => {
    const other = cloneRateSettings(SALOQT_RATES);
    other.type = 'actual';
    expect(matchRatePreset(other)).toBe(CUSTOM_RATES);
    const shared = cloneRateSettings(SALOQT_RATES);
    shared.separatePitch = false;
    expect(matchRatePreset(shared)).toBe(CUSTOM_RATES);
  });

  it('ships each preset with a hint and hands out copies, not shared objects', () => {
    for (const p of RATE_PRESETS) expect(p.hint.length).toBeGreaterThan(0);
    const copy = cloneRateSettings(SALOQT_RATES);
    copy.roll.rcRate = 9;
    expect(SALOQT_RATES.roll.rcRate).toBe(1.8);
  });

  it('starts a fresh pilot on SALOQT', () => {
    expect(defaultRateSettings()).toEqual(SALOQT_RATES);
  });
});

describe('sanitizeRateSettings', () => {
  const base = SIM_RATES;

  it('falls back to the base for anything that is not a record', () => {
    for (const raw of [null, 7, 'saloqt', [], undefined]) expect(sanitizeRateSettings(raw, base)).toEqual(base);
  });

  it('keeps the base type and numbers for bad values', () => {
    const out = sanitizeRateSettings({ type: 'wobble', separatePitch: 'yes', roll: 3, pitch: null, yaw: { rcRate: 'x' } }, base);
    expect(out.type).toBe('actual');
    expect(out.separatePitch).toBe(true);
    expect(out.roll).toEqual(base.roll);
    expect(out.pitch).toEqual(base.pitch);
    expect(out.yaw.rcRate).toBe(base.yaw.rcRate);
  });

  it('clamps by the units of the rate type, not by one global range', () => {
    const bf = sanitizeRateSettings({ type: 'betaflight', yaw: { rcRate: 99, superRate: 4, expo: 7 } }, base);
    expect(bf.yaw).toEqual({ rcRate: 5, superRate: 0.99, expo: 1 });
    const actual = sanitizeRateSettings({ type: 'actual', yaw: { rcRate: 9999, superRate: 9999, expo: 7 } }, base);
    expect(actual.yaw).toEqual({ rcRate: 400, superRate: 2000, expo: 1 });
  });

  it('drops a non-finite number rather than storing NaN', () => {
    expect(sanitizeRateSettings({ roll: { rcRate: NaN } }, base).roll.rcRate).toBe(base.roll.rcRate);
    expect(sanitizeRateSettings({ roll: { rcRate: Infinity } }, base).roll.rcRate).toBe(base.roll.rcRate);
  });

  it('never aliases the base or the raw object', () => {
    const out = sanitizeRateSettings({ roll: { rcRate: 80 } }, base);
    out.roll.rcRate = 1;
    expect(base.roll.rcRate).toBe(70);
    const raw = { roll: { rcRate: 80 } };
    sanitizeRateSettings(raw, base);
    expect(raw.roll.rcRate).toBe(80);
  });
});

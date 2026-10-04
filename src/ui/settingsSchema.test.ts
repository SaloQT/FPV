import { describe, expect, it } from 'vitest';
import { SALOQT_RATES } from '../sim/fc/ratePresets';
import { defaultAppSettings, isSameValue, migrateStored, sanitizeSettings } from './settingsSchema';

describe('stored rates', () => {
  it('starts a pilot with no saved rates on the SALOQT preset', () => {
    expect(defaultAppSettings().rates).toEqual(SALOQT_RATES);
  });

  it('fills SALOQT in over a payload saved before the rates setting existed', () => {
    const stored = { quality: 'medium', laps: 7, gamepad: { deadzone: 0.1 } };
    const out = sanitizeSettings(migrateStored(stored), defaultAppSettings());
    expect(out.rates).toEqual(SALOQT_RATES);
    // The keys the pilot did save are untouched.
    expect(out.quality).toBe('medium');
    expect(out.laps).toBe(7);
    expect(out.gamepad.deadzone).toBe(0.1);
  });

  it('keeps a hand-tuned profile and never aliases the default', () => {
    const base = defaultAppSettings();
    const out = sanitizeSettings({ rates: { type: 'betaflight', separatePitch: false, roll: { rcRate: 1.4, superRate: 0.5, expo: 0.2 } } }, base);
    expect(out.rates.type).toBe('betaflight');
    expect(out.rates.separatePitch).toBe(false);
    expect(out.rates.roll.rcRate).toBe(1.4);
    expect(out.rates.yaw).toEqual(SALOQT_RATES.yaw);
    out.rates.roll.rcRate = 9;
    expect(base.rates.roll.rcRate).toBe(SALOQT_RATES.roll.rcRate);
  });
});

describe('isSameValue', () => {
  it('compares primitives strictly', () => {
    expect(isSameValue(1, 1)).toBe(true);
    expect(isSameValue(1, 2)).toBe(false);
    expect(isSameValue('a', 'a')).toBe(true);
    expect(isSameValue(0, '0')).toBe(false);
    expect(isSameValue(null, undefined)).toBe(false);
    expect(isSameValue(null, {})).toBe(false);
  });

  it('ignores the order of object keys', () => {
    expect(isSameValue({ a: 1, b: { c: 2, d: 3 } }, { b: { d: 3, c: 2 }, a: 1 })).toBe(true);
  });

  it('tells apart objects that differ in a value, a key or the key count', () => {
    expect(isSameValue({ a: 1 }, { a: 2 })).toBe(false);
    expect(isSameValue({ a: 1 }, { b: 1 })).toBe(false);
    expect(isSameValue({ a: 1 }, { a: 1, b: 2 })).toBe(false);
    expect(isSameValue({ a: undefined }, { b: undefined })).toBe(false);
  });

  it('compares arrays by element and never equates them with objects', () => {
    expect(isSameValue([1, [2, 3]], [1, [2, 3]])).toBe(true);
    expect(isSameValue([1, 2], [2, 1])).toBe(false);
    expect(isSameValue([1], [1, 2])).toBe(false);
    expect(isSameValue([], {})).toBe(false);
  });

  it('sees a copy of the default settings as unchanged', () => {
    expect(isSameValue(defaultAppSettings(), defaultAppSettings())).toBe(true);
  });
});

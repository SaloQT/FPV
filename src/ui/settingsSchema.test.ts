import { describe, expect, it } from 'vitest';
import { defaultAppSettings, isSameValue } from './settingsSchema';

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

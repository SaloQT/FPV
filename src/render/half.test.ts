import { describe, expect, it } from 'vitest';
import { fromHalf, toHalf } from './half';

describe('half float conversion', () => {
  it('encodes known bit patterns', () => {
    expect(toHalf(0)).toBe(0);
    expect(toHalf(1)).toBe(0x3c00);
    expect(toHalf(0.5)).toBe(0x3800);
    expect(toHalf(-2)).toBe(0xc000);
    expect(toHalf(65504)).toBe(0x7bff);
    expect(toHalf(1e9)).toBe(0x7c00);
    expect(toHalf(2 ** -24)).toBe(1);
    expect(toHalf(1e-10)).toBe(0);
    expect(toHalf(NaN) & 0x7c00).toBe(0x7c00);
  });

  it('round-trips within half precision', () => {
    for (const v of [0.001, 0.1, 0.333, 1.5, 3.14159, 100.25, 1234.5, 6e-5, 3e-6, 60000]) {
      const r = fromHalf(toHalf(v));
      expect(Math.abs(r - v) / v).toBeLessThan(v < 6.2e-5 ? 0.3 : 1 / 1024);
    }
  });

  it('rounds to nearest even at ties', () => {
    expect(toHalf(1 + 2 ** -11)).toBe(0x3c00);
    expect(toHalf(1 + 3 * 2 ** -11)).toBe(0x3c02);
  });
});

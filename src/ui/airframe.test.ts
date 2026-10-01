import { describe, expect, it } from 'vitest';
import { QUAD_5IN_6S } from '../sim/presets';
import { describeAirframe } from './airframe';

describe('describeAirframe', () => {
  it('describes the 5 inch quad from its own numbers', () => {
    expect(describeAirframe(QUAD_5IN_6S)).toEqual({ title: '5-inch quad', detail: '6S 1300 mAh, 650 g, 1650 kV' });
  });

  it('follows a different config instead of a hard-coded name', () => {
    const small = { ...QUAD_5IN_6S, mass: 0.31, prop: { ...QUAD_5IN_6S.prop, diameter: 0.0762 }, battery: { ...QUAD_5IN_6S.battery, cells: 4, capacityMah: 850 } };
    expect(describeAirframe(small)).toEqual({ title: '3-inch quad', detail: '4S 850 mAh, 310 g, 1650 kV' });
  });
});

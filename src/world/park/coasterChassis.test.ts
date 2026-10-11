import { expect, it } from 'vitest';
import { Rng } from '../track/rng';
import { chassisSolution, solveChassis } from './coasterChassis';
import { coasterLayout } from './coasterLayout';
import { compileCurve } from './curve';
import { add, mul, rotate, wrap, yawPoint } from './math';
import { coasterBogiePivot, coasterWheelbase } from './rideDimensions';
import { COASTER_FAMILIES } from './types';

it('does not erase small positive periodic coordinates or accumulate lap-sized offset cancellation', () => {
  expect(wrap(1e-14, 1000)).toBe(1e-14); expect(Object.is(wrap(-0, 1000), -0)).toBe(false);
  const plan = coasterLayout('steel', new Rng(1337)), curve = compileCurve(plan.points, plan.station, plan.lift, plan.brake, 24), solution = chassisSolution();
  for (let i = 0; i < 2000; i++) {
    const at = curve.length * 100000 + i * 0.37;
    expect(() => solveChassis(curve, at, coasterWheelbase(3.4), 0.6, solution)).not.toThrow();
    expect(Math.abs(solution.residual)).toBeLessThan(1e-10);
  }
});

it.each(COASTER_FAMILIES)('keeps %s kingpins on both independent rail bogies without stretching the chassis throughout its circuit', family => {
  let worst = 0, iterations = 0, samples = 0;
  for (const seed of [7, 1337]) {
    const plan = coasterLayout(family, new Rng(seed));
    const curve = compileCurve(plan.points.map(p => yawPoint([792, 12, -831], 0.71, p)), plan.station, plan.lift, plan.brake, 24), solved = chassisSolution();
    const wheelbase = coasterWheelbase(3.4), pivot = coasterBogiePivot(family);
    for (let at = -5; at <= curve.length + 5; at += 1.13) {
      solveChassis(curve, at, wheelbase, pivot, solved); iterations = Math.max(iterations, solved.iterations); samples++;
      for (const side of [-1, 1]) {
        const rail = side < 0 ? solved.front : solved.rear;
        const bogiePin = add(rail.pos, mul(rail.up, pivot)), chassisPin = add(solved.body.pos, rotate(solved.body.rot, [0, pivot, side * wheelbase / 2]));
        worst = Math.max(worst, Math.hypot(...chassisPin.map((v, k) => v - bogiePin[k])));
      }
      expect(Math.hypot(...solved.body.rot)).toBeCloseTo(1, 12);
    }
  }
  expect(samples).toBeGreaterThan(500); expect(worst, 'physical kingpin centres must coincide, including bank transitions and the circuit seam').toBeLessThan(1e-10);
  expect(iterations, 'safeguarded solve must converge within its iteration budget').toBeLessThan(48);
});

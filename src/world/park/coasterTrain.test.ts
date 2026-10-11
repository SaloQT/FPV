import { expect, it } from 'vitest';
import { Rng } from '../track/rng';
import { coasterLayout } from './coasterLayout';
import { compileCurve } from './curve';
import { add, distance, rotate, yawPoint } from './math';
import { coasterBogiePivot, coasterCouplerHeight, coasterCouplerLength, coasterCouplerPin } from './rideDimensions';
import { solveTrainChassis, trainChassisSolution } from './coasterTrain';
import { COASTER_FAMILIES } from './types';

it.each(COASTER_FAMILIES)('keeps every %s drawbar rigid and attached through full circuits, bank transitions and the seam', family => {
  let worst = 0, discrepancy = 0, evaluations = 0;
  for (const seed of [7, 1337]) for (const length of [3.4, 3.5]) {
    const plan = coasterLayout(family, new Rng(seed)), curve = compileCurve(plan.points.map(p => yawPoint([800, 12, -770], 0.71, p)), plan.station, plan.lift, plan.brake, 24);
    const train = trainChassisSolution(5), pinY = coasterCouplerHeight(family), pinZ = coasterCouplerPin(length), drawbar = coasterCouplerLength(length);
    for (let at = -8; at <= curve.length + 8; at += 2.1) {
      solveTrainChassis(curve, at, length, coasterBogiePivot(family), pinY, train);
      discrepancy = Math.max(discrepancy, train.maxArcDiscrepancy); evaluations = Math.max(evaluations, ...train.iterations);
      for (let i = 1; i < train.cars.length; i++) {
        const lead = train.cars[i - 1].body, rear = train.cars[i].body, link = train.couplers[i - 1];
        const a = add(lead.pos, rotate(lead.rot, [0, pinY, pinZ])), b = add(rear.pos, rotate(rear.rot, [0, pinY, -pinZ]));
        worst = Math.max(worst, Math.abs(distance(a, b) - drawbar), distance(a, add(link.pos, rotate(link.rot, [0, -drawbar / 2, 0]))), distance(b, add(link.pos, rotate(link.rot, [0, drawbar / 2, 0]))));
        expect(train.stations[i]).toBeLessThan(train.stations[i - 1]);
      }
    }
  }
  expect(worst).toBeLessThan(1e-10); expect(evaluations).toBeLessThanOrEqual(48);
  // Longitudinal dynamics currently uses equal arc spacing. This metric must remain explicit.
  expect(discrepancy).toBeLessThan(0.5);
  console.info(`${family}: drawbar residual ${worst.toExponential(3)} m; nominal-arc discrepancy ${discrepancy.toFixed(6)} m; max ${evaluations} chassis evaluations/link`);
});

it('returns the same coupler solution after cold starts, the periodic seam and many elapsed laps', () => {
  const plan = coasterLayout('inverted', new Rng(1337)), curve = compileCurve(plan.points, plan.station, plan.lift, plan.brake, 24), warm = trainChassisSolution(5);
  const sample = (at: number, result = trainChassisSolution(5)) => solveTrainChassis(curve, at, 3.4, coasterBogiePivot('inverted'), coasterCouplerHeight('inverted'), result);
  const first = sample(0);
  for (const head of [curve.length, curve.length * 10000, 0]) {
    const other = sample(head, warm);
    for (let i = 0; i < first.cars.length; i++) expect(distance(first.cars[i].body.pos, other.cars[i].body.pos)).toBeLessThan(1e-8);
  }
  let previous = sample(-0.1).couplers.map(p => [...p.rot]);
  for (let at = 0; at < curve.length; at += 0.3) {
    const current = sample(at, warm);
    for (let i = 0; i < current.couplers.length; i++) {
      const dot = Math.abs(current.couplers[i].rot.reduce((sum, v, k) => sum + v * previous[i][k], 0));
      expect(dot, 'No arbitrary drawbar roll switch near vertical track').toBeGreaterThan(0.99);
    }
    previous = current.couplers.map(p => [...p.rot]);
  }
  sample(curve.stationEnd - 6, warm);
  for (let i = 1; i < warm.spacing.length; i++) expect(warm.spacing[i]).toBeCloseTo(3.4, 10);
});

it('extends exact train prefixes without recomputing or moving their already solved leading cars', () => {
  for (const family of COASTER_FAMILIES) {
    const plan = coasterLayout(family, new Rng(42)), curve = compileCurve(plan.points, plan.station, plan.lift, plan.brake, 24);
    const full = trainChassisSolution(5), partial = trainChassisSolution(5), pivot = coasterBogiePivot(family), pinY = coasterCouplerHeight(family);
    for (const at of [-0.3, curve.liftEnd + 20, curve.length * 0.65, curve.length + 0.2]) {
      solveTrainChassis(curve, at, 3.4, pivot, pinY, full);
      let start = 0;
      for (const count of [1, 3, 5]) {
        const before = partial.cars.slice(0, start).map(car => [...car.body.pos, ...car.body.rot]);
        solveTrainChassis(curve, at, 3.4, pivot, pinY, partial, count, start);
        for (let i = 0; i < start; i++) expect([...partial.cars[i].body.pos, ...partial.cars[i].body.rot]).toEqual(before[i]);
        for (let i = 0; i < count; i++) expect(distance(partial.cars[i].body.pos, full.cars[i].body.pos)).toBeLessThan(1e-10);
        for (let i = 0; i < count - 1; i++) expect(distance(partial.couplers[i].pos, full.couplers[i].pos)).toBeLessThan(1e-10);
        start = count;
      }
      expect(partial.stations).toEqual(full.stations);
    }
    expect(() => solveTrainChassis(curve, 23, 3.4, pivot, pinY, partial, 5, 2)).toThrow('different head');
  }
});

import { describe, expect, it } from 'vitest';
import { Rng } from '../track/rng';
import { coasterLayout } from './coasterLayout';
import { compileCurve, sampleRail, railSample } from './curve';
import { preflightCoaster } from './ridePhysics';
import { COASTER_FAMILIES, type CoasterFamily, type RideDefinition } from './types';

function ride(family: CoasterFamily, seed: number, extreme?: 'min' | 'max'): RideDefinition {
  const rng = new Rng(seed);
  if (extreme) rng.range = (min, max) => extreme === 'min' ? min : max;
  const template = coasterLayout(family, rng);
  return { id: 0, family, name: family, pos: [0, 12, 0], yaw: 0, theme: 'alpine', radius: 12, height: 8, capacity: 20,
    station: 0, queue: [], exit: [], boarding: [], cars: 5, trains: 1, carLength: 3.4, emptyCarMass: family === 'wooden' ? 750 : 900,
    dragArea: 1.5, rolling: 0.004, liftSpeed: family === 'launch' ? 11 : 3.5, motorForce: 80000,
    motorPower: family === 'launch' ? 1500000 : 350000, motorTorque: 40000, brakeForce: 90000, targetOmega: 0.42, inertia: 90000,
    duration: 60, bodies: [], maxG: 5.5, maxJerk: 180,
    curve: compileCurve(template.points, template.station, template.lift, template.brake, 24) };
}

describe('family coaster planforms', () => {
  it('preserves straight station docking and plot bounds while producing distinct seeded planforms', () => {
    const footprints = COASTER_FAMILIES.map(family => {
      const template = coasterLayout(family, new Rng(1337)), other = coasterLayout(family, new Rng(7));
      expect(template).toEqual(coasterLayout(family, new Rng(1337)));
      const scale = family === 'space' || family === 'mine' ? 0.85 : 1;
      expect(template.points.slice(0, 7)).toEqual([-142, -117, -104.5, -92, -79.5, -67, -42].map(x => [x * scale, family === 'inverted' ? 6 : 3, 70 * scale]));
      expect(template.points.map(p => [p[0], p[2]])).not.toEqual(other.points.map(p => [p[0], p[2]]));
      for (const p of template.points) {
        expect(p[0]).toBeGreaterThanOrEqual(-175); expect(p[0]).toBeLessThanOrEqual(173);
        expect(p[2]).toBeGreaterThanOrEqual(-100); expect(p[2]).toBeLessThanOrEqual(70);
      }
      const curve = ride(family, 1337).curve!, points: number[][] = [];
      const stop = curve.stationEnd - 6;
      for (let at = stop - 4 * 3.4 - 2; at <= stop + 2; at += 0.25) {
        const sample = sampleRail(curve, at, railSample());
        expect(sample.pos[1], `${family} level loaded station`).toBeCloseTo(family === 'inverted' ? 6 : 3, 10);
        expect(sample.tangent[1]).toBeCloseTo(0, 10);
        expect(sample.up[1]).toBeCloseTo(1, 10);
      }
      for (let at = 0; at < curve.length; at += 4) { const p = sampleRail(curve, at, railSample()).pos; points.push([p[0], p[2]]); }
      return points;
    });
    const difference = (a: number[][], b: number[][]) => Math.max(...a.map(p => Math.min(...b.map(q => Math.hypot(p[0] - q[0], p[1] - q[1])))));
    for (let i = 0; i < footprints.length; i++) for (let j = i + 1; j < footprints.length; j++) {
      // Height changes alone cannot satisfy this: every family needs a visibly different plan view.
      expect(Math.max(difference(footprints[i], footprints[j]), difference(footprints[j], footprints[i])), `${COASTER_FAMILIES[i]}/${COASTER_FAMILIES[j]}`).toBeGreaterThan(14);
    }
  });
  it('keeps separate track corridors clear of the train and guide envelope', () => {
    for (const family of COASTER_FAMILIES) {
      const r = ride(family, 1337), curve = r.curve!, positions: number[][] = [];
      for (let at = 0; at < curve.length; at += 0.5) positions.push([...sampleRail(curve, at, railSample()).pos]);
      let closest = Infinity;
      for (let i = 0; i < positions.length; i++) for (let j = i + 60; j < positions.length; j++) {
        if (curve.length - (j - i) * 0.5 < 30) continue;
        const distance = Math.hypot(...positions[i].map((v, k) => v - positions[j][k]));
        closest = Math.min(distance, closest);
      }
      // Every curve point is within 0.25 m arc distance of a sample; 0.5 m proves continuous clearance.
      expect(closest, `${family} track corridors`).toBeGreaterThan(8.5);
    }
  });
  it('completes empty and loaded finite-train cycles within the existing force envelope', () => {
    for (const family of COASTER_FAMILIES) for (const seed of [0, 1, 1337, 98765, 4294967295, -1, -2]) {
      const r = ride(family, seed, seed === -1 ? 'min' : seed === -2 ? 'max' : undefined), run = preflightCoaster(r);
      expect(run.maxG, `${family}/${seed}`).toBeLessThan(r.maxG);
      expect(run.maxJerk, `${family}/${seed}`).toBeLessThan(r.maxJerk);
      expect(run.minSpeed, `${family}/${seed}`).toBeGreaterThan(0);
    }
  }, 30000);
});

import { expect, it } from 'vitest';
import type { Vec3 } from '../../contracts';
import { Rng } from '../track/rng';
import { partDistance } from './collision';
import { coasterLayout } from './coasterLayout';
import { compileCurve, railSample, sampleRail } from './curve';
import { add, clamp, cross, distance, dot, inverseRotate, mul, sub, unit, yawPoint } from './math';
import { Parts } from './parts';
import { RAIL } from './rideDimensions';
import { trackTubePoints, weldedTube } from './rideGeometry';
import { COASTER_FAMILIES, type ParkData } from './types';

it('stops each straight length where the inner walls of a bend cross and welds a round knuckle at the bend that covers both cut rims, including the closed seam', () => {
  const park = { parts: [], bodies: [] } as unknown as ParkData, origin: Vec3 = [450, 21, -300], yaw = 0.73;
  const points: Vec3[] = [[0, 0, 0], [9, 0, 0], [13, 0, 7], [8, 2, 12], [-3, 1, 7]], radius = 0.18, n = points.length;
  const parts = weldedTube(new Parts(park, origin, yaw), points, radius, [0.2, 0.3, 0.4], 'test');
  expect(parts).toHaveLength(n);
  const knuckles = park.parts.filter(p => p.shape === 'sphere');
  expect(knuckles).toHaveLength(n);
  const direction = (i: number) => unit(sub(points[(i + 1) % n], points[i]));
  const setback = (i: number) => radius * Math.tan(Math.acos(clamp(dot(direction((i + n - 1) % n), direction(i)), -1, 1)) / 2);
  points.forEach((point, i) => {
    const world = yawPoint(origin, yaw, point), knuckle = knuckles.find(k => distance(k.pos, world) < 1e-9)!;
    const reach = Math.hypot(radius, setback(i));
    expect(knuckle.half, 'the knuckle reaches both cut rims').toEqual([reach, reach, reach]);
    for (const [from, to] of [[i === 0 ? n - 1 : i - 1, i], [i, (i + 1) % n]]) {
      // Every point of both cut rims lies on or inside the knuckle.
      const sign = to === i ? -1 : 1, centre = add(point, mul(direction(from), sign * setback(i))), axis = direction(from), side = unit(cross(axis, [0, 1, 0] as Vec3));
      for (const angle of [0, 1, 2, 3, 4, 5]) {
        const rim = add(centre, add(mul(side, radius * Math.cos(angle)), mul(unit(cross(axis, side)), radius * Math.sin(angle))));
        expect(distance(rim, point)).toBeLessThanOrEqual(reach + 1e-9);
      }
    }
    // The length runs from its own setback at one bend to its own setback at the next.
    const next = (i + 1) % n, start = add(point, mul(direction(i), setback(i))), end = add(points[next], mul(direction(i), -setback(next)));
    expect(distance(parts[i].pos, yawPoint(origin, yaw, mul(add(start, end), 0.5)))).toBeLessThan(1e-9);
    expect(parts[i].half[1]).toBeCloseTo(distance(start, end) / 2, 9);
  });
  const open = weldedTube(new Parts(park), points.slice(0, 3), radius, [0.2, 0.3, 0.4], 'open', {}, false);
  expect(open).toHaveLength(2);
  expect(park.parts.filter(p => p.shape === 'sphere')).toHaveLength(n + 1);
  expect(park.joints).toHaveLength(2 * (n + 1));
});

it('leaves out the knuckle at a bend the caller buries in a part of its own, and ray traces the knuckle of a sharp bend only', () => {
  const park = { parts: [], bodies: [] } as unknown as ParkData, radius = 0.18;
  const points: Vec3[] = [[0, 0, 0], [6, 0, 0], [12, 0.1, 0], [18, 0, 0], [18, 6, 0], [12, 6, 0]];
  weldedTube(new Parts(park), points, radius, [0.2, 0.3, 0.4], 'skip', {}, true, vertex => vertex !== 2);
  const knuckles = park.parts.filter(p => p.shape === 'sphere');
  expect(knuckles).toHaveLength(5);
  expect(knuckles.find(k => distance(k.pos, points[2]) < 1e-9)).toBeUndefined();
  expect(knuckles.find(k => distance(k.pos, points[3]) < 1e-9)!.detail ?? 0, 'a right angle opens a wide slit').toBe(0);
  expect(knuckles.find(k => distance(k.pos, points[1]) < 1e-9)!.detail, 'a nearly straight bend leaves a hairline').toBe(1);
});

it('welds short lengths along their touching edge when two knuckles would overlap', () => {
  const park = { parts: [], bodies: [] } as unknown as ParkData, radius = 0.18;
  const parts = weldedTube(new Parts(park), [[0, 0, 0], [1, 0, 0], [1.2, 0.05, 0], [1.4, 0, 0], [2.5, 0, 0]], radius, [0.2, 0.3, 0.4], 'short', {}, false);
  expect(parts).toHaveLength(4);
  // The bends at 1.2 and 1.4 have a neighbour closer than a knuckle width; the bend at 1 has the next vertex 0.2 m away too, so none gets a knuckle.
  expect(park.parts.filter(p => p.shape === 'sphere')).toHaveLength(0);
  expect(park.joints).toHaveLength(3);
});

it.each(COASTER_FAMILIES)('bounds %s rendered/physical tube approximation and closes the complete rail circuit', family => {
  let worst = 0;
  for (const seed of [7, 1337, 4294967295]) {
    const plan = coasterLayout(family, new Rng(seed)), curve = compileCurve(plan.points.map(p => yawPoint([650, 12, -420], 1.1, p)), plan.station, plan.lift, plan.brake, 24);
    const stations: number[] = [], tracks = trackTubePoints(curve, family === 'inverted', stations), s = railSample();
    expect(stations[0]).toBe(0); expect(stations.at(-1)).toBeLessThan(curve.length);
    for (let i = 0; i < stations.length; i++) {
      const start = stations[i], end = stations[i + 1] ?? curve.length;
      for (let j = 0; j <= 16; j++) {
        sampleRail(curve, start + (end - start) * j / 16, s);
        const right = cross(s.tangent, s.up), actual = [add(s.pos, mul(right, -RAIL.halfGauge)), add(s.pos, mul(right, RAIL.halfGauge)), add(s.pos, mul(s.up, family === 'inverted' ? RAIL.spineOffset : -RAIL.spineOffset))];
        for (let k = 0; k < tracks.length; k++) {
          const a = tracks[k][i], b = tracks[k][(i + 1) % stations.length], delta = sub(b, a);
          const t = clamp(dot(sub(actual[k], a), delta) / dot(delta, delta), 0, 1);
          worst = Math.max(worst, distance(actual[k], add(a, mul(delta, t))));
        }
      }
    }
  }
  expect(worst, 'Finer-than-construction samples must stay within the declared 5 mm geometric approximation').toBeLessThanOrEqual(RAIL.chordError);
});

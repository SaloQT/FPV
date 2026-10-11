import { expect, it } from 'vitest';
import type { Vec3 } from '../../contracts';
import { createTerrainSampler } from '../terrain/sampler';
import { testTerrainData } from '../track/testTerrain';
import { generatePark, gradeParkTerrain } from './generator';
import { add, axisAngle, clamp, dot, inverseRotate, mul, rotate, sub } from './math';
import { defaultParkRecipe } from './recipe';
import { WHEEL_BEARING_HALF, WHEEL_BEARING_RADIUS, WHEEL_CABIN_HALF_Z, WHEEL_HINGE, WHEEL_HOUSING_HALF, WHEEL_PIN_Z, WHEEL_RIM_Z, WHEEL_RUNNING_CLEARANCE, WHEEL_SUPPORT_RADIUS, WHEEL_SUPPORT_Z } from './rideDimensions';
import type { ParkPart } from './types';

function extent(part: ParkPart, direction: Vec3): number {
  const a = inverseRotate(part.rot, direction), h = part.half;
  if (part.shape === 'sphere') return Math.hypot(a[0] * h[0], a[1] * h[1], a[2] * h[2]);
  if (part.shape === 'cylinder') return Math.hypot(a[0] * h[0], a[2] * h[2]) + Math.abs(a[1]) * h[1];
  return Math.abs(a[0]) * h[0] + Math.abs(a[1]) * h[1] + Math.abs(a[2]) * h[2];
}

it('keeps the complete wheel/cabin/support assembly clear for every wheel and cabin angle, including the boarding bridge', () => {
  const recipe = { ...defaultParkRecipe(1337), guests: 0 }, park = generatePark(recipe, createTerrainSampler(gradeParkTerrain(testTerrainData({ resolution: 64, cellSize: 32 }), recipe)));
  const ride = park.rides.find(r => r.family === 'wheel')!, base = axisAngle([0, 1, 0], ride.yaw), longitudinal = rotate(base, [0, 0, 1]);
  const rotor = ride.bodies.find(i => park.bodies[i].role === 'rotor')!, cabins = new Set(ride.bodies.filter(i => park.bodies[i].role === 'gondola'));
  const cabinJoints = park.joints!.filter(j => j.name.startsWith(`${ride.id}/wheel-cabin/`)), pins = new Set(cabinJoints.map(j => j.b.part)), bearings = new Set(cabinJoints.map(j => j.a.part));
  const mainJoint = park.joints!.find(j => j.name === `${ride.id}/wheel-main-axle`)!, hub = mainJoint.b.part, spindle = park.parts[mainJoint.a.part];
  const cabinParts = park.parts.filter(p => cabins.has(p.body)), shellParts = park.parts.filter((p, i) => cabins.has(p.body) && !pins.has(i));
  const wheelParts = park.parts.filter((p, i) => p.body === rotor && i !== hub && !bearings.has(i));
  const rotorParts = park.parts.filter(p => p.body === rotor);
  expect(cabinJoints).toHaveLength(24); expect(cabins.size).toBe(12);
  const epsilon = 256 * Number.EPSILON * Math.max(1, ...ride.pos.map(Math.abs), ride.radius);
  const shellHalfDepth = Math.max(...shellParts.map(p => Math.abs(p.pos[2]) + extent(p, [0, 0, 1])));
  const wheelInside = Math.min(...wheelParts.map(p => Math.abs(p.pos[2]) - extent(p, [0, 0, 1])));
  // Rotation about Z, for either the wheel or a freely swinging cabin, leaves this separating axis unchanged.
  expect(wheelInside - shellHalfDepth).toBeGreaterThanOrEqual(WHEEL_RUNNING_CLEARANCE - epsilon);
  for (const angle of [0, Math.PI / 4, Math.PI / 2, Math.PI, Math.PI * 1.5]) {
    const normal = rotate(axisAngle([0, 0, 1], angle), [0, 0, 1]);
    expect(normal).toEqual([0, 0, 1]);
  }
  const movingOutside = Math.max(...[...rotorParts, ...cabinParts].map(p => Math.abs(p.pos[2]) + extent(p, [0, 0, 1])));
  const supports = park.parts.filter(p => p.body < 0 && p.shape === 'cylinder' && Math.abs(p.half[0] - WHEEL_SUPPORT_RADIUS) < epsilon && Math.hypot(...inverseRotate(base, sub(p.pos, ride.pos))) < ride.radius + 10);
  expect(supports).toHaveLength(4);
  for (const part of supports) {
    const center = dot(sub(part.pos, ride.pos), longitudinal), inner = Math.abs(center) - extent(part, longitudinal);
    expect(inner - movingOutside, 'A-frame legs remain beyond every moving pin/rim envelope').toBeGreaterThanOrEqual(WHEEL_RUNNING_CLEARANCE - epsilon);
  }
  // Apart from the intended rotating hub bearing, radial spokes start outside the fixed spindle.
  for (const part of rotorParts) if (part !== park.parts[hub]) {
    const end = rotate(part.rot, [0, part.half[1], 0]), a = sub(part.pos, end), b = add(part.pos, end), d = sub(b, a);
    const t = clamp(-(a[0] * d[0] + a[1] * d[1]) / (d[0] ** 2 + d[1] ** 2 || 1), 0, 1);
    const radialClearance = Math.hypot(a[0] + t * d[0], a[1] + t * d[1]) - part.half[0] - spindle.half[0];
    expect(radialClearance).toBeGreaterThan(0);
  }
  const deck = inverseRotate(base, sub(ride.boarding.at(-1)!, ride.pos));
  const bridge = park.parts.find(p => p.body < 0 && p.shape === 'box' && p.half[0] === 1.5 && p.half[1] === 0.15 && Math.hypot(...sub(inverseRotate(base, sub(p.pos, ride.pos)), [0, deck[1] - 0.15, 1.725])) < 0.01)!;
  expect(bridge).toBeDefined();
  const bridgeCenter = inverseRotate(base, sub(bridge.pos, ride.pos)), bridgeNear = bridgeCenter[2] - bridge.half[2];
  expect(bridgeCenter[1] + bridge.half[1]).toBeCloseTo(deck[1], 10);
  expect(bridgeCenter[2] + bridge.half[2]).toBeCloseTo(deck[2] - 1.4, 10);
  let minimumVerticalClearance = Infinity;
  for (const part of cabinParts) {
    if (part.pos[2] + extent(part, [0, 0, 1]) < bridgeNear - epsilon) continue;
    // Full roll envelope about the hinge: the lowest wheel hinge is 5m above the foundation.
    let radius = 0;
    for (const x of [-1, 1]) for (const y of [-1, 1]) for (const z of [-1, 1]) {
      const p = add(part.pos, rotate(part.rot, [x * part.half[0], y * part.half[1], z * part.half[2]]));
      radius = Math.max(radius, Math.hypot(p[0], p[1] - WHEEL_HINGE));
    }
    minimumVerticalClearance = Math.min(minimumVerticalClearance, 5 - radius - deck[1]);
  }
  expect(minimumVerticalClearance, 'Cabin roof/pin can never descend into the bridge, even under a full independent roll').toBeGreaterThan(0.2);
  // The rim bearing bosses clear the cabin sides, and the apex housings clear every turning pin and boss, by the running clearance.
  expect(WHEEL_RIM_Z - WHEEL_BEARING_HALF - WHEEL_CABIN_HALF_Z).toBeGreaterThanOrEqual(WHEEL_RUNNING_CLEARANCE - 1e-12);
  expect(WHEEL_SUPPORT_Z - WHEEL_HOUSING_HALF - Math.max(WHEEL_PIN_Z, WHEEL_RIM_Z + WHEEL_BEARING_RADIUS)).toBeGreaterThanOrEqual(WHEEL_RUNNING_CLEARANCE - 1e-12);
}, 30000);

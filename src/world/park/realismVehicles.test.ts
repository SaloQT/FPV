import { describe, expect, it } from 'vitest';
import type { Quat, Vec3 } from '../../contracts';
import { createTerrainSampler } from '../terrain/sampler';
import { testTerrainData } from '../track/testTerrain';
import { auditPark } from './constructionAudit';
import { declareMonolith, insertEnd, measureJoints } from './construction';
import { add, axisAngle, pose, qmul, rotate } from './math';
import { generatePark, gradeParkTerrain } from './generator';
import { carParts, carouselHorse, Parts, partSource, rideSeat, RUBBER, SEAT_HALF_WIDTH, setPartProvenance } from './parts';
import { defaultParkRecipe } from './recipe';
import { PARK_DT } from './ridePhysics';
import { ParkRuntime } from './runtime';
import { coasterBogiePivot, coasterCouplerHeight, coasterCouplerLength, RAIL } from './rideDimensions';
import { COASTER_FAMILIES, type BodyPose, type CoasterFamily, type ParkData, type ParkPart, type RideDefinition } from './types';

/** These tests build the ride vehicles on their own (a seat, a coaster car, a carousel horse) and audit them with the same
 * construction audit the whole park goes through. Each assembly must come out clean in every pose it moves through, and a copy with
 * one member 50 mm too long or out of place must be rejected, so the audit is shown to see each defect the construction removed. */
/** Height of the ground each scene stands on, which the audit uses to decide what is held up; no entry means the assembly hangs from something outside the scene. */
const GROUND = new WeakMap<ParkData, number>();
function scene(family: string, ground: number | null): { park: ParkData; ride: RideDefinition } {
  const ride = { id: 0, family, carLength: 3.4, bodies: [0], cars: 1, trains: 1 } as unknown as RideDefinition;
  const park = { recipe: defaultParkRecipe(), layout: 'hub', bounds: { min: [-1000, -1000, -1000], max: [1000, 1000, 1000] }, entrance: 0, launch: { pos: [0, 0, 0], yaw: 0 },
    rides: [ride], parts: [], bodies: [{ ride: 0, role: 'car', index: 0, local: [0, 0, 0], train: 0 }], lights: [], rooms: [], routes: [], nodes: [], paths: [], interfaces: [], monoliths: [], joints: [] } as unknown as ParkData;
  if (ground !== null) GROUND.set(park, ground);
  return { park, ride };
}
/** Body poses with every restraint closed (open = 0) or swung fully open (open = 1), the way the runtime turns them about their hinge. */
function poses(park: ParkData, open: number, placed: ReadonlyMap<number, BodyPose> = new Map()): BodyPose[] {
  const out: BodyPose[] = park.bodies.map((_, i) => placed.get(i) ?? pose());
  park.bodies.forEach((def, i) => {
    if (def.role === 'bogie') { out[i].pos = add(out[def.parent!].pos, rotate(out[def.parent!].rot, def.local)); return; }
    if (def.role !== 'restraint') return;
    const parent = out[def.parent!];
    out[i].pos = add(parent.pos, rotate(parent.rot, def.local));
    out[i].rot = qmul(def.localRot ? qmul(parent.rot, def.localRot) : parent.rot, axisAngle([1, 0, 0], -1.3 * open)) as Quat;
  });
  return out;
}
function problems(park: ParkData, open = 0, placed?: ReadonlyMap<number, BodyPose>): string[] {
  const ground = GROUND.get(park);
  return auditPark(park, poses(park, open, placed), ground === undefined ? { checks: { support: false } } : { ground: () => ground }).findings.map(f => `${f.kind} ${f.family} ${(f.measured * 1000).toFixed(1)} mm: ${f.detail} [${f.sources.map(s => s.split(' < ')[0]).join(' x ')}]`);
}
function brokenJoints(park: ParkData, open = 0, placed?: ReadonlyMap<number, BodyPose>): string[] { return measureJoints(park, poses(park, open, placed)).filter(j => !j.pass).map(j => j.name); }
/** Make a rod longer by `extra` metres at whichever end points along `direction` (in its own body's frame), keeping the other end fixed. */
function lengthen(part: ParkPart, extra: number, direction: Vec3): void {
  const axis = rotate(part.rot, [0, 1, 0]), sign = axis[0] * direction[0] + axis[1] * direction[1] + axis[2] * direction[2] > 0 ? 1 : -1;
  part.half[1] += extra / 2;
  for (let k = 0; k < 3; k++) part.pos[k] += sign * axis[k] * extra / 2;
}
/** Slide a part by `offset` metres, the way a wrongly placed member would sit. */
function nudge(part: ParkPart, offset: Vec3): void { for (let k = 0; k < 3; k++) part.pos[k] += offset[k]; }
const isRod = (part: ParkPart, radius: number, halfLength: number, tolerance = 0.002): boolean => part.shape === 'cylinder' && Math.abs(part.half[0] - radius) < 1e-6 && Math.abs(part.half[1] - halfLength) < tolerance;
const COLOUR: Vec3 = [0.2, 0.3, 0.4];

describe('ride seats', () => {
  /** Seat origin heights over a floor at height 0.3 m: the pan resting just on the floor, and a tall pedestal. */
  const mounts = [{ name: 'pan resting on the floor', y: 0.42, floor: 0.3 }, { name: 'short pedestal', y: 0.5, floor: 0.3 }, { name: 'tall pedestal', y: 0.93, floor: 0.3 }];
  function seatOnFloor(y: number, floor: number, yaw: number, restraint: boolean): ParkData {
    const { park, ride } = scene('steel', floor - 0.2), slab = new Parts(park, [0, 0, 0], 0, 0, 'ride');
    // The floor under the seat stands flush with the foot of the pedestal.
    slab.box([0, floor - 0.1, 0], [1, 0.1, 1], [0.3, 0.3, 0.3]);
    rideSeat(park, 0, ride, [0, y, 0], yaw, COLOUR, restraint, floor);
    return park;
  }
  it.each(mounts)('stands clean on its floor with the restraint closed, half open and fully open: $name', ({ y, floor }) => {
    for (const yaw of [0, 1.1, Math.PI]) for (const open of [0, 0.5, 1]) {
      const park = seatOnFloor(y, floor, yaw, true);
      expect(problems(park, open), `yaw ${yaw}, open ${open}`).toEqual([]);
      expect(brokenJoints(park, open), `yaw ${yaw}, open ${open}`).toEqual([]);
    }
  });
  it('is clean without a restraint or a floor, hung free on its own', () => {
    const { park, ride } = scene('swings', null);
    rideSeat(park, 0, ride, [0, 0.5, 0], 0.4, COLOUR);
    expect(problems(park)).toEqual([]);
    expect(brokenJoints(park)).toEqual([]);
  });
  it('keeps a row of seats side by side on a 0.6 m bench pitch clear of one another, restraints closed and open', () => {
    expect(0.6 - 2 * SEAT_HALF_WIDTH).toBeGreaterThanOrEqual(0.03);
    for (const yaw of [0, Math.PI]) for (const open of [0, 1]) {
      const { park, ride } = scene('topspin', -0.3), slab = new Parts(park, [0, 0, 0], 0, 0, 'ride');
      slab.box([0, -0.2, 0], [4, 0.1, 1], [0.3, 0.3, 0.3]);
      for (let seat = 0; seat < 6; seat++) rideSeat(park, 0, ride, [(seat - 2.5) * 0.6, 0.1, 0], yaw, COLOUR, true, -0.1);
      expect(problems(park, open), `yaw ${yaw}, open ${open}`).toEqual([]);
    }
  });
  it('rejects a row of seats pushed to a 0.5 m pitch, which is narrower than a seat with its rails', () => {
    const { park, ride } = scene('topspin', -0.3), slab = new Parts(park, [0, 0, 0], 0, 0, 'ride');
    slab.box([0, -0.2, 0], [4, 0.1, 1], [0.3, 0.3, 0.3]);
    for (let seat = 0; seat < 6; seat++) rideSeat(park, 0, ride, [(seat - 2.5) * 0.5, 0.1, 0], 0, COLOUR, true, -0.1);
    expect(problems(park).length).toBeGreaterThan(0);
  });
  it('rejects a grab-rail post 50 mm too long, which would stick out through its rail', () => {
    const park = seatOnFloor(0.93, 0.3, 0, true), post = park.parts.find(p => isRod(p, 0.014, 0.046))!;
    expect(problems(park)).toEqual([]);
    lengthen(post, 0.05, [Math.sign(post.pos[0]), 0, 0]);
    expect(problems(park).length).toBeGreaterThan(0);
  });
  it('rejects a restraint arm 50 mm too long, which would stick out below the cross bar', () => {
    const park = seatOnFloor(0.93, 0.3, 0, true), arm = park.parts.find(p => isRod(p, 0.02, 0.296))!;
    lengthen(arm, 0.05, [0, -1, 0]);
    expect(problems(park).length).toBeGreaterThan(0);
  });
  it('rejects a restraint hub shifted 50 mm along its stub, which would leave it off the stub end', () => {
    const park = seatOnFloor(0.93, 0.3, 0, true), hub = park.parts.find(p => isRod(p, 0.035, 0.025))!;
    nudge(hub, [Math.sign(hub.pos[0]) * 0.05, 0, 0]);
    expect(problems(park).length).toBeGreaterThan(0);
  });
  it('rejects a pedestal 50 mm too short, which would leave a gap under the pan', () => {
    const park = seatOnFloor(0.93, 0.3, 0, true), pedestal = park.parts.find(p => p.shape === 'box' && p.half[0] === 0.17 && p.half[2] === 0.13)!;
    expect(problems(park)).toEqual([]);
    pedestal.half[1] -= 0.025; pedestal.pos[1] -= 0.025;
    expect(problems(park).length).toBeGreaterThan(0);
  });
});

describe('carousel horses', () => {
  function horse(variant: number, pole: boolean): ParkData {
    const { park } = scene('carousel', -5), b = new Parts(park, [0, 0, 0], 0, 0, 'ride');
    const shaft = pole ? b.rod([0, -5, 0], [0, 3, 0], 0.035, [0.5, 0.3, 0.1]) : undefined;
    carouselHorse(b, COLOUR, [0.04, 0.68, 0.95], variant, shaft);
    return park;
  }
  it.each([0, 1, 2])('is clean, with and without the pole through its sleeve: variant %i', variant => {
    for (const pole of [true, false]) {
      const park = horse(variant, pole);
      // Without its pole nothing holds the horse up, so only the pole case is judged on support.
      expect(problems(park).filter(line => pole || !line.startsWith('floating')), `pole ${pole}`).toEqual([]);
      expect(brokenJoints(park), `pole ${pole}`).toEqual([]);
    }
  });
  it('rejects a pole 50 mm off the axis of the horse sleeve, which would cut through the sleeve wall', () => {
    const park = horse(0, true), shaft = park.parts[0];
    nudge(shaft, [0.05, 0, 0]);
    expect(problems(park).length).toBeGreaterThan(0);
  });
  it('rejects a stirrup strap that hangs 50 mm clear of the saddle it should be fixed to', () => {
    // The whole strap moves, every length and knuckle of it, so only its fixing to the saddle is wrong.
    const park = horse(0, true), top = park.interfaces!.find(c => c.name === 'carousel-horse-strap')!.b, strap = park.monoliths!.find(m => m.parts.includes(top))!.parts;
    expect(strap.length).toBeGreaterThan(8);
    for (const i of strap) nudge(park.parts[i], [Math.sign(park.parts[top].pos[0]) * 0.05, 0, 0]);
    expect(problems(park).length).toBeGreaterThan(0);
  });
});

describe('coaster cars', () => {
  function car(family: CoasterFamily): ParkData {
    const { park, ride } = scene(family, RAIL.radius);
    carParts(park, 0, ride, COLOUR);
    return park;
  }
  it.each(COASTER_FAMILIES)('is clean with its restraints closed and open: %s', family => {
    const park = car(family);
    for (const open of [0, 1]) {
      expect(problems(park, open), `open ${open}`).toEqual([]);
      expect(brokenJoints(park, open), `open ${open}`).toEqual([]);
    }
  });
  /** Every bogie turned about its kingpin by the given pitch, yaw and roll (degrees), the way a bogie follows the track under a car. */
  function bogiesTurned(park: ParkData, family: CoasterFamily, pitch: number, yaw: number, roll: number): BodyPose[] {
    const out = poses(park, 0), degrees = Math.PI / 180, kingpin: Vec3 = [0, coasterBogiePivot(family), 0];
    park.bodies.forEach((def, i) => {
      if (def.role !== 'bogie') return;
      const turn = qmul(qmul(axisAngle([0, 1, 0], yaw * degrees), axisAngle([1, 0, 0], pitch * degrees)), axisAngle([0, 0, 1], roll * degrees)) as Quat, swung = rotate(turn, kingpin);
      out[i].rot = turn; out[i].pos = add(def.local, [kingpin[0] - swung[0], kingpin[1] - swung[1], kingpin[2] - swung[2]]);
    });
    return out;
  }
  const found = (park: ParkData, family: CoasterFamily, pitch: number, yaw: number, roll: number): number => auditPark(park, bogiesTurned(park, family, pitch, yaw, roll), { ground: () => RAIL.radius }).findings.length;
  it.each(COASTER_FAMILIES)('keeps its bogies clear of the car through pitch, yaw and roll: %s', family => {
    const park = car(family);
    // The track swings bogies up to 6.7 deg in pitch, 4.3 deg in yaw and, over most of the track, 3 deg in roll against the car.
    for (const [pitch, yaw, roll] of [[6.7, 0, 0], [-6.7, 0, 0], [0, 4.3, 0], [0, -4.3, 0], [0, 0, 3], [0, 0, -3], [3.7, 3.4, 3], [-3.7, -3.4, -3]]) expect(found(park, family, pitch, yaw, roll), `${pitch}/${yaw}/${roll}`).toBe(0);
  });
  it('rejects a bogie rolled 9 deg against its car, which would drive the crossbar up through the floor', () => {
    expect(found(car('steel'), 'steel', 0, 0, 9)).toBeGreaterThan(0);
  });
  it('keeps its seat cushions where the guests sit', () => {
    const park = car('steel');
    expect(park.parts.filter(p => p.body === 0 && p.shape === 'box' && p.color === RUBBER && p.half[0] === 0.245)).toHaveLength(4);
  });
  /** Two cars on one chassis line, 3.4 m apart, joined by a drawbar between the rear socket of the first and the front socket of the second. */
  function coupledCars(family: CoasterFamily): { park: ParkData; placed: Map<number, BodyPose>; drawbar: ParkPart } {
    const { park, ride } = scene(family, RAIL.radius);
    const first = carParts(park, 0, ride, COLOUR);
    park.bodies.push({ ride: 0, role: 'car', index: 1, local: [0, 0, 0], train: 0 }); const secondBody = park.bodies.length - 1; ride.bodies.push(secondBody);
    const second = carParts(park, secondBody, ride, COLOUR);
    park.bodies.push({ ride: 0, role: 'coupler', index: 1, local: [0, 0, 0], train: 0 }); ride.bodies.push(park.bodies.length - 1);
    const link = new Parts(park, [0, 0, 0], 0, park.bodies.length - 1, 'ride'), length = coasterCouplerLength(ride.carLength);
    const drawbar = link.rod([0, -length / 2, 0], [0, length / 2, 0], 0.06, [0.3, 0.3, 0.3]), balls = [-1, 1].map(side => link.sphere([0, side * length / 2, 0], 0.055, [0.3, 0.3, 0.3]));
    declareMonolith(park, 'drawbar', [drawbar, ...balls], 'Drawbar with a ball forged on each end.');
    insertEnd(park, first[1], drawbar, -1, 'drawbar-front', 'The drawbar front ball sits in the leading car rear socket.');
    insertEnd(park, second[0], drawbar, 1, 'drawbar-rear', 'The drawbar rear ball sits in the following car front socket.');
    const placed = new Map<number, BodyPose>(), secondCar = pose(), coupler = pose();
    secondCar.pos = [0, 0, ride.carLength]; coupler.pos = [0, coasterCouplerHeight(family), ride.carLength / 2]; coupler.rot = axisAngle([1, 0, 0], Math.PI / 2);
    placed.set(secondBody, secondCar); placed.set(park.bodies.length - 1, coupler);
    return { park, placed, drawbar };
  }
  it.each(['steel', 'inverted'] as const)('joins neighbouring cars with a drawbar whose balls sit in the car sockets: %s', family => {
    const { park, placed } = coupledCars(family);
    expect(problems(park, 0, placed)).toEqual([]);
  });
  it('rejects a drawbar 50 mm too long, which would push its ball out through the socket wall', () => {
    const { park, placed, drawbar } = coupledCars('steel');
    lengthen(drawbar, 0.2, [0, 1, 0]);
    expect(problems(park, 0, placed).length).toBeGreaterThan(0);
  });
  it('rejects a load-wheel axle 50 mm too long, which would push through its hub', () => {
    const park = car('steel'), axle = park.parts.find(p => p.body === 5 && isRod(p, 0.045, 0.105))!;
    lengthen(axle, 0.05, [-Math.sign(axle.pos[0]), 0, 0]);
    expect(problems(park).length).toBeGreaterThan(0);
  });
  it('rejects a guide wheel pushed 50 mm into its arm', () => {
    const park = car('steel'), wheel = park.parts.find(p => p.body === 5 && p.wheelRadius && Math.abs(p.half[1] - 0.07) < 1e-6 && p.pos[0] > 0)!;
    nudge(wheel, [0.05, 0, 0]);
    expect(problems(park).length).toBeGreaterThan(0);
  });
  it('rejects a coupler mount 50 mm too long, which would stick out below its socket', () => {
    const park = car('steel'), mount = park.parts.find(p => p.body === 0 && isRod(p, 0.065, 0.149))!;
    lengthen(mount, 0.2, [0, -1, 0]);
    expect(problems(park).length).toBeGreaterThan(0);
  });
});

describe('seats, restraints and horses in generated parks', () => {
  it.each([43, 1337])('stand clean at every ride of a compact park while its trains and rides run: seed %i', seed => {
    // Parts remember which function made them, so the audit can look at every seat and horse and at what they touch.
    setPartProvenance(true);
    try {
      const recipe = { ...defaultParkRecipe(seed, 'compact'), guests: 300 };
      const park = generatePark(recipe, createTerrainSampler(gradeParkTerrain(testTerrainData({ resolution: 64, cellSize: 32 }), recipe)));
      const runtime = new ParkRuntime(park), poses = park.bodies.map(() => pose());
      const focus = park.parts.map(part => /rideSeat|carouselHorse/.test(partSource(part)));
      expect(focus.filter(Boolean).length).toBeGreaterThan(100);
      while (runtime.elapsed < 20 - 1e-9) runtime.advance(Math.min(PARK_DT, 20 - runtime.elapsed));
      for (let i = 0; i < poses.length; i++) runtime.bodyPose(i, runtime.elapsed, poses[i]);
      const report = auditPark(park, poses, { time: runtime.elapsed, focus: i => focus[i] });
      expect(report.findings.map(f => `${f.kind} ${f.family} ${(f.measured * 1000).toFixed(1)} mm: ${f.detail}`)).toEqual([]);
    } finally { setPartProvenance(false); }
  }, 300000);
});

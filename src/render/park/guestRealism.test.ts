import { describe, expect, it } from 'vitest';
import { Crowd } from '../../world/park/crowd';
import { GUEST_SEAT_Y, guestLegPose, guestSeatAngle } from '../../world/park/guestPose';
import { defaultParkRecipe } from '../../world/park/recipe';
import type { ParkData, RideDefinition } from '../../world/park/types';
import { GUEST_LODS, GUEST_LOOKS, guestMesh, shapeGuest, skinGuestMesh } from './guestSkinReference';
import type { GuestLod } from './guestSkinReference';

/** A crowd on a flat two-station plaza, enough to draw guests' heights, builds and walking speeds. */
function plaza(guests: number): ParkData {
  const ride = (id: number, station: number): RideDefinition => ({ id, station, family: 'carousel', name: `Ride ${id}`, theme: 'carnival', pos: [station * 20, 12, 0], yaw: 0, radius: 5, height: 6, capacity: 4,
    queue: [[station * 20, 12, 0]], exit: [], boarding: [], cars: 1, trains: 1, carLength: 2, emptyCarMass: 100, dragArea: 1, rolling: 0, liftSpeed: 0, motorForce: 100, motorPower: 100, motorTorque: 100, brakeForce: 100, targetOmega: 1, inertia: 100, duration: 20, bodies: [], maxG: 4, maxJerk: 100 });
  return { recipe: { ...defaultParkRecipe(17, 'compact'), guests }, layout: 'hub', bounds: { min: [-100, 0, -100], max: [100, 100, 100] }, entrance: 0, launch: { pos: [0, 12, 0], yaw: 0 },
    nodes: [{ pos: [-20, 12, 0], links: [1], kind: 'entrance' }, { pos: [0, 12, 0], links: [0, 2], kind: 'station' }, { pos: [20, 12, 0], links: [1], kind: 'station' }],
    paths: [{ a: 0, b: 1, width: 8 }, { a: 1, b: 2, width: 8 }], rides: [ride(0, 1), ride(1, 2)], parts: [], bodies: [], lights: [], rooms: [], routes: [] };
}

/** Steps per minute a guest of this height takes, counted from how often the left foot lands over a walk. */
function stepsPerMinute(height: number, speed = 1.2): number {
  let landings = 0, was = guestLegPose(0, speed, height, false).stance;
  const seconds = 20, dt = 0.0005;
  for (let t = dt; t < seconds; t += dt) { const stance = guestLegPose(t, speed, height, false).stance; if (stance && !was) landings++; was = stance; }
  return landings * 2 * 60 / seconds;
}

describe('guest seated body against the seat plane', () => {
  it('keeps pelvis and thighs of every build, size and level of detail on or above the seat plane, with the pelvis touching it', () => {
    // Joints: 0 is the pelvis and torso, 4 and 5 are the left and right thigh.
    const worst: string[] = [];
    for (const lod of GUEST_LODS as GuestLod[]) for (const build of ['slim', 'mid', 'broad'] as const) for (const height of [1.05, 1.5, 1.75, 1.95]) for (const clearance of [0.45, 0.8, 1.1]) {
      const angle = guestSeatAngle(height, clearance), verts = skinGuestMesh(lod, { kind: 'seated', blend: 1, seatAngle: angle }, height, GUEST_LOOKS[build], angle);
      let lowest = Infinity;
      for (const v of verts) if (v.joint === 0 || v.joint === 4 || v.joint === 5) lowest = Math.min(lowest, v.pos[1]);
      // Distance below the seat plane in metres; negative means the body sinks into the cushion.
      const below = (lowest - GUEST_SEAT_Y) * height;
      if (below < -0.002) worst.push(`${lod} ${build} height ${height} clearance ${clearance}: ${(below * 100).toFixed(1)} cm`);
    }
    expect(worst, worst.slice(0, 6).join('\n')).toEqual([]);
  });

  it('rests the broadest build exactly on the seat plane at the standard fold, so the body is not floating either', () => {
    for (const lod of GUEST_LODS as GuestLod[]) for (const height of [1.05, 1.75, 1.95]) {
      const verts = skinGuestMesh(lod, { kind: 'seated', blend: 1, seatAngle: 1.45 }, height, GUEST_LOOKS.broad);
      let lowest = Infinity;
      for (const v of verts) if (v.joint === 0 || v.joint === 4 || v.joint === 5) lowest = Math.min(lowest, v.pos[1]);
      expect((lowest - GUEST_SEAT_Y) * height, `${lod} ${height}`).toBeGreaterThan(-0.002); expect((lowest - GUEST_SEAT_Y) * height, `${lod} ${height}`).toBeLessThan(0.005);
    }
  });
});

describe('guest head size for stature', () => {
  /** Head height as a fraction of standing height, measured on the skinned hero mesh: crown to chin. */
  function headFraction(height: number): number {
    const mesh = guestMesh('hero'); let top = -Infinity;
    for (let i = 0; i < mesh.length; i += 7) if ((Math.floor(mesh[i + 6]) & 15) === 1 && Math.floor(mesh[i + 6]) >> 4 === 1) top = Math.max(top, shapeGuest([mesh[i], mesh[i + 1], mesh[i + 2]], [0, 1, 0], GUEST_LOOKS.mid, height).pos[1]);
    const chin = shapeGuest([0, 0.87, 0], [0, 1, 0], GUEST_LOOKS.mid, height).pos[1];
    return (top - chin) / top;
  }
  it('gives children the larger head they have for their height, and adults about a seventh to an eighth', () => {
    // Education-site summaries (search results, not clinical tables): head is about a sixth of stature at 5-6 years, about a seventh to an eighth for adults.
    expect(headFraction(1.15)).toBeGreaterThan(1 / 6.8); expect(headFraction(1.15)).toBeLessThan(1 / 5.6);
    expect(headFraction(1.75)).toBeGreaterThan(1 / 8.2); expect(headFraction(1.75)).toBeLessThan(1 / 7);
    expect(headFraction(1.05)).toBeGreaterThan(headFraction(1.3)); expect(headFraction(1.3)).toBeGreaterThan(headFraction(1.55));
  });
});

describe('guest hair across close levels of detail', () => {
  /** Smallest and largest coordinates of every hair vertex (materials 4, 10 and 11), metres, standing and shaped for this build and height. */
  function hairBounds(lod: GuestLod, look: typeof GUEST_LOOKS.mid, height: number): number[] {
    const mesh = guestMesh(lod), lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
    for (let i = 0; i < mesh.length; i += 7) {
      const code = Math.floor(mesh[i + 6]), material = code >> 4;
      if ((code & 15) !== 1 || (material !== 4 && material !== 10 && material !== 11) || mesh[i + 1] < 0.8) continue;
      const p = shapeGuest([mesh[i], mesh[i + 1], mesh[i + 2]], [0, 1, 0], look, height).pos;
      for (let k = 0; k < 3; k++) { lo[k] = Math.min(lo[k], p[k] * height); hi[k] = Math.max(hi[k], p[k] * height); }
    }
    return [...lo, ...hi];
  }
  it('gives the near and hero meshes the same hair outline, so hair does not change shape when the level of detail does', () => {
    // Before the near mesh used the hero's dome and tied-back lock it had a small cap on the crown and no lock: the back of the head was bare and the lock was missing.
    const differences: string[] = [];
    for (const build of ['slim', 'broad'] as const) for (const height of [1.15, 1.75, 1.95]) {
      const near = hairBounds('near', GUEST_LOOKS[build], height), hero = hairBounds('hero', GUEST_LOOKS[build], height);
      near.forEach((v, k) => { if (Math.abs(v - hero[k]) > 0.015) differences.push(`${build} ${height} m ${['x min', 'y min', 'z min', 'x max', 'y max', 'z max'][k]}: near ${v.toFixed(3)} hero ${hero[k].toFixed(3)}`); });
    }
    expect(differences, differences.slice(0, 4).join('\n')).toEqual([]);
  });
});

describe('guest walking against published gait data', () => {
  it('takes steps at a rate that falls with height as in adult moderate-intensity walking', () => {
    // Strathprints record 35536, "Stride rate recommendations for moderate-intensity walking": about 113 steps/min at 152 cm falling to about 90 at 198 cm.
    // Figures read from its search summary; the paper itself was not opened.
    expect(stepsPerMinute(1.52)).toBeGreaterThan(105); expect(stepsPerMinute(1.52)).toBeLessThan(121);
    expect(stepsPerMinute(1.98)).toBeGreaterThan(83); expect(stepsPerMinute(1.98)).toBeLessThan(97);
    expect(stepsPerMinute(1.75)).toBeGreaterThan(92); expect(stepsPerMinute(1.75)).toBeLessThan(112);
  });

  it('keeps small children below a stepping rate of three steps a second', () => {
    expect(stepsPerMinute(1.05)).toBeLessThan(180);
  });

  it('never slides a planted foot at any walking speed a guest can be given, for every guest height', () => {
    // Boarding walkers use 1.5 m/s and the crowd's own fastest pace is below that; both must be inside what the stride can follow.
    const sliding: string[] = [];
    for (const height of [1.05, 1.3, 1.55, 1.75, 1.95]) for (const speed of [0.3, 0.8, 1.2, 1.5]) for (let i = 0; i < 40; i++) {
      const time = i * 0.037, a = guestLegPose(time, speed, height, false), b = guestLegPose(time + 1e-5, speed, height, false);
      if (a.stance && b.stance) {
        const footSpeed = (b.ankle[1] - a.ankle[1]) * height / 1e-5;
        if (Math.abs(footSpeed - speed) > 1e-3) sliding.push(`height ${height} speed ${speed}: foot moves ${footSpeed.toFixed(3)} m/s`);
      }
    }
    expect(sliding).toEqual([]);
  });

  it('walks small children slower than tall adults, and nobody faster than the stride can follow', () => {
    // Walking speed at a comfortable pace grows with leg length (dynamic similarity, Alexander 1976; from memory, not reopened).
    const cruise = (height: number, index: number) => {
      const c = new Crowd(plaza(index + 1)); c.mode.fill(0); c.height[index] = height; c.node[index] = 0; c.target[index] = 1; c.goal[index] = 2;
      c.pos.set([-19, 12, 0], index * 3); c.vel.fill(0);
      for (let frame = 0; frame < 120; frame++) { c.steer(0.04, null); for (let step = 0; step < 10; step++) c.move(0.004); }
      return Math.hypot(c.vel[index * 3], c.vel[index * 3 + 2]);
    };
    for (const index of [0, 4, 8]) {
      const child = cruise(1.05, index), adult = cruise(1.75, index), tall = cruise(1.95, index);
      expect(child, `slot ${index}`).toBeLessThan(adult * 0.9); expect(tall).toBeLessThan(1.54);
    }
  });
});

describe('guest crowd statures, builds and walking pace', () => {
  const crowd = new Crowd(plaza(6000));
  it('draws adults from a bell curve around the adult average, not evenly from 1.55 to 1.95 m', () => {
    // CDC NCHS Anthropometric Reference Data 2015-2018 (stacks.cdc.gov/view/cdc/100478): US men aged 20+ average about 69 in (1.75 m); women's average (about 1.61 m) not confirmed.
    const adults = [...crowd.height].filter(h => h >= 1.5);
    const mean = adults.reduce((s, h) => s + h, 0) / adults.length, tall = adults.filter(h => h > 1.85).length / adults.length, short = adults.filter(h => h < 1.55).length / adults.length;
    expect(mean).toBeGreaterThan(1.63); expect(mean).toBeLessThan(1.73);
    expect(tall).toBeLessThan(0.1); expect(short).toBeGreaterThan(0.02);
  });

  it('gives every guest a body mass a person of that height could have (body mass index 14 to 42)', () => {
    // WHO classes severe thinness as a body mass index under 16 and class III obesity as 40 and over; children's index is lower.
    const bad: string[] = [];
    for (let i = 0; i < crowd.count; i++) {
      const bmi = crowd.mass[i] / crowd.height[i] ** 2, child = crowd.height[i] < 1.5;
      if (bmi < (child ? 13.5 : 16) || bmi > (child ? 24 : 42)) bad.push(`guest ${i}: height ${crowd.height[i].toFixed(2)} mass ${crowd.mass[i].toFixed(0)} index ${bmi.toFixed(1)}`);
    }
    expect(bad.length, bad.slice(0, 5).join('\n')).toBe(0);
  });
});

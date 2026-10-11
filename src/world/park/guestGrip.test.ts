import { describe, expect, it } from 'vitest';
import type { Quat, Vec3 } from '../../contracts';
import { GUEST_LODS, GUEST_LOOKS, skinGuestMesh, skinGuestVertex } from '../../render/park/guestSkinReference';
import { GUEST_SEAT_BACK_FACE, GUEST_SEAT_PAN_FRONT, GUEST_SEAT_Y, guestSeatAngle } from './guestPose';
import { partFrame, signedDistance, solidOf } from './interference';
import { add, pose, qmul, rotate } from './math';
import { rideSeat } from './parts';
import { defaultParkRecipe } from './recipe';
import { SEAT_PAN } from './rideDimensions';
import type { BodyPose, ParkData, ParkPart, RideDefinition } from './types';

/** One seat with its restraint closed, in an otherwise empty scene: rider faces -z, seat origin at the pan's underside. */
function closedSeat(): { bar: { y: number; z: number; radius: number }; seatY: number; foam: ParkPart[] } {
  const ride = { id: 0, family: 'steel', carLength: 3.4, bodies: [0], cars: 1, trains: 1 } as unknown as RideDefinition;
  const park = { recipe: defaultParkRecipe(), layout: 'hub', bounds: { min: [-1000, -1000, -1000], max: [1000, 1000, 1000] }, entrance: 0, launch: { pos: [0, 0, 0], yaw: 0 },
    rides: [ride], parts: [], bodies: [{ ride: 0, role: 'car', index: 0, local: [0, 0, 0], train: 0 }], lights: [], rooms: [], routes: [], nodes: [], paths: [], interfaces: [], monoliths: [], joints: [] } as unknown as ParkData;
  const seatY = 1.12 - SEAT_PAN;
  rideSeat(park, 0, ride, [0, seatY, 0], 0, [0.2, 0.3, 0.4], true, undefined);
  // The same placement the runtime gives a closed restraint: its hinge frame follows the seat's body.
  const body0: BodyPose = pose(), bodies: BodyPose[] = park.bodies.map(() => pose());
  park.bodies.forEach((def, i) => {
    if (def.role !== 'restraint') return;
    const parent = bodies[def.parent!] ?? body0;
    bodies[i].pos = add(parent.pos, rotate(parent.rot, def.local));
    bodies[i].rot = (def.localRot ? qmul(parent.rot, def.localRot) : parent.rot) as Quat;
  });
  // The cross bar is the thickest rod carried by a restraint body.
  const rods = park.parts.filter((p: ParkPart) => p.body > 0 && park.bodies[p.body].role === 'restraint' && p.shape === 'cylinder').sort((a, b) => b.half[0] - a.half[0]);
  const frame = partFrame(rods[0], bodies[rods[0].body]);
  const foam = park.parts.filter((p: ParkPart) => p.body === 0 && p.shape === 'box' && p.roughness === 0.86);
  return { bar: { y: frame.pos[1] - seatY - SEAT_PAN, z: frame.pos[2], radius: rods[0].half[0] }, seatY, foam };
}

describe('seated hands and the lap bar', () => {
  it('lays the palms of every guest on top of the closed lap bar, whatever their height and build', () => {
    const { bar } = closedSeat();
    expect(bar.radius).toBeGreaterThan(0.03); expect(bar.radius).toBeLessThan(0.06);
    const misses: string[] = [];
    for (const height of [1.05, 1.3, 1.55, 1.75, 1.95]) for (const build of ['slim', 'mid', 'broad'] as const) for (const side of [-1, 1]) {
      // The forearm joint of this side (10 left, 11 right) at the centre of the rest-pose palm, fully weighted to the forearm.
      const joint = side < 0 ? 10 : 11, code = joint + 16 * 1 + 0.5;
      const palm = skinGuestVertex([side * 0.17, 0.425, 0], [0, -1, 0], code, { kind: 'seated', blend: 1 }, height, GUEST_LOOKS[build]) as Vec3;
      // Height above the cushion top and distance forward of the seat centre, in metres. The rider faces -z in the seat frame.
      const above = (palm[1] - GUEST_SEAT_Y) * height, forward = palm[2] * height;
      const distance = Math.hypot(above - bar.y, forward - bar.z);
      if (distance < bar.radius - 0.005 || distance > bar.radius + 0.03 || above < bar.y) misses.push(`height ${height} ${build}: palm ${above.toFixed(3)} m up, ${forward.toFixed(3)} m forward; bar ${bar.y.toFixed(3)} / ${bar.z.toFixed(3)}; distance ${distance.toFixed(3)}`);
    }
    expect(misses, misses.slice(0, 4).join('\n')).toEqual([]);
  });

  it('keeps the dimensions the seated body is fitted to equal to the seat the ride builds', () => {
    const { foam } = closedSeat(), cushion = foam.find(p => p.half[1] < 0.1)!, pad = foam.find(p => p.half[1] > 0.2 && p.half[2] < 0.1)!;
    expect(cushion, 'cushion').toBeDefined(); expect(pad, 'back pad').toBeDefined();
    expect(cushion.pos[2] - cushion.half[2]).toBeCloseTo(-GUEST_SEAT_PAN_FRONT, 2);
    expect(pad.pos[2] - pad.half[2]).toBeCloseTo(GUEST_SEAT_BACK_FACE, 2);
  });
});

describe('seated body and the seat cushion and back pad', () => {
  it('lets no build, size or level of detail sink more than the foam can give into the cushion or the back pad', () => {
    const { foam, seatY } = closedSeat(), solids = foam.map((p, i) => solidOf(p, i)), over: string[] = [];
    const panTop = seatY + SEAT_PAN;
    for (const lod of GUEST_LODS) for (const build of ['slim', 'mid', 'broad'] as const) for (const height of [1.05, 1.3, 1.55, 1.75, 1.95]) {
      const angle = guestSeatAngle(height, 0.45), worst = new Map<number, number>(solids.map((_, i) => [i, 0]));
      for (const v of skinGuestMesh(lod, { kind: 'seated', blend: 1, seatAngle: angle }, height, GUEST_LOOKS[build], angle)) {
        // Only the trunk, pelvis, thighs and head rest against the seat; shins and feet hang over its front.
        // A tied-back lock of hair (material 10) hangs loose behind the neck and is not pressed against the pad.
        if ((v.joint > 1 && v.joint !== 4 && v.joint !== 5) || v.material === 10) continue;
        const p: Vec3 = [v.pos[0] * height, (v.pos[1] - GUEST_SEAT_Y) * height + panTop, v.pos[2] * height];
        solids.forEach((s, i) => { const d = signedDistance(s, p); if (d < worst.get(i)!) worst.set(i, d); });
      }
      solids.forEach((_, i) => { if (worst.get(i)! < -0.025) over.push(`${lod} ${build} height ${height}: ${foam[i].half[1] < 0.1 ? 'cushion' : 'back pad'} ${(-worst.get(i)! * 100).toFixed(1)} cm`); });
    }
    expect(over, over.slice(0, 5).join('; ')).toEqual([]);
  });
});

import { describe, expect, it } from 'vitest';
import type { Vec3 } from '../../contracts';
import { GUEST_LODS, GUEST_LOOKS, skinGuestMesh } from '../../render/park/guestSkinReference';
import { GUEST_SEAT_Y, guestSeatAngle } from './guestPose';
import { signedDistance, solidOf } from './interference';
import { Parts, carouselHorse } from './parts';
import { defaultParkRecipe } from './recipe';
import { CAROUSEL_WITHERS } from './rideDimensions';
import type { ParkData, ParkPart } from './types';

/** The carved horse alone, in its pole's frame: faces -z, saddle top about 0.85 m up, the pole through its withers at the origin.
 * Riders sit at [0, 0.86, CAROUSEL_WITHERS], as the runtime places them. */
function horse(): ParkPart[] {
  const park = { recipe: defaultParkRecipe(), layout: 'hub', bounds: { min: [-1000, -1000, -1000], max: [1000, 1000, 1000] }, entrance: 0, launch: { pos: [0, 0, 0], yaw: 0 },
    rides: [], parts: [], bodies: [], lights: [], rooms: [], routes: [], nodes: [], paths: [], interfaces: [], monoliths: [], joints: [] } as unknown as ParkData;
  const b = new Parts(park, [0, 0, 0], 0, -1, 'ride'), pole = b.rod([0, -5, 0], [0, 3, 0], 0.035, [0.5, 0.3, 0.1]);
  carouselHorse(b, [0.5, 0.5, 0.5], [0.04, 0.68, 0.95], 0, pole);
  // The jumper pole is solid and rises in front of the rider, and every piece of the carving counts as hard wood.
  return park.parts as ParkPart[];
}

describe('guest astride a carousel horse', () => {
  // The smallest children (1.05 m) cannot reach round the barrel; their feet stay 1 to 2.6 cm inside the painted hide.
  const LIMIT = 0.03;
  function deepest(straddle: number): string[] {
    const parts = horse(), solids = parts.map((p, i) => solidOf(p, i)), worst: string[] = [];
    for (const height of [1.05, 1.25, 1.5, 1.75, 1.98]) for (const lod of GUEST_LODS) for (const build of ['slim', 'mid', 'broad'] as const) {
      const angle = guestSeatAngle(height, 0.45), depth = parts.map(() => 0);
      for (const v of skinGuestMesh(lod, { kind: 'seated', blend: 1, seatAngle: angle, straddle }, height, GUEST_LOOKS[build], angle)) {
        // Guest-local to horse frame: the pelvis sits on the saddle at 0.86 m.
        const p: Vec3 = [v.pos[0] * height, 0.86 + (v.pos[1] - GUEST_SEAT_Y) * height, CAROUSEL_WITHERS + v.pos[2] * height];
        solids.forEach((s, i) => { depth[i] = Math.min(depth[i], signedDistance(s, p)); });
      }
      depth.forEach((d, i) => { if (-d > LIMIT) worst.push(`${lod} ${build} ${height} m: ${(-d * 100).toFixed(1)} cm into the horse's ${parts[i].half.map(h => h.toFixed(2)).join('/')} piece`); });
    }
    return worst;
  }

  it('keeps legs, hips and body out of the horse for every build, size and level of detail, with the legs either side of the barrel', () => {
    const bad = deepest(1);
    expect(bad, bad.slice(0, 5).join('\n')).toEqual([]);
  });

  it('would sink the same riders into the barrel and neck if their legs hung straight down', () => {
    // Guards the test above: it would pass for any pose if the horse were not where the riders are.
    expect(deepest(0).length).toBeGreaterThan(20);
  });
});

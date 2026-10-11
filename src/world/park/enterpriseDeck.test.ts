import { expect, it } from 'vitest';
import { ENTERPRISE_CABINS, enterpriseCabinOverSlot } from './flatPhysics';
import { inverseRotate, sub, TAU, wrap } from './math';
import { CONCRETE, Parts } from './parts';
import { ENTERPRISE_DECK, enterpriseBase } from './newFlatAssets';
import type { ParkData, ParkPart } from './types';

it('casts the Enterprise deck as a ring that covers the annulus, leaves the boom slot open and stays inside the base', () => {
  const park = { parts: [], bodies: [] } as unknown as ParkData, b = new Parts(park);
  const landing = b.box([0, 1.15, 10.5], [2.6, 0.15, 1.4], CONCRETE);
  enterpriseBase(b, landing, CONCRETE, 'test');
  const ring = park.monoliths![0].parts.map(i => park.parts[i]).filter(p => p !== landing);
  const inside = (p: ParkPart, x: number, z: number) => {
    const local = inverseRotate(p.rot, sub([x, p.pos[1], z], p.pos));
    return Math.abs(local[0]) <= p.half[0] + 1e-9 && Math.abs(local[2]) <= p.half[2] + 1e-9;
  };
  const { inner, outer, segments, notch, corridor } = ENTERPRISE_DECK, notchHalf = notch * Math.PI / segments;
  let gaps = 0, intrusions = 0;
  for (let x = -outer; x <= outer; x += 0.05) for (let z = -outer; z <= outer; z += 0.05) {
    const radius = Math.hypot(x, z), fromNotch = Math.abs(Math.atan2(x, -z));
    if (radius < inner + 0.05 || radius > outer - 0.05) continue;
    const covered = ring.some(p => inside(p, x, z));
    if (Math.abs(x) < corridor && z < 0 && covered) intrusions++;
    if (fromNotch > notchHalf + 0.01 && !covered) gaps++;
  }
  expect(gaps, 'deck points left uncovered').toBe(0);
  expect(intrusions, 'deck points inside the boom corridor').toBe(0);
  // Chord edges may stand proud of the circle by the polygon sag only.
  const sag = outer / Math.cos(Math.PI / ENTERPRISE_DECK.segments) - outer;
  for (const p of ring) for (const u of [-1, 1]) for (const w of [-1, 1]) {
    const local = [u * p.half[0], 0, w * p.half[2]] as const;
    const c = Math.cos(2 * Math.atan2(p.rot[1], p.rot[3])), s = Math.sin(2 * Math.atan2(p.rot[1], p.rot[3]));
    expect(Math.hypot(p.pos[0] + c * local[0] + s * local[2], p.pos[2] - s * local[0] + c * local[2])).toBeLessThanOrEqual(outer + sag + 1e-6);
  }
});

it('boards only the Enterprise cabins whose walk round the deck stays on cast deck', () => {
  const park = { parts: [], bodies: [] } as unknown as ParkData, b = new Parts(park);
  const landing = b.box([0, 1.15, 10.5], [2.6, 0.15, 1.4], CONCRETE);
  enterpriseBase(b, landing, CONCRETE, 'test');
  const ring = park.monoliths![0].parts.map(i => park.parts[i]).filter(p => p !== landing);
  const onDeck = (x: number, z: number) => ring.some(p => {
    const local = inverseRotate(p.rot, sub([x, p.pos[1], z], p.pos));
    return Math.abs(local[0]) <= p.half[0] + 1e-9 && Math.abs(local[2]) <= p.half[2] + 1e-9;
  });
  // The guest route the runtime builds: from the landing (+z) round the ring at 9.9 m in steps of at most 0.25 rad.
  const route = (cabin: number) => {
    const delta = wrap(cabin * TAU / ENTERPRISE_CABINS - Math.PI / 2 + Math.PI, TAU) - Math.PI, steps = Math.max(1, Math.ceil(Math.abs(delta) / 0.25));
    return Array.from({ length: steps + 1 }, (_, i) => { const a = Math.PI / 2 + delta * i / steps; return [Math.cos(a) * 9.9, Math.sin(a) * 9.9] as const; });
  };
  const skipped: number[] = [];
  for (let cabin = 0; cabin < ENTERPRISE_CABINS; cabin++) {
    const points = route(cabin);
    if (enterpriseCabinOverSlot(cabin)) { skipped.push(cabin); expect(onDeck(...points[points.length - 1]), `cabin ${cabin} stop`).toBe(false); }
    else for (const p of points) expect(onDeck(...p), `cabin ${cabin} route at ${p.map(v => v.toFixed(2))}`).toBe(true);
  }
  expect(skipped).toEqual([14, 15, 16]);
});

import { describe, expect, it } from 'vitest';
import type { InstanceSet, VegPlacement } from './placement';
import { forestSpot, rockSpot } from './spots';
import { testScene } from './testScene';
import { VARIANTS_OF, VARIANT_DEFS } from './variants';

const RAD = Math.PI / 180;

function emptySet(): InstanceSet {
  return { count: 0, pos: new Float32Array(0), scale: new Float32Array(0), yaw: new Float32Array(0), variant: new Uint8Array(0), tint: new Uint32Array(0), nrm: new Uint32Array(0), pathDist: new Float32Array(0) };
}

const nothing: VegPlacement = { plants: emptySet(), rocks: emptySet(), trees: 0, bushes: 0, obstacleTrees: 0 };

describe('forestSpot', () => {
  const { high } = testScene();
  const spot = forestSpot(high);

  it('finds a clearing in the real placement, deterministically', () => {
    expect(spot).not.toBeNull();
    expect(forestSpot(high)).toEqual(spot);
  });

  it('stands at least 4 m from every trunk', () => {
    const s = spot as NonNullable<typeof spot>;
    let nearest = Infinity;
    for (let i = 0; i < high.plants.count; i++) {
      if (VARIANT_DEFS[high.plants.variant[i]].group !== 'tree') continue;
      nearest = Math.min(nearest, Math.hypot(high.plants.pos[i * 3] - s.x, high.plants.pos[i * 3 + 2] - s.z));
    }
    expect(nearest).toBeGreaterThanOrEqual(4);
  });

  it('looks down a trunk-free lane 5 m wide with trees on both flanks', () => {
    const s = spot as NonNullable<typeof spot>;
    const dx = Math.sin(s.yaw * RAD), dz = -Math.cos(s.yaw * RAD);
    let inLane = 0, left = 0, right = 0;
    for (let i = 0; i < high.plants.count; i++) {
      if (VARIANT_DEFS[high.plants.variant[i]].group !== 'tree') continue;
      const rx = high.plants.pos[i * 3] - s.x, rz = high.plants.pos[i * 3 + 2] - s.z;
      const along = rx * dx + rz * dz, side = -rx * dz + rz * dx;
      if (along < 3 || along > 30) continue;
      if (Math.abs(side) < 2.5) inLane++;
      else if (side > 0 && side < 12) left++;
      else if (side < 0 && side > -12) right++;
    }
    expect(inLane).toBe(0);
    expect(left + right).toBeGreaterThan(10);
  });

  it('reports no spot when the placement has no trees, or only bushes', () => {
    expect(forestSpot(nothing)).toBeNull();
    const bushes = emptySet();
    bushes.count = 100;
    bushes.pos = new Float32Array(300);
    bushes.variant = new Uint8Array(100).fill(VARIANTS_OF.bush[0]);
    for (let i = 0; i < 100; i++) { bushes.pos[i * 3] = (i % 10) * 3; bushes.pos[i * 3 + 2] = Math.floor(i / 10) * 3; }
    expect(forestSpot({ ...nothing, plants: bushes, bushes: 100 })).toBeNull();
  });
});

describe('rockSpot', () => {
  const { high } = testScene();
  const spot = rockSpot(high);

  it('finds a rock field in the real placement, deterministically', () => {
    expect(spot).not.toBeNull();
    expect(rockSpot(high)).toEqual(spot);
  });

  it('faces a boulder of at least 0.8 m radius at the stand-off distance, with a field of rocks around it', () => {
    const s = spot as NonNullable<typeof spot>;
    const dx = Math.sin(s.yaw * RAD), dz = -Math.cos(s.yaw * RAD);
    let faced = -1;
    for (let i = 0; i < high.rocks.count; i++) {
      if (high.rocks.scale[i] < 0.8) continue;
      const rx = high.rocks.pos[i * 3] - s.x, rz = high.rocks.pos[i * 3 + 2] - s.z;
      const stand = 2 + 2.2 * high.rocks.scale[i];
      if (Math.abs(Math.hypot(rx, rz) - stand) < 1e-3 && rx * dx + rz * dz > stand - 1e-3) { faced = i; break; }
    }
    expect(faced).toBeGreaterThanOrEqual(0);
    let neighbours = 0;
    for (let i = 0; i < high.rocks.count; i++) {
      if (Math.hypot(high.rocks.pos[i * 3] - high.rocks.pos[faced * 3], high.rocks.pos[i * 3 + 2] - high.rocks.pos[faced * 3 + 2]) <= 25) neighbours++;
    }
    expect(neighbours).toBeGreaterThanOrEqual(8);
  });

  it('reports no spot without rocks, or when every rock is a pebble', () => {
    expect(rockSpot(nothing)).toBeNull();
    const pebbles = emptySet();
    pebbles.count = 20;
    pebbles.pos = new Float32Array(60);
    pebbles.scale = new Float32Array(20).fill(0.4);
    for (let i = 0; i < 20; i++) pebbles.pos[i * 3] = i;
    expect(rockSpot({ ...nothing, rocks: pebbles })).toBeNull();
  });
});

import { describe, expect, it } from 'vitest';
import { placeVegetation, TIER_LIMITS } from './placement';
import { testScene } from './testScene';

describe('placement, kept for the same world', () => {
  it('hands back the same placement for an identical world, and places afresh when anything it reads changes', () => {
    const { terrain, track } = testScene();
    const first = placeVegetation(terrain, track, TIER_LIMITS.ultra);
    expect(placeVegetation(terrain, track, TIER_LIMITS.ultra)).toBe(first);
    // An equal copy (new arrays, same content) is the same world.
    const copy = { ...terrain, height: terrain.height.slice() };
    expect(placeVegetation(copy, track, TIER_LIMITS.ultra)).toBe(first);
    // A height edited in place, other limits or no track: placed again.
    const edited = { ...terrain, height: terrain.height.slice() };
    edited.height[edited.height.length >> 1] += 1;
    expect(placeVegetation(edited, track, TIER_LIMITS.ultra)).not.toBe(first);
    expect(placeVegetation(terrain, track, TIER_LIMITS.high)).not.toBe(first);
    expect(placeVegetation(terrain, null, TIER_LIMITS.ultra)).not.toBe(first);
  });
});

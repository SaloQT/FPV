import { describe, expect, it } from 'vitest';
import { FAR_CARD_WORDS, FAR_CELL, farSpecies, packFarInfo, placeFarForest, type FarForest, type FarOptions } from './treePlanFar';
import { MAX_SLOPE_DEG } from './placementRules';
import { TerrainFields } from './terrainFields';
import { testScene } from './testScene';
import { VARIANTS_OF } from './variants';

const { terrain, track, high } = testScene();
const fields = new TerrainFields(terrain);
const ring = high.plantRing[high.plants.count - 1];
const opts: FarOptions = { cap: 60000, radius: 1500, coveredRing: ring - 24, uncoveredNear: 150 };
const forest = placeFarForest(terrain, track, opts);
const f32 = new Float32Array(forest.words.buffer, forest.words.byteOffset, forest.words.length);
const card = (i: number) => ({
  x: f32[i * FAR_CARD_WORDS], y: f32[i * FAR_CARD_WORDS + 1], z: f32[i * FAR_CARD_WORDS + 2], height: f32[i * FAR_CARD_WORDS + 3], width: f32[i * FAR_CARD_WORDS + 4],
  tint: forest.words[i * FAR_CARD_WORDS + 5], near: f32[i * FAR_CARD_WORDS + 6], info: forest.words[i * FAR_CARD_WORDS + 7],
});

describe('placeFarForest on a generated terrain and race track', () => {
  it('places a few thousand cards in 32-byte records', () => {
    expect(forest.count).toBeGreaterThan(1000);
    expect(forest.words.length).toBe(forest.count * FAR_CARD_WORDS);
  });

  it('is deterministic', () => {
    const again = placeFarForest(terrain, track, opts);
    expect(again.count).toBe(forest.count);
    expect(again.words).toEqual(forest.words);
  });

  it('keeps every card on the map, on the ground, of a sane size, with a species, 1 to 3 crowns and a tint', () => {
    for (let i = 0; i < forest.count; i++) {
      const c = card(i);
      expect(fields.inside(c.x, c.z, 6)).toBe(true);
      expect(c.y).toBeCloseTo(fields.height(c.x, c.z), 3);
      expect(c.height).toBeGreaterThan(3);
      expect(c.height).toBeLessThan(40);
      expect(c.width).toBeGreaterThanOrEqual(FAR_CELL);
      expect(c.width).toBeLessThanOrEqual(FAR_CELL * 1.5);
      expect(c.info & 7).toBeLessThan(4);
      expect((c.info >> 3) & 3).toBeLessThan(3);
      expect(c.tint).not.toBe(0);
    }
  });

  it('puts cards only where trees can grow: not on steep ground and not under water', () => {
    const tan = Math.tan((MAX_SLOPE_DEG * Math.PI) / 180);
    for (let i = 0; i < forest.count; i++) {
      const c = card(i);
      expect(fields.gradient(c.x, c.z)).toBeLessThan(tan);
      expect(c.y).toBeGreaterThan(terrain.waterLevel);
    }
  });

  it('honours the cap and is a nearest-first prefix: a smaller cap gives the first cards of the larger one', () => {
    const few = placeFarForest(terrain, track, { ...opts, cap: 100 });
    expect(few.count).toBe(100);
    expect(few.words).toEqual(forest.words.subarray(0, 100 * FAR_CARD_WORDS));
  });

  it('marks cards over ground beyond the real trees to show from the near distance, and the rest to follow the tree draw distance', () => {
    let far = 0;
    for (let i = 0; i < forest.count; i++) {
      const n = card(i).near;
      expect(n === 0 || n === opts.uncoveredNear).toBe(true);
      if (n > 0) far++;
    }
    expect(far).toBe(forest.uncovered);
    expect(far).toBeGreaterThan(0);
    expect(far).toBeLessThan(forest.count);
  });

  it('has no uncovered cards when the real trees reach everywhere, and more of them the less ground the trees cover', () => {
    const all: FarForest = placeFarForest(terrain, track, { ...opts, coveredRing: Infinity });
    expect(all.uncovered).toBe(0);
    expect(all.count).toBe(forest.count);
    const none = placeFarForest(terrain, track, { ...opts, coveredRing: -1 });
    expect(none.uncovered).toBe(none.count);
    expect(none.uncovered).toBeGreaterThan(forest.uncovered);
  });

  it('places fewer cards with a smaller radius', () => {
    expect(placeFarForest(terrain, track, { ...opts, radius: 300 }).count).toBeLessThan(forest.count);
  });
});

describe('far card species', () => {
  it('maps the tree variants to four classes and round-trips the info word', () => {
    expect([...VARIANTS_OF.spruce, ...VARIANTS_OF.pine, ...VARIANTS_OF.oak, ...VARIANTS_OF.birch].map(farSpecies)).toEqual([0, 0, 1, 2, 2, 3]);
    const w = packFarInfo(3, 2, 0xabcd);
    expect(w & 7).toBe(3);
    expect(((w >> 3) & 3) + 1).toBe(2);
    expect(w >>> 5).toBe(0xabcd);
  });
});

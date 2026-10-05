import { beforeAll, describe, expect, it } from 'vitest';
import { TRACK_FEATURES, type TerrainSampler, type TrackData, type TrackRecipe } from '../../contracts';
import { generateTrack } from './generator';
import { RECIPE_GATE_KINDS, RECIPE_LIMITS, RECIPE_OBJECT_KINDS, defaultRecipe, randomRecipe, recipeKey, sanitizeRecipe, specForRecipe, trackSpec, type RecipeNumberKey } from './recipe';
import { STYLE_SPECS } from './styles';
import { makeTestSampler } from './testTerrain';
import { validateTrack } from './validate';
import { featureZones } from './validateFeatures';

const SLOW = 120_000;
const NUMBERS: RecipeNumberKey[] = ['seed', 'laps', 'gateCount', 'length', 'difficulty', 'elevation', 'twist', 'obstacles', 'featureShare'];

/** True when v is on the limit's grid (min + k * step) and inside it. */
function onGrid(v: number, key: RecipeNumberKey | 'weight'): boolean {
  const l = RECIPE_LIMITS[key];
  const k = (v - l.min) / l.step;
  return v >= l.min && v <= l.max && Math.abs(k - Math.round(k)) < 1e-6;
}

function expectSane(r: TrackRecipe): void {
  expect(r.version).toBe(1);
  expect(typeof r.closed).toBe('boolean');
  for (const k of NUMBERS) expect(onGrid(r[k], k), `${k} = ${r[k]}`).toBe(true);
  if (!r.closed) expect(r.laps).toBe(1);
  for (const [k, w] of Object.entries(r.gates)) {
    expect(RECIPE_GATE_KINDS).toContain(k);
    expect(onGrid(w!, 'weight') && w! > 0).toBe(true);
  }
  for (const [k, w] of Object.entries(r.features)) {
    expect(TRACK_FEATURES).toContain(k);
    expect(onGrid(w!, 'weight') && w! > 0).toBe(true);
  }
  for (const [k, w] of Object.entries(r.objects)) {
    expect(RECIPE_OBJECT_KINDS).toContain(k);
    expect(onGrid(w!, 'weight') && w! > 0).toBe(true);
  }
}

describe('sanitizeRecipe', () => {
  it('turns anything into a valid recipe without throwing', () => {
    const junk: unknown[] = [
      undefined, null, 0, 'recipe', [], [1, 2], true, () => 1, { closed: 'yes' },
      { seed: -5, laps: 99, gateCount: 1e9, length: -1, difficulty: NaN, elevation: Infinity, twist: -Infinity, obstacles: '0.5', featureShare: {} },
      { gates: { square: 7, bogus: 1, arch: -1, hoop: NaN }, features: 'split-s', objects: [1] },
      { gates: null, features: { 'split-s': 0.333, nope: 1 }, objects: { tree: 0.02, container: 0.99 } },
      JSON.parse('{"__proto__": {"x": 1}, "seed": 12}'),
    ];
    for (const j of junk) expectSane(sanitizeRecipe(j));
  });

  it('keeps a valid recipe as it is and is idempotent', () => {
    const d = defaultRecipe();
    expect(sanitizeRecipe(d)).toEqual(d);
    for (let s = 0; s < 30; s++) {
      const once = sanitizeRecipe({ ...randomRecipe(s), difficulty: 0.123456, length: 777.7, laps: 2.6 });
      expect(sanitizeRecipe(once)).toEqual(once);
    }
  });

  it('clamps and quantises to the slider steps; an open course flies one lap', () => {
    const r = sanitizeRecipe({ ...defaultRecipe(), seed: 12.7, laps: 0, gateCount: 100, length: 1234, difficulty: 0.666, closed: true });
    expect(r.seed).toBe(13);
    expect(r.laps).toBe(1);
    expect(r.gateCount).toBe(RECIPE_LIMITS.gateCount.max);
    expect(r.length).toBe(1230);
    expect(r.difficulty).toBe(0.67);
    const open = sanitizeRecipe({ ...defaultRecipe(), closed: false, laps: 5 });
    expect(open.laps).toBe(1);
    expect(sanitizeRecipe({ ...defaultRecipe(), gates: { square: 0.42 } }).gates).toEqual({ square: 0.4 });
    expect(sanitizeRecipe({ ...defaultRecipe(), objects: { tree: 0.01 } }).objects).toEqual({});
  });

  it('falls back to the default weights only when a weight map is missing', () => {
    const d = defaultRecipe();
    const { gates: _g, features: _f, objects: _o, ...rest } = d;
    const r = sanitizeRecipe(rest);
    expect(r.gates).toEqual(d.gates);
    expect(r.features).toEqual(d.features);
    expect(r.objects).toEqual(d.objects);
    expect(sanitizeRecipe({ ...d, features: {} }).features).toEqual({});
  });
});

describe('recipeKey', () => {
  it('ignores key order and unsanitised noise, and changes with every real change', () => {
    const r = randomRecipe(5);
    const shuffled = JSON.parse(JSON.stringify(Object.fromEntries(Object.entries(r).reverse()))) as TrackRecipe;
    expect(recipeKey(shuffled)).toBe(recipeKey(r));
    expect(recipeKey({ ...r, difficulty: r.difficulty + 0.001 })).toBe(recipeKey(r));
    expect(recipeKey({ ...r, seed: r.seed + 1 })).not.toBe(recipeKey(r));
    expect(recipeKey({ ...r, closed: !r.closed })).not.toBe(recipeKey(r));
    expect(recipeKey({ ...r, objects: { ...r.objects, bridge: 1 } })).not.toBe(recipeKey(r));
  });

  it('round-trips through JSON: the key parses back to the same recipe', () => {
    for (let s = 0; s < 20; s++) {
      const r = randomRecipe(s);
      const back = sanitizeRecipe(JSON.parse(recipeKey(r)));
      expect(back).toEqual(r);
      expect(recipeKey(back)).toBe(recipeKey(r));
    }
  });

  it('is plain canonical JSON: sorted keys, no spaces', () => {
    const k = recipeKey(defaultRecipe());
    expect(k.startsWith('{"closed":true,"difficulty":0.5,')).toBe(true);
    expect(k).not.toContain(' ');
  });
});

describe('randomRecipe', () => {
  it('is a pure function of the seed, carries the seed, and is already sanitised', () => {
    for (let s = 0; s < 50; s++) {
      const r = randomRecipe(s);
      expect(randomRecipe(s)).toEqual(r);
      expect(r.seed).toBe(s);
      expect(sanitizeRecipe(r)).toEqual(r);
      expectSane(r);
    }
  });

  it('varies: open and closed courses, several features, different keys', () => {
    const list = Array.from({ length: 50 }, (_, s) => randomRecipe(s + 1000));
    expect(new Set(list.map(recipeKey)).size).toBe(50);
    expect(list.some((r) => r.closed) && list.some((r) => !r.closed)).toBe(true);
    for (const r of list) expect(Object.keys(r.features).length).toBeGreaterThanOrEqual(2);
  });
});

describe('specForRecipe and trackSpec', () => {
  it('spans the recipe length and follows its shape', () => {
    for (let s = 0; s < 30; s++) {
      const r = randomRecipe(s);
      const spec = specForRecipe(r);
      expect(spec.style).toBe('custom');
      expect(spec.closed).toBe(r.closed);
      expect(spec.defaultGates).toBe(r.gateCount);
      expect(spec.minLength).toBeLessThan(r.length);
      expect(spec.maxLength).toBeGreaterThan(r.length);
      expect(spec.defaultLaps).toBe(r.closed ? r.laps : 1);
      expect(spec.features).toBe(true);
    }
  });

  it('a custom track is checked against its recipe, a styled one against its style', () => {
    const r = { ...defaultRecipe(), closed: false };
    expect(trackSpec({ style: 'custom', recipe: r }).closed).toBe(false);
    expect(trackSpec({ style: 'race' })).toBe(STYLE_SPECS.race);
  });
});

describe('custom tracks from recipes', () => {
  let sampler: TerrainSampler;
  const tracks: { recipe: TrackRecipe; track: TrackData }[] = [];

  beforeAll(() => {
    sampler = makeTestSampler({ seed: 3 });
    for (let s = 1; s <= 50; s++) {
      const recipe = randomRecipe(s);
      tracks.push({ recipe, track: generateTrack({ seed: 0, style: 'custom', recipe }, sampler) });
    }
  }, SLOW);

  it('50 random recipes all build valid tracks of style custom that carry their recipe', () => {
    for (const { recipe, track } of tracks) {
      expect(validateTrack(track, sampler).errors, `recipe ${recipe.seed}`).toEqual([]);
      expect(track.style).toBe('custom');
      expect(track.recipe).toEqual(recipe);
      expect(track.seed).toBe(recipe.seed);
      expect(track.closed).toBe(recipe.closed);
      expect(track.laps).toBe(recipe.closed ? recipe.laps : 1);
      expect(track.gates[0].kind).toBe('start');
    }
  });

  it('keep the recipe gate count on most recipes and fly the features it weights', () => {
    const full = tracks.filter(({ recipe, track }) => track.gates.length === recipe.gateCount).length;
    expect(full).toBeGreaterThanOrEqual(45);
    for (const { recipe, track } of tracks) {
      for (const g of track.gates) if (g.feature && !['tunnel', 'drop', 'dive', 'window', 'hurdle', 'ladder'].includes(g.feature)) expect(recipe.features[g.feature], `${recipe.seed} ${g.feature}`).toBeGreaterThan(0);
    }
    expect(tracks.filter(({ track }) => track.gates.some((g) => g.feature)).length).toBeGreaterThanOrEqual(45);
  });

  it('are deterministic per (recipe, terrain); the params seed, gate count, laps and difficulty do not matter', () => {
    const recipe = randomRecipe(7);
    const a = generateTrack({ seed: 0, style: 'custom', recipe }, sampler);
    const b = generateTrack({ seed: 99, style: 'custom', recipe, gateCount: 4, laps: 9, difficulty: 1 }, makeTestSampler({ seed: 3 }));
    expect(JSON.stringify(b)).toBe(JSON.stringify(a));
    const other = generateTrack({ seed: 0, style: 'custom', recipe: { ...recipe, seed: recipe.seed + 1 } }, sampler);
    expect(JSON.stringify(other)).not.toBe(JSON.stringify(a));
  });

  it('sanitises the recipe it is given, and builds the default recipe when there is none', () => {
    const t = generateTrack({ seed: 0, style: 'custom', recipe: { ...defaultRecipe(), difficulty: 0.501, gates: { square: 1, bogus: 3 } as TrackRecipe['gates'] } }, sampler);
    expect(t.recipe?.difficulty).toBe(0.5);
    expect(t.recipe?.gates).toEqual({ square: 1 });
    const d = generateTrack({ seed: 0, style: 'custom' }, sampler);
    expect(d.recipe).toEqual(defaultRecipe());
    expect(validateTrack(d, sampler).ok).toBe(true);
  });

  it('scatter the recipe objects, and none at obstacle density 0 (hairpin pylons aside)', () => {
    const recipe = { ...randomRecipe(3), objects: { container: 1, pillar: 0.5 } };
    const t = generateTrack({ seed: 0, style: 'custom', recipe }, sampler);
    expect(t.obstacles.some((o) => o.kind === 'container' || o.kind === 'pillar')).toBe(true);
    expect(t.obstacles.some((o) => o.kind === 'tree' || o.kind === 'rock')).toBe(false);
    const bare = generateTrack({ seed: 0, style: 'custom', recipe: { ...recipe, obstacles: 0 } }, sampler);
    // Only the hairpins' pylons (a pillar, since the recipe has pillars) are left: they belong to the manoeuvre, not the scenery.
    expect(bare.obstacles.some((o) => o.kind === 'container')).toBe(false);
    const hairpins = featureZones(bare).zones.filter((z) => z.feature === 'hairpin').length;
    expect(bare.obstacles.filter((o) => o.kind === 'pillar').length).toBeLessThanOrEqual(hairpins);
  });

  it('scatter trees and rocks when every object weight is zero; density 0 leaves only the pad cones, start and finish flagpoles and pylons', () => {
    for (let s = 1; s <= 4; s++) {
      const recipe = { ...randomRecipe(s), objects: {} };
      const t = generateTrack({ seed: 0, style: 'custom', recipe }, sampler);
      expect(t.obstacles.some((o) => o.kind === 'tree'), `recipe ${s}`).toBe(true);
      expect(t.obstacles.some((o) => o.kind === 'rock'), `recipe ${s}`).toBe(true);
      const bare = generateTrack({ seed: 0, style: 'custom', recipe: { ...recipe, obstacles: 0 } }, sampler);
      expect(validateTrack(bare, sampler).errors).toEqual([]);
      const hairpins = featureZones(bare).zones.filter((z) => z.feature === 'hairpin').length;
      expect(bare.obstacles.some((o) => o.kind === 'pole' || o.kind === 'tree' || o.kind === 'rock'), `recipe ${s}`).toBe(false);
      expect(bare.obstacles.filter((o) => o.kind === 'cone').length, `recipe ${s}`).toBeLessThanOrEqual(4);
      expect(bare.obstacles.filter((o) => o.kind === 'flagpole').length, `recipe ${s}`).toBeLessThanOrEqual(4 + hairpins);
    }
  }, SLOW);
});

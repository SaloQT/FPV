import { describe, expect, it } from 'vitest';
import { TRACK_FEATURES, type TrackData, type Vec3 } from '../contracts';
import { GateTimer, createRaceSnapshot } from '../game/gateTimer';
import { makeTrack } from '../game/testKit';
import { RECIPE_GATE_KINDS, RECIPE_LIMITS, RECIPE_OBJECT_KINDS, defaultRecipe, randomRecipe, recipeKey, sanitizeRecipe } from '../world/track/recipe';
import {
  COURSE_KEYS, GATE_WEIGHT_KINDS, MAX_SAVED, OBJECT_WEIGHT_KINDS, ORBIT_MAX_ELEVATION, ORBIT_MAX_M, ORBIT_MIN_M, SavedTracksStore, TRACKS_KEY,
  benchRows, benchTimeLimit, boardName, buildProfile, describeFeatures, featureSummary, fitOrbit, flyThroughPose, nearestPathPoint, orbitDrag,
  orbitEye, orbitMove, orbitPan, orbitZoom, parseTrackFile, pathArcLengths, pointAt, recipeSlider, sanitizeSavedTracks, sanitizeTrackData,
  sliderEnabled, topOrbit, trackFileJson, trackFileName, uniqueTrackName, weightKinds, weightLabel, weightOf, weightShares, withClosed, withSeed,
  WEIGHT_MAX, WEIGHT_MIN, WEIGHT_STEP, gatesCleared, withValue, withWeight, type OrbitCam, type SavedTrack, type TrackStorage,
} from './builderModel';

/** A closed square loop of side `side` at height `y`, sampled every metre. */
function loopTrack(side = 40, y = 5): TrackData {
  const path: Vec3[] = [];
  const corners: Vec3[] = [[0, y, 0], [side, y, 0], [side, y, -side], [0, y, -side]];
  for (let c = 0; c < 4; c++) {
    const a = corners[c], b = corners[(c + 1) % 4];
    for (let i = 0; i < side; i++) path.push([a[0] + ((b[0] - a[0]) * i) / side, y, a[2] + ((b[2] - a[2]) * i) / side]);
  }
  const t = makeTrack(4, { path, closed: true, laps: 2, length: side * 4 });
  t.gates = corners.map((p, i) => ({ index: i, kind: 'square', pos: [p[0], y, p[2]], yaw: 0, roll: 0, pitch: 0, width: 3, height: 2 }));
  return t;
}

function memory(): TrackStorage & { data: Map<string, string> } {
  const data = new Map<string, string>();
  return { data, getItem: (k) => data.get(k) ?? null, setItem: (k, v) => void data.set(k, v) };
}

describe('recipe sliders', () => {
  it('take their ranges from the generator limits', () => {
    for (const key of [...COURSE_KEYS, 'featureShare', 'obstacles'] as const) {
      const s = recipeSlider(key);
      expect(s.min, key).toBe(RECIPE_LIMITS[key].min);
      expect(s.max, key).toBe(RECIPE_LIMITS[key].max);
      expect(s.step, key).toBe(RECIPE_LIMITS[key].step);
      expect(s.format(s.min).length, key).toBeGreaterThan(0);
    }
  });

  it('write sanitised recipes and keep everything else', () => {
    const r = defaultRecipe();
    const more = withValue(r, 'gateCount', RECIPE_LIMITS.gateCount.max + 50);
    expect(more.gateCount).toBe(RECIPE_LIMITS.gateCount.max);
    expect(more.seed).toBe(r.seed);
    expect(withValue(r, 'difficulty', 0.8).difficulty).toBeCloseTo(0.8, 6);
    expect(withSeed(r, 1234).seed).toBe(1234);
    expect(r.gateCount).toBe(defaultRecipe().gateCount);
  });

  it('turn laps off for a point-to-point run', () => {
    const r = withValue(withClosed(defaultRecipe(), true), 'laps', 3);
    expect(sliderEnabled(r, 'laps')).toBe(true);
    const open = withClosed(r, false);
    expect(open.closed).toBe(false);
    expect(open.laps).toBe(1);
    expect(sliderEnabled(open, 'laps')).toBe(false);
    expect(sliderEnabled(open, 'gateCount')).toBe(true);
  });
});

describe('weights', () => {
  it('cover every manoeuvre, the plain gate kinds and every obstacle kind, with labels', () => {
    expect(weightKinds('features')).toEqual(TRACK_FEATURES);
    expect(GATE_WEIGHT_KINDS).not.toContain('start');
    expect(GATE_WEIGHT_KINDS).not.toContain('finish');
    expect(OBJECT_WEIGHT_KINDS).toHaveLength(12);
    for (const g of ['gates', 'features', 'objects'] as const) for (const k of weightKinds(g)) expect(weightLabel(g, k), `${g}.${k}`).toBeTruthy();
  });

  it('set, clear and share out', () => {
    let r = sanitizeRecipe({ ...defaultRecipe(), features: {} });
    r = withWeight(r, 'features', 'split-s', 0.6);
    r = withWeight(r, 'features', 'ladder', 0.2);
    expect(weightOf(r, 'features', 'split-s')).toBeCloseTo(0.6, 6);
    const shares = weightShares(r, 'features');
    expect(shares['split-s']).toBeCloseTo(0.75, 6);
    expect(shares.ladder).toBeCloseTo(0.25, 6);
    expect(shares.drop).toBe(0);
    r = withWeight(r, 'features', 'split-s', 0);
    expect(weightOf(r, 'features', 'split-s')).toBe(0);
    expect(weightShares(r, 'features').ladder).toBeCloseTo(1, 6);
  });

  it('round-trip through the recipe key', () => {
    const r = withWeight(withWeight(defaultRecipe(), 'objects', 'container', 0.5), 'gates', 'window', 0.35);
    const back = sanitizeRecipe(JSON.parse(recipeKey(r)));
    expect(recipeKey(back)).toBe(recipeKey(r));
    expect(weightOf(back, 'objects', 'container')).toBeCloseTo(0.5, 3);
  });
});

describe('track files', () => {
  const track = loopTrack();

  it('export and import a track with its terrain and recipe', () => {
    const recipe = randomRecipe(77);
    const custom: TrackData = { ...track, style: 'custom', recipe };
    const json = trackFileJson({ terrainSeed: 4242, quality: 'medium', track: custom, recipe });
    const r = parseTrackFile(json);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.terrainSeed).toBe(4242);
    expect(r.value.quality).toBe('medium');
    expect(r.value.track?.gates).toHaveLength(4);
    expect(recipeKey(r.value.recipe ?? defaultRecipe())).toBe(recipeKey(recipe));
  });

  it('reads a bare TrackData and a bare recipe', () => {
    const bare = parseTrackFile(JSON.stringify(track));
    expect(bare.ok && bare.value.track?.closed).toBe(true);
    expect(bare.ok && bare.value.terrainSeed).toBeUndefined();
    const recipe = parseTrackFile(JSON.stringify(defaultRecipe()));
    expect(recipe.ok && recipe.value.track).toBeUndefined();
    expect(recipe.ok && recipe.value.recipe?.version).toBe(1);
  });

  it('refuses what is not a track, and says why', () => {
    for (const text of ['not json', '[]', '{}', JSON.stringify({ track: { ...track, gates: [{ kind: 'square' }, ...track.gates] } }), JSON.stringify({ ...track, start: null })]) {
      const r = parseTrackFile(text);
      expect(r.ok, text.slice(0, 40)).toBe(false);
      if (!r.ok) expect(r.error.length).toBeGreaterThan(0);
    }
  });

  it('sanitises a track: drops broken obstacles, renumbers gates, keeps tags, recomputes the length', () => {
    const raw = {
      ...track,
      gates: track.gates.map((g, i) => ({ ...g, index: 9 - i, feature: i === 1 ? 'split-s' : 'bogus', depth: i === 2 ? 6 : -1 })),
      obstacles: [{ kind: 'container', pos: [1, 0, 1], yaw: 0, size: [6.1, 2.6, 2.44] }, { kind: 'ufo', pos: [0, 0, 0], yaw: 0, size: [1, 1, 1] }],
      length: 1,
      laps: 99,
    };
    const t = sanitizeTrackData(raw);
    expect(t).not.toBeNull();
    if (t === null) return;
    expect(t.gates.map((g) => g.index)).toEqual([0, 1, 2, 3]);
    expect(t.gates[1].feature).toBe('split-s');
    expect(t.gates[0].feature).toBeUndefined();
    expect(t.gates[2].depth).toBe(6);
    expect(t.gates[0].depth).toBeUndefined();
    expect(t.obstacles).toHaveLength(1);
    expect(t.length).toBeCloseTo(160, 6);
    expect(t.laps).toBe(10);
  });

  it('gives a custom track without a recipe a style the validator knows', () => {
    expect(sanitizeTrackData({ ...track, style: 'custom' })?.style).toBe('race');
    expect(sanitizeTrackData({ ...track, closed: false, style: 'custom' })?.style).toBe('freestyle');
    expect(sanitizeTrackData({ ...track, style: 'technical' })?.style).toBe('technical');
  });

  it('names files safely', () => {
    expect(trackFileName('My Track! #1')).toBe('my-track-1.track.json');
    expect(trackFileName('***')).toBe('track.track.json');
  });
});

describe('saved tracks', () => {
  const saved = (name: string, savedAt: number): SavedTrack => ({ name, terrainSeed: 7, quality: 'high', recipe: defaultRecipe(), savedAt });

  it('save, replace by name (any case), remove, and load back', () => {
    const storage = memory();
    const store = new SavedTracksStore(storage);
    let changes = 0;
    store.subscribe(() => changes++);
    expect(store.save(saved('Alpha', 1))).toBe(true);
    expect(store.save(saved('Beta', 2))).toBe(true);
    expect(store.save({ ...saved('alpha', 3), terrainSeed: 9 })).toBe(true);
    expect(store.list().map((t) => t.name)).toEqual(['alpha', 'Beta']);
    expect(store.find('ALPHA')?.terrainSeed).toBe(9);
    store.remove('beta');
    expect(new SavedTracksStore(storage).list().map((t) => t.name)).toEqual(['alpha']);
    expect(storage.data.has(TRACKS_KEY)).toBe(true);
    expect(changes).toBe(4);
  });

  it('keeps tracks from files with their TrackData', () => {
    const store = new SavedTracksStore(memory());
    expect(store.save({ name: 'File', terrainSeed: 1, quality: 'low', track: loopTrack(), savedAt: 1 })).toBe(true);
    expect(store.find('file')?.track?.gates).toHaveLength(4);
  });

  it('sanitise untrusted JSON: newest first, unique names, capped', () => {
    const many = Array.from({ length: MAX_SAVED + 10 }, (_, i) => saved(`T${i}`, i));
    const out = sanitizeSavedTracks({ version: 1, tracks: [...many, saved('t3', 1e9), { name: 'x' }, null] });
    expect(out).toHaveLength(MAX_SAVED);
    expect(out[0].name).toBe('t3');
    expect(out.filter((t) => t.name.toLowerCase() === 't3')).toHaveLength(1);
    expect(sanitizeSavedTracks({ version: 2, tracks: many })).toEqual([]);
  });

  it('report a refused write and keep the track for the visit', () => {
    const store = new SavedTracksStore({ getItem: () => null, setItem: () => { throw new Error('full'); } });
    expect(store.save(saved('A', 1))).toBe(false);
    expect(store.list()).toHaveLength(1);
  });

  it('pick a free name', () => {
    const list = [saved('Track', 1), saved('Track (2)', 2)];
    expect(uniqueTrackName('Track', list)).toBe('Track (3)');
    expect(uniqueTrackName('  New   one ', list)).toBe('New one');
    expect(uniqueTrackName('', [])).toBe('Track');
  });
});

describe('builder camera', () => {
  it('frames the whole course', () => {
    const t = loopTrack(200);
    const o = fitOrbit(t, 16 / 9);
    expect(o.target[0]).toBeCloseTo(100, 6);
    expect(o.target[2]).toBeCloseTo(-100, 6);
    const eye = orbitEye(o, [0, 0, 0]);
    const d = Math.hypot(eye[0] - o.target[0], eye[1] - o.target[1], eye[2] - o.target[2]);
    expect(d).toBeCloseTo(o.distance, 6);
    expect(o.distance).toBeGreaterThan(141);
    expect(topOrbit(t).elevation).toBe(ORBIT_MAX_ELEVATION);
  });

  it('puts azimuth 0 south of the target, like the free camera', () => {
    const o: OrbitCam = { target: [0, 0, 0], azimuth: 0, elevation: 0, distance: 10 };
    const eye = orbitEye(o, [0, 0, 0]);
    expect(eye[2]).toBeCloseTo(10, 9);
    expect(eye[0]).toBeCloseTo(0, 9);
  });

  it('clamps drag and zoom', () => {
    const o: OrbitCam = { target: [0, 0, 0], azimuth: 0, elevation: 0.5, distance: 100 };
    orbitDrag(o, 0, 1e6);
    expect(o.elevation).toBe(ORBIT_MAX_ELEVATION);
    orbitZoom(o, 1e6);
    expect(o.distance).toBe(ORBIT_MAX_M);
    orbitZoom(o, -1e7);
    expect(o.distance).toBe(ORBIT_MIN_M);
  });

  it('pans with the picture and flies along the view heading', () => {
    const o: OrbitCam = { target: [0, 0, 0], azimuth: 0, elevation: 0.9, distance: 100 };
    orbitPan(o, 100, 0, 800);
    expect(o.target[0]).toBeLessThan(0); // dragging the picture right moves the view left (west)
    expect(Math.abs(o.target[2])).toBeLessThan(1e-9);
    const f: OrbitCam = { target: [0, 0, 0], azimuth: 0, elevation: 0.5, distance: 50 };
    orbitMove(f, 10, 0, 2);
    expect(f.target[2]).toBeCloseTo(-10, 9); // looking north from the south: forward is -Z
    expect(f.target[1]).toBe(2);
    orbitMove(f, 0, 5, 0);
    expect(f.target[0]).toBeCloseTo(5, 9); // right is east
  });

  it('walks the line for the fly-through, wrapping a circuit', () => {
    const t = loopTrack(40);
    const arc = pathArcLengths(t.path, true);
    expect(arc[t.path.length]).toBeCloseTo(160, 6);
    expect(pointAt(t.path, arc, true, 10, [0, 0, 0])[0]).toBeCloseTo(10, 6);
    expect(pointAt(t.path, arc, true, 170, [0, 0, 0])[0]).toBeCloseTo(10, 6);
    expect(pointAt(t.path, arc, false, -5, [0, 0, 0])[0]).toBeCloseTo(0, 6);
    const eye: Vec3 = [0, 0, 0], look: Vec3 = [0, 0, 0];
    flyThroughPose(t.path, arc, true, 20, eye, look);
    expect(eye[0]).toBeCloseTo(14, 6);
    expect(eye[1]).toBeGreaterThan(5);
    expect(look[0]).toBeGreaterThan(0);
  });
});

describe('elevation profile', () => {
  it('puts every gate on the line at its distance and labels manoeuvre runs once', () => {
    const t = loopTrack(40, 10);
    t.gates[1] = { ...t.gates[1], feature: 'split-s', pos: [40, 10, 0] };
    t.gates[2] = { ...t.gates[2], feature: 'split-s' };
    const m = buildProfile(t, () => 2, 100);
    expect(m.length).toBeCloseTo(160, 6);
    expect(m.gates.map((g) => Math.round(g.s))).toEqual([0, 40, 80, 120]);
    expect(m.features).toEqual([{ feature: 'split-s', s0: 40, s1: 80, label: 'Split-S' }]);
    expect(m.yMin).toBeLessThanOrEqual(2);
    expect(m.yMax).toBeGreaterThanOrEqual(11);
    expect(m.line.length).toBe(200);
    expect(m.ground[1]).toBe(2);
  });

  it('finds the nearest path point', () => {
    const t = loopTrack(40);
    expect(nearestPathPoint(t.path, [40.2, 5, -0.1])).toBe(40);
  });
});

describe('summaries', () => {
  it('count manoeuvres as runs of tagged gates', () => {
    const t = makeTrack(7);
    const tags = [undefined, 'split-s', 'split-s', 'hurdle', undefined, 'hurdle', 'split-s'] as const;
    t.gates.forEach((g, i) => { if (tags[i] !== undefined) g.feature = tags[i]; });
    expect(featureSummary(t)).toEqual([{ feature: 'split-s', count: 2 }, { feature: 'hurdle', count: 2 }]);
    expect(describeFeatures(t)).toBe('2 Split-S, 2 Hurdles');
    expect(describeFeatures(makeTrack(3))).toBe('No manoeuvres');
  });

  it('name boards after the saved name, the recipe or the style', () => {
    expect(boardName(makeTrack(3, { seed: 5 }), 1337)).toBe('Race track 5 on terrain 1337');
    expect(boardName(makeTrack(3, { style: 'custom', recipe: { ...defaultRecipe(), seed: 99 } }), 7)).toBe('Custom track 99 on terrain 7');
    expect(boardName(makeTrack(3), 1, 'Canyon run')).toBe('Canyon run');
  });

  it('give the benchmark a sane time limit and order its table', () => {
    expect(benchTimeLimit(30, 3)).toBe(360);
    expect(benchTimeLimit(Number.NaN, 1)).toBe(240);
    expect(benchTimeLimit(1, 1)).toBe(60);
    expect(benchTimeLimit(500, 3)).toBe(400);
    const rows = benchRows([
      { name: 'slow', finish: 80, gates: 12, gateTotal: 12, crashes: 1, running: false },
      { name: 'dnf', finish: Number.NaN, gates: 5, gateTotal: 12, crashes: 4, running: false },
      { name: 'fast', finish: 60.5, gates: 12, gateTotal: 12, crashes: 0, running: false },
      { name: 'live', finish: Number.NaN, gates: 7, gateTotal: 12, crashes: 0, running: true },
    ]);
    expect(rows.map((r) => r.name)).toEqual(['fast', 'slow', 'live', 'dnf']);
    expect(rows[0].result).toBe('60.50 s');
    expect(rows[2].result).toBe('flying...');
    expect(rows[3].result).toBe('did not finish');
    expect(rows[3].gates).toBe('5/12');
  });

  /** Flies through the gates of `t` in `seq` order with a GateTimer, returning gatesCleared after every crossing. */
  function cleared(t: TrackData, seq: readonly number[]): number[] {
    const timer = new GateTimer(t);
    const snap = createRaceSnapshot();
    let time = 5;
    const out: number[] = [];
    for (const i of seq) {
      const g = t.gates[i];
      timer.check([g.pos[0], g.pos[1], g.pos[2] + 0.5], [g.pos[0], g.pos[1], g.pos[2] - 0.5], time, time + 0.1);
      time += 2;
      out.push(gatesCleared(timer.fill(snap, time), t.closed));
    }
    return out;
  }

  it('counts gates cleared up to gateCount * laps on a circuit (the start line is not a gate)', () => {
    const t = makeTrack(4, { closed: true, laps: 2 });
    const seq = [0, 1, 2, 3, 0, 1, 2, 3, 0];
    expect(cleared(t, seq)).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8]);
  });

  it('counts every gate of a point-to-point run', () => {
    const t = makeTrack(5, { closed: false, laps: 1 });
    expect(cleared(t, [0, 1, 2, 3, 4])).toEqual([1, 2, 3, 4, 5]);
    expect(gatesCleared(createRaceSnapshot(), false)).toBe(0);
  });
});

describe('circuit switch', () => {
  it('gives a circuit back the laps it had before point to point', () => {
    const r = withValue(withClosed(defaultRecipe(), true), 'laps', 3);
    const open = withClosed(r, false);
    expect(open.laps).toBe(1);
    expect(withClosed(open, true, r.laps).laps).toBe(3);
    expect(withClosed(open, true).laps).toBeGreaterThanOrEqual(1);
    expect(withClosed(r, true)).toBe(r);
  });

  it('takes the weight sliders and kinds from the recipe limits', () => {
    expect([WEIGHT_MIN, WEIGHT_MAX, WEIGHT_STEP]).toEqual([RECIPE_LIMITS.weight.min, RECIPE_LIMITS.weight.max, RECIPE_LIMITS.weight.step]);
    expect(GATE_WEIGHT_KINDS).toBe(RECIPE_GATE_KINDS);
    expect(OBJECT_WEIGHT_KINDS).toBe(RECIPE_OBJECT_KINDS);
  });
});

describe('SavedTracksStore with two tabs', () => {
  const saved = (name: string): SavedTrack => ({ name, terrainSeed: 1, quality: 'high', savedAt: 1, recipe: defaultRecipe() });

  it('re-reads the library before a change, so neither tab erases the other', () => {
    const storage = memory();
    const a = new SavedTracksStore(storage);
    const b = new SavedTracksStore(storage);
    a.save(saved('alpha'));
    b.save(saved('beta'));
    expect(new SavedTracksStore(storage).list().map((t) => t.name).sort()).toEqual(['alpha', 'beta']);
    a.remove('beta');
    expect(new SavedTracksStore(storage).list().map((t) => t.name)).toEqual(['alpha']);
  });

  it('keeps working in memory once storage refuses a write', () => {
    let full = false;
    const data = new Map<string, string>();
    const storage: TrackStorage = { getItem: (k) => data.get(k) ?? null, setItem: (k, v) => { if (full) throw new Error('full'); data.set(k, v); } };
    const s = new SavedTracksStore(storage);
    s.save(saved('alpha'));
    full = true;
    expect(s.save(saved('beta'))).toBe(false);
    expect(s.save(saved('gamma'))).toBe(false);
    expect(s.list().map((t) => t.name)).toEqual(['gamma', 'beta', 'alpha']);
  });
});

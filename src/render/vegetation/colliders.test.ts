import { describe, expect, it } from 'vitest';
import type { Vec3 } from '../../contracts';
import type { RTPrimitive } from '../contracts';
import { isCanopyProxy } from '../rt/canopy';
import { MAX_COLLIDERS, MIN_BOULDER_RADIUS, MIN_SHADOW_ROCK_RADIUS, ROCK_COLLIDER_RANGE, RT_FOLIAGE, RT_PRIM_CAP, RT_PRIM_CAP_EXTREME, RT_PRIM_MARGIN, TREE_COLLIDER_RANGE, TRUNK_HALF_MAX, TRUNK_HALF_MIN, RT_CAMERA_WITHIN, buildColliders, buildRtProxies, cameraShare, forestRtCap, proxyKey, stemBoxes } from './colliders';
import { MAX_PRIMS } from '../rt/bvh';
import type { InstanceSet, VegPlacement } from './placement';
import { RT_WOOD, plantWoodShadows, woodShadowFit } from './plantShadows';
import { rockAssets } from './rockGen';
import { pathDistance, testScene } from './testScene';
import { VARIANTS_OF, VARIANT_DEFS, layoutCrown, variantPlan } from './variants';

function emptySet(): InstanceSet {
  return { count: 0, pos: new Float32Array(0), scale: new Float32Array(0), yaw: new Float32Array(0), variant: new Uint8Array(0), tint: new Uint32Array(0), nrm: new Uint32Array(0), pathDist: new Float32Array(0) };
}

/** A one-instance copy of instance `i` of a set. */
function single(s: InstanceSet, i: number): InstanceSet {
  return { count: 1, pos: s.pos.slice(i * 3, i * 3 + 3), scale: s.scale.slice(i, i + 1), yaw: s.yaw.slice(i, i + 1), variant: s.variant.slice(i, i + 1), tint: s.tint.slice(i, i + 1), nrm: s.nrm.slice(i, i + 1), pathDist: s.pathDist.slice(i, i + 1) };
}
const placementOf = (s: InstanceSet, i: number): { pos: Vec3; yaw: number; scale: number } => ({ pos: [s.pos[i * 3], s.pos[i * 3 + 1], s.pos[i * 3 + 2]], yaw: s.yaw[i], scale: s.scale[i] });

const treesOnly =(p: VegPlacement): VegPlacement => ({ ...p, rocks: emptySet() });
const rocksOnly = (p: VegPlacement): VegPlacement => ({ ...p, plants: emptySet() });

function isTree(p: VegPlacement, i: number): boolean {
  return VARIANT_DEFS[p.plants.variant[i]].group === 'tree';
}

describe('buildColliders', () => {
  const { high, track } = testScene();
  const all = buildColliders(high);

  it('stays under the 2500 budget and is not empty', () => {
    expect(MAX_COLLIDERS).toBeLessThan(2500);
    expect(all.length).toBeGreaterThan(100);
    expect(all.length).toBeLessThan(2500);
  });

  it('boxes exactly the trees within 60 m of the path and the boulders within 40 m', () => {
    let trees = 0, trunkBoxes = 0, boulders = 0;
    for (let i = 0; i < high.plants.count; i++) if (isTree(high, i) && high.plants.pathDist[i] <= TREE_COLLIDER_RANGE) { trees++; trunkBoxes += stemBoxes(high.plants.variant[i]).length; }
    for (let i = 0; i < high.rocks.count; i++) if (high.rocks.scale[i] >= MIN_BOULDER_RADIUS && high.rocks.pathDist[i] <= ROCK_COLLIDER_RANGE) boulders++;
    expect(trees).toBeGreaterThan(50);
    expect(boulders).toBeGreaterThan(10);
    expect(buildColliders(treesOnly(high)).length).toBe(trunkBoxes);
    expect(buildColliders(rocksOnly(high)).length).toBe(boulders);
    expect(all.length).toBe(trunkBoxes + boulders);
    // Most trunks are straight enough for one box; leaning, crooked and multi-stemmed ones get a few.
    expect(trunkBoxes).toBeLessThan(2 * trees);
  });

  it('stacks each tree\'s square boxes from the ground to the top of its trunk column, yawed like the tree', () => {
    for (let i = 0; i < high.plants.count; i++) {
      if (!isTree(high, i) || !(high.plants.pathDist[i] <= TREE_COLLIDER_RANGE)) continue;
      const boxes = buildColliders({ ...high, plants: single(high.plants, i), rocks: emptySet() }), s = high.plants.scale[i], y = high.plants.pos[i * 3 + 1];
      const fit = stemBoxes(high.plants.variant[i]);
      expect(boxes.length).toBe(fit.length);
      boxes.forEach((b, k) => {
        expect(b.kind).toBe('box');
        expect(b.half[0]).toBe(b.half[2]);
        expect(b.half[0]).toBeGreaterThanOrEqual(TRUNK_HALF_MIN);
        expect(b.half[0]).toBeLessThanOrEqual(TRUNK_HALF_MAX + fit[k].spread * s + 1e-6);
        expect(b.center[1] - b.half[1]).toBeCloseTo(y + fit[k].y0 * s, 4);
        expect(b.yaw).toBe(high.plants.yaw[i]);
      });
      // The lowest box of every stem stands on the ground and reaches well up the trunk.
      expect(boxes.filter((b) => Math.abs(b.center[1] - b.half[1] - y) < 1e-3).length).toBeGreaterThan(0);
      expect(Math.max(...boxes.map((b) => b.center[1] + b.half[1])) - y).toBeGreaterThan(3 * s);
    }
  });

  it('keeps the drawn trunk inside its boxes: every stem centreline point from the ground to the box top lies within a box', () => {
    for (let v = 0; v < VARIANT_DEFS.length; v++) {
      if (VARIANT_DEFS[v].group !== 'tree') continue;
      const plan = variantPlan(v)!, s = 1.2, yaw = 0.7, pos: Vec3 = [10, 5, -3];
      const one = emptySet();
      Object.assign(one, { count: 1, pos: Float32Array.from(pos), scale: Float32Array.of(s), yaw: Float32Array.of(yaw), variant: Uint8Array.of(v), pathDist: Float32Array.of(0) });
      const boxes = buildColliders({ plants: one, rocks: emptySet(), trees: 1, bushes: 0, obstacleTrees: 0, plantRing: new Float32Array(0) });
      const top = Math.max(...boxes.map((b) => b.center[1] + b.half[1]));
      const c = Math.cos(yaw), sn = Math.sin(yaw);
      for (const stem of plan.limbs.filter((l) => l.order === 0)) for (const p of stem.pts) {
        if (p[1] < 0 || p[1] * s + pos[1] > top) continue;
        const w: Vec3 = [pos[0] + (c * p[0] + sn * p[2]) * s, pos[1] + p[1] * s, pos[2] + (-sn * p[0] + c * p[2]) * s];
        const inside = boxes.some((b) => Math.abs(w[0] - b.center[0]) <= b.half[0] + 1e-3 && Math.abs(w[2] - b.center[2]) <= b.half[2] + 1e-3 && Math.abs(w[1] - b.center[1]) <= b.half[1] + 1e-3);
        expect(inside, `${VARIANT_DEFS[v].name}: stem point at ${p[1].toFixed(2)} m`).toBe(true);
      }
    }
  });

  it('keeps the racing line clear: no trunk box, leaning ones included, reaches within 4 m of it', () => {
    for (const b of buildColliders(treesOnly(high))) expect(pathDistance(track.path, b.center[0], b.center[2]) - Math.SQRT2 * b.half[0]).toBeGreaterThan(4);
  });

  it('keeps every trunk box inside the corridor around the racing line', () => {
    for (const b of buildColliders(treesOnly(high))) expect(pathDistance(track.path, b.center[0], b.center[2])).toBeLessThan(TREE_COLLIDER_RANGE + 2);
    for (const b of buildColliders(rocksOnly(high))) expect(pathDistance(track.path, b.center[0], b.center[2])).toBeLessThan(ROCK_COLLIDER_RANGE + 2);
  });

  it('boxes boulders from the ground up over 0.7 of their radius on each side, skipping pebbles', () => {
    const boxes = buildColliders(rocksOnly(high));
    const radii = new Map<string, number>();
    for (let i = 0; i < high.rocks.count; i++) radii.set(`${high.rocks.pos[i * 3]},${high.rocks.pos[i * 3 + 2]}`, high.rocks.scale[i]);
    for (const b of boxes) {
      const s = radii.get(`${b.center[0]},${b.center[2]}`) as number;
      expect(s).toBeGreaterThanOrEqual(MIN_BOULDER_RADIUS);
      expect(b.half[0]).toBeCloseTo(0.7 * s, 5);
      expect(b.half[2]).toBeCloseTo(0.7 * s, 5);
      expect(b.half[1]).toBeGreaterThan(0.15 * s);
      expect(b.half[1]).toBeLessThan(1.1 * s);
    }
  });

  it('is deterministic', () => {
    expect(buildColliders(high)).toEqual(all);
  });

  it('reads the settled layout crown of every plant, and the drawn crown stays close to it', () => {
    VARIANT_DEFS.forEach((d, v) => {
      const plan = variantPlan(v), layout = layoutCrown(v);
      if (!plan) { expect(layout, d.name).toBeNull(); return; }
      expect(layout, d.name).not.toBeNull();
      // A reshaped crown may differ from the one the layout was settled with, but not by so much that the keep-outs stop meaning anything.
      expect(Math.max(plan.crownR[0], plan.crownR[2]), d.name).toBeLessThan(layout!.crown * 1.4);
      expect(plan.crownC[1] + plan.crownR[1], d.name).toBeLessThan(layout!.crownTop * 1.25);
    });
  });

  it('keeps the nearest boxes when a wood is dense enough to exceed the cap', () => {
    const n = 6000;
    const dense = emptySet();
    dense.count = n;
    dense.pos = new Float32Array(n * 3);
    dense.scale = new Float32Array(n).fill(1);
    dense.yaw = new Float32Array(n);
    dense.variant = new Uint8Array(n).fill(VARIANTS_OF.spruce[0]);
    dense.pathDist = new Float32Array(n);
    for (let i = 0; i < n; i++) { dense.pos[i * 3] = i; dense.pathDist[i] = i / 100; }
    const boxes = buildColliders({ plants: dense, rocks: emptySet(), trees: n, bushes: 0, obstacleTrees: 0, plantRing: new Float32Array(0) });
    expect(boxes.length).toBe(MAX_COLLIDERS);
    // Boxes come tree by tree, nearest first: the tree at x = i owns the boxes centred within a trunk's stray of x = i.
    const per = stemBoxes(VARIANTS_OF.spruce[0]).length;
    boxes.forEach((b, k) => expect(Math.abs(b.center[0] - Math.floor(k / per))).toBeLessThan(0.5));
  });

  it('ignores bushes, which a quad flies through', () => {
    const bushes = emptySet();
    bushes.count = 3;
    bushes.pos = new Float32Array(9);
    bushes.scale = new Float32Array(3).fill(1);
    bushes.yaw = new Float32Array(3);
    bushes.variant = new Uint8Array(3).fill(VARIANTS_OF.bush[0]);
    bushes.pathDist = new Float32Array(3).fill(10);
    expect(buildColliders({ plants: bushes, rocks: emptySet(), trees: 0, bushes: 3, obstacleTrees: 0, plantRing: new Float32Array(0) })).toEqual([]);
  });
});

describe('forest RT proxy budget', () => {
  it('takes the tier cap while the other groups leave room, and never pushes the scene past MAX_PRIMS', () => {
    expect(forestRtCap(false, 0)).toBe(RT_PRIM_CAP);
    expect(forestRtCap(true, 0)).toBe(RT_PRIM_CAP_EXTREME);
    // The mega park's scenery, rides and guests (parkBudget.test.ts: 118,620 with the ultra forest's 1,500 in it).
    for (const used of [0, 50_000, 117_120, 125_000, MAX_PRIMS]) {
      for (const extreme of [false, true]) {
        const cap = forestRtCap(extreme, used);
        expect(cap).toBeGreaterThanOrEqual(0);
        expect(used + cap).toBeLessThanOrEqual(MAX_PRIMS - RT_PRIM_MARGIN + Math.max(0, used - (MAX_PRIMS - RT_PRIM_MARGIN)));
      }
    }
    expect(forestRtCap(true, 117_120)).toBe(MAX_PRIMS - RT_PRIM_MARGIN - 117_120);
  });

  it('covers the race line at the extreme tier: every plant within 60 m of it has its proxies', () => {
    const { high, track } = testScene();
    const prims = buildRtProxies(high, track.start.pos, RT_PRIM_CAP_EXTREME, { alongLine: true });
    expect(prims.length).toBeLessThanOrEqual(RT_PRIM_CAP_EXTREME);
    const spheres = prims.filter((p): p is Extract<RTPrimitive, { type: 'sphere' }> => p.type === 'sphere');
    let missing = 0;
    for (let i = 0; i < high.plants.count; i++) {
      if (!(high.plants.pathDist[i] <= 60) || !variantPlan(high.plants.variant[i]) || VARIANT_DEFS[high.plants.variant[i]].name.startsWith('snag')) continue;
      const x = high.plants.pos[i * 3], z = high.plants.pos[i * 3 + 2];
      if (!spheres.some((s) => Math.hypot(s.center[0] - x, s.center[2] - z) < s.radius + 1)) missing++;
    }
    expect(missing).toBe(0);
  }, 60000);

  it('gives the plants round a camera far off the line their proxies too, once, within the camera share of the budget', () => {
    const { high, track } = testScene();
    const cap = forestRtCap(true, 0), camera = cameraShare(cap), taken = new Set<number>();
    buildRtProxies(high, track.start.pos, cap - camera, { alongLine: true, taken });
    // A tree off the line and far from the start stands where a free-flight or park camera can be with no race-line proxies near it.
    const s = track.start.pos, fromStart = (i: number): number => Math.hypot(high.plants.pos[i * 3] - s[0], high.plants.pos[i * 3 + 2] - s[2]);
    let far = -1;
    for (let i = 0; i < high.plants.count; i++) if (variantPlan(high.plants.variant[i]) && !Number.isFinite(high.plants.pathDist[i]) && (far < 0 || fromStart(i) > fromStart(far))) far = i;
    const at: Vec3 = [high.plants.pos[far * 3], high.plants.pos[far * 3 + 1], high.plants.pos[far * 3 + 2]];
    expect(taken.has(proxyKey(far, false))).toBe(false);
    const near = new Set<number>(), prims = buildRtProxies(high, at, camera, { within: RT_CAMERA_WITHIN, skip: taken, taken: near });
    expect(prims.length).toBeGreaterThan(0);
    expect(prims.length).toBeLessThanOrEqual(camera);
    expect(near.has(proxyKey(far, false))).toBe(true);
    for (const k of near) expect(taken.has(k)).toBe(false);
    expect(camera + (cap - camera)).toBe(cap);
  }, 60000);
});

describe('buildRtProxies', () => {
  const { high, track } = testScene();
  const focus = track.start.pos;
  const prims = buildRtProxies(high, focus);
  const dist = (s: InstanceSet, i: number): number => Math.hypot(s.pos[i * 3] - focus[0], s.pos[i * 3 + 2] - focus[2]);
  const isCapsule = (p: RTPrimitive): p is Extract<RTPrimitive, { type: 'capsule' }> => p.type === 'capsule';

  it('fills the primitive budget with whole plants only and never goes over it', () => {
    expect(prims.length).toBeLessThanOrEqual(RT_PRIM_CAP);
    expect(prims.length).toBeGreaterThan(RT_PRIM_CAP * 0.9);
  });

  it('casts opaque wood from the trunks, dark foliage from the canopies and grey stone from the rocks', () => {
    expect(RT_FOLIAGE).toEqual({ albedo: [0.045, 0.09, 0.025], roughness: 1, metalness: 0 });
    for (const p of prims) {
      if (p.type === 'sphere') expect(p.material).toBe(RT_FOLIAGE);
      else if (p.type === 'capsule') { expect(p.material).toBe(RT_WOOD); expect(isCanopyProxy(p)).toBe(false); }
      else expect(p.type).toBe('ellipsoid');
    }
    expect(prims.some(isCapsule)).toBe(true);
    expect(prims.some((p) => p.type === 'sphere')).toBe(true);
    expect(prims.some((p) => p.type === 'ellipsoid')).toBe(true);
  });

  it('serves what stands nearest the focus first', () => {
    const order = Array.from({ length: high.plants.count }, (_, i) => i).sort((i, j) => dist(high.plants, i) - dist(high.plants, j));
    for (const i of order.slice(0, 20)) {
      const x = high.plants.pos[i * 3], z = high.plants.pos[i * 3 + 2];
      expect(prims.some((p) => { const c = p.type === 'capsule' ? p.a : p.center; return Math.hypot(c[0] - x, c[2] - z) < 12; }), `plant ${i} beside the focus has a shadow`).toBe(true);
    }
    expect(Math.max(...prims.map((p) => { const c = p.type === 'capsule' ? p.a : p.center; return Math.hypot(c[0] - focus[0], c[2] - focus[2]); }))).toBeLessThan(dist(high.plants, order[order.length - 1]));
  });

  it('lays each trunk capsule along the leaning trunk the tree is drawn with, at its scale and yaw', () => {
    for (let i = 0; i < high.plants.count; i++) {
      if (!isTree(high, i)) continue;
      const own = buildRtProxies({ ...high, plants: single(high.plants, i), rocks: emptySet() }, focus).filter(isCapsule);
      if (!own.length) continue;
      const placed = placementOf(high.plants, i), fit = woodShadowFit(high.plants.variant[i]).trunk;
      const expected = plantWoodShadows(high.plants.variant[i], placed, false);
      expect(own).toEqual(expected);
      expect(fit.length).toBeGreaterThan(0);
      return;
    }
    throw new Error('no tree in the test scene');
  });

  it('gives a bush its canopy and a rock an ellipsoid that spans its mesh, and skips pebbles', () => {
    const bushIndex = Array.from({ length: high.plants.count }, (_, i) => i).find((i) => VARIANT_DEFS[high.plants.variant[i]].group === 'bush');
    expect(bushIndex).toBeDefined();
    const bush = buildRtProxies({ ...high, plants: single(high.plants, bushIndex as number), rocks: emptySet() }, focus);
    expect(bush.length).toBeGreaterThan(0);
    for (const p of bush) expect(p.type).toBe('sphere');
    const big = Array.from({ length: high.rocks.count }, (_, i) => i).find((i) => high.rocks.scale[i] >= MIN_SHADOW_ROCK_RADIUS);
    const pebble = Array.from({ length: high.rocks.count }, (_, i) => i).find((i) => high.rocks.scale[i] < MIN_SHADOW_ROCK_RADIUS);
    expect(big).toBeDefined();
    const rock = buildRtProxies({ ...high, plants: emptySet(), rocks: single(high.rocks, big as number) }, focus);
    expect(rock).toHaveLength(1);
    const e = rock[0];
    if (e.type !== 'ellipsoid') throw new Error('expected ellipsoid');
    const s = high.rocks.scale[big as number], asset = rockAssets()[VARIANT_DEFS[high.rocks.variant[big as number]].rock];
    expect(e.center[1] - e.half[1]).toBeCloseTo(high.rocks.pos[(big as number) * 3 + 1], 4);
    expect(e.center[1] + e.half[1]).toBeCloseTo(high.rocks.pos[(big as number) * 3 + 1] + asset.height * s, 4);
    if (pebble !== undefined) expect(buildRtProxies({ ...high, plants: emptySet(), rocks: single(high.rocks, pebble) }, focus)).toEqual([]);
  });

  it('follows the focus and is deterministic', () => {
    const far: Vec3 = [track.path[track.path.length >> 1][0], 0, track.path[track.path.length >> 1][2]];
    expect(buildRtProxies(high, focus)).toEqual(prims);
    expect(buildRtProxies(high, far)).not.toEqual(prims);
  });

  it('emits nothing for a placement with no plants and no rocks', () => {
    expect(buildRtProxies({ ...high, plants: emptySet(), rocks: emptySet() }, focus)).toEqual([]);
  });
});

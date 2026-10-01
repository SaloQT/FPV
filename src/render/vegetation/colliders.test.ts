import { describe, expect, it } from 'vitest';
import type { Vec3 } from '../../contracts';
import { MAX_COLLIDERS, MIN_BOULDER_RADIUS, ROCK_COLLIDER_RANGE, RT_FOLIAGE, RT_PRIM_CAP, RT_TREE_COUNT, TREE_COLLIDER_RANGE, TRUNK_HALF_MAX, TRUNK_HALF_MIN, buildColliders, buildRtProxies } from './colliders';
import type { InstanceSet, VegPlacement } from './placement';
import { pathDistance, testScene } from './testScene';
import { VARIANTS_OF, VARIANT_DEFS, variantPlan } from './variants';

function emptySet(): InstanceSet {
  return { count: 0, pos: new Float32Array(0), scale: new Float32Array(0), yaw: new Float32Array(0), variant: new Uint8Array(0), tint: new Uint32Array(0), nrm: new Uint32Array(0), pathDist: new Float32Array(0) };
}

const treesOnly = (p: VegPlacement): VegPlacement => ({ ...p, rocks: emptySet() });
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
    let trees = 0, boulders = 0;
    for (let i = 0; i < high.plants.count; i++) if (isTree(high, i) && high.plants.pathDist[i] <= TREE_COLLIDER_RANGE) trees++;
    for (let i = 0; i < high.rocks.count; i++) if (high.rocks.scale[i] >= MIN_BOULDER_RADIUS && high.rocks.pathDist[i] <= ROCK_COLLIDER_RANGE) boulders++;
    expect(trees).toBeGreaterThan(50);
    expect(boulders).toBeGreaterThan(10);
    expect(buildColliders(treesOnly(high)).length).toBe(trees);
    expect(buildColliders(rocksOnly(high)).length).toBe(boulders);
    expect(all.length).toBe(trees + boulders);
  });

  it('gives each trunk a square box of half 0.15-0.4 m standing on the ground, yawed like the tree', () => {
    const trunks = buildColliders(treesOnly(high));
    const wanted: number[] = [];
    for (let i = 0; i < high.plants.count; i++) if (isTree(high, i) && high.plants.pathDist[i] <= TREE_COLLIDER_RANGE) wanted.push(i);
    const byPos = new Map(wanted.map((i) => [`${high.plants.pos[i * 3]},${high.plants.pos[i * 3 + 2]}`, i]));
    for (const b of trunks) {
      expect(b.kind).toBe('box');
      expect(b.half[0]).toBe(b.half[2]);
      expect(b.half[0]).toBeGreaterThanOrEqual(TRUNK_HALF_MIN);
      expect(b.half[0]).toBeLessThanOrEqual(TRUNK_HALF_MAX);
      expect(b.half[1]).toBeGreaterThan(1.5);
      const i = byPos.get(`${b.center[0]},${b.center[2]}`);
      expect(i).toBeDefined();
      expect(b.center[1] - b.half[1]).toBeCloseTo(high.plants.pos[(i as number) * 3 + 1], 4);
      expect(b.yaw).toBe(high.plants.yaw[i as number]);
    }
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
    const boxes = buildColliders({ plants: dense, rocks: emptySet(), trees: n, bushes: 0, obstacleTrees: 0 });
    expect(boxes.length).toBe(MAX_COLLIDERS);
    boxes.forEach((b, k) => expect(b.center[0]).toBe(k));
  });

  it('ignores bushes, which a quad flies through', () => {
    const bushes = emptySet();
    bushes.count = 3;
    bushes.pos = new Float32Array(9);
    bushes.scale = new Float32Array(3).fill(1);
    bushes.yaw = new Float32Array(3);
    bushes.variant = new Uint8Array(3).fill(VARIANTS_OF.bush[0]);
    bushes.pathDist = new Float32Array(3).fill(10);
    expect(buildColliders({ plants: bushes, rocks: emptySet(), trees: 0, bushes: 3, obstacleTrees: 0 })).toEqual([]);
  });
});

describe('buildRtProxies', () => {
  const { high, track } = testScene();
  const focus = track.start.pos;
  const prims = buildRtProxies(high, focus);

  it('emits a capsule trunk and a sphere canopy per tree, capped at 600 primitives', () => {
    expect(RT_PRIM_CAP).toBe(600);
    expect(prims.length).toBe(RT_PRIM_CAP);
    expect(RT_TREE_COUNT * 2).toBe(RT_PRIM_CAP);
    prims.forEach((p, k) => expect(p.type).toBe(k % 2 === 0 ? 'capsule' : 'sphere'));
  });

  it('uses the dark foliage material: albedo (0.045, 0.09, 0.025), rough, dielectric', () => {
    expect(RT_FOLIAGE).toEqual({ albedo: [0.045, 0.09, 0.025], roughness: 1, metalness: 0 });
    for (const p of prims) expect(p.material).toBe(RT_FOLIAGE);
  });

  it('picks the 300 trees nearest the focus', () => {
    const dists: number[] = [];
    for (let i = 0; i < high.plants.count; i++) if (isTree(high, i)) dists.push(Math.hypot(high.plants.pos[i * 3] - focus[0], high.plants.pos[i * 3 + 2] - focus[2]));
    dists.sort((a, b) => a - b);
    const chosen = prims.filter((p) => p.type === 'capsule').map((p) => (p.type === 'capsule' ? Math.hypot(p.a[0] - focus[0], p.a[2] - focus[2]) : 0));
    chosen.forEach((d, k) => expect(d).toBeCloseTo(dists[k], 3));
  });

  it('stands each capsule on the ground under a canopy sphere sized from the crown volume', () => {
    for (let k = 0; k < prims.length; k += 2) {
      const trunk = prims[k], canopy = prims[k + 1];
      if (trunk.type !== 'capsule' || canopy.type !== 'sphere') throw new Error('expected capsule then sphere');
      expect(trunk.b[1]).toBeGreaterThan(trunk.a[1]);
      expect(trunk.b[1]).toBeLessThanOrEqual(canopy.center[1] + 1e-6);
      expect(trunk.radius).toBeGreaterThanOrEqual(0.12);
      expect(trunk.radius).toBeLessThan(1);
      expect(canopy.center[1]).toBeGreaterThan(trunk.a[1] + 1);
      expect(canopy.radius).toBeGreaterThan(1);
      expect(canopy.radius).toBeLessThan(15);
      expect(Math.hypot(canopy.center[0] - trunk.a[0], canopy.center[2] - trunk.a[2])).toBeLessThan(canopy.radius + 2);
    }
  });

  it('measures the canopy from the tree plan at the instance scale', () => {
    const p = prims[1];
    if (p.type !== 'sphere') throw new Error('expected sphere');
    let found = false;
    for (let i = 0; i < high.plants.count && !found; i++) {
      if (!isTree(high, i)) continue;
      const plan = variantPlan(high.plants.variant[i]);
      if (!plan) continue;
      const s = high.plants.scale[i];
      if (Math.abs(high.plants.pos[i * 3 + 1] + plan.crownC[1] * s - p.center[1]) > 1e-3) continue;
      expect(p.radius).toBeCloseTo(Math.cbrt(plan.crownR[0] * plan.crownR[1] * plan.crownR[2]) * s, 4);
      found = true;
    }
    expect(found).toBe(true);
  });

  it('follows the focus and is deterministic', () => {
    const far: Vec3 = [track.path[track.path.length >> 1][0], 0, track.path[track.path.length >> 1][2]];
    expect(buildRtProxies(high, focus)).toEqual(prims);
    expect(buildRtProxies(high, far)).not.toEqual(prims);
  });

  it('emits nothing for a placement without trees', () => {
    expect(buildRtProxies(rocksOnly(high), focus)).toEqual([]);
  });
});

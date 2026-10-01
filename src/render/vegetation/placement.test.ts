import { describe, expect, it } from 'vitest';
import { PATH_CLEARANCE, REGION_RADIUS, TIER_LIMITS, placeVegetation, type InstanceSet } from './placement';
import { MAX_SLOPE_DEG, MIN_SOIL } from './placementRules';
import { rockAssets } from './rockGen';
import { TerrainFields } from './terrainFields';
import { blockerDiscs, eachPair, pathDistance, testScene } from './testScene';
import { VARIANT_DEFS, variantPlan } from './variants';

const EPS = 1e-3;
const MAX_TAN = Math.tan((MAX_SLOPE_DEG * Math.PI) / 180);
const SLOW = 60_000;

const isTree = (v: number): boolean => VARIANT_DEFS[v].group === 'tree';

function sameInstances(a: InstanceSet, b: InstanceSet, n: number): void {
  expect(a.count).toBeGreaterThanOrEqual(n);
  expect(b.count).toBeGreaterThanOrEqual(n);
  expect(a.pos.subarray(0, n * 3)).toEqual(b.pos.subarray(0, n * 3));
  expect(a.scale.subarray(0, n)).toEqual(b.scale.subarray(0, n));
  expect(a.yaw.subarray(0, n)).toEqual(b.yaw.subarray(0, n));
  expect(a.variant.subarray(0, n)).toEqual(b.variant.subarray(0, n));
  expect(a.tint.subarray(0, n)).toEqual(b.tint.subarray(0, n));
  expect(a.nrm.subarray(0, n)).toEqual(b.nrm.subarray(0, n));
}

/** The plants after the track's tree obstacles, which stand wherever the track put them and are exempt from the density rules. */
function natural(s: InstanceSet, skip: number): InstanceSet {
  const n = s.count - skip;
  return {
    count: n, pos: s.pos.subarray(skip * 3), scale: s.scale.subarray(skip), yaw: s.yaw.subarray(skip), variant: s.variant.subarray(skip),
    tint: s.tint.subarray(skip), nrm: s.nrm.subarray(skip), pathDist: s.pathDist.subarray(skip),
  };
}

describe('placeVegetation on a generated terrain and race track', () => {
  const { terrain, track, high } = testScene();
  const fields = new TerrainFields(terrain);
  const { plants: all, rocks } = high;
  const plants = natural(all, high.obstacleTrees);

  it('fills the high tier to its limits with consistent bookkeeping', () => {
    expect(all.count).toBe(TIER_LIMITS.high.plants);
    expect(rocks.count).toBe(TIER_LIMITS.high.rocks);
    expect(high.trees + high.bushes).toBe(all.count);
    let trees = 0;
    for (let i = 0; i < all.count; i++) if (isTree(all.variant[i])) trees++;
    expect(high.trees).toBe(trees);
    for (const s of [all, rocks]) {
      expect(s.pos.length).toBe(s.count * 3);
      expect(s.scale.length).toBe(s.count);
      expect(s.pathDist.length).toBe(s.count);
      for (let i = 0; i < s.count; i++) {
        expect(Number.isFinite(s.pos[i * 3] + s.pos[i * 3 + 1] + s.pos[i * 3 + 2])).toBe(true);
        expect(s.scale[i]).toBeGreaterThan(0);
      }
    }
  });

  it('places plants from variants 0-7 and rocks from 8-11, using every species', () => {
    const plantCount = new Array<number>(VARIANT_DEFS.length).fill(0), rockCount = new Array<number>(VARIANT_DEFS.length).fill(0);
    for (let i = 0; i < all.count; i++) plantCount[all.variant[i]]++;
    for (let i = 0; i < rocks.count; i++) rockCount[rocks.variant[i]]++;
    VARIANT_DEFS.forEach((d, v) => {
      if (d.group === 'rock') { expect(plantCount[v]).toBe(0); expect(rockCount[v]).toBeGreaterThan(100); }
      else { expect(rockCount[v]).toBe(0); expect(plantCount[v]).toBeGreaterThan(100); }
    });
    expect(high.trees).toBeGreaterThan(5000);
    expect(high.bushes).toBeGreaterThan(1000);
  });

  it('is deterministic: a second run produces identical arrays', () => {
    const again = placeVegetation(terrain, track, TIER_LIMITS.high);
    sameInstances(again.plants, all, all.count);
    sameInstances(again.rocks, rocks, rocks.count);
    expect(again.plants.pathDist).toEqual(all.pathDist);
    expect(again.trees).toBe(high.trees);
  }, SLOW);

  it('nests the quality tiers: each smaller tier is an exact prefix of the larger ones', () => {
    const low = placeVegetation(terrain, track, TIER_LIMITS.low);
    const ultra = placeVegetation(terrain, track, TIER_LIMITS.ultra);
    expect(low.plants.count).toBe(TIER_LIMITS.low.plants);
    expect(low.rocks.count).toBe(TIER_LIMITS.low.rocks);
    expect(ultra.plants.count).toBe(TIER_LIMITS.ultra.plants);
    expect(ultra.rocks.count).toBe(TIER_LIMITS.ultra.rocks);
    sameInstances(low.plants, all, low.plants.count);
    sameInstances(low.rocks, rocks, low.rocks.count);
    sameInstances(all, ultra.plants, all.count);
    sameInstances(rocks, ultra.rocks, rocks.count);
  }, SLOW);

  it('changes with the terrain seed', () => {
    const other = placeVegetation({ ...terrain, seed: terrain.seed + 1 }, track, { plants: 2000, rocks: 300 });
    let same = 0;
    for (let i = 0; i < 2000; i++) if (other.plants.pos[i * 3] === all.pos[i * 3] && other.plants.pos[i * 3 + 2] === all.pos[i * 3 + 2]) same++;
    expect(same).toBeLessThan(100);
  }, SLOW);

  it('turns every tree obstacle into a real tree on its spot, sized to its collision cylinder, ahead of all other plants', () => {
    const obstacles = track.obstacles.filter((o) => o.kind === 'tree');
    expect(obstacles.length).toBeGreaterThan(0);
    expect(high.obstacleTrees).toBe(obstacles.length);
    obstacles.forEach((o, i) => {
      expect(all.pos[i * 3]).toBeCloseTo(o.pos[0], 3);
      expect(all.pos[i * 3 + 2]).toBeCloseTo(o.pos[2], 3);
      expect(isTree(all.variant[i])).toBe(true);
      expect(all.yaw[i]).toBeCloseTo(o.yaw, 5);
      const plan = variantPlan(all.variant[i]);
      const trunk = (plan?.trunkRadius ?? 0) * all.scale[i];
      expect(trunk).toBeGreaterThan(o.size[0] * 0.5);
      expect(trunk).toBeLessThan(o.size[0] * 2);
    });
  });

  it('keeps trees and bushes on soil, off steep slopes, out of water and rivers and below the tree line', () => {
    const range = terrain.maxHeight - terrain.minHeight;
    for (let i = 0; i < plants.count; i++) {
      const x = plants.pos[i * 3], z = plants.pos[i * 3 + 2];
      const h = fields.height(x, z);
      expect(fields.soil(x, z)).toBeGreaterThan(MIN_SOIL - EPS);
      expect(fields.gradient(x, z)).toBeLessThan(MAX_TAN + EPS);
      expect(h).toBeGreaterThanOrEqual(terrain.waterLevel + 0.8 - 1e-2);
      expect(fields.flow(x, z)).toBeLessThan(0.85 + EPS);
      expect((h - terrain.minHeight) / range).toBeLessThan(0.76);
    }
  });

  it('plants sit on the ground with the base sunk slightly into it', () => {
    for (let i = 0; i < plants.count; i++) {
      const y = plants.pos[i * 3 + 1], h = fields.height(plants.pos[i * 3], plants.pos[i * 3 + 2]);
      expect(y).toBeLessThanOrEqual(h);
      expect(h - y).toBeLessThan(0.1 * plants.scale[i]);
    }
  });

  it('buries rocks below the lowest of the ground samples under them', () => {
    const meshes = rockAssets();
    for (let i = 0; i < rocks.count; i++) {
      const y = rocks.pos[i * 3 + 1], h = fields.height(rocks.pos[i * 3], rocks.pos[i * 3 + 2]);
      const sunk = 0.15 * meshes[VARIANT_DEFS[rocks.variant[i]].rock].height * rocks.scale[i];
      expect(y).toBeLessThanOrEqual(h - sunk + EPS);
    }
  });

  it('keeps rocks out of open water and river channels, with radii from 0.3 m to 4 m', () => {
    for (let i = 0; i < rocks.count; i++) {
      const x = rocks.pos[i * 3], z = rocks.pos[i * 3 + 2];
      expect(fields.height(x, z)).toBeGreaterThanOrEqual(terrain.waterLevel + 0.3 - 1e-2);
      expect(fields.flow(x, z)).toBeLessThan(0.9 + EPS);
      expect(rocks.scale[i]).toBeGreaterThanOrEqual(0.3 - EPS);
      expect(rocks.scale[i]).toBeLessThanOrEqual(4 + EPS);
    }
  });

  it('keeps trees and bushes at least 6 m from the racing line and reports the exact distance', () => {
    expect(PATH_CLEARANCE).toBeGreaterThanOrEqual(6);
    let nearest = Infinity;
    for (let i = 0; i < plants.count; i++) {
      const d = pathDistance(track.path, plants.pos[i * 3], plants.pos[i * 3 + 2]);
      nearest = Math.min(nearest, d);
      if (Number.isFinite(plants.pathDist[i])) expect(plants.pathDist[i]).toBeCloseTo(d, 2);
      else expect(d).toBeGreaterThan(100);
    }
    expect(nearest).toBeGreaterThanOrEqual(PATH_CLEARANCE - EPS);
    expect(nearest).toBeLessThan(PATH_CLEARANCE + 1.5);
  });

  it('keeps rock surfaces at least 3.5 m from the racing line', () => {
    for (let i = 0; i < rocks.count; i++) {
      const d = pathDistance(track.path, rocks.pos[i * 3], rocks.pos[i * 3 + 2]);
      expect(d - rocks.scale[i]).toBeGreaterThanOrEqual(3.5 - EPS);
    }
  });

  it('keeps clear of gate openings, obstacles and the launch pad', () => {
    const discs = blockerDiscs(track);
    expect(discs.length).toBeGreaterThan(track.gates.length);
    let worst = Infinity;
    for (let i = 0; i < plants.count; i++) {
      const plan = variantPlan(plants.variant[i]);
      const reach = 0.8 * (plan ? Math.max(plan.crownR[0], plan.crownR[2]) : 0) * plants.scale[i] + 1;
      for (const b of discs) worst = Math.min(worst, Math.hypot(plants.pos[i * 3] - b.x, plants.pos[i * 3 + 2] - b.z) - b.r - reach);
    }
    expect(worst).toBeGreaterThanOrEqual(-EPS);
    worst = Infinity;
    for (let i = 0; i < rocks.count; i++) {
      for (const b of discs) worst = Math.min(worst, Math.hypot(rocks.pos[i * 3] - b.x, rocks.pos[i * 3 + 2] - b.z) - b.r - rocks.scale[i] - 0.5);
    }
    expect(worst).toBeGreaterThanOrEqual(-EPS);
  });

  it('applies Poisson-disc spacing between plants: 1x the species spacing within a group, 0.6x across trees and bushes', () => {
    let pairs = 0, worst = Infinity;
    eachPair(plants, 30, (i, j, d) => {
      const a = plants.variant[i], b = plants.variant[j];
      const need = 0.5 * (VARIANT_DEFS[a].spacing * plants.scale[i] + VARIANT_DEFS[b].spacing * plants.scale[j]) * (isTree(a) === isTree(b) ? 1 : 0.6);
      worst = Math.min(worst, d - need);
      pairs++;
    });
    expect(pairs).toBeGreaterThan(20000);
    expect(worst).toBeGreaterThanOrEqual(-EPS);
  });

  it('spaces rocks by 1.3x the mean radius and keeps plants clear of the rocks', () => {
    let worst = Infinity;
    eachPair(rocks, 12, (i, j, d) => { worst = Math.min(worst, d - 0.5 * (rocks.scale[i] + rocks.scale[j]) * 1.3); });
    expect(worst).toBeGreaterThanOrEqual(-EPS);

    const cell = 24, cells = new Map<number, number[]>();
    const key = (cx: number, cz: number): number => cx * 100_003 + cz;
    for (let i = 0; i < rocks.count; i++) {
      const k = key(Math.floor(rocks.pos[i * 3] / cell), Math.floor(rocks.pos[i * 3 + 2] / cell));
      const list = cells.get(k);
      if (list) list.push(i); else cells.set(k, [i]);
    }
    let checked = 0;
    worst = Infinity;
    for (let i = 0; i < plants.count; i++) {
      const x = plants.pos[i * 3], z = plants.pos[i * 3 + 2], cx = Math.floor(x / cell), cz = Math.floor(z / cell);
      const trunk = isTree(plants.variant[i]) ? 0.3 : 0.5;
      for (let dz = -1; dz <= 1; dz++) {
        for (let dx = -1; dx <= 1; dx++) {
          for (const r of cells.get(key(cx + dx, cz + dz)) ?? []) {
            worst = Math.min(worst, Math.hypot(x - rocks.pos[r * 3], z - rocks.pos[r * 3 + 2]) - rocks.scale[r] - trunk - 0.3);
            checked++;
          }
        }
      }
    }
    expect(checked).toBeGreaterThan(20000);
    expect(worst).toBeGreaterThanOrEqual(-EPS);
  });

  it('puts rocks on steep, bare or stream-side ground far more often than the terrain around them', () => {
    const favoured = (x: number, z: number): boolean => fields.gradient(x, z) > 0.27 || fields.soil(x, z) < 0.4 || fields.flow(x, z) > 0.3;
    let onRocks = 0;
    for (let i = 0; i < rocks.count; i++) if (favoured(rocks.pos[i * 3], rocks.pos[i * 3 + 2])) onRocks++;
    let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
    for (let i = 0; i < rocks.count; i++) {
      x0 = Math.min(x0, rocks.pos[i * 3]); x1 = Math.max(x1, rocks.pos[i * 3]);
      z0 = Math.min(z0, rocks.pos[i * 3 + 2]); z1 = Math.max(z1, rocks.pos[i * 3 + 2]);
    }
    let ground = 0, groundFavoured = 0;
    for (let z = z0; z < z1; z += 7) {
      for (let x = x0; x < x1; x += 7) {
        if (fields.height(x, z) < terrain.waterLevel + 0.3) continue;
        ground++;
        if (favoured(x, z)) groundFavoured++;
      }
    }
    expect(ground).toBeGreaterThan(5000);
    expect(onRocks / rocks.count).toBeGreaterThan(groundFavoured / ground + 0.25);
  });

  it('walks outwards from the racing line, so the nearest ground fills first', () => {
    const mean = (from: number, to: number): number => {
      let sum = 0;
      for (let i = from; i < to; i++) sum += pathDistance(track.path, plants.pos[i * 3], plants.pos[i * 3 + 2]);
      return sum / (to - from);
    };
    expect(mean(0, 1500)).toBeLessThan(mean(plants.count - 1500, plants.count) * 0.6);
  });
});

describe('placeVegetation without a track', () => {
  const { terrain } = testScene();
  const limits = { plants: 2500, rocks: 300 };
  const centre = ((terrain.resolution - 1) * terrain.cellSize) / 2;

  it('covers a disc around the terrain centre and reports no path distance', () => {
    const p = placeVegetation(terrain, null, limits);
    expect(p.plants.count).toBe(limits.plants);
    expect(p.rocks.count).toBeGreaterThan(50);
    for (const s of [p.plants, p.rocks]) {
      for (let i = 0; i < s.count; i++) {
        expect(Math.hypot(s.pos[i * 3] - (terrain.origin[0] + centre), s.pos[i * 3 + 2] - (terrain.origin[1] + centre))).toBeLessThan(REGION_RADIUS);
        expect(s.pathDist[i]).toBe(Infinity);
      }
    }
  }, SLOW);

  it('is deterministic without a track too', () => {
    const a = placeVegetation(terrain, null, limits), b = placeVegetation(terrain, null, limits);
    sameInstances(a.plants, b.plants, limits.plants);
    sameInstances(a.rocks, b.rocks, a.rocks.count);
  }, SLOW);
});

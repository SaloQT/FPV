import { describe, expect, it } from 'vitest';
import { INSTANCE_BYTES, KIND_BUSH, KIND_ROCK, KIND_TREE, SLOT_ALIGN, VARIANT_BYTES, packInstances, type InstanceRun } from './instanceData';
import { testScene } from './testScene';
import { VARIANT_COUNT, VARIANT_DEFS, buildVariantAssets } from './variants';

const assets = buildVariantAssets();
const runsOf = (plants: number, rocks: number): InstanceRun[] => {
  const { high } = testScene();
  return [{ set: high.plants, count: plants }, { set: high.rocks, count: rocks }];
};

describe('packInstances', () => {
  const { high } = testScene();
  const packed = packInstances(runsOf(high.plants.count, high.rocks.count), assets);
  const f32 = new Float32Array(packed.instances), u32 = new Uint32Array(packed.instances);
  const W = INSTANCE_BYTES / 4;

  it('starts every variant on a 64-slot boundary so visible-list offsets stay 256-byte aligned', () => {
    expect(packed.slots % SLOT_ALIGN).toBe(0);
    expect(packed.instances.byteLength).toBe(packed.slots * INSTANCE_BYTES);
    for (let v = 0; v < VARIANT_COUNT; v++) {
      expect(packed.first[v] % SLOT_ALIGN).toBe(0);
      expect((packed.first[v] * INSTANCE_BYTES) % 256).toBe(0);
      const end = v + 1 < VARIANT_COUNT ? packed.first[v + 1] : packed.slots;
      expect(end - packed.first[v]).toBe(Math.ceil(packed.count[v] / SLOT_ALIGN) * SLOT_ALIGN);
    }
  });

  it('counts each variant once and totals the placement', () => {
    const tally = new Uint32Array(VARIANT_COUNT);
    for (let i = 0; i < high.plants.count; i++) tally[high.plants.variant[i]]++;
    for (let i = 0; i < high.rocks.count; i++) tally[high.rocks.variant[i]]++;
    expect(Array.from(packed.count)).toEqual(Array.from(tally));
    expect(packed.count.reduce((a, b) => a + b, 0)).toBe(high.plants.count + high.rocks.count);
    expect(packed.count.every((c) => c > 0)).toBe(true);
  });

  it('writes position, scale, yaw, variant, tint and normal of every instance into its variant run in order', () => {
    const fill = new Uint32Array(VARIANT_COUNT);
    for (const [set, n] of [[high.plants, high.plants.count], [high.rocks, high.rocks.count]] as const) {
      for (let i = 0; i < n; i++) {
        const v = set.variant[i], o = (packed.first[v] + fill[v]++) * W;
        expect([f32[o], f32[o + 1], f32[o + 2]]).toEqual([set.pos[i * 3], set.pos[i * 3 + 1], set.pos[i * 3 + 2]]);
        expect(f32[o + 3]).toBe(set.scale[i]);
        expect(f32[o + 4]).toBe(set.yaw[i]);
        expect(u32[o + 5]).toBe(v);
        expect(u32[o + 6]).toBe(set.tint[i]);
        expect(u32[o + 7]).toBe(set.nrm[i]);
      }
    }
    expect(Array.from(fill)).toEqual(Array.from(packed.count));
  });

  it('zeroes the padding slots so the cull skips them', () => {
    let padding = 0;
    for (let v = 0; v < VARIANT_COUNT; v++) {
      const end = v + 1 < VARIANT_COUNT ? packed.first[v + 1] : packed.slots;
      for (let s = packed.first[v] + packed.count[v]; s < end; s++) {
        padding++;
        for (let w = 0; w < W; w++) expect(u32[s * W + w]).toBe(0);
      }
    }
    expect(padding).toBeGreaterThan(0);
  });

  it('describes each variant in the 64-byte table the shaders index', () => {
    expect(packed.variants.byteLength).toBe(VARIANT_COUNT * VARIANT_BYTES);
    const vf = new Float32Array(packed.variants), vu = new Uint32Array(packed.variants);
    VARIANT_DEFS.forEach((d, v) => {
      const o = v * (VARIANT_BYTES / 4), a = assets[v];
      expect(vu[o]).toBe(packed.first[v]);
      expect(vu[o + 1]).toBe(packed.count[v]);
      expect(vu[o + 2]).toBe(d.group === 'tree' ? KIND_TREE : d.group === 'bush' ? KIND_BUSH : KIND_ROCK);
      expect([vf[o + 4], vf[o + 5]]).toEqual([Math.fround(a.centreY), Math.fround(a.radius)]);
      expect([vf[o + 6], vf[o + 7]]).toEqual(d.lodRatio.map(Math.fround));
      expect(vf[o + 8]).toBe(Math.fround(a.height));
      expect([vf[o + 9], vf[o + 10], vf[o + 11]]).toEqual([d.swayHz, d.swayStrength, d.flutter].map(Math.fround));
      expect([vf[o + 12], vf[o + 13], vf[o + 14], vf[o + 15]]).toEqual([...d.tone, d.translucency].map(Math.fround));
    });
  });

  it('is stable: the same input packs to identical bytes', () => {
    const again = packInstances(runsOf(high.plants.count, high.rocks.count), assets);
    // A word loop instead of toEqual: deep equality over a megabyte typed array takes seconds and flakes under load.
    const firstDiff = (a: ArrayBuffer, b: ArrayBuffer): number => {
      const x = new Uint32Array(a), y = new Uint32Array(b);
      if (x.length !== y.length) return -2;
      for (let i = 0; i < x.length; i++) if (x[i] !== y[i]) return i;
      return -1;
    };
    expect(firstDiff(again.instances, packed.instances)).toBe(-1);
    expect(firstDiff(again.variants, packed.variants)).toBe(-1);
  });

  it('packs a tier prefix as the leading instances of each variant run', () => {
    const small = packInstances(runsOf(3000, 500), assets);
    expect(small.count.reduce((a, b) => a + b, 0)).toBe(3500);
    expect(small.slots).toBeLessThan(packed.slots);
    const su = new Uint32Array(small.instances);
    for (let v = 0; v < VARIANT_COUNT; v++) {
      for (let k = 0; k < Math.min(small.count[v], 20); k++) {
        for (let w = 0; w < W; w++) expect(su[(small.first[v] + k) * W + w]).toBe(u32[(packed.first[v] + k) * W + w]);
      }
    }
  });

  it('keeps a valid, empty buffer for an empty placement', () => {
    const empty = packInstances([], assets);
    expect(empty.slots).toBe(0);
    expect(empty.instances.byteLength).toBe(SLOT_ALIGN * INSTANCE_BYTES);
    expect(empty.count.every((c) => c === 0)).toBe(true);
  });
});

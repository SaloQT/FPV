import type { InstanceSet } from './placement';
import { VARIANT_COUNT, variantPlan, type VariantAsset } from './variants';

export const INSTANCE_BYTES = 32;
export const VARIANT_BYTES = 80;
/** Every variant's instances start at a multiple of this many slots so a visible-list binding offset is 256-byte aligned. */
export const SLOT_ALIGN = 64;
export const KIND_TREE = 0;
export const KIND_BUSH = 1;
export const KIND_ROCK = 2;

const INSTANCE_WORDS = INSTANCE_BYTES / 4;
const VARIANT_WORDS = VARIANT_BYTES / 4;

export interface PackedInstances {
  /** Instance slots including alignment padding; a multiple of SLOT_ALIGN. */
  slots: number;
  /** Instance structs, `slots` x 32 bytes (layout: shaders/vegetation/veg_instance.wgsl). Padding slots have scale 0. */
  instances: ArrayBuffer;
  /** Variant table, VARIANT_COUNT x 80 bytes. */
  variants: ArrayBuffer;
  /** Per variant: first slot and instance count. */
  first: Uint32Array;
  count: Uint32Array;
  /** Per run, the slot each of its instances went to. */
  runSlots: Uint32Array[];
}

export interface InstanceRun {
  set: InstanceSet;
  /** Only the first `count` instances of the set are used (tier prefixes). */
  count: number;
}

const kindOf = (group: string): number => (group === 'tree' ? KIND_TREE : group === 'bush' ? KIND_BUSH : KIND_ROCK);

/**
 * Sorts the instances by variant (stable, so equal input gives an identical buffer), aligns each variant's run to SLOT_ALIGN slots
 * and writes the instance structs and the variant table the tree and rock shaders read.
 */
export function packInstances(runs: readonly InstanceRun[], assets: readonly VariantAsset[]): PackedInstances {
  const count = new Uint32Array(VARIANT_COUNT);
  for (const r of runs) for (let i = 0; i < r.count; i++) count[r.set.variant[i]]++;
  const first = new Uint32Array(VARIANT_COUNT);
  let slots = 0;
  for (let v = 0; v < VARIANT_COUNT; v++) {
    first[v] = slots;
    slots += Math.ceil(count[v] / SLOT_ALIGN) * SLOT_ALIGN;
  }

  const instances = new ArrayBuffer(Math.max(slots, SLOT_ALIGN) * INSTANCE_BYTES);
  const f32 = new Float32Array(instances), u32 = new Uint32Array(instances);
  const fill = new Uint32Array(VARIANT_COUNT);
  const runSlots: Uint32Array[] = [];
  for (const r of runs) {
    const s = r.set, slotOf = new Uint32Array(r.count);
    runSlots.push(slotOf);
    for (let i = 0; i < r.count; i++) {
      const v = s.variant[i];
      const slot = first[v] + fill[v]++, o = slot * INSTANCE_WORDS;
      slotOf[i] = slot;
      f32[o] = s.pos[i * 3]; f32[o + 1] = s.pos[i * 3 + 1]; f32[o + 2] = s.pos[i * 3 + 2];
      f32[o + 3] = s.scale[i];
      f32[o + 4] = s.yaw[i];
      u32[o + 5] = v; u32[o + 6] = s.tint[i]; u32[o + 7] = s.nrm[i];
    }
  }

  const variants = new ArrayBuffer(VARIANT_COUNT * VARIANT_BYTES);
  const vf = new Float32Array(variants), vu = new Uint32Array(variants);
  for (let v = 0; v < VARIANT_COUNT; v++) {
    const a = assets[v], d = a.def, o = v * VARIANT_WORDS;
    vu[o] = first[v]; vu[o + 1] = count[v]; vu[o + 2] = kindOf(d.group);
    vf[o + 4] = a.centreY; vf[o + 5] = a.radius; vf[o + 6] = d.lodRatio[0]; vf[o + 7] = d.lodRatio[1];
    vf[o + 8] = a.height; vf[o + 9] = d.swayHz; vf[o + 10] = d.swayStrength; vf[o + 11] = d.flutter;
    vf[o + 12] = d.tone[0]; vf[o + 13] = d.tone[1]; vf[o + 14] = d.tone[2]; vf[o + 15] = d.translucency;
    // The crown ellipsoid (centre height and radii, mesh metres) for the leaves' sunflecks (tree.wgsl); zero for rocks.
    const plan = variantPlan(v);
    if (plan) { vf[o + 16] = plan.crownC[1]; vf[o + 17] = plan.crownR[0]; vf[o + 18] = plan.crownR[1]; vf[o + 19] = plan.crownR[2]; }
  }
  return { slots, instances, variants, first, count, runSlots };
}

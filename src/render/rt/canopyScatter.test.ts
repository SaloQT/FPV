import { describe, expect, it } from 'vitest';
import { RT_FOLIAGE } from '../vegetation/colliders';

const nodeFs = (globalThis as unknown as { process: { getBuiltinModule(id: string): unknown } }).process
  .getBuiltinModule('node:fs') as { readFileSync(path: URL): Uint8Array };

const read = (path: string): string => new TextDecoder().decode(nodeFs.readFileSync(new URL(`../shaders/${path}`, import.meta.url)));

describe('leaf-crown scatter model in the shaders', () => {
  const rtScene = read('rt/rt_scene.wgsl');
  const albedo = (rtScene.match(/const CANOPY_SCATTER_ALBEDO\s*:\s*vec3f\s*=\s*vec3f\(([^)]*)\)/)?.[1] ?? '').split(',').map(Number);
  const tauScale = Number(rtScene.match(/const CANOPY_DIFFUSE_TAU_SCALE\s*:\s*f32\s*=\s*([^;]+);/)?.[1]);

  it('uses a green-leaf reflectance + transmittance well above the reflectance-only proxy albedo', () => {
    expect(albedo).toHaveLength(3);
    for (let c = 0; c < 3; c++) expect(albedo[c]).toBeGreaterThan(RT_FOLIAGE.albedo[c]);
    expect(albedo[1]).toBeGreaterThan(0.15);
    expect(albedo[1]).toBeLessThan(0.3);
    expect(albedo[1]).toBeGreaterThan(albedo[0]);
    expect(albedo[1]).toBeGreaterThan(albedo[2]);
  });

  it('cuts the diffuse extinction to the Kubelka-Munk sqrt(1 - albedo) of the green single-scatter albedo', () => {
    expect(tauScale).toBeCloseTo(Math.sqrt(1 - albedo[1]), 1);
  });

  it('gives translucent leaves a share of the back-face ambient in the deferred pass, less than their direct transmittance', () => {
    const deferred = read('lighting/deferred.wgsl');
    const back = Number(deferred.match(/const LEAF_AMBIENT_BACK\s*:\s*f32\s*=\s*([^;]+);/)?.[1]);
    expect(back).toBeGreaterThan(0.2);
    expect(back).toBeLessThanOrEqual(1);
    expect(deferred).toMatch(/\(1\.0\s*\+\s*LEAF_AMBIENT_BACK\s*\*\s*LEAF_TRANSMITTANCE\s*\*\s*msc\.g\)/);
  });

  it('refills part of a leaf\'s occlusion with the light the occluding leaves scatter (a fraction, never the whole occlusion)', () => {
    const deferred = read('lighting/deferred.wgsl');
    const fill = Number(deferred.match(/const LEAF_AO_FILL\s*:\s*f32\s*=\s*([^;]+);/)?.[1]);
    expect(fill).toBeGreaterThan(0.1);
    expect(fill).toBeLessThan(1);
    expect(deferred).toMatch(/mix\(ao,\s*1\.0,\s*LEAF_AO_FILL\s*\*\s*msc\.g\)/);
  });
  it('counts a hit inside a porous crown as occlusion only by the leaves\' share of the chord, in the GI contact visibility', () => {
    const gi = read('rt/gi.wgsl');
    expect(rtScene).toMatch(/fn hitSolidity\([^)]*\)\s*->\s*f32/);
    expect(rtScene).toMatch(/exp\(-CANOPY_DIFFUSE_TAU_SCALE\s*\*\s*canopyOpticalDepth/);
    // The chord is integrated once per ray and shared by both terms, and the visibility weight is exactly zero past CONTACT_RANGE.
    expect(gi).toMatch(/chord = hitChordT\(h, origin, d\)/);
    expect(gi).toMatch(/vis \+= 1\.0 - hitSolidity\(h, chord\) \* \(1\.0 - saturate1\(h\.t \/ CONTACT_RANGE\)\)/);
    expect(gi).toMatch(/if \(h\.t < CONTACT_RANGE\)/);
  });
  it('leaves the contact-visibility term bit-identical when the chord is shared and skipped past CONTACT_RANGE', () => {
    const gi = read('rt/gi.wgsl');
    const contactRange = Number(gi.match(/const CONTACT_RANGE\s*:\s*f32\s*=\s*([^;]+);/)?.[1]);
    expect(contactRange).toBeGreaterThan(0);
    const saturate1 = (x: number) => (x < 0 ? 0 : x > 1 ? 1 : x);
    // The old march always evaluated the weight; the new one takes the weight's exact value past CONTACT_RANGE.
    const oldTerm = (t: number, solidity: number) => 1.0 - solidity * (1.0 - saturate1(t / contactRange));
    const newTerm = (t: number, solidity: number) => (t < contactRange ? oldTerm(t, solidity) : 1.0);
    for (const t of [0, 0.25, 0.999, 1.5, 1.9999, 2, 2.0001, 3, 17.5, 1e4]) {
      for (const solidity of [0, 0.25, 0.5, 0.999, 1]) {
        expect(newTerm(t, solidity)).toBe(oldTerm(t, solidity));
      }
    }
  });
});

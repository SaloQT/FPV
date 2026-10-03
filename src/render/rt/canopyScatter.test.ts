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
});

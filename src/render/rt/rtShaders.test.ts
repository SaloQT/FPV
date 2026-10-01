import { describe, expect, it } from 'vitest';
import { resolveShader } from '../shaderLib';
import {
  CANOPY_CORE, CANOPY_CLUMP_M, CANOPY_EXTINCTION, CANOPY_GAP_BASE, CANOPY_GAP_SPAN, CANOPY_SAMPLES, PRIM_FLAG_CANOPY,
} from './canopy';

const constant = (src: string, name: string): number => {
  const m = src.match(new RegExp(`const ${name}\\s*:\\s*\\w+\\s*=\\s*([-0-9.eE+]+)u?;`));
  if (!m) throw new Error(`const ${name} not found`);
  return Number(m[1]);
};

describe('shaders/rt/rt_canopy.wgsl', () => {
  const src = resolveShader('rt/rt_canopy.wgsl', { GRP: 2 });

  it('mirrors the constants of rt/canopy.ts', () => {
    expect(constant(src, 'CANOPY_EXTINCTION')).toBe(CANOPY_EXTINCTION);
    expect(constant(src, 'CANOPY_CORE')).toBe(CANOPY_CORE);
    expect(constant(src, 'CANOPY_GAP_BASE')).toBe(CANOPY_GAP_BASE);
    expect(constant(src, 'CANOPY_GAP_SPAN')).toBe(CANOPY_GAP_SPAN);
    expect(constant(src, 'CANOPY_SAMPLES')).toBe(CANOPY_SAMPLES);
    expect(constant(src, 'PRIM_FLAG_CANOPY')).toBe(PRIM_FLAG_CANOPY);
    expect(constant(src, 'CANOPY_INV_CLUMP')).toBeCloseTo(1 / CANOPY_CLUMP_M, 6);
  });
});

describe('leaf transmission', () => {
  it('is 0.8 of the reflectance in both the deferred BRDF and the RT hit shading', () => {
    expect(constant(resolveShader('common/pbr.wgsl'), 'LEAF_TRANSMITTANCE')).toBe(0.8);
    expect(constant(resolveShader('rt/rt_scene.wgsl', { GRP: 2 }), 'LEAF_TRANSMISSION')).toBe(0.8);
  });
});

describe('fp16 safety of the RT passes', () => {
  // Every colour/moment/history store goes through fp16Safe: an Inf or NaN in one texel is reprojected into its neighbours for ever.
  const passes: [string, Record<string, string | number | boolean>][] = [
    ['rt/gi.wgsl', { GRP: 2 }], ['rt/spec.wgsl', { GRP: 2 }], ['rt/probe_update.wgsl', { GRP: 2 }],
    ['rt/temporal.wgsl', { GRP: 1, SHADOW: true, CAP: '16.0' }], ['rt/temporal.wgsl', { GRP: 1, GI: true, CAP: '12.0' }], ['rt/temporal.wgsl', { GRP: 1, SPEC: true, CAP: '8.0' }],
    ['rt/atrous.wgsl', { GRP: 1, GI: true, ITER: '0.0', OUTFMT: 'rgba16float' }], ['rt/atrous.wgsl', { GRP: 1, GI: true, ITER: '2.0', OUTFMT: 'rgba16float', FINAL: true }],
  ];

  it.each(passes)('%s stores only fp16Safe values', (path, defines) => {
    const stores = resolveShader(path, defines).split('\n').filter((l) => l.includes('textureStore(')).map((l) => l.trim());
    expect(stores.length).toBeGreaterThan(0);
    for (const s of stores) {
      // Literal constants and `raw` (sanitised where it is loaded) need no guard.
      if (/^textureStore\(\w+, px, (vec4f\([-0-9., ]*\)|raw)\);$/.test(s)) continue;
      expect(s, s).toContain('fp16Safe(');
    }
  });

  it('the temporal pass refuses a non-finite history texel and caps the luminance that enters the moments', () => {
    const src = resolveShader('rt/temporal.wgsl', { GRP: 1, GI: true, CAP: '12.0' });
    expect(src).toContain('abs(hq) <= vec4f(FP16_SAFE)');
    expect(constant(src, 'LUMA_CAP') ** 2).toBeLessThan(65504);
  });
});

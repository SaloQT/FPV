import { describe, expect, it } from 'vitest';
import { resolveShader } from '../shaderLib';
import {
  CANOPY_CORE, CANOPY_CLUMP_M, CANOPY_EXTINCTION, CANOPY_GAP_BASE, CANOPY_GAP_SPAN, CANOPY_LOBE, CANOPY_RIM_NOISE, CANOPY_SAMPLES, PRIM_FLAG_CANOPY,
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
    expect(constant(src, 'CANOPY_RIM_NOISE')).toBe(CANOPY_RIM_NOISE);
    expect(constant(src, 'CANOPY_LOBE')).toBe(CANOPY_LOBE);
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

  it('only scales the translucent term: an opaque surface (translucency 0) gets neither wrap nor back-lit light', () => {
    const pbr = resolveShader('common/pbr.wgsl');
    expect(pbr).toMatch(/let wrap = 0\.5 \* translucency;/);
    expect(pbr).toMatch(/let back = translucency \* saturate1\(-ndl\)/);
  });
});

describe('emission in the RT hit shading', () => {
  const scene = resolveShader('rt/rt_scene.wgsl', { GRP: 2 });

  it('is clamped to the fp16-safe radiance before it is added and stored (pre-exposure reaches 1000 at night)', () => {
    expect(constant(scene, 'MAX_RADIANCE')).toBe(6e4);
    expect(scene).toContain('min(s.emissive * (EMISSIVE_MAX_NITS * pre), vec3f(MAX_RADIANCE))');
    expect(scene).toContain('+ emission, vec3f(MAX_RADIANCE))');
  });
});

describe('fp16 safety of the RT passes', () => {
  // Every colour/moment/history store goes through fp16Safe: an Inf or NaN in one texel is reprojected into its neighbours for ever.
  const passes: [string, Record<string, string | number | boolean>][] = [
    ['rt/gi.wgsl', { GRP: 2 }], ['rt/spec.wgsl', { GRP: 2 }], ['rt/probe_update.wgsl', { GRP: 2 }],
    ['rt/probe_update.wgsl', { GRP: 2, COMPACT: true }], ['rt/probe_plan.wgsl', { GRP: 1 }],
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

describe('a-trous accumulator width', () => {
  // The shadow signal is single-channel (shadow.wgsl writes vec4f(vis, 0, 0, 0) and only .x is read back), so its accumulator is a
  // scalar. GI and SPEC genuinely consume .a (dstValue's confidence divide and the AO debug views) and must keep the rgba form.
  const src = (defines: Record<string, string | number | boolean>) => resolveShader('rt/atrous.wgsl', { GRP: 1, ITER: '0.0', OUTFMT: 'rgba16float', ...defines });

  it('accumulates a scalar for SHADOW, and still stores centre on the degenerate wSum path', () => {
    const shadow = src({ SHADOW: true });
    expect(shadow).toContain('var sum = 0.0;');
    expect(shadow).toContain('sum += s.x * w;');
    // sum.y/.z/.w were exactly 0 before (s.y/.z/.w are 0), so the vec4 form stored 0 there - except on the wSum <= 1e-6 fallback,
    // where it stored centre. Reproducing both exactly is what keeps the stored texels identical.
    expect(shadow).toContain('select(centre, vec4f(sum / wSum, 0.0, 0.0, 0.0), wSum > 1e-6)');
    expect(shadow).not.toContain('sum += s * w;');
  });

  it.each<[string, Record<string, string | number | boolean>]>([['GI', { GI: true }], ['SPEC', { SPEC: true }]])(
    'keeps the rgba accumulator for %s', (_name, defines) => {
      const other = src(defines);
      expect(other).toContain('var sum = vec4f(0.0);');
      expect(other).toContain('sum += s * w;');
      expect(other).not.toContain('sum += s.x * w;');
    });
});

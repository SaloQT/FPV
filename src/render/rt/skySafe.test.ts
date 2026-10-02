import { describe, expect, it } from 'vitest';
import { resolveShader } from '../shaderLib';

const raw = import.meta.glob('../shaders/{lighting,rt}/*.wgsl', { query: '?raw', import: 'default', eager: true }) as Record<string, string>;
const sources = new Map(Object.entries(raw).map(([k, v]) => [k.replace('../shaders/', ''), v]));
const wgsl = (dir: string): string[] => [...sources.keys()].filter((k) => k.startsWith(`${dir}/`));

const constant = (src: string, name: string): number => {
  const m = src.match(new RegExp(`const ${name}\\s*:\\s*f32\\s*=\\s*([-0-9.eE+]+);`));
  if (!m) throw new Error(`const ${name} not found`);
  return Number(m[1]);
};

describe('sky-view LUT lookups in the lighting and RT shaders', () => {
  // The sky-view LUT is rgba16float in un-exposed nits: the aureole of a low sun exceeds 65504 and the texel stores Inf; a bilinear tap that
  // weights it by 0 is NaN. Every lookup in the lighting / RT passes must go through skyNits() / finiteNits().
  const files = [...wgsl('lighting'), ...wgsl('rt')].filter((f) => f !== 'lighting/sky_safe.wgsl');

  it.each(files)('%s never reads sampleSkyView() unguarded', (path) => {
    const src = sources.get(path)!;
    for (const line of src.split('\n')) {
      if (!line.includes('sampleSkyView(') || line.trimStart().startsWith('//')) continue;
      expect(line, `${path}: ${line.trim()}`).toContain('finiteNits(sampleSkyView(');
    }
  });

  it('the guard maps anything fp16 cannot hold to a finite value below the fp16 maximum', () => {
    expect(constant(resolveShader('lighting/sky_safe.wgsl'), 'SKY_NITS_MAX')).toBeLessThan(65504);
    expect(constant(resolveShader('lighting/deferred.wgsl'), 'MAX_HDR')).toBeLessThan(65504);
    expect(constant(resolveShader('rt/rt_common.wgsl', { GRP: 2 }), 'FP16_SAFE')).toBeLessThan(65504);
  });

  it('the deferred pass guards the sky fallback, the aerial-perspective in-scatter and the final store', () => {
    for (const FALLBACK_SKY of [true, false]) {
      const src = resolveShader('lighting/deferred.wgsl', { FALLBACK_SKY });
      expect(src).toContain('finiteNits(ap.rgb)');
      expect(src).toContain('vec4f(clamp(color, vec3f(0.0), vec3f(MAX_HDR)), 1.0)');
      if (FALLBACK_SKY) expect(src).toContain('min(finiteNits(sampleSkyView(viewRayDir(uv))) * pre, vec3f(MAX_HDR))');
    }
  });

  it('the RT hit shading caps its radiance below the fp16 maximum before it is stored or averaged', () => {
    const src = resolveShader('rt/rt_scene.wgsl', { GRP: 2 });
    expect(constant(src, 'MAX_RADIANCE')).toBeLessThan(65504);
    expect(constant(src, 'MAX_PROBE_RADIANCE')).toBeLessThan(65504);
  });
});

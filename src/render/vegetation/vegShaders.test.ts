import { describe, expect, it } from 'vitest';
import { resolveShader } from '../shaderLib';
import far from '../shaders/vegetation/veg_far.wgsl?raw';
import { farToneDefines } from './treePlanFar';
import grass from '../shaders/vegetation/grass.wgsl?raw';
import { VARIANTS_OF, VARIANT_DEFS } from './variants';

const number = (src: string, name: string): number => {
  const m = src.match(new RegExp(`const ${name} : f32 = ([0-9.]+);`));
  if (!m) throw new Error(`const ${name} not found`);
  return Number(m[1]);
};

describe('veg_far.wgsl', () => {
  it('resolves its includes with no duplicate functions', () => {
    const src = resolveShader('vegetation/veg_far.wgsl', farToneDefines());
    expect(src).not.toMatch(/^\s*#(include|ifdef|ifndef|else|endif)/m);
    const names = [...src.matchAll(/^fn\s+(\w+)/gm)].map((m) => m[1]);
    expect(names.filter((n, i) => names.indexOf(n) !== i)).toEqual([]);
  });

  it('takes the leaf tone and translucency of each species from the variant table: the mean of its variants', () => {
    const groups = [VARIANTS_OF.spruce, VARIANTS_OF.pine, VARIANTS_OF.oak, VARIANTS_OF.birch];
    const defines = farToneDefines();
    groups.forEach((variants, k) => {
      expect(far).toContain('${TONE' + k + '}');
      const got = defines['TONE' + k].split(',').map(Number);
      const defs = variants.map((v) => VARIANT_DEFS[v]);
      const mean = (f: (d: (typeof defs)[number]) => number): number => defs.reduce((t, d) => t + f(d), 0) / defs.length;
      for (let c = 0; c < 3; c++) expect(got[c]).toBeCloseTo(mean((d) => d.tone[c]), 4);
      expect(got[3]).toBeCloseTo(mean((d) => d.translucency), 4);
    });
  });

  it('fades in over the band the real trees fade out in', () => {
    const tree = resolveShader('vegetation/tree.wgsl', { LOD: 2 });
    expect(tree).toContain('smoothstep(0.86 * vp.tree.y, vp.tree.y, d)');
    expect(number(far, 'FADE_START')).toBe(0.86);
  });
});

describe('grass.wgsl shading of thin blades', () => {
  it('keeps the translucency and the grazing roughness within the values that stay stable under TAA', () => {
    expect(number(grass, 'TRANSLUCENCY')).toBeLessThanOrEqual(0.5);
    expect(number(grass, 'GRAZE_ROUGH')).toBe(1);
    expect(number(grass, 'THIN_PX')).toBeGreaterThan(2 * number(grass, 'MIN_HALF_PX'));
  });

  it('draws a blade narrower than the pixel floor on only the share of its pixels it really covers', () => {
    expect(grass).toContain('in.cover.x < 1.0');
    expect(grass).toContain('saturate1(trueHw / hw)');
  });
});

describe('grass.wgsl flower heads', () => {
  const fn = (name: string): string => {
    const start = grass.indexOf(`fn ${name}(`);
    return grass.slice(start, grass.indexOf('\n}\n', start));
  };

  it('keeps head sizes at real flower scale: 1.2 to 4 cm across', () => {
    const radii = [...fn('headRadius').matchAll(/return ([0-9.]+) \+ ([0-9.]+) \* u;/g)].map((m) => [Number(m[1]), Number(m[1]) + Number(m[2])]);
    expect(radii.length).toBe(4);
    for (const [lo, hi] of radii) {
      expect(2 * lo).toBeGreaterThanOrEqual(0.012);
      expect(2 * hi).toBeLessThanOrEqual(0.04);
    }
  });

  it('uses petal reflectances of a real flower, never paper white (every head colour channel at most 0.6)', () => {
    const channels = [...fn('headColour').matchAll(/vec3f\(([0-9.]+), ([0-9.]+), ([0-9.]+)\)/g)].flatMap((m) => [m[1], m[2], m[3]].map(Number));
    expect(channels.length).toBeGreaterThanOrEqual(12);
    expect(Math.max(...channels)).toBeLessThanOrEqual(0.6);
  });

  it('shades a head from its position on the disc and makes sub-pixel heads share the blade coverage dither', () => {
    expect(grass).toContain('headColour(in.hcode, in.head.xy, in.head.z');
    expect(grass).toContain('cover = sq(R / Rd)');
  });
});

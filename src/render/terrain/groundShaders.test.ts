import { describe, expect, it } from 'vitest';
import { resolveShader } from '../shaderLib';
import palette from '../shaders/terrain/ground_palette.wgsl?raw';
import gbuffer from '../shaders/terrain/gbuffer.wgsl?raw';
import grass from '../shaders/vegetation/grass.wgsl?raw';

const lum = (c: number[]): number => 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
const vec = (s: string): number[] => s.split(',').map((x) => Number(x.trim()));

// Layer ids of ground_palette.wgsl and the broadband albedo (luminance) each must stay inside.
const LAYER_RANGE: Record<string, [number, number]> = {
  grass: [0.095, 0.25], hay: [0.2, 0.35], dirt: [0.1, 0.25], gravel: [0.15, 0.3], rock: [0.15, 0.3], sand: [0.2, 0.4], snow: [0.6, 0.9], loam: [0.04, 0.25],
};
const LAYER_NAMES = ['grass', 'hay', 'dirt', 'gravel', 'rock', 'sand', 'snow', 'loam'];

function layerColors(): number[][] {
  const body = palette.slice(palette.indexOf('fn glBaseColor'), palette.indexOf('fn glRoughness'));
  const out: number[][] = [];
  for (const m of body.matchAll(/(?:case \d+|default): \{ return vec3f\(([^)]*)\); \}/g)) out.push(vec(m[1]));
  return out;
}

describe('ground palette', () => {
  it('keeps every layer albedo in its measured physical range, nothing pale', () => {
    const colors = layerColors();
    expect(colors).toHaveLength(LAYER_NAMES.length);
    colors.forEach((c, i) => {
      const [lo, hi] = LAYER_RANGE[LAYER_NAMES[i]];
      expect(lum(c), LAYER_NAMES[i]).toBeGreaterThanOrEqual(lo);
      expect(lum(c), LAYER_NAMES[i]).toBeLessThanOrEqual(hi);
      for (const v of c) expect(v).toBeLessThanOrEqual(0.9);
    });
  });

  it('keeps the grass tints between living turf and straw', () => {
    const tints = [...palette.matchAll(/const GL_GRASS_(\w+) : vec3f = vec3f\(([^)]*)\);/g)].map((m) => ({ name: m[1], c: vec(m[2]) }));
    expect(tints.map((t) => t.name)).toEqual(['LUSH', 'YELLOW', 'CLOVER', 'DRY']);
    for (const t of tints) {
      expect(lum(t.c), t.name).toBeGreaterThanOrEqual(0.07);
      expect(lum(t.c), t.name).toBeLessThanOrEqual(0.26);
    }
    expect(lum(tints[3].c)).toBeGreaterThan(lum(tints[0].c) * 1.5);
  });

  it('keeps soil brown rather than pink or orange: red leads green by less than 1.5x', () => {
    const dirt = layerColors()[2];
    expect(dirt[0] / dirt[1]).toBeLessThan(1.5);
    expect(dirt[0]).toBeGreaterThan(dirt[2]);
  });
});

describe('G-buffer motion vectors', () => {
  it('sends the static terrain path through the same reprojection as animated blades', () => {
    expect(gbuffer).toMatch(/fn motionVector\(w : vec3f\) -> vec2f \{ return motionVectorPrev\(w, w\); \}/);
    expect(gbuffer).toContain('frame.prevViewProj * vec4f(wPrev, 1.0)');
    expect(gbuffer).toContain('frame.viewProjUnjittered * vec4f(w, 1.0)');
  });

  it('reprojects grass from its previous-frame wind pose, not from the current one', () => {
    expect(grass).toMatch(/o\.motion = motionVectorPrev\(world, world \+ \(prevCentre - centre\)\)/);
    expect(grass).toContain('time - frame.params.x');
  });
});

describe('ground and grass shader assembly', () => {
  const entries: [string, Record<string, string | number | boolean>][] = [
    ['terrain/terrain.wgsl', {}],
    ['terrain/water.wgsl', {}],
    ['terrain/detail_gen.wgsl', {}],
    ['vegetation/grass.wgsl', { NSEG: 7, HAS_TIP: true }],
    ['vegetation/grass.wgsl', { NSEG: 1, HAS_TIP: false }],
    ['vegetation/grass_cull.wgsl', {}],
    ['vegetation/grass_finalize.wgsl', {}],
  ];

  it.each(entries)('%s resolves its includes with no duplicate functions', (path, defines) => {
    const src = resolveShader(path, defines);
    expect(src).not.toMatch(/^\s*#(include|ifdef|ifndef|else|endif)/m);
    const names = [...src.matchAll(/^fn\s+(\w+)/gm)].map((m) => m[1]);
    expect(names.filter((n, i) => names.indexOf(n) !== i)).toEqual([]);
  });
});

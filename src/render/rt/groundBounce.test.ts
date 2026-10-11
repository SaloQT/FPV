import { describe, expect, it } from 'vitest';
import { resolveShader } from '../shaderLib';

const nodeFs = (globalThis as unknown as { process: { getBuiltinModule(id: string): unknown } }).process
  .getBuiltinModule('node:fs') as { readFileSync(path: URL): Uint8Array };

const read = (path: string): string => new TextDecoder().decode(nodeFs.readFileSync(new URL(`../shaders/${path}`, import.meta.url)));

const palette = read('terrain/ground_palette.wgsl');
const layer = (id: number): number[] =>
  (palette.match(new RegExp(`case ${id}: \\{ return vec3f\\(([^)]*)\\); \\}`))?.[1] ?? '').split(',').map(Number);
const lum = (c: number[]): number => 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];

// The ground a GI or probe ray lands on is what bounces light onto everything near it. It used to be a soil-driven guess that gave deep-soil
// forest floor (0.22, 0.16, 0.10): three times redder and twice as bright as the olive sward the raster draws there, and with blue sky
// through the crowns it lit shaded bark magenta.
describe('ray-traced ground bounce', () => {
  const rtScene = read('rt/rt_scene.wgsl');

  it('takes its colours from the ground palette the terrain shader uses', () => {
    expect(rtScene).toContain('#include "terrain/ground_palette.wgsl"');
    expect(rtScene).toContain('glBaseColor(GL_GRASS)');
    expect(rtScene).toContain('glBaseColor(GL_GRAVEL)');
    expect(rtScene).toContain('glBaseColor(GL_DIRT)');
    expect(rtScene).toContain('glBaseColor(GL_ROCK)');
    expect(rtScene).toMatch(/let alb = terrainGroundAlbedo\(p\.y, n\.y, maps\)/);
  });

  it('bounces olive-green light off a sward: green ahead of red, little blue, living-grass brightness', () => {
    const sward = layer(0);
    expect(sward).toHaveLength(3);
    expect(sward[1]).toBeGreaterThan(sward[0] * 1.2);
    expect(sward[0]).toBeGreaterThan(sward[2] * 1.5);
    expect(lum(sward)).toBeGreaterThan(0.08);
    expect(lum(sward)).toBeLessThan(0.14);
  });

  it('keeps soil and rock darker and less red than the old forest-floor guess', () => {
    const old = [0.25, 0.18, 0.11];
    for (const c of [layer(2), layer(4)]) {
      expect(c).toHaveLength(3);
      expect(c[0] / c[1]).toBeLessThan(old[0] / old[1]);
      expect(lum(c)).toBeLessThan(lum(old));
    }
  });

  it('compiles into every pass that shades ray hits', () => {
    for (const path of ['rt/gi.wgsl', 'rt/probe_update.wgsl', 'rt/spec.wgsl']) {
      const src = resolveShader(path, { GRP: 2 });
      expect(src).toContain('fn terrainGroundAlbedo(');
      expect(src.match(/fn glBaseColor\(/g)).toHaveLength(1);
    }
  });
});

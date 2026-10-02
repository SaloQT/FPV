import { describe, expect, it } from 'vitest';
import type { AstroState, CameraState } from '../../contracts';
import { FRAME_OFFSETS, FrameUniforms, type FrameUniformInput } from '../frameUniforms';
import { resolveShader } from '../shaderLib';
import palette from '../shaders/terrain/ground_palette.wgsl?raw';
import gbuffer from '../shaders/terrain/gbuffer.wgsl?raw';
import grassTone from '../shaders/terrain/grass_tone.wgsl?raw';
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

const rad = (d: number): number => (d * Math.PI) / 180;
const UP_SUN: AstroState = {
  julianDate: 2461000, sunDir: [0, 1, 0], moonDir: [0, -1, 0], sunElevation: Math.PI / 2, moonElevation: -Math.PI / 2,
  moonIlluminatedFraction: 0.5, moonPhaseAngle: 0, equatorialToWorld: [1, 2, 3, 4, 5, 6, 7, 8, 9], planets: [],
};

function frameInput(pos: [number, number, number], frameIndex: number): FrameUniformInput {
  const camera: CameraState = { pos, quat: [0, 0, 0, 1], fovY: rad(90), aspect: 16 / 9, near: 0.05, far: 1e5 };
  return { camera, astro: UP_SUN, dt: 1 / 60, time: 3, frameIndex, width: 960, height: 540, preExposure: 0.01, qualityFlags: 1, observerAltitudeM: 100, jitter: true, terrain: null };
}

// The same arithmetic as motionVectorPrev in gbuffer.wgsl, on the uniforms the renderer actually uploads.
function motionVectorPrev(f32: Float32Array, w: number[], wPrev: number[]): [number, number] {
  const project = (offset: number, p: number[]): [number, number] => {
    const c = [0, 1, 2, 3].map((row) => [0, 1, 2, 3].reduce((s, col) => s + f32[offset + col * 4 + row] * [p[0], p[1], p[2], 1][col], 0));
    const cw = Math.max(c[3], 1e-3);
    return [(c[0] / cw) * 0.5 + 0.5, 0.5 - (c[1] / cw) * 0.5];
  };
  const prev = project(FRAME_OFFSETS.prevViewProj, wPrev), cur = project(FRAME_OFFSETS.viewProjUnjittered, w);
  return [prev[0] - cur[0], prev[1] - cur[1]];
}

describe('static-world motion vectors on the real frame uniforms', () => {
  const terrainPoints = [[3, -1.5, -12], [-40, 2, -80], [250, 9, -900], [0.4, -2, -1.1]];

  it('are exactly zero for a static camera whatever the TAA jitter does', () => {
    const fu = new FrameUniforms();
    fu.write(frameInput([10, 5, 20], 0));
    fu.write(frameInput([10, 5, 20], 1));
    for (const p of terrainPoints) {
      const mv = motionVectorPrev(fu.f32, p, p);
      expect(mv[0]).toBe(0);
      expect(mv[1]).toBe(0);
    }
  });

  it('follow the camera motion: a 0.1 m sidestep moves a point 10 m ahead by 0.1 / (10 tan(fov/2) aspect) / 2 in uv', () => {
    const fu = new FrameUniforms();
    fu.write(frameInput([0, 0, 0], 0));
    fu.write(frameInput([0.1, 0, 0], 1));
    const mv = motionVectorPrev(fu.f32, [0, 0, -10], [0, 0, -10]);
    expect(mv[0]).toBeCloseTo(0.1 / (10 * Math.tan(rad(45)) * (16 / 9)) / 2, 6);
    expect(mv[1]).toBeCloseTo(0, 7);
  });

  it('give an animated blade the velocity of its own bend only, zero when the pose did not change', () => {
    const fu = new FrameUniforms();
    fu.write(frameInput([0, 1, 0], 0));
    fu.write(frameInput([0, 1, 0], 1));
    expect(motionVectorPrev(fu.f32, [0.5, 0.2, -3], [0.5, 0.2, -3])).toEqual([0, 0]);
    const mv = motionVectorPrev(fu.f32, [0.5, 0.2, -3], [0.46, 0.2, -3]);
    expect(mv[0]).toBeLessThan(0);
    expect(Math.abs(mv[1])).toBeLessThan(1e-9);
  });
});

describe('ground and grass shader assembly', () => {
  const entries: [string, Record<string, string | number | boolean>][] = [
    ['terrain/terrain.wgsl', {}],
    ['terrain/water.wgsl', {}],
    ['terrain/detail_gen.wgsl', {}],
    ['terrain/grass_tone.wgsl', {}],
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

describe('shared grass tone', () => {
  it('has no bindings, so the vertex shader of the blades and the terrain fragment shader can both include it', () => {
    expect(grassTone).not.toMatch(/@group|@binding|var</);
    expect(resolveShader('terrain/grass_tone.wgsl')).toMatch(/^fn grassStreak/m);
  });

  it('is evaluated by the terrain shader once, for the grass and hay layers only', () => {
    const terrain = resolveShader('terrain/terrain.wgsl');
    expect(terrain.match(/= grassClumpTone\(/g)).toHaveLength(1);
    expect(terrain).toContain('if (lid[k] <= GL_HAY)');
    expect(terrain).toContain('tone *= turfTone * (1.0 + GT_STREAK_AMP * streak);');
  });
});

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { FrameInfo, RenderContext } from '../contracts';
import { SkyPass } from './skyPass';
import { MAX_PLANETS, STAR_FLOATS, packPlanets, type PackedStars } from './starData';

function setup() {
  const writes: { label: string; bits: Uint32Array }[] = [];
  const object = (desc: { label?: string } = {}) => ({ ...desc, destroy() {}, createView: () => ({}) });
  const device = {
    createBindGroupLayout: object, createPipelineLayout: object, createRenderPipeline: object, createBuffer: object,
    createTexture: object, createBindGroup: object,
    queue: { writeBuffer(buffer: { label: string }, _offset: number, data: Float32Array, start = 0, size = data.length) {
      writes.push({ label: buffer.label, bits: new Uint32Array(data.buffer, data.byteOffset + start * 4, size).slice() });
    } },
  } as unknown as GPUDevice;
  const rc = { device, frame: { layout: {} }, world: { layout: {} }, module: () => ({}) } as unknown as RenderContext;
  const sky = new SkyPass(rc, {} as GPUBuffer);
  const planets = [{ magnitude: -2, dir: [1, 0, 0], color: [1, 1, 1] }];
  const frame = { astro: { planets } } as unknown as FrameInfo;
  const uploads = () => writes.filter(w => w.label === 'planets');
  const check = () => {
    const expected = new Float32Array(MAX_PLANETS * STAR_FLOATS);
    const count = packPlanets(planets, expected);
    if (count > 0) expect(uploads().at(-1)?.bits).toEqual(new Uint32Array(expected.buffer, 0, count * STAR_FLOATS));
  };
  const drawCounts = () => {
    const draws: number[][] = [];
    const pass = { setPipeline() {}, setBindGroup() {}, setVertexBuffer() {}, draw(...args: number[]) { draws.push(args); } } as unknown as GPURenderPassEncoder;
    sky.encode(pass, object() as unknown as GPUTexture, object() as unknown as GPUTexture, {} as GPUTextureView);
    return draws;
  };
  return { sky, planets, frame, uploads, check, drawCounts };
}

function stars(magnitudes: number[]): PackedStars {
  return { data: new Float32Array(magnitudes.length * STAR_FLOATS), count: magnitudes.length, magnitudes: new Float32Array(magnitudes) };
}

describe('sky GPU uploads', () => {
  beforeEach(() => {
    vi.stubGlobal('GPUShaderStage', { VERTEX: 1, FRAGMENT: 2 });
    vi.stubGlobal('GPUBufferUsage', { VERTEX: 32, COPY_DST: 8 });
    vi.stubGlobal('GPUTextureUsage', { TEXTURE_BINDING: 4, COPY_DST: 2 });
  });
  afterEach(() => vi.unstubAllGlobals());

  it('initializes each buffer and skips identical packed payloads on later frames', () => {
    const s = setup();
    for (let i = 0; i < 240; i++) { s.frame.time = i / 240; s.sky.update(s.frame, 8); s.check(); }
    expect(s.uploads()).toHaveLength(1);
    const replacement = setup();
    replacement.sky.update(replacement.frame, 8);
    replacement.check();
    expect(replacement.uploads()).toHaveLength(1);
  });

  it('observes mutable same-object planet data and compares float32 bits including signed zero and NaN', () => {
    const s = setup();
    for (const x of [1, 1 + 1e-12, 0, -0, NaN, NaN, Infinity, -Infinity, 1]) {
      s.planets[0].dir[0] = x;
      s.sky.update(s.frame, 8);
      s.check();
    }
    expect(s.uploads()).toHaveLength(7);
    s.planets[0].color[1] = 2;
    s.sky.update(s.frame, 8); s.check();
    s.planets[0].magnitude = 4;
    s.sky.update(s.frame, 8); s.check();
    expect(s.uploads()).toHaveLength(9);
  });

  it('handles count growth, shrinkage, empty lists, and repopulation', () => {
    const s = setup();
    s.sky.update(s.frame, 8); s.check();
    for (let i = 0; i < MAX_PLANETS + 2; i++) s.planets.push({ magnitude: i, dir: [i, 1, 0], color: [1, 2, 3] });
    s.sky.update(s.frame, 8); s.check();
    expect(s.drawCounts().at(-1)).toEqual([6, MAX_PLANETS]);
    s.planets.length = 1;
    s.sky.update(s.frame, 8); s.check();
    s.planets.length = 0;
    s.sky.update(s.frame, 8);
    expect(s.drawCounts()).toEqual([[3]]);
    expect(s.uploads()).toHaveLength(3);
    s.planets.push({ magnitude: -2, dir: [1, 0, 0], color: [1, 1, 1] });
    s.sky.update(s.frame, 8); s.check();
    expect(s.uploads()).toHaveLength(4);
  });

  it('refreshes the star prefix after limit changes and each catalogue replacement or removal', () => {
    const s = setup();
    s.planets.length = 0;
    const catalog = stars([-1, 2, 6.5, 7, 8]);
    s.sky.setStars(catalog);
    for (const [limit, count] of [[6.5, 3], [6.5, 3], [8, 5], [0, 1], [7, 4]]) {
      s.sky.update(s.frame, limit);
      expect(s.drawCounts()).toEqual([[3], [6, count]]);
    }
    s.sky.setStars(stars([1])); s.sky.update(s.frame, 7);
    expect(s.drawCounts()).toEqual([[3], [6, 1]]);
    s.sky.setStars(null); s.sky.update(s.frame, 7);
    expect(s.drawCounts()).toEqual([[3]]);
    s.sky.setStars(catalog); s.sky.update(s.frame, 7);
    expect(s.drawCounts()).toEqual([[3], [6, 4]]);
    catalog.magnitudes[3] = 7.5;
    s.sky.update(s.frame, 7);
    expect(s.drawCounts()).toEqual([[3], [6, 3]]);
  });
});

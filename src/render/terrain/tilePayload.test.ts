import { describe, expect, it, vi } from 'vitest';
import { Clipmap, Frustum, MAX_TILES, TILE_FLOATS } from './clipmap';
import { TilePayload } from './tilePayload';
import { WaterMask } from './waterMask';

// Original terrain module packing, intentionally independent of the cache implementation.
function original(tiles: Float32Array, count: number, x: number, z: number, mask: WaterMask | null, data: Float32Array) {
  const copy = (dst: number, src: number) => {
    for (let k = 0; k < TILE_FLOATS; k++) data[dst * TILE_FLOATS + k] = tiles[src * TILE_FLOATS + k];
  };
  for (let i = 0; i < count; i++) copy(i, i);
  let water = 0;
  if (mask?.enabled) for (let i = 0; i < count; i++) {
    const o = i * TILE_FLOATS, spacing = tiles[o + 4];
    const x0 = x + tiles[o] * spacing, z0 = z + tiles[o + 1] * spacing;
    if (mask.regionBelow(x0, z0, x0 + tiles[o + 2] * spacing, z0 + tiles[o + 3] * spacing)) copy(count + water++, i);
  }
  let quads = 0;
  for (let i = 0; i < water; i++) quads += data[(count + i) * TILE_FLOATS + 2] * data[(count + i) * TILE_FLOATS + 3];
  return { water, quads };
}
function makeMask(n = 128, wet = true) {
  const height = new Float32Array(n * n);
  for (let i = 0; i < height.length; i++) height[i] = 20 + 20 * Math.sin(i * 0.017);
  return new WaterMask(height, n, 4, [-256, -256], 0, 40, wet ? 10 : -1);
}
const bits = (v: Float32Array, size: number) => new Uint32Array(v.buffer, v.byteOffset, size);

describe('exact tile payload cache', () => {
  it('matches the complete active payload, water count and quad count through camera, frustum, scene and quality changes', () => {
    const clip = new Clipmap(), frustum = new Frustum(), cache = new TilePayload(clip.tiles);
    const reference = new Float32Array(2 * MAX_TILES * TILE_FLOATS);
    let mask: WaterMask | null = makeMask();
    let origin = -256;
    let previous = new Uint32Array(0), previousCount = -1, invalid = true;
    for (let frame = 0; frame < 1600; frame++) {
      if (frame % 200 === 0) {
        mask = frame % 600 === 0 ? makeMask() : frame % 600 === 200 ? makeMask(128, false) : null;
        origin = frame % 400 === 0 ? -256 : 32;
        cache.invalidate(); invalid = true;
      }
      const moving = frame % 4 === 0;
      const x = moving ? Math.sin(frame) * 600 : 10, z = moving ? Math.cos(frame) * 800 : 20;
      const angle = moving ? frame * 0.13 : 0;
      frustum.setFromCamera([x, 30, z], [0, Math.sin(angle / 2), 0, Math.cos(angle / 2)], 1.2, 1.7);
      const count = clip.build(x, z, origin, origin, 4, 1 + Math.floor(frame / 23) % 10, 0, 40, frame % 7 ? frustum : null);
      const source = bits(clip.tiles, count * TILE_FLOATS);
      const expectedChange = invalid || count !== previousCount || source.some((v, i) => v !== previous[i]);
      expect(cache.update(count, origin, origin, mask)).toBe(expectedChange);
      const old = original(clip.tiles, count, origin, origin, mask, reference);
      expect(cache.waterCount).toBe(old.water);
      expect(cache.waterQuads).toBe(old.quads);
      expect(bits(cache.data, (count + old.water) * TILE_FLOATS)).toEqual(bits(reference, (count + old.water) * TILE_FLOATS));
      previous = source.slice(); previousCount = count; invalid = false;
      expect(cache.update(count, origin, origin, mask)).toBe(false);
    }
  });

  it('keys identical tile bytes on live origin, mask identity and enabled state', () => {
    const source = new Float32Array(MAX_TILES * TILE_FLOATS), cache = new TilePayload(source);
    source.set([0, 0, 16, 16, 4, 0, 0, 0]);
    const mask = makeMask();
    const region = vi.spyOn(mask, 'regionBelow').mockImplementation(x => x > 0);
    expect(cache.update(1, 0, 0, mask)).toBe(true);
    expect(cache.waterCount).toBe(0);
    expect(cache.update(1, 1, 0, mask)).toBe(true);
    expect(cache.waterCount).toBe(1);
    expect(cache.update(1, 1, -0, mask)).toBe(true);
    expect(cache.update(1, 1, -0, mask)).toBe(false);
    Object.defineProperty(mask, 'enabled', { value: false, configurable: true });
    expect(cache.update(1, 1, -0, mask)).toBe(true);
    expect(cache.waterCount).toBe(0);
    Object.defineProperty(mask, 'enabled', { value: true, configurable: true });
    expect(cache.update(1, 1, -0, mask)).toBe(true);
    expect(cache.waterCount).toBe(1);
    const other = makeMask();
    vi.spyOn(other, 'regionBelow').mockReturnValue(false);
    expect(cache.update(1, 1, -0, other)).toBe(true);
    expect(cache.waterCount).toBe(0);
    expect(region).toHaveBeenCalled();
  });

  it('does not alias reused scratch data, distinguishes signed zero and ignores inactive scratch tail', () => {
    const source = new Float32Array(MAX_TILES * TILE_FLOATS), cache = new TilePayload(source);
    const mask = makeMask(), region = vi.spyOn(mask, 'regionBelow').mockReturnValue(true);
    source.set([0, 0, 16, 16, 4, 0, 0, 0]);
    expect(cache.update(1, 0, 0, mask)).toBe(true);
    region.mockClear();
    source[100] = 42;
    expect(cache.update(1, 0, 0, mask)).toBe(false);
    expect(region).not.toHaveBeenCalled();
    source[0] = -0;
    expect(Object.is(cache.data[0], 0)).toBe(true);
    expect(cache.update(1, 0, 0, mask)).toBe(true);
    expect(Object.is(cache.data[0], -0)).toBe(true);
    expect(Object.is(cache.data[8], -0)).toBe(true);
    expect(cache.update(0, 0, 0, mask)).toBe(true);
    expect(cache.waterCount).toBe(0);
    expect(cache.waterQuads).toBe(0);
    expect(cache.update(0, 0, 0, mask)).toBe(false);
    cache.invalidate();
    expect(cache.update(0, 0, 0, mask)).toBe(true);
    expect(cache.update(1, 0, 0, mask)).toBe(true);
    cache.invalidate();
    expect(cache.update(1, 0, 0, null)).toBe(true);
    expect(cache.waterCount).toBe(0);
  });
});

vi.mock('./detailTextures', () => ({ createDetailTextures: () => ({ viewA: {}, viewB: {}, sampler: {}, destroy() {} }) }));
import { createTerrainModule } from './index';
import { levelCount } from './clipmap';
import type { FrameInfo, RenderContext, SceneData } from '../contracts';

it('matches active mock-GPU bytes and stats every frame, preserving parameter writes and reuploading after scene/init', () => {
  vi.stubGlobal('GPUBufferUsage', { STORAGE: 1, COPY_DST: 2, UNIFORM: 4, INDEX: 8 });
  vi.stubGlobal('GPUShaderStage', { VERTEX: 1, FRAGMENT: 2 });
  type Buffer = { label: string; data: Uint8Array; destroy(): void; getMappedRange(): ArrayBuffer; unmap(): void };
  let gpu: Buffer | undefined, tileWrites = 0, paramWrites = 0;
  const device = {
    createBuffer(desc: { label: string; size: number }) {
      const data = new Uint8Array(desc.size);
      const b = { label: desc.label, data, destroy() {}, getMappedRange: () => data.buffer, unmap() {} };
      if (desc.label === 'terrain-tiles') gpu = b;
      return b;
    },
    createBindGroupLayout: () => ({}), createBindGroup: () => ({}), createPipelineLayout: () => ({}), createRenderPipeline: () => ({}),
    queue: { writeBuffer(b: Buffer, offset: number, data: Float32Array, start = 0, size = data.length) {
      // WebGPU TypedArray offsets and sizes are in elements and copy bytes immediately.
      b.data.set(new Uint8Array(data.buffer, data.byteOffset + start * 4, size * 4), offset);
      if (b.label === 'terrain-tiles') tileWrites++;
      if (b.label === 'terrain-params') paramWrites++;
    } },
  };
  const rc = { device, frame: { layout: {} }, world: { layout: {} }, module: () => ({}), quality: { terrainViewDistance: 2400, detailOctaves: 5, tier: 'high' } } as unknown as RenderContext;
  const height = Float32Array.from({ length: 128 * 128 }, (_, i) => 20 + 20 * Math.sin(i * .03));
  const scene = { terrain: { height, resolution: 128, cellSize: 4, origin: [-256, -256], minHeight: 0, maxHeight: 40, waterLevel: 10 } } as unknown as SceneData;
  const frame = { time: 0, camera: { pos: [0, 30, 0], quat: [0, 0, 0, 1], fovY: 1.2, aspect: 1.7 } } as unknown as FrameInfo;
  const mod = createTerrainModule(); mod.init!(rc); mod.setScene!(rc, scene);
  const clip = new Clipmap(), frustum = new Frustum(), ref = new Float32Array(2 * MAX_TILES * TILE_FLOATS);
  let referenceMask: WaterMask;
  const renew = () => { const t = scene.terrain; referenceMask = new WaterMask(t.height, t.resolution, t.cellSize, t.origin, t.minHeight, t.maxHeight, t.waterLevel); };
  renew();
  for (let i = 0; i < 180; i++) {
    const t = scene.terrain, cam = frame.camera;
    if (i === 20) { t.waterLevel = -1; mod.setScene!(rc, scene); renew(); }
    if (i === 40) { t.waterLevel = 50; mod.setScene!(rc, scene); renew(); }
    if (i === 60) { t.waterLevel = 10; mod.setScene!(rc, scene); renew(); }
    if (i === 80) { t.origin[0] += 4; } // Live origin can change without replacing the scene or mask.
    if (i === 100) rc.quality.terrainViewDistance = 500;
    if (i === 120) { mod.destroy!(); mod.init!(rc); }
    if (i === 140) rc.quality.terrainViewDistance = 5000;
    if (i > 150) {
      cam.pos[0] += 37; cam.pos[2] -= 9;
      cam.quat[1] = Math.sin(i / 10); cam.quat[3] = Math.cos(i / 10);
      cam.fovY = 0.5 + (i % 4) * .5; cam.aspect = .8 + (i % 3);
    }
    frame.time = i / 60;
    const oldTiles = tileWrites, oldParams = paramWrites;
    mod.update!(rc, frame);
    expect(paramWrites).toBe(oldParams + 1);
    if ([0, 20, 40, 60, 80, 100, 120, 140].includes(i)) expect(tileWrites).toBe(oldTiles + 1);
    if (i > 0 && i < 150 && ![20,40,60,80,100,120,140].includes(i)) expect(tileWrites).toBe(oldTiles);
    frustum.setFromCamera(cam.pos, cam.quat, cam.fovY, cam.aspect);
    const levels = levelCount(t.cellSize, rc.quality.terrainViewDistance);
    const count = clip.build(cam.pos[0],cam.pos[2],t.origin[0],t.origin[1],t.cellSize,levels,t.minHeight,t.maxHeight,frustum);
    const packed = original(clip.tiles,count,t.origin[0],t.origin[1],referenceMask!,ref);
    expect(gpu!.data.slice(0,(count+packed.water)*TILE_FLOATS*4)).toEqual(new Uint8Array(ref.buffer,0,(count+packed.water)*TILE_FLOATS*4));
    expect(mod.stats).toEqual({ levels, terrainTiles: count, waterTiles: packed.water, culledTiles: clip.stats.culledTiles,
      vertices: (count+packed.water)*289, triangles: (clip.stats.quads+packed.quads)*2, draws: (count>0?1:0)+(packed.water>0?1:0) });
  }
  mod.destroy!(); vi.unstubAllGlobals();
});

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_SETTINGS } from '../../contracts';
import type { RenderContext, SceneData } from '../contracts';
import { resolveQuality } from '../qualityPresets';
import * as colliders from './colliders';
import { GrassPipelines, GrassSystem } from './grass';
import { createVegetationModule } from './index';
import { packInstances } from './instanceData';
import * as placement from './placement';
import { ARGS_WORDS, TreeAssets } from './treeAssets';
import * as farPlacement from './treePlanFar';
import { TreeSystem } from './treeSystem';
import { DRAW_COUNT, VARIANT_DEFS, type VariantAsset } from './variants';

type Command = (string | number)[];
type Named = { label: string };
function instances(count: number): placement.InstanceSet {
  return {
    count, pos: new Float32Array(count * 3), scale: new Float32Array(count).fill(1), yaw: new Float32Array(count),
    variant: new Uint8Array(count), tint: new Uint32Array(count), nrm: new Uint32Array(count), pathDist: new Float32Array(count),
  };
}
function assets(): TreeAssets {
  return {
    variants: VARIANT_DEFS.map(def => ({ def, centreY: 1, radius: 2, height: def.height }) as VariantAsset),
    argsTemplate: new Uint32Array(DRAW_COUNT * ARGS_WORDS),
    cullPipe: { label: 'tree-cull' }, finalizePipe: { label: 'tree-finalize' },
    cullLayout: {}, finalizeLayout: {}, drawLayout: {}, atlasView: {}, atlasDataView: {}, destroy() {},
  } as unknown as TreeAssets;
}
function fixture() {
  const commands: Command[] = [];
  const mappings: (() => void)[] = [];
  const device = {
    limits: { maxStorageBufferBindingSize: 1 << 30, maxBufferSize: 1 << 30 },
    queue: { writeBuffer() {}, writeTexture() {} },
    createBuffer(d: GPUBufferDescriptor) {
      return {
        label: d.label!, destroy() {}, unmap() {}, getMappedRange: () => new ArrayBuffer(d.size),
        mapAsync: vi.fn(() => new Promise<void>(resolve => mappings.push(resolve))),
      };
    },
    createBindGroup: (d: GPUBindGroupDescriptor) => d,
    createBindGroupLayout: (d: GPUBindGroupLayoutDescriptor) => d,
    createPipelineLayout: (d: GPUPipelineLayoutDescriptor) => d,
    createComputePipeline: (d: GPUComputePipelineDescriptor) => d,
    createRenderPipeline: (d: GPURenderPipelineDescriptor) => d,
  };
  const rc = {
    device, quality: resolveQuality({ quality: 'low', performance240: false }), settings: DEFAULT_SETTINGS,
    frame: { group: { label: 'frame' }, layout: {} }, world: { group: { label: 'world' }, layout: {} },
    rt: { setStatic() {} }, module: () => ({}),
  } as unknown as RenderContext;
  const enc = {
    clearBuffer(b: Named) { commands.push(['clear', b.label]); },
    copyBufferToBuffer(a: Named, ao: number, b: Named, bo: number, size: number) { commands.push(['copy', a.label, ao, b.label, bo, size]); },
    beginComputePass(d: GPUComputePassDescriptor) {
      commands.push(['begin', d.label!]);
      return {
        setPipeline(p: Named) { commands.push(['pipeline', p.label]); },
        setBindGroup(i: number, g: Named) { commands.push(['group', i, g.label]); },
        dispatchWorkgroups(x: number, y = 1, z = 1) { commands.push(['dispatch', x, y, z]); },
        dispatchWorkgroupsIndirect(b: Named, offset: number) { commands.push(['indirect', b.label, offset]); },
        end() { commands.push(['end']); },
      };
    },
  } as unknown as GPUCommandEncoder;
  const a = assets();
  const params = { label: 'params' } as GPUBuffer;
  const pipes = new GrassPipelines(rc);
  const systems = (count = 1, readback = false) => ({
    grass: new GrassSystem(rc, pipes, params, readback),
    trees: new TreeSystem(rc, a, params, packInstances([{ set: instances(count), count }], a.variants), readback),
  });
  return { rc, enc, commands, a, systems, mappings };
}
function commandContent(commands: Command[]) {
  return {
    clears: commands.filter(c => c[0] === 'clear'),
    dispatches: commands.filter(c => !['clear', 'begin', 'end', 'copy'].includes(String(c[0]))),
    copies: commands.filter(c => c[0] === 'copy'),
  };
}
async function moduleFixture(count = 1) {
  const f = fixture();
  vi.spyOn(TreeAssets, 'create').mockResolvedValue(f.a);
  vi.spyOn(placement, 'placeVegetation').mockReturnValue({
    plants: instances(count), rocks: instances(0), trees: count, bushes: 0, obstacleTrees: 0, plantRing: new Float32Array(count),
  });
  vi.spyOn(colliders, 'buildColliders').mockReturnValue([]);
  vi.spyOn(colliders, 'buildRtProxies').mockReturnValue([]);
  vi.spyOn(farPlacement, 'placeFarForest').mockReturnValue({ count: 0, words: new Uint32Array(), uncovered: 0 });
  const mod = createVegetationModule();
  await mod.init(f.rc);
  const scene = { terrain: { resolution: 2, cellSize: 1, origin: [0, 0] }, track: null } as SceneData;
  return { ...f, mod, scene, encode: () => mod.encodePre!(f.enc, f.rc, {} as never) };
}

describe('vegetation prepass batching', () => {
  beforeEach(() => {
    vi.stubGlobal('GPUShaderStage', { COMPUTE: 4, VERTEX: 1, FRAGMENT: 2 });
    vi.stubGlobal('GPUBufferUsage', { STORAGE: 128, UNIFORM: 64, COPY_DST: 8, COPY_SRC: 4, INDIRECT: 256, VERTEX: 32, INDEX: 16, MAP_READ: 1 });
    vi.stubGlobal('GPUMapMode', { READ: 1 });
  });
  afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });
  it('keeps standalone grass/tree encoding at the original two passes and six dispatches', () => {
    const f = fixture(), s = f.systems();
    s.grass.encodePre(f.enc, f.rc); s.trees.encodePre(f.enc, f.rc);
    expect(f.commands.filter(c => c[0] === 'begin')).toEqual([['begin', 'grass-cull'], ['begin', 'tree-cull']]);
    expect(f.commands.filter(c => c[0] === 'pipeline').map(c => c[1])).toEqual([
      'grass-patches', 'grass-fin-dispatch', 'grass-blades', 'grass-fin-draw', 'tree-cull', 'tree-finalize',
    ]);
    expect(f.commands.filter(c => c[0] === 'dispatch' || c[0] === 'indirect')).toEqual([
      ['dispatch', Math.ceil(s.grass.budget.cellsPerSide ** 2 / 64), 1, 1], ['dispatch', 1, 1, 1],
      ['indirect', 'grass-dispatch-args', 0], ['dispatch', 1, 1, 1], ['dispatch', 1, 1, 1], ['dispatch', 1, 1, 1],
    ]);
    expect(f.commands.filter(c => c[0] === 'copy')).toEqual([]);
  });
  it('records identical dispatch commands in one pass with both clears before and readbacks after it', async () => {
    const f = await moduleFixture();
    f.mod.setScene!(f.rc, f.scene);
    for (let i = 0; i < 29; i++) f.encode();
    f.commands.length = 0; f.encode();
    const batched = f.commands.slice();
    const s = f.systems(1, true);
    for (let i = 0; i < 29; i++) { s.grass.encodePre(f.enc, f.rc); s.trees.encodePre(f.enc, f.rc); }
    f.commands.length = 0;
    s.grass.encodePre(f.enc, f.rc); s.trees.encodePre(f.enc, f.rc);
    expect(commandContent(batched)).toEqual(commandContent(f.commands));
    expect(batched.filter(c => c[0] === 'begin')).toEqual([['begin', 'vegetation-cull']]);
    expect(batched.slice(0, 3)).toEqual([['clear', 'grass-counters'], ['clear', 'tree-counts'], ['begin', 'vegetation-cull']]);
    expect(batched.slice(-3).map(c => c[0])).toEqual(['end', 'copy', 'copy']);
    expect(batched.filter(c => c[0] === 'dispatch' || c[0] === 'indirect')).toHaveLength(6);
  });
  it('preserves no-scene return and standalone grass fallback for empty trees', async () => {
    const f = await moduleFixture(0);
    f.encode(); expect(f.commands).toEqual([]);
    f.mod.setScene!(f.rc, f.scene); f.encode();
    expect(f.commands.filter(c => c[0] === 'begin')).toEqual([['begin', 'grass-cull']]);
    expect(f.commands.filter(c => c[0] === 'clear')).toEqual([['clear', 'grass-counters']]);
    expect(f.commands.filter(c => c[0] === 'dispatch' || c[0] === 'indirect')).toHaveLength(4);
    const empty = f.systems(0, true).trees;
    f.commands.length = 0;
    empty.encodePre(f.enc, f.rc); empty.clearCounters(f.enc); empty.copyCounters(f.enc);
    expect(f.commands).toEqual([]);
  });
  it('keeps readback cadence and skips copies while queued or mapping', async () => {
    const f = fixture(), s = f.systems(1, true);
    const encode = () => { s.grass.encodePre(f.enc, f.rc); s.trees.encodePre(f.enc, f.rc); };
    for (let i = 0; i < 100; i++) encode();
    expect(f.commands.filter(c => c[0] === 'copy')).toHaveLength(2);
    s.grass.pollReadback(); s.trees.pollReadback(); expect(f.mappings).toHaveLength(2);
    for (let i = 0; i < 100; i++) encode();
    expect(f.commands.filter(c => c[0] === 'copy')).toHaveLength(2);
    for (const resolve of f.mappings) resolve();
    await Promise.resolve(); expect(s.grass.sampled && s.trees.sampled).toBe(true);
    for (let i = 0; i < 29; i++) encode();
    expect(f.commands.filter(c => c[0] === 'copy')).toHaveLength(2);
    encode(); expect(f.commands.filter(c => c[0] === 'copy')).toHaveLength(4);
  });
});

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { FrameInfo, RenderContext, SceneData } from '../contracts';
import { gateColour } from './materials';
import { createTrackObjects, GATE_FLOATS } from './trackObjects';

vi.mock('./trackMesh', () => ({ buildTrackMesh: () => ({ mesh: { vertices: new Float32Array(), indices: new Uint32Array() }, flags: [], strips: [] }) }));
vi.mock('./glowRibbons', () => ({ GLOW_STRIDE: 32, buildGlowMesh: () => ({ vertices: new Float32Array(), indices: new Uint32Array() }) }));
vi.mock('./trackProxies', () => ({ buildTrackProxies: () => [] }));

function setup() {
  const writes: { label: string; data: Float32Array }[] = [];
  const object = (desc: { label?: string } = {}) => ({ ...desc, destroy() {} });
  const device = {
    createBindGroupLayout: object, createPipelineLayout: object, createRenderPipeline: object, createBuffer: object, createBindGroup: object,
    queue: { writeBuffer(buffer: { label: string }, _offset: number, data: Float32Array) { writes.push({ label: buffer.label, data: new Float32Array(data) }); } },
  } as unknown as GPUDevice;
  const rc = { device, frame: { layout: {} }, world: { layout: {} }, module: () => ({}), rt: { remove() {}, setStatic() {} } } as unknown as RenderContext;
  const track = createTrackObjects(rc);
  const scene = { track: { gates: [{ index: 0 }, { index: 1 }] } } as unknown as SceneData;
  const update = (time: number) => track.update(rc, { time, dt: 1 / 60 } as FrameInfo);
  const gates = () => writes.filter((w) => w.label === 'track gates');
  track.setScene(rc, scene);
  return { track, rc, scene, writes, update, gates };
}

function expected(states: number[], flashes: number[]): Float32Array {
  const data = new Float32Array(states.length * GATE_FLOATS);
  states.forEach((state, i) => {
    data.set(gateColour(i), i * GATE_FLOATS);
    data[i * GATE_FLOATS + 4] = state;
    data[i * GATE_FLOATS + 5] = flashes[i];
  });
  return data;
}

describe('track gate GPU uploads', () => {
  beforeEach(() => {
    vi.stubGlobal('GPUShaderStage', { VERTEX: 1, FRAGMENT: 2 });
    vi.stubGlobal('GPUBufferUsage', { UNIFORM: 64, STORAGE: 128, COPY_DST: 8, VERTEX: 32, INDEX: 16 });
  });
  afterEach(() => vi.unstubAllGlobals());

  it('uploads initial data once, retaining per-frame cloth uniforms and active-gate time animation', () => {
    const s = setup();
    s.update(1);
    expect(s.gates()[0].data).toEqual(expected([0, 0], [0, 0]));
    s.track.setActiveGate(0);
    s.update(2);
    expect(s.gates().at(-1)?.data).toEqual(expected([1, 0], [0, 0]));
    for (let i = 0; i < 100; i++) s.update(3 + i / 60);
    expect(s.gates()).toHaveLength(2);
    expect(s.writes.filter((w) => w.label === 'track uniform')).toHaveLength(102);
  });

  it('matches the original packed values throughout flashes, rewinds and gate resets', () => {
    const s = setup();
    s.update(0);
    s.track.setGatePassed(0);
    const times = [1, 1.0000000001, 1.1, 1.25, 1.499, 1.5, 2, 1.25];
    for (const time of times) {
      s.update(time);
      expect(s.gates().at(-1)?.data).toEqual(expected([2, 0], [Math.min(1, Math.max(0, 1 - (time - 1) / 0.5)), 0]));
    }
    // The tiny time increment packs to the same f32; the stable post-flash frame also needs no upload.
    expect(s.gates()).toHaveLength(7);
    s.track.setActiveGate(0);
    s.update(3);
    expect(s.gates().at(-1)?.data).toEqual(expected([1, 0], [0, 0]));
  });

  it('initializes replacement gate buffers even when all packed values are unchanged', () => {
    const s = setup();
    s.update(1);
    s.track.setScene(s.rc, s.scene);
    s.update(1);
    expect(s.gates()).toHaveLength(2);
    expect(s.gates()[1].data).toEqual(s.gates()[0].data);
  });
});

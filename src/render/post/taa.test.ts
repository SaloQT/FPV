import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import taauSrc from '../shaders/post/taau.wgsl?raw';
import type { AstroState, CameraState } from '../../contracts';
import type { FrameInfo, RenderContext } from '../contracts';
import { FRAME_OFFSETS, FrameUniforms, JITTER_SEQUENCE_LENGTH, jitterNdc, type FrameUniformInput } from '../frameUniforms';
import { TAA_TUNING, createTaaStage, expectedKernelSum, historyRescale, jitterShiftPx, taaDefines, useHistory } from './taa';
import type { PostFlags, PostParams } from './types';

const W = 1280;
const H = 720;

function astro(): AstroState {
  const dir: [number, number, number] = [0, 0.8, -0.6];
  return {
    julianDate: 2461000, sunDir: dir, moonDir: dir, sunElevation: 0.9, moonElevation: 0.9, moonIlluminatedFraction: 0.5, moonPhaseAngle: 0,
    equatorialToWorld: [1, 0, 0, 0, 1, 0, 0, 0, 1], planets: [],
  };
}

function camera(): CameraState {
  return { pos: [0, 2, 0], quat: [0, 0, 0, 1], fovY: Math.PI / 2, aspect: W / H, near: 0.05, far: 1e5 };
}

function frameInput(frameIndex: number): FrameUniformInput {
  return {
    camera: camera(), astro: astro(), dt: 1 / 60, time: 0, frameIndex, width: W, height: H, preExposure: 1, qualityFlags: 4,
    observerAltitudeM: 0, jitter: true, terrain: null,
  };
}

function project(m: Float32Array, o: number, p: [number, number, number]): [number, number] {
  const v = [p[0], p[1], p[2], 1];
  const r = [0, 0, 0, 0];
  for (let row = 0; row < 4; row++) for (let col = 0; col < 4; col++) r[row] += m[o + col * 4 + row] * v[col];
  return [((r[0] / r[3]) * 0.5 + 0.5) * W, (0.5 - (r[1] / r[3]) * 0.5) * H];
}

describe('taa pure maths', () => {
  it('rescales history by the pre-exposure ratio and ignores invalid inputs', () => {
    expect(historyRescale(2, 1)).toBe(2);
    expect(historyRescale(0.25, 1)).toBe(0.25);
    expect(historyRescale(1, 1)).toBe(1);
    expect(historyRescale(1, 0)).toBe(1);
    expect(historyRescale(NaN, 1)).toBe(1);
    expect(historyRescale(-1, 1)).toBe(1);
  });

  it('history is used only when TAA is on, no reset was requested and the previous frame left valid history', () => {
    const f = (taa: boolean, reset: boolean): PostFlags => ({ taa, reset, bloom: true });
    expect(useHistory(f(true, false), true)).toBe(true);
    expect(useHistory(f(true, false), false)).toBe(false);
    expect(useHistory(f(true, true), true)).toBe(false);
    expect(useHistory(f(false, false), true)).toBe(false);
  });

  it('jitterShiftPx equals the pixel shift between the real jittered and unjittered projections at any depth', () => {
    const fu = new FrameUniforms();
    const shift: number[] = [0, 0];
    for (const frame of [0, 1, 5, 11]) {
      fu.write(frameInput(frame));
      const jx = fu.f32[FRAME_OFFSETS.jitter], jy = fu.f32[FRAME_OFFSETS.jitter + 1];
      jitterShiftPx(jx, jy, W, H, shift);
      for (const p of [[0.3, 2.4, -5], [-4, 1, -40], [10, 30, -900]] as [number, number, number][]) {
        const a = project(fu.f32, FRAME_OFFSETS.viewProj, p), b = project(fu.f32, FRAME_OFFSETS.viewProjUnjittered, p);
        expect(a[0] - b[0]).toBeCloseTo(shift[0], 3);
        expect(a[1] - b[1]).toBeCloseTo(shift[1], 3);
      }
    }
  });

  it('jitter stays within half a pixel and is centred over the sequence', () => {
    const j: number[] = [0, 0];
    const s: number[] = [0, 0];
    let mx = 0, my = 0;
    for (let i = 0; i < JITTER_SEQUENCE_LENGTH; i++) {
      jitterNdc(i, W, H, j);
      jitterShiftPx(j[0], j[1], W, H, s);
      expect(Math.abs(s[0])).toBeLessThanOrEqual(0.5);
      expect(Math.abs(s[1])).toBeLessThanOrEqual(0.5);
      mx += s[0]; my += s[1];
    }
    expect(Math.abs(mx / JITTER_SEQUENCE_LENGTH)).toBeLessThan(0.05);
    expect(Math.abs(my / JITTER_SEQUENCE_LENGTH)).toBeLessThan(0.05);
  });

  it('every define the shader interpolates is provided, and the shader kernel sum matches expectedKernelSum', () => {
    const used = new Set([...taauSrc.matchAll(/\$\{(\w+)\}/g)].map((m) => m[1]));
    const defs = taaDefines();
    expect([...used].sort()).toEqual(Object.keys(defs).sort());
    for (const v of Object.values(defs)) expect(Number.isFinite(v)).toBe(true);
    expect(taauSrc).toContain('KERNEL_SUM : f32 = 3.14159265 / KERNEL_K');
    expect(expectedKernelSum()).toBeCloseTo(Math.PI / TAA_TUNING.kernelK, 12);
  });

  it('drops NaN from every input tap, the reprojected history and the TAA-off resample (a NaN in history would never leave)', () => {
    expect(taauSrc).toContain('dropNan(textureLoad(inputTex, t, 0).rgb)');
    expect(taauSrc).toContain('dropNan(historyCatmullRom(prevUv, oSize) * taa.histScale)');
    expect(taauSrc).toContain('dropNan(textureSampleLevel(inputTex, linSamp');
    expect(taauSrc).toContain('0x7fffffffu');
  });

  it('scales only the sky pixels of the resolved image by skyScale and keeps the history unscaled, so the blend never mixes two scales', () => {
    expect(taauSrc).toMatch(/textureStore\(outResolved, gid\.xy, vec4f\(outC \* mix\(1\.0, taa\.skyScale, skyKw \/ max\(wSum, 1e-9\)\), 1\.0\)\);/);
    expect(taauSrc).toContain('textureStore(outHist, gid.xy, vec4f(outC, storeW));');
    expect(taauSrc).toContain('select(1.0, taa.skyScale, z <= 0.0)');
    expect(taauSrc.match(/skyScale/g)!.length).toBe(3);
  });
});

/** CPU mirror of the shader's 3x3 gather along one axis / two axes (weights only depend on the sample-to-pixel distance). */
function gatherWeights(cx: number, cy: number, jx: number, jy: number, k: number): { w: number; dx: number; dy: number }[] {
  const out: { w: number; dx: number; dy: number }[] = [];
  const bx = Math.floor(cx + jx), by = Math.floor(cy + jy);
  for (let j = -1; j <= 1; j++) {
    for (let i = -1; i <= 1; i++) {
      const dx = bx + i + 0.5 - jx - cx, dy = by + j + 0.5 - jy - cy;
      out.push({ w: Math.exp(-k * (dx * dx + dy * dy)), dx, dy });
    }
  }
  return out;
}

describe('taa kernel (CPU mirror of the 3x3 gather)', () => {
  const jit = (frame: number): [number, number] => {
    const j: number[] = [0, 0], s: number[] = [0, 0];
    jitterNdc(frame, W, H, j);
    jitterShiftPx(j[0], j[1], W, H, s);
    return [s[0], s[1]];
  };

  it('the mean weight sum over jitter phases and output positions is pi / K for every render/out ratio', () => {
    for (const ratio of [0.5, 0.667, 0.75, 1]) {
      let sum = 0, n = 0;
      for (let f = 0; f < JITTER_SEQUENCE_LENGTH; f++) {
        const [jx, jy] = jit(f);
        for (let oy = 0; oy < 24; oy++) {
          for (let ox = 0; ox < 24; ox++) {
            const ws = gatherWeights((ox + 0.5) * ratio, (oy + 0.5) * ratio, jx, jy, TAA_TUNING.kernelK);
            sum += ws.reduce((a, b) => a + b.w, 0);
            n++;
          }
        }
      }
      expect(sum / n / expectedKernelSum()).toBeGreaterThan(0.97);
      expect(sum / n / expectedKernelSum()).toBeLessThan(1.03);
    }
  });

  it('a linear ramp is reconstructed with no bias once the jitter phases are averaged', () => {
    const ramp = (x: number, y: number): number => 3 * x - 2 * y;
    for (const ratio of [0.5, 0.75]) {
      let err = 0, worst = 0, n = 0;
      for (let f = 0; f < JITTER_SEQUENCE_LENGTH; f++) {
        const [jx, jy] = jit(f);
        for (const [ox, oy] of [[3, 4], [10, 7], [11, 2]]) {
          const cx = (ox + 0.5) * ratio, cy = (oy + 0.5) * ratio;
          const ws = gatherWeights(cx, cy, jx, jy, TAA_TUNING.kernelK);
          let wsum = 0, val = 0;
          for (const s of ws) { wsum += s.w; val += s.w * ramp(cx + s.dx, cy + s.dy); }
          const e = val / wsum - ramp(cx, cy);
          err += e; worst = Math.max(worst, Math.abs(e)); n++;
        }
      }
      expect(Math.abs(err / n)).toBeLessThan(0.05);
      expect(worst).toBeLessThan(1.0);
    }
  });

  it('the outermost taps carry a negligible share of the weight (3x3 truncation error)', () => {
    let worst = 0;
    for (let f = 0; f < JITTER_SEQUENCE_LENGTH; f++) {
      const [jx, jy] = jit(f);
      for (let o = 0; o < 20; o++) {
        const ws = gatherWeights((o + 0.5) * 0.5, (o * 0.37 + 0.5) * 0.5, jx, jy, TAA_TUNING.kernelK);
        const total = ws.reduce((a, b) => a + b.w, 0);
        const outer = ws.filter((s) => Math.abs(s.dx) > 1.25 || Math.abs(s.dy) > 1.25).reduce((a, b) => a + b.w, 0);
        worst = Math.max(worst, outer / total);
      }
    }
    expect(worst).toBeLessThan(0.05);
  });
});

interface Recorder {
  bindGroups: number;
  writes: { size: number; data: Uint32Array }[];
  pipelines: string[];
  dispatches: [number, number][];
  textures: number;
}

function fakeContext(rec: Recorder): RenderContext {
  const view = (): GPUTextureView => ({}) as GPUTextureView;
  const device = {
    createBindGroupLayout: () => ({}),
    createPipelineLayout: () => ({}),
    createComputePipeline: (d: { label: string; compute: { entryPoint: string } }) => ({ label: d.compute.entryPoint }),
    createSampler: () => ({}),
    createBuffer: () => ({ destroy: () => {} }),
    createTexture: () => { rec.textures++; return { createView: view, destroy: () => {} }; },
    createBindGroup: () => { rec.bindGroups++; return {}; },
    queue: {
      writeBuffer: (_b: unknown, _o: number, data: ArrayBuffer) => rec.writes.push({ size: data.byteLength, data: new Uint32Array(data.slice(0)) }),
    },
  };
  return {
    device,
    frame: { layout: {}, group: {} },
    module: () => ({}),
    gbuf: { views: { motion: view(), depth: view() } },
  } as unknown as RenderContext;
}

describe('createTaaStage (recorded fake device)', () => {
  let rec: Recorder;
  let rc: RenderContext;
  const frame = {} as FrameInfo;
  const params: PostParams = { outWidth: 64, outHeight: 32, preExposure: 2, prevPreExposure: 1 };
  const on: PostFlags = { taa: true, reset: false, bloom: true };
  const input = {} as GPUTextureView;

  const encode = (stage: ReturnType<typeof createTaaStage>, flags: PostFlags, v: GPUTextureView = input): void => {
    const enc = {
      beginComputePass: () => ({
        setPipeline: (p: { label: string }) => rec.pipelines.push(p.label),
        setBindGroup: () => {},
        dispatchWorkgroups: (x: number, y: number) => rec.dispatches.push([x, y]),
        end: () => {},
      }),
    } as unknown as GPUCommandEncoder;
    stage.encode(enc, rc, frame, params, flags, v);
  };
  const resetFlag = (i: number): number => rec.writes[i].data[1];

  beforeEach(() => {
    vi.stubGlobal('GPUShaderStage', { COMPUTE: 4 });
    vi.stubGlobal('GPUTextureUsage', { TEXTURE_BINDING: 4, STORAGE_BINDING: 8, COPY_SRC: 1 });
    vi.stubGlobal('GPUBufferUsage', { UNIFORM: 64, COPY_DST: 8 });
    rec = { bindGroups: 0, writes: [], pipelines: [], dispatches: [], textures: 0 };
    rc = fakeContext(rec);
  });
  afterEach(() => vi.unstubAllGlobals());

  it('first frame resets, later frames blend, and the uniform carries the pre-exposure ratio', () => {
    const s = createTaaStage();
    s.init(rc);
    s.resize(rc, { width: 64, height: 32 });
    encode(s, on);
    encode(s, on);
    expect(rec.writes.map((w) => w.size)).toEqual([16, 16]);
    expect(resetFlag(0)).toBe(1);
    expect(resetFlag(1)).toBe(0);
    expect(new Float32Array(rec.writes[1].data.buffer)[0]).toBe(2);
    expect(new Float32Array(rec.writes[1].data.buffer)[2]).toBe(1);
    expect(rec.pipelines).toEqual(['main', 'main']);
    expect(rec.dispatches[0]).toEqual([8, 4]);
  });

  it('honours the orchestrator reset, TAA off (upsample only) and the resume after it', () => {
    const s = createTaaStage();
    s.init(rc);
    s.resize(rc, { width: 64, height: 32 });
    encode(s, on);
    encode(s, { ...on, reset: true });
    encode(s, on);
    encode(s, { ...on, taa: false });
    encode(s, on);
    expect([0, 1, 2, 3, 4].map(resetFlag)).toEqual([1, 1, 0, 1, 1]);
    expect(rec.pipelines).toEqual(['main', 'main', 'main', 'upsample', 'main']);
  });

  it('a resize to a new output size drops the history, a same-size resize keeps it', () => {
    const s = createTaaStage();
    s.init(rc);
    s.resize(rc, { width: 64, height: 32 });
    const made = rec.textures;
    encode(s, on);
    s.resize(rc, { width: 64, height: 32 });
    expect(rec.textures).toBe(made);
    encode(s, on);
    expect(resetFlag(1)).toBe(0);
    s.resize(rc, { width: 128, height: 64 });
    expect(rec.textures).toBe(made * 2);
    encode(s, on);
    expect(resetFlag(2)).toBe(1);
    expect(rec.dispatches[2]).toEqual([16, 8]);
  });

  it('creates no bind groups per frame once the input views have been seen', () => {
    const s = createTaaStage();
    s.init(rc);
    s.resize(rc, { width: 64, height: 32 });
    const other = {} as GPUTextureView;
    encode(s, on);
    encode(s, on, other);
    const warm = rec.bindGroups;
    for (let i = 0; i < 20; i++) encode(s, on, i % 2 ? other : input);
    expect(rec.bindGroups).toBe(warm);
  });

  it('exposes a stable resolved view across frames', () => {
    const s = createTaaStage();
    s.init(rc);
    s.resize(rc, { width: 64, height: 32 });
    const v = s.resolved;
    encode(s, on);
    encode(s, on);
    expect(s.resolved).toBe(v);
  });
});

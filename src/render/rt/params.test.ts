import { describe, expect, it } from 'vitest';
import { FLAG_SPEC, FLAG_TERRAIN, RT_PARAM_BYTES, RtParamBlock, type RtParamInput } from './params';

const base: RtParamInput = {
  rtWidth: 480, rtHeight: 270, fullWidth: 960, fullHeight: 540, divisor: 2, maxSteps: 96, giRays: 2, spec: true, terrain: true,
  staticRoot: 128, dynamicRoot: 0, visitCap: 256, frameIndex: 7, debugView: 3, seed: 0xdeadbeef, probeStride: 8, probePhase: 5,
  probeLo: [-3, 2, -4], probeRays: 64, probePrevLo: [-2, 2, -4], probeAllFresh: false, probeDim: [32, 16, 32],
  softness: 1.5, probeSpacing: 5, probeHysteresis: 0.92, rayRange: 1200,
};

describe('RtParamBlock', () => {
  it('is 8 vec4s', () => {
    expect(RT_PARAM_BYTES).toBe(128);
    expect(new RtParamBlock().buffer.byteLength).toBe(128);
  });

  it('packs each field at the offset the shader struct expects', () => {
    const b = new RtParamBlock();
    b.write(base);
    expect(Array.from(b.u32.slice(0, 4))).toEqual([480, 270, 960, 540]);
    expect(Array.from(b.u32.slice(4, 8))).toEqual([2, 96, 2, FLAG_SPEC | FLAG_TERRAIN]);
    expect(Array.from(b.u32.slice(8, 12))).toEqual([128, 0, 256, 7]);
    expect(Array.from(b.u32.slice(12, 16))).toEqual([3, 0xdeadbeef, 8, 5]);
    expect(Array.from(b.i32.slice(16, 20))).toEqual([-3, 2, -4, 64]);
    expect(Array.from(b.i32.slice(20, 24))).toEqual([-2, 2, -4, 0]);
    expect(Array.from(b.u32.slice(24, 28))).toEqual([32, 16, 32, 0]);
    expect(Array.from(b.f32.slice(28, 32))).toEqual([1.5, 5, Math.fround(0.92), 1200]);
  });

  it('clears the flags and flags all probes fresh on request', () => {
    const b = new RtParamBlock();
    b.write({ ...base, spec: false, terrain: false, probeAllFresh: true });
    expect(b.u32[7]).toBe(0);
    expect(b.i32[23]).toBe(1);
  });
});

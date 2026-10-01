import { describe, expect, it } from 'vitest';
import frameSrc from './shaders/common/frame.wgsl?raw';
import type { AstroState, CameraState } from '../contracts';
import { FRAME_OFFSETS, FRAME_UNIFORM_BYTES, FrameUniforms, MOON_TINT, frameSeed, halton, jitterNdc, type FrameUniformInput } from './frameUniforms';
import { moonIlluminanceLux } from './exposure';

const deg = (d: number) => (d * Math.PI) / 180;

function astro(sunElev: number, moonElev: number, phase = 0): AstroState {
  const dir = (e: number): [number, number, number] => [0, Math.sin(deg(e)), -Math.cos(deg(e))];
  return {
    julianDate: 2461000, sunDir: dir(sunElev), moonDir: dir(moonElev), sunElevation: deg(sunElev), moonElevation: deg(moonElev),
    moonIlluminatedFraction: 0.5 * (1 + Math.cos(phase)), moonPhaseAngle: phase, equatorialToWorld: [1, 2, 3, 4, 5, 6, 7, 8, 9], planets: [],
  };
}

function camera(quat: [number, number, number, number] = [0, 0, 0, 1], pos: [number, number, number] = [0, 0, 0]): CameraState {
  return { pos, quat, fovY: deg(90), aspect: 16 / 9, near: 0.05, far: 1e5 };
}

function input(over: Partial<FrameUniformInput> = {}): FrameUniformInput {
  return {
    camera: camera(), astro: astro(60, -30), dt: 1 / 60, time: 3, frameIndex: 5, width: 1280, height: 720, preExposure: 0.01, qualityFlags: 7,
    observerAltitudeM: 1200, jitter: true, terrain: { resolution: 256, cellSize: 8, minHeight: -5, maxHeight: 200, origin: [-1024, -1024] }, ...over,
  };
}

function mulVec(m: ArrayLike<number>, o: number, v: [number, number, number, number]): [number, number, number, number] {
  const r: [number, number, number, number] = [0, 0, 0, 0];
  for (let row = 0; row < 4; row++) for (let col = 0; col < 4; col++) r[row] += m[o + col * 4 + row] * v[col];
  return r;
}

describe('Frame uniform layout', () => {
  it('matches the std140 offsets of the Frame struct in frame.wgsl', () => {
    const src = frameSrc;
    const body = src.slice(src.indexOf('struct Frame'), src.indexOf('};'));
    const members = [...body.matchAll(/^\s*(\w+)\s*:\s*(mat4x4f|vec4f|vec4u)/gm)];
    let off = 0;
    for (const [, name, type] of members) {
      expect(FRAME_OFFSETS[name as keyof typeof FRAME_OFFSETS], name).toBe(off / 4);
      off += type === 'mat4x4f' ? 64 : 16;
    }
    expect(members.length).toBe(Object.keys(FRAME_OFFSETS).length);
    expect(off).toBe(FRAME_UNIFORM_BYTES);
  });
});

describe('FrameUniforms', () => {
  it('reverse-Z infinite projection maps the near plane to depth 1 and far distances toward 0', () => {
    const fu = new FrameUniforms();
    fu.write(input({ jitter: false }));
    const O = FRAME_OFFSETS;
    const near = mulVec(fu.f32, O.viewProjUnjittered, [0, 0, -0.05, 1]);
    expect(near[2] / near[3]).toBeCloseTo(1, 6);
    const far = mulVec(fu.f32, O.viewProjUnjittered, [0, 0, -1e6, 1]);
    expect(far[2] / far[3]).toBeLessThan(1e-6);
    const mid = mulVec(fu.f32, O.viewProjUnjittered, [0, 0, -10, 1]);
    expect(mid[2] / mid[3]).toBeCloseTo(0.005, 6);
  });

  it('view matrix follows camera position and orientation (yaw +90 deg looks toward -X)', () => {
    const fu = new FrameUniforms();
    const s = Math.SQRT1_2;
    fu.write(input({ camera: camera([0, s, 0, s], [10, 20, 30]) }));
    const v = mulVec(fu.f32, FRAME_OFFSETS.view, [0, 20, 30, 1]);
    expect(v[0]).toBeCloseTo(0, 5); expect(v[1]).toBeCloseTo(0, 5); expect(v[2]).toBeCloseTo(-10, 5);
    const w = mulVec(fu.f32, FRAME_OFFSETS.invView, [0, 0, 0, 1]);
    expect(w.slice(0, 3)).toEqual([10, 20, 30]);
  });

  it('jitter shifts NDC by exactly the reported jitter and invViewProj reconstructs world position', () => {
    const fu = new FrameUniforms();
    fu.write(input({ camera: camera([0.1, 0.2, 0.05, 0.97], [3, 4, 5]), frameIndex: 3 }));
    const O = FRAME_OFFSETS, f = fu.f32;
    const p: [number, number, number, number] = [7, 2, -25, 1];
    const a = mulVec(f, O.viewProj, p), b = mulVec(f, O.viewProjUnjittered, p);
    expect(a[0] / a[3] - b[0] / b[3]).toBeCloseTo(f[O.jitter], 5);
    expect(a[1] / a[3] - b[1] / b[3]).toBeCloseTo(f[O.jitter + 1], 5);
    expect(Math.abs(f[O.jitter])).toBeGreaterThan(0);
    const back = mulVec(f, O.invViewProj, [a[0] / a[3], a[1] / a[3], a[2] / a[3], 1]);
    expect(back[0] / back[3]).toBeCloseTo(7, 3); expect(back[1] / back[3]).toBeCloseTo(2, 3); expect(back[2] / back[3]).toBeCloseTo(-25, 3);
    const pr = mulVec(f, O.invProj, mulVec(f, O.proj, [1, 2, -3, 1]));
    expect(pr[0] / pr[3]).toBeCloseTo(1, 4);
  });

  it('jitter is a 16-sample Halton(2,3) sequence, zero when disabled', () => {
    expect(halton(1, 2)).toBe(0.5); expect(halton(2, 2)).toBe(0.25); expect(halton(3, 3)).toBeCloseTo(1 / 9, 12);
    const out = [0, 0], seen = new Set<string>();
    for (let i = 0; i < 16; i++) { jitterNdc(i, 100, 100, out); seen.add(out.join(',')); expect(Math.abs(out[0])).toBeLessThanOrEqual(1 / 100 + 1e-9); }
    expect(seen.size).toBe(16);
    jitterNdc(16, 100, 100, out); expect(out.join(',')).toBe([...seen][0]);
    const fu = new FrameUniforms();
    fu.write(input({ jitter: false }));
    expect(fu.f32[FRAME_OFFSETS.jitter]).toBe(0);
  });

  it('prevViewProj is the previous frame unjittered viewProj (and equals current on the first frame)', () => {
    const fu = new FrameUniforms();
    const O = FRAME_OFFSETS;
    fu.write(input({ camera: camera([0, 0, 0, 1], [0, 0, 0]), frameIndex: 0 }));
    expect(Array.from(fu.f32.slice(O.prevViewProj, O.prevViewProj + 16))).toEqual(Array.from(fu.f32.slice(O.viewProjUnjittered, O.viewProjUnjittered + 16)));
    const first = fu.f32.slice(O.viewProjUnjittered, O.viewProjUnjittered + 16);
    fu.write(input({ camera: camera([0, 0, 0, 1], [1, 0, 0]), frameIndex: 1 }));
    expect(Array.from(fu.f32.slice(O.prevViewProj, O.prevViewProj + 16))).toEqual(Array.from(first));
    expect(fu.f32[O.jitter + 2]).toBeCloseTo(0, 12);
  });

  it('embeds the row-major equatorial matrix column-major in the celestial mat4', () => {
    const fu = new FrameUniforms();
    fu.write(input());
    const c = FRAME_OFFSETS.celestial;
    expect(Array.from(fu.f32.slice(c, c + 3))).toEqual([1, 4, 7]);
    expect(Array.from(fu.f32.slice(c + 4, c + 7))).toEqual([2, 5, 8]);
    expect(Array.from(fu.f32.slice(c + 8, c + 11))).toEqual([3, 6, 9]);
    expect(fu.f32[c + 15]).toBe(1);
    expect(fu.f32[c + 3]).toBe(0);
  });

  it('writes light, terrain, misc, params and sky blocks', () => {
    const fu = new FrameUniforms();
    fu.write(input({ camera: camera([0, 0, 0, 1], [0, 300, 0]) }));
    const f = fu.f32, u = fu.u32, O = FRAME_OFFSETS;
    expect(f[O.sunDir + 3]).toBeCloseTo(0.00465, 6);
    expect(f[O.moonDir + 3]).toBeCloseTo(0.0045, 6);
    expect(f[O.sunIrradiance]).toBeCloseTo(1.27e5, -1);
    expect(f[O.sunIrradiance + 3]).toBe(1);
    const m = [f[O.moonIrradiance], f[O.moonIrradiance + 1], f[O.moonIrradiance + 2]];
    expect(0.2126 * m[0] + 0.7152 * m[1] + 0.0722 * m[2]).toBeCloseTo(moonIlluminanceLux(0), 4);
    expect(m[2]).toBeGreaterThan(m[1]);
    expect(m[1]).toBeGreaterThan(m[0]);
    expect(m[2] / m[0]).toBeCloseTo(MOON_TINT[2] / MOON_TINT[0], 5);
    expect(f[O.terrainOrigin + 2]).toBe(2048);
    expect(f[O.terrain]).toBe(256);
    expect(u[O.misc]).toBe(5); expect(u[O.misc + 1]).toBe(7); expect(u[O.misc + 2]).toBe(frameSeed(5)); expect(u[O.misc + 3]).toBe(0);
    expect(f[O.params + 1]).toBeCloseTo(0.01, 6); expect(f[O.params + 2]).toBeCloseTo(0.05, 6);
    expect(f[O.sky]).toBe(6360); expect(f[O.sky + 1]).toBe(6460); expect(f[O.sky + 2]).toBeCloseTo(1.5, 5); expect(f[O.sky + 3]).toBe(1);
    expect(f[O.screen + 2]).toBeCloseTo(1 / 1280, 9);
    expect(f[O.camPos + 3]).toBe(3);
  });

  it('clamps the sky camera height and tolerates a missing terrain', () => {
    const fu = new FrameUniforms();
    fu.write(input({ camera: camera([0, 0, 0, 1], [0, -5000, 0]), observerAltitudeM: 0, terrain: null }));
    expect(fu.f32[FRAME_OFFSETS.sky + 2]).toBeCloseTo(0.0001, 8);
    expect(fu.f32[FRAME_OFFSETS.terrain]).toBe(1);
  });

  it('frame seeds decorrelate consecutive frames', () => {
    const s = new Set<number>();
    for (let i = 0; i < 1000; i++) s.add(frameSeed(i));
    expect(s.size).toBe(1000);
  });
});

describe('key light selection', () => {
  it('sun by day, moon at night, with hysteresis and no flip-flop near the crossover', () => {
    const fu = new FrameUniforms();
    fu.write(input({ astro: astro(60, 10) }));
    expect(fu.keyLight).toBe(0);
    fu.write(input({ astro: astro(-30, 40) }));
    expect(fu.keyLight).toBe(1);
    expect(fu.u32[FRAME_OFFSETS.misc + 3]).toBe(1);
    // Sun barely above the horizon: 1.27e5 * sin(0.1deg) >> moon lux, so the sun wins again.
    fu.write(input({ astro: astro(0.1, 40) }));
    expect(fu.keyLight).toBe(0);
    // Both below the horizon: keep the previous choice.
    fu.write(input({ astro: astro(-30, -30) }));
    expect(fu.keyLight).toBe(0);
  });

  it('a below-horizon moon is ignored; a risen moon takes over once the sun is down', () => {
    const fu = new FrameUniforms();
    fu.write(input({ astro: astro(-20, -5) }));
    expect(fu.keyLight).toBe(0);
    fu.write(input({ astro: astro(-20, 30) }));
    expect(fu.keyLight).toBe(1);
  });
});

describe('moon photometry', () => {
  it('full moon is about 0.26 lux and falls off steeply with phase angle', () => {
    expect(moonIlluminanceLux(0)).toBeGreaterThan(0.25);
    expect(moonIlluminanceLux(0)).toBeLessThan(0.28);
    expect(moonIlluminanceLux(deg(90))).toBeLessThan(moonIlluminanceLux(0) / 5);
    expect(moonIlluminanceLux(deg(90))).toBeGreaterThan(0.005);
    expect(moonIlluminanceLux(Math.PI)).toBeLessThan(2e-4);
  });
});

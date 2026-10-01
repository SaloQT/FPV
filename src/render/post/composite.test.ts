import { describe, expect, it, vi } from 'vitest';
import composite from '../shaders/post/composite.wgsl?raw';
import lensSrc from '../shaders/post/lens.wgsl?raw';
import sensorSrc from '../shaders/post/sensor.wgsl?raw';
import tonemapSrc from '../shaders/post/tonemap.wgsl?raw';
import videoSrc from '../shaders/post/video.wgsl?raw';
import { resolveShader } from '../shaderLib';
import { COMPOSITE_TUNING, angularVelocity, canvasFormatInfo, createCompositeStage, jelloAmplitude, lensCoefficients } from './composite';
import type { Quat } from '../../contracts';

const nums = (src: string, re: RegExp): number[] => (src.match(re)?.[1] ?? '').split(',').map(Number);
// The mirrors below read the shader's own constants, so a retuned WGSL constant cannot silently diverge from the tested formula.
const GRADE = nums(tonemapSrc, /const GRADE : Grade = Grade\(([^)]*)\)/);
const SENSOR = nums(sensorSrc, /const SENSOR : SensorModel = SensorModel\(([^)]*)\)/);
const [PRE_SCALE, SATURATION, CONTRAST, DESAT_START, DESAT_END, GAMUT_CEIL, GAMUT_KNEE] = GRADE;

type V3 = [number, number, number];
const luma = (c: V3): number => 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
const clamp = (x: number, a: number, b: number): number => Math.min(b, Math.max(a, x));
const smooth = (a: number, b: number, x: number): number => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };

const filmicLuma = (x: number): number => {
  const a = Math.abs(x) * PRE_SCALE;
  return (Math.sign(x) * a * (2.51 * a + 0.03)) / (a * (2.43 * a + 0.59) + 0.14);
};

function compressGamut(o: V3, y: number): V3 {
  const room = Math.max(GAMUT_CEIL + (1 - GAMUT_CEIL) * y ** 4 - y, 1e-4);
  const c = Math.max(...o) - y;
  const knee = GAMUT_KNEE * room;
  if (c <= knee) return o;
  const over = c - knee;
  const span = room - knee;
  const k = (knee + (span * over) / (over + span)) / c;
  return o.map((x) => y + (x - y) * k) as V3;
}

function tonemap(scene: V3, saturation = SATURATION): V3 {
  const l = luma(scene);
  const y = Math.min(filmicLuma(l), 1);
  const k = Math.abs(l) > 1e-6 ? y / l : (PRE_SCALE * 0.03) / 0.14;
  const w = smooth(DESAT_START, DESAT_END, l);
  let o = scene.map((x) => (1 - w) * x * k + w * y) as V3;
  o = o.map((x) => y + (x - y) * saturation) as V3;
  return compressGamut(o, y).map((x) => clamp(x, 0, 1)) as V3;
}

const encode = (x: number): number => { const c = clamp(x, 0, 1); return c <= 0.0031308 ? 12.92 * c : 1.055 * Math.pow(c, 1 / 2.4) - 0.055; };
const decode = (x: number): number => { const c = clamp(x, 0, 1); return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); };
const fract = (x: number): number => x - Math.floor(x);
const ign = (x: number, y: number): number => fract(52.9829189 * fract(x * 0.06711056 + y * 0.00583715));
function tpdf(x: number, y: number, frame: number): number {
  const f = frame & 63;
  return ign(x + 5.588238 * f, y + 5.588238 * f) + ign(y + 47 + 8.311 * f, x + 13 + 3.917 * f) - 1;
}

function undistort(px: number, py: number, w: number, h: number, k1: number, k2: number, zoom: number): [number, number] {
  const hd = 0.5 * Math.hypot(w, h);
  const p = [(px / w - 0.5) * w / hd, (py / h - 0.5) * h / hd];
  const len = Math.hypot(p[0], p[1]);
  const rd = len * zoom;
  let ru = rd;
  for (let i = 0; i < 4; i++) {
    const r2 = ru * ru;
    ru -= (ru * (1 + k1 * r2 + k2 * r2 * r2) - rd) / (1 + 3 * k1 * r2 + 5 * k2 * r2 * r2);
  }
  const s = ru / Math.max(len, 1e-6);
  return [0.5 + (p[0] * s * hd) / w, 0.5 + (p[1] * s * hd) / h];
}

function distortToPixel(u: number, v: number, w: number, h: number, k1: number, k2: number, zoom: number): [number, number] {
  const hd = 0.5 * Math.hypot(w, h);
  const p = [(u - 0.5) * w / hd, (v - 0.5) * h / hd];
  const ru = Math.hypot(p[0], p[1]);
  const f = 1 + k1 * ru * ru + k2 * ru ** 4;
  const s = (f / zoom);
  return [(0.5 + (p[0] * s * hd) / w) * w, (0.5 + (p[1] * s * hd) / h) * h];
}

function rollingShift(uv: [number, number], size: [number, number], omega: V3, focal: number, readout: number, jello: number[]): [number, number] {
  const yn = uv[1] - 0.5;
  const th = omega.map((o) => o * yn * readout);
  const c = [(uv[0] - 0.5) * size[0], (uv[1] - 0.5) * size[1]];
  const d: [number, number] = [focal * th[1] - c[1] * th[2] + jello[0] * Math.sin(jello[1] + jello[2] * yn), focal * th[0] + c[0] * th[2]];
  const lim = 0.08 * Math.max(...size);
  return [clamp(d[0], -lim, lim), clamp(d[1], -lim, lim)];
}

function pcg3d(v: V3): V3 {
  let [x, y, z] = v.map((a) => (Math.imul(a, 1664525) + 1013904223) >>> 0);
  x = (x + Math.imul(y, z)) >>> 0; y = (y + Math.imul(z, x)) >>> 0; z = (z + Math.imul(x, y)) >>> 0;
  x = (x ^ (x >>> 16)) >>> 0; y = (y ^ (y >>> 16)) >>> 0; z = (z ^ (z >>> 16)) >>> 0;
  x = (x + Math.imul(y, z)) >>> 0; y = (y + Math.imul(z, x)) >>> 0; z = (z + Math.imul(x, y)) >>> 0;
  return [x, y, z];
}
const unitOpen = (h: number): number => ((h >>> 8) + 0.5) / 16777216;

function gauss4(px: number, py: number, frame: number): number[] {
  const h0 = pcg3d([px, py, frame]);
  const h1 = pcg3d(h0.map((a) => (a ^ 0x9e3779b9) >>> 0) as V3);
  const ra = Math.sqrt(-2 * Math.log(unitOpen(h0[0])));
  const rb = Math.sqrt(-2 * Math.log(unitOpen(h1[0])));
  const pa = 2 * Math.PI * unitOpen(h0[1]);
  const pb = 2 * Math.PI * unitOpen(h1[1]);
  return [ra * Math.cos(pa), ra * Math.sin(pa), rb * Math.cos(pb), rb * Math.sin(pb)];
}

function sensorSigma(c: number, gainEv: number, amp: number): number {
  const [shot, read, maxEv, , shutterEv, nrFloor] = SENSOR;
  const isoEv = clamp(gainEv - shutterEv, 0, maxEv - shutterEv);
  const nr = 1 + (nrFloor - 1) * (isoEv / (maxEv - shutterEv));
  return amp * nr * Math.sqrt(shot * Math.max(c, 0) * 2 ** isoEv + read * read * 2 ** isoEv);
}

function sensorNoise(c: V3, px: number, py: number, frame: number, gainEv: number, amp: number): V3 {
  const g = gauss4(px, py, frame);
  const chroma = SENSOR[3];
  return c.map((v, i) => sensorSigma(v, gainEv, amp) * (Math.sqrt(1 - chroma) * g[3] + Math.sqrt(chroma) * g[i])) as V3;
}

const yawQuat = (a: number): Quat => [0, Math.sin(a / 2), 0, Math.cos(a / 2)];
function qmul(a: Quat, b: Quat): Quat {
  return [
    a[3] * b[0] + a[0] * b[3] + a[1] * b[2] - a[2] * b[1],
    a[3] * b[1] - a[0] * b[2] + a[1] * b[3] + a[2] * b[0],
    a[3] * b[2] + a[0] * b[1] - a[1] * b[0] + a[2] * b[3],
    a[3] * b[3] - a[0] * b[0] - a[1] * b[1] - a[2] * b[2],
  ];
}

describe('lens distortion', () => {
  it('coefficients follow the brief and vanish at lens = 0', () => {
    const off = lensCoefficients(0);
    expect(Math.abs(off.k1) + Math.abs(off.k2)).toBe(0);
    expect(off.zoom).toBe(1);
    const c = lensCoefficients(1);
    expect(c.k1).toBeCloseTo(-0.25, 12);
    expect(c.k2).toBeCloseTo(0.05, 12);
    expect(c.zoom).toBeCloseTo(0.8, 12);
    expect(lensCoefficients(7)).toEqual(lensCoefficients(1));
    expect(lensCoefficients(-1).zoom).toBe(1);
  });

  it('is the identity at lens = 0', () => {
    for (const [x, y] of [[0.5, 0.5], [10.5, 700.5], [1919.5, 1079.5], [960.5, 3.5]]) {
      const [u, v] = undistort(x, y, 1920, 1080, 0, 0, 1);
      expect(u).toBeCloseTo(x / 1920, 9);
      expect(v).toBeCloseTo(y / 1080, 9);
    }
  });

  it.each([0.35, 1])('inverts the forward Brown-Conrady model within 0.5 px on a 1920x1080 grid (lens %f)', (lens) => {
    const { k1, k2, zoom } = lensCoefficients(lens);
    let worst = 0;
    for (let y = 0.5; y < 1080; y += 27) {
      for (let x = 0.5; x < 1920; x += 30) {
        const [u, v] = undistort(x, y, 1920, 1080, k1, k2, zoom);
        const [bx, by] = distortToPixel(u, v, 1920, 1080, k1, k2, zoom);
        worst = Math.max(worst, Math.hypot(bx - x, by - y));
      }
    }
    expect(worst).toBeLessThan(0.5);
  });

  it('zooms to fill: every output pixel samples inside the render and the corner stays put', () => {
    const { k1, k2, zoom } = lensCoefficients(1);
    for (let y = 0; y <= 1080; y += 60) {
      for (let x = 0; x <= 1920; x += 60) {
        const [u, v] = undistort(x, y, 1920, 1080, k1, k2, zoom);
        expect(u).toBeGreaterThanOrEqual(-1e-3);
        expect(u).toBeLessThanOrEqual(1 + 1e-3);
        expect(v).toBeGreaterThanOrEqual(-1e-3);
        expect(v).toBeLessThanOrEqual(1 + 1e-3);
      }
    }
    const [cu, cv] = undistort(0, 0, 1920, 1080, k1, k2, zoom);
    expect(Math.hypot(cu, cv)).toBeLessThan(2e-3);
  });

  it('magnifies the centre and compresses the edge (barrel)', () => {
    const { k1, k2, zoom } = lensCoefficients(1);
    const near = undistort(960 + 10, 540, 1920, 1080, k1, k2, zoom)[0] - 0.5;
    expect(near).toBeCloseTo((10 / 1920) * zoom, 4);
    expect(near).toBeLessThan(10 / 1920);
  });
});

describe('tonemap', () => {
  it('is monotonic over 12 stops on a grey ramp and ends at black and white', () => {
    let prev = -1;
    for (let ev = -14; ev <= 14; ev += 0.25) {
      const v = 0.2 * 2 ** ev;
      const o = tonemap([v, v, v]);
      expect(o[0]).toBeGreaterThanOrEqual(prev);
      prev = o[0];
    }
    expect(tonemap([0, 0, 0])[0]).toBeLessThan(1e-3);
    expect(tonemap([1e4, 1e4, 1e4])[0]).toBeGreaterThan(0.999);
  });

  it('keeps neutrals neutral and puts mid grey near the middle of the encoded range', () => {
    for (const v of [0.002, 0.05, 0.22, 1, 50]) {
      const o = tonemap([v, v, v]);
      expect(Math.abs(o[0] - o[1])).toBeLessThan(1e-6);
      expect(Math.abs(o[1] - o[2])).toBeLessThan(1e-6);
    }
    const mid = encode(tonemap([0.22, 0.22, 0.22])[1]);
    expect(mid).toBeGreaterThan(0.4);
    expect(mid).toBeLessThan(0.65);
  });

  it('is odd around black with a finite slope, so a noisy black pixel does not lift', () => {
    expect(filmicLuma(-0.02)).toBeCloseTo(-filmicLuma(0.02), 12);
    const slope = (PRE_SCALE * 0.03) / 0.14;
    expect(filmicLuma(1e-6) / 1e-6).toBeCloseTo(slope, 3);
    expect(tonemap([1e-4, 1e-4, 1e-4])[0] / 1e-4).toBeCloseTo(slope, 2);
  });

  it('burns a very bright saturated light to white and always stays in gamut', () => {
    const sun = tonemap([4000, 2400, 1200]);
    expect(Math.min(...sun)).toBeGreaterThan(0.97);
    for (const c of [[-0.3, 0.5, 0.2], [0, 0, 5], [12, 0, 0], [0.01, 9, 0.02], [1e5, 1e5, 0]] as V3[]) {
      for (const x of tonemap(c)) {
        expect(x).toBeGreaterThanOrEqual(0);
        expect(x).toBeLessThanOrEqual(1);
      }
    }
  });

  it('keeps a saturated blue sky off the white plateau: its brightest channel stays under the ceiling and still rises with the light', () => {
    const sky: V3 = [0.25, 0.45, 1];
    let prev = 0;
    for (const s of [0.05, 0.1, 0.2, 0.4, 0.8, 1.2]) {
      const o = tonemap(sky.map((x) => x * s) as V3);
      const code = Math.round(255 * encode(o[2]));
      expect(code).toBeLessThanOrEqual(248);
      expect(code).toBeGreaterThan(prev);
      prev = code;
    }
    const a = tonemap(sky.map((x) => x * 0.8) as V3)[2];
    const b = tonemap(sky.map((x) => x * 1.2) as V3)[2];
    expect(Math.round(255 * encode(b)) - Math.round(255 * encode(a))).toBeGreaterThanOrEqual(2);
  });

  it('leaves in-gamut mid-tones untouched and compresses with a continuous slope at the knee', () => {
    const y = 0.4;
    const room = GAMUT_CEIL + (1 - GAMUT_CEIL) * y ** 4 - y;
    const knee = GAMUT_KNEE * room;
    expect(compressGamut([y + knee * 0.99, y, y - knee * 0.4], y)[0]).toBeCloseTo(y + knee * 0.99, 12);
    const out = (c: number): number => compressGamut([y + c, y, y], y)[0] - y;
    const h = 1e-4;
    const left = (out(knee) - out(knee - h)) / h;
    const right = (out(knee + h) - out(knee)) / h;
    expect(right).toBeCloseTo(left, 2);
    expect(out(100)).toBeLessThan(room);
    expect(out(100)).toBeGreaterThan(0.97 * room);
  });

  it('keeps the chromaticity of a colour whatever its brightness: no hue skew towards cyan or yellow', () => {
    const sky: V3 = [0.1, 0.25, 0.9];
    const dir = (o: V3): number => (o[2] - luma(o)) / (o[0] - luma(o));
    const ref = dir(tonemap(sky));
    for (const s of [0.01, 0.05, 0.2, 1, 1.5]) {
      const o = tonemap(sky.map((x) => x * s) as V3);
      expect(dir(o)).toBeCloseTo(ref, 6);
      expect(o[2]).toBeGreaterThan(o[1]);
      expect(o[1]).toBeGreaterThan(o[0]);
    }
    for (let ev = -8; ev <= 8; ev += 0.5) {
      const o = tonemap([1, 0.5, 0.1].map((x) => x * 2 ** ev) as V3);
      expect(o[0]).toBeGreaterThanOrEqual(o[1] - 1e-9);
      expect(o[1]).toBeGreaterThanOrEqual(o[2] - 1e-9);
    }
  });

  it('desaturates towards white as a colour approaches clipping, like a sensor saturating', () => {
    const sat = (o: V3): number => (Math.max(...o) - Math.min(...o)) / Math.max(...o);
    const c: V3 = [1, 0.6, 0.3];
    expect(sat(tonemap(c.map((x) => x * 0.1) as V3))).toBeGreaterThan(sat(tonemap(c.map((x) => x * 6) as V3)));
    expect(sat(tonemap(c.map((x) => x * 6) as V3))).toBeGreaterThan(sat(tonemap(c.map((x) => x * 60) as V3)));
  });

  it('applies the grade saturation to a mid-tone colour and keeps it a camera-like 1.0 to 1.08', () => {
    expect(SATURATION).toBeGreaterThanOrEqual(1);
    expect(SATURATION).toBeLessThanOrEqual(1.08);
    expect(CONTRAST).toBeGreaterThan(0);
    const c: V3 = [0.2, 0.15, 0.12];
    const flat = tonemap(c, 1);
    const graded = tonemap(c);
    const chroma = (o: V3): number => o[0] - luma(o);
    expect(chroma(flat)).toBeGreaterThan(0.01);
    expect(chroma(graded) / chroma(flat)).toBeCloseTo(SATURATION, 6);
  });
});

describe('display encode and dither', () => {
  it('sRGB OETF matches known values and round-trips', () => {
    expect(encode(0.0031308)).toBeCloseTo(0.04045, 5);
    expect(encode(0.5)).toBeCloseTo(0.735357, 5);
    expect(encode(1)).toBeCloseTo(1, 9);
    for (let i = 0; i <= 100; i++) expect(decode(encode(i / 100))).toBeCloseTo(i / 100, 6);
  });

  it('TPDF dither is zero-mean with the variance of two uniforms and stays within one code', () => {
    let sum = 0, sq = 0, n = 0, lo = 9, hi = -9;
    for (let f = 0; f < 8; f++) {
      for (let y = 0; y < 128; y++) {
        for (let x = 0; x < 128; x++) {
          const d = tpdf(x, y, f);
          sum += d; sq += d * d; n++; lo = Math.min(lo, d); hi = Math.max(hi, d);
        }
      }
    }
    expect(Math.abs(sum / n)).toBeLessThan(0.01);
    expect(sq / n).toBeGreaterThan(0.14);
    expect(sq / n).toBeLessThan(0.19);
    expect(lo).toBeGreaterThanOrEqual(-1);
    expect(hi).toBeLessThanOrEqual(1);
  });

  it('dithering preserves the mean of a value between two 8-bit codes', () => {
    const target = 100.3;
    let sum = 0, n = 0;
    for (let f = 0; f < 4; f++) for (let y = 0; y < 128; y++) for (let x = 0; x < 128; x++) { sum += Math.round(target + tpdf(x, y, f)); n++; }
    expect(Math.abs(sum / n - target)).toBeLessThan(0.02);
  });

  it('picks the encode path and dither step from the canvas format', () => {
    expect(canvasFormatInfo('bgra8unorm')).toEqual({ hwSrgb: false, ditherLsb: 1 / 255 });
    expect(canvasFormatInfo('rgba8unorm-srgb')).toEqual({ hwSrgb: true, ditherLsb: 1 / 255 });
    expect(canvasFormatInfo('bgra8unorm-srgb').hwSrgb).toBe(true);
    expect(canvasFormatInfo('rgb10a2unorm')).toEqual({ hwSrgb: false, ditherLsb: 1 / 1023 });
    expect(canvasFormatInfo('rgba16float')).toEqual({ hwSrgb: false, ditherLsb: 0 });
  });
});

describe('rolling shutter and jello', () => {
  const size: [number, number] = [1920, 1080];
  const focal = 0.5 * 1080 / Math.tan(0.5 * 2);
  const R = COMPOSITE_TUNING.readout;
  const none = [0, 0, 0, 0];

  it('does nothing without rotation or vibration', () => {
    for (const uv of [[0, 0], [0.5, 0.5], [1, 1], [0.2, 0.9]] as [number, number][]) expect(rollingShift(uv, size, [0, 0, 0], focal, R, none)).toEqual([0, 0]);
  });

  it('skews linearly with the row: zero at the centre, opposite at top and bottom, scaled by yaw rate x readout x focal length', () => {
    const w: V3 = [0, 10, 0];
    expect(rollingShift([0.3, 0.5], size, w, focal, R, none)[0]).toBeCloseTo(0, 9);
    const bottom = rollingShift([0.3, 1], size, w, focal, R, none);
    const top = rollingShift([0.3, 0], size, w, focal, R, none);
    expect(bottom[0]).toBeCloseTo(focal * 10 * 0.5 * R, 6);
    expect(top[0]).toBeCloseTo(-bottom[0], 9);
    expect(bottom[1]).toBeCloseTo(0, 9);
    expect(rollingShift([0.3, 0.75], size, w, focal, R, none)[0]).toBeCloseTo(bottom[0] / 2, 9);
    expect(rollingShift([0.3, 1], size, [0, 20, 0], focal, R, none)[0]).toBeCloseTo(2 * bottom[0], 9);
  });

  it('pitch shifts vertically and roll shears with the distance from the centre', () => {
    const pitch = rollingShift([0.5, 1], size, [10, 0, 0], focal, R, none);
    expect(pitch[1]).toBeCloseTo(focal * 10 * 0.5 * R, 6);
    expect(pitch[0]).toBeCloseTo(0, 9);
    const roll = rollingShift([1, 1], size, [0, 0, 10], focal, R, none);
    expect(roll[0]).toBeCloseTo(-540 * 10 * 0.5 * R, 6);
    expect(roll[1]).toBeCloseTo(960 * 10 * 0.5 * R, 6);
  });

  it('caps absurd rates and adds a bounded sinusoidal wobble for jello', () => {
    const big = rollingShift([0.5, 1], size, [0, 5000, 0], focal, R, none);
    expect(Math.abs(big[0])).toBeLessThanOrEqual(0.08 * 1920 + 1e-9);
    for (let i = 0; i <= 20; i++) expect(Math.abs(rollingShift([0.5, i / 20], size, [0, 0, 0], focal, R, [0.4, 1.3, 9, 0])[0])).toBeLessThanOrEqual(0.4 + 1e-9);
    expect(jelloAmplitude(0)).toBe(0);
    expect(jelloAmplitude(2500)).toBeCloseTo(COMPOSITE_TUNING.jelloPx, 12);
    expect(jelloAmplitude(1250)).toBeCloseTo(COMPOSITE_TUNING.jelloPx / 4, 12);
    expect(jelloAmplitude(9999)).toBeCloseTo(COMPOSITE_TUNING.jelloPx, 12);
  });
});

describe('angularVelocity', () => {
  const out = [0, 0, 0];
  it('is zero for identical orientations', () => {
    expect(angularVelocity(out, [0, 0, 0, 1], [0, 0, 0, 1], 0.01)).toBe(0);
    expect(out).toEqual([0, 0, 0]);
  });

  it('recovers a yaw rate in camera axes whatever the starting orientation', () => {
    const start = qmul(yawQuat(1.1), qmul([Math.sin(0.15), 0, 0, Math.cos(0.15)], [0, 0, Math.sin(0.2), Math.cos(0.2)]));
    const next = qmul(start, yawQuat(0.05));
    const angle = angularVelocity(out, start, next, 0.01);
    expect(angle).toBeCloseTo(0.05, 9);
    expect(out[0]).toBeCloseTo(0, 9);
    expect(out[1]).toBeCloseTo(5, 6);
    expect(out[2]).toBeCloseTo(0, 9);
  });

  it('ignores the quaternion double cover and reverses sign with the turn direction', () => {
    const a = yawQuat(0.3);
    const b = qmul(a, yawQuat(-0.02));
    angularVelocity(out, a, b, 0.004);
    const w1 = out[1];
    angularVelocity(out, a, b.map((x) => -x) as Quat, 0.004);
    expect(out[1]).toBeCloseTo(w1, 9);
    expect(w1).toBeCloseTo(-5, 6);
  });
});

describe('sensor noise model', () => {
  it('is standard normal per channel and independent between channels', () => {
    const N = 20000;
    const s = [0, 0, 0, 0], ss = [0, 0, 0, 0];
    let cross = 0;
    for (let i = 0; i < N; i++) {
      const g = gauss4(i % 200, (i / 200) | 0, 7);
      for (let k = 0; k < 4; k++) { s[k] += g[k]; ss[k] += g[k] * g[k]; }
      cross += g[0] * g[3];
    }
    for (let k = 0; k < 4; k++) {
      expect(Math.abs(s[k] / N)).toBeLessThan(0.03);
      expect(ss[k] / N).toBeGreaterThan(0.95);
      expect(ss[k] / N).toBeLessThan(1.05);
    }
    expect(Math.abs(cross / N)).toBeLessThan(0.03);
  });

  it('varies between frames', () => {
    expect(gauss4(5, 5, 1)).not.toEqual(gauss4(5, 5, 2));
  });

  it('follows videoNoise and grows with the sensor gain the auto exposure applied, up to the cap', () => {
    const maxEv = SENSOR[2];
    expect(sensorSigma(0.3, 6, 0)).toBe(0);
    expect(sensorSigma(0.3, 6, 1)).toBeCloseTo(0.5 * sensorSigma(0.3, 6, 2), 12);
    expect(sensorSigma(0.2, maxEv, 1)).toBeGreaterThan(2 * sensorSigma(0.2, 0, 1));
    expect(sensorSigma(0.2, -6, 1)).toBeCloseTo(sensorSigma(0.2, 0, 1), 12);
    expect(sensorSigma(0.2, 30, 1)).toBeCloseTo(sensorSigma(0.2, maxEv, 1), 12);
    expect(maxEv).toBeLessThanOrEqual(10);
  });

  it('charges the first shutterEv of exposure gain to shutter and aperture, not to the ISO', () => {
    const shutterEv = SENSOR[4];
    expect(sensorSigma(0.2, shutterEv, 1)).toBeCloseTo(sensorSigma(0.2, 0, 1), 12);
    expect(sensorSigma(0.2, shutterEv + 2, 1)).toBeGreaterThan(sensorSigma(0.2, shutterEv, 1));
  });

  it('applies the temporal noise reduction only as the ISO gain rises, down to nrFloor at the cap', () => {
    const [shot, read, maxEv, , shutterEv, nrFloor] = SENSOR;
    const raw = (c: number, gainEv: number): number => {
      const g = 2 ** clamp(gainEv - shutterEv, 0, maxEv - shutterEv);
      return Math.sqrt(shot * c * g + read * read * g);
    };
    expect(sensorSigma(0.1, shutterEv, 1) / raw(0.1, shutterEv)).toBeCloseTo(1, 12);
    expect(sensorSigma(0.1, maxEv, 1) / raw(0.1, maxEv)).toBeCloseTo(nrFloor, 12);
    expect(sensorSigma(0.1, 20, 1)).toBeCloseTo(sensorSigma(0.1, maxEv, 1), 12);
    expect(sensorSigma(0.1, (shutterEv + maxEv) / 2, 1) / raw(0.1, (shutterEv + maxEv) / 2)).toBeCloseTo((1 + nrFloor) / 2, 12);
    expect(nrFloor).toBeGreaterThan(0.2);
    expect(nrFloor).toBeLessThan(0.6);
  });

  it('has Poisson shot statistics: variance linear in the signal on top of the read-noise floor', () => {
    const v = (c: number): number => sensorSigma(c, 8, 1) ** 2;
    expect((v(0.4) - v(0)) / (v(0.1) - v(0))).toBeCloseTo(4, 9);
    expect(v(0)).toBeGreaterThan(0);
  });

  it('keeps the relative grain falling as the signal rises, small by day and visible but bounded at the darkest night', () => {
    const amp = COMPOSITE_TUNING.noiseGain * 0.15;
    const maxEv = SENSOR[2];
    expect(sensorSigma(0.22, 0, amp)).toBeLessThan(0.004);
    let prev = Infinity;
    for (const c of [0.005, 0.02, 0.05, 0.1, 0.2, 0.5, 1]) {
      const rel = sensorSigma(c, maxEv, amp) / c;
      expect(rel).toBeLessThan(prev);
      prev = rel;
    }
    const dark = sensorSigma(0.05, maxEv, amp) / 0.05;
    expect(dark).toBeGreaterThan(0.07);
    expect(dark).toBeLessThan(0.3);
    expect(sensorSigma(0.18, maxEv, amp) / 0.18).toBeLessThan(0.15);
  });

  it('makes the colour noise weaker than the luma noise, at any gain, with no channel bias', () => {
    const N = 6000;
    for (const gainEv of [0, 10]) {
      let luma2 = 0, chroma2 = 0;
      const mean = [0, 0, 0];
      for (let i = 0; i < N; i++) {
        const n = sensorNoise([0.1, 0.1, 0.1], i % 100, (i / 100) | 0, 3, gainEv, 1);
        const m = (n[0] + n[1] + n[2]) / 3;
        luma2 += m * m;
        chroma2 += ((n[0] - m) ** 2 + (n[1] - m) ** 2 + (n[2] - m) ** 2) / 3;
        for (let k = 0; k < 3; k++) mean[k] += n[k];
      }
      const sigma2 = sensorSigma(0.1, gainEv, 1) ** 2;
      expect(chroma2 / N).toBeLessThan(0.25 * (luma2 / N));
      expect(luma2 / N / sigma2).toBeCloseTo(1 - (SENSOR[3] * 2) / 3, 1);
      for (let k = 0; k < 3; k++) expect(Math.abs(mean[k] / N)).toBeLessThan(0.05 * Math.sqrt(sigma2) + 1e-9);
    }
  });
});

describe('low-light grade', () => {
  const num = (name: string): number => Number(videoSrc.match(new RegExp(`const ${name} : f32 = ([^;]+);`))?.[1]);
  const [START, END, DESAT] = ['LOW_LIGHT_START', 'LOW_LIGHT_END', 'LOW_LIGHT_DESAT'].map(num);
  const TINT = nums(videoSrc, /const LOW_LIGHT_TINT : vec3f = vec3f\(([^)]*)\)/);
  const vluma = (e: V3): number => 0.299 * e[0] + 0.587 * e[1] + 0.114 * e[2];
  function grade(e: V3): V3 {
    const y = vluma(e);
    const k = 1 - smooth(START, END, y);
    if (k <= 0) return e;
    const o = e.map((v, i) => (v + (y - v) * DESAT * k) * (1 + (TINT[i] - 1) * k)) as V3;
    return o.map((v) => v * (y / Math.max(vluma(o), 1e-4))) as V3;
  }

  it('leaves everything brighter than LOW_LIGHT_END untouched and keeps the luma of every pixel', () => {
    expect(grade([0.4, 0.3, 0.2])).toEqual([0.4, 0.3, 0.2]);
    for (const e of [[0.05, 0.04, 0.03], [0.1, 0.12, 0.05], [0.02, 0.01, 0.03], [0.2, 0.15, 0.1]] as V3[]) expect(vluma(grade(e))).toBeCloseTo(vluma(e), 9);
  });

  it('thins the chroma and turns a warm dark sky neutral to cool, fully below LOW_LIGHT_START', () => {
    const warm: V3 = [0.02, 0.018, 0.015];
    const g = grade(warm);
    expect(g[2] / g[0]).toBeGreaterThan(warm[2] / warm[0]);
    expect(g[2] / g[0]).toBeGreaterThan(0.95);
    const sat = (c: V3): number => Math.max(...c) - Math.min(...c);
    expect(sat(grade([0.03, 0.01, 0.005]))).toBeLessThan(0.75 * sat([0.03, 0.01, 0.005]));
    expect(START).toBeGreaterThan(0);
    expect(END).toBeLessThan(0.3);
  });

  it('fades in continuously with darkness and never makes black non-black', () => {
    let prev = 0;
    for (let y = 0.3; y > 0.001; y *= 0.93) {
      const d = Math.abs(grade([y * 1.2, y, y * 0.8])[0] / (y * 1.2) - 1);
      expect(d).toBeGreaterThanOrEqual(prev - 1e-9);
      prev = d;
    }
    expect(grade([0, 0, 0])).toEqual([0, 0, 0]);
  });
});

describe('composite stage motion state', () => {
  const stub = (): Record<string, unknown> => ({});
  function harness() {
    const params = new Float32Array(28);
    const device = {
      createBindGroupLayout: stub, createSampler: stub, createPipelineLayout: stub, createRenderPipeline: stub, createBindGroup: stub,
      createBuffer: () => ({ destroy() {} }),
      queue: { writeBuffer: (_b: unknown, _o: number, d: ArrayBuffer) => params.set(new Float32Array(d)) },
    };
    const rc = { device, canvasFormat: 'bgra8unorm', module: stub, settings: { lensDistortion: 0.35, videoNoise: 0.15 }, quality: { bloom: true } };
    const pass = { setPipeline() {}, setBindGroup() {}, draw() {}, end() {} };
    const enc = { beginRenderPass: () => pass };
    const io = { resolved: {}, bloom: {}, exposure: {}, target: {}, debug: 0 };
    const stage = createCompositeStage();
    const frame = (index: number, yaw: number, dt: number, quad: unknown = null) => ({ frameIndex: index, dt, camera: { quat: yawQuat(yaw), fovY: 1.5 }, quad });
    const run = (f: ReturnType<typeof frame>): Float32Array => {
      stage.update!(rc as never, f as never);
      stage.encode(enc as never, rc as never, f as never, { outWidth: 320, outHeight: 180 } as never, io as never);
      return params;
    };
    stage.init(rc as never);
    return { run, frame, params };
  }

  it('does not integrate a repeated frame index again (capture re-encodes the last frame)', () => {
    vi.stubGlobal('GPUShaderStage', { FRAGMENT: 2 });
    vi.stubGlobal('GPUBufferUsage', { UNIFORM: 64, COPY_DST: 8 });
    const { run, frame, params } = harness();
    run(frame(0, 0, 0.004));
    const quad = { motorOmega: [2500, 2500, 2500, 2500] };
    run(frame(1, 0.02, 0.004, quad));
    const first = { omega: params[13], phase: params[17] };
    expect(first.omega).not.toBe(0);
    run(frame(1, 0.02, 0.004, quad));
    expect(params[13]).toBe(first.omega);
    expect(params[17]).toBe(first.phase);
    run(frame(2, 0.04, 0.004, quad));
    expect(params[13]).toBeGreaterThan(first.omega);
    vi.unstubAllGlobals();
  });
});

describe('shader sources', () => {
  const defs = { DITHER_LSB: 1 / 255, OUT_HW_SRGB: true };
  const resolved = resolveShader('post/composite.wgsl', defs);

  it('keeps every file within 250 lines', () => {
    for (const s of [composite, lensSrc, sensorSrc, tonemapSrc, videoSrc]) expect(s.split('\n').length).toBeLessThanOrEqual(250);
  });

  it('resolves to one module with every stage present, no leftover directives and no duplicate top-level names', () => {
    expect(resolved).not.toMatch(/^\s*#(include|ifdef|ifndef|else|endif)/m);
    expect(resolved).not.toContain('${');
    for (const name of ['lensUndistort', 'rollingShift', 'sensorNoise', 'videoPost', 'tonemap', 'tpdfDither', 'srgbEncode', 'vs']) expect(resolved).toContain(`fn ${name}(`);
    const names = [...resolved.matchAll(/^(?:fn|const|struct)\s+(\w+)/gm)].map((m) => m[1]);
    expect(names.filter((n, i) => names.indexOf(n) !== i)).toEqual([]);
  });

  it('binds exactly the resources composite.ts lays out', () => {
    const bindings = [...resolved.matchAll(/@group\((\d+)\) @binding\((\d+)\)/g)].map((m) => `${m[1]}:${m[2]}`);
    expect(bindings).toEqual(['0:0', '0:1', '0:2', '0:3', '0:4']);
    const body = resolved.match(/struct Params \{([^}]*)\}/)![1];
    const fields = body.split('\n').filter((l) => /^\s*\w+\s*:/.test(l));
    expect(fields).toHaveLength(7);
    for (const l of fields) expect(l).toMatch(/:\s*vec4[fu],/);
  });

  it('applies the hardware-sRGB switch and requires the dither define', () => {
    expect(resolved).not.toContain('const DITHER_LSB : f32 = ${');
    expect(resolved).toContain('e = srgbDecode(e);');
    expect(resolveShader('post/composite.wgsl', { DITHER_LSB: 0, OUT_HW_SRGB: false })).not.toContain('e = srgbDecode(e);');
    expect(() => resolveShader('post/composite.wgsl', { OUT_HW_SRGB: false })).toThrow(/DITHER_LSB/);
  });

  it('uses at most eight filtered taps in the fragment path', () => {
    const taps = resolved.match(/textureSampleLevel\(/g)?.length ?? 0;
    const fetches = resolved.match(/\bfetch\(/g)?.length ?? 0;
    expect(taps).toBe(2);
    expect(fetches - 1).toBe(7);
  });
});

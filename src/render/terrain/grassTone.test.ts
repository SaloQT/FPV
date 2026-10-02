import { describe, expect, it } from 'vitest';
import { resolveShader } from '../shaderLib';
import tone from '../shaders/terrain/grass_tone.wgsl?raw';
import terrain from '../shaders/terrain/terrain.wgsl?raw';
import groundColor from '../shaders/terrain/ground_color.wgsl?raw';
import grass from '../shaders/vegetation/grass.wgsl?raw';

// A CPU mirror of grass_tone.wgsl, fed with the constants parsed from the shader source so a retuned shader is tested as it is.
type V2 = [number, number];
const u32 = (x: number): number => x >>> 0;
const mul = (a: number, b: number): number => u32(Math.imul(a, b));

function pcg(v: number): number {
  const s = u32(mul(v, 747796405) + 2891336453);
  const w = mul(((s >>> ((s >>> 28) + 4)) ^ s) >>> 0, 277803737);
  return u32((w >>> 22) ^ w);
}
const u01 = (h: number): number => (h >>> 8) * (1 / 16777216);
const hash21 = (x: number, y: number): number => u01(pcg(u32(x + pcg(u32(y)))));
const smooth = (a: number, b: number, x: number): number => {
  const t = Math.min(Math.max((x - a) / (b - a), 0), 1);
  return t * t * (3 - 2 * t);
};
const mix = (a: number, b: number, t: number): number => a + (b - a) * t;

function value(p: V2): number {
  const ix = Math.floor(p[0]), iy = Math.floor(p[1]);
  const fx = p[0] - ix, fy = p[1] - iy;
  const ux = fx * fx * (3 - 2 * fx), uy = fy * fy * (3 - 2 * fy);
  const r0 = pcg(u32(iy)), r1 = pcg(u32(iy + 1));
  const h = (x: number, r: number): number => u01(pcg(u32(x + r)));
  return mix(mix(h(ix, r0), h(ix + 1, r0), ux), mix(h(ix, r1), h(ix + 1, r1), ux), uy);
}
const visible = (extent: number, size: number): number => 1 - smooth(0.3, 0.8, extent / size);

function clumpTone(xz: V2, fp: number): [number, number, number] {
  const tuft = mix(0.5, value([xz[0] * 2.2, xz[1] * 2.2]), visible(fp, 0.45));
  const swath = mix(0.5, value([xz[0] * 0.55 + 17, xz[1] * 0.55 + 5]), visible(fp, 1.8));
  const k = 0.7 + 0.6 * tuft;
  return [k * mix(0.96, 1.04, swath), k * mix(0.99, 1.01, swath), k * mix(1.07, 0.92, swath)];
}

const dirs = Object.fromEntries([...tone.matchAll(/const GT_DIR_(\w) : vec2f = vec2f\(([-\d.]+), ([-\d.]+)\);/g)].map((m) => [m[1], [Number(m[2]), Number(m[3])] as V2]));
const AMP = Number(/const GT_STREAK_AMP : f32 = ([\d.]+);/.exec(tone)![1]);
const bands = [...tone.matchAll(/([\d.]+) \* gtStreakBand\(xz, GT_DIR_(\w), ([\d.]+), ([\d.]+), fx, fy, ([\d.]+)\)/g)]
  .map((m) => ({ w: Number(m[1]), e1: dirs[m[2]], su: Number(m[3]), sv: Number(m[4]), seed: Number(m[5]) }));
type Band = (typeof bands)[number];
const dot = (a: V2, b: V2): number => a[0] * b[0] + a[1] * b[1];

function streakBand(b: Band, xz: V2, fx: V2, fy: V2): number {
  const e2: V2 = [-b.e1[1], b.e1[0]];
  const wu = Math.abs(dot(fx, b.e1)) + Math.abs(dot(fy, b.e1));
  const wv = Math.abs(dot(fx, e2)) + Math.abs(dot(fy, e2));
  const vis = visible(wu, b.su) * visible(wv, b.sv);
  if (vis < 0.01) return 0;
  return vis * (2 * value([dot(xz, b.e1) / b.su + b.seed, dot(xz, e2) / b.sv + 1.7 * b.seed]) - 1);
}
const streak = (xz: V2, fx: V2, fy: V2): number => bands.reduce((s, b) => s + b.w * streakBand(b, xz, fx, fy), 0);

function samples(n: number): V2[] {
  const out: V2[] = [];
  for (let i = 0; i < n; i++) out.push([(hash21(i, 7) - 0.5) * 3000, (hash21(i, 19) - 0.5) * 3000]);
  return out;
}
const stats = (v: number[]): { mean: number; std: number } => {
  const mean = v.reduce((a, b) => a + b, 0) / v.length;
  return { mean, std: Math.sqrt(v.reduce((a, b) => a + (b - mean) ** 2, 0) / v.length) };
};
const iso = (fp: number): [V2, V2] => [[fp, 0], [0, fp]];
const lum = (c: number[]): number => 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
const pts = samples(6000);

describe('grass_tone.wgsl source', () => {
  it('declares four streak bands, each narrower than it is long, with distinct orientations', () => {
    expect(bands).toHaveLength(4);
    for (const b of bands) {
      expect(b.sv).toBeGreaterThan(b.su);
      expect(Math.hypot(b.e1[0], b.e1[1])).toBeCloseTo(1, 3);
    }
    expect(new Set(bands.map((b) => b.e1.join())).size).toBe(4);
    expect(new Set(bands.map((b) => b.seed)).size).toBe(4);
  });

  it('keeps the streak contrast modest: the albedo multiplier has mean one and 0.5 to 99.5 percent inside +-32 percent', () => {
    expect(AMP).toBeGreaterThan(0.1);
    expect(AMP).toBeLessThanOrEqual(0.25);
    const m = pts.map((p) => 1 + AMP * streak(p, [0.005, 0], [0, 0.005])).sort((a, b) => a - b);
    const s = stats(m);
    expect(Math.abs(s.mean - 1)).toBeLessThan(0.01);
    expect(s.std).toBeGreaterThan(0.05);
    expect(s.std).toBeLessThan(0.14);
    expect(m[Math.floor(0.005 * m.length)]).toBeGreaterThan(0.68);
    expect(m[Math.floor(0.995 * m.length)]).toBeLessThan(1.32);
  });

  it('is the one definition the blades, the terrain and the ground colour module read', () => {
    expect(grass).toContain('#include "terrain/grass_tone.wgsl"');
    expect(groundColor).toContain('#include "terrain/grass_tone.wgsl"');
    expect(grass).toContain('base *= grassClumpTone(b.pos.xz, 0.0);');
    expect(grass).not.toMatch(/fn grassNoise2/);
    expect(terrain).toContain('grassClumpTone(w.xz, fpXZ)');
    expect(terrain).toContain('grassStreak(w.xz, dx.xz, dy.xz)');
    for (const [path, defines] of [['terrain/terrain.wgsl', {}], ['vegetation/grass.wgsl', { NSEG: 7, HAS_TIP: true }]] as const) {
      const src = resolveShader(path, defines);
      expect(src.match(/^fn grassClumpTone/gm)).toHaveLength(1);
      expect(src.match(/^fn gtValue/gm)).toHaveLength(1);
    }
  });
});

describe('value noise', () => {
  it('equals hash21 on lattice points, so the blades keep exactly the tone they had', () => {
    for (let i = 0; i < 50; i++) {
      const x = Math.floor((hash21(i, 3) - 0.5) * 4000), y = Math.floor((hash21(i, 5) - 0.5) * 4000);
      expect(value([x, y])).toBeCloseTo(hash21(x, y), 7);
    }
  });

  it('is continuous and stays in [0, 1]', () => {
    for (const p of pts.slice(0, 500)) {
      const a = value(p), b = value([p[0] + 1e-4, p[1] + 1e-4]);
      expect(a).toBeGreaterThanOrEqual(0);
      expect(a).toBeLessThanOrEqual(1);
      expect(Math.abs(a - b)).toBeLessThan(2e-3);
    }
  });
});

describe('grassClumpTone', () => {
  it('has mean one and a modest spread for a blade (fp 0)', () => {
    const t = pts.map((p) => lum(clumpTone(p, 0)));
    const s = stats(t);
    expect(s.mean).toBeGreaterThan(0.97);
    expect(s.mean).toBeLessThan(1.03);
    expect(s.std).toBeGreaterThan(0.08);
    expect(Math.min(...t)).toBeGreaterThan(0.6);
    expect(Math.max(...t)).toBeLessThan(1.4);
  });

  it('fades to one flat colour, the blades mean, as the pixel outgrows the tufts and swaths', () => {
    const spread = (fp: number): number => stats(pts.map((p) => lum(clumpTone(p, fp)))).std;
    expect(spread(0.15)).toBeLessThan(spread(0));
    expect(spread(0.5)).toBeLessThan(spread(0.15));
    expect(spread(1.5)).toBeLessThan(spread(0.5));
    expect(spread(6)).toBeLessThan(1e-9);
    const flat = clumpTone([12.3, -4.5], 6);
    expect(lum(flat)).toBeGreaterThan(0.99);
    expect(lum(flat)).toBeLessThan(1.01);
  });
});

describe('grassStreak', () => {
  it('has zero mean and fades monotonically to exactly zero as the pixel grows', () => {
    const at = (fp: number): { mean: number; std: number } => stats(pts.map((p) => streak(p, ...iso(fp))));
    const near = at(0.005);
    expect(Math.abs(near.mean)).toBeLessThan(0.03);
    expect(near.std).toBeGreaterThan(0.3);
    let prev = near.std;
    for (const fp of [0.03, 0.1, 0.3, 0.9]) {
      const s = at(fp).std;
      expect(s).toBeLessThan(prev);
      prev = s;
    }
    expect(at(3).std).toBe(0);
  });

  it('keeps a band for a view along its streaks and drops it for a view across them', () => {
    const b = bands[bands.length - 1];
    const e2: V2 = [-b.e1[1], b.e1[0]];
    const scale = (v: V2, k: number): V2 => [v[0] * k, v[1] * k];
    // A grazing pixel, 5 cm wide and 0.5 m deep (1.5 m deep when across) along the view direction.
    const along = stats(pts.map((p) => streakBand(b, p, scale(b.e1, 0.05), scale(e2, 0.5)))).std;
    const across = stats(pts.map((p) => streakBand(b, p, scale(e2, 0.05), scale(b.e1, 1.5)))).std;
    expect(along).toBeGreaterThan(0.2);
    expect(across).toBe(0);
  });

  it('shows no repeat: the field never takes the same value on a lattice stride of its own cell', () => {
    const b = bands[1];
    const e2: V2 = [-b.e1[1], b.e1[0]];
    const small: V2 = [1e-4, 0];
    const a: number[] = [], c: number[] = [];
    for (let i = 0; i < 300; i++) {
      const p: V2 = [pts[i][0], pts[i][1]];
      a.push(streakBand(b, p, small, small));
      c.push(streakBand(b, [p[0] + e2[0] * b.sv * 4, p[1] + e2[1] * b.sv * 4], small, small));
    }
    const ma = stats(a).mean, mc = stats(c).mean;
    let cov = 0;
    for (let i = 0; i < a.length; i++) cov += (a[i] - ma) * (c[i] - mc);
    expect(Math.abs(cov / a.length / (stats(a).std * stats(c).std))).toBeLessThan(0.2);
  });
});

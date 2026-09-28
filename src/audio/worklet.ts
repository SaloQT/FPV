/**
 * The motor synth as an AudioWorkletProcessor, kept as a source string so it ships inline (Blob URL -> addModule) and can
 * also be evaluated in Node for tests. The wavetables are built on the main thread and arrive through processorOptions.
 */
import { MOTOR_PARAM_SPECS, MOTOR_SIDE } from './motorParams';

export const WORKLET_NAME = 'fpv-motor-synth';

export interface WorkletOptions {
  tables: Float32Array;
  size: number;
  levels: number;
  fMin: number;
  seed: number;
}

const DESCRIPTORS = MOTOR_PARAM_SPECS.map((s) => ({
  name: s.name, defaultValue: s.def, minValue: s.min, maxValue: s.max, automationRate: 'k-rate',
}));

const HEAD = `'use strict';
const DESCRIPTORS = ${JSON.stringify(DESCRIPTORS)};
const SIDE = ${JSON.stringify(MOTOR_SIDE)};
const NAMES = DESCRIPTORS.map((d) => d.name);
const NP = NAMES.length;
const TWO_PI = Math.PI * 2;
const I_NOISE = 8, I_FC = 9, I_ROUGH = 10, I_FLUTTER = 11, I_RUMBLE = 12, I_SPREAD = 13;
const WHOOSH_K = 1 / 0.9;

function onePoleCoef(hz, sr) { return 1 - Math.exp((-TWO_PI * hz) / sr); }

class MotorSynthProcessor extends AudioWorkletProcessor {
  static get parameterDescriptors() { return DESCRIPTORS; }

  constructor(options) {
    super();
    const o = options.processorOptions;
    this.tables = o.tables;
    this.size = o.size;
    this.levels = o.levels;
    this.fMin = o.fMin;
    this.stride = o.size + 1;
    this.fCap = o.fMin * Math.pow(2, o.levels) * 0.999;
    this.seed = (o.seed | 0) || 0x2545f491;
    this.phase = new Float64Array(4);
    this.flutterLp = new Float64Array(4);
    this.jitterLp = new Float64Array(4);
    this.base0 = new Int32Array(4);
    this.base1 = new Int32Array(4);
    this.w1 = new Float64Array(4);
    this.f = new Float64Array(4);
    this.df = new Float64Array(4);
    this.a = new Float64Array(4);
    this.da = new Float64Array(4);
    this.gl = new Float64Array(4);
    this.gr = new Float64Array(4);
    this.prev = new Float64Array(NP);
    this.cur = new Float64Array(NP);
    this.primed = false;
    this.svf = new Float64Array(4);
    this.rumbleLp = new Float64Array(3);
    const sr = sampleRate;
    this.flutterA = onePoleCoef(14, sr);
    this.flutterNorm = 1 / Math.sqrt((1 / 3) * this.flutterA / (2 - this.flutterA));
    this.jitterA = onePoleCoef(90, sr);
    this.jitterNorm = 1 / Math.sqrt((1 / 3) * this.jitterA / (2 - this.jitterA));
    this.rumbleA = onePoleCoef(110, sr);
    const b2 = (1 - this.rumbleA) * (1 - this.rumbleA);
    const gain = Math.pow(this.rumbleA, 4) * (1 + b2) / Math.pow(1 - b2, 3);
    this.rumbleNorm = 1 / Math.sqrt(gain / 3);
    this.gustA = onePoleCoef(2.5, sr);
    this.gustNorm = 1 / Math.sqrt((1 / 3) * this.gustA / (2 - this.gustA));
  }

  rand() {
    let s = this.seed;
    s ^= s << 13;
    s ^= s >>> 17;
    s ^= s << 5;
    this.seed = s;
    return (s >>> 0) / 2147483648 - 1;
  }

  selectLevels(m, fa, fb) {
    const fm = Math.min(0.5 * (fa + fb), this.fCap);
    let pos = fm > this.fMin ? Math.log2(fm / this.fMin) : 0;
    const top = this.levels - 1;
    if (pos > top) pos = top;
    const l = Math.floor(pos);
    const up = l < top;
    this.base0[m] = l * this.stride;
    this.base1[m] = (up ? l + 1 : l) * this.stride;
    this.w1[m] = up ? pos - l : 0;
  }

  process(inputs, outputs, parameters) {
    const out = outputs[0];
    const L = out[0];
    const R = out[1];
    const n = L.length;
    const cur = this.cur, prev = this.prev;
    for (let k = 0; k < NP; k++) cur[k] = parameters[NAMES[k]][0];
    if (!this.primed) { prev.set(cur); this.primed = true; }
    let live = cur[I_NOISE] > 1e-6 || prev[I_NOISE] > 1e-6 || cur[I_RUMBLE] > 1e-6 || prev[I_RUMBLE] > 1e-6;
    for (let m = 0; m < 4; m++) live = live || cur[4 + m] > 1e-6 || prev[4 + m] > 1e-6;
    if (!live) {
      L.fill(0);
      R.fill(0);
      prev.set(cur);
      return true;
    }
    this.render(L, R, n);
    prev.set(cur);
    return true;
  }
`;

/** Per-block setup: ramps, level choice, stereo gains and the whoosh filter. */
const BLOCK = `
  render(L, R, n) {
    const cur = this.cur, prev = this.prev;
    const inv = 1 / n;
    const size = this.size, T = this.tables, sr = sampleRate;
    const spread = cur[I_SPREAD];
    for (let m = 0; m < 4; m++) {
      const fa = Math.min(prev[m], this.fCap), fb = Math.min(cur[m], this.fCap);
      this.f[m] = fa;
      this.df[m] = (fb - fa) * inv;
      this.a[m] = prev[4 + m];
      this.da[m] = (cur[4 + m] - prev[4 + m]) * inv;
      this.selectLevels(m, fa, fb);
      const theta = (1 + spread * SIDE[m]) * (Math.PI / 4);
      this.gl[m] = Math.cos(theta);
      this.gr[m] = Math.sin(theta);
    }
    const nA = prev[I_NOISE], dN = (cur[I_NOISE] - nA) * inv;
    const rA = prev[I_RUMBLE], dR = (cur[I_RUMBLE] - rA) * inv;
    const fc = Math.min(Math.max(cur[I_FC], 100), sr * 0.45);
    const g = Math.tan((Math.PI * fc) / sr);
    const a1 = 1 / (1 + g * (g + WHOOSH_K)), a2 = g * a1, a3 = g * a2;
    const rough = cur[I_ROUGH], flutter = cur[I_FLUTTER];
    let noiseAmp = nA, rumbleAmp = rA;
    const svf = this.svf, rl = this.rumbleLp;
    for (let i = 0; i < n; i++) {
      let sumL = 0, sumR = 0;
      for (let m = 0; m < 4; m++) {
        const fl = this.flutterLp[m] += this.flutterA * (this.rand() - this.flutterLp[m]);
        const jt = this.jitterLp[m] += this.jitterA * (this.rand() - this.jitterLp[m]);
        this.f[m] += this.df[m];
        this.a[m] += this.da[m];
        let ph = this.phase[m] + (this.f[m] / sr) * (1 + rough * jt * this.jitterNorm);
        ph -= Math.floor(ph);
        this.phase[m] = ph;
        const x = ph * size;
        const idx = x | 0;
        const fr = x - idx;
        const b0 = this.base0[m] + idx;
        let v = T[b0] + (T[b0 + 1] - T[b0]) * fr;
        const w = this.w1[m];
        if (w > 0) {
          const b1 = this.base1[m] + idx;
          v += (T[b1] + (T[b1 + 1] - T[b1]) * fr - v) * w;
        }
        const mod = 1 + flutter * fl * this.flutterNorm;
        v *= this.a[m] * (mod > 0 ? mod : 0);
        sumL += v * this.gl[m];
        sumR += v * this.gr[m];
      }
`;

/** Per-sample whoosh (band-passed noise, one filter per ear) and the propwash rumble, then the block end. */
const NOISE = `
      noiseAmp += dN;
      rumbleAmp += dR;
      let wl = 0, wr = 0;
      if (noiseAmp > 1e-7) {
        const l3 = this.rand() - svf[1];
        const l1 = a1 * svf[0] + a2 * l3;
        const l2 = svf[1] + a2 * svf[0] + a3 * l3;
        svf[0] = 2 * l1 - svf[0];
        svf[1] = 2 * l2 - svf[1];
        const r3 = this.rand() - svf[3];
        const r1 = a1 * svf[2] + a2 * r3;
        const r2 = svf[3] + a2 * svf[2] + a3 * r3;
        svf[2] = 2 * r1 - svf[2];
        svf[3] = 2 * r2 - svf[3];
        wl = l1 * WHOOSH_K * noiseAmp;
        wr = r1 * WHOOSH_K * noiseAmp;
      }
      rl[0] += this.rumbleA * (this.rand() - rl[0]);
      rl[1] += this.rumbleA * (rl[0] - rl[1]);
      rl[2] += this.gustA * (this.rand() - rl[2]);
      const gust = 1 + 0.45 * rl[2] * this.gustNorm;
      const rum = rl[1] * this.rumbleNorm * rumbleAmp * (gust > 0 ? gust : 0);
      L[i] = sumL + wl + rum;
      R[i] = sumR + wr + rum;
    }
  }
}
registerProcessor(${JSON.stringify(WORKLET_NAME)}, MotorSynthProcessor);
`;

export const WORKLET_SOURCE = HEAD + BLOCK + NOISE;

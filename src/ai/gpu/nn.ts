/**
 * WGSL generators for the PPO learner. Every size is a compile-time constant, so the matrix kernels unroll their register tiles
 * and the compiler knows every loop bound.
 *
 * Networks are tanh MLPs stored as brain.ts lays them out: per layer W row-major [out][in], then b [out]. Activations are
 * row-major [rows][features].
 *
 * One tiled kernel does every matrix product: C(i, j) = sum_p A(i, p) B(p, j), A and B read through strides, staged in
 * workgroup memory, each thread holding an RI x RJ register tile. Its epilogues are:
 *  - fwd:     Y = act(X W^T + b)                       (layer forward, tanh or linear)
 *  - dtanh:   dX = (dY W) * (1 - H^2)                  (back through a layer into the tanh below it)
 *  - partial: dW_z = dY_z^T [X_z | 1]                  (weight and bias gradient of one row chunk; summed by `reduceWgsl`)
 */
import { f32 } from './quadConsts';

export interface Tile {
  TI: number;
  TJ: number;
  TP: number;
  RI: number;
  RJ: number;
}

interface GemmCommon {
  /** Columns of C and the reduction length (for `partial`, the rows in one chunk). */
  J: number;
  P: number;
  /** Rows of C, when bounded (partial); fwd and dtanh need the row count to be a multiple of TI. */
  I?: number;
  /** A(i, p) = A[i * ai + p * ap]; B(p, j) = B[bOff + p * bp + j * bj]. */
  ai: number;
  ap: number;
  bp: number;
  bj: number;
  bOff: number;
  tile: Tile;
}

export type GemmSpec = GemmCommon & (
  | { kind: 'fwd'; biasOff: number; tanh: boolean }
  | { kind: 'dtanh' }
  | { kind: 'partial'; ones: number }
);

const u = (v: number): string => `${Math.round(v)}u`;

export function gemmWgsl(s: GemmSpec): string {
  const { TI, TJ, TP, RI, RJ } = s.tile;
  if (TI % RI || TJ % RJ) throw new Error('register tile must divide the workgroup tile');
  const NT = (TI / RI) * (TJ / RJ);
  const bounded = s.I !== undefined;
  const lines: string[] = [];
  const binds = s.kind === 'fwd'
    ? ['@group(0) @binding(0) var<storage, read> A : array<f32>;', '@group(0) @binding(1) var<storage, read> B : array<f32>;', '@group(0) @binding(2) var<storage, read_write> C : array<f32>;']
    : s.kind === 'dtanh'
      ? ['@group(0) @binding(0) var<storage, read> A : array<f32>;', '@group(0) @binding(1) var<storage, read> B : array<f32>;', '@group(0) @binding(2) var<storage, read> H : array<f32>;', '@group(0) @binding(3) var<storage, read_write> C : array<f32>;']
      : ['@group(0) @binding(0) var<storage, read> A : array<f32>;', '@group(0) @binding(1) var<storage, read> B : array<f32>;', '@group(0) @binding(2) var<storage, read_write> C : array<f32>;'];
  lines.push(...binds);
  lines.push(`var<workgroup> As : array<f32, ${TP * TI}>;`, `var<workgroup> Bs : array<f32, ${TP * TJ}>;`);
  lines.push(`@compute @workgroup_size(${NT})`, 'fn main(@builtin(workgroup_id) wg : vec3u, @builtin(local_invocation_index) lid : u32) {');
  lines.push(`  let i0 = wg.y * ${u(TI)};`, `  let j0 = wg.x * ${u(TJ)};`, `  let pBase = ${s.kind === 'partial' ? `wg.z * ${u(s.P)}` : '0u'};`);
  lines.push(`  let tx = lid % ${u(TJ / RJ)};`, `  let ty = lid / ${u(TJ / RJ)};`);
  for (let r = 0; r < RI; r++) for (let c = 0; c < RJ; c++) lines.push(`  var c${r}_${c} = 0.0;`);
  lines.push(`  for (var p0 = 0u; p0 < ${u(s.P)}; p0 += ${u(TP)}) {`);
  // Stage A: walk the tile along whichever index is contiguous in memory so the loads coalesce.
  const aPFast = s.ap === 1;
  lines.push(`    for (var k = lid; k < ${u(TI * TP)}; k += ${u(NT)}) {`);
  lines.push(aPFast ? `      let p = k % ${u(TP)}; let i = k / ${u(TP)};` : `      let i = k % ${u(TI)}; let p = k / ${u(TI)};`);
  lines.push('      let gi = i0 + i; let gp = p0 + p;');
  lines.push(`      var v = 0.0;`, `      if (${bounded ? `gi < ${u(s.I!)} && ` : ''}gp < ${u(s.P)}) { v = A[gi * ${u(s.ai)} + (pBase + gp) * ${u(s.ap)}]; }`);
  lines.push(`      As[p * ${u(TI)} + i] = v;`, '    }');
  const bJFast = s.bj === 1;
  lines.push(`    for (var k = lid; k < ${u(TJ * TP)}; k += ${u(NT)}) {`);
  lines.push(bJFast ? `      let j = k % ${u(TJ)}; let p = k / ${u(TJ)};` : `      let p = k % ${u(TP)}; let j = k / ${u(TP)};`);
  lines.push('      let gj = j0 + j; let gp = p0 + p;');
  const ones = s.kind === 'partial' && s.ones >= 0;
  lines.push('      var v = 0.0;');
  lines.push(`      if (gj < ${u(s.J)} && gp < ${u(s.P)}) {`);
  if (ones) lines.push(`        if (gj == ${u(s.ones)}) { v = 1.0; } else { v = B[${u(s.bOff)} + (pBase + gp) * ${u(s.bp)} + gj * ${u(s.bj)}]; }`);
  else lines.push(`        v = B[${u(s.bOff)} + (pBase + gp) * ${u(s.bp)} + gj * ${u(s.bj)}];`);
  lines.push('      }', `      Bs[p * ${u(TJ)} + j] = v;`, '    }');
  lines.push('    workgroupBarrier();');
  lines.push(`    for (var p = 0u; p < ${u(TP)}; p++) {`);
  for (let r = 0; r < RI; r++) lines.push(`      let a${r} = As[p * ${u(TI)} + ty * ${u(RI)} + ${u(r)}];`);
  for (let c = 0; c < RJ; c++) lines.push(`      let b${c} = Bs[p * ${u(TJ)} + tx * ${u(RJ)} + ${u(c)}];`);
  for (let r = 0; r < RI; r++) for (let c = 0; c < RJ; c++) lines.push(`      c${r}_${c} = fma(a${r}, b${c}, c${r}_${c});`);
  lines.push('    }', '    workgroupBarrier();', '  }');
  for (let r = 0; r < RI; r++) {
    for (let c = 0; c < RJ; c++) {
      const gi = `(i0 + ty * ${u(RI)} + ${u(r)})`, gj = `(j0 + tx * ${u(RJ)} + ${u(c)})`;
      const cond = `${bounded ? `${gi} < ${u(s.I!)} && ` : ''}${gj} < ${u(s.J)}`;
      const at = `${gi} * ${u(s.J)} + ${gj}`;
      let body: string;
      if (s.kind === 'fwd') {
        const x = `c${r}_${c} + B[${u(s.biasOff)} + ${gj}]`;
        body = `C[${at}] = ${s.tanh ? `tanh(${x})` : x};`;
      } else if (s.kind === 'dtanh') {
        body = `{ let h = H[${at}]; C[${at}] = c${r}_${c} * (1.0 - h * h); }`;
      } else {
        body = `C[wg.z * ${u(s.I! * s.J)} + ${at}] = c${r}_${c};`;
      }
      lines.push(`  if (${cond}) { ${body} }`);
    }
  }
  lines.push('}');
  return lines.join('\n');
}

/** Workgroup grid for a gemm over `rows` rows of C (partial: `rows` is the chunk count). */
export function gemmGrid(s: GemmSpec, rows: number): [number, number, number] {
  const { TI, TJ } = s.tile;
  if (s.kind === 'partial') return [Math.ceil(s.J / TJ), Math.ceil(s.I! / TI), rows];
  if (rows % TI) throw new Error(`${rows} rows is not a multiple of the ${TI}-row tile`);
  return [Math.ceil(s.J / TJ), rows / TI, 1];
}

/** Sums `chunks` partial gradients [chunk][out][in + 1] into the network gradient: W at wOff, then b. */
export function reduceWgsl(out: number, inn: number, chunks: number, wOff: number): string {
  const J = inn + 1;
  return `
@group(0) @binding(0) var<storage, read> part : array<f32>;
@group(0) @binding(1) var<storage, read_write> grad : array<f32>;
@compute @workgroup_size(256)
fn main(@builtin(global_invocation_id) gid : vec3u) {
  let t = gid.x;
  if (t >= ${u(out * J)}) { return; }
  var s = 0.0;
  for (var z = 0u; z < ${u(chunks)}; z++) { s += part[z * ${u(out * J)} + t]; }
  let n = t / ${u(J)};
  let k = t % ${u(J)};
  if (k < ${u(inn)}) { grad[${u(wOff)} + n * ${u(inn)} + k] = s; } else { grad[${u(wOff + out * inn)} + n] = s; }
}`;
}

/** mulberry32 on a local state (the same generator as the game's Rng). */
const RNG = `
fn mb32(st : ptr<function, u32>) -> f32 {
  *st = *st + 0x6d2b79f5u;
  var t = *st;
  t = (t ^ (t >> 15u)) * (t | 1u);
  t = t ^ (t + (t ^ (t >> 7u)) * (t | 61u));
  return f32((t ^ (t >> 14u)) >> 8u) * (1.0 / 16777216.0);
}`;

const HALF_LOG_2PI = 0.9189385332046727;

/**
 * Draws each environment's action from the policy: u = mean + std * noise, action = tanh(u), and the Gaussian log-probability of
 * u (the tanh Jacobian cancels in the PPO ratio, so it is not needed). `rngSlot` is the env field holding the noise stream.
 */
export function sampleWgsl(envs: number, act: number, logStdOff: number, rngSlot: number): string {
  if (act !== 4) throw new Error('sampleWgsl draws four actions');
  return `
@group(0) @binding(0) var<storage, read> mean : array<f32>;
@group(0) @binding(1) var<storage, read> params : array<f32>;
@group(0) @binding(2) var<storage, read_write> E : array<f32>;
@group(0) @binding(3) var<storage, read_write> actions : array<vec4f>;
@group(0) @binding(4) var<storage, read_write> uOut : array<vec4f>;
@group(0) @binding(5) var<storage, read_write> logpOut : array<f32>;
${RNG}
@compute @workgroup_size(64)
fn main(@builtin(global_invocation_id) gid : vec3u) {
  let e = gid.x;
  if (e >= ${u(envs)}) { return; }
  var st = bitcast<u32>(E[${u(rngSlot * envs)} + e]);
  var z : vec4f;
  for (var k = 0u; k < 2u; k++) {
    let a = max(mb32(&st), 1e-7);
    let b = mb32(&st);
    let r = sqrt(-2.0 * log(a));
    z[2u * k] = r * cos(6.283185307179586 * b);
    z[2u * k + 1u] = r * sin(6.283185307179586 * b);
  }
  E[${u(rngSlot * envs)} + e] = bitcast<f32>(st);
  let ls = vec4f(params[${u(logStdOff)}], params[${u(logStdOff + 1)}], params[${u(logStdOff + 2)}], params[${u(logStdOff + 3)}]);
  let m = vec4f(mean[e * 4u], mean[e * 4u + 1u], mean[e * 4u + 2u], mean[e * 4u + 3u]);
  let uu = m + exp(ls) * z;
  uOut[e] = uu;
  actions[e] = tanh(uu);
  logpOut[e] = dot(vec4f(-0.5) * z * z - ls, vec4f(1.0)) - ${f32(4 * HALF_LOG_2PI)};
}`;
}

/** Generalised advantage estimation per environment, back over the rollout's T steps. */
export function gaeWgsl(envs: number, steps: number, gamma: number, lambda: number): string {
  return `
@group(0) @binding(0) var<storage, read> values : array<f32>;
@group(0) @binding(1) var<storage, read> rewards : array<f32>;
@group(0) @binding(2) var<storage, read> dones : array<f32>;
@group(0) @binding(3) var<storage, read_write> adv : array<f32>;
@group(0) @binding(4) var<storage, read_write> ret : array<f32>;
@compute @workgroup_size(64)
fn main(@builtin(global_invocation_id) gid : vec3u) {
  let e = gid.x;
  if (e >= ${u(envs)}) { return; }
  var last = 0.0;
  var next = values[${u(steps * envs)} + e];
  for (var k = 0u; k < ${u(steps)}; k++) {
    let t = ${u(steps - 1)} - k;
    let i = t * ${u(envs)} + e;
    let live = 1.0 - dones[i];
    let v = values[i];
    let delta = rewards[i] + ${f32(gamma)} * next * live - v;
    last = delta + ${f32(gamma * lambda)} * live * last;
    adv[i] = last;
    ret[i] = last + v;
    next = v;
  }
}`;
}

/** One workgroup sums the rollout: advantage mean and std (for normalisation), reward and episode-end totals. */
export function rolloutStatsWgsl(n: number): string {
  return `
@group(0) @binding(0) var<storage, read> adv : array<f32>;
@group(0) @binding(1) var<storage, read> rewards : array<f32>;
@group(0) @binding(2) var<storage, read> dones : array<f32>;
@group(0) @binding(3) var<storage, read_write> stats : array<f32>;
@group(0) @binding(4) var<storage, read_write> metrics : array<f32>;
var<workgroup> red : array<vec4f, 256>;
@compute @workgroup_size(256)
fn main(@builtin(local_invocation_index) lid : u32) {
  var s = vec4f(0.0);
  for (var i = lid; i < ${u(n)}; i += 256u) {
    let a = adv[i];
    s += vec4f(a, a * a, rewards[i], dones[i]);
  }
  red[lid] = s;
  workgroupBarrier();
  for (var w = 128u; w > 0u; w >>= 1u) {
    if (lid < w) { red[lid] += red[lid + w]; }
    workgroupBarrier();
  }
  if (lid == 0u) {
    let t = red[0];
    let m = t.x / ${f32(n)};
    stats[0] = m;
    stats[1] = sqrt(max(t.y / ${f32(n)} - m * m, 0.0)) + 1e-8;
    metrics[8] = t.z;
    metrics[9] = t.w;
    metrics[10] = m;
    metrics[11] = stats[1];
  }
}`;
}

/** Copies one minibatch out of the rollout through a permutation, normalising the advantages. */
export function gatherWgsl(mb: number, obs: number): string {
  return `
@group(0) @binding(0) var<storage, read> perm : array<u32>;
@group(0) @binding(1) var<storage, read> obsAll : array<f32>;
@group(0) @binding(2) var<storage, read> uAll : array<vec4f>;
@group(0) @binding(3) var<storage, read> logpAll : array<f32>;
@group(0) @binding(4) var<storage, read> advAll : array<f32>;
@group(0) @binding(5) var<storage, read> retAll : array<f32>;
@group(0) @binding(6) var<storage, read> stats : array<f32>;
@group(0) @binding(7) var<storage, read_write> mObs : array<f32>;
@group(0) @binding(8) var<storage, read_write> mData : array<vec4f>;
@group(0) @binding(9) var<storage, read_write> mU : array<vec4f>;
@compute @workgroup_size(64)
fn main(@builtin(global_invocation_id) gid : vec3u) {
  let i = gid.x;
  if (i >= ${u(mb)}) { return; }
  let s = perm[i];
  for (var k = 0u; k < ${u(obs)}; k++) { mObs[i * ${u(obs)} + k] = obsAll[s * ${u(obs)} + k]; }
  mU[i] = uAll[s];
  mData[i] = vec4f(logpAll[s], (advAll[s] - stats[0]) / stats[1], retAll[s], 0.0);
}`;
}

export interface LossConfig {
  clip: number;
  vfCoef: number;
  entCoef: number;
}

/**
 * Clipped PPO surrogate and value loss per sample: writes dL/dmean and dL/dvalue (already divided by the minibatch size) and,
 * per workgroup, the summed log-std gradients and loss statistics for `lossFinalWgsl`.
 */
export function lossWgsl(mb: number, logStdOff: number, c: LossConfig): string {
  return `
@group(0) @binding(0) var<storage, read> mean : array<vec4f>;
@group(0) @binding(1) var<storage, read> value : array<f32>;
@group(0) @binding(2) var<storage, read> mU : array<vec4f>;
@group(0) @binding(3) var<storage, read> mData : array<vec4f>;
@group(0) @binding(4) var<storage, read> params : array<f32>;
@group(0) @binding(5) var<storage, read_write> dMean : array<vec4f>;
@group(0) @binding(6) var<storage, read_write> dValue : array<f32>;
@group(0) @binding(7) var<storage, read_write> part : array<vec4f>;
var<workgroup> redA : array<vec4f, 256>;
var<workgroup> redB : array<vec4f, 256>;
@compute @workgroup_size(256)
fn main(@builtin(global_invocation_id) gid : vec3u, @builtin(local_invocation_index) lid : u32, @builtin(workgroup_id) wg : vec3u) {
  let i = gid.x;
  let ls = vec4f(params[${u(logStdOff)}], params[${u(logStdOff + 1)}], params[${u(logStdOff + 2)}], params[${u(logStdOff + 3)}]);
  let inv = exp(-ls);
  let d = mData[i];
  let z = (mU[i] - mean[i]) * inv;
  let logp = dot(vec4f(-0.5) * z * z - ls, vec4f(1.0)) - ${f32(4 * HALF_LOG_2PI)};
  let lr = logp - d.x;
  let ratio = exp(lr);
  let A = d.y;
  let s1 = ratio * A;
  let s2 = clamp(ratio, ${f32(1 - c.clip)}, ${f32(1 + c.clip)}) * A;
  let g = select(0.0, -A * ratio, s1 <= s2);
  let k = 1.0 / ${f32(mb)};
  dMean[i] = (g * k) * z * inv;
  let dv = value[i] - d.z;
  dValue[i] = ${f32(c.vfCoef)} * dv * k;
  redA[lid] = (g * k) * (z * z - vec4f(1.0));
  redB[lid] = vec4f(-min(s1, s2), 0.5 * dv * dv, (ratio - 1.0) - lr, select(0.0, 1.0, abs(ratio - 1.0) > ${f32(c.clip)}));
  workgroupBarrier();
  for (var w = 128u; w > 0u; w >>= 1u) {
    if (lid < w) {
      redA[lid] += redA[lid + w];
      redB[lid] += redB[lid + w];
    }
    workgroupBarrier();
  }
  if (lid == 0u) {
    part[wg.x * 2u] = redA[0];
    part[wg.x * 2u + 1u] = redB[0];
  }
}`;
}

/** Sums the loss kernel's workgroup partials: the log-std gradient (with the entropy bonus) and the minibatch statistics. */
export function lossFinalWgsl(groups: number, mb: number, logStdOff: number, entCoef: number): string {
  return `
@group(0) @binding(0) var<storage, read> part : array<vec4f>;
@group(0) @binding(1) var<storage, read_write> grad : array<f32>;
@group(0) @binding(2) var<storage, read_write> metrics : array<f32>;
var<workgroup> redA : array<vec4f, 256>;
var<workgroup> redB : array<vec4f, 256>;
@compute @workgroup_size(256)
fn main(@builtin(local_invocation_index) lid : u32) {
  var a = vec4f(0.0);
  var b = vec4f(0.0);
  for (var g = lid; g < ${u(groups)}; g += 256u) {
    a += part[g * 2u];
    b += part[g * 2u + 1u];
  }
  redA[lid] = a;
  redB[lid] = b;
  workgroupBarrier();
  for (var w = 128u; w > 0u; w >>= 1u) {
    if (lid < w) {
      redA[lid] += redA[lid + w];
      redB[lid] += redB[lid + w];
    }
    workgroupBarrier();
  }
  if (lid == 0u) {
    let ga = redA[0] - vec4f(${f32(entCoef)});
    for (var k = 0u; k < 4u; k++) { grad[${u(logStdOff)} + k] = ga[k]; }
    let s = redB[0] / ${f32(mb)};
    metrics[12] += s.x;
    metrics[13] += s.y;
    metrics[14] += s.z;
    metrics[15] += s.w;
    metrics[19] += 1.0;
  }
}`;
}

/** Squared gradient norm of one network into norms[slot]; adds the norm to metrics[16 + slot]. */
export function normWgsl(count: number, slot: number): string {
  return `
@group(0) @binding(0) var<storage, read> grad : array<f32>;
@group(0) @binding(1) var<storage, read_write> norms : array<f32>;
@group(0) @binding(2) var<storage, read_write> metrics : array<f32>;
var<workgroup> red : array<f32, 256>;
@compute @workgroup_size(256)
fn main(@builtin(local_invocation_index) lid : u32) {
  var s = 0.0;
  for (var i = lid; i < ${u(count)}; i += 256u) { let g = grad[i]; s += g * g; }
  red[lid] = s;
  workgroupBarrier();
  for (var w = 128u; w > 0u; w >>= 1u) {
    if (lid < w) { red[lid] += red[lid + w]; }
    workgroupBarrier();
  }
  if (lid == 0u) {
    norms[${u(slot)}] = red[0];
    metrics[${u(16 + slot)}] += sqrt(red[0]);
  }
}`;
}

export interface AdamConfig {
  beta1: number;
  beta2: number;
  eps: number;
  maxNorm: number;
}

/** Counts one optimiser step: opt[0] = t, opt[1] = 1 - beta1^t, opt[2] = 1 - beta2^t. */
export function adamTickWgsl(c: AdamConfig): string {
  return `
@group(0) @binding(0) var<storage, read_write> opt : array<f32>;
@compute @workgroup_size(1)
fn main() {
  let t = opt[0] + 1.0;
  opt[0] = t;
  opt[1] = 1.0 - pow(${f32(c.beta1)}, t);
  opt[2] = 1.0 - pow(${f32(c.beta2)}, t);
}`;
}

/**
 * Adam with the gradient clipped to `maxNorm` (global norm of this network). Parameters at or after `clampFrom` (the log
 * standard deviations) are kept within [clampLo, clampHi].
 */
export function adamWgsl(count: number, slot: number, c: AdamConfig, clampFrom = -1, clampLo = 0, clampHi = 0): string {
  return `
struct Lr { lr : f32, p0 : f32, p1 : f32, p2 : f32 }
@group(0) @binding(0) var<storage, read_write> params : array<f32>;
@group(0) @binding(1) var<storage, read> grad : array<f32>;
@group(0) @binding(2) var<storage, read_write> m1 : array<f32>;
@group(0) @binding(3) var<storage, read_write> m2 : array<f32>;
@group(0) @binding(4) var<storage, read> norms : array<f32>;
@group(0) @binding(5) var<storage, read> opt : array<f32>;
@group(0) @binding(6) var<uniform> L : Lr;
@compute @workgroup_size(256)
fn main(@builtin(global_invocation_id) gid : vec3u) {
  let i = gid.x;
  if (i >= ${u(count)}) { return; }
  let norm = sqrt(norms[${u(slot)}]);
  let scale = min(1.0, ${f32(c.maxNorm)} / (norm + 1e-6));
  let g = grad[i] * scale;
  let a = ${f32(c.beta1)} * m1[i] + ${f32(1 - c.beta1)} * g;
  let b = ${f32(c.beta2)} * m2[i] + ${f32(1 - c.beta2)} * g * g;
  m1[i] = a;
  m2[i] = b;
  var p = params[i] - L.lr * (a / opt[1]) / (sqrt(b / opt[2]) + ${f32(c.eps)});
  ${clampFrom >= 0 ? `if (i >= ${u(clampFrom)}) { p = clamp(p, ${f32(clampLo)}, ${f32(clampHi)}); }` : ''}
  params[i] = p;
}`;
}

/** One workgroup sums the environments' iteration statistics into metrics[0..7] and clears them. */
export function envStatsWgsl(envs: number, firstSlot: number, count: number, bestSlot: number): string {
  return `
@group(0) @binding(0) var<storage, read_write> E : array<f32>;
@group(0) @binding(1) var<storage, read_write> metrics : array<f32>;
var<workgroup> red : array<array<f32, ${count}>, 256>;
@compute @workgroup_size(256)
fn main(@builtin(local_invocation_index) lid : u32) {
  var s : array<f32, ${count}>;
  for (var k = 0u; k < ${u(count)}; k++) { s[k] = 0.0; }
  s[${u(bestSlot - firstSlot)}] = 3.0e38;
  for (var e = lid; e < ${u(envs)}; e += 256u) {
    for (var k = 0u; k < ${u(count)}; k++) {
      let at = (${u(firstSlot)} + k) * ${u(envs)} + e;
      if (k == ${u(bestSlot - firstSlot)}) {
        s[k] = min(s[k], E[at]);
        E[at] = 3.0e38;
      } else {
        s[k] += E[at];
        E[at] = 0.0;
      }
    }
  }
  red[lid] = s;
  workgroupBarrier();
  for (var w = 128u; w > 0u; w >>= 1u) {
    if (lid < w) {
      for (var k = 0u; k < ${u(count)}; k++) {
        if (k == ${u(bestSlot - firstSlot)}) { red[lid][k] = min(red[lid][k], red[lid + w][k]); } else { red[lid][k] += red[lid + w][k]; }
      }
    }
    workgroupBarrier();
  }
  if (lid == 0u) {
    for (var k = 0u; k < ${u(count)}; k++) { metrics[k] = red[0][k]; }
  }
}`;
}

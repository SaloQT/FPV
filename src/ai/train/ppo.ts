/**
 * PPO on the GPU. Rollouts, advantages, minibatching and every optimiser step stay on the device; each iteration is one queue
 * submission and the host reads back only a few dozen numbers of statistics.
 *
 * Rollout step t (T per iteration): actor and critic forward on obs[t], sample actions, step every environment
 * PHYSICS_PER_ACTION physics steps (writing obs[t+1], reward[t], done[t]). Then: critic on obs[T] for the bootstrap value, GAE,
 * advantage statistics. Update: for each epoch and minibatch, gather the minibatch through a permutation, forward both networks,
 * PPO loss, back-propagation (split-K weight gradients), gradient-norm clipping and Adam.
 */
import { ACT_SIZE, OBS_SIZE } from '../spec';
import { DEFAULT_RATES, type RateProfile } from '../../sim/fc/rates';
import { QUAD_5IN_6S } from '../../sim/presets';
import { Rng } from '../../sim/math3d';
import { actorSizes, criticSizes, makeBrain, paramCount, type Brain, type BrainStats } from '../brain';
import { DEFAULT_ENV, checkTraceEnvs, envShader, envSlot, type EnvConfig } from '../gpu/envKernel';
import { ENV_LAYOUT } from '../gpu/envState';
import { QUAD_LAYOUT } from '../gpu/quadState';
import {
  WORLD_GROUP, bindGroup, compileModule, dispatch, pipeline, readBuffer, storageBuffer, uniformBuffer, type BindKind, type Binding,
} from '../gpu/gpu';
import {
  adamTickWgsl, adamWgsl, envStatsWgsl, gaeWgsl, gatherWgsl, gemmGrid, gemmWgsl, lossFinalWgsl, lossWgsl, normWgsl, reduceWgsl,
  rolloutStatsWgsl, sampleWgsl, type GemmSpec, type Tile,
} from '../gpu/nn';
import { packWorlds, type TrainWorld } from './worlds';
import { uploadWorlds } from './worldGpu';
import type { IterationTrace } from './trace';

export interface PpoConfig {
  envs: number;
  /** Rollout length per iteration, policy steps. */
  steps: number;
  epochs: number;
  minibatches: number;
  gamma: number;
  lambda: number;
  clip: number;
  vfCoef: number;
  entCoef: number;
  lr: number;
  /** Learning rate reached at `lrIterations` (linear decay); equal to `lr` for a constant rate. */
  lrEnd: number;
  lrIterations: number;
  maxNorm: number;
  hidden: number[];
  logStdInit: number;
  seed: number;
  /** Rows per split-K chunk of the weight-gradient kernels. */
  chunk: number;
  /**
   * Drones whose every step comes back with the metrics for the training dashboard (a multiple of 16, at most envs; 0 = none).
   * See src/ai/train/trace.ts.
   */
  traceEnvs: number;
}

export const DEFAULT_PPO: PpoConfig = {
  envs: 16384,
  steps: 32,
  epochs: 4,
  minibatches: 8,
  gamma: 0.995,
  lambda: 0.95,
  clip: 0.2,
  vfCoef: 0.5,
  entCoef: 0.001,
  lr: 3e-4,
  lrEnd: 3e-4,
  lrIterations: 1,
  maxNorm: 0.5,
  hidden: [128, 128],
  logStdInit: -0.7,
  seed: 1,
  chunk: 1024,
  traceEnvs: 0,
};

/** Statistics of one iteration (sums over every environment and every minibatch step). */
export interface IterationMetrics {
  iteration: number;
  envSteps: number;
  episodes: number;
  crashes: number;
  gates: number;
  finishes: number;
  laps: number;
  meanReturn: number;
  meanLength: number;
  bestLap: number;
  rewardPerStep: number;
  policyLoss: number;
  valueLoss: number;
  approxKl: number;
  clipFraction: number;
  actorGradNorm: number;
  criticGradNorm: number;
  logStd: number[];
  gpuMs: number;
  /** Positions and flags of the traced drones over this iteration's steps (when traceEnvs > 0). */
  trace?: IterationTrace;
}

/** Staging bytes before the trace: the metrics (128) and logStd (16), padded. */
const STAGING_HEAD = 256;

interface Layer {
  inn: number;
  out: number;
  wOff: number;
  bOff: number;
}

interface Net {
  sizes: number[];
  layers: Layer[];
  count: number;
  params: GPUBuffer;
  grad: GPUBuffer;
  m1: GPUBuffer;
  m2: GPUBuffer;
}

function layersOf(sizes: number[]): Layer[] {
  const out: Layer[] = [];
  let o = 0;
  for (let l = 0; l + 1 < sizes.length; l++) {
    const inn = sizes[l], n = sizes[l + 1];
    out.push({ inn, out: n, wOff: o, bOff: o + n * inn });
    o += n * inn + n;
  }
  return out;
}

/** Orthogonal initialisation (rows or columns orthonormal, scaled by `gain`), biases zero; the PPO default. */
export function initNetwork(sizes: number[], gains: number[], rng: Rng, extra = 0): Float32Array {
  const p = new Float32Array(paramCount(sizes) + extra);
  layersOf(sizes).forEach((L, l) => {
    const rows = L.out, cols = L.inn;
    const tall = rows > cols;
    const n = tall ? cols : rows, m = tall ? rows : cols;
    const v: Float64Array[] = [];
    for (let i = 0; i < n; i++) {
      const x = new Float64Array(m);
      for (let k = 0; k < m; k++) x[k] = rng.gauss();
      for (const y of v) {
        let d = 0;
        for (let k = 0; k < m; k++) d += x[k] * y[k];
        for (let k = 0; k < m; k++) x[k] -= d * y[k];
      }
      let s = 0;
      for (let k = 0; k < m; k++) s += x[k] * x[k];
      s = 1 / Math.sqrt(s);
      for (let k = 0; k < m; k++) x[k] *= s;
      v.push(x);
    }
    for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) p[L.wOff + r * cols + c] = gains[l] * (tall ? v[c][r] : v[r][c]);
  });
  return p;
}

function fwdTile(J: number, P: number): Tile {
  const TP = P % 16 === 0 ? 16 : P % 8 === 0 ? 8 : 1;
  return J >= 64 ? { TI: 64, TJ: 64, TP, RI: 4, RJ: 4 } : { TI: 128, TJ: J, TP, RI: 2, RJ: J };
}

function partialTile(out: number): Tile {
  return out >= 64 ? { TI: 64, TJ: 64, TP: 16, RI: 4, RJ: 4 } : out >= 4 ? { TI: out, TJ: 64, TP: 16, RI: 1, RJ: 4 } : { TI: 1, TJ: 64, TP: 16, RI: 1, RJ: 1 };
}

function fwdSpec(L: Layer, tanh: boolean): GemmSpec {
  return { kind: 'fwd', J: L.out, P: L.inn, ai: L.inn, ap: 1, bp: 1, bj: L.inn, bOff: L.wOff, biasOff: L.bOff, tanh, tile: fwdTile(L.out, L.inn) };
}

function dtanhSpec(L: Layer): GemmSpec {
  return { kind: 'dtanh', J: L.inn, P: L.out, ai: L.out, ap: 1, bp: L.inn, bj: 1, bOff: L.wOff, tile: { TI: 64, TJ: 64, TP: Math.min(16, L.out), RI: 4, RJ: 4 } };
}

function partialSpec(L: Layer, chunk: number): GemmSpec {
  return { kind: 'partial', I: L.out, J: L.inn + 1, P: chunk, ai: 1, ap: L.out, bp: L.inn, bj: 1, bOff: 0, ones: L.inn, tile: partialTile(L.out) };
}

interface Step {
  p: GPUComputePipeline;
  g: GPUBindGroup[];
  grid: [number, number, number];
}

export class PpoTrainer {
  iteration = 0;
  envSteps = 0;
  readonly actor: Net;
  readonly critic: Net;
  private readonly rollout: Step[] = [];
  private readonly update: Step[][] = [];
  private readonly finish: Step[] = [];
  private readonly perm: GPUBuffer;
  private readonly permData: Uint32Array;
  private readonly lrBuf: GPUBuffer;
  private readonly metrics: GPUBuffer;
  private readonly obsR: GPUBuffer;
  private readonly staging: GPUBuffer[];
  private readonly rng: Rng;
  private readonly samples: number;
  private readonly mb: number;
  private stagingIndex = 0;

  private constructor(
    readonly device: GPUDevice,
    readonly cfg: PpoConfig,
    readonly env: EnvConfig,
    readonly rates: RateProfile,
    private readonly bufs: Record<string, GPUBuffer>,
    actor: Net,
    critic: Net,
  ) {
    this.actor = actor;
    this.critic = critic;
    this.samples = cfg.envs * cfg.steps;
    this.mb = this.samples / cfg.minibatches;
    this.perm = bufs.perm;
    this.permData = new Uint32Array(cfg.epochs * this.samples);
    this.lrBuf = bufs.lr;
    this.metrics = bufs.metrics;
    this.obsR = bufs.obsR;
    this.rng = new Rng(cfg.seed * 7919 + 13);
    const size = STAGING_HEAD + this.traceBytes();
    this.staging = [0, 1].map(() => device.createBuffer({ size, usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ }));
  }

  /** Bytes of one iteration's trace (all steps). */
  private traceBytes(): number {
    return (this.cfg.traceEnvs ?? 0) * this.cfg.steps * 16;
  }

  static check(cfg: PpoConfig): void {
    const samples = cfg.envs * cfg.steps;
    const mb = samples / cfg.minibatches;
    if (cfg.envs % 128) throw new Error('envs must be a multiple of 128');
    if (!Number.isInteger(mb) || mb % 256 || mb % cfg.chunk) throw new Error(`minibatch of ${mb} samples must be a multiple of 256 and of the ${cfg.chunk}-row chunk`);
    if (cfg.chunk % 16) throw new Error('chunk must be a multiple of 16');
    checkTraceEnvs(cfg.traceEnvs ?? 0, cfg.envs);
  }

  static async create(device: GPUDevice, worlds: TrainWorld[], cfg: PpoConfig = DEFAULT_PPO, env: EnvConfig = DEFAULT_ENV, init?: Brain): Promise<PpoTrainer> {
    PpoTrainer.check(cfg);
    const { envs: N, steps: T } = cfg;
    const samples = N * T, MB = samples / cfg.minibatches;
    const rates = init?.rates ?? DEFAULT_RATES;
    const hidden = init?.hidden ?? cfg.hidden;
    const rng = new Rng(cfg.seed);
    const aSizes = actorSizes(hidden), cSizes = criticSizes(hidden);
    const aCount = paramCount(aSizes) + ACT_SIZE, cCount = paramCount(cSizes);
    let aInit: Float32Array, cInit: Float32Array;
    if (init) {
      aInit = new Float32Array(aCount);
      aInit.set(init.actor);
      aInit.set(init.logStd, aCount - ACT_SIZE);
      cInit = new Float32Array(init.critic);
    } else {
      aInit = initNetwork(aSizes, [...hidden.map(() => Math.SQRT2), 0.01], rng, ACT_SIZE);
      // Start near hover: tanh(bias) puts the throttle stick at the game's hover throttle (0.32).
      aInit[layersOf(aSizes).at(-1)!.bOff + 3] = Math.atanh(2 * 0.32 - 1);
      aInit.fill(cfg.logStdInit, aCount - ACT_SIZE);
      cInit = initNetwork(cSizes, [...hidden.map(() => Math.SQRT2), 1], rng);
    }
    const sb = (data: ArrayBufferView | number, label: string): GPUBuffer => storageBuffer(device, data, label);
    const net = (sizes: number[], count: number, initP: Float32Array, label: string): Net => ({
      sizes, layers: layersOf(sizes), count,
      params: sb(initP, `${label}-params`), grad: sb(count * 4, `${label}-grad`), m1: sb(count * 4, `${label}-m1`), m2: sb(count * 4, `${label}-m2`),
    });
    const actor = net(aSizes, aCount, aInit, 'actor');
    const critic = net(cSizes, cCount, cInit, 'critic');
    const maxH = Math.max(...hidden);
    const chunks = MB / cfg.chunk;
    const maxPart = Math.max(...[...actor.layers, ...critic.layers].map((L) => L.out * (L.inn + 1)));
    const bufs: Record<string, GPUBuffer> = {
      S: sb(QUAD_LAYOUT.slots * N * 4, 'quad-state'),
      E: sb(ENV_LAYOUT.slots * N * 4, 'env-state'),
      envU: uniformBuffer(device, 16, 'env-uniform'),
      actions: sb(N * 16, 'actions'),
      obsR: sb((T + 1) * N * OBS_SIZE * 4, 'rollout-obs'),
      obsTmp: sb(N * OBS_SIZE * 4, 'obs-carry'),
      uR: sb(samples * 16, 'rollout-u'),
      logpR: sb(samples * 4, 'rollout-logp'),
      valR: sb((T + 1) * N * 4, 'rollout-values'),
      rewR: sb(samples * 4, 'rollout-rewards'),
      doneR: sb(samples * 4, 'rollout-dones'),
      advR: sb(samples * 4, 'rollout-adv'),
      retR: sb(samples * 4, 'rollout-ret'),
      meanR: sb(N * 16, 'rollout-mean'),
      perm: sb(cfg.epochs * samples * 4, 'perm'),
      mObs: sb(MB * OBS_SIZE * 4, 'mb-obs'),
      mU: sb(MB * 16, 'mb-u'),
      mData: sb(MB * 16, 'mb-data'),
      mMean: sb(MB * 16, 'mb-mean'),
      mValue: sb(MB * 4, 'mb-value'),
      dMean: sb(MB * 16, 'mb-dmean'),
      dValue: sb(MB * 4, 'mb-dvalue'),
      dA: sb(MB * maxH * 4, 'mb-dA'),
      dB: sb(MB * maxH * 4, 'mb-dB'),
      part: sb(chunks * maxPart * 4, 'grad-partials'),
      lossPart: sb((MB / 256) * 32, 'loss-partials'),
      norms: sb(16, 'grad-norms'),
      opt: sb(16, 'adam-step'),
      lr: uniformBuffer(device, 16, 'lr'),
      stats: sb(16, 'adv-stats'),
      metrics: sb(32 * 4, 'metrics'),
    };
    const K = cfg.traceEnvs ?? 0;
    if (K > 0) bufs.trace = sb(T * K * 16, 'trace');
    const hR = [hidden.map((h, l) => sb(N * h * 4, `rollout-actor-h${l}`)), hidden.map((h, l) => sb(N * h * 4, `rollout-critic-h${l}`))];
    const hM = [hidden.map((h, l) => sb(MB * h * 4, `mb-actor-h${l}`)), hidden.map((h, l) => sb(MB * h * 4, `mb-critic-h${l}`))];
    const t = new PpoTrainer(device, cfg, env, rates, bufs, actor, critic);
    await t.build(worlds, hR, hM, chunks);
    return t;
  }

  private async build(worlds: TrainWorld[], hR: GPUBuffer[][], hM: GPUBuffer[][], chunks: number): Promise<void> {
    const d = this.device, c = this.cfg, b = this.bufs;
    const N = c.envs, T = c.steps, MB = this.mb, samples = this.samples;
    const modules = new Map<string, Promise<GPUComputePipeline>>();
    const make = (code: string, kinds: BindKind[][], label: string, entry = 'main'): Promise<GPUComputePipeline> => {
      const key = `${entry}\n${code}`;
      let p = modules.get(key);
      if (!p) {
        p = compileModule(d, code, label).then((m) => pipeline(d, m, entry, kinds));
        modules.set(key, p);
      }
      return p;
    };
    const gemmKinds = (s: GemmSpec): BindKind[][] => [s.kind === 'dtanh' ? ['ro', 'ro', 'ro', 'rw'] : ['ro', 'ro', 'rw']];
    const step = async (code: string, kinds: BindKind[][], entries: (Binding | null)[][], grid: [number, number, number], label: string, entry = 'main'): Promise<Step> => {
      const p = await make(code, kinds, label, entry);
      return { p, g: entries.map((e, i) => bindGroup(d, p, i, e, label)), grid };
    };
    const gemm = (s: GemmSpec, entries: Binding[], rows: number, label: string): Promise<Step> => step(gemmWgsl(s), gemmKinds(s), [entries], gemmGrid(s, rows), label);
    const slice = (buf: GPUBuffer, index: number, bytes: number): Binding => ({ buffer: buf, offset: index * bytes, size: bytes });

    // Environments
    const world = uploadWorlds(d, packWorlds(worlds));
    const K = c.traceEnvs ?? 0;
    const envCode = envShader({ envs: N, worlds: worlds.length, quad: QUAD_5IN_6S, rates: this.rates, env: this.env, traceEnvs: K });
    // With a trace, binding 7 is this step's slice of it (offsets t * K * 16 bytes: K % 16 == 0 keeps them 256-aligned).
    const envKinds: BindKind[][] = [['rw', 'rw', 'ro', 'rw', 'rw', 'rw', 'uniform', ...(K > 0 ? ['rw' as const] : [])], WORLD_GROUP];
    d.queue.writeBuffer(b.envU, 0, new Uint32Array([c.seed >>> 0, 0, 0, 0]));
    const traceSlice = (t: number): Binding[] => (K > 0 ? [slice(b.trace, t, K * 16)] : []);
    const envGroups = (t: number): (Binding | null)[][] => [
      [b.S, b.E, b.actions, slice(b.obsR, t + 1, N * OBS_SIZE * 4), slice(b.rewR, t, N * 4), slice(b.doneR, t, N * 4), b.envU, ...traceSlice(t)],
      world.entries,
    ];
    const init = await step(envCode, envKinds, [[b.S, b.E, b.actions, slice(b.obsR, 0, N * OBS_SIZE * 4), slice(b.rewR, 0, N * 4), slice(b.doneR, 0, N * 4), b.envU, ...traceSlice(0)], world.entries], [N / 64, 1, 1], 'env-init', 'initEnvs');
    this.pendingInit = init;

    const forward = async (net: Net, k: number, x: Binding, hs: GPUBuffer[], out: Binding, rows: number, tag: string): Promise<Step[]> => {
      const steps: Step[] = [];
      for (let l = 0; l < net.layers.length; l++) {
        const L = net.layers[l];
        const last = l === net.layers.length - 1;
        steps.push(await gemm(fwdSpec(L, !last), [l === 0 ? x : hs[l - 1], net.params, last ? out : hs[l]], rows, `${tag}-fwd${k}${l}`));
      }
      return steps;
    };
    const rngSlot = envSlot('rngPol');
    const logStdOff = this.actor.count - ACT_SIZE;
    const sample = sampleWgsl(N, ACT_SIZE, logStdOff, rngSlot);
    const sampleKinds: BindKind[][] = [['ro', 'ro', 'rw', 'rw', 'rw', 'rw']];
    for (let t = 0; t < T; t++) {
      const obs = slice(b.obsR, t, N * OBS_SIZE * 4);
      this.rollout.push(...await forward(this.actor, 0, obs, hR[0], b.meanR, N, 'roll'));
      this.rollout.push(...await forward(this.critic, 1, obs, hR[1], slice(b.valR, t, N * 4), N, 'roll'));
      this.rollout.push(await step(sample, sampleKinds, [[b.meanR, this.actor.params, b.E, b.actions, slice(b.uR, t, N * 16), slice(b.logpR, t, N * 4)]], [N / 64, 1, 1], 'sample'));
      this.rollout.push(await step(envCode, envKinds, envGroups(t), [N / 64, 1, 1], 'env-step', 'stepEnvs'));
    }
    // Bootstrap value, advantages, statistics
    this.finish.push(...await forward(this.critic, 1, slice(b.obsR, T, N * OBS_SIZE * 4), hR[1], slice(b.valR, T, N * 4), N, 'boot'));
    this.finish.push(await step(gaeWgsl(N, T, c.gamma, c.lambda), [['ro', 'ro', 'ro', 'rw', 'rw']], [[b.valR, b.rewR, b.doneR, b.advR, b.retR]], [N / 64, 1, 1], 'gae'));
    this.finish.push(await step(rolloutStatsWgsl(samples), [['ro', 'ro', 'ro', 'rw', 'rw']], [[b.advR, b.rewR, b.doneR, b.stats, b.metrics]], [1, 1, 1], 'rollout-stats'));
    const first = envSlot('sEpisodes');
    this.finish.push(await step(envStatsWgsl(N, first, 8, envSlot('sBestLap')), [['rw', 'rw']], [[b.E, b.metrics]], [1, 1, 1], 'env-stats'));

    // Update
    const gather = gatherWgsl(MB, OBS_SIZE);
    const loss = lossWgsl(MB, logStdOff, c);
    const lossFinal = lossFinalWgsl(MB / 256, MB, logStdOff, c.entCoef);
    const adamCfg = { beta1: 0.9, beta2: 0.999, eps: 1e-5, maxNorm: c.maxNorm };
    const tick = await step(adamTickWgsl(adamCfg), [['rw']], [[b.opt]], [1, 1, 1], 'adam-tick');
    const backward = async (net: Net, k: number, dOut: GPUBuffer): Promise<Step[]> => {
      const steps: Step[] = [];
      let dCur: GPUBuffer = dOut;
      for (let l = net.layers.length - 1; l >= 0; l--) {
        const L = net.layers[l];
        const x = l === 0 ? b.mObs : hM[k][l - 1];
        steps.push(await gemm(partialSpec(L, c.chunk), [dCur, x, b.part], chunks, `dW${k}${l}`));
        steps.push(await step(reduceWgsl(L.out, L.inn, chunks, L.wOff), [['ro', 'rw']], [[b.part, net.grad]], [Math.ceil((L.out * (L.inn + 1)) / 256), 1, 1], `reduce${k}${l}`));
        if (l > 0) {
          const dNext = dCur === b.dA ? b.dB : b.dA;
          const s = dtanhSpec(L);
          steps.push(await step(gemmWgsl(s), gemmKinds(s), [[dCur, net.params, hM[k][l - 1], dNext]], gemmGrid(s, MB), `dX${k}${l}`));
          dCur = dNext;
        }
      }
      return steps;
    };
    const fwdA = await forward(this.actor, 0, b.mObs, hM[0], b.mMean, MB, 'mb');
    const fwdC = await forward(this.critic, 1, b.mObs, hM[1], b.mValue, MB, 'mb');
    const lossStep = await step(loss, [['ro', 'ro', 'ro', 'ro', 'ro', 'rw', 'rw', 'rw']], [[b.mMean, b.mValue, b.mU, b.mData, this.actor.params, b.dMean, b.dValue, b.lossPart]], [MB / 256, 1, 1], 'loss');
    const finalStep = await step(lossFinal, [['ro', 'rw', 'rw']], [[b.lossPart, this.actor.grad, b.metrics]], [1, 1, 1], 'loss-final');
    const bwA = await backward(this.actor, 0, b.dMean);
    const bwC = await backward(this.critic, 1, b.dValue);
    const norm = async (net: Net, slot: number): Promise<Step> => step(normWgsl(net.count, slot), [['ro', 'rw', 'rw']], [[net.grad, b.norms, b.metrics]], [1, 1, 1], `norm${slot}`);
    const adamKinds: BindKind[][] = [['rw', 'ro', 'rw', 'rw', 'ro', 'ro', 'uniform']];
    const adam = async (net: Net, slot: number, clampFrom: number): Promise<Step> =>
      step(adamWgsl(net.count, slot, adamCfg, clampFrom, -3, 0.5), adamKinds, [[net.params, net.grad, net.m1, net.m2, b.norms, b.opt, b.lr]], [Math.ceil(net.count / 256), 1, 1], `adam${slot}`);
    const tail = [await norm(this.actor, 0), await norm(this.critic, 1), tick, await adam(this.actor, 0, logStdOff), await adam(this.critic, 1, -1)];
    const gatherKinds: BindKind[][] = [['ro', 'ro', 'ro', 'ro', 'ro', 'ro', 'ro', 'rw', 'rw', 'rw']];
    for (let k = 0; k < c.epochs * c.minibatches; k++) {
      const g = await step(gather, gatherKinds, [[slice(b.perm, k, MB * 4), b.obsR, b.uR, b.logpR, b.advR, b.retR, b.stats, b.mObs, b.mData, b.mU]], [MB / 64, 1, 1], 'gather');
      this.update.push([g, ...fwdA, ...fwdC, lossStep, finalStep, ...bwA, ...bwC, ...tail]);
    }
    this.probeSteps = this.update[0].slice(0, this.update[0].length - tail.length);
  }

  private pendingInit: Step | null = null;
  private probeSteps: Step[] = [];

  /**
   * Gradient check: one rollout, then the first minibatch's loss and back-propagation without the optimiser step. Returns the
   * minibatch, the parameters and the gradients the GPU computed, for comparison with a CPU reference.
   */
  async probeGradients(): Promise<{ obs: Float32Array; u: Float32Array; data: Float32Array; actor: Float32Array; critic: Float32Array; actorGrad: Float32Array; criticGrad: Float32Array }> {
    const d = this.device;
    this.shuffle();
    const enc = d.createCommandEncoder();
    const pass = enc.beginComputePass();
    if (this.pendingInit) {
      this.run(pass, this.pendingInit);
      this.pendingInit = null;
    }
    for (const s of this.rollout) this.run(pass, s);
    for (const s of this.finish) this.run(pass, s);
    for (const s of this.probeSteps) this.run(pass, s);
    pass.end();
    d.queue.submit([enc.finish()]);
    const f = async (b: GPUBuffer): Promise<Float32Array> => new Float32Array(await readBuffer(d, b));
    const b = this.bufs;
    return { obs: await f(b.mObs), u: await f(b.mU), data: await f(b.mData), actor: await f(this.actor.params), critic: await f(this.critic.params), actorGrad: await f(this.actor.grad), criticGrad: await f(this.critic.grad) };
  }

  private run(pass: GPUComputePassEncoder, s: Step): void {
    dispatch(pass, s.p, s.g, ...s.grid);
  }

  private shuffle(): void {
    const n = this.samples, p = this.permData, r = this.rng;
    for (let e = 0; e < this.cfg.epochs; e++) {
      const o = e * n;
      for (let i = 0; i < n; i++) p[o + i] = i;
      for (let i = n - 1; i > 0; i--) {
        const j = Math.floor(r.next() * (i + 1));
        const t = p[o + i];
        p[o + i] = p[o + j];
        p[o + j] = t;
      }
    }
    this.device.queue.writeBuffer(this.perm, 0, p);
  }

  /** Runs one iteration (rollout + update) and returns its statistics. */
  async iterate(): Promise<IterationMetrics> {
    const d = this.device, c = this.cfg;
    const frac = Math.min(1, this.iteration / Math.max(1, c.lrIterations));
    d.queue.writeBuffer(this.lrBuf, 0, new Float32Array([c.lr + (c.lrEnd - c.lr) * frac, 0, 0, 0]));
    this.shuffle();
    const enc = d.createCommandEncoder();
    enc.clearBuffer(this.metrics);
    const pass = enc.beginComputePass();
    if (this.pendingInit) {
      this.run(pass, this.pendingInit);
      this.pendingInit = null;
    }
    for (const s of this.rollout) this.run(pass, s);
    for (const s of this.finish) this.run(pass, s);
    for (const u of this.update) for (const s of u) this.run(pass, s);
    pass.end();
    const N = c.envs, T = c.steps, obsBytes = N * OBS_SIZE * 4;
    // The last observation starts the next rollout (via a scratch copy: a buffer cannot copy into itself).
    enc.copyBufferToBuffer(this.obsR, T * obsBytes, this.bufs.obsTmp, 0, obsBytes);
    enc.copyBufferToBuffer(this.bufs.obsTmp, 0, this.obsR, 0, obsBytes);
    const staging = this.staging[this.stagingIndex];
    this.stagingIndex ^= 1;
    enc.copyBufferToBuffer(this.metrics, 0, staging, 0, 128);
    enc.copyBufferToBuffer(this.actor.params, (this.actor.count - ACT_SIZE) * 4, staging, 128, 16);
    const traceBytes = this.traceBytes();
    if (traceBytes > 0) enc.copyBufferToBuffer(this.bufs.trace, 0, staging, STAGING_HEAD, traceBytes);
    const t0 = performance.now();
    d.queue.submit([enc.finish()]);
    await staging.mapAsync(GPUMapMode.READ);
    const gpuMs = performance.now() - t0;
    const mapped = staging.getMappedRange();
    const m = new Float32Array(mapped.slice(0, STAGING_HEAD));
    const trace: IterationTrace | undefined = traceBytes > 0 ? { K: c.traceEnvs, T, data: new Float32Array(mapped.slice(STAGING_HEAD, STAGING_HEAD + traceBytes)) } : undefined;
    staging.unmap();
    this.iteration++;
    this.envSteps += N * T;
    const updates = Math.max(1, m[19]);
    const episodes = m[0];
    return {
      iteration: this.iteration,
      envSteps: this.envSteps,
      episodes,
      crashes: m[1],
      gates: m[2],
      finishes: m[3],
      laps: m[4],
      meanReturn: episodes > 0 ? m[5] / episodes : 0,
      meanLength: episodes > 0 ? m[6] / episodes : 0,
      bestLap: m[7] < 1e30 ? m[7] : 0,
      rewardPerStep: m[8] / (N * T),
      policyLoss: m[12] / updates,
      valueLoss: m[13] / updates,
      approxKl: m[14] / updates,
      clipFraction: m[15] / updates,
      actorGradNorm: m[16] / updates,
      criticGradNorm: m[17] / updates,
      logStd: Array.from(m.subarray(32, 36)),
      gpuMs,
      ...(trace ? { trace } : {}),
    };
  }

  /** The current networks as a brain file. */
  async exportBrain(name: string, stats: Partial<BrainStats>): Promise<Brain> {
    const a = new Float32Array(await readBuffer(this.device, this.actor.params));
    const cr = new Float32Array(await readBuffer(this.device, this.critic.params));
    const n = this.actor.count - ACT_SIZE;
    return makeBrain({
      name,
      hidden: this.actor.sizes.slice(1, -1),
      rates: this.rates,
      actor: a.slice(0, n),
      logStd: a.slice(n, n + ACT_SIZE),
      critic: cr.slice(0, this.critic.count),
      stats: { steps: this.envSteps, iterations: this.iteration, ...stats },
    });
  }
}

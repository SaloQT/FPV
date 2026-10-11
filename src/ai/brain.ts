/**
 * A drone brain: a tanh MLP actor (observation -> squashed stick action) plus the critic it was trained with, saved as JSON with
 * base64 float32 weights. The GPU trainer writes the same parameter layout it trains (src/ai/gpu/nn.ts, src/ai/train/ppo.ts), so a checkpoint is
 * a straight copy of its buffers.
 *
 * Parameter layout of one network with layer sizes [n0, n1, ..., nk]: for each layer l, W_l row-major [n_{l+1}][n_l], then b_l
 * [n_{l+1}]. Hidden layers use tanh; the output layer is linear. The actor's action is tanh(output) (the mean of a tanh-squashed
 * Gaussian whose log standard deviations are `logStd`).
 */
import type { RateProfile } from '../sim/fc/rates';
import { DEFAULT_RATES } from '../sim/fc/rates';
import { ACT_SIZE, BRAIN_PHYSICS_HZ, LEGACY_OBS_SIZE, OBS_SIZE, POLICY_HZ, UNRECORDED_EPISODE_LIMITS, type EpisodeLimits } from './spec';

export const BRAIN_FORMAT = 'fpv-brain';
export const BRAIN_VERSION = 1;

export interface BrainStats {
  /** Environment steps (policy decisions) trained on. */
  steps: number;
  iterations: number;
  seconds: number;
  /** Mean gates per simulated minute in the last training iteration. */
  gatesPerMinute: number;
  /** Best lap time seen in training, s (0 = no lap yet). */
  bestLap: number;
  /** Lap time of the deterministic evaluation flight in the real sim, s (0 = not completed). */
  evalLap: number;
  meanReturn: number;
}

export interface Brain {
  format: typeof BRAIN_FORMAT;
  version: number;
  name: string;
  created: string;
  obs: number;
  act: number;
  hidden: number[];
  policyHz: number;
  physicsHz: number;
  quad: string;
  rates: RateProfile;
  stats: BrainStats;
  /** When its training ended episodes early and where it started them; brains saved before this was recorded leave it out. */
  episode?: EpisodeLimits;
  actor: Float32Array;
  critic: Float32Array;
  logStd: Float32Array;
}

/** The limits a brain trained under (see EpisodeLimits). */
export function episodeLimits(b: Brain): EpisodeLimits {
  return b.episode ?? { ...UNRECORDED_EPISODE_LIMITS };
}

function limitsOf(raw: unknown): EpisodeLimits | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const { stallSeconds, ceiling, respawn } = raw as Record<string, unknown>;
  const ok = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v) && v > 0;
  if (!ok(stallSeconds) || !ok(ceiling) || (respawn !== 'last-gate' && respawn !== 'next-gate')) return undefined;
  return { stallSeconds, ceiling, respawn };
}

/** Layer sizes of the actor and critic for the given hidden widths, reading `obs` inputs. */
export function actorSizes(hidden: readonly number[], obs = OBS_SIZE): number[] {
  return [obs, ...hidden, ACT_SIZE];
}

export function criticSizes(hidden: readonly number[], obs = OBS_SIZE): number[] {
  return [obs, ...hidden, 1];
}

/** Whether the brain reads the obstacle slots (brains saved before obstacle sensing read only the first LEGACY_OBS_SIZE). */
export function senses(b: Brain): boolean {
  return b.obs > LEGACY_OBS_SIZE;
}

/**
 * The brain's networks laid out for OBS_SIZE inputs, to train on from: an older brain's first layers get zero weights on the
 * slots it never read, so it flies exactly as before until training moves them.
 */
export function widenInputs(b: Brain): { actor: Float32Array; critic: Float32Array } {
  const widen = (p: Float32Array): Float32Array => {
    const h = b.hidden[0], out = new Float32Array(p.length + h * (OBS_SIZE - b.obs));
    for (let r = 0; r < h; r++) out.set(p.subarray(r * b.obs, (r + 1) * b.obs), r * OBS_SIZE);
    out.set(p.subarray(h * b.obs), h * OBS_SIZE);
    return out;
  };
  return { actor: widen(b.actor), critic: widen(b.critic) };
}

export function paramCount(sizes: readonly number[]): number {
  let n = 0;
  for (let l = 0; l + 1 < sizes.length; l++) n += sizes[l + 1] * sizes[l] + sizes[l + 1];
  return n;
}

export function emptyStats(): BrainStats {
  return { steps: 0, iterations: 0, seconds: 0, gatesPerMinute: 0, bestLap: 0, evalLap: 0, meanReturn: 0 };
}

/** A brain with the given weights; checks every array length against the layout. */
export function makeBrain(init: Partial<Omit<Brain, 'stats'>> & { stats?: Partial<BrainStats> } & Pick<Brain, 'actor' | 'critic' | 'logStd' | 'hidden'>): Brain {
  const b: Brain = {
    format: BRAIN_FORMAT,
    version: BRAIN_VERSION,
    name: init.name ?? 'brain',
    created: init.created ?? new Date().toISOString(),
    obs: init.obs ?? OBS_SIZE,
    act: ACT_SIZE,
    hidden: [...init.hidden],
    policyHz: init.policyHz ?? POLICY_HZ,
    physicsHz: init.physicsHz ?? BRAIN_PHYSICS_HZ,
    quad: init.quad ?? 'QUAD_5IN_6S',
    rates: init.rates ?? DEFAULT_RATES,
    stats: { ...emptyStats(), ...init.stats },
    ...(init.episode ? { episode: { ...init.episode } } : {}),
    actor: init.actor,
    critic: init.critic,
    logStd: init.logStd,
  };
  validate(b);
  return b;
}

function validate(b: Brain): void {
  if (b.format !== BRAIN_FORMAT) throw new Error('not a drone brain file');
  if (b.version !== BRAIN_VERSION) throw new Error(`brain version ${b.version} is not supported (expected ${BRAIN_VERSION})`);
  if ((b.obs !== OBS_SIZE && b.obs !== LEGACY_OBS_SIZE) || b.act !== ACT_SIZE) {
    throw new Error(`brain sees ${b.obs} inputs and makes ${b.act} outputs; this game uses ${OBS_SIZE} (${LEGACY_OBS_SIZE} before obstacle sensing) and ${ACT_SIZE}`);
  }
  if (b.policyHz !== POLICY_HZ) throw new Error(`brain decides at ${b.policyHz} Hz; this game runs brains at ${POLICY_HZ} Hz`);
  if (!b.hidden.length || b.hidden.some((h) => !Number.isInteger(h) || h < 1 || h > 4096)) throw new Error('bad hidden layer sizes');
  if (b.actor.length !== paramCount(actorSizes(b.hidden, b.obs))) throw new Error('actor weights do not match the layer sizes');
  if (b.critic.length !== paramCount(criticSizes(b.hidden, b.obs))) throw new Error('critic weights do not match the layer sizes');
  if (b.logStd.length !== ACT_SIZE) throw new Error('logStd must hold one value per action');
  for (const a of [b.actor, b.critic, b.logStd]) for (let i = 0; i < a.length; i++) if (!Number.isFinite(a[i])) throw new Error('brain weights contain a non-finite value');
}

function toBase64(a: Float32Array): string {
  const bytes = new Uint8Array(a.buffer, a.byteOffset, a.byteLength);
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

function fromBase64(s: string): Float32Array {
  const bin = atob(s);
  if (bin.length % 4 !== 0) throw new Error('weight data is not float32');
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new Float32Array(bytes.buffer);
}

export function serializeBrain(b: Brain): string {
  validate(b);
  const { actor, critic, logStd, ...meta } = b;
  return JSON.stringify({ ...meta, actor: toBase64(actor), critic: toBase64(critic), logStd: Array.from(logStd) }, null, 1);
}

export function parseBrain(text: string): Brain {
  let raw: Record<string, unknown>;
  try {
    raw = JSON.parse(text) as Record<string, unknown>;
  } catch {
    throw new Error('brain file is not valid JSON');
  }
  if (raw.format !== BRAIN_FORMAT) throw new Error('not a drone brain file');
  const { episode, ...rest } = raw;
  const limits = limitsOf(episode);
  const b = {
    ...rest,
    hidden: Array.isArray(raw.hidden) ? raw.hidden.map(Number) : [],
    stats: { ...emptyStats(), ...(raw.stats as Partial<BrainStats>) },
    ...(limits ? { episode: limits } : {}),
    actor: fromBase64(String(raw.actor ?? '')),
    critic: fromBase64(String(raw.critic ?? '')),
    logStd: new Float32Array(Array.isArray(raw.logStd) ? raw.logStd.map(Number) : []),
  } as unknown as Brain;
  validate(b);
  return b;
}

/** Runs a network: `x` in, the last layer's linear output written to `out`. Scratch buffers come from `scratch`. */
export function runMlp(params: Float32Array, sizes: readonly number[], x: ArrayLike<number>, out: Float64Array, scratch: Float64Array[]): void {
  let input: ArrayLike<number> = x;
  let o = 0;
  const last = sizes.length - 2;
  for (let l = 0; l <= last; l++) {
    const nIn = sizes[l], nOut = sizes[l + 1];
    const y = l === last ? out : scratch[l];
    const bo = o + nOut * nIn;
    for (let r = 0; r < nOut; r++) {
      let acc = params[bo + r];
      const w = o + r * nIn;
      for (let c = 0; c < nIn; c++) acc += params[w + c] * input[c];
      y[r] = l === last ? acc : Math.tanh(acc);
    }
    o = bo + nOut;
    input = y;
  }
}

/** In-game policy: the squashed mean action, or with `noise` added before the squash a sample as the trainer draws one. */
export class BrainPolicy {
  readonly sizes: number[];
  private readonly scratch: Float64Array[];
  private readonly raw = new Float64Array(ACT_SIZE);

  constructor(readonly brain: Brain) {
    this.sizes = actorSizes(brain.hidden, brain.obs);
    this.scratch = brain.hidden.map((h) => new Float64Array(h));
  }

  act(obs: ArrayLike<number>, out: Float64Array, noise?: ArrayLike<number>): Float64Array {
    runMlp(this.brain.actor, this.sizes, obs, this.raw, this.scratch);
    for (let i = 0; i < ACT_SIZE; i++) out[i] = Math.tanh(noise ? this.raw[i] + noise[i] : this.raw[i]);
    return out;
  }
}

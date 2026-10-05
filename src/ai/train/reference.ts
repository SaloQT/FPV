/**
 * CPU reference of the PPO loss and its gradient, in float64, for checking the GPU learner. Same loss as nn.ts:
 *   L = mean_i( -min(r_i A_i, clip(r_i) A_i) + vfCoef * 0.5 (V_i - R_i)^2 ) - entCoef * sum(logStd)
 * with r_i = exp(logp_new(u_i) - logp_old_i) for the stored pre-squash action u_i.
 */
import { ACT_SIZE, OBS_SIZE } from '../spec';
import { actorSizes, criticSizes, paramCount } from '../brain';

export interface LossTerms {
  clip: number;
  vfCoef: number;
  entCoef: number;
}

interface Pass {
  acts: Float64Array[];
}

function forward(p: ArrayLike<number>, sizes: number[], x: ArrayLike<number>): Pass {
  const acts: Float64Array[] = [Float64Array.from(x)];
  let o = 0;
  for (let l = 0; l + 1 < sizes.length; l++) {
    const nIn = sizes[l], nOut = sizes[l + 1];
    const y = new Float64Array(nOut);
    const bo = o + nOut * nIn;
    const last = l + 2 === sizes.length;
    for (let r = 0; r < nOut; r++) {
      let a = p[bo + r];
      for (let c = 0; c < nIn; c++) a += p[o + r * nIn + c] * acts[l][c];
      y[r] = last ? a : Math.tanh(a);
    }
    acts.push(y);
    o = bo + nOut;
  }
  return { acts };
}

/** Adds dL/dparams for one sample given dL/d(output) into `g`. */
function backward(p: ArrayLike<number>, sizes: number[], f: Pass, dOut: Float64Array, g: Float64Array): void {
  const offs: number[] = [];
  let o = 0;
  for (let l = 0; l + 1 < sizes.length; l++) {
    offs.push(o);
    o += sizes[l + 1] * sizes[l] + sizes[l + 1];
  }
  let d = dOut;
  for (let l = sizes.length - 2; l >= 0; l--) {
    const nIn = sizes[l], nOut = sizes[l + 1], w = offs[l], bo = w + nOut * nIn;
    const x = f.acts[l];
    for (let r = 0; r < nOut; r++) {
      g[bo + r] += d[r];
      for (let c = 0; c < nIn; c++) g[w + r * nIn + c] += d[r] * x[c];
    }
    if (l === 0) break;
    const dx = new Float64Array(nIn);
    for (let c = 0; c < nIn; c++) {
      let s = 0;
      for (let r = 0; r < nOut; r++) s += d[r] * p[w + r * nIn + c];
      dx[c] = s * (1 - x[c] * x[c]);
    }
    d = dx;
  }
}

const HALF_LOG_2PI = 0.5 * Math.log(2 * Math.PI);

/**
 * Loss and gradients over `n` samples. `obs` [n][OBS], `u` [n][4], `data` [n][4] = (old logp, normalised advantage, return, -).
 * `actor` holds the actor parameters followed by the four log standard deviations.
 */
export function ppoReference(actor: ArrayLike<number>, critic: ArrayLike<number>, hidden: number[], obs: ArrayLike<number>, u: ArrayLike<number>, data: ArrayLike<number>, n: number, c: LossTerms): { loss: number; actor: Float64Array; critic: Float64Array } {
  const aS = actorSizes(hidden), cS = criticSizes(hidden);
  const ls0 = paramCount(aS);
  const gA = new Float64Array(ls0 + ACT_SIZE), gC = new Float64Array(paramCount(cS));
  let loss = 0;
  for (let i = 0; i < n; i++) {
    const x = Array.prototype.slice.call(obs, i * OBS_SIZE, (i + 1) * OBS_SIZE) as number[];
    const fa = forward(actor, aS, x), fc = forward(critic, cS, x);
    const mean = fa.acts.at(-1)!, v = fc.acts.at(-1)![0];
    const oldLogp = data[i * 4], A = data[i * 4 + 1], R = data[i * 4 + 2];
    let logp = 0;
    const z = new Float64Array(ACT_SIZE);
    for (let a = 0; a < ACT_SIZE; a++) {
      const ls = actor[ls0 + a];
      z[a] = (u[i * 4 + a] - mean[a]) * Math.exp(-ls);
      logp += -0.5 * z[a] * z[a] - ls - HALF_LOG_2PI;
    }
    const ratio = Math.exp(logp - oldLogp);
    const s1 = ratio * A, s2 = Math.min(Math.max(ratio, 1 - c.clip), 1 + c.clip) * A;
    loss += (-Math.min(s1, s2) + c.vfCoef * 0.5 * (v - R) ** 2) / n;
    const g = s1 <= s2 ? -A * ratio : 0;
    const dMean = new Float64Array(ACT_SIZE);
    for (let a = 0; a < ACT_SIZE; a++) {
      const inv = Math.exp(-actor[ls0 + a]);
      dMean[a] = (g / n) * z[a] * inv;
      gA[ls0 + a] += (g / n) * (z[a] * z[a] - 1);
    }
    backward(actor, aS, fa, dMean, gA);
    backward(critic, cS, fc, Float64Array.of((c.vfCoef * (v - R)) / n), gC);
  }
  for (let a = 0; a < ACT_SIZE; a++) {
    loss -= c.entCoef * actor[ls0 + a];
    gA[ls0 + a] -= c.entCoef;
  }
  return { loss, actor: gA, critic: gC };
}

import { describe, expect, it } from 'vitest';
import { Rng } from '../../sim/math3d';
import { actorSizes, criticSizes, paramCount } from '../brain';
import { ACT_SIZE, OBS_SIZE } from '../spec';
import { initNetwork } from './ppo';
import { ppoReference } from './reference';

describe('PPO reference gradient', () => {
  it('matches finite differences of its own loss', () => {
    const hidden = [6, 5];
    const rng = new Rng(3);
    const actor = Array.from(initNetwork(actorSizes(hidden), [1.2, 1.2, 0.5], rng, ACT_SIZE));
    for (let a = 0; a < ACT_SIZE; a++) actor[paramCount(actorSizes(hidden)) + a] = -0.5 + 0.1 * a;
    const critic = Array.from(initNetwork(criticSizes(hidden), [1.2, 1.2, 1], rng));
    const n = 5;
    const obs = Array.from({ length: n * OBS_SIZE }, () => rng.gauss() * 0.5);
    const u = Array.from({ length: n * 4 }, () => rng.gauss() * 0.6);
    // old log-probs near the current ones, so some samples sit inside the clip range and some outside
    const data: number[] = [];
    for (let i = 0; i < n; i++) data.push(-3 + 0.4 * rng.gauss(), rng.gauss(), rng.gauss() * 2, 0);
    const terms = { clip: 0.2, vfCoef: 0.5, entCoef: 0.01 };
    const ref = ppoReference(actor, critic, hidden, obs, u, data, n, terms);
    const h = 1e-6;
    const check = (params: number[], grad: Float64Array, isActor: boolean): void => {
      for (let k = 0; k < params.length; k += 7) {
        const keep = params[k];
        params[k] = keep + h;
        const up = ppoReference(isActor ? params : actor, isActor ? critic : params, hidden, obs, u, data, n, terms).loss;
        params[k] = keep - h;
        const dn = ppoReference(isActor ? params : actor, isActor ? critic : params, hidden, obs, u, data, n, terms).loss;
        params[k] = keep;
        expect(grad[k]).toBeCloseTo((up - dn) / (2 * h), 5);
      }
    };
    check(actor, ref.actor, true);
    check(critic, ref.critic, false);
  });
});

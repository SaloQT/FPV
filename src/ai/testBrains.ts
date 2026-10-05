/** Test helpers: brains with seeded random weights. */
import { Rng } from '../sim/math3d';
import { actorSizes, criticSizes, makeBrain, paramCount, type Brain } from './brain';

/** A small brain with seeded random weights. */
export function randomBrain(hidden: number[] = [8, 8], seed = 3, scale = 0.3): Brain {
  const rng = new Rng(seed);
  const fill = (n: number): Float32Array => Float32Array.from({ length: n }, () => scale * rng.gauss());
  return makeBrain({ name: 'test', hidden, actor: fill(paramCount(actorSizes(hidden))), critic: fill(paramCount(criticSizes(hidden))), logStd: new Float32Array([-1, -1, -1, -1]) });
}

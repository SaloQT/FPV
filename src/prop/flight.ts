/**
 * Flies a trained brain around a track with a given prop fitted, in the game's own sim, and reports lap time, crashes and
 * battery used. Same loop as evaluateBrain (src/ai/train/evaluate.ts) with the quad swapped for one carrying the prop.
 */
import type { Brain } from '../ai/brain';
import { BrainRacer } from '../ai/racer';
import { BRAIN_PHYSICS_HZ } from '../ai/spec';
import type { TrainWorld } from '../ai/train/worlds';
import { QUAD_5IN_6S } from '../sim/presets';
import type { PropDesign } from './design';
import { quadWithProp } from './fit';

export interface FlightReport {
  gates: number;
  laps: number;
  crashes: number;
  stalls: number;
  /** Race time when finished, s, else NaN. */
  finish: number;
  /** Sim seconds flown. */
  seconds: number;
  /** Battery drawn, mAh. */
  mah: number;
}

export function flyBrainWithProp(brain: Brain, world: TrainWorld, d: PropDesign, opts: { seconds?: number; seed?: number } = {}): FlightReport {
  const racer = new BrainRacer(brain, { ground: world.ground, groundHeightAt: world.ground.groundHeightAt, track: world.track, colliders: world.colliders }, {
    seed: opts.seed ?? 1,
    config: quadWithProp(QUAD_5IN_6S, d),
  });
  racer.go = true;
  const dt = 1 / BRAIN_PHYSICS_HZ;
  const steps = Math.round((opts.seconds ?? 120) * BRAIN_PHYSICS_HZ);
  let gates = 0, laps = 0;
  for (let i = 0; i < steps && !racer.finished; i++) {
    const ev = racer.step(dt);
    if (ev === 'gate' || ev === 'lap' || ev === 'finish') gates++;
    if (ev === 'lap' || ev === 'finish') laps++;
  }
  return {
    gates, laps, crashes: racer.crashes, stalls: racer.stalls, finish: racer.finishedAt, seconds: racer.time,
    mah: racer.physics.battery.mah,
  };
}

/**
 * One number for a prop on a set of worlds: the mean finish time, with a 12 s penalty for each gate not reached and 4 s for
 * each crash, so a prop the brain can't fly sorts below one it can.
 */
export function flightScore(runs: readonly FlightReport[], totalGates: number): number {
  let sum = 0;
  for (const r of runs) {
    const missed = Math.max(0, totalGates - r.gates);
    sum += (Number.isFinite(r.finish) ? r.finish : r.seconds) + missed * 12 + r.crashes * 4;
  }
  return sum / Math.max(1, runs.length);
}

/**
 * Flies a brain through a race in the game's own TypeScript sim (QuadPhysics, BrainPilot, GateTimer, the session's respawn
 * rules), deterministically: the number the brain menu and the spectator race should agree with.
 */
import { createRaceSnapshot } from '../../game/gateTimer';
import type { Brain } from '../brain';
import { BrainRacer } from '../racer';
import { BRAIN_PHYSICS_HZ } from '../spec';
import type { TrainWorld } from './worlds';

export interface EvalResult {
  name: string;
  gates: number;
  laps: number;
  crashes: number;
  /** Put back at the last gate after STALL_RESPAWN_S without a gate. */
  stalls: number;
  /** Race time when finished, s, else NaN. */
  finish: number;
  bestLap: number;
  /** Sim seconds flown. */
  seconds: number;
  /** Wall-clock ms the flight took. */
  wallMs: number;
}

export function evaluateBrain(brain: Brain, world: TrainWorld, opts: { seconds?: number; windSpeed?: number; seed?: number } = {}): EvalResult {
  const wind = opts.windSpeed ?? 0;
  const calm = wind <= 0;
  const racer = new BrainRacer(brain, { ground: world.ground, groundHeightAt: world.ground.groundHeightAt, track: world.track, colliders: world.colliders }, {
    seed: opts.seed ?? 1,
    wind: { meanSpeed: wind, turbulence: calm ? 0 : 1, gustsPerMinute: calm ? 0 : 1.5 },
  });
  racer.go = true;
  const dt = 1 / BRAIN_PHYSICS_HZ;
  const steps = Math.round((opts.seconds ?? 120) * BRAIN_PHYSICS_HZ);
  let gates = 0, laps = 0;
  const t0 = performance.now();
  for (let i = 0; i < steps && !racer.finished; i++) {
    const ev = racer.step(dt);
    if (ev === 'gate' || ev === 'lap' || ev === 'finish') gates++;
    if (ev === 'lap' || ev === 'finish') laps++;
  }
  const snap = racer.timer.fill(createRaceSnapshot(), racer.time);
  return {
    name: brain.name, gates, laps, crashes: racer.crashes, stalls: racer.stalls, finish: racer.finishedAt, bestLap: snap.bestLap,
    seconds: racer.time, wallMs: performance.now() - t0,
  };
}

/**
 * Per-environment training state next to the quad (see env.wgsl): which world and gate, the episode counters, the last action,
 * the environment's random streams, and statistics summed over one training iteration.
 */
import { makeLayout, type Field } from './stateLayout';

const F = (name: string, type: Field['type'] = 'f32'): Field => ({ name, type });

export const ENV_FIELDS: Field[] = [
  F('world', 'u32'), F('next', 'u32'), F('stall', 'u32'), F('epSteps', 'u32'), F('episode', 'u32'),
  // Index of the step the current lap began at (closed tracks, from the first pass of gate 0), or NO_LAP
  F('lapStart', 'u32'),
  F('prevDist'), F('prevAct', 'vec4f'), F('epRet'),
  F('rngEnv', 'u32'), F('rngPol', 'u32'), F('rngPolSpare'), F('rngPolHas', 'u32'),
  // Path progress (pathProgress.ts): the path sample nearest the drone at the last decision, and its arc length there
  F('pathIdx', 'u32'), F('pathS'),
  // Iteration statistics (cleared by the stats kernel): finished episodes, crashes, gates, finishes, laps, return and
  // length sums, best lap (s)
  F('sEpisodes'), F('sCrashes'), F('sGates'), F('sFinishes'), F('sLaps'), F('sRet'), F('sLen'), F('sBestLap'),
];

export const ENV_LAYOUT = makeLayout(ENV_FIELDS);

/** The statistics the stats kernel sums over every environment, in output order. */
export const STAT_NAMES = ['episodes', 'crashes', 'gates', 'finishes', 'laps', 'returnSum', 'lengthSum', 'bestLap'] as const;

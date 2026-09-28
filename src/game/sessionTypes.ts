import type { Physics, TrackData } from '../contracts';
import type { InputSource } from '../input/types';
import type { GroundHeightFn } from './checkpoint';
import { createRaceSnapshot, type RaceSnapshot } from './gateTimer';
import type { GameState } from './stateMachine';

/** Arming is refused at or above this throttle (like a real radio's arming check). */
export const ARM_THROTTLE_MAX = 0.05;
/** Armed with more throttle than this on the ground counts as taking off. */
export const TAKEOFF_THROTTLE = 0.12;
/** Throttle preset for a mid-air respawn so the quad does not drop while the pilot regains the sticks. */
export const HOVER_THROTTLE = 0.32;
/** Seconds after a crash before a respawn is offered (or done, with auto-respawn). */
export const RESPAWN_OFFER_S = 1.2;
/** A crashed quad lying still on the ground is disarmed after this long. */
export const AUTO_DISARM_S = 2;

/** The slice of the app settings the session reads; the UI's settings store satisfies it structurally. */
export interface SessionSettings {
  physicsHz: number;
  autoRespawn: boolean;
  /** Simulated wall clock (ms since the epoch, UTC) and its speed relative to real time. */
  timeMs: number;
  timeScale: number;
}

export interface SessionOptions {
  physics: Physics;
  input: InputSource;
  track: TrackData | null;
  settings: SessionSettings;
  /** Terrain height, used to keep a mid-air respawn clear of the ground. */
  groundHeightAt?: GroundHeightFn;
  /** Millisecond clock for `stats.physicsMs`; defaults to `performance.now`. */
  now?: () => number;
}

export interface SessionStats {
  stepsThisFrame: number;
  /** Wall time the last frame spent inside `physics.step`. */
  physicsMs: number;
  /** Physics steps discarded by the catch-up cap since start. */
  droppedSteps: number;
  totalSteps: number;
}

/** Everything the HUD needs from the session, rewritten in place by `GameSession.snapshot`. */
export interface SessionSnapshot {
  state: GameState;
  /** Session clock in seconds (advances only while simulating); race times and `race.missedAt` share it. */
  simTime: number;
  /** Seconds spent armed since the last track reset: the OSD flight timer. */
  flightTime: number;
  /** Arming was just refused because the throttle was up. */
  throttleHigh: boolean;
  /** Throttle stick 0..1 as the pilot last commanded it. */
  throttle: number;
  /** The pilot is holding the turtle (flip-over-after-crash) control. */
  turtle: boolean;
  /** The crash cooldown is over: R (or auto-respawn) puts the quad back. */
  respawnOffered: boolean;
  /** Short transient notice such as "AUTO DISARM", or an empty string. */
  message: string;
  race: RaceSnapshot;
}

export function createSessionSnapshot(): SessionSnapshot {
  return { state: 'menu', simTime: 0, flightTime: 0, throttleHigh: false, throttle: 0, turtle: false, respawnOffered: false, message: '', race: createRaceSnapshot() };
}

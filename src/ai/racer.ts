/**
 * A drone flown by a brain on its own: the real QuadPhysics, a BrainPilot and a GateTimer, with the session's arming and
 * respawn rules. The spectator race steps one per rival in lockstep with the session's physics, and the eval tool flies one
 * headless to time a brain in the game's own sim.
 */
import type { ObstacleCollider, StickInput, TerrainData, TerrainSampler, TrackData, Vec3 } from '../contracts';
import { checkpointPlacement, createPlacement, padPlacement, type GroundHeightFn } from '../game/checkpoint';
import { GateTimer, type GateEvent } from '../game/gateTimer';
import { BRAIN_COOLDOWN_S, RESPAWN_OFFER_S } from '../game/sessionTypes';
import { StuckWatch } from '../game/stuck';
import type { Rng } from '../sim/math3d';
import { QUAD_5IN_6S, type QuadConfig } from '../sim/presets';
import { QuadPhysics } from '../sim/quad';
import type { WindConfig } from '../sim/wind';
import type { EnvironmentCollision } from '../world/park/types';
import { episodeLimits, type Brain } from './brain';
import { BrainPilot, type PilotRace } from './brainPilot';
import { FLOOR_MARGIN_M, type EpisodeLimits } from './spec';

/**
 * Where training would have ended the episode for leaving the world (env.wgsl `outside`): off the terrain, `ceiling` m over its
 * highest point, or FLOOR_MARGIN_M under its lowest.
 */
export function outsideWorld(t: TerrainData, p: ArrayLike<number>, ceiling: number): boolean {
  const x0 = t.origin[0], z0 = t.origin[1], span = (t.resolution - 1) * t.cellSize;
  return p[0] < x0 || p[0] > x0 + span || p[2] < z0 || p[2] > z0 + span || p[1] > t.maxHeight + ceiling || p[1] < t.minHeight - FLOOR_MARGIN_M;
}

/**
 * True when a brain flying since its last gate `sinceGate` s ago at `pos` is past where its training ended episodes (no gate for
 * its stall time, or out of the world). Past that point it never learned anything, so the game puts it back at its last gate.
 */
export function pastTraining(limits: EpisodeLimits, t: TerrainData, pos: ArrayLike<number>, sinceGate: number): boolean {
  return sinceGate >= limits.stallSeconds || outsideWorld(t, pos, limits.ceiling);
}

export interface RacerWorld {
  /** The physics ground (terrain plus the start pad). */
  ground: TerrainSampler;
  groundHeightAt: GroundHeightFn;
  track: TrackData;
  colliders: readonly ObstacleCollider[];
  /** What the brain's range sensing sees, when it differs from `colliders` (a park: box stand-ins for its exact shapes). */
  senseColliders?: readonly ObstacleCollider[];
  /** Exact shapes the quad also collides with (a theme park's ParkCollision). */
  environment?: EnvironmentCollision | null;
}

/** Still air; QuadPhysics on its own starts with a light breeze. */
const CALM: Partial<WindConfig> = { meanSpeed: 0, turbulence: 0, gustsPerMinute: 0 };

export class BrainRacer {
  readonly physics: QuadPhysics;
  readonly pilot: BrainPilot;
  readonly timer: GateTimer;
  /** Sim seconds since the race began (GO). */
  time = 0;
  crashes = 0;
  /** Respawns because the brain flew past where its training ended episodes (`pastTraining`). */
  stalls = 0;
  /** Sim time the race was finished, or NaN. */
  finishedAt = NaN;
  /** False until GO: the quad sits disarmed on the pad. */
  go = false;
  /** Back on its pad after its finish and cool-down. */
  parked = false;
  private readonly cmd: StickInput = { roll: 0, pitch: 0, yaw: 0, throttle: 0, armed: false, mode: 'acro', turtle: false };
  private readonly race: PilotRace;
  private readonly limits: EpisodeLimits;
  private readonly placement = createPlacement();
  private readonly prev: Vec3 = [0, 0, 0];
  private airArm = false;
  private wasCrashed = false;
  private readonly stuck = new StuckWatch();
  private gateAt = 0;
  /** Race time the quad crashed, while the crash plays out before its respawn; -1 otherwise. */
  private downAt = -1;

  constructor(
    readonly brain: Brain,
    readonly world: RacerWorld,
    opts: {
      config?: QuadConfig; seed?: number; wind?: Partial<WindConfig>; altitudeM?: number; tempC?: number;
      /** Sample the sticks from the brain's action spread with this random source (BrainPilot); default the mean action. */
      sample?: Rng;
    } = {},
  ) {
    const config = opts.config ?? QUAD_5IN_6S;
    this.physics = new QuadPhysics(config, world.ground, opts.seed ?? config.seed);
    this.physics.fc.setRates(brain.rates);
    this.physics.setColliders([...world.colliders]);
    this.physics.collision.environment = world.environment ?? null;
    this.physics.setAtmosphere(opts.altitudeM ?? 0, opts.tempC ?? 15);
    this.physics.setWind(opts.wind ?? CALM);
    this.pilot = new BrainPilot(brain, world.groundHeightAt, config.battery.cells, opts.sample ?? null);
    this.pilot.setColliders(world.senseColliders ?? world.colliders);
    this.timer = new GateTimer(world.track);
    this.race = { track: world.track, nextGate: 0 };
    this.limits = episodeLimits(brain);
    this.restart();
  }

  get finished(): boolean {
    return this.timer.isFinished;
  }

  /** Back on the pad, disarmed, with a fresh race; `go` must be set again. */
  restart(): void {
    this.timer.reset();
    this.time = 0;
    this.crashes = 0;
    this.stalls = 0;
    this.gateAt = 0;
    this.finishedAt = NaN;
    this.parked = false;
    this.go = false;
    this.place(padPlacement(this.world.track, this.placement));
  }

  /** One physics step of `dt` seconds. Returns the gate event it produced. */
  step(dt: number): GateEvent {
    const s = this.physics.state;
    const cmd = this.cmd;
    this.prev[0] = s.pos[0];
    this.prev[1] = s.pos[1];
    this.prev[2] = s.pos[2];
    const t = this.time;
    // Like the session after a finish: the brain flies on for its cool-down, then the quad waits on its pad, disarmed.
    if (this.timer.isFinished && !this.parked && t - this.finishedAt >= BRAIN_COOLDOWN_S) {
      this.place(padPlacement(this.world.track, this.placement));
      this.parked = true;
    }
    // Like the session after a crash: the brain has let go (its training ended the episode at the crash), and once the crash has
    // played out the quad goes back to its last gate.
    if (this.downAt >= 0 && t - this.downAt >= RESPAWN_OFFER_S) this.respawn();
    if (this.parked || this.downAt >= 0) {
      cmd.roll = cmd.pitch = cmd.yaw = cmd.throttle = 0;
    } else {
      this.race.nextGate = this.timer.nextGate;
      this.pilot.control(s, cmd, this.race, dt);
    }
    cmd.armed = this.go && !this.parked;
    if (this.airArm) cmd.throttle = 0;
    this.physics.step(dt, cmd);
    if (this.go) this.time = t + dt;
    if (this.airArm && s.armed) this.airArm = false;
    if (s.crashed && !this.wasCrashed) {
      this.crashes++;
      // The first hit starts the count-down to the respawn; the bounces while it plays out do not restart it
      if (this.go && !this.timer.isFinished && !this.parked && this.downAt < 0) this.downAt = this.time;
    }
    this.wasCrashed = s.crashed;
    if (!this.go || this.airArm || this.timer.isFinished) this.stuck.reset(s);
    else if (this.stuck.update(s, dt)) {
      this.respawn();
      return 'none';
    }
    if (!this.go || this.timer.gateCount === 0 || this.downAt >= 0) return 'none';
    const ev = this.timer.check(this.prev, s.pos, t, this.time);
    if (ev === 'finish') this.finishedAt = this.time;
    if (ev === 'gate' || ev === 'lap' || ev === 'finish') this.gateAt = this.time;
    else if (!this.timer.isFinished && pastTraining(this.limits, this.world.ground.data, s.pos, this.time - this.gateAt)) {
      this.stalls++;
      this.respawn();
    }
    return ev;
  }

  /**
   * Back where its training started episodes (the pad before the first gate) with a fresh stall clock, as a new episode starts, on
   * the pack it crashed with. A flat pack is swapped for a fresh one on the pad, as in the session.
   */
  private respawn(): void {
    const t = this.timer, ahead = this.limits.respawn === 'next-gate';
    if (this.physics.packFlat()) this.place(padPlacement(this.world.track, this.placement));
    else this.place(checkpointPlacement(this.world.track, t.lastGate, t.nextGate, ahead, this.world.groundHeightAt, this.placement), 'kept');
    this.gateAt = this.time;
  }

  private place(p: { pos: Vec3; yaw: number; airborne: boolean }, pack: 'fresh' | 'kept' = 'fresh'): void {
    this.physics.reset(p.pos, p.yaw, pack);
    this.airArm = p.airborne;
    this.wasCrashed = false;
    this.downAt = -1;
    this.stuck.reset(this.physics.state);
    this.pilot.reset();
  }
}

/**
 * A drone flown by a brain on its own: the real QuadPhysics, a BrainPilot and a GateTimer, with the session's arming and
 * respawn rules. The spectator race steps one per rival in lockstep with the session's physics, and the eval tool flies one
 * headless to time a brain in the game's own sim.
 */
import type { ObstacleCollider, StickInput, TerrainSampler, TrackData, Vec3 } from '../contracts';
import { createPlacement, padPlacement, respawnPlacement, type GroundHeightFn } from '../game/checkpoint';
import { GateTimer, type GateEvent } from '../game/gateTimer';
import { HOVER_THROTTLE } from '../game/sessionTypes';
import { StuckWatch } from '../game/stuck';
import { QUAD_5IN_6S, type QuadConfig } from '../sim/presets';
import { QuadPhysics } from '../sim/quad';
import type { WindConfig } from '../sim/wind';
import type { Brain } from './brain';
import { BrainPilot, type PilotRace } from './brainPilot';

/** A brain that clears no gate for this long is put back at its last gate (training ended such episodes after 8 s). */
export const STALL_RESPAWN_S = 15;

export interface RacerWorld {
  /** The physics ground (terrain plus the start pad). */
  ground: TerrainSampler;
  groundHeightAt: GroundHeightFn;
  track: TrackData;
  colliders: readonly ObstacleCollider[];
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
  /** Respawns because no gate was cleared for STALL_RESPAWN_S. */
  stalls = 0;
  /** Sim time the race was finished, or NaN. */
  finishedAt = NaN;
  /** False until GO: the quad sits disarmed on the pad. */
  go = false;
  private readonly cmd: StickInput = { roll: 0, pitch: 0, yaw: 0, throttle: 0, armed: false, mode: 'acro', turtle: false };
  private readonly race: PilotRace;
  private readonly placement = createPlacement();
  private readonly prev: Vec3 = [0, 0, 0];
  private airArm = false;
  private wasCrashed = false;
  private readonly stuck = new StuckWatch();
  private gateAt = 0;

  constructor(
    readonly brain: Brain,
    readonly world: RacerWorld,
    opts: { config?: QuadConfig; seed?: number; wind?: Partial<WindConfig>; altitudeM?: number; tempC?: number } = {},
  ) {
    const config = opts.config ?? QUAD_5IN_6S;
    this.physics = new QuadPhysics(config, world.ground, opts.seed ?? config.seed);
    this.physics.fc.setRates(brain.rates);
    this.physics.setColliders([...world.colliders]);
    this.physics.setAtmosphere(opts.altitudeM ?? 0, opts.tempC ?? 15);
    this.physics.setWind(opts.wind ?? CALM);
    this.pilot = new BrainPilot(brain, world.groundHeightAt, config.battery.cells);
    this.timer = new GateTimer(world.track);
    this.race = { track: world.track, nextGate: 0 };
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
    if (this.timer.isFinished) {
      // Like the session after a finish: level out and hover.
      cmd.roll = cmd.pitch = cmd.yaw = 0;
      cmd.mode = 'angle';
      cmd.throttle = HOVER_THROTTLE;
    } else {
      this.race.nextGate = this.timer.nextGate;
      this.pilot.control(s, cmd, this.race, dt);
    }
    cmd.armed = this.go;
    if (this.airArm) cmd.throttle = 0;
    this.physics.step(dt, cmd);
    if (this.go) this.time = t + dt;
    if (this.airArm && s.armed) this.airArm = false;
    if (s.crashed && !this.wasCrashed) this.crashes++;
    this.wasCrashed = s.crashed;
    // A knock is left to the brain to recover from; only a quad that is properly stuck (or disarmed) goes back to its last gate.
    if (!this.go || this.airArm || this.timer.isFinished) this.stuck.reset(s);
    else if (this.stuck.update(s, dt)) {
      this.place(respawnPlacement(this.world.track, this.timer.lastGate, this.world.groundHeightAt, this.placement));
      return 'none';
    }
    if (!this.go || this.timer.gateCount === 0) return 'none';
    const ev = this.timer.check(this.prev, s.pos, t, this.time);
    if (ev === 'finish') this.finishedAt = this.time;
    if (ev === 'gate' || ev === 'lap' || ev === 'finish') this.gateAt = this.time;
    else if (!this.timer.isFinished && this.time - this.gateAt >= STALL_RESPAWN_S) {
      this.stalls++;
      this.gateAt = this.time;
      this.place(respawnPlacement(this.world.track, this.timer.lastGate, this.world.groundHeightAt, this.placement));
    }
    return ev;
  }

  private place(p: { pos: Vec3; yaw: number; airborne: boolean }): void {
    this.physics.reset(p.pos, p.yaw);
    this.airArm = p.airborne;
    this.wasCrashed = false;
    this.stuck.reset(this.physics.state);
    this.pilot.reset();
  }
}

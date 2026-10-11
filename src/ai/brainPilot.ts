/**
 * Flies the game's quad with a trained brain. The session calls `control` before every physics step; every
 * PHYSICS_PER_ACTION steps (at the brain's 50 Hz) the pilot reads the observation, runs the actor and holds the resulting
 * acro sticks until the next decision, exactly as the GPU trainer does (src/ai/gpu/env.wgsl stepEnvs).
 */
import type { ObstacleCollider, QuadState, StickInput, TrackData } from '../contracts';
import type { Rng } from '../sim/math3d';
import { BrainPolicy, senses, type Brain } from './brain';
import { observe, obsGates, type ObsGate } from './observe';
import { senseWorld, type SenseWorld } from './sense';
import { ACT_SIZE, OBS_SIZE, POLICY_HZ, REST_ACTION, actionToStick } from './spec';

/**
 * Largest action spread a sampling pilot uses (standard deviation before the tanh squash). A trained brain's own spread is far
 * below it (0.05 at the trainer's floor); an early brain's can reach 1.6, which would fly mostly noise.
 */
export const SAMPLE_STD_MAX = 0.15;

/** What the pilot needs to know about the race each step. */
export interface PilotRace {
  track: TrackData | null;
  /** Index of the gate due next. */
  nextGate: number;
}

/** A pilot the session lets fly the quad in place of the player's sticks. */
export interface StepPilot {
  /** Writes roll, pitch, yaw, throttle, mode and turtle into `cmd` for the physics step about to run (`armed` stays the session's). */
  control(state: QuadState, cmd: StickInput, race: PilotRace, dt: number): void;
  /** The quad was placed somewhere new: the next step decides afresh from the rest action. */
  reset(): void;
}

export class BrainPilot implements StepPilot {
  readonly policy: BrainPolicy;
  private readonly obs = new Float32Array(OBS_SIZE);
  private readonly action = new Float64Array(ACT_SIZE);
  private readonly prev = new Float64Array(ACT_SIZE);
  private readonly stick: StickInput = { roll: 0, pitch: 0, yaw: 0, throttle: 0, armed: true, mode: 'acro', turtle: false };
  private gates: ObsGate[] = [];
  private gatesOf: TrackData | null = null;
  /** Physics time left until the next decision; at or below zero the next step decides. */
  private hold = 0;
  /** Per action: the spread a sampling pilot draws with (the brain's own, capped at SAMPLE_STD_MAX). */
  private readonly std = new Float64Array(ACT_SIZE);
  private readonly noise = new Float64Array(ACT_SIZE);
  /** The ground and colliders the obstacle slots see (none for a brain trained before obstacle sensing). */
  private world: SenseWorld | null = null;

  constructor(
    readonly brain: Brain,
    /** Ground height under a point: the physics ground the brain was trained on (terrain plus the start pad). */
    private readonly groundHeightAt: (x: number, z: number) => number,
    private readonly cells: number,
    /**
     * With a random source the pilot samples each decision from the brain's action spread, as the trainer does, so copies of
     * one brain fly their own lines; without one it flies the mean action, the brain's best guess.
     */
    private readonly rng: Rng | null = null,
  ) {
    this.policy = new BrainPolicy(brain);
    this.setColliders([]);
    for (let i = 0; i < ACT_SIZE; i++) this.std[i] = Math.min(Math.exp(brain.logStd[i]), SAMPLE_STD_MAX);
    this.reset();
  }

  /** The colliders the quad flies among (the physics' own list); a brain that senses obstacles needs them. */
  setColliders(colliders: readonly ObstacleCollider[]): void {
    this.world = senses(this.brain) ? senseWorld(colliders, this.groundHeightAt) : null;
  }

  get name(): string {
    return this.brain.name;
  }

  /** The last action, each -1..1 (roll, pitch, yaw, throttle). */
  get lastAction(): ArrayLike<number> {
    return this.prev;
  }

  reset(): void {
    for (let i = 0; i < ACT_SIZE; i++) this.prev[i] = REST_ACTION[i];
    this.hold = 0;
  }

  control(s: QuadState, cmd: StickInput, race: PilotRace, dt: number): void {
    if (this.hold <= dt * 0.5) {
      this.decide(s, race);
      this.hold += 1 / POLICY_HZ;
    }
    this.hold -= dt;
    const st = this.stick;
    cmd.roll = st.roll;
    cmd.pitch = st.pitch;
    cmd.yaw = st.yaw;
    // Trained with GameSession's air-arm rule: the throttle stays at zero until the flight controller has armed.
    cmd.throttle = s.armed ? st.throttle : 0;
    cmd.mode = 'acro';
    cmd.turtle = false;
  }

  private decide(s: QuadState, race: PilotRace): void {
    const track = race.track;
    if (track !== this.gatesOf) {
      this.gatesOf = track;
      this.gates = track ? obsGates(track.gates) : [];
    }
    observe(s, {
      gates: this.gates, closed: track?.closed ?? false, next: race.nextGate,
      groundY: this.groundHeightAt(s.pos[0], s.pos[2]), prevAction: this.prev, cells: this.cells, sense: this.world,
    }, this.obs);
    const rng = this.rng;
    if (rng) for (let i = 0; i < ACT_SIZE; i++) this.noise[i] = this.std[i] * rng.gauss();
    this.policy.act(this.obs, this.action, rng ? this.noise : undefined);
    actionToStick(this.action, this.stick);
    for (let i = 0; i < ACT_SIZE; i++) this.prev[i] = this.action[i];
  }
}

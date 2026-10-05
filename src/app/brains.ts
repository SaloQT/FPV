/**
 * Trained brains in the app: the list (public/brains/index.json plus files the pilot loads), a brain flying the player's quad,
 * and the spectator race, where brain 0 flies the player's quad through the session and every other brain flies its own
 * QuadPhysics in lockstep with the session's physics steps, on the same ground, colliders and wind.
 *
 * URL: `?brain=name` flies that brain once the list is in, `?race=a,b,c` starts a race between those brains.
 */
import { parseBrain, type Brain } from '../ai/brain';
import { BrainPilot } from '../ai/brainPilot';
import { BrainRacer, STALL_RESPAWN_S } from '../ai/racer';
import { BRAIN_PHYSICS_HZ } from '../ai/spec';
import type { ObstacleCollider, QuadState, TrackData, Vec3 } from '../contracts';
import { createRaceSnapshot, type RaceSnapshot } from '../game/gateTimer';
import { HOVER_THROTTLE } from '../game/sessionTypes';
import { formatTimeCentis } from '../game/units';
import type { RivalQuad } from '../render/objects';
import { rateProfileOf } from '../sim/fc/ratePresets';
import type { BrainListing, BrainMenuHost } from '../ui/menuBrains';
import { RaceBoard, type BoardRow } from '../ui/raceBoard';
import { raceStartEnabled } from './flow';
import type { AppCtx } from './state';

/** Most quads in one race (the player's included). */
export const MAX_RACERS = 8;
/** Rear LED colour of each racer, the player's quad first (its own LEDs stay red). */
export const RACER_COLOURS: readonly Vec3[] = [
  [1, 0.04, 0.02], [0.1, 0.45, 1], [0.1, 1, 0.25], [1, 0.75, 0.05], [0.85, 0.1, 1], [0.1, 1, 1], [1, 0.35, 0.05], [1, 1, 1],
];
const BOARD_HZ = 5;

interface Entry {
  name: string;
  file?: string;
  stats?: Partial<Brain['stats']>;
  brain?: Brain;
}

/** What the leaderboard ranks: how far each racer got. */
export interface RaceStanding {
  name: string;
  finished: boolean;
  /** Race time when finished, s. */
  finishTime: number;
  /** Gates cleared over the whole race. */
  progress: number;
  /** Distance to the gate due next, m (breaks ties in progress). */
  toGate: number;
}

/** Race order: finishers by time, then by gates cleared, then by who is closer to the next gate. Returns indices. */
export function rankRacers(s: readonly RaceStanding[]): number[] {
  return s.map((_, i) => i).sort((a, b) => {
    const A = s[a], B = s[b];
    if (A.finished !== B.finished) return A.finished ? -1 : 1;
    if (A.finished) return A.finishTime - B.finishTime;
    if (A.progress !== B.progress) return B.progress - A.progress;
    return A.toGate - B.toGate;
  });
}

function summary(e: Entry): string {
  const s = e.stats;
  if (!s) return 'Loaded from a file.';
  const parts: string[] = [];
  if (s.steps) parts.push(`trained on ${(s.steps / 1e6).toFixed(0)}M decisions (${Math.round((s.seconds ?? 0) / 60)} min)`);
  if (s.gatesPerMinute) parts.push(`${s.gatesPerMinute.toFixed(1)} gates/min in training`);
  if (s.bestLap) parts.push(`best training lap ${s.bestLap.toFixed(1)} s`);
  if (s.evalLap) parts.push(`mean race finish ${s.evalLap.toFixed(1)} s on new tracks`);
  return parts.length ? `${parts.join(', ')}.` : 'Untrained.';
}

const css = (c: Vec3): string => `rgb(${Math.round(c[0] * 255)}, ${Math.round(c[1] * 255)}, ${Math.round(c[2] * 255)})`;

export class BrainHub implements BrainMenuHost {
  private entries: Entry[] = [];
  private flyingName: string | null = null;
  /** The brain that flew any part of the run since the last reset (it gets the finish), or null when only the pilot did. */
  private runBrain: string | null = null;
  private racers: BrainRacer[] = [];
  private names: string[] = [];
  private racerTrack: TrackData | null = null;
  private followIdx = 0;
  private msg = '';
  private boardIn = 0;
  /** The player's quad under a brain: gates cleared so far and the session time of the last one, for the stall rescue. */
  private ownGates = -1;
  private ownGateAt = 0;
  private board: RaceBoard | null = null;
  private readonly listeners = new Set<() => void>();
  private readonly rivals: RivalQuad[] = [];
  private readonly standings: RaceStanding[] = [];
  /** Rivals (by slot) whose finish of the current race was already reported to `onResult`. */
  private readonly reported = new Set<number>();

  /**
   * A rival of the spectator race finished: its name and final race state (the leaderboards record it). The player's own quad
   * is not reported here; the session's finish covers it, whoever flies it.
   */
  onResult: ((name: string, snap: RaceSnapshot) => void) | null = null;

  constructor(private readonly app: () => AppCtx | null) {}

  // ---- BrainMenuHost ----

  list(): readonly BrainListing[] {
    return this.entries.map((e) => ({ name: e.name, summary: summary(e) }));
  }

  flying(): string | null {
    return this.flyingName;
  }

  /** Who the quad's finish belongs to: the brain that flew any of this run, or null for the pilot alone. */
  runPilot(): string | null {
    return this.runBrain;
  }

  racing(): readonly string[] {
    return this.racers.length ? this.names : [];
  }

  following(): number {
    return this.followIdx;
  }

  message(): string {
    return this.msg;
  }

  subscribe(fn: () => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  fly(name: string): void {
    void this.run(async () => {
      const brain = await this.brain(name);
      this.endRace();
      this.takeQuad(brain);
      this.restartAndWatch();
      this.say(`${brain.name} is flying your quad.`);
    });
  }

  stop(): void {
    const ctx = this.app();
    if (!ctx || (!this.flyingName && !this.racers.length)) return;
    this.endRace();
    this.release(ctx);
    this.say('Your sticks again.');
  }

  loadFile(file: File): void {
    void this.run(async () => {
      const brain = parseBrain(await file.text());
      const name = this.uniqueName(brain.name);
      brain.name = name;
      this.entries.push({ name, brain, stats: brain.stats });
      this.say(`Loaded ${name}.`);
    });
  }

  race(names: readonly string[]): void {
    if (names.length < 2) {
      this.stop();
      return;
    }
    void this.run(async () => {
      const picked = names.slice(0, MAX_RACERS);
      const brains = await Promise.all(picked.map((n) => this.brain(n)));
      const ctx = this.app();
      if (!ctx) return;
      this.endRace();
      this.takeQuad(brains[0]);
      this.names = brains.map((b) => b.name);
      this.racers = brains.slice(1).map((b, i) => this.makeRacer(ctx, b, i + 1));
      this.racerTrack = ctx.session.raceTrack;
      this.followIdx = 0;
      ctx.session.setRaceStart(true);
      this.restartAndWatch();
      this.say(`Race: ${this.names.join(', ')}.${picked.length < names.length ? ` Only ${MAX_RACERS} quads fit in one race.` : ''}`);
    });
  }

  /** A brain by name, fetched on first use (the track builder's benchmark flies it on its own). */
  load(name: string): Promise<Brain> {
    return this.brain(name);
  }

  follow(index: number): void {
    this.followIdx = Math.max(0, Math.min(index, this.racers.length));
    this.changed();
  }

  // ---- app side ----

  /** Fetches the published brain list and acts on `?brain=` / `?race=`. */
  async init(search: string): Promise<void> {
    try {
      const res = await fetch(new URL('brains/index.json', document.baseURI));
      if (res.ok) {
        const index = (await res.json()) as { brains?: { file: string; name: string; stats?: Partial<Brain['stats']> }[] };
        for (const b of index.brains ?? []) if (!this.entries.some((e) => e.name === b.name)) this.entries.push({ name: b.name, file: b.file, stats: b.stats });
      }
    } catch (e) {
      console.warn('brains: no brain list', e);
    }
    this.changed();
    const q = new URLSearchParams(search);
    const race = q.get('race');
    const fly = q.get('brain');
    if (race) this.race(race.split(',').map((s) => s.trim()).filter(Boolean));
    else if (fly) this.fly(fly);
  }

  /** The race restarted from the pad: every rival goes back to the start too (a new track rebuilds them). */
  trackReset(): void {
    // A reset starts a run flown by whoever holds the quad now.
    this.runBrain = this.flyingName;
    const ctx = this.app();
    if (!ctx || !this.racers.length) return;
    this.reported.clear();
    if (ctx.session.raceTrack !== this.racerTrack) {
      this.racers = this.racers.map((r, i) => this.makeRacer(ctx, r.brain, i + 1));
      this.racerTrack = ctx.session.raceTrack;
    } else {
      for (const r of this.racers) r.restart();
    }
  }

  /** The colliders changed (new world, new vegetation): the rivals hit the same ones. */
  setColliders(colliders: readonly ObstacleCollider[]): void {
    for (const r of this.racers) r.physics.setColliders([...colliders]);
  }

  /** After `session.frame`: steps the rivals as far as the session's physics went, and refreshes the leaderboard. */
  step(ctx: AppCtx, dt: number): void {
    ctx.mods.objects.setRivals(this.rivals);
    if (this.flyingName) this.rescueStall(ctx);
    if (!this.racers.length) return;
    const steps = ctx.session.stats.stepsThisFrame;
    const h = ctx.session.stepper.dt;
    const go = ctx.physics.state.armed;
    for (const r of this.racers) {
      r.physics.setWind(ctx.wind.physics);
      if (go) r.go = true;
      for (let k = 0; k < steps; k++) r.step(h);
    }
    this.boardIn -= dt;
    if (this.boardIn <= 0) {
      this.boardIn = 1 / BOARD_HZ;
      this.paintBoard(ctx);
    }
  }

  /** Like the rivals: a brain on the player's quad that clears no gate for STALL_RESPAWN_S goes back to its last gate. */
  private rescueStall(ctx: AppCtx): void {
    const r = ctx.snap.race;
    const s = ctx.session;
    const gates = (r.lap - 1) * r.gateCount + r.gatesPassed;
    const now = ctx.snap.simTime;
    if (gates !== this.ownGates || !ctx.physics.state.armed || r.finished || now < this.ownGateAt) {
      this.ownGates = gates;
      this.ownGateAt = now;
      return;
    }
    if (now - this.ownGateAt < STALL_RESPAWN_S || (s.state !== 'flying' && s.state !== 'ready')) return;
    this.ownGateAt = now;
    s.respawn();
  }

  /** The state the camera follows: the player's quad, or the followed rival's. */
  view(own: QuadState): QuadState {
    return this.followIdx > 0 && this.racers[this.followIdx - 1] ? this.racers[this.followIdx - 1].physics.state : own;
  }

  get followsOwn(): boolean {
    return this.followIdx === 0 || !this.racers.length;
  }

  /** Brains fly with their own rates; a rates change in the menu waits until the brain lets go. */
  get holdsRates(): boolean {
    return this.flyingName !== null;
  }

  // ---- internals ----

  private async brain(name: string): Promise<Brain> {
    const e = this.entries.find((x) => x.name === name);
    if (!e) throw new Error(`no brain named ${name}`);
    if (!e.brain) {
      if (!e.file) throw new Error(`${name} has no file`);
      const res = await fetch(new URL(`brains/${e.file}`, document.baseURI));
      if (!res.ok) throw new Error(`${name}: ${res.status} ${res.statusText}`);
      e.brain = parseBrain(await res.text());
      e.brain.name = name;
    }
    return e.brain;
  }

  private takeQuad(brain: Brain): void {
    const ctx = this.app();
    if (!ctx) return;
    const cells = ctx.physics.config.battery.cells;
    ctx.session.pilot = new BrainPilot(brain, ctx.ground.groundHeightAt, cells);
    ctx.physics.fc.setRates(brain.rates);
    this.flyingName = brain.name;
    this.runBrain = brain.name;
    const hz = ctx.store.get().physicsHz;
    if (hz !== BRAIN_PHYSICS_HZ) this.msg = `Brains were trained at ${BRAIN_PHYSICS_HZ} Hz physics; this sim runs at ${hz} Hz, so they may fly worse.`;
    if (brain.quad !== ctx.store.get().quadPreset) this.msg = `${brain.name} was trained on ${brain.quad}.`;
  }

  /** Hands the sticks back. A quad in the air keeps hover throttle so it does not drop before the pilot catches it. */
  private release(ctx: AppCtx): void {
    ctx.session.pilot = null;
    this.flyingName = null;
    ctx.physics.fc.setRates(rateProfileOf(ctx.store.get().rates));
    const s = ctx.physics.state;
    ctx.input.recenter();
    if (s.armed && !s.onGround) ctx.input.setThrottle(HOVER_THROTTLE);
  }

  private makeRacer(ctx: AppCtx, brain: Brain, slot: number): BrainRacer {
    const track = ctx.session.raceTrack;
    if (!track) throw new Error('a race needs a track');
    const settings = ctx.store.get();
    const calm = settings.windSpeed <= 0;
    const racer = new BrainRacer(brain, { ground: ctx.ground, groundHeightAt: ctx.ground.groundHeightAt, track, colliders: ctx.colliders }, {
      config: ctx.physics.config,
      seed: settings.seed + 7919 * slot,
      wind: { ...ctx.wind.physics, turbulence: calm ? 0 : 1, gustsPerMinute: calm ? 0 : 1.5 },
      altitudeM: settings.observer.altitudeM,
    });
    this.rivals[slot - 1] = { state: racer.physics.state, led: RACER_COLOURS[slot % RACER_COLOURS.length] };
    return racer;
  }

  private endRace(): void {
    const ctx = this.app();
    if (this.racers.length && ctx) ctx.session.setRaceStart(raceStartEnabled(ctx));
    this.racers = [];
    this.names = [];
    this.rivals.length = 0;
    this.followIdx = 0;
    this.racerTrack = null;
    this.reported.clear();
    this.board?.hide();
  }

  /** Puts the quad on the pad for a fresh run and closes the menu so the flight is on screen. */
  private restartAndWatch(): void {
    const ctx = this.app();
    if (!ctx) return;
    ctx.session.resetTrack();
    ctx.audio.reset();
    ctx.session.closeMenu();
    ctx.ui.menu.hide();
  }

  private paintBoard(ctx: AppCtx): void {
    const n = ctx.session.raceTrack?.gates.length ?? 0;
    const own = ctx.snap.race;
    const rows: { snap: RaceSnapshot; name: string; pos: Vec3; crashed: boolean }[] = [{ snap: own, name: this.names[0], pos: ctx.physics.state.pos, crashed: ctx.physics.state.crashed }];
    this.racers.forEach((r, i) => {
      rows.push({ snap: r.timer.fill(createRaceSnapshot(), r.time), name: this.names[i + 1], pos: r.physics.state.pos, crashed: r.physics.state.crashed });
    });
    const track = ctx.session.raceTrack;
    this.standings.length = 0;
    for (const r of rows) {
      const g = track?.gates[r.snap.nextGate];
      this.standings.push({
        name: r.name, finished: r.snap.finished, finishTime: r.snap.totalTime,
        progress: r.snap.finished ? Infinity : (r.snap.lap - 1) * n + r.snap.gatesPassed,
        toGate: g ? Math.hypot(g.pos[0] - r.pos[0], g.pos[1] - r.pos[1], g.pos[2] - r.pos[2]) : 0,
      });
    }
    const order = rankRacers(this.standings);
    const board: BoardRow[] = order.map((i) => {
      const r = rows[i];
      const s = r.snap;
      return {
        name: r.name,
        colour: css(RACER_COLOURS[i % RACER_COLOURS.length]),
        progress: s.finished ? 'Finished' : r.crashed ? 'Crashed' : `Lap ${s.lap}/${s.laps} · gate ${s.gatesPassed}/${n}`,
        time: formatTimeCentis(s.totalTime),
        followed: i === this.followIdx,
      };
    });
    for (let i = 1; i < rows.length; i++) {
      if (!rows[i].snap.finished || this.reported.has(i)) continue;
      this.reported.add(i);
      this.onResult?.(rows[i].name, rows[i].snap);
    }
    const done = rows.every((r) => r.snap.finished);
    if (!this.board) this.board = new RaceBoard(ctx.root);
    this.board.show(done ? 'Race over' : 'Race', board);
  }

  private uniqueName(name: string): string {
    let n = name, k = 2;
    while (this.entries.some((e) => e.name === n)) n = `${name} (${k++})`;
    return n;
  }

  private async run(fn: () => Promise<void>): Promise<void> {
    try {
      this.msg = '';
      await fn();
    } catch (e) {
      this.say(e instanceof Error ? e.message : String(e), true);
    }
    this.changed();
  }

  private say(text: string, error = false): void {
    if (!this.msg || error) this.msg = text;
    this.app()?.ui.notice(text, error);
    this.changed();
  }

  private changed(): void {
    for (const fn of this.listeners) fn();
  }
}

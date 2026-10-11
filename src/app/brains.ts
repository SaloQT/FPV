/**
 * Trained brains in the app: the list (public/brains/index.json plus files the pilot loads), a brain flying the player's quad,
 * and the spectator race, where brain 0 flies the player's quad through the session and every other brain flies its own
 * QuadPhysics in lockstep with the session's physics steps, on the same ground, colliders and wind.
 *
 * URL: `?brain=name` flies that brain once the list is in, `?race=a,b,c` starts a race between those brains, and
 * `?race=ultimate*15,g*10,x*5` races 15 quads flown by ultimate, 10 by g and 5 by x.
 *
 * Race pilots sample their sticks from the brain's own action spread, as in training, each from its own seeded stream: copies
 * of one brain then fly their own lines instead of one path. A brain flying alone (Fly) uses the mean action.
 */
import { episodeLimits, parseBrain, type Brain } from '../ai/brain';
import { BrainPilot } from '../ai/brainPilot';
import { BrainRacer, pastTraining } from '../ai/racer';
import { BRAIN_PHYSICS_HZ, DEFAULT_EPISODE_LIMITS, type EpisodeLimits } from '../ai/spec';
import type { ObstacleCollider, QuadState, TrackData, Vec3 } from '../contracts';
import { createRaceSnapshot, type RaceSnapshot } from '../game/gateTimer';
import { HOVER_THROTTLE } from '../game/sessionTypes';
import { formatTimeCentis } from '../game/units';
import type { RivalQuad } from '../render/objects';
import { rateProfileOf } from '../sim/fc/ratePresets';
import { Rng } from '../sim/math3d';
import type { BrainListing, BrainMenuHost, RaceEntry } from '../ui/menuBrains';
import { RaceBoard, type BoardRow, type BoardTeam } from '../ui/raceBoard';
import { raceStartEnabled } from './flow';
import type { AppCtx } from './state';
import type { EnvironmentCollision } from '../world/park/types';
import { parkPilotTrack } from '../world/park/pilotGates';
import { sessionTrack } from './scene';

const PARK_ROUTE_HINT = 'Free exploration has no course for an AI pilot: pick the park tour, a coaster or the race course as the Flight route in the World menu.';

/** Most quads in one race (the player's included). Each steps its own physics on the main thread, about 0.7 % of a core. */
export const MAX_RACERS = 32;
/** Rear LED colour of each brain in a race, the first brain's first (the player's quad keeps its red LEDs). */
export const RACER_COLOURS: readonly Vec3[] = [
  [1, 0.04, 0.02], [0.1, 0.45, 1], [0.1, 1, 0.25], [1, 0.75, 0.05], [0.85, 0.1, 1], [0.1, 1, 1], [1, 0.35, 0.05], [1, 1, 1],
];
/** Leaderboard rows at most, plus the followed quad; the rest of a big race shows as a count. */
export const BOARD_ROWS = 10;
const BOARD_HZ = 5;

export type { RaceEntry };

/** One quad of a race. */
export interface RaceSlot {
  /** Index of its brain in the race's entries. */
  group: number;
  name: string;
  /** "ultimate #3" when the brain flies several quads, else the brain's name. */
  label: string;
}

/** A `race=` value: `a,b,c` (a quad each) or `ultimate*15,g*10`. A brain named twice adds up; a count below 1 drops it. */
export function parseRaceParam(text: string): RaceEntry[] {
  const out: RaceEntry[] = [];
  for (const part of text.split(',')) {
    const m = /^(.*?)(?:\*\s*(\d+))?$/.exec(part.trim());
    const name = m?.[1].trim() ?? '';
    const count = m?.[2] === undefined ? 1 : Number(m[2]);
    if (!name || !(count >= 1)) continue;
    const e = out.find((x) => x.name === name);
    if (e) e.count += count;
    else out.push({ name, count });
  }
  return out;
}

/** The `race=` value for these entries (the inverse of parseRaceParam). */
export function raceParam(entries: readonly RaceEntry[]): string {
  return entries.filter((e) => e.count >= 1).map((e) => (e.count === 1 ? e.name : `${e.name}*${Math.floor(e.count)}`)).join(',');
}

/** The quads of a race in start order, each brain's in turn, at most `max`. */
export function raceSlots(entries: readonly RaceEntry[], max = MAX_RACERS): RaceSlot[] {
  const out: RaceSlot[] = [];
  entries.forEach((e, group) => {
    const n = Math.floor(e.count);
    for (let k = 1; k <= n && out.length < max; k++) out.push({ group, name: e.name, label: n > 1 ? `${e.name} #${k}` : e.name });
  });
  return out;
}

/** Quads the entries ask for in all. */
export function raceSize(entries: readonly RaceEntry[]): number {
  return entries.reduce((n, e) => n + Math.max(0, Math.floor(e.count)), 0);
}

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
  /** The rivals, slot 1 onwards (slot 0 is the player's quad). */
  private racers: BrainRacer[] = [];
  /** Every quad of the running race, the player's first. */
  private slots: RaceSlot[] = [];
  /** The race's brains, by entry (RaceSlot.group). */
  private raceBrains: Brain[] = [];
  private racerTrack: TrackData | null = null;
  /** The session's track while brains fly a park tour or coaster route (parkPilotTrack), else null. */
  private pilotTrack: TrackData | null = null;
  private followIdx = 0;
  private msg = '';
  private boardIn = 0;
  /** The player's quad under a brain: gates cleared so far and the session time of the last one, for the stall rescue. */
  private ownGates = -1;
  private ownPlacements = -1;
  private ownGateAt = 0;
  /** Where the training of the brain on the player's quad ended its episodes. */
  private ownLimits: EpisodeLimits = { ...DEFAULT_EPISODE_LIMITS };
  private board: RaceBoard | null = null;
  private readonly listeners = new Set<() => void>();
  private readonly rivals: RivalQuad[] = [];
  private readonly standings: RaceStanding[] = [];
  /** Brains (by entry) whose finish of the current race was already recorded: the first finish of a brain's quads counts. */
  private readonly reported = new Set<number>();

  /**
   * A rival of the spectator race finished: its brain's name and final race state (the leaderboards record it). Only the first
   * of a brain's quads to finish is reported. The player's own quad is not reported here; the session's finish covers it,
   * whoever flies it.
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
    return this.racers.length ? this.slots.map((s) => s.label) : [];
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
    if (this.parkWithoutLine()) { this.say(PARK_ROUTE_HINT); return; }
    void this.run(async () => {
      const brain = await this.brain(name);
      this.endRace();
      this.usePilotGates();
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
    this.dropPilotGates(ctx);
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

  race(entries: readonly RaceEntry[]): void {
    if (entries.length && this.parkWithoutLine()) { this.say(PARK_ROUTE_HINT); return; }
    const slots = raceSlots(entries);
    if (slots.length < 2) {
      this.stop();
      return;
    }
    void this.run(async () => {
      const used = entries.slice(0, slots[slots.length - 1].group + 1);
      const brains = await Promise.all(used.map((e) => this.brain(e.name)));
      const ctx = this.app();
      if (!ctx) return;
      this.endRace();
      this.slots = slots;
      this.raceBrains = brains;
      this.usePilotGates();
      this.takeQuad(brains[slots[0].group], this.sampler(ctx, 0));
      this.racers = slots.slice(1).map((_, i) => this.makeRacer(ctx, i + 1));
      this.racerTrack = ctx.session.raceTrack;
      this.followIdx = 0;
      ctx.session.setRaceStart(true);
      this.restartAndWatch();
      const who = used.map((e, g) => {
        const n = slots.filter((s) => s.group === g).length;
        return n > 1 ? `${e.name} ×${n}` : e.name;
      });
      this.say(`Race: ${who.join(', ')}.${raceSize(entries) > MAX_RACERS ? ` Only ${MAX_RACERS} quads fit in one race.` : ''}`);
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
    if (race) this.race(parseRaceParam(race));
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
      this.racers = this.racers.map((_, i) => this.makeRacer(ctx, i + 1));
      this.racerTrack = ctx.session.raceTrack;
    } else {
      for (const r of this.racers) r.restart();
    }
  }

  /** The colliders changed (new world, new vegetation): the rivals hit the same ones, and every brain senses them. */
  /** On a park race course the brains sense `sense()` (box stand-ins for the park) and the rivals also hit its exact shapes (`environment`). */
  setColliders(colliders: readonly ObstacleCollider[], sense: () => readonly ObstacleCollider[] = () => colliders, environment: EnvironmentCollision | null = null): void {
    for (const r of this.racers) {
      r.physics.setColliders([...colliders]);
      r.physics.collision.environment = environment;
      r.pilot.setColliders(sense());
    }
    const own = this.app()?.session.pilot;
    if (own instanceof BrainPilot) own.setColliders(sense());
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

  /**
   * Like the rivals: a brain on the player's quad that flies past where its training ended episodes goes back to its last gate.
   * Its stall clock starts again at each gate and each respawn, as a training episode did.
   */
  private rescueStall(ctx: AppCtx): void {
    const r = ctx.snap.race;
    const s = ctx.session;
    const gates = (r.lap - 1) * r.gateCount + r.gatesPassed;
    const now = ctx.snap.simTime;
    if (gates !== this.ownGates || s.placements !== this.ownPlacements || !ctx.physics.state.armed || r.finished || now < this.ownGateAt) {
      this.ownGates = gates;
      this.ownPlacements = s.placements;
      this.ownGateAt = now;
      return;
    }
    if (!pastTraining(this.ownLimits, ctx.ground.data, ctx.physics.state.pos, now - this.ownGateAt) || (s.state !== 'flying' && s.state !== 'ready')) return;
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

  /** Puts `brain` on the player's quad; with `sample` it samples its sticks (a race pilot), else it flies the mean action. */
  private takeQuad(brain: Brain, sample: Rng | null = null): void {
    const ctx = this.app();
    if (!ctx) return;
    const cells = ctx.physics.config.battery.cells;
    const pilot = new BrainPilot(brain, ctx.ground.groundHeightAt, cells, sample);
    pilot.setColliders(ctx.senseColliders());
    ctx.session.pilot = pilot;
    ctx.physics.fc.setRates(brain.rates);
    this.flyingName = brain.name;
    this.ownLimits = episodeLimits(brain);
    ctx.session.respawnAhead = this.ownLimits.respawn === 'next-gate';
    this.runBrain = brain.name;
    const hz = ctx.store.get().physicsHz;
    if (hz !== BRAIN_PHYSICS_HZ) this.msg = `Brains were trained at ${BRAIN_PHYSICS_HZ} Hz physics; this sim runs at ${hz} Hz, so they may fly worse.`;
    if (brain.quad !== ctx.store.get().quadPreset) this.msg = `${brain.name} was trained on ${brain.quad}.`;
  }

  /** Hands the sticks back. A quad in the air keeps hover throttle so it does not drop before the pilot catches it. */
  private release(ctx: AppCtx): void {
    ctx.session.pilot = null;
    ctx.session.respawnAhead = false;
    this.flyingName = null;
    ctx.physics.fc.setRates(rateProfileOf(ctx.store.get().rates));
    const s = ctx.physics.state;
    ctx.input.recenter();
    if (s.armed && !s.onGround) ctx.input.setThrottle(HOVER_THROTTLE);
  }

  /** The quad in race slot `slot` (1 onwards; slot 0 is the player's quad). */
  private makeRacer(ctx: AppCtx, slot: number): BrainRacer {
    const track = ctx.session.raceTrack;
    if (!track) throw new Error('a race needs a track');
    const settings = ctx.store.get();
    const calm = settings.windSpeed <= 0;
    const { group } = this.slots[slot];
    const racer = new BrainRacer(this.raceBrains[group], { ground: ctx.ground, groundHeightAt: ctx.ground.groundHeightAt, track, colliders: ctx.colliders, senseColliders: ctx.senseColliders(), environment: ctx.physics.collision.environment }, {
      config: ctx.physics.config,
      seed: settings.seed + 7919 * slot,
      wind: { ...ctx.wind.physics, turbulence: calm ? 0 : 1, gustsPerMinute: calm ? 0 : 1.5 },
      altitudeM: settings.observer.altitudeM,
      sample: this.sampler(ctx, slot),
    });
    this.rivals[slot - 1] = { state: racer.physics.state, led: RACER_COLOURS[group % RACER_COLOURS.length] };
    return racer;
  }

  /** A theme park flown freely: no gates and no guide line, so nothing for a brain to steer by. */
  private parkWithoutLine(): boolean {
    const world = this.app()?.world;
    return !!world?.park && !world.track.gates.length && world.track.path.length < 2;
  }

  /**
   * On a park tour or coaster route the session flies the route as a brain does while brains fly (parkPilotTrack): pilot gates
   * along a coaster's guide line, and a start pad on the lawn behind gate 0.
   */
  private usePilotGates(): void {
    const ctx = this.app(), world = ctx?.world;
    if (!ctx || !world?.park || world.track.parkCourse === 'race' || (this.pilotTrack && ctx.session.raceTrack === this.pilotTrack)) return;
    const track = parkPilotTrack(world.park, world.track);
    if (!track) return;
    this.pilotTrack = track.start === world.track.start ? sessionTrack(ctx.ground, track) : track;
    ctx.session.replaceTrack(this.pilotTrack);
  }

  /** Back to the route as the player flies it, without its pilot gates. */
  private dropPilotGates(ctx: AppCtx): void {
    if (this.pilotTrack && ctx.session.raceTrack === this.pilotTrack) ctx.session.replaceTrack(sessionTrack(ctx.ground, ctx.world.track));
    this.pilotTrack = null;
  }

  /** The random stream race slot `slot` samples its sticks from: fixed by the world seed, different for every slot. */
  private sampler(ctx: AppCtx, slot: number): Rng {
    return new Rng(Math.imul(ctx.store.get().seed + 104729 * (slot + 1), 0x9e3779b1));
  }

  private endRace(): void {
    const ctx = this.app();
    if (this.racers.length && ctx) ctx.session.setRaceStart(raceStartEnabled(ctx));
    this.racers = [];
    this.slots = [];
    this.raceBrains = [];
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
    const rows: { snap: RaceSnapshot; slot: RaceSlot; pos: Vec3; crashed: boolean }[] = [{ snap: own, slot: this.slots[0], pos: ctx.physics.state.pos, crashed: ctx.physics.state.crashed }];
    this.racers.forEach((r, i) => {
      rows.push({ snap: r.timer.fill(createRaceSnapshot(), r.time), slot: this.slots[i + 1], pos: r.physics.state.pos, crashed: r.physics.state.crashed });
    });
    const track = ctx.session.raceTrack;
    this.standings.length = 0;
    for (const r of rows) {
      const g = track?.gates[r.snap.nextGate];
      this.standings.push({
        name: r.slot.label, finished: r.snap.finished, finishTime: r.snap.totalTime,
        progress: r.snap.finished ? Infinity : (r.snap.lap - 1) * n + r.snap.gatesPassed,
        toGate: g ? Math.hypot(g.pos[0] - r.pos[0], g.pos[1] - r.pos[1], g.pos[2] - r.pos[2]) : 0,
      });
    }
    const order = rankRacers(this.standings);
    const colour = (group: number): string => css(RACER_COLOURS[group % RACER_COLOURS.length]);
    const board: BoardRow[] = [];
    order.forEach((i, at) => {
      if (at >= BOARD_ROWS && i !== this.followIdx) return;
      const r = rows[i];
      const s = r.snap;
      board.push({
        place: at + 1,
        name: r.slot.label,
        colour: colour(r.slot.group),
        progress: s.finished ? 'Finished' : r.crashed ? 'Crashed' : `Lap ${s.lap}/${s.laps} · gate ${s.gatesPassed}/${n}`,
        time: formatTimeCentis(s.totalTime),
        followed: i === this.followIdx,
      });
    });
    // A brain flying several quads gets a line of its own: its best place and how many have finished.
    const teams: BoardTeam[] = [];
    if (rows.length > this.raceBrains.length) {
      this.raceBrains.forEach((b, group) => {
        const mine = order.map((i, at) => ({ i, at })).filter(({ i }) => rows[i].slot.group === group);
        teams.push({ name: b.name, colour: colour(group), count: mine.length, best: mine[0].at + 1, finished: mine.filter(({ i }) => rows[i].snap.finished).length });
      });
      teams.sort((a, b) => a.best - b.best);
    }
    // The player's quad's finish is recorded by the session; a rival's only when it is the first of its brain to finish.
    if (rows[0].snap.finished) this.reported.add(rows[0].slot.group);
    for (let i = 1; i < rows.length; i++) {
      const group = rows[i].slot.group;
      if (!rows[i].snap.finished || this.reported.has(group)) continue;
      this.reported.add(group);
      this.onResult?.(rows[i].slot.name, rows[i].snap);
    }
    const done = rows.every((r) => r.snap.finished);
    if (!this.board) this.board = new RaceBoard(ctx.root);
    this.board.place(ctx.store.get().osdScale);
    this.board.show(done ? 'Race over' : 'Race', board, teams, rows.length - board.length);
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

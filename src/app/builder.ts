/**
 * The track builder mode in the app: the recipe being edited, the builds (terrain in its worker, the track in the builder's own
 * worker), putting each finished track on screen so the live renderer is the 3D preview, the builder camera, the saved-track
 * library, export and import, links, racing and benchmarking brains on the track, and the per-track leaderboards that the finish
 * card and the brain race also write to.
 *
 * The session stays in its 'menu' state while the builder is open: physics is frozen and the mouse is free. Fly it and the brain
 * races leave the menu, and the builder steps aside when they do (`left`).
 */
import { BrainRacer } from '../ai/racer';
import { BRAIN_PHYSICS_HZ } from '../ai/spec';
import type { CameraState, RenderQuality, TerrainData, TerrainSampler, TrackData, TrackRecipe, Vec3 } from '../contracts';
import { CAMERA_FAR } from '../game/cameraRig';
import { createRaceSnapshot, type RaceSnapshot } from '../game/gateTimer';
import { quatLookAlong } from '../game/quat';
import { getPreset } from '../sim/presets';
import type { BuilderCameraMode, BuilderHost, BuilderState, BuilderUI } from '../ui/builder';
import {
  BUILD_DEBOUNCE_MS, BUILDER_FOV, FLY_SPEED_MS, SavedTracksStore, benchRows, benchTimeLimit, boardName, buildProfile, cleanName, describeFeatures, fitOrbit,
  flySpeed, flyThroughPose, gatesCleared, nearPlane, orbitDrag, orbitEye, orbitMove, orbitPan, orbitZoom, pathArcLengths, topOrbit, trackFileJson, trackFileName,
  parseTrackFile, uniqueTrackName, type ImportedTrack, type OrbitCam, type ProfileModel,
} from '../ui/builderModel';
import { finishBoardView, type FinishBoardView } from '../ui/finishModel';
import { estimateLapTime } from '../ui/lapEstimate';
import { LeaderboardStore, trackBoardKey, type LeaderEntry, type PilotKind } from '../ui/leaderboard';
import { shareUrl } from '../ui/seedModel';
import { copyText } from '../ui/shareLink';
import { idlePreview, type PreviewState } from '../ui/trackPreviewModel';
import { createTerrainSampler, generateTerrainAsync } from '../world/terrain';
import { generateTrack, validateTrack } from '../world/track';
import { defaultRecipe, randomRecipe } from '../world/track/recipe';
import type { BuilderWorkerReply, BuilderWorkerRequest } from './builderWorker';
import { PadGround } from './padGround';
import { shareableWorld } from './preview';
import { landWorld, recipeRequest, sessionTrack } from './scene';
import type { AppCtx } from './state';
import { buildTrack, type TrackRequest, type TrackResult, type World } from './world';

/** A busy app (another rebuild) gets the finished world this much later. */
const LAND_RETRY_MS = 300;
/** Longest stretch of benchmark flying before the page gets the thread back. */
const BENCH_SLICE_MS = 8;
/** Benchmark steps between clock reads. */
const BENCH_CHECK_STEPS = 64;
/** The benchmark table refreshes at most this often while a brain flies. */
const BENCH_PAINT_MS = 250;
/** The orbit camera keeps this far above the ground. */
const CAMERA_AGL = 1.2;
const SPIN_RAD_PER_S = 0.12;
/** Finish-card leaderboard rows. */
const CARD_ROWS = 5;

/** A build that a newer one replaced: its result is dropped quietly. */
class StaleBuild extends Error {}

interface Terrain {
  seed: number;
  quality: RenderQuality;
  terrain: TerrainData;
  sampler: TerrainSampler;
}

/**
 * Tracks are generated in a long-lived worker holding a copy of the terrain, so a slow fit never stalls the page. A newer build
 * restarts the worker instead of waiting for the old one. Without workers (or if one fails to start) the same code runs here.
 */
class TrackWorker {
  private worker: Worker | null = null;
  private terrain: TerrainData | null = null;
  private broken = typeof Worker === 'undefined';
  private nextId = 1;
  private pending: { id: number; resolve(r: TrackResult): void; reject(e: Error): void } | null = null;

  build(terrain: TerrainData, sampler: TerrainSampler, req: TrackRequest): Promise<TrackResult> {
    if (this.pending !== null) {
      this.pending.reject(new StaleBuild('replaced'));
      this.pending = null;
      this.kill();
    }
    if (this.broken) return this.inline(sampler, req);
    const worker = this.start();
    if (worker === null) return this.inline(sampler, req);
    if (this.terrain !== terrain) {
      worker.postMessage({ type: 'terrain', terrain } satisfies BuilderWorkerRequest);
      this.terrain = terrain;
    }
    const id = this.nextId++;
    return new Promise<TrackResult>((resolve, reject) => {
      this.pending = { id, resolve, reject };
      worker.postMessage({ type: 'build', id, req } satisfies BuilderWorkerRequest);
    }).catch((e: unknown) => {
      // The worker died under the build (a load error): run it here instead, once and for all later builds.
      if (e instanceof WorkerBroke) return this.inline(sampler, req);
      throw e;
    });
  }

  dispose(): void {
    this.pending?.reject(new StaleBuild('disposed'));
    this.pending = null;
    this.kill();
  }

  private start(): Worker | null {
    if (this.worker !== null) return this.worker;
    try {
      const w = new Worker(new URL('./builderWorker.ts', import.meta.url), { type: 'module' });
      w.onmessage = (event: MessageEvent<BuilderWorkerReply>) => {
        const reply = event.data;
        const p = this.pending;
        if (p === null || p.id !== reply.id) return;
        this.pending = null;
        if (reply.type === 'done') p.resolve(reply.result);
        else p.reject(new Error(reply.message));
      };
      w.onerror = (event) => {
        event.preventDefault();
        console.warn('builder: track worker failed, generating on the page instead', event.message);
        this.broken = true;
        const p = this.pending;
        this.pending = null;
        this.kill();
        p?.reject(new WorkerBroke('worker failed'));
      };
      this.worker = w;
      return w;
    } catch (e) {
      console.warn('builder: no track worker, generating on the page instead', e);
      this.broken = true;
      return null;
    }
  }

  private kill(): void {
    this.worker?.terminate();
    this.worker = null;
    this.terrain = null;
  }

  private async inline(sampler: TerrainSampler, req: TrackRequest): Promise<TrackResult> {
    await new Promise<void>((r) => setTimeout(r, 0));
    return buildTrack(sampler, req, { generateTrack });
  }
}

class WorkerBroke extends Error {}

interface BenchResult {
  name: string;
  finish: number;
  gates: number;
  gateTotal: number;
  crashes: number;
  running: boolean;
}

interface Board {
  world: World;
  key: string;
  name: string;
}

export class BuilderHub implements BuilderHost {
  /** The leaderboards of every track, for the builder, the finish card and the brain race. */
  readonly leaderboard = new LeaderboardStore();
  private readonly saved = new SavedTracksStore();
  private readonly worker = new TrackWorker();
  private ui: BuilderUI | null = null;
  private shown = false;
  private recipe: TrackRecipe = defaultRecipe();
  private terrainSeed = 0;
  private quality: RenderQuality = 'high';
  private preview: PreviewState = idlePreview(null);
  private note = '';
  /** The world on screen when the builder opened (Revert puts it back). */
  private before: World | null = null;
  /** The last world the builder put on screen. */
  private landed: World | null = null;
  private savedName = '';
  private token = 0;
  private timer = -1;
  private cache: Terrain | null = null;
  private board: Board | null = null;
  private fresh: { key: string; entry: LeaderEntry } | null = null;
  private profile: { track: TrackData; model: ProfileModel } | null = null;
  private arc: { track: TrackData; s: Float64Array } | null = null;
  private benchToken = 0;
  private benchList: BenchResult[] = [];
  private benchRunning = false;
  private benchNote = '';
  private readonly listeners = new Set<() => void>();

  private orbit: OrbitCam = { target: [0, 0, 0], azimuth: 0.7, elevation: 0.8, distance: 300 };
  private mode: BuilderCameraMode = 'orbit';
  private spinning = false;
  private flyS = 0;
  private readonly held = { forward: 0, right: 0, up: 0, fast: false };
  private readonly cam: CameraState = { pos: [0, 0, 0], quat: [0, 0, 0, 1], fovY: BUILDER_FOV, aspect: 16 / 9, near: 0.1, far: CAMERA_FAR };
  private readonly eye: Vec3 = [0, 0, 0];
  private readonly look: Vec3 = [0, 0, 0];

  constructor(private readonly app: () => AppCtx | null) {
    // Another tab saved a track or a finish: show it (this hub's own changes repaint where they happen).
    this.saved.subscribe(() => this.changed());
    this.leaderboard.subscribe((key) => {
      if (key === '') this.changed();
    });
  }

  /** The screen, created by the UI module once the app has a DOM root. */
  attach(ui: BuilderUI): void {
    this.ui = ui;
  }

  /** The builder is on screen: the frame uses its camera. */
  get active(): boolean {
    return this.shown;
  }

  /** The world on screen is a builder track (the finish card offers the way back). */
  get ownsWorld(): boolean {
    const ctx = this.app();
    return ctx !== null && (ctx.world === this.landed || ctx.world.track.recipe !== undefined);
  }

  /** Opens the builder over whatever is on screen (from the start screen, the pause menu, the finish card or `?mode=builder`). */
  open(): void {
    const ctx = this.app();
    if (ctx === null || this.shown || this.ui === null) return;
    if (ctx.session.state !== 'menu') ctx.session.openMenu();
    ctx.ui.menu.hide();
    ctx.ui.finish.hide();
    // A start-screen build still running would swap the world under the builder: it waits until the builder closes.
    ctx.preview?.hold();
    // A brain race in the pause menu would keep painting its board over the builder, and the track may change under it.
    if (ctx.brains.racing().length > 0) ctx.brains.stop();
    const w = ctx.world;
    this.before = w;
    if (w.track.recipe !== undefined) this.recipe = w.track.recipe;
    this.terrainSeed = w.terrainSeed;
    this.quality = w.quality;
    this.preview = idlePreview(w.track);
    this.note = w.track.recipe !== undefined || w === this.landed ? '' : 'This is the track you had. Move any control to build a custom one on this terrain.';
    this.shown = true;
    this.fitCamera(w.track, ctx.aspect);
    this.mode = 'orbit';
    this.ui.show();
    this.changed();
  }

  /** Back to the menu, keeping the track on screen. */
  close(): void {
    const ctx = this.app();
    if (ctx === null || !this.shown) return;
    this.hideScreen();
    if (ctx.session.state === 'menu') {
      if (ctx.session.started) ctx.ui.menu.showSettings();
      else ctx.ui.menu.showStart();
    }
  }

  /** The session left the menu (Fly it, a brain race, a pad's menu button): the builder steps aside, the track stays. */
  left(): void {
    if (this.shown) this.hideScreen();
  }

  /** Puts back the world from before the builder opened. */
  revert(): void {
    const ctx = this.app();
    const before = this.before;
    if (ctx === null || before === null || ctx.world === before) return;
    this.token++;
    this.cancelTimer();
    if (before.track.recipe !== undefined) this.recipe = before.track.recipe;
    this.terrainSeed = before.terrainSeed;
    this.quality = before.quality;
    this.savedName = '';
    this.put(before, this.token, '');
  }

  // ---- BuilderHost: state ----

  state(): BuilderState {
    const ctx = this.app();
    const world = ctx?.world ?? null;
    const track = this.preview.track;
    const board = world !== null ? this.boardFor(world) : null;
    const entries = board !== null ? this.leaderboard.board(board.key)?.entries ?? [] : [];
    return {
      recipe: this.recipe,
      terrainSeed: this.terrainSeed,
      quality: this.quality,
      preview: this.preview,
      built: world !== null && (world === this.landed || world.track.recipe !== undefined),
      note: this.note,
      profile: track !== null && world !== null ? this.profileFor(track, world.sampler) : null,
      features: track !== null ? describeFeatures(track) : '',
      boardName: board?.name ?? '',
      board: entries,
      fresh: board !== null && this.fresh?.key === board.key ? this.fresh.entry : null,
      brains: ctx?.brains.list() ?? [],
      bench: { running: this.benchRunning, rows: benchRows(this.benchList), note: this.benchNote },
      saved: this.saved.list(),
      savedName: this.savedName,
      camera: this.mode,
      spin: this.spinning,
      linkable: world !== null && shareableWorld(world, 'ready', true) !== null,
      canRevert: this.before !== null && world !== this.before,
    };
  }

  subscribe(fn: () => void): () => void {
    this.listeners.add(fn);
    return () => void this.listeners.delete(fn);
  }

  // ---- BuilderHost: the recipe ----

  setRecipe(recipe: TrackRecipe): void {
    this.recipe = recipe;
    this.savedName = '';
    this.schedule(BUILD_DEBOUNCE_MS);
  }

  randomise(): void {
    // Picking a new recipe is a UI choice, not generation: the recipe itself then builds deterministically.
    this.setRecipe(randomRecipe(Math.floor(Math.random() * 0x7fffffff)));
  }

  resetRecipe(): void {
    this.setRecipe({ ...defaultRecipe(), seed: this.recipe.seed });
  }

  setTerrain(seed: number): void {
    if (seed === this.terrainSeed) return;
    this.terrainSeed = seed >>> 0;
    this.schedule(BUILD_DEBOUNCE_MS);
  }

  // ---- BuilderHost: flying and brains ----

  fly(): void {
    const ctx = this.app();
    if (ctx === null || this.preview.status === 'working') return;
    this.stopBenchmark();
    if (ctx.brains.flying() !== null || ctx.brains.racing().length > 0) ctx.brains.stop();
    ctx.audio.start();
    ctx.session.resetTrack();
    ctx.session.closeMenu();
    ctx.input.requestPointerLock();
    this.left();
  }

  race(names: readonly string[]): void {
    const ctx = this.app();
    if (ctx === null || names.length === 0 || this.preview.status === 'working') return;
    this.stopBenchmark();
    // The hub loads the brains, then leaves the menu; the builder steps aside then (`left`).
    if (names.length === 1) ctx.brains.fly(names[0]);
    else ctx.brains.race(names);
  }

  benchmark(names: readonly string[]): void {
    const ctx = this.app();
    if (ctx === null || this.benchRunning || names.length === 0 || this.preview.status === 'working') return;
    void this.runBench(ctx, names, ++this.benchToken);
  }

  stopBenchmark(): void {
    if (!this.benchRunning) return;
    this.benchToken++;
    this.benchRunning = false;
    this.benchNote = 'Benchmark stopped.';
    for (const r of this.benchList) r.running = false;
    this.changed();
  }

  // ---- BuilderHost: library ----

  save(name: string): void {
    const ctx = this.app();
    if (ctx === null) return;
    const w = ctx.world;
    const list = this.saved.list();
    const wanted = cleanName(name);
    const finalName = wanted.length > 0 ? wanted : uniqueTrackName(w.track.recipe !== undefined ? `Track ${w.track.recipe.seed}` : 'Track', list);
    const ok = this.saved.save({
      name: finalName, terrainSeed: w.terrainSeed, quality: w.quality, savedAt: Date.now(),
      ...(w.track.recipe !== undefined ? { recipe: w.track.recipe } : { track: w.track }),
    });
    this.savedName = finalName;
    this.note = ok ? `Saved as "${finalName}".` : 'The browser refused to save (storage full or blocked); the track is kept for this visit only.';
    this.changed();
  }

  load(name: string): void {
    const t = this.saved.find(name);
    if (t === null) return;
    this.applyImport({ terrainSeed: t.terrainSeed, quality: t.quality, ...(t.recipe !== undefined ? { recipe: t.recipe } : {}), ...(t.track !== undefined ? { track: t.track } : {}) }, t.name);
  }

  remove(name: string): void {
    this.saved.remove(name);
    if (cleanName(name).toLowerCase() === this.savedName.toLowerCase()) this.savedName = '';
    this.changed();
  }

  exportFile(): void {
    const ctx = this.app();
    if (ctx === null) return;
    const w = ctx.world;
    const json = trackFileJson({ terrainSeed: w.terrainSeed, quality: w.quality, track: w.track, ...(w.track.recipe !== undefined ? { recipe: w.track.recipe } : {}) });
    const url = URL.createObjectURL(new Blob([json], { type: 'application/json' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = trackFileName(this.savedName || this.boardFor(w).name);
    document.body.append(a);
    a.click();
    a.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 2000);
    this.note = `Exported ${a.download}. Train on it with: node tools/brain/train.mjs --track ${a.download}`;
    this.changed();
  }

  importFile(file: File): void {
    void file.text().then(
      (text) => {
        const parsed = parseTrackFile(text);
        if (!parsed.ok) {
          this.note = parsed.error;
          this.changed();
          return;
        }
        this.applyImport(parsed.value, file.name.replace(/(\.track)?\.json$/i, ''));
      },
      () => {
        this.note = 'That file could not be read.';
        this.changed();
      },
    );
  }

  async copyLink(builder: boolean): Promise<boolean> {
    const ctx = this.app();
    if (ctx === null) return false;
    const share = shareableWorld(ctx.world, 'ready', true);
    if (share === null) return false;
    return copyText(shareUrl(location.href, share, builder ? { mode: 'builder' } : {}));
  }

  clearBoard(): void {
    const ctx = this.app();
    if (ctx === null) return;
    this.leaderboard.clear(this.boardFor(ctx.world).key);
    this.fresh = null;
    this.changed();
  }

  // ---- BuilderHost: camera ----

  setCamera(mode: BuilderCameraMode): void {
    const ctx = this.app();
    const track = ctx?.world.track;
    if (mode === 'top' && track !== undefined) this.orbit = topOrbit(track, ctx?.aspect);
    if (mode === 'fly') this.flyS = 0;
    if (mode === 'orbit' && this.mode === 'fly') this.orbitFromFly();
    this.mode = mode;
    this.changed();
  }

  setSpin(on: boolean): void {
    this.spinning = on;
    this.changed();
  }

  fit(): void {
    const ctx = this.app();
    if (ctx === null) return;
    this.fitCamera(ctx.world.track, ctx.aspect);
    this.mode = 'orbit';
    this.changed();
  }

  focusGate(index: number): void {
    const g = this.app()?.world.track.gates[index];
    if (g === undefined) return;
    // Behind the gate, looking along the way it is flown.
    this.orbit = { target: [g.pos[0], g.pos[1], g.pos[2]], azimuth: g.yaw, elevation: 0.32, distance: Math.max(16, Math.max(g.width, g.height) * 4) };
    this.mode = 'orbit';
    this.changed();
  }

  drag(dx: number, dy: number, pan: boolean, viewPx: number): void {
    if (this.mode !== 'orbit') {
      if (this.mode === 'fly') this.orbitFromFly();
      this.mode = 'orbit';
      this.changed();
    }
    if (pan) orbitPan(this.orbit, dx, dy, viewPx);
    else orbitDrag(this.orbit, dx, dy);
  }

  wheel(delta: number): void {
    if (this.mode === 'fly') return;
    orbitZoom(this.orbit, delta);
  }

  keys(forward: number, right: number, up: number, fast: boolean): void {
    this.held.forward = forward;
    this.held.right = right;
    this.held.up = up;
    this.held.fast = fast;
  }

  /** The camera the frame renders with while the builder is open. */
  camera(dt: number, aspect: number): CameraState {
    const ctx = this.app();
    const cam = this.cam;
    const track = ctx?.world.track ?? null;
    if (this.mode === 'fly' && track !== null && track.path.length > 1) {
      const arc = this.arcFor(track);
      const total = arc[track.path.length];
      this.flyS += FLY_SPEED_MS * dt;
      if (!track.closed && this.flyS > total) this.flyS = 0;
      flyThroughPose(track.path, arc, track.closed, this.flyS, this.eye, this.look);
      cam.near = 0.1;
    } else {
      const o = this.orbit;
      const h = this.held;
      if (h.forward !== 0 || h.right !== 0 || h.up !== 0) {
        const v = flySpeed(o, h.fast) * dt;
        orbitMove(o, h.forward * v, h.right * v, h.up * v);
      }
      if (this.spinning) o.azimuth += SPIN_RAD_PER_S * dt;
      orbitEye(o, this.eye);
      if (ctx !== null) {
        const floor = ctx.ground.groundHeightAt(this.eye[0], this.eye[2]) + CAMERA_AGL;
        if (this.eye[1] < floor) this.eye[1] = floor;
      }
      this.look[0] = o.target[0] - this.eye[0];
      this.look[1] = o.target[1] - this.eye[1];
      this.look[2] = o.target[2] - this.eye[2];
      cam.near = nearPlane(o.distance);
    }
    cam.pos[0] = this.eye[0];
    cam.pos[1] = this.eye[1];
    cam.pos[2] = this.eye[2];
    quatLookAlong(this.look[0], this.look[1], this.look[2], cam.quat);
    cam.fovY = BUILDER_FOV;
    if (aspect > 0) cam.aspect = aspect;
    cam.far = CAMERA_FAR;
    return cam;
  }

  // ---- leaderboards ----

  /**
   * Records a finish on the track on screen; returns where it placed (null when there was nothing to record). Scripted runs
   * (`scenario=` autopilots, `autostart` test and bench pages) keep the saved leaderboards out of it, as they do the saved settings.
   */
  record(pilot: string, kind: PilotKind, snap: RaceSnapshot): { key: string; entry: LeaderEntry; rank: number } | null {
    const ctx = this.app();
    if (ctx === null || !snap.finished || !(snap.totalTime > 0)) return null;
    if (ctx.params.scenario !== undefined || ctx.params.autostart) return null;
    const board = this.boardFor(ctx.world);
    return this.recordOn(board, pilot, kind, snap);
  }

  /** The finish card's leaderboard after `rec` (the finish just recorded, or null). */
  finishBoard(rec: { key: string; entry: LeaderEntry; rank: number } | null): FinishBoardView | null {
    const ctx = this.app();
    if (ctx === null) return null;
    const board = this.boardFor(ctx.world);
    const entries = this.leaderboard.board(board.key)?.entries ?? [];
    return finishBoardView(board.name, entries, rec?.key === board.key ? rec.entry : null, rec?.key === board.key ? rec.rank : 0, this.ownsWorld, CARD_ROWS);
  }

  // ---- internals ----

  private recordOn(board: Board, pilot: string, kind: PilotKind, snap: RaceSnapshot): { key: string; entry: LeaderEntry; rank: number } {
    const entry: LeaderEntry = {
      pilot, kind, total: snap.totalTime, bestLap: Number.isFinite(snap.bestLap) ? snap.bestLap : snap.totalTime, laps: snap.laps, missed: snap.totalMissed, date: Date.now(),
    };
    const rank = this.leaderboard.record(board.key, board.name, entry);
    this.fresh = { key: board.key, entry };
    this.changed();
    return { key: board.key, entry, rank };
  }

  private boardFor(world: World): Board {
    if (this.board?.world === world) return this.board;
    const name = boardName(world.track, world.terrainSeed, world === this.landed ? this.savedName : undefined);
    this.board = { world, key: trackBoardKey(world.terrainSeed, world.quality, world.track), name };
    return this.board;
  }

  private profileFor(track: TrackData, sampler: TerrainSampler): ProfileModel {
    if (this.profile?.track !== track) this.profile = { track, model: buildProfile(track, (x, z) => sampler.heightAt(x, z)) };
    return this.profile.model;
  }

  private arcFor(track: TrackData): Float64Array {
    if (this.arc?.track !== track) this.arc = { track, s: pathArcLengths(track.path, track.closed) };
    return this.arc.s;
  }

  private fitCamera(track: TrackData, aspect: number): void {
    this.orbit = fitOrbit(track, aspect);
  }

  /** Leaving the fly-through: orbit the point it was looking at, from where it was. */
  private orbitFromFly(): void {
    const l = this.look;
    const len = Math.hypot(l[0], l[1], l[2]) || 1;
    const d = 20;
    this.orbit = {
      target: [this.eye[0] + (l[0] / len) * d, this.eye[1] + (l[1] / len) * d, this.eye[2] + (l[2] / len) * d],
      azimuth: Math.atan2(-l[0], -l[2]),
      elevation: Math.asin(Math.min(Math.max(-l[1] / len, -1), 1)),
      distance: d,
    };
  }

  private hideScreen(): void {
    this.shown = false;
    this.token++;
    this.cancelTimer();
    this.held.forward = this.held.right = this.held.up = 0;
    this.stopBenchmark();
    this.ui?.hide();
    const ctx = this.app();
    // A build that was still running is dropped: what is on screen is what the pilot saw last.
    if (ctx !== null && (this.preview.status === 'working' || this.preview.status === 'error')) this.preview = idlePreview(ctx.world.track);
    // Back to the start screen with the world it had: a settings build the builder held runs now.
    ctx?.preview?.resume();
    ctx?.rig.snap();
    this.changed();
  }

  private schedule(delay: number): void {
    const ctx = this.app();
    if (ctx === null) return;
    const token = ++this.token;
    this.cancelTimer();
    this.preview = { status: 'working', stage: 'Waiting for the last change', progress: 0, track: ctx.world.track, message: '' };
    this.changed();
    this.timer = window.setTimeout(() => {
      this.timer = -1;
      void this.run(token);
    }, delay);
  }

  private cancelTimer(): void {
    if (this.timer >= 0) window.clearTimeout(this.timer);
    this.timer = -1;
  }

  private progress(token: number, stage: string, f: number): void {
    const ctx = this.app();
    if (ctx === null || token !== this.token) return;
    this.preview = { status: 'working', stage, progress: Math.min(Math.max(f, 0), 1), track: ctx.world.track, message: '' };
    this.changed();
  }

  /** The terrain to build on: the one on screen, the one from before, the last one generated, or a new one. */
  private async terrainFor(ctx: AppCtx, seed: number, quality: RenderQuality, token: number): Promise<Terrain> {
    for (const w of [ctx.world, this.before]) {
      if (w !== null && w.terrainSeed === seed && w.quality === quality) return { seed, quality, terrain: w.terrain, sampler: w.sampler };
    }
    if (this.cache !== null && this.cache.seed === seed && this.cache.quality === quality) return this.cache;
    this.progress(token, 'Generating terrain', 0);
    const terrain = await generateTerrainAsync({ seed, quality }, (stage, f) => this.progress(token, stage, f * 0.85));
    if (token !== this.token) throw new StaleBuild('terrain replaced');
    this.cache = { seed, quality, terrain, sampler: createTerrainSampler(terrain) };
    return this.cache;
  }

  private async run(token: number): Promise<void> {
    const ctx = this.app();
    if (ctx === null || token !== this.token) return;
    const recipe = this.recipe;
    const seed = this.terrainSeed;
    const quality = this.quality;
    try {
      const base = await this.terrainFor(ctx, seed, quality, token);
      this.progress(token, 'Placing track', 0.9);
      const res = await this.worker.build(base.terrain, base.sampler, recipeRequest(recipe));
      if (token !== this.token) return;
      const world: World = { ...res, terrain: base.terrain, sampler: base.sampler, terrainSeed: seed, baseSeed: seed, quality };
      const used = res.track.recipe;
      const notes: string[] = [];
      if (used !== undefined && used.seed !== recipe.seed) notes.push(`Seed ${recipe.seed} had no fit on this terrain, so this is seed ${used.seed}.`);
      if (res.track.gates.length < recipe.gateCount) notes.push(`${res.track.gates.length} of the ${recipe.gateCount} gates fit.`);
      this.put(world, token, notes.join(' '));
    } catch (e) {
      if (e instanceof StaleBuild || token !== this.token) return;
      console.warn('builder: build failed', e);
      this.preview = { status: 'error', stage: '', progress: 0, track: ctx.world.track, message: `No track fits that recipe here (${(e as Error).message}). Try another seed, fewer gates, a shorter length or another terrain.` };
      this.changed();
    }
  }

  /** Puts a world on screen between two frames (later if the app is busy), and refits the camera onto a new terrain. */
  private put(world: World, token: number, note: string): void {
    const ctx = this.app();
    if (ctx === null || token !== this.token) return;
    const terrainChanged = ctx.world.terrain !== world.terrain;
    if (!landWorld(ctx, world)) {
      this.timer = window.setTimeout(() => {
        this.timer = -1;
        this.put(world, token, note);
      }, LAND_RETRY_MS);
      return;
    }
    this.landed = world === this.before ? this.landed : world;
    this.preview = idlePreview(world.track);
    this.note = note;
    ctx.preview?.adopt(world);
    if (terrainChanged) this.fitCamera(world.track, ctx.aspect);
    if (this.mode === 'fly') this.flyS = 0;
    this.changed();
  }

  private applyImport(v: ImportedTrack, name: string): void {
    const ctx = this.app();
    if (ctx === null) return;
    this.terrainSeed = v.terrainSeed ?? this.terrainSeed;
    this.quality = v.quality ?? this.quality;
    if (v.recipe !== undefined) {
      this.recipe = v.recipe;
      this.schedule(0);
      this.savedName = cleanName(name);
      return;
    }
    if (v.track !== undefined) void this.placeTrack(v.track, cleanName(name));
  }

  /** A track from a file (no recipe): its terrain, a validation, then on screen as it is. */
  private async placeTrack(track: TrackData, name: string): Promise<void> {
    const ctx = this.app();
    if (ctx === null) return;
    const token = ++this.token;
    this.cancelTimer();
    this.preview = { status: 'working', stage: 'Loading the track', progress: 0, track: ctx.world.track, message: '' };
    this.changed();
    try {
      const base = await this.terrainFor(ctx, this.terrainSeed, this.quality, token);
      if (token !== this.token) return;
      const check = validateTrack(track, base.sampler);
      if (!check.ok) throw new Error(`it does not fit terrain ${this.terrainSeed}: ${check.errors.slice(0, 2).join('; ')}`);
      const laps = track.closed ? track.laps : 1;
      const world: World = {
        track: { ...track, laps }, seed: track.seed, style: track.style, attempts: 0,
        request: { seed: track.seed, style: track.style, gateCount: track.gates.length, laps, difficulty: 0.5 },
        terrain: base.terrain, sampler: base.sampler, terrainSeed: this.terrainSeed, baseSeed: this.terrainSeed, quality: this.quality,
      };
      this.savedName = name;
      this.put(world, token, 'A track from a file: it flies as it is (no recipe, so the sliders do not change it).');
    } catch (e) {
      if (e instanceof StaleBuild || token !== this.token) return;
      this.preview = { status: 'error', stage: '', progress: 0, track: ctx.world.track, message: `Could not load that track: ${(e as Error).message}` };
      this.changed();
    }
  }

  private async runBench(ctx: AppCtx, names: readonly string[], token: number): Promise<void> {
    const world = ctx.world;
    const ground = new PadGround(world.sampler, world.track);
    const track = sessionTrack(ground, world.track);
    const colliders = [...ctx.colliders];
    const board = this.boardFor(world);
    const laps = track.closed ? track.laps : 1;
    const limit = benchTimeLimit(estimateLapTime(track), laps);
    const dt = 1 / BRAIN_PHYSICS_HZ;
    const steps = Math.round(limit / dt);
    this.benchList = names.map((name) => ({ name, finish: NaN, gates: 0, gateTotal: track.gates.length * laps, crashes: 0, running: false }));
    this.benchRunning = true;
    this.benchNote = `Each brain gets ${limit} s of sim time, in still air.`;
    this.changed();
    let finished = 0;
    const snap = createRaceSnapshot();
    for (const r of this.benchList) {
      if (token !== this.benchToken) return;
      let racer: BrainRacer;
      try {
        const brain = await ctx.brains.load(r.name);
        racer = new BrainRacer(brain, { ground, groundHeightAt: ground.groundHeightAt, track, colliders }, { config: getPreset(brain.quad), seed: 1 });
      } catch (e) {
        r.running = false;
        this.benchNote = `${r.name}: ${(e as Error).message}`;
        continue;
      }
      if (token !== this.benchToken) return;
      racer.go = true;
      r.running = true;
      this.changed();
      let painted = performance.now();
      let i = 0;
      while (i < steps && !racer.finished) {
        const t0 = performance.now();
        do {
          for (let k = 0; k < BENCH_CHECK_STEPS && i < steps && !racer.finished; k++, i++) racer.step(dt);
        } while (i < steps && !racer.finished && performance.now() - t0 < BENCH_SLICE_MS);
        r.gates = gatesCleared(racer.timer.fill(snap, racer.time), track.closed);
        r.crashes = racer.crashes;
        // The table updates a few times a second; repainting the whole builder after every slice would eat the idle time.
        if (performance.now() - painted >= BENCH_PAINT_MS) {
          painted = performance.now();
          this.changed();
        }
        await new Promise<void>((resolve) => setTimeout(resolve, 0));
        if (token !== this.benchToken) return;
        if (this.app()?.world !== world) {
          this.benchToken++;
          this.benchRunning = false;
          this.benchNote = 'The track changed, so the benchmark stopped.';
          for (const x of this.benchList) x.running = false;
          this.changed();
          return;
        }
      }
      r.running = false;
      const result = racer.timer.fill(createRaceSnapshot(), racer.time);
      r.gates = gatesCleared(result, track.closed);
      r.crashes = racer.crashes;
      if (racer.finished) {
        finished++;
        // The race time from the first gate, the same number the leaderboard keeps (not the time since GO, which adds the run-up).
        r.finish = result.totalTime;
        this.recordOn(board, r.name, 'brain', result);
      }
      this.changed();
    }
    if (token !== this.benchToken) return;
    this.benchRunning = false;
    this.benchNote = `Done: ${finished} of ${this.benchList.length} finished within ${limit} s. Finishes are on the leaderboard.`;
    this.changed();
  }

  private changed(): void {
    for (const fn of [...this.listeners]) fn();
  }
}

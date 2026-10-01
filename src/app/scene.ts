/**
 * Putting a world into the running app and building new ones: terrain and track upload to the renderer, physics terrain
 * and colliders, the start pad, wind, the session's track. All entry points leave the app consistent or throw before
 * touching it, so a failed rebuild keeps the old world flying.
 */
import type { ProgressFn, TrackData } from '../contracts';
import { generateTerrainAsync, createTerrainSampler } from '../world/terrain';
import { generateTrack, trackColliders } from '../world/track';
import type { AppSettings } from '../ui/settingsSchema';
import { reportError, type AppCtx } from './state';
import type { PadGround } from './padGround';
import type { WorldSettings } from './preview';
import { buildTrack, buildWorld, type TrackRequest, type World, type WorldDeps } from './world';

export const worldDeps: WorldDeps = { generateTerrain: generateTerrainAsync, createSampler: createTerrainSampler, generateTrack };

/** The track the session flies: identical, but the start is on top of the pad plate instead of on the bare terrain. */
export function sessionTrack(ground: PadGround, track: TrackData): TrackData {
  if (!Number.isFinite(ground.padTop)) return track;
  return { ...track, start: { pos: [track.start.pos[0], ground.padTop, track.start.pos[2]], yaw: track.start.yaw } };
}

export function trackRequest(s: Pick<AppSettings, 'seed' | 'trackStyle' | 'gateCount' | 'laps' | 'difficulty'>, seed: number = s.seed): TrackRequest {
  return { seed, style: s.trackStyle, gateCount: s.gateCount, laps: s.laps, difficulty: s.difficulty };
}

/** Wind from the settings into the model, then to physics and the render modules (objects and vegetation keep the arrays). */
export function applyWind(ctx: AppCtx): void {
  const s = ctx.store.get();
  ctx.wind.configure(s.windSpeed, s.windDirDeg);
  // Calm settings mean still air: no turbulence and no discrete gusts either (the physics default has both).
  const calm = s.windSpeed <= 0;
  ctx.physics.setWind({ ...ctx.wind.physics, turbulence: calm ? 0 : 1, gustsPerMinute: calm ? 0 : 1.5 });
  pushWind(ctx);
}

/** The renderer's modules get the model's current values (same numbers physics and audio see). */
export function pushWind(ctx: AppCtx): void {
  ctx.mods.objects.setWind(ctx.wind.dirXZ, ctx.wind.speed);
  ctx.mods.vegetation.setWind(ctx.wind.dirXZ, ctx.wind.speed);
  ctx.last.windSpeed = ctx.wind.speed;
  ctx.last.windX = ctx.wind.dirXZ[0];
  ctx.last.windZ = ctx.wind.dirXZ[1];
}

/**
 * Track boxes plus the trees and boulders the vegetation module scattered. The vegetation list depends on the scene and
 * its wind settings, so this runs after `setScene` and after a settings-driven `setWind`, never per frame.
 */
export function refreshColliders(ctx: AppCtx): void {
  const { world } = ctx;
  const colliders = trackColliders(world.track, world.sampler);
  for (const c of ctx.mods.vegetation.vegetationColliders()) colliders.push(c);
  ctx.physics.setColliders(colliders);
}

/** Puts `world` on screen and in the physics, on the pad, disarmed. */
export function loadWorld(ctx: AppCtx, world: World): void {
  ctx.world = world;
  ctx.ground.set(world.sampler, world.track);
  ctx.physics.setTerrain(ctx.ground);
  ctx.renderer.setScene({ terrain: world.terrain, sampler: world.sampler, track: world.track });
  applyWind(ctx);
  refreshColliders(ctx);
  ctx.mods.objects.setActiveGate(0);
  ctx.last.gate = 0;
  ctx.session.setTrack(sessionTrack(ctx.ground, world.track));
  ctx.rig.snap();
  ctx.audio.reset();
}

/** Runs `job` with the loading overlay up and the frame loop idle; a failure is reported and the old world stays. */
async function withOverlay(ctx: AppCtx, title: string, job: (progress: (stage: string, f: number) => void) => Promise<World | null>): Promise<boolean> {
  if (ctx.busy) return false;
  ctx.busy = true;
  ctx.loading.setProgress(title, 0);
  try {
    // Yield once so the overlay paints before the (synchronous) generators start.
    await new Promise<void>((r) => requestAnimationFrame(() => r()));
    const world = await job((stage, f) => ctx.loading.setProgress(stage, f));
    if (world) {
      ctx.loading.setProgress('Uploading scene', 0.96);
      loadWorld(ctx, world);
    }
    return true;
  } catch (e) {
    console.error('world rebuild failed', e);
    ctx.ui.notice(`Could not build a new world: ${(e as Error).message}`, true);
    return false;
  } finally {
    ctx.loading.hide();
    ctx.busy = false;
  }
}

/**
 * New track on the same terrain (N key, menu "new track"): the seed moves on by one. If the settings now ask for another
 * world seed or quality, the whole world is rebuilt instead.
 */
export function newTrack(ctx: AppCtx): Promise<boolean> {
  const s = ctx.store.get();
  const w = ctx.world;
  const terrainChanged = s.quality !== w.quality || s.seed !== w.baseSeed;
  if (terrainChanged) return newWorld(ctx);
  const seed = w.seed + 1;
  return withOverlay(ctx, 'Placing track', async () => {
    const res = buildTrack(w.sampler, trackRequest(s, seed), worldDeps);
    return { ...w, ...res };
  });
}

/**
 * New terrain and track from the current settings (seed, quality, style). With `fresh` and nothing changed in the settings
 * the seed moves on by one, so the menu button always gives a different world; the seed setting follows what was built.
 */
export async function newWorld(ctx: AppCtx, fresh = false): Promise<boolean> {
  const s = ctx.store.get();
  const sameSettings = s.seed === ctx.world.baseSeed && s.quality === ctx.world.quality;
  const req = { ...trackRequest(s, fresh && sameSettings ? s.seed + 1 : s.seed), quality: s.quality };
  const ok = await withOverlay(ctx, 'Generating terrain', (progress) => buildWorld(req, worldDeps, progress));
  if (ok) ctx.store.patch({ seed: ctx.world.baseSeed });
  return ok;
}

/** Same terrain, a track for the settings: waits one task first so a progress bar can paint before the generator runs. */
export async function buildTrackOnly(world: World, s: WorldSettings): Promise<World> {
  await new Promise<void>((resolve) => setTimeout(resolve, 0));
  return { ...world, ...buildTrack(world.sampler, trackRequest(s), worldDeps) };
}

/** New terrain and track for the settings, in the background: no overlay, the frame loop keeps running on the old world. */
export function buildWorldQuietly(s: WorldSettings, progress: ProgressFn): Promise<World> {
  return buildWorld({ ...trackRequest(s), quality: s.quality }, worldDeps, progress);
}

/** Puts a background-built world on screen between two frames; false (nothing done) while another rebuild owns the app. */
export function landWorld(ctx: AppCtx, world: World): boolean {
  if (ctx.busy) return false;
  ctx.busy = true;
  try {
    loadWorld(ctx, world);
  } finally {
    ctx.busy = false;
  }
  return true;
}

/** Reports a boot-time or loop failure through every channel. */
export function fail(ctx: AppCtx | null, title: string, e: unknown): void {
  const msg = e instanceof Error ? `${e.message}` : String(e);
  reportError(`${title}: ${msg}`);
  if (e instanceof Error && e.stack) console.error(e.stack);
  ctx?.ui.fatal(title, msg);
}

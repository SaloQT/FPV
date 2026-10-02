/**
 * `window.__fpv`: what tests and the screenshot tool read and drive. `main.ts` creates `{ ready: false }` first; this
 * module adds the rest once the app is up.
 *
 *   ready      true after the warm-up frames rendered without a renderer error (never true after an error)
 *   error      first fatal problem (also console.error'd), read by tools/shot.mjs
 *   stats      live: renderer stats plus session and world counters
 *   state()    the true physics QuadState;  race()  the race snapshot (gate index, laps, times)
 *   capture()  RGBA of the last presented frame;  brightness()  mean 0..255 of that capture (cheap night/day check)
 *   advance(n) n deterministic frames at the fixed dt (`fixeddt`, default 1/60); only the last SETTLE_RENDERS are drawn
 *   newTrack() / newWorld()   the N key and the menu's "new world" without keys
 *   patch(p)   change settings like the menu does;  cam(mode)  pick the camera
 *   loseDevice()  pretends the GPU device was lost, to exercise the failure panel and Recover
 *   bench      with `?bench=1`: the result of the scripted run once it finished (see bench.ts);  benchDone  the promise of it
 *
 * `stats.request` is the exact track request that produced the world (seed, style, gates, laps, difficulty: what a share link carries).
 * `stats` carries the renderer's numbers too: displayHz (measured refresh), targetFps, frameCap, dynamicDriver, passMs (GPU ms per
 * frame section, see render/gpuTimer.ts, NaN without timestamp-query) and errorCount.
 */
import type { QuadState } from '../contracts';
import type { CameraMode } from '../game/cameraRig';
import type { RaceSnapshot } from '../game/gateTimer';
import type { AppSettings } from '../ui/settingsSchema';
import type { BenchResult } from './benchModel';
import { present, SETTLE_RENDERS, simulate } from './frame';
import { newTrack, newWorld } from './scene';
import { reportError, type AppCtx } from './state';

export interface CaptureResult {
  width: number;
  height: number;
  rgba: Uint8Array;
}

export interface FpvHook {
  ready: boolean;
  error?: string;
  readonly stats: Record<string, unknown>;
  state(): QuadState;
  race(): RaceSnapshot;
  capture(): Promise<CaptureResult>;
  brightness(): Promise<number>;
  advance(frames: number): Promise<void>;
  newTrack(): Promise<boolean>;
  newWorld(): Promise<boolean>;
  patch(p: Partial<AppSettings>): void;
  cam(mode: CameraMode): void;
  loseDevice(): void;
  bench?: BenchResult;
  benchDone?: Promise<BenchResult>;
}

/**
 * Runs `frames` frames with a fixed dt. All of them simulate; only the last `SETTLE_RENDERS` are drawn (the exposure and
 * temporal history need a few frames, the rest would only cost GPU time). Resolves once the GPU has finished them.
 */
export async function advanceFrames(ctx: AppCtx, frames: number, dt: number = ctx.params.fixedDt): Promise<void> {
  const n = Math.max(0, Math.floor(frames));
  const drawFrom = n - SETTLE_RENDERS;
  for (let i = 0; i < n; i++) {
    simulate(ctx, dt);
    if (i >= drawFrom) present(ctx, dt * 1000, ctx.time * 1000);
    if (ctx.renderer.lost) break;
  }
  await ctx.renderer.device.queue.onSubmittedWorkDone();
}

function collectStats(ctx: AppCtx): Record<string, unknown> {
  const s = ctx.session;
  const w = ctx.world;
  return {
    ...ctx.renderer.stats,
    errors: ctx.renderer.errors.length,
    state: s.state,
    physicsMs: s.stats.physicsMs,
    physicsSteps: s.stats.stepsThisFrame,
    totalSteps: s.stats.totalSteps,
    droppedSteps: s.stats.droppedSteps,
    appTime: ctx.time,
    camera: ctx.rig.mode,
    quality: ctx.store.get().quality,
    seed: w.seed,
    baseSeed: w.baseSeed,
    terrainSeed: w.terrainSeed,
    style: w.style,
    request: { ...w.request },
    gates: w.track.gates.length,
    trackAttempts: w.attempts,
    start: w.track.start.pos.slice(),
    startYaw: w.track.start.yaw,
    resolution: w.terrain.resolution,
    windSpeed: ctx.wind.speed,
    audio: ctx.audio.running,
  };
}

async function meanBrightness(ctx: AppCtx): Promise<number> {
  const { rgba } = await ctx.renderer.capture();
  let sum = 0;
  let count = 0;
  for (let i = 0; i < rgba.length; i += 16) {
    sum += rgba[i] * 0.2126 + rgba[i + 1] * 0.7152 + rgba[i + 2] * 0.0722;
    count++;
  }
  return count > 0 ? sum / count : 0;
}

/** Adds the hooks (everything but `ready`) to `window.__fpv`. */
export function installHooks(ctx: AppCtx): FpvHook {
  const hook = window.__fpv as unknown as FpvHook;
  Object.defineProperty(hook, 'stats', { get: () => collectStats(ctx), enumerable: true, configurable: true });
  hook.state = () => ctx.physics.state;
  hook.race = () => {
    ctx.session.snapshot(ctx.snap);
    return ctx.snap.race;
  };
  hook.capture = () => ctx.renderer.capture();
  hook.brightness = () => meanBrightness(ctx);
  hook.advance = (frames) => advanceFrames(ctx, frames);
  hook.newTrack = () => newTrack(ctx);
  hook.newWorld = () => newWorld(ctx, true);
  hook.patch = (p) => ctx.store.patch(p);
  hook.loseDevice = () => ctx.renderer.simulateLoss('simulated by window.__fpv.loseDevice()');
  hook.cam = (mode) => {
    ctx.camPreferred = mode;
  };
  return hook;
}

/** `ready` only when the frames drawn so far had no renderer error; otherwise the error is published instead. */
export function markReady(ctx: AppCtx): void {
  const r = ctx.renderer;
  if (r.errors.length > 0) reportError(`renderer: ${r.errors[0]}`);
  else if (r.lost) reportError(`renderer: device lost (${r.lost})`);
  else window.__fpv.ready = true;
}

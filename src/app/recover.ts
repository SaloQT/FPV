/**
 * Device loss. A WebGPU device can be lost mid-session (driver reset, GPU hang, GPU unplugged); every GPU resource dies with it. The
 * renderer reports it once, the loop stops, and the failure panel offers "Recover": a fresh renderer with fresh modules on the same
 * canvas, the world uploaded again, the sim exactly where it stopped. If that fails too, the panel says so and Reload is left.
 */
import type { RenderModule } from '../render/contracts';
import { createAtmosphereModule } from '../render/atmosphere';
import { createObjectsModule } from '../render/objects';
import { createPostProcessor } from '../render/post';
import { Renderer } from '../render/renderer';
import { createRTModule } from '../render/rt';
import { createTerrainModule } from '../render/terrain';
import { createVegetationModule } from '../render/vegetation';
import { failApp } from './failure';
import { SETTLE_RENDERS } from './frame';
import type { Loop } from './loop';
import { applyWind, refreshColliders } from './scene';
import { renderSettings, type AppCtx, type AppMods } from './state';
import { advanceFrames } from './testHooks';

/** The app's render modules: the handles the app talks to, and the list in the order the frame graph runs them. */
export function createAppModules(): { mods: AppMods; list: RenderModule[] } {
  const mods: AppMods = { atmosphere: createAtmosphereModule(), objects: createObjectsModule(), vegetation: createVegetationModule() };
  return { mods, list: [mods.atmosphere, createTerrainModule(), mods.vegetation, mods.objects, createRTModule()] };
}

/**
 * Builds the replacement renderer and puts the world into it. The lost renderer goes first: it shares the canvas context, and its
 * destroy() would unconfigure the new renderer's swapchain if it ran afterwards. If the new one cannot be built this throws and the
 * panel offers Reload.
 */
export async function rebuildRenderer(ctx: AppCtx): Promise<Renderer> {
  try {
    ctx.renderer.destroy();
  } catch (e) {
    console.warn('recover: the lost renderer could not be destroyed cleanly', e);
  }
  const { mods, list } = createAppModules();
  const renderer = await Renderer.create(ctx.canvas, renderSettings(ctx.store.get(), ctx.rig.mode), list, createPostProcessor());
  try {
    renderer.setDisplayRefresh(ctx.renderer.stats.displayHz);
    const dpr = window.devicePixelRatio || 1;
    if (ctx.canvas.clientWidth > 0 && ctx.canvas.clientHeight > 0) renderer.resize(ctx.canvas.clientWidth, ctx.canvas.clientHeight, dpr);
    Object.assign(ctx.mods, mods);
    (ctx as { renderer: Renderer }).renderer = renderer;
    const w = ctx.world;
    renderer.setScene({ terrain: w.terrain, sampler: w.sampler, track: w.track });
    applyWind(ctx);
    refreshColliders(ctx);
    // Forces the module setters (quad visibility, active gate) to run again on the fresh modules.
    ctx.last.hide = null;
    ctx.last.gate = -1;
  } catch (e) {
    renderer.destroy();
    throw e;
  }
  return renderer;
}

/** Makes a lost device show the panel with a Recover button instead of leaving a frozen page. */
export function installRecovery(ctx: AppCtx, loop: Loop): void {
  const watch = (r: Renderer): void => {
    r.onLost = (reason, message) => {
      loop.stop();
      failApp(ctx.root, 'device-lost', `${reason}: ${message}`, { recover: () => recover() });
    };
  };
  const recover = async (): Promise<void> => {
    ctx.busy = true;
    try {
      const renderer = await rebuildRenderer(ctx);
      watch(renderer);
      await advanceFrames(ctx, SETTLE_RENDERS);
      if (renderer.lost) throw new Error(`the new device was lost again (${renderer.lost})`);
      const hook = window as unknown as { __fpv?: { error?: string } };
      if (hook.__fpv) delete hook.__fpv.error;
      loop.start();
    } finally {
      ctx.busy = false;
    }
  };
  watch(ctx.renderer);
}

/**
 * The real-time loop and the browser plumbing around it: requestAnimationFrame with a clamped dt, canvas resizing
 * (ResizeObserver plus devicePixelRatio) and pausing when the tab is hidden.
 */
import { fail } from './scene';
import { present, simulate } from './frame';
import type { AppCtx } from './state';

/** A frame longer than this (tab switch, breakpoint) advances the world by this much only. */
export const MAX_FRAME_DT = 0.1;

export interface Loop {
  start(): void;
  stop(): void;
  readonly running: boolean;
}

/** Keeps the renderer's output size and the camera aspect in step with the canvas. Returns the detach function. */
export function attachResize(ctx: AppCtx): () => void {
  const canvas = ctx.canvas;
  let lastW = 0;
  let lastH = 0;
  let lastDpr = 0;
  const apply = (): void => {
    const w = canvas.clientWidth;
    const h = canvas.clientHeight;
    const dpr = window.devicePixelRatio || 1;
    if (w < 1 || h < 1 || (w === lastW && h === lastH && dpr === lastDpr)) return;
    lastW = w;
    lastH = h;
    lastDpr = dpr;
    ctx.aspect = w / h;
    ctx.renderer.resize(w, h, dpr);
  };
  const ro = new ResizeObserver(apply);
  ro.observe(canvas);
  window.addEventListener('resize', apply);
  apply();
  return () => {
    ro.disconnect();
    window.removeEventListener('resize', apply);
  };
}

export function createLoop(ctx: AppCtx): Loop {
  let raf = 0;
  let running = false;
  let last = 0;

  const tick = (now: number): void => {
    if (!running) return;
    raf = requestAnimationFrame(tick);
    const real = last === 0 ? 1 / 60 : Math.max(0, (now - last) / 1000);
    last = now;
    if (ctx.hidden || ctx.busy) return;
    try {
      simulate(ctx, Math.min(real, MAX_FRAME_DT));
      present(ctx, real * 1000, now);
    } catch (e) {
      loop.stop();
      fail(ctx, 'The frame loop stopped', e);
    }
  };

  const onVisibility = (): void => {
    ctx.hidden = document.hidden;
    if (document.hidden) {
      // Pause the sim (the pause overlay is what the pilot returns to) and silence the audio.
      const s = ctx.session.state;
      if (s !== 'menu' && s !== 'paused') ctx.session.togglePause();
      ctx.audio.setMuted(true);
    } else {
      last = 0;
    }
  };

  const loop: Loop = {
    get running() {
      return running;
    },
    start() {
      if (running) return;
      running = true;
      last = 0;
      ctx.hidden = document.hidden;
      document.addEventListener('visibilitychange', onVisibility);
      raf = requestAnimationFrame(tick);
    },
    stop() {
      running = false;
      cancelAnimationFrame(raf);
      document.removeEventListener('visibilitychange', onVisibility);
    },
  };
  return loop;
}

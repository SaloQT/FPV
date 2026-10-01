/**
 * `?bench=1`: a scripted fly-through at fixed settings (see perfParams.ts), measured over the real-time loop, then
 * `window.__fpv.bench` and a results panel. `window.__fpv.benchDone` is a promise for the same result so scripts can await it.
 */
import { PASS_NAMES } from '../render/gpuTimer';
import { BenchPanel } from '../ui/benchPanel';
import { BenchRecorder, benchVerdict, type BenchResult } from './benchModel';
import type { Loop } from './loop';
import type { PerfParams } from './perfParams';
import type { AppCtx } from './state';
import type { FpvHook } from './testHooks';

const PROGRESS_REFRESH_MS = 250;

function qualityText(ctx: AppCtx): string {
  const s = ctx.store.get();
  return s.performance240 ? `${s.quality} + Performance 240` : s.quality;
}

function collect(ctx: AppCtx, rec: BenchRecorder): BenchResult {
  const st = ctx.renderer.stats;
  const a = ctx.renderer.adapter;
  return rec.result({
    device: { vendor: a.vendor, architecture: a.architecture, description: a.description, software: a.software },
    renderWidth: st.renderWidth, renderHeight: st.renderHeight, outWidth: st.outWidth, outHeight: st.outHeight,
    quality: qualityText(ctx), refreshHz: st.displayHz,
  });
}

/** Hooks the benchmark onto the running loop. Returns the promise of the result. */
export function startBench(ctx: AppCtx, loop: Loop, perf: PerfParams): Promise<BenchResult> {
  const hook = window.__fpv as unknown as FpvHook;
  const rec = new BenchRecorder(PASS_NAMES, perf.benchSeconds, perf.benchWarmup);
  const panel = new BenchPanel(ctx.root);
  let lastPaint = -Infinity;
  const done = new Promise<BenchResult>((resolve) => {
    loop.onFrame = (frameMs, nowMs) => {
      const st = ctx.renderer.stats;
      if (!rec.push(frameMs, st.gpuMs ?? NaN, st.passMs, st.renderWidth / Math.max(1, st.outWidth))) {
        if (nowMs - lastPaint >= PROGRESS_REFRESH_MS) {
          lastPaint = nowMs;
          panel.progress(rec.elapsed, rec.total, rec.warmingUp);
        }
        return;
      }
      loop.onFrame = null;
      const result = collect(ctx, rec);
      hook.bench = result;
      console.info('benchmark', JSON.stringify(result));
      panel.show(result, benchVerdict(result), { onRerun: () => location.reload(), onClose: () => undefined, json: () => JSON.stringify(result, null, 2) });
      resolve(result);
    };
  });
  hook.benchDone = done;
  return done;
}

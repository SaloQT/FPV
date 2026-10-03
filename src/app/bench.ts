/** Explicit benchmark mode, with source-frame attribution for asynchronous GPU samples. */
import { PASS_NAMES, type GpuTimingSample } from '../render/gpuTimer';
import { BenchPanel } from '../ui/benchPanel';
import { BenchRecorder, benchVerdict, type BenchResult } from './benchModel';
import type { Loop } from './loop';
import type { PerfParams } from './perfParams';
import type { AppCtx } from './state';
import type { FpvHook } from './testHooks';

const PROGRESS_REFRESH_MS = 250;
const snapshot = <T>(value: T): T => JSON.parse(JSON.stringify(value));

function qualityText(ctx: AppCtx): string {
  const s = ctx.store.get();
  return s.performance240 ? `${s.quality} + Performance 240` : s.quality;
}

/** Returns the exact exported result; drain time is outside the measured frame window. */
export function startBench(ctx: AppCtx, loop: Loop, perf: PerfParams): Promise<BenchResult> {
  const hook = window.__fpv as unknown as FpvHook;
  const renderer = ctx.renderer;
  const rec = new BenchRecorder(PASS_NAMES, perf.benchSeconds, perf.benchWarmup);
  const panel = new BenchPanel(ctx.root);
  const initialErrors = renderer.totalErrorCount;
  const initialSettings = ctx.store.get();
  const initialQuality = renderer.qualityProfile;
  const initialWorld = ctx.world;
  let configurationChanged = false;
  const dimensions = () => {
    const s = renderer.stats;
    return { renderWidth: s.renderWidth, renderHeight: s.renderHeight, outWidth: s.outWidth, outHeight: s.outHeight };
  };
  const initialDimensions = dimensions();
  const provenance = {
    startedAt: new Date().toISOString(), browserUserAgent: navigator.userAgent, url: location.href,
    appParams: snapshot(ctx.params), settings: snapshot(ctx.store.get()), qualityProfile: snapshot(renderer.qualityProfile),
    world: { seed: ctx.world.seed, terrainSeed: ctx.world.terrainSeed, request: snapshot(ctx.world.request) },
    warmupSeconds: perf.benchWarmup, requestedSeconds: perf.benchSeconds, dimensions: initialDimensions,
    devicePixelRatio: window.devicePixelRatio || 1,
    refresh: { hz: renderer.stats.displayHz, source: renderer.stats.displaySource },
  };
  const pending: GpuTimingSample[] = [];
  let lastPaint = -Infinity;
  let finalizing = false, closed = false;
  const consume = () => { for (const sample of pending) rec.recordGpu(sample); pending.length = 0; };
  // Dropped samples can arrive during render(), before onFrame admits that source frame. Queue until admission.
  const unlisten = renderer.listenGpuTimings(sample => {
    if (closed) return;
    pending.push(sample);
    if (finalizing) consume();
  });
  const previousLost = renderer.onLost;
  const done = new Promise<BenchResult>((resolve) => {
    const finish = async (reason: string | null = null): Promise<void> => {
      if (finalizing) return;
      finalizing = true;
      loop.onFrame = null;
      unlisten(); // In-flight callbacks retain this listener until drained; closed guards the timeout path.
      consume();
      const finalDimensions = dimensions();
      const finalQualityProfile = snapshot(renderer.qualityProfile);
      const finalQuality = qualityText(ctx);
      const errorsAtMeasurementEnd = renderer.totalErrorCount;
      const drained = await renderer.drainGpuTimings();
      consume();
      const errorCount = renderer.totalErrorCount;
      closed = true;
      if (renderer.onLost === onLost) renderer.onLost = previousLost;
      const a = renderer.adapter;
      const incompleteReason = reason ?? (renderer.lost ? `device lost: ${renderer.lost}` :
        !drained ? 'GPU readback drain timed out' :
        initialErrors > 0 ? 'renderer already had errors before measurement' :
        errorCount !== initialErrors ? 'renderer errors occurred during measurement or asynchronous drain' :
        configurationChanged ? 'settings, scene, quality or dimensions changed during measurement' : null);
      const result = rec.result({
        device: { ...a, classification: a.software ? 'software' : a.vendor || a.architecture || a.description || a.device ? 'unverified' : 'unknown' },
        ...finalDimensions, quality: finalQuality, refreshHz: renderer.stats.displayHz,
        profiling: renderer.gpuProfiling, incompleteReason,
        provenance: { ...provenance, finalDimensions, finalQualityProfile, rendererErrorCount: errorCount, errorsAtMeasurementStart: initialErrors, errorsAtMeasurementEnd, readbacksDrained: drained },
      });
      hook.bench = result;
      console.info('benchmark', JSON.stringify(result));
      panel.show(result, benchVerdict(result), { onRerun: () => location.reload(), onClose: () => undefined, json: () => JSON.stringify(result, null, 2) });
      resolve(result);
    };
    const onLost = (reason: string, message: string) => {
      previousLost?.(reason, message);
      void finish(`device lost: ${reason}: ${message}`);
    };
    renderer.onLost = onLost;
    loop.onFrame = (frameMs, nowMs) => {
      if (ctx.renderer !== renderer) { void finish('renderer changed during measurement'); return; }
      const st = renderer.stats;
      configurationChanged ||= ctx.store.get() !== initialSettings || renderer.qualityProfile !== initialQuality || ctx.world !== initialWorld ||
        ctx.world.seed !== provenance.world.seed || ctx.world.terrainSeed !== provenance.world.terrainSeed ||
        st.renderWidth !== initialDimensions.renderWidth || st.renderHeight !== initialDimensions.renderHeight ||
        st.outWidth !== initialDimensions.outWidth || st.outHeight !== initialDimensions.outHeight;
      const complete = rec.push(frameMs, NaN, [], st.renderWidth / Math.max(1, st.outWidth), st.frameIndex);
      consume();
      if (complete) { void finish(); return; }
      if (nowMs - lastPaint >= PROGRESS_REFRESH_MS) {
        lastPaint = nowMs;
        panel.progress(rec.elapsed, rec.total, rec.warmingUp);
      }
    };
  });
  hook.benchDone = done;
  return done;
}

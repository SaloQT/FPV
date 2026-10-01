import type { Settings } from '../../contracts';
import type { PostProcessorDev } from '../../render/post';
import type { Renderer } from '../../render/renderer';
import { probeGBuffer } from '../objects/probe';
import type { SceneState } from './params';
import { countIsolatedBlack, countNonFiniteHalf, lineCentroid, meanLuminance, readHalfTexture } from './probes';

export interface StepOptions {
  /** Pre-exposure factor baked into the HDR and told to the post stages; stays in force until changed. */
  premul?: number;
  dt?: number;
}

export interface Harness {
  renderer: Renderer;
  post: PostProcessorDev;
  state: SceneState;
  settings: Settings;
  /** Renders n frames, waiting for the GPU after each one. */
  step(n: number, o?: StepOptions): Promise<void>;
}

const r3 = (v: number): number => Math.round(v * 1000) / 1000;

/**
 * Numeric checks of the post chain for headless runs (`--eval "window.__fpv.checks.exposure()"`). Each one runs on a static camera with
 * video noise off, then restores the page's state. Sizes matter on SwiftShader: use --size 480x270.
 */
export function createChecks(h: Harness) {
  async function isolated<T>(patch: Partial<Settings>, run: () => Promise<T>): Promise<T> {
    const { motion, grid, radiance, sunNits, lampNits } = h.state;
    h.state.motion = false;
    h.renderer.setSettings({ ...h.settings, videoNoise: 0, ...patch });
    try {
      return await run();
    } finally {
      Object.assign(h.state, { motion, grid, radiance, sunNits, lampNits });
      h.renderer.setSettings(h.settings);
      await h.step(0, { premul: 1 });
    }
  }

  async function shot(): Promise<{ width: number; height: number; rgba: Uint8Array; luma: number }> {
    const c = await h.renderer.capture();
    return { ...c, luma: meanLuminance(c.rgba, c.width, c.height) };
  }

  return {
    /** Day look: scenes 4 stops apart must land on the same output brightness (within 10%) and the exposure ratio must differ by about 4 EV. (Under about 100 nits the key falls and the gain caps, by design.) */
    async exposure(scales: number[] = [1, 1 / 16, 1], frames = 14) {
      return isolated({}, async () => {
        const base = { radiance: h.state.radiance, sunNits: h.state.sunNits, lampNits: h.state.lampNits };
        const samples: { scale: number; luma: number; ev: number | null }[] = [];
        for (const s of scales) {
          h.state.radiance = base.radiance * s;
          h.state.sunNits = base.sunNits * s;
          h.state.lampNits = base.lampNits * s;
          await h.step(frames, { dt: 0.25, premul: 1 });
          await h.step(3, { dt: 0 });
          const { luma } = await shot();
          samples.push({ scale: s, luma: r3(luma), ev: h.post.getStats().exposureEv });
        }
        const spread = Math.max(...samples.map((x) => Math.abs(x.luma / samples[0].luma - 1)));
        const evs = samples.map((x) => x.ev ?? NaN);
        return { samples, lumaSpread: r3(spread), evStep: r3(evs[1] - evs[0]), pass: spread < 0.1 };
      });
    },

    /** Forces jumps of the CPU pre-exposure by factors up to 4; the output brightness may not move by more than 3% per frame. */
    async pop(factors: number[] = [1, 1, 4, 4, 0.25, 0.25, 1, 1]) {
      return isolated({}, async () => {
        await h.step(12, { dt: 0.25, premul: 1 });
        await h.step(3, { dt: 1 / 60 });
        const lumas: number[] = [(await shot()).luma];
        for (const f of factors) {
          await h.step(1, { premul: f });
          lumas.push((await shot()).luma);
        }
        const changes = lumas.slice(1).map((l, i) => Math.abs(l / lumas[i] - 1));
        return { lumas: lumas.map(r3), changesPct: changes.map((c) => r3(c * 100)), maxChangePct: r3(Math.max(...changes) * 100), pass: Math.max(...changes) < 0.03 };
      });
    },

    /** No NaN/Inf anywhere in the chain (G-buffer, TAA output, bloom output) and no dead pixels in the image, also with a very bright HDR. */
    async finite(factors: number[] = [1, 64]) {
      return isolated({}, async () => {
        const rows = [];
        for (const premul of factors) {
          await h.step(8, { dt: 1 / 60, premul });
          const gb = await probeGBuffer(h.renderer);
          const tex = h.post.debugTextures();
          const resolved = countNonFiniteHalf(await readHalfTexture(h.renderer.device, tex.resolved));
          const bloom = countNonFiniteHalf(await readHalfTexture(h.renderer.device, tex.bloom));
          const s = await shot();
          rows.push({ premul, gbufferNonFinite: gb.nonFinite, hdrMax: gb.hdrMax, resolvedNonFinite: resolved, bloomNonFinite: bloom, isolatedBlack: countIsolatedBlack(s.rgba, s.width, s.height), luma: r3(s.luma) });
        }
        const bad = rows.some((r) => r.gbufferNonFinite + r.resolvedNonFinite + r.bloomNonFinite + r.isolatedBlack > 0);
        return { rows, pass: !bad };
      });
    },

    /** Grid lines every 60 px must land on their exact pixel position (lens 0, TAA converged): tests distortion identity and jitter bias. */
    async grid(lens = 0, frames = 24) {
      return isolated({ lensDistortion: lens }, async () => {
        h.state.grid = true;
        await h.step(frames, { dt: 1 / 60, premul: 1 });
        const { width, height, rgba } = await shot();
        const errors: number[] = [];
        for (let p = 60; p <= width - 60; p += 60) errors.push(lineCentroid(rgba, width, 'x', p, 8, [80, 100]) - p);
        for (let p = 60; p <= height - 60; p += 60) errors.push(lineCentroid(rgba, width, 'y', p, 8, [80, 100]) - p);
        const abs = errors.map(Math.abs);
        return { lines: errors.length, maxErrorPx: r3(Math.max(...abs)), meanErrorPx: r3(abs.reduce((a, b) => a + b, 0) / abs.length), errors: errors.map(r3), pass: Math.max(...abs) < 0.5 };
      });
    },
  };
}

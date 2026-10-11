import { unpackAssets } from './treePack';
import { VARIANT_DEFS, type VariantAsset } from './variants';

/**
 * Builds the tree variants on worker threads, one share per worker, so a start (the extreme tier's crowns take a few minutes of CPU) runs on
 * every core and the page stays responsive. Returns the trees by variant index (null for rocks, which the caller builds), or null where
 * there are no workers (the offline Node tools), in which case the caller builds everything itself. `only` limits it to those tree
 * variants (the ones the disk cache did not have); the others come back null.
 */
export async function buildTreesInWorkers(dense: boolean, only?: readonly number[]): Promise<(VariantAsset | null)[] | null> {
  if (typeof Worker === 'undefined' || typeof navigator === 'undefined') return null;
  const trees = VARIANT_DEFS.map((d, v) => (d.rock < 0 && (!only || only.includes(v)) ? v : -1)).filter((v) => v >= 0);
  const count = Math.max(1, Math.min(trees.length, (navigator.hardwareConcurrency || 4) - 1));
  // One variant per worker where there are cores enough, else dealt round-robin, so each gets a mix of heavy (oak, birch, beech) and light ones.
  const shares: number[][] = Array.from({ length: count }, () => []);
  trees.forEach((v, i) => shares[i % count].push(v));
  const out: (VariantAsset | null)[] = VARIANT_DEFS.map(() => null);
  try {
    await Promise.all(shares.map((variants) => new Promise<void>((resolve, reject) => {
      const worker = new Worker(new URL('./treeBuild.worker.ts', import.meta.url), { type: 'module' });
      worker.onmessage = (e: MessageEvent<{ variants: number[]; buffer: ArrayBuffer }>) => {
        const assets = unpackAssets(e.data.buffer, e.data.variants.map((v) => VARIANT_DEFS[v]));
        worker.terminate();
        if (!assets) { reject(new Error('tree build worker returned a malformed buffer')); return; }
        e.data.variants.forEach((v, i) => { out[v] = assets[i]; });
        resolve();
      };
      worker.onerror = (e) => { worker.terminate(); reject(e); };
      worker.postMessage({ dense, variants });
    })));
  } catch {
    // A worker that fails (a blocked script, an old browser) only costs the build its speed: the caller builds on the main thread.
    return null;
  }
  return out;
}

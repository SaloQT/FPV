/**
 * Terrain generation without blocking the page: in a module Worker where available, otherwise sliced on the calling thread
 * (Node, tests, or a Worker that fails to start). Both routes run the same code, so the result is bit-identical.
 */
import type { ProgressFn, TerrainData, TerrainParams } from '../../contracts';
import { terrainSteps } from './generate';
import type { TerrainWorkerReply } from './worker';

/** Longest stretch of main-thread generation between hand-backs to the event loop. */
const SLICE_MS = 8;

export function generateTerrainAsync(params: TerrainParams, onProgress?: ProgressFn): Promise<TerrainData> {
  if (typeof Worker === 'undefined') return generateSliced(params, onProgress);
  return new Promise<TerrainData>((resolve, reject) => {
    let worker: Worker;
    try {
      worker = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' });
    } catch {
      generateSliced(params, onProgress).then(resolve, reject);
      return;
    }
    worker.onmessage = (event: MessageEvent<TerrainWorkerReply>) => {
      const reply = event.data;
      if (reply.type === 'progress') {
        onProgress?.(reply.stage, reply.fraction);
        return;
      }
      worker.terminate();
      if (reply.type === 'done') resolve(reply.data);
      else reject(new Error(reply.message));
    };
    worker.onerror = () => {
      worker.terminate();
      generateSliced(params, onProgress).then(resolve, reject);
    };
    worker.postMessage({ params });
  });
}

async function generateSliced(params: TerrainParams, onProgress?: ProgressFn): Promise<TerrainData> {
  const steps = terrainSteps(params, onProgress);
  let sliceStart = performance.now();
  for (;;) {
    const step = steps.next();
    if (step.done === true) return step.value;
    if (performance.now() - sliceStart >= SLICE_MS) {
      await new Promise<void>((resolve) => setTimeout(resolve, 0));
      sliceStart = performance.now();
    }
  }
}

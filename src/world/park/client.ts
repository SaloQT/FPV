import type { ProgressFn } from '../../contracts';
import { buildPark } from './build';
import type { ParkBuild, ParkRecipe } from './types';
import type { ParkReply } from './worker';

export function generateParkAsync(recipe: ParkRecipe, progress?: ProgressFn): Promise<ParkBuild> {
  if (typeof Worker === 'undefined') return Promise.resolve(buildPark(recipe, progress));
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' });
    worker.onerror = e => { worker.terminate(); reject(new Error(e.message || 'Theme park worker failed')); };
    worker.onmessage = (e: MessageEvent<ParkReply>) => {
      const r = e.data;
      if (r.type === 'progress') progress?.(r.stage, r.fraction);
      else { worker.terminate(); if (r.type === 'done') resolve(r.data); else reject(new Error(r.message)); }
    };
    worker.postMessage(recipe);
  });
}

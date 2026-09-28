/** Web Worker entry: generates a terrain off the main thread and transfers the finished arrays back without copying. */
import type { TerrainData, TerrainParams } from '../../contracts';
import { generateTerrain } from './generate';

export type TerrainWorkerReply =
  | { type: 'progress'; stage: string; fraction: number }
  | { type: 'done'; data: TerrainData }
  | { type: 'error'; message: string };

interface WorkerScope {
  onmessage: ((event: MessageEvent<{ params: TerrainParams }>) => void) | null;
  postMessage(message: TerrainWorkerReply, transfer?: Transferable[]): void;
}

const scope = self as unknown as WorkerScope;

scope.onmessage = (event) => {
  try {
    const data = generateTerrain(event.data.params, (stage, fraction) => scope.postMessage({ type: 'progress', stage, fraction }));
    const buffers = new Set<ArrayBufferLike>([data.height.buffer]);
    for (const map of Object.values(data.maps)) buffers.add(map.buffer);
    scope.postMessage({ type: 'done', data }, [...buffers] as Transferable[]);
  } catch (error) {
    scope.postMessage({ type: 'error', message: error instanceof Error ? error.message : String(error) });
  }
};

/**
 * Web Worker entry of the track builder: generates tracks off the main thread so the builder's sliders stay smooth while a
 * recipe is being fitted to the terrain (one generator call can take up to half a second, and a recipe may need retries).
 * The page sends the terrain once (a structured-clone copy: the page keeps its own), then one request per build.
 */
import type { TerrainData, TerrainSampler } from '../contracts';
import { createTerrainSampler } from '../world/terrain/sampler';
import { generateTrack } from '../world/track/generator';
import { buildTrack, type TrackRequest, type TrackResult } from './world';

export type BuilderWorkerRequest =
  | { type: 'terrain'; terrain: TerrainData }
  | { type: 'build'; id: number; req: TrackRequest };

export type BuilderWorkerReply =
  | { type: 'done'; id: number; result: TrackResult }
  | { type: 'error'; id: number; message: string };

interface WorkerScope {
  onmessage: ((event: MessageEvent<BuilderWorkerRequest>) => void) | null;
  postMessage(message: BuilderWorkerReply): void;
}

const scope = self as unknown as WorkerScope;
let sampler: TerrainSampler | null = null;

scope.onmessage = (event) => {
  const msg = event.data;
  if (msg.type === 'terrain') {
    sampler = createTerrainSampler(msg.terrain);
    return;
  }
  try {
    if (sampler === null) throw new Error('no terrain yet');
    scope.postMessage({ type: 'done', id: msg.id, result: buildTrack(sampler, msg.req, { generateTrack }) });
  } catch (error) {
    scope.postMessage({ type: 'error', id: msg.id, message: error instanceof Error ? error.message : String(error) });
  }
};

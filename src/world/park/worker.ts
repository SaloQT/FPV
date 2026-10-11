import { buildPark } from './build';
import type { ParkBuild, ParkRecipe } from './types';

export type ParkReply = { type: 'progress'; stage: string; fraction: number } | { type: 'done'; data: ParkBuild } | { type: 'error'; message: string };
const scope = self as unknown as { onmessage: ((e: MessageEvent<ParkRecipe>) => void) | null; postMessage(m: ParkReply, transfers?: Transferable[]): void };
scope.onmessage = e => {
  try {
    const data = buildPark(e.data, (stage, fraction) => scope.postMessage({ type: 'progress', stage, fraction }));
    const buffers = new Set<ArrayBuffer>();
    buffers.add(data.terrain.height.buffer as ArrayBuffer);
    for (const map of Object.values(data.terrain.maps)) buffers.add(map.buffer as ArrayBuffer);
    for (const ride of data.park.rides) { if (ride.curve) buffers.add(ride.curve.samples.buffer as ArrayBuffer); if (ride.preflight) buffers.add(ride.preflight.cycle.buffer as ArrayBuffer); }
    scope.postMessage({ type: 'done', data }, [...buffers]);
  } catch (error) { scope.postMessage({ type: 'error', message: error instanceof Error ? error.message : String(error) }); }
};

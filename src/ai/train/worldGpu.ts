/** Uploads packed training worlds; `entries` is world.wgsl's group(1) in binding order. */
import { storageBuffer } from '../gpu/gpu';
import type { PackedWorlds } from './worlds';

export interface WorldBuffers {
  entries: GPUBuffer[];
  destroy(): void;
}

export function uploadWorlds(device: GPUDevice, p: PackedWorlds): WorldBuffers {
  const entries = [
    storageBuffer(device, p.tracks, 'world-tracks'),
    storageBuffer(device, p.heights, 'world-heights'),
    storageBuffer(device, p.gates, 'world-gates'),
    storageBuffer(device, p.boxes, 'world-boxes'),
    storageBuffer(device, p.gridCells, 'world-grid-cells'),
    storageBuffer(device, p.gridItems, 'world-grid-items'),
    storageBuffer(device, p.paths, 'world-paths'),
  ];
  return { entries, destroy: () => entries.forEach((b) => b.destroy()) };
}

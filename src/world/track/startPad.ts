/** Launch pad: 8-12 m behind the first gate, on the flattest dry ground near the reverse heading, facing the gate. */
import type { TerrainSampler, TrackGate, Vec3 } from '../../contracts';
import { WATER_MARGIN } from './styles';
import { yawOf } from './spline';

export const PAD_MIN = 8;
export const PAD_MAX = 12;
/** Pad stays at least this far (horizontally) from every other gate so cones and legs never crowd it. */
const PAD_GATE_CLEAR = 6;
const DISTANCES = [8.5, 10, 11.5];
const OFFSETS = [0, 0.2, -0.2, 0.4, -0.4, 0.65, -0.65, 0.95, -0.95];

/** Ground unevenness around a point: worst height difference to the centre over a 1.5 m ring, plus slope. */
function unevenness(s: TerrainSampler, x: number, z: number): number {
  const h = s.heightAt(x, z);
  let worst = 0;
  for (let k = 0; k < 4; k++) {
    const a = (k * Math.PI) / 2;
    worst = Math.max(worst, Math.abs(s.heightAt(x + 1.5 * Math.cos(a), z + 1.5 * Math.sin(a)) - h));
  }
  return worst + 2 * s.slopeAt(x, z);
}

export interface StartPad {
  pos: Vec3;
  yaw: number;
}

/** Best pad for `gates[0]`, or null when every spot is wet, off the map or crowded by another gate. */
export function findStartPad(gates: TrackGate[], sampler: TerrainSampler): StartPad | null {
  const g0 = gates[0];
  const d = sampler.data;
  const half = (d.resolution * d.cellSize) / 2;
  const floor = d.waterLevel + WATER_MARGIN;
  const back = g0.yaw + Math.PI;
  let best: StartPad | null = null;
  let bestCost = Infinity;
  for (const dist of DISTANCES) {
    for (const off of OFFSETS) {
      const h = back + off;
      // A heading a of travel points toward (-sin a, -cos a), so the pad sits at gate + dist * (-sin h, -cos h).
      const x = g0.pos[0] - dist * Math.sin(h);
      const z = g0.pos[2] - dist * Math.cos(h);
      if (Math.abs(x - d.origin[0] - half) > half - 2 || Math.abs(z - d.origin[1] - half) > half - 2) continue;
      const ground = sampler.heightAt(x, z);
      if (ground < floor) continue;
      let crowded = false;
      for (let i = 1; i < gates.length; i++) {
        if (Math.hypot(gates[i].pos[0] - x, gates[i].pos[2] - z) < PAD_GATE_CLEAR) crowded = true;
      }
      if (crowded) continue;
      const cost = unevenness(sampler, x, z) + Math.abs(off) * 0.3 + Math.abs(dist - 10) * 0.02;
      if (cost < bestCost) {
        bestCost = cost;
        best = { pos: [x, ground, z], yaw: yawOf(g0.pos[0] - x, g0.pos[2] - z) };
      }
    }
  }
  return best;
}

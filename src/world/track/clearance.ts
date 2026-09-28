/** Gate height above the terrain, measured on the whole edge of the clear opening. */
import type { TerrainSampler, TrackGate } from '../../contracts';
import { gateOutline, trackGateFrame, type GateFrame } from './gate';

const frame: GateFrame = { right: [0, 0, 0], up: [0, 0, 0], forward: [0, 0, 0] };
const outline: [number, number][] = [];

/** Smallest vertical distance between the opening edge and the ground below it. */
export function gateClearance(gate: TrackGate, sampler: TerrainSampler): number {
  trackGateFrame(gate, frame);
  gateOutline(gate, outline);
  let min = Infinity;
  for (const [u, v] of outline) {
    const x = gate.pos[0] + frame.right[0] * u + frame.up[0] * v;
    const y = gate.pos[1] + frame.right[1] * u + frame.up[1] * v;
    const z = gate.pos[2] + frame.right[2] * u + frame.up[2] * v;
    const c = y - sampler.heightAt(x, z);
    if (c < min) min = c;
  }
  return min;
}

/** Centre height that gives the (already oriented) gate exactly `clearance` metres above the ground at its lowest edge point. */
export function gateHeightForClearance(gate: TrackGate, sampler: TerrainSampler, x: number, z: number, clearance: number): number {
  trackGateFrame(gate, frame);
  gateOutline(gate, outline);
  let y = -Infinity;
  for (const [u, v] of outline) {
    const dx = frame.right[0] * u + frame.up[0] * v;
    const dy = frame.right[1] * u + frame.up[1] * v;
    const dz = frame.right[2] * u + frame.up[2] * v;
    const need = sampler.heightAt(x + dx, z + dz) - dy + clearance;
    if (need > y) y = need;
  }
  return y;
}

/** Highest slope (radians) at the gate centre and at four points 3 m around it. */
export function gateSiteSlope(sampler: TerrainSampler, x: number, z: number): number {
  let s = sampler.slopeAt(x, z);
  for (let k = 0; k < 4; k++) {
    const a = (k * Math.PI) / 2 + Math.PI / 4;
    const sl = sampler.slopeAt(x + 3 * Math.cos(a), z + 3 * Math.sin(a));
    if (sl > s) s = sl;
  }
  return s;
}

/** The scripted flights the parity check flies: pad take-off, a windy gate run, flips, a crash into the ground, an obstacle hit. */
import type { Vec3 } from '../../contracts';
import { gatePlacement, createPlacement, padPlacement } from '../../game/checkpoint';
import type { ParityFlight } from './parity';
import type { TrainWorld } from './worlds';

type Sticks = ReturnType<ParityFlight['sticks']>;
const S = (roll: number, pitch: number, yaw: number, throttle: number): Sticks => ({ roll, pitch, yaw, throttle, armed: true });
const CALM: ParityFlight['wind'] = [0, 0, 0, 0, 0.8];

export function parityFlights(w: TrainWorld, world = 0): ParityFlight[] {
  const pad = padPlacement(w.track, createPlacement());
  const gate = w.track.gates.length ? gatePlacement(w.track.gates[0], w.ground.groundHeightAt, createPlacement()) : pad;
  const high: Vec3 = [gate.pos[0], gate.pos[1] + 20, gate.pos[2]];
  const box = w.colliders.find((c) => c.half[1] > 1.5) ?? w.colliders[0];
  const nearBox: Vec3 = box ? [box.center[0] + 3, Math.max(box.center[1], w.ground.heightAt(box.center[0] + 3, box.center[2]) + 1.5), box.center[2]] : high;
  return [
    {
      name: 'pad take-off and hover', world, pos: [...pad.pos], yaw: pad.yaw, wind: CALM, altitude: 0, tempC: 15, seed: 1,
      sticks: (t) => (t < 0.1 ? S(0, 0, 0, 0) : t < 0.9 ? S(0, 0, 0, 0.5) : S(0.05, -0.05, 0.1, 0.33)),
    },
    {
      name: 'windy gate run', world, pos: [...gate.pos], yaw: gate.yaw, wind: [6, 1.1, 1, 1.5, 0.8], altitude: 800, tempC: 25, seed: 7,
      sticks: (t) => (t < 0.01 ? S(0, 0, 0, 0) : S(0.1 * Math.sin(3 * t), 0.25, 0.05, 0.55)),
    },
    {
      name: 'flips', world, pos: high, yaw: 0.3, wind: CALM, altitude: 300, tempC: 10, seed: 3,
      sticks: (t) => (t < 0.01 ? S(0, 0, 0, 0) : t < 0.3 ? S(0, 0, 0, 0.6) : t < 0.6 ? S(1, 0, 0, 0.4) : t < 0.9 ? S(0, -1, 0.5, 0.7) : S(0, 0, 0, 0.35)),
    },
    {
      name: 'drop into the ground', world, pos: [gate.pos[0], gate.pos[1] + 4, gate.pos[2]], yaw: 1, wind: [3, 2.5, 1, 1.5, 0.8], altitude: 0, tempC: 15, seed: 11,
      sticks: (t) => (t < 0.05 ? S(0, 0, 0, 0) : t < 0.25 ? S(0.4, 0.3, 0, 0.2) : S(0, 0, 0, 0.05)),
    },
    {
      name: 'fly into an obstacle', world, pos: nearBox, yaw: Math.PI / 2, wind: CALM, altitude: 0, tempC: 15, seed: 5,
      sticks: (t) => (t < 0.01 ? S(0, 0, 0, 0) : S(0, 0.5, 0, 0.5)),
    },
  ];
}

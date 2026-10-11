/**
 * A park route as an AI pilot flies it. The brains steer by the next gates and take off from a pad a short climb behind the first
 * one, so a route gets:
 *  - gates: its own (the park tour's hoops), or hoops every PILOT_GATE_SPACING metres along its guide line when it has none
 *    (following a coaster);
 *  - a start: a pad on the lawn behind the lowest gate that has room for one, which becomes gate 0.
 * Only the session flies this track, while a brain does: the pilot gates are never drawn and never collided with, and the
 * player's own flight keeps the route as it is. The race course already starts like this and is returned unchanged.
 */
import type { TrackData, TrackGate, Vec3 } from '../../contracts';
import { RaceClearance, padBehind } from './raceCourse';
import { PARK_GRADE } from './surfaces';
import type { ParkData } from './types';

/** Metres of guide line between pilot gates: close enough that the line between two gates stays near the curving guide. */
export const PILOT_GATE_SPACING = 30;
/** Opening of a pilot gate, metres (the park tour's hoops). */
const PILOT_GATE_SIZE = 7;
/** Points along the line the gate faces, metres (the line is sampled every metre). */
const FACING = 3;

/** `track` as an AI pilot flies it, or null when it has no line to fly (free exploration). */
export function parkPilotTrack(park: ParkData, track: TrackData): TrackData | null {
  if (track.parkCourse === 'race') return track;
  if (track.path.length < 2) return null;
  const line = resample(track.path, track.closed), n = line.length;
  const at = (i: number): Vec3 => line[((i % n) + n) % n];
  const nearest = (p: Vec3): number => {
    let best = 0, bd = Infinity;
    line.forEach((q, i) => { const d = Math.hypot(q[0] - p[0], q[1] - p[1], q[2] - p[2]); if (d < bd) { bd = d; best = i; } });
    return best;
  };
  // Gates and the line point each one sits on.
  const placed: { gate: TrackGate; i: number }[] = track.gates.length
    ? track.gates.map(gate => ({ gate, i: nearest(gate.pos) }))
    : Array.from({ length: Math.floor((track.closed ? n : n - FACING) / PILOT_GATE_SPACING) }, (_, k) => {
      const i = k * PILOT_GATE_SPACING, p = line[i], q = at(i + FACING);
      const gate: TrackGate = {
        index: k, kind: 'hoop', pos: [p[0], p[1], p[2]], roll: 0, width: PILOT_GATE_SIZE, height: PILOT_GATE_SIZE,
        yaw: Math.atan2(-(q[0] - p[0]), -(q[2] - p[2])), pitch: Math.atan2(q[1] - p[1], Math.hypot(q[0] - p[0], q[2] - p[2])),
      };
      return { gate, i };
    });
  if (!placed.length) return null;
  // Gate 0 is the lowest gate with a pad behind it.
  // A coaster's guide flies beside its own trains, which the pilot gates leave to the exact collision.
  const followed = /^coaster-(\d+)$/.exec(track.parkCourse ?? '');
  const clearance = new RaceClearance(park, followed ? Number(followed[1]) : undefined);
  const order = track.closed ? [...placed.keys()].sort((a, b) => placed[a].gate.pos[1] - placed[b].gate.pos[1]) : [0];
  let first = 0, start: TrackData['start'] | null = null;
  for (const k of order) if ((start = padBehind(park, placed[k].gate, clearance, track.gates))) { first = k; break; }
  const gates = [...placed.slice(first), ...placed.slice(0, first)].map(({ gate }, index) => ({ ...gate, index }));
  const from = placed[first].i, path = track.closed ? [...line.slice(from), ...line.slice(0, from)] : line;
  let length = 0;
  for (let i = 1; i < path.length; i++) length += Math.hypot(path[i][0] - path[i - 1][0], path[i][1] - path[i - 1][1], path[i][2] - path[i - 1][2]);
  if (track.closed) length += Math.hypot(path[0][0] - path[path.length - 1][0], path[0][1] - path[path.length - 1][1], path[0][2] - path[path.length - 1][2]);
  return { ...track, gates, path, length, start: start ?? track.start };
}

/** The line through `points` sampled every metre; a closed line drops a repeated end point and does not repeat its first. */
function resample(points: readonly Vec3[], closed: boolean): Vec3[] {
  const last = points[points.length - 1], first = points[0];
  const pts = closed && Math.hypot(last[0] - first[0], last[1] - first[1], last[2] - first[2]) < 1e-6 ? points.slice(0, -1) : [...points];
  if (closed) pts.push(pts[0]);
  const out: Vec3[] = [];
  let carry = 0;
  for (let k = 0; k + 1 < pts.length; k++) {
    const a = pts[k], b = pts[k + 1], d = Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]);
    for (let s = carry; s < d; s += 1) { const f = s / d; out.push([a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f, a[2] + (b[2] - a[2]) * f]); }
    carry = d > 0 ? (Math.ceil((d - carry) / 1) * 1 + carry) - d : carry;
  }
  if (!closed) out.push([...last]);
  return out;
}

/**
 * Race gate meshes baked in world space: tube frames with chevron tape and LED strips, legs, ballast plates, flag poles, and the
 * solid parts of the window, tunnel, hurdle, drop and ladder kinds (dimensions from world/track/kindGeometry.ts).
 */
import type { TerrainSampler, TrackGate, Vec3 } from '../../contracts';
import { GATE_TUBE, archSpring, type GateFrame } from '../../world/track/gate';
import {
  LADDER_RAIL, WALL_SINK, WINDOW_THICKNESS, archFeet, buildFrame, dropArm, frameFeet, tunnelSleeve, wallGroundPoints, windowWall, type LadderGroup,
} from '../../world/track/kindGeometry';
import { plate } from './extrude';
import { bevelBox, lathe } from './primitives';
import { MeshBuilder, affineFromBasis, affineMul, affineRotY, affineTranslate } from './meshBuilder';
import { KIND, gateColour, panelCode, type ClothFlag } from './materials';
import { rectSection, sweep, type Section, type SectionFace } from './sweep';
import type { Pt } from './polygon';

const T = GATE_TUBE;
const HT = T / 2;
const LED_HALF = 0.01;
const LED_RISE = 0.0025;
const CH = 0.004;
const RING_STATIONS = 64;
const FLAG_POLE_R = 0.02;
const FLAG_W = 0.7;
const FLAG_H = 0.45;
/** Ballast plate under a leg: half side and thickness. */
const PLATE_HALF = 0.2;
const PLATE_THICK = 0.012;

/** Bar section face ids: how a face is shaded. */
const F_BODY = 0;
const F_TAPE = 1;
const F_LED = 2;
const FACE_KIND = [KIND.GATE_FRAME, KIND.GATE_CHEVRON, KIND.GATE_LED];

const face = (id: number, pts: Pt[], n: Pt, extra: Partial<SectionFace> = {}): SectionFace => ({ id, pts, normals: pts.map(() => n), ...extra });

/** Square tube with the inner side at +y: chevron tape either side of a raised LED strip, chamfered edges. */
function squareBarSection(): Section {
  const r = Math.SQRT1_2;
  const h = HT;
  return [
    face(F_BODY, [[h, -h + CH], [h, h - CH]], [1, 0]),
    face(F_BODY, [[h, h - CH], [h - CH, h]], [r, r]),
    face(F_TAPE, [[h - CH, h], [LED_HALF, h]], [0, 1], { v0: h - CH, vDir: -1 }),
    face(F_LED, [[LED_HALF, h], [LED_HALF, h + LED_RISE]], [1, 0]),
    face(F_LED, [[LED_HALF, h + LED_RISE], [-LED_HALF, h + LED_RISE]], [0, 1]),
    face(F_LED, [[-LED_HALF, h + LED_RISE], [-LED_HALF, h]], [-1, 0]),
    face(F_TAPE, [[-LED_HALF, h], [-h + CH, h]], [0, 1], { v0: LED_HALF, vDir: 1 }),
    face(F_BODY, [[-h + CH, h], [-h, h - CH]], [-r, r]),
    face(F_BODY, [[-h, h - CH], [-h, -h + CH]], [-1, 0]),
    face(F_BODY, [[-h, -h + CH], [-h + CH, -h]], [-r, -r]),
    face(F_BODY, [[-h + CH, -h], [h - CH, -h]], [0, -1]),
    face(F_BODY, [[h - CH, -h], [h, -h + CH]], [r, -r]),
  ];
}

/** Round tube (12 sides) with the inner 60 degrees as LED and 60 degrees of tape either side; inner side at +y. */
function roundBarSection(): Section {
  const n = 12;
  const step = (Math.PI * 2) / n;
  const out: Section = [];
  for (let k = 0; k < n; k++) {
    const r0 = (k - n / 2) * step;
    const r1 = r0 + step;
    const dist = Math.abs(r0 + step / 2);
    const id = dist < Math.PI / 6 ? F_LED : dist < Math.PI / 2 ? F_TAPE : F_BODY;
    const a0 = Math.PI / 2 + r0;
    const a1 = Math.PI / 2 + r1;
    const pts: Pt[] = [[HT * Math.cos(a0), HT * Math.sin(a0)], [HT * Math.cos(a1), HT * Math.sin(a1)]];
    const normals: Pt[] = [[Math.cos(a0), Math.sin(a0)], [Math.cos(a1), Math.sin(a1)]];
    // Tape uv.y is the distance from the LED edge, so the chevrons mirror about the strip.
    const tape = id === F_TAPE ? (r0 >= 0 ? { v0: HT * (r0 - Math.PI / 6), vDir: 1 } : { v0: HT * (-Math.PI / 6 - r0), vDir: -1 }) : {};
    out.push({ id, pts, normals, ...tape });
  }
  return out;
}

const sub = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const cross = (a: Vec3, b: Vec3): Vec3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];

/** Centre line of one LED strip, lifted onto the strip so a camera-facing glow ribbon sits on the emissive faces. */
export interface GlowStrip {
  gate: number;
  pts: Vec3[];
}

export interface GateBuild {
  flags: ClothFlag[];
  strips: GlowStrip[];
}

const normalise = (a: Vec3): Vec3 => {
  const l = Math.hypot(a[0], a[1], a[2]) || 1;
  return [a[0] / l, a[1] / l, a[2] / l];
};

/** Gate-local point (u along right, v along up, w along forward) to world. */
const frameAt = (c: Vec3, f: GateFrame, u: number, v: number, w = 0): Vec3 => [
  c[0] + f.right[0] * u + f.up[0] * v + f.forward[0] * w,
  c[1] + f.right[1] * u + f.up[1] * v + f.forward[1] * w,
  c[2] + f.right[2] * u + f.up[2] * v + f.forward[2] * w,
];

/** Lowest ground under a window wall or tunnel sleeve as gate-local v, sunk by WALL_SINK (mirrors colliders.ts). */
function wallBottom(gate: TrackGate, f: GateFrame, sampler: TerrainSampler): number {
  let lo = Infinity;
  for (const [u, w] of wallGroundPoints(gate)) {
    const p = frameAt(gate.pos, f, u, 0, w);
    lo = Math.min(lo, sampler.heightAt(p[0], p[2]));
  }
  return lo - gate.pos[1] - WALL_SINK;
}

/** Ballast plate on the ground under (x, z), turned to the gate's yaw. */
function plateAt(b: MeshBuilder, sampler: TerrainSampler, yaw: number, x: number, z: number, half = PLATE_HALF): void {
  const g = sampler.heightAt(x, z);
  b.kind = KIND.GATE_BASE;
  b.push(affineMul(affineTranslate(x, g, z), affineRotY(yaw)));
  bevelBox(b, [0, PLATE_THICK, 0], [half, PLATE_THICK, half], 0.006);
  b.pop();
}

/**
 * Vertical leg from `foot` down into the terrain with a ballast plate (yaw-only, flat on the ground). `side` is the direction the
 * section's x follows (the original legs keep -Z; rails pass the gate's right so they line up with the frame).
 */
function legTo(b: MeshBuilder, sampler: TerrainSampler, yaw: number, foot: Vec3, section: Section, plateHalf = PLATE_HALF, side: Vec3 = [0, 0, -1]): void {
  const g = sampler.heightAt(foot[0], foot[2]);
  b.aoFn = (_x, y) => 0.5 + 0.5 * Math.min(1, Math.max(0, (y - g) / 0.6));
  b.kind = KIND.GATE_FRAME;
  if (foot[1] - g > 0.03) sweep(b, [[foot[0], g - 0.05, foot[2]], foot], section, { up: side, capStart: true, capEnd: true, onFace: (bb) => (bb.kind = KIND.GATE_FRAME) });
  plateAt(b, sampler, yaw, foot[0], foot[2], plateHalf);
  b.aoFn = null;
}

export function buildGate(b: MeshBuilder, gate: TrackGate, sampler: TerrainSampler): GateBuild {
  const f = buildFrame(gate);
  const c = gate.pos;
  const hw = gate.width / 2;
  const hh = gate.height / 2;
  const at = (u: number, v: number, w = 0): Vec3 => frameAt(c, f, u, v, w);
  const flags: ClothFlag[] = [];
  const strips: GlowStrip[] = [];
  b.a3 = gate.index;
  const checker = gate.kind === 'finish';

  /** Sweeps one bar; its LED side faces `centre` (the opening centre unless the bar frames another opening, e.g. a tunnel exit). */
  const run = (path: Vec3[], section: Section, topBar = false, lift = 0, centre: Vec3 = c): void => {
    const i = path.length >> 1;
    const t = sub(path[Math.min(path.length - 1, i + 1)], path[Math.max(0, i - 1)]);
    const mid = path[i];
    // Section x must satisfy x cross y = tangent with y (the LED side) pointing at the opening centre.
    const up = cross(sub(centre, mid), t);
    sweep(b, path, section, {
      up,
      capStart: path.length === 2,
      capEnd: path.length === 2,
      onFace: (bb, id) => {
        bb.kind = checker && topBar && id === F_BODY ? KIND.GATE_CHECKER : FACE_KIND[id];
      },
    });
    // Section y = cross(tangent, up), so the strip ridge lies along that direction from the centre line.
    const n = normalise(up);
    const closed = path.length > 2 && path[0] === path[path.length - 1];
    const pts = path.map((p, k): Vec3 => {
      const tk = sub(path[closed ? (k + 1) % (path.length - 1) : Math.min(k + 1, path.length - 1)], path[closed ? (k + path.length - 2) % (path.length - 1) : Math.max(k - 1, 0)]);
      const inward = normalise(cross(tk, n));
      return [p[0] + inward[0] * (HT + lift), p[1] + inward[1] * (HT + lift), p[2] + inward[2] * (HT + lift)];
    });
    strips.push({ gate: gate.index, pts });
  };

  const bars = squareBarSection();
  const legs = rectSection(T, T, CH);
  /** The four LED tubes round a rectangular opening, `w` metres along the travel axis. */
  const rectFrame = (w = 0): void => {
    const centre = at(0, 0, w);
    const top = hh + T;
    for (const s of [-1, 1]) run([at(s * (hw + HT), -top, w), at(s * (hw + HT), top, w)], bars, false, LED_RISE, centre);
    run([at(-hw, hh + HT, w), at(hw, hh + HT, w)], bars, true, LED_RISE, centre);
    run([at(-hw, -hh - HT, w), at(hw, -hh - HT, w)], bars, false, LED_RISE, centre);
  };
  /** Box in the gate frame spanning u0..u1, v0..v1, w0..w1 (upright kinds only, so it is level). */
  const slab = (u0: number, u1: number, v0: number, v1: number, w0: number, w1: number, e = 0.01): void => {
    b.push(affineFromBasis(f.right, f.up, [-f.forward[0], -f.forward[1], -f.forward[2]], c));
    bevelBox(b, [(u0 + u1) / 2, (v0 + v1) / 2, -(w0 + w1) / 2], [(u1 - u0) / 2, (v1 - v0) / 2, (w1 - w0) / 2], e);
    b.pop();
  };

  switch (gate.kind) {
    case 'arch': {
      const vs = archSpring(gate);
      const r = hw + HT;
      const feet = archFeet(gate, f, vs);
      for (let k = 0; k < 2; k++) {
        const s = k === 0 ? -1 : 1;
        run([at(s * r, -hh), at(s * r, vs)], bars, false, LED_RISE);
        legTo(b, sampler, gate.yaw, at(feet[k][0], feet[k][1]), legs);
      }
      const arc: Vec3[] = [];
      for (let k = 0; k <= RING_STATIONS / 2; k++) {
        const a = (k / (RING_STATIONS / 2)) * Math.PI;
        arc.push(at(r * Math.cos(a), vs + r * Math.sin(a)));
      }
      run(arc, bars, false, LED_RISE);
      break;
    }
    case 'hoop':
    case 'dive':
    case 'drop': {
      const ring: Vec3[] = [];
      for (let k = 0; k <= RING_STATIONS; k++) {
        const a = (k / RING_STATIONS) * Math.PI * 2;
        ring.push(at((hw + HT) * Math.cos(a), (hh + HT) * Math.sin(a)));
      }
      ring[RING_STATIONS] = ring[0];
      run(ring, roundBarSection());
      if (gate.kind === 'drop') {
        const arm = dropArm(gate);
        const end = at(arm.end[0], arm.end[1]);
        b.kind = KIND.GATE_FRAME;
        sweep(b, [at(arm.rim[0] - HT, arm.rim[1]), end], legs, { up: [0, 1, 0], capStart: true, capEnd: true, onFace: (bb) => (bb.kind = KIND.GATE_FRAME) });
        legTo(b, sampler, gate.yaw, end, legs, 0.3);
      } else legTo(b, sampler, gate.yaw, ring.reduce((lo, p) => (p[1] < lo[1] ? p : lo)), legs);
      break;
    }
    case 'flag': {
      const top = c[1] + hh + 0.3;
      for (const s of [-1, 1]) {
        const p = at(s * (hw + FLAG_POLE_R), 0);
        pole(b, p[0], sampler.heightAt(p[0], p[2]), top, p[2], FLAG_POLE_R, KIND.FLAGPOLE);
        flags.push({ pos: [p[0], top - 0.03, p[2]], width: FLAG_W, height: FLAG_H, colour: gateColour(gate.index), seed: gate.index * 2 + (s > 0 ? 1 : 0) });
      }
      break;
    }
    case 'window': {
      rectFrame();
      const wall = windowWall(gate);
      // The wall always keeps a sill under the hole, even when a bad placement buries the opening.
      const vg = Math.min(wallBottom(gate, f, sampler), -hh - T - 0.05);
      const d = WINDOW_THICKNESS / 2;
      // Plate local x = right, y = forward (the extrusion), z = up, so the outline is drawn in (u, v).
      b.push(affineFromBasis(f.right, f.forward, f.up, c));
      b.kind = KIND.GATE_PANEL;
      b.a2 = panelCode(hw + T, hh + T);
      b.aoFn = (_x, y) => 0.6 + 0.4 * Math.min(1, Math.max(0, (y - (c[1] + vg + WALL_SINK)) / 0.8));
      const outline: Pt[] = [[-wall.half, vg], [wall.half, vg], [wall.half, wall.top], [-wall.half, wall.top]];
      const hole: Pt[] = [[-hw - T, -hh - T], [-hw - T, hh + T], [hw + T, hh + T], [hw + T, -hh - T]];
      plate(b, outline, [hole], -d, d, { wallKind: KIND.GATE_BASE, hardAngle: 0.3 });
      b.aoFn = null;
      b.a2 = 0;
      b.pop();
      break;
    }
    case 'tunnel': {
      const s = tunnelSleeve(gate);
      rectFrame(0);
      rectFrame(s.depth);
      const vg = wallBottom(gate, f, sampler);
      b.kind = KIND.GATE_PANEL;
      b.aoFn = (_x, y) => 0.55 + 0.45 * Math.min(1, Math.max(0, (y - (c[1] + vg + WALL_SINK)) / 0.8));
      for (const side of [-1, 1]) slab(side < 0 ? -s.outer : s.inner, side < 0 ? -s.inner : s.outer, vg, s.roofTop, HT, s.depth - HT);
      slab(-s.outer, s.outer, s.roof, s.roofTop, HT, s.depth - HT);
      b.kind = KIND.GATE_BASE;
      if (-hh - T - vg > 0.02) for (const w of [0, s.depth]) slab(-hw, hw, vg, -hh - T, w - HT * 0.8, w + HT * 0.8, 0.004);
      b.aoFn = null;
      // An LED tube along the middle of the ceiling, lit with the gate.
      run([at(0, hh + HT, 0.3), at(0, hh + HT, s.depth - 0.3)], bars, false, LED_RISE, at(0, 0, s.depth / 2));
      break;
    }
    case 'ladder':
      rectFrame();
      break;
    case 'hurdle': {
      const top = hh + T;
      for (const s of [-1, 1]) {
        const p = at(s * (hw + HT), top);
        const g = sampler.heightAt(p[0], p[2]) - 0.05 - c[1];
        run([at(s * (hw + HT), g), p], bars, false, LED_RISE);
        b.aoFn = (_x, y) => 0.5 + 0.5 * Math.min(1, Math.max(0, (y - c[1] - g) / 0.6));
        plateAt(b, sampler, gate.yaw, p[0], p[2]);
        b.aoFn = null;
      }
      run([at(-hw, hh + HT), at(hw, hh + HT)], bars, true, LED_RISE);
      // The sill bar: the opening the timer counts starts here, not at the ground.
      run([at(-hw, -hh - HT), at(hw, -hh - HT)], bars, true, LED_RISE);
      break;
    }
    default: {
      rectFrame();
      for (const [u, v] of frameFeet(gate, f)) legTo(b, sampler, gate.yaw, at(u, v), legs);
    }
  }
  b.a3 = 0;
  return { flags, strips };
}

/**
 * The two side rails of one ladder, built once per ladder in the top rung's frame: square tubes from the ground to just above the
 * top rung, touching the outside of every rung's posts, with ballast plates. They take the top rung's colour.
 */
export function buildLadderRails(b: MeshBuilder, gates: readonly TrackGate[], group: LadderGroup, sampler: TerrainSampler): void {
  const top = gates[group.top];
  const f = buildFrame(top);
  b.a3 = top.index;
  const section = rectSection(LADDER_RAIL, LADDER_RAIL, 0.008);
  for (const s of [-1, 1]) {
    const p = frameAt(top.pos, f, s * group.railU, 0);
    legTo(b, sampler, top.yaw, [p[0], group.railTop, p[2]], section, 0.25, f.right);
  }
  b.a3 = 0;
}

/** Slim round pole from `y0` (ground) to `y1` with a small cap. */
export function pole(b: MeshBuilder, x: number, y0: number, y1: number, z: number, r: number, kind: number): void {
  b.kind = kind;
  b.push(affineTranslate(x, 0, z));
  lathe(b, [[0, y0 - 0.05], [r, y0 - 0.05], [r, y1 - r * 0.5], [r * 0.75, y1], [0, y1 + r * 0.4]], 10, { polar: true });
  b.pop();
}

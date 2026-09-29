/** Race gate meshes baked in world space: tube frames with chevron tape and LED strips, legs, ballast plates, flag poles. */
import type { TerrainSampler, TrackGate, Vec3 } from '../../contracts';
import { GATE_TUBE, archSpring, trackGateFrame } from '../../world/track/gate';
import { bevelBox, lathe } from './primitives';
import { MeshBuilder, affineMul, affineRotY, affineTranslate } from './meshBuilder';
import { KIND, gateColour, type ClothFlag } from './materials';
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

export function buildGate(b: MeshBuilder, gate: TrackGate, sampler: TerrainSampler): GateBuild {
  const f = trackGateFrame(gate);
  const c = gate.pos;
  const hw = gate.width / 2;
  const hh = gate.height / 2;
  const at = (u: number, v: number): Vec3 => [c[0] + f.right[0] * u + f.up[0] * v, c[1] + f.right[1] * u + f.up[1] * v, c[2] + f.right[2] * u + f.up[2] * v];
  const flags: ClothFlag[] = [];
  const strips: GlowStrip[] = [];
  b.a3 = gate.index;
  const checker = gate.kind === 'finish';

  const run = (path: Vec3[], section: Section, topBar = false, lift = 0): void => {
    const i = path.length >> 1;
    const t = sub(path[Math.min(path.length - 1, i + 1)], path[Math.max(0, i - 1)]);
    const mid = path[i];
    // Section x must satisfy x cross y = tangent with y (the LED side) pointing at the opening centre.
    const up = cross(sub(c, mid), t);
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

  const legTo = (foot: Vec3, section: Section): void => {
    const g = sampler.heightAt(foot[0], foot[2]);
    const base = affineMul(affineTranslate(foot[0], g, foot[2]), affineRotY(gate.yaw));
    b.aoFn = (_x, y) => 0.5 + 0.5 * Math.min(1, Math.max(0, (y - g) / 0.6));
    b.kind = KIND.GATE_FRAME;
    if (foot[1] - g > 0.03) sweep(b, [[foot[0], g - 0.05, foot[2]], foot], section, { up: [0, 0, -1], capStart: true, capEnd: true, onFace: (bb) => (bb.kind = KIND.GATE_FRAME) });
    b.kind = KIND.GATE_BASE;
    b.push(base);
    bevelBox(b, [0, 0.012, 0], [0.2, 0.012, 0.2], 0.006);
    b.pop();
    b.aoFn = null;
  };

  const bars = squareBarSection();
  const legs = rectSection(T, T, CH);
  switch (gate.kind) {
    case 'arch': {
      const vs = archSpring(gate);
      const r = hw + HT;
      for (const s of [-1, 1]) {
        run([at(s * r, -hh), at(s * r, vs)], bars, false, LED_RISE);
        legTo(at(s * r, -hh), legs);
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
    case 'dive': {
      const ring: Vec3[] = [];
      for (let k = 0; k <= RING_STATIONS; k++) {
        const a = (k / RING_STATIONS) * Math.PI * 2;
        ring.push(at((hw + HT) * Math.cos(a), (hh + HT) * Math.sin(a)));
      }
      ring[RING_STATIONS] = ring[0];
      run(ring, roundBarSection());
      legTo(ring.reduce((lo, p) => (p[1] < lo[1] ? p : lo)), legs);
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
    default: {
      const top = hh + T;
      for (const s of [-1, 1]) run([at(s * (hw + HT), -top), at(s * (hw + HT), top)], bars, false, LED_RISE);
      run([at(-hw, hh + HT), at(hw, hh + HT)], bars, true, LED_RISE);
      run([at(-hw, -hh - HT), at(hw, -hh - HT)], bars, false, LED_RISE);
      for (const s of [-1, 1]) legTo(at(s * (hw + HT), -top), legs);
    }
  }
  b.a3 = 0;
  return { flags, strips };
}

/** Slim round pole from `y0` (ground) to `y1` with a small cap. */
export function pole(b: MeshBuilder, x: number, y0: number, y1: number, z: number, r: number, kind: number): void {
  b.kind = kind;
  b.push(affineTranslate(x, 0, z));
  lathe(b, [[0, y0 - 0.05], [r, y0 - 0.05], [r, y1 - r * 0.5], [r * 0.75, y1], [0, y1 + r * 0.4]], 10, { polar: true });
  b.pop();
}

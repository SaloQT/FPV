/** Four 2207 motors (static base, copper windings, ringed anodised bell) and their three phase wires each. */
import type { Vec3 } from '../../contracts';
import { KIND } from './materials';
import { affineTranslate, type MeshBuilder } from './meshBuilder';
import { lathe } from './primitives';
import { catmullRom } from './quadCurves';
import { MOTOR_SLOT, inFrame, smooth01 } from './quadLayout';
import { circleSection, sweep } from './sweep';

const BASE_PROFILE: [number, number][] = [[0, -0.0015], [0.013, -0.0015], [0.0135, -0.001], [0.0135, 0.002], [0.0128, 0.0025], [0.0101, 0.0025]];
const WINDING_PROFILE: [number, number][] = [[0, 0.0025], [0.01, 0.0025], [0.01, 0.0056], [0, 0.0056]];
const BELL_PROFILE: [number, number][] = [
  [0, 0.0055], [0.0136, 0.0055], [0.0142, 0.0062], [0.0142, 0.0148], [0.0135, 0.0165], [0.0118, 0.0175],
  [0.0072, 0.0175], [0.0062, 0.0182], [0.006, 0.019], [0.0045, 0.0195], [0, 0.0195],
];
const WIRE_RADIUS = 0.0007;

/** The bell is dark where it nears the arm and the windings are dark inside it. */
const bellAo = inFrame((_x, y) => 0.6 + 0.4 * smooth01(0.0055, 0.011, y));

function addMotor(b: MeshBuilder, index: number): void {
  const s = MOTOR_SLOT[index];
  b.push(affineTranslate(s[0], 0, s[2]));
  b.kind = KIND.MOTOR_BASE;
  b.a2 = index;
  b.ao = 0.85;
  lathe(b, BASE_PROFILE, 28, { hardAngle: 0.9 });
  b.kind = KIND.WIRE;
  b.a2 = 3;
  b.ao = 0.55;
  lathe(b, WINDING_PROFILE, 28, { hardAngle: 0.9 });
  b.kind = KIND.MOTOR_BELL;
  b.a2 = index;
  b.ao = 1;
  b.aoFn = bellAo;
  lathe(b, BELL_PROFILE, 32, { hardAngle: 0.75 });
  b.aoFn = null;
  b.a2 = 0;
  b.pop();
}

/** One motor's three wires, from under the bell along the arm and up to the ESC corner. */
function addWires(b: MeshBuilder, index: number): void {
  const s = MOTOR_SLOT[index];
  const dx = -Math.sign(s[0]) * Math.SQRT1_2;
  const dz = -Math.sign(s[2]) * Math.SQRT1_2;
  const at = (t: number, y: number, lateral: number): Vec3 => [s[0] + dx * t - dz * lateral, y, s[2] + dz * t + dx * lateral];
  b.kind = KIND.WIRE;
  b.a2 = 0;
  b.ao = 0.75;
  for (let j = 0; j < 3; j++) {
    const o = (j - 1) * 0.0016;
    const path = catmullRom([at(0.012, 0.003, o), at(0.016, 0.0002, o), at(0.024, -0.0007, o), at(0.06, -0.0007, o), at(0.078, -0.0004, o), at(0.088, 0.003, o), at(0.0909, 0.0065, o)], 5);
    sweep(b, path, circleSection(WIRE_RADIUS, 6), { up: [0, 1, 0] });
  }
}

export function addMotors(b: MeshBuilder): void {
  for (let i = 0; i < 4; i++) {
    addMotor(b, i);
    addWires(b, i);
  }
  b.ao = 1;
}

/** Electronics between the plates: ESC and FC boards, stack standoffs, capacitor, VTX with its SMA connector and the antenna tail. */
import type { Vec3 } from '../../contracts';
import { plate } from './extrude';
import { KIND } from './materials';
import { affineMul, affineRotX, affineTranslate, type MeshBuilder } from './meshBuilder';
import { circleOutline, roundedRect } from './outlines';
import type { Pt } from './polygon';
import { bevelBox, lathe } from './primitives';
import { catmullRom } from './quadCurves';
import { BOTTOM_PLATE, TOP_PLATE, inFrame, smooth01 } from './quadLayout';
import { circleSection, sweep } from './sweep';

const ESC_Y = { y0: 0.008, y1: 0.0096 } as const;
const FC_Y = { y0: 0.019, y1: 0.0206 } as const;
const VTX_Y = { y0: 0.0127, y1: 0.0143 } as const;
const HOLE = 0.01525;
const VTX_Z = 0.046;
const SMA = { y: 0.0135, z0: 0.0555 } as const;
/** SMA connector tip, where the antenna starts. */
export const ANTENNA_ROOT: Vec3 = [0, SMA.y, SMA.z0 + 0.0085];

/** Boards darken toward the plates that shade them. */
const stackAo = inFrame((_x, y) => 0.75 + 0.25 * smooth01(0.006, 0.013, y) * (1 - smooth01(0.02, 0.029, y)));

function board(b: MeshBuilder, outline: Pt[], y: { y0: number; y1: number }, variant: number, holes: boolean): void {
  b.kind = KIND.PCB;
  b.a2 = variant;
  const cut = holes ? [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([sx, sz]) => circleOutline(sx * HOLE, sz * HOLE, 0.0017, 10)) : [];
  plate(b, outline, cut, y.y0, y.y1, { hardAngle: 0.7 });
  b.a2 = 0;
}

function part(b: MeshBuilder, kind: number, a2: number, c: Vec3, half: Vec3): void {
  b.kind = kind;
  b.a2 = a2;
  bevelBox(b, c, half);
  b.a2 = 0;
}

function addBoards(b: MeshBuilder): void {
  b.aoFn = stackAo;
  board(b, roundedRect(0, 0.004, 0.018, 0.022, 0.003, 3), ESC_Y, 0, true);
  board(b, roundedRect(0, 0, 0.018, 0.018, 0.003, 3), FC_Y, 1, true);
  b.aoFn = null;
  b.kind = KIND.ALU;
  b.ao = 0.8;
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) {
      b.push(affineTranslate(sx * HOLE, 0, sz * HOLE));
      lathe(b, [[0, BOTTOM_PLATE.y1], [0.0027, BOTTOM_PLATE.y1], [0.0027, TOP_PLATE.y0], [0, TOP_PLATE.y0]], 8, { hardAngle: 0.7 });
      b.pop();
    }
  }
  b.ao = 1;
  for (let i = 0; i < 4; i++) {
    const x = -0.0075 + i * 0.005;
    part(b, KIND.PLASTIC, 2, [x, ESC_Y.y1 + 0.0008, 0.008], [0.002, 0.0008, 0.003]);
    part(b, KIND.PLASTIC, 2, [x, ESC_Y.y1 + 0.0008, -0.008], [0.002, 0.0008, 0.003]);
  }
  part(b, KIND.PLASTIC, 2, [0.002, FC_Y.y1 + 0.0004, 0.002], [0.0035, 0.0004, 0.0035]);
  part(b, KIND.STEEL, 0, [0, FC_Y.y1 + 0.0014, -0.0152], [0.0037, 0.0014, 0.0028]);
  part(b, KIND.PLASTIC, 3, [-0.0095, FC_Y.y1 + 0.0016, 0.0125], [0.0022, 0.0016, 0.0032]);
  part(b, KIND.PLASTIC, 3, [0.0095, FC_Y.y1 + 0.0016, 0.0125], [0.0022, 0.0016, 0.0032]);
  b.kind = KIND.ALU;
  b.a2 = 2;
  const y0 = ESC_Y.y1;
  const y1 = 0.0216;
  b.push(affineTranslate(0, 0, 0.0235));
  lathe(b, [[0, y0], [0.0044, y0], [0.0045, y0 + 0.0004], [0.0045, y1 - 0.0006], [0.0038, y1], [0, y1]], 14, { hardAngle: 0.7 });
  b.pop();
  b.a2 = 0;
}

function addVtx(b: MeshBuilder): void {
  board(b, roundedRect(0, VTX_Z, 0.0095, 0.0095, 0.002, 2), VTX_Y, 2, false);
  part(b, KIND.ALU, 2, [0, 0.0155, VTX_Z], [0.0078, 0.0012, 0.0078]);
  for (let i = 0; i < 4; i++) part(b, KIND.ALU, 2, [0, 0.0182, VTX_Z - 0.005 + i * 0.0033], [0.0078, 0.0015, 0.0005]);
  b.kind = KIND.STEEL;
  for (const sx of [-1, 1]) {
    b.push(affineTranslate(sx * 0.0075, 0, VTX_Z + 0.0085));
    lathe(b, [[0, BOTTOM_PLATE.y1], [0.0018, BOTTOM_PLATE.y1], [0.0018, VTX_Y.y0], [0, VTX_Y.y0]], 8, { hardAngle: 0.7 });
    b.pop();
  }
  b.a2 = 1;
  b.push(affineMul(affineTranslate(0, SMA.y, SMA.z0), affineRotX(Math.PI / 2)));
  lathe(b, [[0, 0], [0.0035, 0], [0.0035, 0.0018], [0.0022, 0.0018], [0.0022, 0.0085], [0, 0.0085]], 10, { hardAngle: 0.7 });
  b.pop();
  b.a2 = 0;
}

function addAntenna(b: MeshBuilder): void {
  b.kind = KIND.PLASTIC;
  b.a2 = 2;
  const [x, y, z] = ANTENNA_ROOT;
  const path = catmullRom([[x, y, z], [x, y - 0.0005, z + 0.008], [x, y - 0.004, z + 0.022], [x, y - 0.012, z + 0.036], [x, y - 0.022, z + 0.046]], 5);
  sweep(b, path, circleSection(0.0024, 8), { up: [0, 1, 0], capEnd: true, scale: (t) => (t < 0.08 ? 1.35 : 1) });
  b.a2 = 0;
}

export function addStack(b: MeshBuilder): void {
  addBoards(b);
  addVtx(b);
  addAntenna(b);
}

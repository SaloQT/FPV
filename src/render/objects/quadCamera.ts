/** FPV camera on its orange cage with the front LEDs, plus the rear LEDs on the top plate (frame coordinates). */
import type { Vec3 } from '../../contracts';
import { KIND } from './materials';
import { affineMul, affineRotX, affineTranslate, type MeshBuilder } from './meshBuilder';
import { bevelBox, lathe } from './primitives';
import { CAMERA, TOP_PLATE, applyAffine } from './quadLayout';

const CAMERA_XF = affineMul(affineTranslate(CAMERA.pos[0], CAMERA.pos[1], CAMERA.pos[2]), affineRotX(CAMERA.tilt));
const CAGE_X = 0.0117;
const LED_TOP = 0.0122;
const REAR_LED: readonly Vec3[] = [[-0.016, TOP_PLATE.y1 + 0.0007, 0.046], [0.016, TOP_PLATE.y1 + 0.0007, 0.046]];
const FRONT_LED_LOCAL: readonly Vec3[] = [[-CAGE_X, LED_TOP, -0.0075], [CAGE_X, LED_TOP, -0.0075]];

/** LED centres in frame coordinates, indexed like the LED colour table: rear left, rear right, front left, front right. */
export const LED_FRAME: readonly Vec3[] = [...REAR_LED, ...FRONT_LED_LOCAL.map((p) => applyAffine(CAMERA_XF, p))];
/** A point on the lens dome where the sun catches it. */
export const LENS_GLINT_FRAME: Vec3 = applyAffine(CAMERA_XF, [0.0018, 0.0022, -0.0182]);

function addCage(b: MeshBuilder): void {
  b.push(CAMERA_XF);
  b.kind = KIND.PLASTIC;
  b.a2 = 2;
  b.ao = 0.9;
  bevelBox(b, [0, 0, 0], [0.0095, 0.0095, 0.0085], 0.0008);
  b.ao = 1;
  b.kind = KIND.ALU;
  b.a2 = 1;
  for (const sx of [-1, 1]) bevelBox(b, [sx * CAGE_X, 0, 0], [0.002, 0.0115, 0.0105], 0.0005);
  b.a2 = 2;
  b.push(affineRotX(-Math.PI / 2));
  lathe(b, [[0, 0.0085], [0.0068, 0.0085], [0.0068, 0.0125], [0.0055, 0.0125], [0.0055, 0.0148], [0, 0.0148]], 20, { hardAngle: 0.6 });
  b.kind = KIND.LENS;
  lathe(b, [[0, 0.0148], [0.0044, 0.0148], [0.0042, 0.0158], [0.0032, 0.0172], [0.0016, 0.0181], [0, 0.0184]], 20, { hardAngle: 0.9 });
  b.pop();
  b.a2 = 0;
  b.pop();
}

function addBracket(b: MeshBuilder): void {
  b.kind = KIND.ALU;
  b.a2 = 1;
  for (const sx of [-1, 1]) bevelBox(b, [sx * CAGE_X, 0.0148, -0.0525], [0.002, 0.0155, 0.0015], 0.0004);
  b.a2 = 0;
}

function addLeds(b: MeshBuilder): void {
  b.kind = KIND.LED;
  LED_FRAME.forEach((p, i) => {
    b.a2 = i;
    if (i < 2) bevelBox(b, p, [0.0022, 0.0007, 0.0025]);
    else {
      b.push(CAMERA_XF);
      bevelBox(b, FRONT_LED_LOCAL[i - 2], [0.0014, 0.0007, 0.0014]);
      b.pop();
    }
  });
  b.a2 = 0;
}

export function addCamera(b: MeshBuilder): void {
  addCage(b);
  addBracket(b);
  addLeds(b);
}

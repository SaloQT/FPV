/** Assembles the quad meshes in body coordinates (origin at the centre of mass, +Z backward) from the part builders. */
import type { Vec3 } from '../../contracts';
import { MeshBuilder, affineTranslate, type MeshData } from './meshBuilder';
import { LED_FRAME, LENS_GLINT_FRAME, addCamera } from './quadCamera';
import { addFrame } from './quadFrame';
import { QUAD_COM, toBody } from './quadLayout';
import { addMotors } from './quadMotors';
import { addPower } from './quadPower';
import { addStack } from './quadStack';
import { buildPropMesh } from './propeller';

/** LED centres in body coordinates: rear left, rear right, front left, front right. */
export const LED_BODY: readonly Vec3[] = LED_FRAME.map(toBody);
/** Lens glint sprite anchor in body coordinates. */
export const LENS_GLINT_BODY: Vec3 = toBody(LENS_GLINT_FRAME);

/** Everything that does not spin: plates, standoffs, motors, pack, stack, camera, antenna and wires. */
export function buildQuadBody(): MeshData {
  const b = new MeshBuilder();
  b.push(affineTranslate(-QUAD_COM[0], -QUAD_COM[1], -QUAD_COM[2]));
  addFrame(b);
  addMotors(b);
  addPower(b);
  addStack(b);
  addCamera(b);
  b.pop();
  return b.finish();
}

/** One prop of each handedness around its hub: `ccw` turns counter-clockwise seen from above, `cw` is its mirror image. */
export function buildQuadProps(): { ccw: MeshData; cw: MeshData } {
  return { ccw: buildPropMesh(false), cw: buildPropMesh(true) };
}

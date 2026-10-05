/**
 * GPU side of the quad: rigid body mesh, spinning props that cross-fade to blur discs, LED and lens glow sprites, and the RT
 * proxy. The player's quad plus any rival quads of a spectator race share the meshes and pipelines; each has its own uniform.
 * Only the player's quad has an RT proxy (the dynamic RT budget holds about five quads).
 */
import type { QuadState, Vec3 } from '../../contracts';
import { DEPTH_STATE, FORWARD_DEPTH_STATE, FORMATS, GBUFFER_TARGETS, type FrameInfo, type RenderContext } from '../contracts';
import { kindDefines } from './materials';
import { VERTEX_STRIDE, type MeshData } from './meshBuilder';
import { PROP_RADIUS } from './propeller';
import {
  LED_COLOURS,
  LED_FRONT_STRENGTH,
  LED_REAR_STRENGTH,
  cameraInsideQuad,
  createPose,
  createRotors,
  ledLevel,
  stepPose,
  stepRotors,
} from './quadAnim';
import { CAMERA, MOTOR_BODY, PROP_BODY, QUAD_COM } from './quadLayout';
import { LED_BODY, LENS_GLINT_BODY, buildQuadBody, buildQuadProps } from './quadModel';
import { createQuadRt } from './quadRt';

const RT_GROUP = 'quad';
/** Float offsets of the QuadU uniform in quad_bindings.wgsl. */
const U = { model: 0, prevModel: 16, hub: 32, prop: 48, spin: 64, led: 80, sprite: 96, lens: 116, floats: 120 } as const;
export const QUAD_UNIFORM_FLOATS = U.floats;
const LED_RADIUS = 0.006;
const GLINT_RADIUS = 0.003;
/** Display value of the sun reflected in the camera lens dome at its brightest. */
const GLINT_STRENGTH = 0.9;
/** Below this the disc would add less than a quantisation step; skip the draw. */
const MIN_BLUR = 0.002;
/** Rival quads show their colour on the rear LEDs, brighter so it reads from a distance. */
const RIVAL_REAR_BOOST = 3;

/** Defines of the G-buffer shader (quad.wgsl) and of the forward shader (quad_forward.wgsl). */
export const quadBodyDefines = (): Record<string, number> => ({ ...kindDefines(), COM_Y: QUAD_COM[1], PROP_R: PROP_RADIUS });
export const quadForwardDefines = (): Record<string, number> => ({ PROP_R: PROP_RADIUS });

/** Another quad to draw: its state and the colour of its rear LEDs. */
export interface RivalQuad {
  state: QuadState;
  led: Vec3;
}

export interface QuadRender {
  /** `hide` is the caller's request to skip drawing (first person); the RT proxy keeps casting shadows either way. */
  update(rc: RenderContext, f: FrameInfo, hide: boolean): void;
  /** Poses the rival quads for this frame; an empty list draws none. */
  updateRivals(f: FrameInfo, rivals: readonly RivalQuad[]): void;
  encodeGBuffer(pass: GPURenderPassEncoder): void;
  encodeForward(pass: GPURenderPassEncoder): void;
  destroy(rc: RenderContext): void;
}

interface Instance {
  uniform: GPUBuffer;
  group: GPUBindGroup;
  data: Float32Array;
  rival: boolean;
  pose: ReturnType<typeof createPose>;
  rotors: ReturnType<typeof createRotors>;
  visible: boolean;
  showBlur: boolean;
}

interface GpuMesh {
  vertex: GPUBuffer;
  index: GPUBuffer;
  indexCount: number;
}

const ATTRIBUTES: GPUVertexAttribute[] = [
  { shaderLocation: 0, offset: 0, format: 'float32x3' },
  { shaderLocation: 1, offset: 12, format: 'float32x3' },
  { shaderLocation: 2, offset: 24, format: 'float32x2' },
  { shaderLocation: 3, offset: 32, format: 'float32x4' },
];

export function createQuadRender(rc: RenderContext): QuadRender {
  const d = rc.device;
  const STAGES = GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT;
  const layout = d.createBindGroupLayout({ label: 'quad group 2', entries: [{ binding: 0, visibility: STAGES, buffer: { type: 'uniform' } }] });
  const pipelineLayout = d.createPipelineLayout({ bindGroupLayouts: [rc.frame.layout, rc.world.layout, layout] });
  const bodyModule = rc.module('objects/quad.wgsl', quadBodyDefines());
  const forwardModule = rc.module('objects/quad_forward.wgsl', quadForwardDefines());

  const solidPipeline = (vs: string, fs: string, label: string): GPURenderPipeline =>
    d.createRenderPipeline({
      label,
      layout: pipelineLayout,
      vertex: { module: bodyModule, entryPoint: vs, buffers: [{ arrayStride: VERTEX_STRIDE, attributes: ATTRIBUTES }] },
      fragment: { module: bodyModule, entryPoint: fs, targets: GBUFFER_TARGETS },
      primitive: { topology: 'triangle-list', cullMode: 'back' },
      depthStencil: DEPTH_STATE,
    });
  const bodyPipeline = solidPipeline('vsBody', 'fsBody', 'quad body');
  const propPipeline = solidPipeline('vsProp', 'fsProp', 'quad props');
  const forwardPipeline = (vs: string, fs: string, label: string, colour: GPUBlendComponent): GPURenderPipeline =>
    d.createRenderPipeline({
      label,
      layout: pipelineLayout,
      vertex: { module: forwardModule, entryPoint: vs },
      fragment: {
        module: forwardModule,
        entryPoint: fs,
        targets: [{ format: FORMATS.hdr, blend: { color: colour, alpha: { srcFactor: 'zero', dstFactor: 'one', operation: 'add' } } }],
      },
      primitive: { topology: 'triangle-list', cullMode: 'none' },
      depthStencil: FORWARD_DEPTH_STATE,
    });
  const discPipeline = forwardPipeline('vsDisc', 'fsDisc', 'quad blur discs', { srcFactor: 'one', dstFactor: 'one-minus-src-alpha', operation: 'add' });
  const spritePipeline = forwardPipeline('vsSprite', 'fsSprite', 'quad glow sprites', { srcFactor: 'one', dstFactor: 'one', operation: 'add' });

  const upload = (mesh: MeshData, label: string): GpuMesh => {
    const vertex = d.createBuffer({ label, size: mesh.vertices.byteLength, usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST });
    const index = d.createBuffer({ label: `${label} indices`, size: mesh.indices.byteLength, usage: GPUBufferUsage.INDEX | GPUBufferUsage.COPY_DST });
    d.queue.writeBuffer(vertex, 0, mesh.vertices);
    d.queue.writeBuffer(index, 0, mesh.indices);
    return { vertex, index, indexCount: mesh.indices.length };
  };
  const props = buildQuadProps();
  const body = upload(buildQuadBody(), 'quad body');
  const cwProps = upload(props.cw, 'quad props cw');
  const ccwProps = upload(props.ccw, 'quad props ccw');

  /** One drawn quad: its own uniform, pose and prop phases over the shared meshes and pipelines. */
  const instance = (label: string, rival: boolean): Instance => {
    const uniform = d.createBuffer({ label: `${label} uniform`, size: U.floats * 4, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
    const group = d.createBindGroup({ label: `${label} group 2`, layout, entries: [{ binding: 0, resource: { buffer: uniform } }] });
    const data = new Float32Array(U.floats);
    for (let i = 0; i < 4; i++) {
      data.set(MOTOR_BODY[i], U.hub + i * 4);
      data.set(PROP_BODY[i], U.prop + i * 4);
      data.set(LED_BODY[i], U.sprite + i * 4);
      data[U.sprite + i * 4 + 3] = LED_RADIUS;
      data.set(LED_COLOURS[i], U.led + i * 4);
    }
    data.set(LENS_GLINT_BODY, U.sprite + 16);
    data[U.sprite + 19] = GLINT_RADIUS;
    data.set([0, Math.sin(CAMERA.tilt), -Math.cos(CAMERA.tilt), GLINT_STRENGTH], U.lens);
    return { uniform, group, data, rival, pose: createPose(), rotors: createRotors(), visible: false, showBlur: false };
  };

  const pose = (inst: Instance, q: QuadState, f: FrameInfo, hide: boolean): void => {
    stepPose(inst.pose, q.pos, q.quat);
    stepRotors(inst.rotors, q.motorOmega, f.dt);
    inst.visible = !hide && !cameraInsideQuad(f.camera.pos, q.pos);
    if (!inst.visible) return;
    const { data, rotors } = inst;
    data.set(inst.pose.model, U.model);
    data.set(inst.pose.prevModel, U.prevModel);
    inst.showBlur = false;
    const level = ledLevel(q.armed, f.time);
    for (let i = 0; i < 4; i++) {
      const s = U.spin + i * 4;
      data[s] = rotors.angle[i];
      data[s + 1] = rotors.prevAngle[i];
      data[s + 2] = rotors.solid[i];
      data[s + 3] = rotors.blur[i];
      if (rotors.blur[i] > MIN_BLUR) inst.showBlur = true;
      data[U.led + i * 4 + 3] = (i < 2 ? LED_REAR_STRENGTH * (inst.rival ? RIVAL_REAR_BOOST : 1) : LED_FRONT_STRENGTH) * level;
    }
    d.queue.writeBuffer(inst.uniform, 0, data);
  };

  const drawProps = (pass: GPURenderPassEncoder): void => {
    pass.setPipeline(propPipeline);
    pass.setVertexBuffer(0, cwProps.vertex);
    pass.setIndexBuffer(cwProps.index, 'uint32');
    pass.drawIndexed(cwProps.indexCount, 2, 0, 0, 0);
    pass.setVertexBuffer(0, ccwProps.vertex);
    pass.setIndexBuffer(ccwProps.index, 'uint32');
    pass.drawIndexed(ccwProps.indexCount, 2, 0, 0, 2);
  };
  const gbuffer = (pass: GPURenderPassEncoder, inst: Instance): void => {
    if (!inst.visible) return;
    pass.setBindGroup(2, inst.group);
    pass.setPipeline(bodyPipeline);
    pass.setVertexBuffer(0, body.vertex);
    pass.setIndexBuffer(body.index, 'uint32');
    pass.drawIndexed(body.indexCount);
    drawProps(pass);
  };
  const forward = (pass: GPURenderPassEncoder, inst: Instance): void => {
    if (!inst.visible) return;
    pass.setBindGroup(2, inst.group);
    if (inst.showBlur) {
      pass.setPipeline(discPipeline);
      pass.draw(6, 4);
    }
    pass.setPipeline(spritePipeline);
    pass.draw(6, 5);
  };

  const main = instance('quad', false);
  const rivals: Instance[] = [];
  let rivalCount = 0;
  const rt = createQuadRt();
  let rtActive = false;

  return {
    update(_rc, f, hide) {
      const q = f.quad;
      if (!q) {
        if (rtActive) rc.rt.remove(RT_GROUP);
        rtActive = false;
        main.pose.valid = false;
        main.visible = false;
        return;
      }
      rt.update(q.pos, q.quat);
      rc.rt.setDynamic(RT_GROUP, rt.prims);
      rtActive = true;
      pose(main, q, f, hide);
    },
    updateRivals(f, list) {
      while (rivals.length < list.length) {
        rivals.push(instance(`rival quad ${rivals.length}`, true));
      }
      rivalCount = list.length;
      for (let i = 0; i < rivalCount; i++) {
        const r = list[i];
        rivals[i].data.set(r.led, U.led);
        rivals[i].data.set(r.led, U.led + 4);
        pose(rivals[i], r.state, f, false);
      }
    },
    encodeGBuffer(pass) {
      gbuffer(pass, main);
      for (let i = 0; i < rivalCount; i++) gbuffer(pass, rivals[i]);
    },
    encodeForward(pass) {
      forward(pass, main);
      for (let i = 0; i < rivalCount; i++) forward(pass, rivals[i]);
    },
    destroy(r) {
      r.rt.remove(RT_GROUP);
      for (const m of [body, cwProps, ccwProps]) {
        m.vertex.destroy();
        m.index.destroy();
      }
      for (const inst of [main, ...rivals]) inst.uniform.destroy();
    },
  };
}

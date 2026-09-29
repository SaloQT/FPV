import { FORMATS, GBUFFER_TARGETS, type RenderModule } from '../../render/contracts';
import type { SceneState } from './params';
import wgsl from './scene.wgsl?raw';

const CUBE = { x: 2.8, y: 0.85, z: -6, yaw: 0.6, swing: 1.2, swingRate: 0.9, spin: 1.6 } as const;

/** The dev cube's pose at time t (centre xyz, yaw): still, or swinging and spinning so motion vectors and TAA rejection have work to do. */
export function cubePose(out: Float32Array, at: number, t: number, moving: boolean): void {
  out[at] = moving ? CUBE.x + CUBE.swing * Math.sin(CUBE.swingRate * t) : CUBE.x;
  out[at + 1] = CUBE.y;
  out[at + 2] = CUBE.z;
  out[at + 3] = moving ? CUBE.spin * t : CUBE.yaw;
}

/** G-buffer (depth, motion) and forward (hdr radiance) passes of the analytic dev scene in scene.wgsl, driven by `state`. */
export function createPostScene(state: SceneState): RenderModule {
  const data = new Float32Array(16);
  let uniform: GPUBuffer;
  let group: GPUBindGroup;
  let gbufferPipeline: GPURenderPipeline;
  let forwardPipeline: GPURenderPipeline;
  return {
    name: 'dev-post-scene',
    init(rc) {
      const d = rc.device;
      const visibility = GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT;
      const layout = d.createBindGroupLayout({ label: 'dev post scene', entries: [{ binding: 0, visibility, buffer: { type: 'uniform' } }] });
      uniform = d.createBuffer({ label: 'dev post scene', size: data.byteLength, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
      group = d.createBindGroup({ label: 'dev post scene', layout, entries: [{ binding: 0, resource: { buffer: uniform } }] });
      const module = d.createShaderModule({ label: 'dev post scene', code: rc.shader('common/world_bindings.wgsl') + wgsl });
      const pipelineLayout = d.createPipelineLayout({ bindGroupLayouts: [rc.frame.layout, rc.world.layout, layout] });
      const depth = (write: boolean): GPUDepthStencilState => ({ format: FORMATS.depth, depthWriteEnabled: write, depthCompare: 'always' });
      // Every pixel is written by the analytic ray cast, sky included (depth 0), so the depth test is off.
      gbufferPipeline = d.createRenderPipeline({
        label: 'dev post scene gbuffer',
        layout: pipelineLayout,
        vertex: { module, entryPoint: 'vs' },
        fragment: { module, entryPoint: 'fs_gbuffer', targets: GBUFFER_TARGETS },
        primitive: { topology: 'triangle-list' },
        depthStencil: depth(true),
      });
      forwardPipeline = d.createRenderPipeline({
        label: 'dev post scene forward',
        layout: pipelineLayout,
        vertex: { module, entryPoint: 'vs' },
        fragment: { module, entryPoint: 'fs_forward', targets: [{ format: FORMATS.hdr }] },
        primitive: { topology: 'triangle-list' },
        depthStencil: depth(false),
      });
    },
    update(rc, f) {
      data[0] = state.sunDir[0]; data[1] = state.sunDir[1]; data[2] = state.sunDir[2]; data[3] = state.sunNits;
      data[4] = state.radiance; data[5] = state.premul; data[6] = state.grid ? 1 : 0; data[7] = state.lampNits;
      cubePose(data, 8, f.time, state.motion);
      cubePose(data, 12, f.time - f.dt, state.motion);
      rc.device.queue.writeBuffer(uniform, 0, data);
    },
    encodeGBuffer(pass) {
      pass.setPipeline(gbufferPipeline);
      pass.setBindGroup(2, group);
      pass.draw(3);
    },
    encodeForward(pass) {
      pass.setPipeline(forwardPipeline);
      pass.setBindGroup(2, group);
      pass.draw(3);
    },
    destroy() {
      uniform?.destroy();
    },
  };
}

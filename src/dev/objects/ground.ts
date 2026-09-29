import { DEPTH_STATE, GBUFFER_TARGETS, type RenderModule } from '../../render/contracts';
import wgsl from './ground.wgsl?raw';

const CELLS = 200;
const CELL = 2;

/** Dev ground plane draped over the scene terrain (the real terrain module is another engineer's job). */
export function createDevGround(): RenderModule {
  let pipeline: GPURenderPipeline;
  let vertices: GPUBuffer;
  let indices: GPUBuffer;
  let indexCount = 0;
  return {
    name: 'dev-ground',
    init(rc) {
      const d = rc.device;
      const n = CELLS + 1;
      const v = new Float32Array(n * n * 2);
      for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) v.set([(i - CELLS / 2) * CELL, (j - CELLS / 2) * CELL], (j * n + i) * 2);
      const idx = new Uint32Array(CELLS * CELLS * 6);
      let k = 0;
      for (let j = 0; j < CELLS; j++) {
        for (let i = 0; i < CELLS; i++) {
          const a = j * n + i;
          idx.set([a, a + n, a + 1, a + 1, a + n, a + n + 1], k);
          k += 6;
        }
      }
      indexCount = idx.length;
      vertices = d.createBuffer({ label: 'dev ground vertices', size: v.byteLength, usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST });
      indices = d.createBuffer({ label: 'dev ground indices', size: idx.byteLength, usage: GPUBufferUsage.INDEX | GPUBufferUsage.COPY_DST });
      d.queue.writeBuffer(vertices, 0, v);
      d.queue.writeBuffer(indices, 0, idx);
      const module = d.createShaderModule({ label: 'dev ground', code: rc.shader('common/world_bindings.wgsl') + wgsl });
      pipeline = d.createRenderPipeline({
        label: 'dev ground',
        layout: d.createPipelineLayout({ bindGroupLayouts: [rc.frame.layout, rc.world.layout] }),
        vertex: { module, entryPoint: 'vs', buffers: [{ arrayStride: 8, attributes: [{ shaderLocation: 0, offset: 0, format: 'float32x2' }] }] },
        fragment: { module, entryPoint: 'fs', targets: GBUFFER_TARGETS },
        primitive: { topology: 'triangle-list', cullMode: 'back' },
        depthStencil: DEPTH_STATE,
      });
    },
    encodeGBuffer(pass) {
      pass.setPipeline(pipeline);
      pass.setVertexBuffer(0, vertices);
      pass.setIndexBuffer(indices, 'uint32');
      pass.drawIndexed(indexCount);
    },
    destroy() {
      vertices?.destroy();
      indices?.destroy();
    },
  };
}

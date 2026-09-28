import type { Quat, TerrainSampler, Vec3 } from '../../contracts';
import { DEPTH_STATE, GBUFFER_TARGETS, MaterialId, type RTMaterial, type RTPrimitive, type RenderContext, type RenderModule } from '../../render/contracts';
import { buildMeshes, type MeshRange, type MeshSet } from './meshes';
import wgsl from './objects.wgsl?raw';

interface Prop {
  kind: 'box' | 'sphere';
  x: number;
  z: number;
  half: Vec3;
  yaw: number;
  albedo: Vec3;
  roughness: number;
  metalness: number;
  material: MaterialId;
}

const PROPS: Prop[] = [
  { kind: 'box', x: -5, z: -2, half: [1, 1, 1], yaw: 0.2, albedo: [0.6, 0.09, 0.07], roughness: 0.7, metalness: 0, material: MaterialId.Ground },
  { kind: 'box', x: -2, z: -6, half: [0.8, 1.7, 0.8], yaw: 0.6, albedo: [0.12, 0.45, 0.15], roughness: 0.6, metalness: 0, material: MaterialId.Ground },
  { kind: 'box', x: 3.5, z: -4.5, half: [1.5, 0.7, 1], yaw: 0.5, albedo: [0.1, 0.2, 0.6], roughness: 0.5, metalness: 0, material: MaterialId.Ground },
  { kind: 'box', x: 7, z: 0.5, half: [0.9, 0.9, 0.9], yaw: 0.8, albedo: [0.75, 0.75, 0.72], roughness: 0.8, metalness: 0, material: MaterialId.Ground },
  { kind: 'box', x: -6.5, z: 4.5, half: [1.2, 0.5, 2], yaw: -0.4, albedo: [0.7, 0.55, 0.1], roughness: 0.65, metalness: 0, material: MaterialId.Ground },
  { kind: 'box', x: 3.5, z: 4, half: [1, 1, 1], yaw: 0.3, albedo: [0.95, 0.64, 0.54], roughness: 0.22, metalness: 1, material: MaterialId.GateFrame },
  { kind: 'sphere', x: -0.5, z: 3, half: [1.3, 1.3, 1.3], yaw: 0, albedo: [0.8, 0.35, 0.1], roughness: 0.35, metalness: 0, material: MaterialId.Rock },
];

const GROUND_ALBEDO: Vec3 = [0.24, 0.27, 0.13];
const SINK = 0.1;
const FLOATS_PER_INSTANCE = 16;
const VERTEX_STRIDE = 24;

const yawQuat = (yaw: number): Quat => [0, Math.sin(yaw / 2), 0, Math.cos(yaw / 2)];

function rtMaterial(p: Prop): RTMaterial { return { albedo: p.albedo, roughness: p.roughness, metalness: p.metalness }; }

/** Ground plane, five boxes, a sphere and a metal box, drawn into the G-buffer with every output encoded as the contract says. */
export function createDevObjects(sampler: TerrainSampler): RenderModule {
  let pipeline: GPURenderPipeline;
  let group: GPUBindGroup;
  let vertexBuffer: GPUBuffer;
  let indexBuffer: GPUBuffer;
  let instanceBuffer: GPUBuffer;
  let meshes: MeshSet;

  const placed = PROPS.map((p) => ({ p, y: sampler.heightAt(p.x, p.z) + p.half[1] - SINK }));
  // Instances are laid out as ground, boxes, spheres, so each mesh is one contiguous instanced draw.
  const boxCount = placed.filter(({ p }) => p.kind === 'box').length;

  function instanceData(): Float32Array {
    const data = new Float32Array((placed.length + 1) * FLOATS_PER_INSTANCE);
    const put = (i: number, v: number[]) => data.set(v, i * FLOATS_PER_INSTANCE);
    put(0, [0, 0, 0, 0, 1, 1, 1, MaterialId.Ground, ...GROUND_ALBEDO, 0.9, 0, 0, 0, 0]);
    placed.forEach(({ p, y }, k) => put(k + 1, [p.x, y, p.z, p.yaw, ...p.half, p.material, ...p.albedo, p.roughness, p.metalness, 0, 0, 0]));
    return data;
  }

  function registerProxies(rc: RenderContext): void {
    const prims: RTPrimitive[] = placed.map(({ p, y }): RTPrimitive => p.kind === 'sphere'
      ? { type: 'sphere', center: [p.x, y, p.z], radius: p.half[0], material: rtMaterial(p) }
      : { type: 'obb', center: [p.x, y, p.z], half: p.half, rot: yawQuat(p.yaw), material: rtMaterial(p) });
    rc.rt.setStatic('dev-props', prims);
  }

  function draw(pass: GPURenderPassEncoder, m: MeshRange, instances: number, first: number): void {
    pass.drawIndexed(m.indexCount, instances, m.firstIndex, m.baseVertex, first);
  }

  return {
    name: 'dev-objects',
    init(rc) {
      const d = rc.device;
      meshes = buildMeshes();
      vertexBuffer = d.createBuffer({ label: 'dev vertices', size: meshes.vertices.byteLength, usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST });
      indexBuffer = d.createBuffer({ label: 'dev indices', size: meshes.indices.byteLength, usage: GPUBufferUsage.INDEX | GPUBufferUsage.COPY_DST });
      const inst = instanceData();
      instanceBuffer = d.createBuffer({ label: 'dev instances', size: inst.byteLength, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST });
      d.queue.writeBuffer(vertexBuffer, 0, meshes.vertices);
      d.queue.writeBuffer(indexBuffer, 0, meshes.indices);
      d.queue.writeBuffer(instanceBuffer, 0, inst);
      const layout = d.createBindGroupLayout({ entries: [{ binding: 0, visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT, buffer: { type: 'read-only-storage' } }] });
      group = d.createBindGroup({ layout, entries: [{ binding: 0, resource: { buffer: instanceBuffer } }] });
      const module = d.createShaderModule({ label: 'dev objects', code: rc.shader('common/world_bindings.wgsl') + wgsl });
      pipeline = d.createRenderPipeline({
        label: 'dev objects',
        layout: d.createPipelineLayout({ bindGroupLayouts: [rc.frame.layout, rc.world.layout, layout] }),
        vertex: {
          module, entryPoint: 'vs',
          buffers: [{ arrayStride: VERTEX_STRIDE, attributes: [{ shaderLocation: 0, offset: 0, format: 'float32x3' }, { shaderLocation: 1, offset: 12, format: 'float32x3' }] }],
        },
        fragment: { module, entryPoint: 'fs', targets: GBUFFER_TARGETS },
        primitive: { topology: 'triangle-list', cullMode: 'none' },
        depthStencil: DEPTH_STATE,
      });
      registerProxies(rc);
    },
    encodeGBuffer(pass) {
      pass.setPipeline(pipeline);
      pass.setBindGroup(2, group);
      pass.setVertexBuffer(0, vertexBuffer);
      pass.setIndexBuffer(indexBuffer, 'uint32');
      draw(pass, meshes.ground, 1, 0);
      draw(pass, meshes.cube, boxCount, 1);
      draw(pass, meshes.sphere, placed.length - boxCount, 1 + boxCount);
    },
    destroy() {
      vertexBuffer?.destroy();
      indexBuffer?.destroy();
      instanceBuffer?.destroy();
    },
  };
}

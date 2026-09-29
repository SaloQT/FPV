import type { Vec3 } from '../../contracts';
import { DEPTH_STATE, GBUFFER_TARGETS, MaterialId, type FrameInfo, type RTMaterial, type RenderModule } from '../../render/contracts';
import { VERTEX_BYTES, MeshBuilder, addPrimitive, addTerrain, addUnitSphere } from './geometry';
import type { DevScene } from './scenes';
import wgsl from './scene.wgsl?raw';

export type MoverMode = 'none' | 'orbit' | 'jump';

export interface MoverOptions {
  mode: MoverMode;
  /** Metres per second along the orbit (orbit) or the frame at which the prop hops between its two spots (jump, in `jumpFrame`). */
  speed: number;
  jumpFrame: number;
}

const MOVER_RADIUS = 1;
const MOVER_MATERIAL: RTMaterial = { albedo: [0.9, 0.8, 0.1], roughness: 0.45, metalness: 0 };
const MATERIAL_FLOATS = 12;
const FIXED_DT = 1 / 60;

function pushMaterial(out: number[], m: RTMaterial, id: MaterialId, checker: number, moves: boolean): void {
  const emissive = m.emissive ? Math.max(m.emissive[0], m.emissive[1], m.emissive[2]) : 0;
  out.push(m.albedo[0], m.albedo[1], m.albedo[2], m.roughness, m.metalness, 0, emissive, checker, id, moves ? 1 : 0, 0, 0);
}

/** Where the moving prop is on frame `frame` (it circles the scene centre at height 2.5 m, or hops between two spots). */
export function moverPosition(scene: DevScene, o: MoverOptions, frame: number, out: Vec3): Vec3 {
  const cx = scene.camera.target[0], cz = scene.camera.target[2];
  if (o.mode === 'jump') {
    const x = cx + (frame < o.jumpFrame ? -6 : 6);
    out[0] = x; out[1] = scene.sampler.heightAt(x, cz) + 2.2; out[2] = cz;
    return out;
  }
  const radius = 7, angle = (frame * FIXED_DT * o.speed) / radius;
  out[0] = cx + Math.cos(angle) * radius; out[2] = cz + Math.sin(angle) * radius;
  out[1] = scene.sampler.heightAt(out[0], out[2]) + 2.5;
  return out;
}

/** Draws the scene (ground mesh from the heightfield plus the proxies as meshes) into the G-buffer and registers the same proxies with the RT registry. */
export function createDevSceneModule(scene: DevScene, mover: MoverOptions, checker: number): RenderModule {
  let pipeline: GPURenderPipeline;
  let group: GPUBindGroup;
  let vertexBuffer: GPUBuffer;
  let indexBuffer: GPUBuffer;
  let materialBuffer: GPUBuffer;
  let moverBuffer: GPUBuffer;
  let indexCount = 0;
  const moverData = new Float32Array(8);
  const cur: Vec3 = [0, 0, 0], prev: Vec3 = [0, 0, 0];

  return {
    name: 'rt-dev-scene',
    init(rc) {
      const d = rc.device;
      const mats: number[] = [];
      const b = new MeshBuilder();
      pushMaterial(mats, { albedo: scene.ground.albedo, roughness: scene.ground.roughness, metalness: 0 }, MaterialId.Ground, checker, false);
      addTerrain(b, scene.terrain, 0);
      scene.props.forEach((p, i) => {
        pushMaterial(mats, p.prim.material, p.id, 0, false);
        addPrimitive(b, p.prim, i + 1);
      });
      if (mover.mode !== 'none') {
        pushMaterial(mats, MOVER_MATERIAL, MaterialId.Rock, 0, true);
        addUnitSphere(b, MOVER_RADIUS, scene.props.length + 1);
      }
      const vertices = new Float32Array(b.verts), indices = new Uint32Array(b.idx), materials = new Float32Array(mats);
      indexCount = indices.length;
      const U = GPUBufferUsage;
      vertexBuffer = d.createBuffer({ label: 'rt dev vertices', size: vertices.byteLength, usage: U.VERTEX | U.COPY_DST });
      indexBuffer = d.createBuffer({ label: 'rt dev indices', size: indices.byteLength, usage: U.INDEX | U.COPY_DST });
      materialBuffer = d.createBuffer({ label: 'rt dev materials', size: materials.length * 4, usage: U.STORAGE | U.COPY_DST });
      moverBuffer = d.createBuffer({ label: 'rt dev mover', size: moverData.byteLength, usage: U.UNIFORM | U.COPY_DST });
      d.queue.writeBuffer(vertexBuffer, 0, vertices);
      d.queue.writeBuffer(indexBuffer, 0, indices);
      d.queue.writeBuffer(materialBuffer, 0, materials);
      const layout = d.createBindGroupLayout({
        entries: [
          { binding: 0, visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT, buffer: { type: 'read-only-storage' } },
          { binding: 1, visibility: GPUShaderStage.VERTEX, buffer: { type: 'uniform' } },
        ],
      });
      group = d.createBindGroup({ layout, entries: [{ binding: 0, resource: { buffer: materialBuffer } }, { binding: 1, resource: { buffer: moverBuffer } }] });
      const module = d.createShaderModule({ label: 'rt dev scene', code: rc.shader('common/world_bindings.wgsl') + wgsl });
      pipeline = d.createRenderPipeline({
        label: 'rt dev scene',
        layout: d.createPipelineLayout({ bindGroupLayouts: [rc.frame.layout, rc.world.layout, layout] }),
        vertex: {
          module, entryPoint: 'vs',
          buffers: [{
            arrayStride: VERTEX_BYTES,
            attributes: [{ shaderLocation: 0, offset: 0, format: 'float32x3' }, { shaderLocation: 1, offset: 12, format: 'float32x3' }, { shaderLocation: 2, offset: 24, format: 'float32' }],
          }],
        },
        fragment: { module, entryPoint: 'fs', targets: GBUFFER_TARGETS },
        primitive: { topology: 'triangle-list', cullMode: 'none' },
        depthStencil: DEPTH_STATE,
      });
      rc.rt.setStatic('rt-dev-scene', scene.props.map((p) => p.prim));
    },
    update(rc, f: FrameInfo) {
      if (mover.mode === 'none') return;
      moverPosition(scene, mover, f.frameIndex, cur);
      moverPosition(scene, mover, Math.max(f.frameIndex - 1, 0), prev);
      moverData.set(cur, 0);
      moverData.set(prev, 4);
      rc.device.queue.writeBuffer(moverBuffer, 0, moverData);
      rc.rt.setDynamic('rt-dev-mover', [{ type: 'sphere', center: [cur[0], cur[1], cur[2]], radius: MOVER_RADIUS, material: MOVER_MATERIAL }]);
    },
    encodeGBuffer(pass) {
      pass.setPipeline(pipeline);
      pass.setBindGroup(2, group);
      pass.setVertexBuffer(0, vertexBuffer);
      pass.setIndexBuffer(indexBuffer, 'uint32');
      pass.drawIndexed(indexCount);
    },
    destroy() {
      vertexBuffer?.destroy();
      indexBuffer?.destroy();
      materialBuffer?.destroy();
      moverBuffer?.destroy();
    },
  };
}

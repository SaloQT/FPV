/** GPU side of the track: static gate/obstacle/pad mesh, animated cloth flags, LED glow ribbons and the RT proxies. */
import { FORWARD_DEPTH_STATE, DEPTH_STATE, FORMATS, GBUFFER_TARGETS, type FrameInfo, type RenderContext, type SceneData } from '../contracts';
import { GLOW_STRIDE, buildGlowMesh } from './glowRibbons';
import { gateColour, kindDefines } from './materials';
import { VERTEX_STRIDE } from './meshBuilder';
import { buildTrackMesh } from './trackMesh';
import { buildTrackProxies } from './trackProxies';

const CLOTH_NX = 24;
const CLOTH_NY = 14;
/** Float counts of the structs in track_bindings.wgsl (TrackU, GateInfo, Flag). */
export const TRACK_UNIFORM_FLOATS = 8;
export const GATE_FLOATS = 8;
export const FLAG_FLOATS = 12;
const FLASH_SECONDS = 0.5;
const RT_GROUP = 'track';

export interface TrackObjects {
  setScene(rc: RenderContext, scene: SceneData): void;
  update(rc: RenderContext, f: FrameInfo): void;
  encodeGBuffer(pass: GPURenderPassEncoder): void;
  encodeForward(pass: GPURenderPassEncoder): void;
  setActiveGate(i: number): void;
  setGatePassed(i: number): void;
  /** `dirXZ` is the direction the air travels toward (world x, z); `speed` in m/s. */
  setWind(dirXZ: [number, number], speed: number): void;
  destroy(rc: RenderContext): void;
}

interface Mesh {
  vertex: GPUBuffer;
  index: GPUBuffer;
  indexCount: number;
}

function clothGrid(): { vertices: Float32Array; indices: Uint16Array } {
  const vertices = new Float32Array((CLOTH_NX + 1) * (CLOTH_NY + 1) * 2);
  for (let j = 0; j <= CLOTH_NY; j++) {
    for (let i = 0; i <= CLOTH_NX; i++) vertices.set([i / CLOTH_NX, j / CLOTH_NY], (j * (CLOTH_NX + 1) + i) * 2);
  }
  const indices = new Uint16Array(CLOTH_NX * CLOTH_NY * 6);
  let n = 0;
  for (let j = 0; j < CLOTH_NY; j++) {
    for (let i = 0; i < CLOTH_NX; i++) {
      const a = j * (CLOTH_NX + 1) + i;
      indices.set([a, a + 1, a + CLOTH_NX + 2, a, a + CLOTH_NX + 2, a + CLOTH_NX + 1], n);
      n += 6;
    }
  }
  return { vertices, indices };
}

export function createTrackObjects(rc: RenderContext): TrackObjects {
  const d = rc.device;
  const STAGES = GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT;
  const layout = d.createBindGroupLayout({
    label: 'track group 2',
    entries: [
      { binding: 0, visibility: STAGES, buffer: { type: 'uniform' } },
      { binding: 1, visibility: STAGES, buffer: { type: 'read-only-storage' } },
      { binding: 2, visibility: STAGES, buffer: { type: 'read-only-storage' } },
    ],
  });
  const pipelineLayout = d.createPipelineLayout({ bindGroupLayouts: [rc.frame.layout, rc.world.layout, layout] });
  const module = rc.module('objects/track.wgsl', kindDefines());
  const glowModule = rc.module('objects/glow.wgsl');
  const staticPipeline = d.createRenderPipeline({
    label: 'track static',
    layout: pipelineLayout,
    vertex: {
      module,
      entryPoint: 'vs',
      buffers: [
        {
          arrayStride: VERTEX_STRIDE,
          attributes: [
            { shaderLocation: 0, offset: 0, format: 'float32x3' },
            { shaderLocation: 1, offset: 12, format: 'float32x3' },
            { shaderLocation: 2, offset: 24, format: 'float32x2' },
            { shaderLocation: 3, offset: 32, format: 'float32x4' },
          ],
        },
      ],
    },
    fragment: { module, entryPoint: 'fs', targets: GBUFFER_TARGETS },
    primitive: { topology: 'triangle-list', cullMode: 'back' },
    depthStencil: DEPTH_STATE,
  });
  const clothPipeline = d.createRenderPipeline({
    label: 'track cloth',
    layout: pipelineLayout,
    vertex: { module, entryPoint: 'vsCloth', buffers: [{ arrayStride: 8, attributes: [{ shaderLocation: 0, offset: 0, format: 'float32x2' }] }] },
    fragment: { module, entryPoint: 'fsCloth', targets: GBUFFER_TARGETS },
    primitive: { topology: 'triangle-list', cullMode: 'none' },
    depthStencil: DEPTH_STATE,
  });
  const glowPipeline = d.createRenderPipeline({
    label: 'track glow',
    layout: pipelineLayout,
    vertex: {
      module: glowModule,
      entryPoint: 'vsGlow',
      buffers: [
        {
          arrayStride: GLOW_STRIDE,
          attributes: [
            { shaderLocation: 0, offset: 0, format: 'float32x3' },
            { shaderLocation: 1, offset: 12, format: 'float32x3' },
            { shaderLocation: 2, offset: 24, format: 'float32x2' },
          ],
        },
      ],
    },
    fragment: {
      module: glowModule,
      entryPoint: 'fsGlow',
      targets: [{ format: FORMATS.hdr, blend: { color: { srcFactor: 'one', dstFactor: 'one', operation: 'add' }, alpha: { srcFactor: 'zero', dstFactor: 'one', operation: 'add' } } }],
    },
    primitive: { topology: 'triangle-list', cullMode: 'none' },
    depthStencil: FORWARD_DEPTH_STATE,
  });

  const uniform = d.createBuffer({ label: 'track uniform', size: TRACK_UNIFORM_FLOATS * 4, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
  const uniformData = new Float32Array(TRACK_UNIFORM_FLOATS);
  const grid = clothGrid();
  const clothVertex = d.createBuffer({ label: 'cloth grid', size: grid.vertices.byteLength, usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST });
  const clothIndex = d.createBuffer({ label: 'cloth indices', size: grid.indices.byteLength, usage: GPUBufferUsage.INDEX | GPUBufferUsage.COPY_DST });
  d.queue.writeBuffer(clothVertex, 0, grid.vertices);
  d.queue.writeBuffer(clothIndex, 0, grid.indices);

  let group: GPUBindGroup | null = null;
  let gateBuffer: GPUBuffer | null = null;
  let flagBuffer: GPUBuffer | null = null;
  let mesh: Mesh | null = null;
  let glow: Mesh | null = null;
  let flagCount = 0;
  let gateData = new Float32Array(GATE_FLOATS);
  let gateCount = 0;
  let gatesUploaded = false;
  let active = -1;
  const passed = new Set<number>();
  // Gate -> time its pass flash started; NaN until the next update stamps it with the frame clock.
  const flashAt = new Map<number, number>();
  let prevTime = NaN;
  let wind: [number, number, number] = [1, 0, 3];

  const upload = (data: { vertices: Float32Array; indices: Uint32Array }, vertexLabel: string): Mesh | null => {
    if (data.indices.length === 0) return null;
    const vertex = d.createBuffer({ label: vertexLabel, size: data.vertices.byteLength, usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST });
    const index = d.createBuffer({ label: `${vertexLabel} indices`, size: data.indices.byteLength, usage: GPUBufferUsage.INDEX | GPUBufferUsage.COPY_DST });
    d.queue.writeBuffer(vertex, 0, data.vertices);
    d.queue.writeBuffer(index, 0, data.indices);
    return { vertex, index, indexCount: data.indices.length };
  };
  const release = (): void => {
    mesh?.vertex.destroy();
    mesh?.index.destroy();
    glow?.vertex.destroy();
    glow?.index.destroy();
    gateBuffer?.destroy();
    flagBuffer?.destroy();
    mesh = glow = null;
    gateBuffer = flagBuffer = null;
    group = null;
  };

  return {
    setScene(_rc, scene) {
      release();
      const track = scene.track;
      gateCount = 0;
      if (!track) {
        flagCount = 0;
        rc.rt.remove(RT_GROUP);
        return;
      }
      const built = buildTrackMesh(track, scene.sampler);
      mesh = upload(built.mesh, 'track mesh');
      glow = upload(buildGlowMesh(built.strips), 'track glow');
      gateCount = track.gates.length;
      gatesUploaded = false;
      gateData = new Float32Array(Math.max(1, gateCount) * GATE_FLOATS);
      track.gates.forEach((g, i) => gateData.set(gateColour(g.index), i * GATE_FLOATS));
      flagCount = built.flags.length;
      const flagData = new Float32Array(Math.max(1, flagCount) * FLAG_FLOATS);
      built.flags.forEach((f, i) => flagData.set([f.pos[0], f.pos[1], f.pos[2], f.width, f.colour[0], f.colour[1], f.colour[2], f.height, f.seed, 0, 0, 0], i * FLAG_FLOATS));
      gateBuffer = d.createBuffer({ label: 'track gates', size: gateData.byteLength, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST });
      flagBuffer = d.createBuffer({ label: 'track flags', size: flagData.byteLength, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST });
      d.queue.writeBuffer(flagBuffer, 0, flagData);
      group = d.createBindGroup({
        label: 'track group 2',
        layout,
        entries: [
          { binding: 0, resource: { buffer: uniform } },
          { binding: 1, resource: { buffer: gateBuffer } },
          { binding: 2, resource: { buffer: flagBuffer } },
        ],
      });
      rc.rt.setStatic(RT_GROUP, buildTrackProxies(track, scene.sampler));
    },
    update(_rc, f) {
      if (!group || !gateBuffer) return;
      const time = f.time;
      uniformData[0] = time;
      uniformData[1] = Number.isFinite(prevTime) ? prevTime : time;
      uniformData[2] = f.dt;
      uniformData[4] = wind[0];
      uniformData[5] = wind[1];
      uniformData[6] = wind[2];
      prevTime = time;
      d.queue.writeBuffer(uniform, 0, uniformData);
      let gatesChanged = !gatesUploaded;
      for (let i = 0; i < gateCount; i++) {
        let start = flashAt.get(i);
        if (start !== undefined && Number.isNaN(start)) {
          start = time;
          flashAt.set(i, time);
        }
        const flash = start === undefined ? 0 : Math.min(1, Math.max(0, 1 - (time - start) / FLASH_SECONDS));
        const o = i * GATE_FLOATS;
        const prevState = gateData[o + 4], prevFlash = gateData[o + 5];
        gateData[o + 4] = passed.has(i) ? 2 : i === active ? 1 : 0;
        gateData[o + 5] = flash;
        // Compare the packed float32 values: an unchanged GPU payload needs no queue upload.
        if (prevState !== gateData[o + 4] || prevFlash !== gateData[o + 5]) gatesChanged = true;
      }
      if (gatesChanged) {
        d.queue.writeBuffer(gateBuffer, 0, gateData);
        gatesUploaded = true;
      }
    },
    encodeGBuffer(pass) {
      if (!group) return;
      pass.setBindGroup(2, group);
      if (mesh) {
        pass.setPipeline(staticPipeline);
        pass.setVertexBuffer(0, mesh.vertex);
        pass.setIndexBuffer(mesh.index, 'uint32');
        pass.drawIndexed(mesh.indexCount);
      }
      if (flagCount > 0) {
        pass.setPipeline(clothPipeline);
        pass.setVertexBuffer(0, clothVertex);
        pass.setIndexBuffer(clothIndex, 'uint16');
        pass.drawIndexed(grid.indices.length, flagCount);
      }
    },
    encodeForward(pass) {
      if (!group || !glow) return;
      pass.setPipeline(glowPipeline);
      pass.setBindGroup(2, group);
      pass.setVertexBuffer(0, glow.vertex);
      pass.setIndexBuffer(glow.index, 'uint32');
      pass.drawIndexed(glow.indexCount);
    },
    setActiveGate(i) {
      active = i;
      for (const k of passed) if (k >= i) passed.delete(k);
      for (const k of flashAt.keys()) if (k >= i) flashAt.delete(k);
    },
    setGatePassed(i) {
      if (passed.has(i)) return;
      passed.add(i);
      flashAt.set(i, NaN);
      if (active === i) active = -1;
    },
    setWind(dirXZ, speed) {
      const l = Math.hypot(dirXZ[0], dirXZ[1]);
      wind = l > 1e-6 ? [dirXZ[0] / l, dirXZ[1] / l, Math.max(0, speed)] : [wind[0], wind[1], Math.max(0, speed)];
    },
    destroy(r) {
      release();
      r.rt.remove(RT_GROUP);
      uniform.destroy();
      clothVertex.destroy();
      clothIndex.destroy();
    },
  };
}

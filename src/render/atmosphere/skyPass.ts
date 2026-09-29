import { FORMATS, SKY_DEPTH_STATE, type FrameInfo, type RenderContext } from '../contracts';
import { LUNAR_ROWS } from './celestial';
import { MILKY_WAY_HEIGHT, MILKY_WAY_WIDTH } from './milkyWay';
import { MAX_PLANETS, STAR_FLOATS, STAR_STRIDE_BYTES, packPlanets, starCountBrighterThan, type PackedStars } from './starData';

const ADD: GPUBlendComponent = { srcFactor: 'one', dstFactor: 'one', operation: 'add' };

/**
 * The sky render pass: a fullscreen sky/sun/moon/Milky Way/cloud draw (sky.wgsl) followed by instanced star and planet quads
 * (stars.wgsl) added on top. It owns the group-2 resources both shaders share: the atmosphere uniform buffer and LUTs (owned by
 * AtmosphereLuts), the Milky Way map, the star instance buffer and the cloud layer's result texture.
 */
export class SkyPass {
  private readonly layout: GPUBindGroupLayout;
  private readonly skyPipeline: GPURenderPipeline;
  private readonly starPipeline: GPURenderPipeline;
  private readonly milkyWay: GPUTexture;
  private readonly planetBuffer: GPUBuffer;
  private readonly planetData = new Float32Array(MAX_PLANETS * STAR_FLOATS);
  private starBuffer: GPUBuffer | null = null;
  private stars: PackedStars | null = null;
  private starCount = 0;
  private planetCount = 0;
  private lights: { sun: GPUTexture; moon: GPUTexture } | null = null;
  private groups = new WeakMap<GPUTextureView, GPUBindGroup>();

  constructor(private readonly rc: RenderContext, private readonly params: GPUBuffer) {
    const d = rc.device;
    const stages = GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT;
    const tex = (binding: number, visibility: number): GPUBindGroupLayoutEntry => ({ binding, visibility, texture: { sampleType: 'float' } });
    this.layout = d.createBindGroupLayout({
      label: 'sky pass',
      entries: [{ binding: 0, visibility: stages, buffer: { type: 'uniform' } }, tex(1, GPUShaderStage.FRAGMENT), tex(2, GPUShaderStage.FRAGMENT), tex(3, GPUShaderStage.FRAGMENT), tex(4, stages)],
    });
    const layout = d.createPipelineLayout({ bindGroupLayouts: [rc.frame.layout, rc.world.layout, this.layout] });
    const target = (blend?: GPUBlendState): GPUColorTargetState => ({ format: FORMATS.hdr, blend });
    const defines = { MARIA_ROWS: LUNAR_ROWS };
    const skyModule = rc.module('sky/sky.wgsl', defines);
    this.skyPipeline = d.createRenderPipeline({
      label: 'sky', layout, vertex: { module: skyModule, entryPoint: 'vs' },
      fragment: { module: skyModule, entryPoint: 'fs', targets: [target()] },
      primitive: { topology: 'triangle-list' }, depthStencil: SKY_DEPTH_STATE,
    });
    const starModule = rc.module('sky/stars.wgsl', defines);
    this.starPipeline = d.createRenderPipeline({
      label: 'stars', layout,
      vertex: {
        module: starModule, entryPoint: 'vs',
        buffers: [{
          arrayStride: STAR_STRIDE_BYTES, stepMode: 'instance',
          attributes: [{ shaderLocation: 0, offset: 0, format: 'float32x4' }, { shaderLocation: 1, offset: 16, format: 'float32x4' }],
        }],
      },
      fragment: { module: starModule, entryPoint: 'fs', targets: [target({ color: ADD, alpha: ADD })] },
      primitive: { topology: 'triangle-list' }, depthStencil: SKY_DEPTH_STATE,
    });
    this.milkyWay = d.createTexture({
      label: 'milky way', format: 'rgba16float', size: [MILKY_WAY_WIDTH, MILKY_WAY_HEIGHT],
      usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST,
    });
    this.planetBuffer = d.createBuffer({ label: 'planets', size: MAX_PLANETS * STAR_STRIDE_BYTES, usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST });
  }

  /** Uploads the baked Milky Way map (rgba half floats, MILKY_WAY_WIDTH x MILKY_WAY_HEIGHT). */
  setMilkyWay(texels: Uint16Array<ArrayBuffer>): void {
    this.rc.device.queue.writeTexture({ texture: this.milkyWay }, texels, { bytesPerRow: MILKY_WAY_WIDTH * 8 }, [MILKY_WAY_WIDTH, MILKY_WAY_HEIGHT]);
  }

  /** Uploads the catalogue stars (or removes them with null). */
  setStars(packed: PackedStars | null): void {
    this.starBuffer?.destroy();
    this.starBuffer = null;
    this.stars = packed;
    if (!packed) { this.starCount = 0; return; }
    const buffer = this.rc.device.createBuffer({ label: 'stars', size: packed.data.byteLength, usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST });
    this.rc.device.queue.writeBuffer(buffer, 0, packed.data as Float32Array<ArrayBuffer>);
    this.starBuffer = buffer;
  }

  /** Per-frame CPU work: planet instances and the star count for the magnitude limit. */
  update(f: FrameInfo, magnitudeLimit: number): void {
    this.planetCount = packPlanets(f.astro.planets, this.planetData);
    if (this.planetCount > 0) this.rc.device.queue.writeBuffer(this.planetBuffer, 0, this.planetData as Float32Array<ArrayBuffer>, 0, this.planetCount * STAR_FLOATS);
    this.starCount = this.stars ? starCountBrighterThan(this.stars.magnitudes, magnitudeLimit) : 0;
  }

  encode(pass: GPURenderPassEncoder, skySun: GPUTexture, skyMoon: GPUTexture, cloud: GPUTextureView): void {
    pass.setPipeline(this.skyPipeline);
    pass.setBindGroup(2, this.group(skySun, skyMoon, cloud));
    pass.draw(3);
    pass.setPipeline(this.starPipeline);
    if (this.starBuffer && this.starCount > 0) {
      pass.setVertexBuffer(0, this.starBuffer);
      pass.draw(6, this.starCount);
    }
    if (this.planetCount > 0) {
      pass.setVertexBuffer(0, this.planetBuffer);
      pass.draw(6, this.planetCount);
    }
  }

  destroy(): void {
    this.milkyWay.destroy();
    this.planetBuffer.destroy();
    this.starBuffer?.destroy();
    this.starBuffer = null;
    this.groups = new WeakMap();
  }

  /** The group-2 bind group for a cloud result view; the resolved cloud view alternates between two textures, so groups are kept per view. */
  private group(sun: GPUTexture, moon: GPUTexture, cloud: GPUTextureView): GPUBindGroup {
    const l = this.lights;
    if (!l || l.sun !== sun || l.moon !== moon) {
      this.lights = { sun, moon };
      this.groups = new WeakMap();
    }
    let group = this.groups.get(cloud);
    if (!group) {
      group = this.rc.device.createBindGroup({
        label: 'sky pass', layout: this.layout,
        entries: [
          { binding: 0, resource: { buffer: this.params } }, { binding: 1, resource: sun.createView() }, { binding: 2, resource: moon.createView() },
          { binding: 3, resource: this.milkyWay.createView() }, { binding: 4, resource: cloud },
        ],
      });
      this.groups.set(cloud, group);
    }
    return group;
  }
}

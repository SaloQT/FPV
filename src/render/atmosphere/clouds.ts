import type { RenderContext } from '../contracts';
import { LUNAR_ROWS } from './celestial';
import { CLOUD_SHADOW_SIZE } from './cloudModel';
import type { CloudNoise } from './cloudNoise';

/** CloudLights (64 bytes) and Ambient (32 bytes), including WGSL vec3 padding. */
export const CLOUD_FRAME_BYTES = 96;

interface Stage {
  layout: GPUBindGroupLayout;
  pipeline: GPUComputePipeline;
}

interface Resources {
  width: number;
  height: number;
  march: GPUTexture;
  history: [GPUTexture, GPUTexture];
  marchView: GPUTextureView;
  historyViews: [GPUTextureView, GPUTextureView];
}

/**
 * The cloud compute passes (encodePre): a reduced-resolution volumetric march, a temporal resolve against the reprojected history, and
 * the top-down shadow map. The sky pass composites resolvedView() as `colour * a + rgb`. Every stage binds its own group 1 (never
 * rc.world.group, whose LUTs the atmosphere compute passes write), so the world textures are re-declared here and the bind groups are
 * rebuilt whenever the renderer replaces them or the render size changes.
 */
export class CloudLayer {
  readonly shadow: GPUTexture;
  /** True once the history holds a resolved frame that matches the current view. */
  historyValid = false;
  /** Frames encoded; drives the sub-pixel and interleaved-noise jitter. */
  frameIndex = 0;
  private readonly precomputeStage: Stage;
  private readonly frameLighting: GPUBuffer;
  private readonly marchStage: Stage;
  private readonly resolveStage: Stage;
  private readonly shadowStage: Stage;
  private readonly noiseSampler: GPUSampler;
  private readonly shadowView: GPUTextureView;
  private res: Resources | null = null;
  private groups: { precompute: GPUBindGroup; march: GPUBindGroup; resolve: [GPUBindGroup, GPUBindGroup]; shadow: GPUBindGroup } | null = null;
  private groupsFor: { t: GPUTexture; s: GPUTexture; a: GPUTexture; res: Resources } | null = null;
  private parity = 0;
  private resolvedIndex = 0;
  private idle = false;

  constructor(private readonly rc: RenderContext, private readonly noise: CloudNoise, private readonly params: GPUBuffer) {
    const d = rc.device, C = GPUShaderStage.COMPUTE;
    const sampler = (binding: number): GPUBindGroupLayoutEntry => ({ binding, visibility: C, sampler: { type: 'filtering' } });
    const tex = (binding: number, viewDimension: GPUTextureViewDimension = '2d'): GPUBindGroupLayoutEntry =>
      ({ binding, visibility: C, texture: { sampleType: 'float', viewDimension } });
    const store = (binding: number): GPUBindGroupLayoutEntry => ({ binding, visibility: C, storageTexture: { access: 'write-only', format: 'rgba16float' } });
    const uniform = (binding: number): GPUBindGroupLayoutEntry => ({ binding, visibility: C, buffer: { type: 'uniform' } });
    const lighting = (type: GPUBufferBindingType): GPUBindGroupLayoutEntry => ({ binding: 11, visibility: C, buffer: { type, minBindingSize: CLOUD_FRAME_BYTES } });
    const stage = (label: string, path: string, entries: GPUBindGroupLayoutEntry[]): Stage => {
      const layout = d.createBindGroupLayout({ label, entries });
      const pipeline = d.createComputePipeline({
        label, layout: d.createPipelineLayout({ bindGroupLayouts: [rc.frame.layout, layout] }),
        compute: { module: rc.module(path, { MARIA_ROWS: LUNAR_ROWS }), entryPoint: 'main' },
      });
      return { layout, pipeline };
    };
    this.frameLighting = d.createBuffer({ label: 'cloud frame lighting', size: CLOUD_FRAME_BYTES, usage: GPUBufferUsage.STORAGE });
    this.precomputeStage = stage('cloud lighting precompute', 'sky/cloud_precompute.wgsl', [sampler(0), tex(1), uniform(5), tex(40), lighting('storage')]);
    this.marchStage = stage('cloud march', 'sky/cloud_march.wgsl', [
      sampler(0), tex(1), store(3), uniform(5), tex(6, '3d'), tex(7, '3d'), sampler(8), tex(40), tex(41, '3d'), lighting('read-only-storage'),
    ]);
    this.resolveStage = stage('cloud resolve', 'sky/cloud_resolve.wgsl', [sampler(0), store(3), uniform(5), tex(9), tex(10)]);
    this.shadowStage = stage('cloud shadow', 'sky/cloud_shadow.wgsl', [store(3), uniform(5), tex(6, '3d'), tex(7, '3d'), sampler(8)]);
    this.noiseSampler = d.createSampler({
      label: 'cloud noise', addressModeU: 'repeat', addressModeV: 'repeat', addressModeW: 'repeat', magFilter: 'linear', minFilter: 'linear',
    });
    this.shadow = d.createTexture({
      label: 'cloud shadow', format: 'rgba16float', size: [CLOUD_SHADOW_SIZE, CLOUD_SHADOW_SIZE],
      usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.STORAGE_BINDING,
    });
    this.shadowView = this.shadow.createView();
    this.prepare();
  }

  /** The resolved cloud layer of the latest encode() (rgb = in-scattered nits, a = transmittance). */
  resolvedView(): GPUTextureView {
    return this.res!.historyViews[this.resolvedIndex];
  }

  /**
   * Encodes the cloud passes. With clouds off the stages run once more to leave an empty layer and an all-lit shadow map, then are
   * skipped until clouds return (the history restarts then).
   */
  encode(enc: GPUCommandEncoder, enabled: boolean): void {
    if (!enabled && this.idle) return;
    this.prepare();
    const r = this.res!, g = this.groups!;
    // Recompute even on a same-frame capture: the LUTs and uniforms belong to this encode.
    // Dispatch boundaries preserve precompute -> march -> resolve resource dependencies.
    const pass = enc.beginComputePass({ label: 'atmosphere clouds' });
    this.dispatch(pass, this.precomputeStage, g.precompute, 1, 1);
    this.dispatch(pass, this.marchStage, g.march, Math.ceil(r.width / 8), Math.ceil(r.height / 8));
    this.dispatch(pass, this.resolveStage, g.resolve[this.parity], Math.ceil(r.width / 8), Math.ceil(r.height / 8));
    this.dispatch(pass, this.shadowStage, g.shadow, CLOUD_SHADOW_SIZE / 8, CLOUD_SHADOW_SIZE / 8);
    pass.end();
    this.resolvedIndex = this.parity;
    this.parity = 1 - this.parity;
    this.frameIndex++;
    this.idle = !enabled;
    this.historyValid = enabled;
  }

  destroy(): void {
    this.release();
    this.shadow.destroy();
    this.frameLighting.destroy();
  }

  private dispatch(pass: GPUComputePassEncoder, s: Stage, group: GPUBindGroup, x: number, y: number): void {
    pass.setPipeline(s.pipeline);
    pass.setBindGroup(0, this.rc.frame.group);
    pass.setBindGroup(1, group);
    pass.dispatchWorkgroups(x, y);
  }

  private targetSize(): { width: number; height: number } {
    const g = this.rc.gbuf, div = this.rc.quality.tier === 'low' ? 4 : 2;
    return { width: Math.max(1, Math.ceil(g.width / div)), height: Math.max(1, Math.ceil(g.height / div)) };
  }

  private release(): void {
    const r = this.res;
    if (!r) return;
    r.march.destroy();
    r.history[0].destroy();
    r.history[1].destroy();
    this.res = null;
  }

  /**
   * Recreates the result textures for a new render size, and the bind groups whenever any texture they name changed. Call it before
   * writing the frame's uniforms so historyValid describes the textures this frame's encode() will use.
   */
  prepare(): void {
    const size = this.targetSize();
    if (!this.res || this.res.width !== size.width || this.res.height !== size.height) {
      this.release();
      const make = (label: string): GPUTexture => this.rc.device.createTexture({
        label, format: 'rgba16float', size: [size.width, size.height], usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.STORAGE_BINDING,
      });
      const march = make('cloud march'), h0 = make('cloud history 0'), h1 = make('cloud history 1');
      this.res = {
        ...size, march, history: [h0, h1], marchView: march.createView(), historyViews: [h0.createView(), h1.createView()],
      };
      this.historyValid = false;
      this.idle = false;
      this.parity = 0;
    }
    const t = this.rc.world.tex, b = this.groupsFor;
    if (b && this.groups && b.res === this.res && b.t === t.transmittance && b.s === t.skyView && b.a === t.aerialPerspective) return;
    this.groupsFor = { t: t.transmittance, s: t.skyView, a: t.aerialPerspective, res: this.res };
    this.groups = this.createGroups(this.res);
  }

  private createGroups(r: Resources): { precompute: GPUBindGroup; march: GPUBindGroup; resolve: [GPUBindGroup, GPUBindGroup]; shadow: GPUBindGroup } {
    const d = this.rc.device, w = this.rc.world, t = w.tex;
    const params = { buffer: this.params };
    const noise = this.noise;
    const resolve = (write: number): GPUBindGroup => d.createBindGroup({
      label: 'cloud resolve', layout: this.resolveStage.layout,
      entries: [
        { binding: 0, resource: w.samplers.linearClamp }, { binding: 3, resource: r.historyViews[write] }, { binding: 5, resource: params },
        { binding: 9, resource: r.marchView }, { binding: 10, resource: r.historyViews[1 - write] },
      ],
    });
    return {
      precompute: d.createBindGroup({
        label: 'cloud lighting precompute', layout: this.precomputeStage.layout,
        entries: [
          { binding: 0, resource: w.samplers.linearClamp }, { binding: 1, resource: t.transmittance.createView() },
          { binding: 5, resource: params }, { binding: 40, resource: t.skyView.createView() },
          { binding: 11, resource: { buffer: this.frameLighting } },
        ],
      }),
      march: d.createBindGroup({
        label: 'cloud march', layout: this.marchStage.layout,
        entries: [
          { binding: 0, resource: w.samplers.linearClamp }, { binding: 1, resource: t.transmittance.createView() }, { binding: 3, resource: r.marchView },
          { binding: 5, resource: params }, { binding: 6, resource: noise.shapeView }, { binding: 7, resource: noise.detailView },
          { binding: 8, resource: this.noiseSampler }, { binding: 40, resource: t.skyView.createView() },
          { binding: 41, resource: t.aerialPerspective.createView({ dimension: '3d' }) },
          { binding: 11, resource: { buffer: this.frameLighting } },
        ],
      }),
      resolve: [resolve(0), resolve(1)],
      shadow: d.createBindGroup({
        label: 'cloud shadow', layout: this.shadowStage.layout,
        entries: [
          { binding: 3, resource: this.shadowView }, { binding: 5, resource: params }, { binding: 6, resource: noise.shapeView },
          { binding: 7, resource: noise.detailView }, { binding: 8, resource: this.noiseSampler },
        ],
      }),
    };
  }
}

import type { RenderContext } from '../contracts';
import { LUNAR_ROWS } from './celestial';
import { AP_SLICES, MULTISCATTER_SIZE, SKYVIEW_SIZE, TRANSMITTANCE_SIZE } from './physics';
import { ATMOS_PARAM_BYTES } from './uniforms';

interface Stage {
  layout: GPUBindGroupLayout;
  pipeline: GPUComputePipeline;
  group: GPUBindGroup | null;
}

/**
 * The atmosphere LUT compute stages. Every stage binds its OWN group 1 (never rc.world.group): the LUTs they write are also part of the
 * world group, and a texture may not be sampled and written inside one dispatch. Sun light, moon light and the night sky are baked
 * into private textures (skySun, skyMoon); the world's skyView LUT gets the sun map plus the moon's map symmetrised over azimuth.
 */
export class AtmosphereLuts {
  readonly skySun: GPUTexture;
  readonly skyMoon: GPUTexture;
  readonly params: GPUBuffer;
  private readonly views: { sun: GPUTextureView; moon: GPUTextureView };
  private readonly transmittance: Stage;
  private readonly multiScatter: Stage;
  private readonly moonView: Stage;
  private readonly sunView: Stage;
  private readonly aerial: Stage;
  private bound: { t: GPUTexture; m: GPUTexture; s: GPUTexture; a: GPUTexture } | null = null;
  private baked = false;

  constructor(private readonly rc: RenderContext) {
    const d = rc.device, C = GPUShaderStage.COMPUTE;
    const usage = GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.STORAGE_BINDING;
    const lut = (label: string) => d.createTexture({ label, format: 'rgba16float', size: [SKYVIEW_SIZE.width, SKYVIEW_SIZE.height], usage });
    this.skySun = lut('skySun');
    this.skyMoon = lut('skyMoon');
    this.views = { sun: this.skySun.createView(), moon: this.skyMoon.createView() };
    this.params = d.createBuffer({ label: 'atmosphere params', size: ATMOS_PARAM_BYTES, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });

    const sampler = (binding: number): GPUBindGroupLayoutEntry => ({ binding, visibility: C, sampler: { type: 'filtering' } });
    const tex = (binding: number): GPUBindGroupLayoutEntry => ({ binding, visibility: C, texture: { sampleType: 'float' } });
    const store = (binding: number, viewDimension: GPUTextureViewDimension = '2d'): GPUBindGroupLayoutEntry =>
      ({ binding, visibility: C, storageTexture: { access: 'write-only', format: 'rgba16float', viewDimension } });
    const uniform = (binding: number): GPUBindGroupLayoutEntry => ({ binding, visibility: C, buffer: { type: 'uniform' } });
    const defs = { MARIA_ROWS: LUNAR_ROWS };
    const stage = (label: string, path: string, entries: GPUBindGroupLayoutEntry[], defines: Record<string, string | number | boolean> = {}): Stage => {
      const layout = d.createBindGroupLayout({ label, entries });
      const pipeline = d.createComputePipeline({
        label,
        layout: d.createPipelineLayout({ bindGroupLayouts: [rc.frame.layout, layout] }),
        compute: { module: rc.module(path, { ...defs, ...defines }), entryPoint: 'main' },
      });
      return { layout, pipeline, group: null };
    };
    this.transmittance = stage('atmosphere transmittance', 'sky/transmittance.wgsl', [store(3)]);
    this.multiScatter = stage('atmosphere multi-scatter', 'sky/multiscatter.wgsl', [sampler(0), tex(1), store(3)]);
    this.moonView = stage('atmosphere sky-view moon', 'sky/skyview.wgsl', [sampler(0), tex(1), tex(2), store(3), uniform(5)], { MOON_PASS: true });
    this.sunView = stage('atmosphere sky-view sun', 'sky/skyview.wgsl', [sampler(0), tex(1), tex(2), store(3), store(4), uniform(5), tex(6)]);
    this.aerial = stage('atmosphere aerial', 'sky/aerial.wgsl', [sampler(0), tex(1), tex(2), store(3, '3d'), uniform(5)]);
    this.bindGroups();
  }

  /** Bakes the transmittance and multiple-scattering LUTs once (constants of the atmosphere; frame.sky.xy must be valid). */
  bake(enc: GPUCommandEncoder): void {
    if (this.baked) return;
    this.baked = true;
    this.bindGroups();
    this.dispatch(enc, this.transmittance, TRANSMITTANCE_SIZE.width / 8, TRANSMITTANCE_SIZE.height / 8);
    this.dispatch(enc, this.multiScatter, MULTISCATTER_SIZE, MULTISCATTER_SIZE);
  }

  /** Per-frame LUTs: moon sky-view (only while its light matters), sun sky-view + night sky, then the aerial-perspective froxels. */
  encode(enc: GPUCommandEncoder, moonActive: boolean): void {
    this.bindGroups();
    const gx = Math.ceil(SKYVIEW_SIZE.width / 8), gy = Math.ceil(SKYVIEW_SIZE.height / 8);
    if (moonActive) this.dispatch(enc, this.moonView, gx, gy);
    this.dispatch(enc, this.sunView, gx, gy);
    this.dispatch(enc, this.aerial, AP_SLICES / 8, AP_SLICES / 8);
  }

  destroy(): void {
    this.skySun.destroy();
    this.skyMoon.destroy();
    this.params.destroy();
  }

  private dispatch(enc: GPUCommandEncoder, s: Stage, x: number, y: number): void {
    const pass = enc.beginComputePass({ label: 'atmosphere lut' });
    pass.setPipeline(s.pipeline);
    pass.setBindGroup(0, this.rc.frame.group);
    pass.setBindGroup(1, s.group!);
    pass.dispatchWorkgroups(x, y);
    pass.end();
  }

  /** (Re)creates the per-stage bind groups whenever the world's LUT textures were replaced. */
  private bindGroups(): void {
    const w = this.rc.world, t = w.tex, b = this.bound;
    if (b && b.t === t.transmittance && b.m === t.multiScatter && b.s === t.skyView && b.a === t.aerialPerspective) return;
    this.bound = { t: t.transmittance, m: t.multiScatter, s: t.skyView, a: t.aerialPerspective };
    const d = this.rc.device;
    const tv = t.transmittance.createView(), mv = t.multiScatter.createView(), sv = t.skyView.createView();
    const av = t.aerialPerspective.createView({ dimension: '3d' });
    const sampler = w.samplers.linearClamp;
    const params = { buffer: this.params };
    const make = (s: Stage, entries: GPUBindGroupEntry[]): void => { s.group = d.createBindGroup({ layout: s.layout, entries }); };
    make(this.transmittance, [{ binding: 3, resource: tv }]);
    make(this.multiScatter, [{ binding: 0, resource: sampler }, { binding: 1, resource: tv }, { binding: 3, resource: mv }]);
    make(this.moonView, [{ binding: 0, resource: sampler }, { binding: 1, resource: tv }, { binding: 2, resource: mv }, { binding: 3, resource: this.views.moon }, { binding: 5, resource: params }]);
    make(this.sunView, [
      { binding: 0, resource: sampler }, { binding: 1, resource: tv }, { binding: 2, resource: mv }, { binding: 3, resource: this.views.sun },
      { binding: 4, resource: sv }, { binding: 5, resource: params }, { binding: 6, resource: this.views.moon },
    ]);
    make(this.aerial, [{ binding: 0, resource: sampler }, { binding: 1, resource: tv }, { binding: 2, resource: mv }, { binding: 3, resource: av }, { binding: 5, resource: params }]);
  }
}

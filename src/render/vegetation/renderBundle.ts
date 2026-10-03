import { DEPTH_STATE, GBUFFER_TARGETS, type RenderContext } from '../contracts';

/** Commands are static, but the buffers they reference (uniforms, instances and indirect arguments) remain GPU-dynamic. */
export class VegetationRenderBundle {
  private bundles: GPURenderBundle[] | null = null;
  private device: GPUDevice | null = null;
  private frame: GPUBindGroup | null = null;
  private world: GPUBindGroup | null = null;
  private frameLayout: GPUBindGroupLayout | null = null;
  private worldLayout: GPUBindGroupLayout | null = null;

  /** Resource owners call this before replacing/destroying any system, buffer, bind group or pipeline. */
  invalidate(): void {
    this.bundles = null;
    this.device = null;
    this.frame = this.world = null;
    this.frameLayout = this.worldLayout = null;
  }

  encode(pass: GPURenderPassEncoder, rc: RenderContext, draw: (encoder: GPURenderBundleEncoder) => void): void {
    if (!this.bundles || this.device !== rc.device || this.frame !== rc.frame.group || this.world !== rc.world.group
      || this.frameLayout !== rc.frame.layout || this.worldLayout !== rc.world.layout) {
      const encoder = rc.device.createRenderBundleEncoder({
        label: 'vegetation-gbuffer',
        colorFormats: GBUFFER_TARGETS.map(target => target.format),
        depthStencilFormat: DEPTH_STATE.format,
        // The G-buffer textures and vegetation pipelines both use the default sample count (1).
        sampleCount: 1,
      });
      encoder.setBindGroup(0, rc.frame.group);
      encoder.setBindGroup(1, rc.world.group);
      draw(encoder);
      this.bundles = [encoder.finish()];
      this.device = rc.device;
      this.frame = rc.frame.group;
      this.world = rc.world.group;
      this.frameLayout = rc.frame.layout;
      this.worldLayout = rc.world.layout;
    }
    pass.executeBundles(this.bundles);
    // executeBundles clears ALL pass bindings. Later modules rely on these shared groups being bound.
    pass.setBindGroup(0, rc.frame.group);
    pass.setBindGroup(1, rc.world.group);
  }
}

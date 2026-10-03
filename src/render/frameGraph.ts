import type { FrameInfo, GBuffer, PostProcessor, RenderContext } from './contracts';
import type { DeferredLighting } from './lighting';
import { MARK, type GpuTimer } from './gpuTimer';
import type { ModuleHost } from './moduleHost';

export interface PostParams { outWidth: number; outHeight: number; preExposure: number; prevPreExposure: number }

// octEncode(+Y) = (0.5, 1); roughness 1, metalness 0, so uncovered pixels shade as a rough dielectric facing up.
const NORMAL_CLEAR: GPUColor = [0.5, 1, 1, 0];
const BLEND_DEFAULT: GPUColor = [0, 0, 0, 0];

/**
 * The fixed pass order of a frame (see contracts.ts). Pass descriptors are built once per G-buffer allocation and reused, so
 * recording a frame allocates nothing. Render-pass hooks get group 0 (frame) and group 1 (world) pre-bound.
 */
export class FrameGraph {
  private gbufferPass!: GPURenderPassDescriptor;
  private skyPass!: GPURenderPassDescriptor;
  private forwardPass!: GPURenderPassDescriptor;
  private overlayPass!: GPURenderPassDescriptor;
  private width = 0;
  private height = 0;

  /** Rebuild the descriptors for a new G-buffer. */
  bind(g: GBuffer): void {
    const v = g.views;
    this.width = g.width;
    this.height = g.height;
    const color = (view: GPUTextureView, clearValue: GPUColor): GPURenderPassColorAttachment => ({ view, clearValue, loadOp: 'clear', storeOp: 'store' });
    this.gbufferPass = {
      label: 'gbuffer',
      colorAttachments: [color(v.albedo, [0, 0, 0, 1]), color(v.normal, NORMAL_CLEAR), color(v.misc, [0, 0, 0, 0]), color(v.motion, [0, 0, 0, 0])],
      depthStencilAttachment: { view: v.depth, depthClearValue: 0, depthLoadOp: 'clear', depthStoreOp: 'store' },
    };
    const overlay = (label: string): GPURenderPassDescriptor => ({
      label,
      colorAttachments: [{ view: v.hdr, loadOp: 'load', storeOp: 'store' }],
      depthStencilAttachment: { view: v.depth, depthReadOnly: true },
    });
    this.skyPass = overlay('sky');
    this.forwardPass = overlay('forward');
    this.overlayPass = overlay('sky + forward');
  }

  encode(
    enc: GPUCommandEncoder, rc: RenderContext, host: ModuleHost, lighting: DeferredLighting, post: PostProcessor,
    timer: GpuTimer, f: FrameInfo, target: GPUTextureView, o: PostParams,
  ): void {
    timer.mark(enc, MARK.FrameBegin);
    host.encodePre(enc, rc, f);
    timer.mark(enc, MARK.PreEnd);

    const gp = enc.beginRenderPass(this.gbufferPass);
    this.bindShared(gp, rc);
    host.encodeGBuffer(gp, rc, f);
    gp.end();
    timer.mark(enc, MARK.GBufferEnd);

    if (host.tracesRays) host.encodeRT(enc, rc, f);
    timer.mark(enc, MARK.RtEnd);

    lighting.encode(enc);
    timer.mark(enc, MARK.LightingEnd);

    if (host.drawsSky && host.drawsForward && host.sharedOverlayPass) {
      // Keep HDR resident across both stages: one load/store pair instead of two. This removes a nominal
      // 16 bytes/pixel of rgba16float attachment traffic; actual bandwidth savings are backend-dependent.
      const pass = enc.beginRenderPass(this.overlayPass);
      this.bindShared(pass, rc);
      host.encodeSky(pass, rc, f);
      // Match a new pass's dynamic-state defaults. Forward draws set their own pipeline and used buffers.
      pass.setViewport(0, 0, this.width, this.height, 0, 1);
      pass.setScissorRect(0, 0, this.width, this.height);
      pass.setBlendConstant(BLEND_DEFAULT);
      pass.setStencilReference(0);
      this.bindShared(pass, rc);
      host.encodeForward(pass, rc, f);
      pass.end();
    } else {
      if (host.drawsSky) {
        const sp = enc.beginRenderPass(this.skyPass);
        this.bindShared(sp, rc);
        host.encodeSky(sp, rc, f);
        sp.end();
      }
      if (host.drawsForward) {
        const fp = enc.beginRenderPass(this.forwardPass);
        this.bindShared(fp, rc);
        host.encodeForward(fp, rc, f);
        fp.end();
      }
    }
    timer.mark(enc, MARK.OverlayEnd);

    post.encode(enc, rc, f, target, o);
  }

  private bindShared(pass: GPURenderPassEncoder, rc: RenderContext): void {
    pass.setBindGroup(0, rc.frame.group);
    pass.setBindGroup(1, rc.world.group);
  }
}

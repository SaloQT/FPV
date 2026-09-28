// STUB: replaced by wave-2 agent; must keep this export
import type { FrameInfo, PostProcessor, RenderContext } from '../contracts';

// hdr is already pre-exposed, so mid-grey lands near 0.25 before the curve; this only trims it for display.
const WGSL = /* wgsl */ `
@group(0) @binding(0) var hdrTex : texture_2d<f32>;
@group(0) @binding(1) var hdrSampler : sampler;
const EXPOSURE : f32 = 0.75;

struct VsOut { @builtin(position) pos : vec4f, @location(0) uv : vec2f };

@vertex fn vs(@builtin(vertex_index) i : u32) -> VsOut {
  let p = vec2f(f32((i << 1u) & 2u), f32(i & 2u));
  return VsOut(vec4f(p * 2.0 - 1.0, 0.0, 1.0), vec2f(p.x, 1.0 - p.y));
}

fn aces(x : vec3f) -> vec3f {
  return clamp((x * (2.51 * x + 0.03)) / (x * (2.43 * x + 0.59) + 0.14), vec3f(0.0), vec3f(1.0));
}

fn srgb(x : vec3f) -> vec3f {
  return select(1.055 * pow(x, vec3f(1.0 / 2.4)) - 0.055, 12.92 * x, x <= vec3f(0.0031308));
}

@fragment fn fs(in : VsOut) -> @location(0) vec4f {
  let c = textureSampleLevel(hdrTex, hdrSampler, in.uv, 0.0).rgb * EXPOSURE;
  return vec4f(srgb(aces(c)), 1.0);
}
`;

export function createPostProcessor(): PostProcessor {
  let pipeline: GPURenderPipeline;
  let sampler: GPUSampler;
  let group: GPUBindGroup;

  return {
    init(rc: RenderContext) {
      const module = rc.device.createShaderModule({ label: 'post stub', code: WGSL });
      pipeline = rc.device.createRenderPipeline({
        label: 'post stub',
        layout: 'auto',
        vertex: { module, entryPoint: 'vs' },
        fragment: { module, entryPoint: 'fs', targets: [{ format: rc.canvasFormat }] },
      });
      sampler = rc.device.createSampler({ magFilter: 'linear', minFilter: 'linear' });
    },
    resize(rc: RenderContext) {
      group = rc.device.createBindGroup({
        layout: pipeline.getBindGroupLayout(0),
        entries: [{ binding: 0, resource: rc.gbuf.views.hdr }, { binding: 1, resource: sampler }],
      });
    },
    encode(enc: GPUCommandEncoder, _rc: RenderContext, _f: FrameInfo, target: GPUTextureView) {
      const pass = enc.beginRenderPass({ colorAttachments: [{ view: target, loadOp: 'clear', storeOp: 'store', clearValue: [0, 0, 0, 1] }] });
      pass.setPipeline(pipeline);
      pass.setBindGroup(0, group);
      pass.draw(3);
      pass.end();
    },
  };
}

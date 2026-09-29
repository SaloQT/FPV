// Dual-filter bloom pyramid (Jimenez, "Next Generation Post Processing in Call of Duty: Advanced Warfare", SIGGRAPH 2014).
// Down: 13 bilinear taps = five overlapping 2x2 boxes (weights sum to 1). Up: 9-tap tent (1 2 1 / 2 4 2 / 1 2 1) / 16.
// The first downsample averages its five boxes with Karis weights 1 / (1 + luma) so a single fp16 firefly cannot flood the pyramid.
// Every pass renders one fullscreen triangle into one pyramid level; level weights are applied by the blend state (see bloom.ts).
@group(0) @binding(0) var srcTex : texture_2d<f32>;
@group(0) @binding(1) var srcSampler : sampler;

// gbuf.hdr is clamped to this by lighting; anything above (or an Inf) is a defect, not light.
const HDR_MAX : f32 = 60000.0;

struct VsOut {
  @builtin(position) pos : vec4f,
  @location(0) uv : vec2f,
};

@vertex fn vs(@builtin(vertex_index) i : u32) -> VsOut {
  let p = vec2f(f32((i << 1u) & 2u), f32(i & 2u));
  return VsOut(vec4f(p * 2.0 - 1.0, 0.0, 1.0), vec2f(p.x, 1.0 - p.y));
}

fn tap(uv : vec2f, o : vec2f, ts : vec2f) -> vec3f {
  return textureSampleLevel(srcTex, srcSampler, uv + o * ts, 0.0).rgb;
}

fn tapSafe(uv : vec2f, o : vec2f, ts : vec2f) -> vec3f {
  return clamp(tap(uv, o, ts), vec3f(0.0), vec3f(HDR_MAX));
}

fn luma(c : vec3f) -> f32 {
  return dot(c, vec3f(0.2126, 0.7152, 0.0722));
}

@fragment fn fs_down(in : VsOut) -> @location(0) vec4f {
  let ts = 1.0 / vec2f(textureDimensions(srcTex));
  let uv = in.uv;
  let a = tap(uv, vec2f(-2.0, 2.0), ts);
  let b = tap(uv, vec2f(0.0, 2.0), ts);
  let c = tap(uv, vec2f(2.0, 2.0), ts);
  let d = tap(uv, vec2f(-2.0, 0.0), ts);
  let e = tap(uv, vec2f(0.0, 0.0), ts);
  let f = tap(uv, vec2f(2.0, 0.0), ts);
  let g = tap(uv, vec2f(-2.0, -2.0), ts);
  let h = tap(uv, vec2f(0.0, -2.0), ts);
  let i = tap(uv, vec2f(2.0, -2.0), ts);
  let j = tap(uv, vec2f(-1.0, 1.0), ts);
  let k = tap(uv, vec2f(1.0, 1.0), ts);
  let l = tap(uv, vec2f(-1.0, -1.0), ts);
  let m = tap(uv, vec2f(1.0, -1.0), ts);
  let col = e * 0.125 + (a + c + g + i) * 0.03125 + (b + d + f + h) * 0.0625 + (j + k + l + m) * 0.125;
  return vec4f(col, 0.0);
}

@fragment fn fs_down_karis(in : VsOut) -> @location(0) vec4f {
  let ts = 1.0 / vec2f(textureDimensions(srcTex));
  let uv = in.uv;
  let a = tapSafe(uv, vec2f(-2.0, 2.0), ts);
  let b = tapSafe(uv, vec2f(0.0, 2.0), ts);
  let c = tapSafe(uv, vec2f(2.0, 2.0), ts);
  let d = tapSafe(uv, vec2f(-2.0, 0.0), ts);
  let e = tapSafe(uv, vec2f(0.0, 0.0), ts);
  let f = tapSafe(uv, vec2f(2.0, 0.0), ts);
  let g = tapSafe(uv, vec2f(-2.0, -2.0), ts);
  let h = tapSafe(uv, vec2f(0.0, -2.0), ts);
  let i = tapSafe(uv, vec2f(2.0, -2.0), ts);
  let j = tapSafe(uv, vec2f(-1.0, 1.0), ts);
  let k = tapSafe(uv, vec2f(1.0, 1.0), ts);
  let l = tapSafe(uv, vec2f(-1.0, -1.0), ts);
  let m = tapSafe(uv, vec2f(1.0, -1.0), ts);
  let g0 = (a + b + d + e) * 0.25;
  let g1 = (b + c + e + f) * 0.25;
  let g2 = (d + e + g + h) * 0.25;
  let g3 = (e + f + h + i) * 0.25;
  let g4 = (j + k + l + m) * 0.25;
  let w0 = 0.125 / (1.0 + luma(g0));
  let w1 = 0.125 / (1.0 + luma(g1));
  let w2 = 0.125 / (1.0 + luma(g2));
  let w3 = 0.125 / (1.0 + luma(g3));
  let w4 = 0.5 / (1.0 + luma(g4));
  let col = (g0 * w0 + g1 * w1 + g2 * w2 + g3 * w3 + g4 * w4) / (w0 + w1 + w2 + w3 + w4);
  return vec4f(col, 0.0);
}

@fragment fn fs_up(in : VsOut) -> @location(0) vec4f {
  let ts = 1.0 / vec2f(textureDimensions(srcTex));
  let uv = in.uv;
  let corners = tap(uv, vec2f(-1.0, 1.0), ts) + tap(uv, vec2f(1.0, 1.0), ts) + tap(uv, vec2f(-1.0, -1.0), ts) + tap(uv, vec2f(1.0, -1.0), ts);
  let edges = tap(uv, vec2f(0.0, 1.0), ts) + tap(uv, vec2f(-1.0, 0.0), ts) + tap(uv, vec2f(1.0, 0.0), ts) + tap(uv, vec2f(0.0, -1.0), ts);
  let centre = tap(uv, vec2f(0.0, 0.0), ts);
  return vec4f(corners * 0.0625 + edges * 0.125 + centre * 0.25, 0.0);
}

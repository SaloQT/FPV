// Final fullscreen pass: lens + rolling shutter resample, chroma bleed, bloom mix, exposure, vignette, sensor noise, filmic tonemap,
// grade, video-link artifacts, dither and the display encode. At most 8 filtered taps: 3 (chromatic aberration, 1 when the lens is off),
// 2 (edge softness), 2 (chroma bleed), 1 (bloom). Everything else is arithmetic on registers.
// Defines: DITHER_LSB (one output code step, 0 = no dither), OUT_HW_SRGB (target format is *-srgb: hardware does the OETF).
#include "post/lens.wgsl"
#include "post/tonemap.wgsl"
#include "post/video.wgsl"

struct Params {
  size : vec4f,     // width, height, 1/width, 1/height
  lens : vec4f,     // k1, k2, zoom (1 + k1 + k2), chromatic aberration edge displacement / half diagonal
  look : vec4f,     // vignette strength, edge softness px at the corner, bloom mix (0 = off), noise amplitude
  shutter : vec4f,  // camera angular velocity xyz (rad/s, camera frame), focal length in pixels
  jello : vec4f,    // amplitude px, phase at frame centre, phase per unit v, readout time (s)
  video : vec4f,    // videoNoise, unused
  seed : vec4u,     // frame index, debug mode
};

@group(0) @binding(0) var resolvedTex : texture_2d<f32>;
@group(0) @binding(1) var bloomTex : texture_2d<f32>;
@group(0) @binding(2) var samp : sampler;
struct Exposure {
  ratio : vec4f,  // ratio, sensor gain EV over daylight, metered mean EV, total EV
  look : vec4f,   // highlight knee (scene-linear after the ratio, 1e12 = off), roll-off strength 0..1
};
@group(0) @binding(3) var<uniform> exposure : Exposure;
@group(0) @binding(4) var<uniform> P : Params;

const HDR_MAX : f32 = 60000.0;
const DITHER_LSB : f32 = ${DITHER_LSB};

struct VsOut {
  @builtin(position) pos : vec4f,
  @location(0) uv : vec2f,
};

@vertex fn vs(@builtin(vertex_index) i : u32) -> VsOut {
  let p = vec2f(f32((i << 1u) & 2u), f32(i & 2u));
  return VsOut(vec4f(p * 2.0 - 1.0, 0.0, 1.0), vec2f(p.x, 1.0 - p.y));
}

fn fetch(uv : vec2f) -> vec3f {
  return min(max(textureSampleLevel(resolvedTex, samp, uv, 0.0).rgb, vec3f(0.0)), vec3f(HDR_MAX));
}

// Blurs are averaged in c / (1 + c) so one HDR highlight cannot swamp its neighbours.
fn squash(c : vec3f) -> vec3f { return c / (vec3f(1.0) + c); }
fn unsquash(c : vec3f) -> vec3f { return c / max(vec3f(1.0) - c, vec3f(1e-4)); }

// Sensor gain EV -6 (blue) .. +12 (red).
fn heatColor(ev : f32) -> vec3f {
  let x = saturate((ev + 6.0) / 18.0);
  return saturate(vec3f(1.5 - abs(4.0 * x - 3.0), 1.5 - abs(4.0 * x - 2.0), 1.5 - abs(4.0 * x - 1.0)));
}

// Resolved image at the lens-mapped position: chromatic aberration, radial edge softness, analog chroma bleed.
fn sceneColor(L : LensCoords, uv : vec2f, size : vec2f, vn : f32) -> vec3f {
  var c = fetch(L.g);
  if (P.lens.w > 0.0) { c = vec3f(fetch(L.r).r, c.g, fetch(L.b).b); }
  let soft = P.look.y * L.rad * L.rad;
  if (soft > 0.01) {
    let o = normalize((uv - 0.5) * size + vec2f(1e-4)) * soft * P.size.zw;
    c = unsquash(0.5 * squash(c) + 0.25 * (squash(fetch(L.g + o)) + squash(fetch(L.g - o))));
  }
  let bleed = videoBleedPx(vn, size.x);
  if (bleed > 0.05) {
    let b = vec2f(bleed * P.size.z, 0.0);
    let c0 = squash(c);
    let c1 = squash(fetch(L.g - b));
    let c2 = squash(fetch(L.g - 2.0 * b));
    let ch = 0.45 * (c0 - lumaOf(c0)) + 0.33 * (c1 - lumaOf(c1)) + 0.22 * (c2 - lumaOf(c2));
    c = unsquash(max(vec3f(lumaOf(c0)) + ch, vec3f(0.0)));
  }
  return c;
}

@fragment fn fs(in : VsOut) -> @location(0) vec4f {
  let size = P.size.xy;
  let pix = in.pos.xy;
  let uv = pix * P.size.zw;
  let frame = P.seed.x;
  let debug = P.seed.y;
  let vn = P.video.x;

  var shift = rollingShift(uv, size, P.shutter.xyz, P.shutter.w, P.jello.w, P.jello);
  shift.x += videoSyncJitterPx(pix.y, frame, vn, size.x);
  let L = lensCoords(uv, size, P.lens.xyz, shift, P.lens.w);

  var c = sceneColor(L, uv, size, vn);
  let bloomMix = P.look.z;
  if (bloomMix > 0.0) {
    let bl = min(max(textureSampleLevel(bloomTex, samp, L.g, 0.0).rgb, vec3f(0.0)), vec3f(HDR_MAX));
    c = select(c * (1.0 - bloomMix) + bl, bl, debug == 3u);
  }
  c *= exposure.ratio.x * lensVignette(L.rad, P.look.x);
  if (P.look.w > 0.0) { c += sensorNoise(c, pix, frame, exposure.ratio.y, P.look.w); }
  c *= L.edge;

  var e = gradeContrast(srgbEncode(tonemap(c, exposure.ratio.y, exposure.look.x, exposure.look.y)));
  if (debug == 2u) { e = mix(e, heatColor(exposure.ratio.y), 0.5); }
  e = videoPost(e, pix, uv, frame, vn);
  e = clamp(e + tpdfDither(pix, frame) * DITHER_LSB, vec3f(0.0), vec3f(1.0));
#ifdef OUT_HW_SRGB
  e = srgbDecode(e);
#endif
  return vec4f(e, 1.0);
}

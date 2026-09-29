// Analog VRX / digital VTX link artifacts. Everything scales with videoNoise (vn): grain and mild chroma bleed early, sync jitter and
// macroblocking in the middle, static bursts above 0.7. Colour work happens in the gamma-encoded domain, where real video is coded.
#include "post/sensor.wgsl"

const VIDEO_REF_WIDTH : f32 = 1280.0;

// Chroma is delayed along the scanline: it smears to the right by this many pixels at full noise.
fn videoBleedPx(vn : f32, width : f32) -> f32 {
  return 3.2 * saturate(vn * 1.2) * width / VIDEO_REF_WIDTH;
}

// Horizontal sync wobble per group of four rows, re-rolled every frame; only in the upper half of the noise range.
fn videoSyncJitterPx(row : f32, frame : u32, vn : f32, width : f32) -> f32 {
  let a = saturate((vn - 0.4) / 0.6);
  let h = unitOpen(pcgHash(u32(row * 0.25) * 2654435761u + frame * 40503u));
  return (h - 0.5) * 4.0 * a * a * width / VIDEO_REF_WIDTH;
}

// 0 = clean, 1 = pure static. A burst covers a band of rows for up to six frames; rarely the whole frame drops out.
fn videoBurstCover(v : f32, frame : u32, vn : f32) -> f32 {
  let p = smoothstep(0.7, 1.0, vn);
  let h = pcg3d(vec3u(frame / 6u, 0x51u, 0x9du));
  let r = unitOpen(h.x);
  let y0 = unitOpen(h.y);
  let y1 = y0 + mix(0.03, 0.35, unitOpen(h.z));
  let band = smoothstep(y0, y0 + 0.004, v) * (1.0 - smoothstep(y1, y1 + 0.004, v));
  let full = select(0.0, 1.0, r >= 0.2 * p && r < 0.2 * p + 0.03 * p);
  return select(0.0, band, r < 0.2 * p) + full;
}

fn videoLuma(e : vec3f) -> f32 { return dot(e, vec3f(0.299, 0.587, 0.114)); }

// 8x8 blocks with a per-block random offset before quantisation: coarse steps in luma, coarser in chroma, plus a small per-block DC error.
fn videoMacroblock(e : vec3f, pix : vec2f, frame : u32, vn : f32) -> vec3f {
  let m = smoothstep(0.5, 1.0, vn);
  if (m <= 0.0) { return e; }
  let h = pcg3d(vec3u(vec2u(pix) / 8u, frame / 5u));
  let ly = mix(256.0, 24.0, m);
  let lc = mix(256.0, 10.0, m * m);
  let y = videoLuma(e) + (unitOpen(h.z) - 0.5) * 0.03 * m;
  let yq = floor(y * ly + unitOpen(h.x)) / ly;
  let cq = floor((e - videoLuma(e)) * lc + vec3f(unitOpen(h.y))) / lc;
  return yq + cq;
}

// Scanline shimmer, block artifacts and static bursts on the encoded colour `e` of output pixel `pix` (uv = pix / size).
fn videoPost(e : vec3f, pix : vec2f, uv : vec2f, frame : u32, vn : f32) -> vec3f {
  let shimmer = 1.0 + vn * (0.06 * (unitOpen(pcgHash(u32(pix.y) + frame * 2246822519u)) - 0.5) - 0.02 * f32(u32(pix.y) & 1u));
  var o = videoMacroblock(e * shimmer, pix, frame, vn);
  let cover = videoBurstCover(uv.y, frame, vn);
  if (cover > 0.0) {
    let snow = 0.1 + 0.75 * unitOpen(pcg3d(vec3u(vec2u(pix) / vec2u(2u, 1u), frame)).x);
    o = mix(o, vec3f(snow), saturate(cover) * 0.9);
  }
  return o;
}

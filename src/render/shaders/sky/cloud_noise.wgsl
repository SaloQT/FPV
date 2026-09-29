// Cloud noise bake, run once at init into rgba8unorm 3D textures (Schneider, "The Real-Time Volumetric Cloudscapes of Horizon Zero
// Dawn", 2015). Every lattice wraps at its period, so both textures tile seamlessly and are sampled with a repeating sampler.
//   SHAPE  (128^3): r = Perlin-Worley (Perlin fbm pushed up by Worley so its bulges read as puffs), g, b, a = inverted Worley at
//                   4, 8 and 16 cells across (the low-frequency fbm the density shader weighs 0.625 / 0.25 / 0.125).
//   DETAIL (32^3) : r, g, b = inverted Worley at 4, 8 and 16 cells across (the erosion fbm), a = 1.
// No units: the values are unit-range noise; the density shader gives them meaning. Group 1 binding 0 is the output texture; group 0
// is the frame block that common/math.wgsl names (bound but not read here).
#include "common/math.wgsl"
#include "common/frame.wgsl"

@group(1) @binding(0) var outTex : texture_storage_3d<rgba8unorm, write>;

fn wrapCell(c : vec3i, period : i32) -> vec3u {
  return vec3u(((c % vec3i(period)) + vec3i(period)) % vec3i(period));
}

fn cellHash(c : vec3i, period : i32) -> vec3u {
  return pcg3(wrapCell(c, period) + vec3u(0x9e3779b9u, 0x85ebca6bu, 0xc2b2ae35u));
}

fn fade(f : vec3f) -> vec3f { return f * f * f * (f * (f * 6.0 - 15.0) + 10.0); }

fn gradientDot(c : vec3i, period : i32, d : vec3f) -> f32 {
  let h = cellHash(c, period);
  let g = vec3f(u01(h.x), u01(h.y), u01(h.z)) * 2.0 - 1.0;
  return dot(g / max(length(g), 1e-3), d);
}

// Gradient noise with a lattice of `period` cells; result in about [-1, 1].
fn perlin(p : vec3f, period : i32) -> f32 {
  let b = floor(p);
  let i = vec3i(b);
  let f = p - b;
  let u = fade(f);
  let x00 = mix(gradientDot(i, period, f), gradientDot(i + vec3i(1, 0, 0), period, f - vec3f(1.0, 0.0, 0.0)), u.x);
  let x10 = mix(gradientDot(i + vec3i(0, 1, 0), period, f - vec3f(0.0, 1.0, 0.0)), gradientDot(i + vec3i(1, 1, 0), period, f - vec3f(1.0, 1.0, 0.0)), u.x);
  let x01 = mix(gradientDot(i + vec3i(0, 0, 1), period, f - vec3f(0.0, 0.0, 1.0)), gradientDot(i + vec3i(1, 0, 1), period, f - vec3f(1.0, 0.0, 1.0)), u.x);
  let x11 = mix(gradientDot(i + vec3i(0, 1, 1), period, f - vec3f(0.0, 1.0, 1.0)), gradientDot(i + vec3i(1, 1, 1), period, f - vec3f(1.0, 1.0, 1.0)), u.x);
  return 1.15 * mix(mix(x00, x10, u.y), mix(x01, x11, u.y), u.z);
}

// 1 - F1 of a jittered lattice (bright blobs at the feature points), 0..1.
fn worley(p : vec3f, period : i32) -> f32 {
  let b = floor(p);
  let i = vec3i(b);
  let f = p - b;
  var d2 = 4.0;
  for (var z = -1; z <= 1; z++) {
    for (var y = -1; y <= 1; y++) {
      for (var x = -1; x <= 1; x++) {
        let o = vec3i(x, y, z);
        let h = cellHash(i + o, period);
        let q = vec3f(o) + vec3f(u01(h.x), u01(h.y), u01(h.z)) - f;
        d2 = min(d2, dot(q, q));
      }
    }
  }
  return 1.0 - saturate1(sqrt(d2));
}

fn perlinFbm(p : vec3f, period : i32) -> f32 {
  var sum = 0.0;
  var amp = 0.5;
  var norm = 0.0;
  var freq = 1.0;
  for (var o = 0; o < 3; o++) {
    sum += amp * perlin(p * freq, period * i32(freq));
    norm += amp;
    amp *= 0.5;
    freq *= 2.0;
  }
  return saturate1(0.5 + 0.5 * sum / norm);
}

@compute @workgroup_size(4, 4, 4)
fn main(@builtin(global_invocation_id) gid : vec3u) {
  let size = textureDimensions(outTex);
  if (any(gid >= size)) { return; }
  let u = (vec3f(gid) + 0.5) / vec3f(size);
#ifdef SHAPE
  let w4 = worley(u * 4.0, 4);
  let pw = mix(w4, 1.0, perlinFbm(u * 4.0, 4));
  textureStore(outTex, vec3i(gid), vec4f(pw, w4, worley(u * 8.0, 8), worley(u * 16.0, 16)));
#else
  textureStore(outTex, vec3i(gid), vec4f(worley(u * 4.0, 4), worley(u * 8.0, 8), worley(u * 16.0, 16), 1.0));
#endif
}

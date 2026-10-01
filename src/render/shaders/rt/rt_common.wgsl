// Shared by every RT pass. Include with GRP = the bind group index that holds the RtParams uniform (binding 0).
// Packed on the CPU by src/render/rt/params.ts (keep the two in sync).
#include "common/math.wgsl"
#include "common/frame.wgsl"
#include "rt/rt_map.wgsl"

struct RtParams {
  dims : vec4u,       // x,y = RT width,height; z,w = full render width,height
  cfg : vec4u,        // x = divisor, y = max steps, z = GI rays per pixel, w = flags (bit0 specular, bit1 terrain present)
  scene : vec4u,      // x = static BVH root, y = dynamic BVH root (0xffffffff = none), z = BVH node visit cap, w = frame index
  dbg : vec4u,        // x = debug view, y = random seed, z = probe update stride K, w = probe update phase
  probeLo : vec4i,    // xyz = lattice coordinate of the window's first probe, w = probe rays per probe per update
  probePrev : vec4i,  // xyz = same for the previous frame's window, w = 1 -> every probe is new
  probeDim : vec4u,   // xyz = probe grid dimensions
  f : vec4f,          // x = sun cone scale, y = probe spacing (m), z = probe hysteresis, w = GI/specular ray range (m)
  cloud : vec4f,      // x,y = cloud shadow map centre (world xz), z = its side length (m)
};

@group(${GRP}) @binding(0) var<uniform> rp : RtParams;

const NO_NODE : u32 = 0xffffffffu;
const FLAG_SPEC : u32 = 1u;
const FLAG_TERRAIN : u32 = 2u;

fn rtDivisor() -> i32 { return i32(rp.cfg.x); }
fn rtSize() -> vec2i { return vec2i(rp.dims.xy); }
fn fullSize() -> vec2i { return vec2i(rp.dims.zw); }
fn frameIndex() -> u32 { return rp.scene.w; }

// Full-resolution pixel and its pixel-centre uv that RT texel `px` represents this frame.
fn rtSrc(px : vec2i) -> vec2i { return rtSourcePixel(px, rtDivisor(), fullSize(), frameIndex()); }
fn pixelUv(src : vec2i) -> vec2f { return (vec2f(src) + 0.5) * frame.screen.zw; }

// Aux textures store linear view depth in metres (0 = sky).
fn linearDepth(reverseZ : f32) -> f32 { return select(0.0, frame.params.z / reverseZ, reverseZ > 0.0); }
fn worldFromLinear(uv : vec2f, z : f32) -> vec3f { return worldFromDepth(uv, frame.params.z / z); }

// fp16 storage guard (max 65504): clamps into the finite range and turns NaN into 0 (abs(NaN) <= x is false, so the select picks 0).
const FP16_SAFE : f32 = 6.0e4;
fn fp16Safe(v : vec4f) -> vec4f {
  let c = clamp(v, vec4f(-FP16_SAFE), vec4f(FP16_SAFE));
  return select(vec4f(0.0), c, abs(c) <= vec4f(FP16_SAFE));
}

fn keyDir() -> vec4f { return select(frame.sunDir, frame.moonDir, frame.misc.w == 1u); }

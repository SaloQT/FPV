// G-buffer outputs shared by the terrain and water fragment shaders (targets match GBUFFER_TARGETS).
#include "common/world_bindings.wgsl"

struct FsOut {
  @location(0) albedo : vec4f,
  @location(1) normal : vec4f,
  @location(2) misc : vec4f,
  @location(3) motion : vec2f,
};

fn ndcToUv(c : vec4f) -> vec2f { return vec2f(c.x / c.w * 0.5 + 0.5, 0.5 - c.y / c.w * 0.5); }

fn motionVector(w : vec3f) -> vec2f {
  return ndcToUv(frame.prevViewProj * vec4f(w, 1.0)) - ndcToUv(frame.viewProjUnjittered * vec4f(w, 1.0));
}

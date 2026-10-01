// G-buffer outputs shared by the terrain and water fragment shaders (targets match GBUFFER_TARGETS).
#include "common/world_bindings.wgsl"

struct FsOut {
  @location(0) albedo : vec4f,
  @location(1) normal : vec4f,
  @location(2) misc : vec4f,
  @location(3) motion : vec2f,
};

fn ndcToUv(c : vec4f) -> vec2f { return vec2f(c.x / c.w * 0.5 + 0.5, 0.5 - c.y / c.w * 0.5); }

// prevUV - currUV of a surface point that was at `wPrev` last frame and is at `w` now (animated vegetation); a static point passes both equal.
fn motionVectorPrev(w : vec3f, wPrev : vec3f) -> vec2f {
  var p = frame.prevViewProj * vec4f(wPrev, 1.0);
  p.w = max(p.w, 1.0e-3);
  return ndcToUv(p) - ndcToUv(frame.viewProjUnjittered * vec4f(w, 1.0));
}

fn motionVector(w : vec3f) -> vec2f { return motionVectorPrev(w, w); }

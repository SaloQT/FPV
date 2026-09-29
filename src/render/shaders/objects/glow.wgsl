// Forward pass: additive camera-facing glow ribbons along the gate LED strips (a stand-in for bloom so the strips read as light sources).
#include "objects/track_bindings.wgsl"
#include "common/atmosphere_sample.wgsl"

const GLOW_MAX_DISPLAY : f32 = 1.2;

struct GlowOut {
  @builtin(position) pos : vec4f,
  @location(0) side : f32,
  @location(1) @interpolate(flat) gate : u32,
  @location(2) halfWidth : f32,
  @location(3) dist : f32,
};

@vertex fn vsGlow(@location(0) p : vec3f, @location(1) t : vec3f, @location(2) sg : vec2f) -> GlowOut {
  let toCam = frame.camPos.xyz - p;
  let dist = length(toCam);
  let dirCam = toCam / max(dist, 1e-4);
  let r = cross(t, dirCam);
  let rl = length(r);
  let right = select(vec3f(0.0, 1.0, 0.0), r / max(rl, 1e-6), rl > 1e-4);
  let halfWidth = 0.02 + 0.008 * dist;
  var o : GlowOut;
  o.pos = frame.viewProj * vec4f(p + right * (sg.x * halfWidth) + dirCam * 0.012, 1.0);
  o.side = sg.x;
  o.gate = u32(sg.y + 0.5);
  o.halfWidth = halfWidth;
  o.dist = dist;
  return o;
}

@fragment fn fsGlow(in : GlowOut) -> @location(0) vec4f {
  let led = gateLed(in.gate);
  let s2 = in.side * in.side;
  let profile = (1.0 - s2) * (1.0 - s2) * exp(-2.0 * s2);
  let energy = clamp(0.04 / in.halfWidth, 0.25, 1.0);
  let ap = sampleAerialPerspective(in.pos.xy * frame.screen.zw, in.dist);
  // Capped after pre-exposure: in the dark the exposure is huge, and an uncapped halo would clip to white instead of showing the LED colour.
  let shown = min(led.a * EMISSIVE_MAX_NITS * 0.35 * frame.params.y, GLOW_MAX_DISPLAY);
  return vec4f(led.rgb * (shown * profile * energy) * ap.a, 0.0);
}

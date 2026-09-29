// Group 2 of the track pipelines: time and wind, per-gate LED state and the cloth flags.
#include "objects/common.wgsl"

struct TrackU {
  time : vec4f,  // x = simulation time, y = previous frame time, z = dt
  wind : vec4f,  // xy = horizontal direction the air travels toward (unit), z = speed (m/s)
};

struct GateInfo {
  colour : vec4f, // rgb = frame colour
  state : vec4f,  // x = mode (0 idle, 1 active, 2 passed), y = pass flash 1..0
};

struct Flag {
  a : vec4f, // xyz = top of the hoist edge, w = width (m)
  b : vec4f, // rgb = colour, w = height (m)
  c : vec4f, // x = wave seed
};

@group(2) @binding(0) var<uniform> trk : TrackU;
@group(2) @binding(1) var<storage, read> gates : array<GateInfo>;
@group(2) @binding(2) var<storage, read> flags : array<Flag>;

const LED_ACTIVE : vec3f = vec3f(0.05, 0.9, 1.0);
const LED_FLASH : vec3f = vec3f(0.1, 1.0, 0.2);

// rgb = LED colour, a = emissive strength (fraction of EMISSIVE_MAX_NITS) of gate `gi` right now.
fn gateLed(gi : u32) -> vec4f {
  let g = gates[min(gi, arrayLength(&gates) - 1u)];
  var col = mix(g.colour.rgb, vec3f(1.0), 0.2);
  var s = 0.1;
  if (g.state.x > 1.5) {
    s = 0.03;
  } else if (g.state.x > 0.5) {
    col = LED_ACTIVE;
    s = 0.22 + 0.33 * (0.5 + 0.5 * sin(trk.time.x * 5.0));
  }
  let flash = g.state.y;
  return vec4f(mix(col, LED_FLASH, flash), mix(s, 0.6, flash));
}

// Group 2 of the quad pipelines: model matrices, prop angles, LED state, plus the input struct shared by the material functions.
#include "objects/common.wgsl"

struct QuadU {
  model : mat4x4f,
  prevModel : mat4x4f,
  hub : array<vec4f, 4>,    // xyz = motor hub in body coordinates
  prop : array<vec4f, 4>,   // xyz = rotor plane centre in body coordinates
  spin : array<vec4f, 4>,   // x = angle about +Y, y = previous angle (rad), z = solid blade fraction, w = blur disc alpha
  led : array<vec4f, 4>,    // rgb = colour, a = emissive strength (fraction of EMISSIVE_MAX_NITS), rear left / right, front left / right
  sprite : array<vec4f, 5>, // xyz = body space anchor of the four LEDs and the lens glint, w = sprite radius at zero distance
  lens : vec4f,             // xyz = lens axis in body coordinates, w = sun glint strength
};

@group(2) @binding(0) var<uniform> quad : QuadU;

const MAT_QUAD : u32 = 4u;
const MAT_EMISSIVE : u32 = 7u;

struct MatIn {
  p : vec3f,   // body space position (origin at the centre of mass)
  n : vec3f,   // body space unit normal
  uv : vec2f,
  ao : f32,
  a2 : f32,
  kind : u32,
  fp : f32,    // pixel footprint in metres
};

fn quadRot() -> mat3x3f {
  return mat3x3f(quad.model[0].xyz, quad.model[1].xyz, quad.model[2].xyz);
}

// Rotation by a counter-clockwise (seen from above) angle about +Y; matches affineRotY on the CPU.
fn rotY(a : f32) -> mat3x3f {
  let c = cos(a);
  let s = sin(a);
  return mat3x3f(vec3f(c, 0.0, -s), vec3f(0.0, 1.0, 0.0), vec3f(s, 0.0, c));
}

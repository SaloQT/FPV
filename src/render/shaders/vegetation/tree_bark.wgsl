// Procedural bark for the tree shader. Everything is evaluated in mesh space (the tree's own, un-swayed frame) so the pattern stays attached
// to the trunk; the pattern is stretched along the limb axis so fissures run lengthwise. `h` is the plate height: 0 in a crease, 1 on a ridge.
#include "vegetation/veg_noise.wgsl"

const CLASS_OAK : u32 = 0u;
const CLASS_PINE : u32 = 1u;
const CLASS_BIRCH : u32 = 2u;

fn barkHeight(p : vec3f, axis : vec3f, cls : u32, seed : f32, twig : bool) -> f32 {
  let along = dot(p, axis);
  let perp = p - axis * along;
  var q = perp * 13.0 + axis * (along * 2.6);
  if (cls == CLASS_BIRCH) { q = perp * 3.2 + axis * (along * 34.0); }
  if (cls == CLASS_PINE) { q = perp * 8.0 + axis * (along * 1.9); }
  q += vec3f(seed * 13.7, seed * 7.1, seed * 3.3);
  let n1 = vnoise3(q);
  let n2 = vnoise3(q * 2.1 + vec3f(7.7));
  let crease = smoothstep(0.0, 0.34, abs(n1 - 0.5) * 2.0);
  let sub = smoothstep(0.0, 0.45, abs(n2 - 0.5) * 2.0);
  let h = crease * mix(0.65, 1.0, sub);
  return select(h, mix(0.8, h, 0.35), twig);
}

// Lichen: pale grey-green crusts on the plates, in patches a few decimetres wide with a speckled edge.
fn lichen(p : vec3f, h : f32, seed : f32, amount : f32) -> f32 {
  let blotch = vnoise3(p * 3.5 + vec3f(seed * 5.1));
  let speck = vnoise3(p * 38.0 + vec3f(seed));
  return smoothstep(0.66 - 0.2 * amount, 0.8 - 0.2 * amount, blotch + 0.22 * (speck - 0.5)) * smoothstep(0.35, 0.8, h);
}

fn barkAlbedo(h : f32, p : vec3f, cls : u32, height : f32, seed : f32, twig : bool) -> vec3f {
  let tone = 0.75 + 0.5 * vnoise3(p * vec3f(2.0, 0.7, 2.0) + vec3f(seed * 3.0));
  var col : vec3f;
  var lich = 0.0;
  if (cls == CLASS_BIRCH) {
    let paper = vec3f(0.5, 0.48, 0.43) * (0.82 + 0.18 * vnoise3(p * 6.0 + vec3f(seed)));
    let mark = mix(vec3f(0.035, 0.03, 0.026), paper, smoothstep(0.12, 0.55, h));
    let dark = vec3f(0.06, 0.05, 0.042) * (0.55 + 0.9 * h);
    col = mix(mark, dark, select(smoothstep(1.4, 0.4, height), 0.0, twig));
    if (twig) { col = vec3f(0.07, 0.048, 0.036) * (0.6 + 0.6 * h); }
    lich = 0.25;
  } else if (cls == CLASS_PINE) {
    let grey = mix(vec3f(0.028, 0.022, 0.019), vec3f(0.095, 0.07, 0.055), h);
    let flake = mix(vec3f(0.16, 0.07, 0.03), vec3f(0.3, 0.14, 0.055), h);
    col = mix(grey, flake, smoothstep(2.5, 8.0, height) * select(1.0, 0.6, twig)) * tone;
    lich = 0.5;
  } else {
    let plate = mix(vec3f(0.03, 0.025, 0.021), vec3f(0.105, 0.085, 0.068), h);
    col = select(plate, vec3f(0.075, 0.06, 0.047) * (0.6 + 0.5 * h), twig) * tone;
    lich = 1.0;
  }
  let l = lichen(p, h, seed, lich);
  col = mix(col, vec3f(0.115, 0.13, 0.085) * (0.8 + 0.4 * h), l * select(0.8, 0.45, twig));
  let moss = smoothstep(0.9, 0.0, height) * smoothstep(0.35, 0.65, vnoise3(p * vec3f(5.0, 2.0, 5.0) + vec3f(seed * 9.0)));
  return mix(col, vec3f(0.03, 0.062, 0.014), moss * 0.85);
}

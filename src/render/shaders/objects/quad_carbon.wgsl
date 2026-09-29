// Carbon fibre of the frame plates and arms: a 2x2 twill weave with rounded tows that dive under their neighbours, evaluated in body space.
#include "objects/quad_bindings.wgsl"

const TOW : f32 = 0.0016;
const WEAVE_HEIGHT : f32 = 0.00025;

fn towProfile(t : f32) -> f32 {
  let x = 2.0 * t - 1.0;
  return sqrt(max(1.0 - x * x, 0.0));
}

// The warp tow (running along v) is on top in cell c; the pattern shifts by one cell per row, which gives the twill diagonal.
fn warpOver(c : vec2i) -> bool {
  return ((c.x + c.y) & 3) < 2;
}

// x = height in [0, 1], y = tone (the warp reads lighter than the weft), z = tow cross section profile, w = per cell random.
fn twill(uv : vec2f) -> vec4f {
  let cf = floor(uv);
  let c = vec2i(cf);
  let f = uv - cf;
  let over = warpOver(c);
  let across = select(f.y, f.x, over);
  let along = select(f.x, f.y, over);
  let lowUnder = select(warpOver(c + vec2i(-1, 0)), !warpOver(c + vec2i(0, -1)), over);
  let highUnder = select(warpOver(c + vec2i(1, 0)), !warpOver(c + vec2i(0, 1)), over);
  let dive = select(1.0, smoothstep(0.0, 0.45, along), lowUnder) * select(1.0, smoothstep(0.0, 0.45, 1.0 - along), highUnder);
  let prof = towProfile(across);
  let h = (0.25 + 0.75 * prof) * (0.35 + 0.65 * dive);
  let rnd = hash21(bitcast<vec2u>(c));
  return vec4f(h, select(0.7, 1.0, over), prof, rnd);
}

fn carbonSurf(m : MatIn, s : Surf) -> Surf {
  var o = s;
  o.material = MAT_QUAD;
  let top = smoothstep(0.5, 0.85, abs(m.n.y));
  let uv = m.p.xz / TOW;
  // Past a few pixels per tow the weave averages out instead of aliasing.
  let fade = 1.0 - smoothstep(0.35, 0.8, m.fp / TOW);
  let w0 = twill(uv);
  let e = 0.05;
  let wu = twill(uv + vec2f(e, 0.0));
  let wv = twill(uv + vec2f(0.0, e));
  let d = clamp(vec2f(wu.x - w0.x, wv.x - w0.x) / e, vec2f(-4.0), vec2f(4.0));
  o.normal = bumpFromGradient(m.n, vec3f(d.x, 0.0, d.y) * (WEAVE_HEIGHT / TOW * fade * top));

  let tone = mix(0.85, w0.y, fade);
  let gap = mix(1.0, 0.5 + 0.5 * w0.z, fade);
  let variation = mix(1.0, 0.88 + 0.24 * w0.w, fade);
  let face = vec3f(0.034, 0.035, 0.04) * (tone * gap * variation);
  // Cut edges show the laminate: lighter, rougher, and banded by ply.
  let ply = vnoise2(vec2f(m.p.y * 3000.0, (m.p.x + m.p.z) * 400.0));
  let edge = vec3f(0.05, 0.05, 0.056) * (0.82 + 0.36 * mix(0.5, ply, fade));
  o.albedo = mix(edge, face, top);
  o.roughness = mix(0.55, 0.27, top);
  return o;
}

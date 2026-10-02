// World-anchored tone of the sward, shared by the grass blades (grass.wgsl samples it at each blade root) and the turf layer of the
// terrain (terrain.wgsl evaluates it per pixel, band-limited by the pixel footprint), so both read one field and the colour does not step
// where the blades end. Needs only common/math.wgsl and has no bindings: safe to include from any stage.
//   grassClumpTone(xz, fp)             multiplier (about 1) of the 45 cm tuft and 1.8 m swath tone; fp = pixel extent in metres, 0 for a blade
//   grassStreak(xz, fx, fy)            zero-mean blade-streak field in about [-1, 1] for the turf under and beyond the blades (fx, fy: the
//                                      pixel's world-xz derivatives); every band fades to 0 as the pixel nears its width, so it cannot shimmer
#include "common/math.wgsl"

const GT_STREAK_AMP : f32 = 0.2;
const GT_DIR_A : vec2f = vec2f(0.9781, 0.2079);
const GT_DIR_B : vec2f = vec2f(0.5446, 0.8387);
const GT_DIR_C : vec2f = vec2f(-0.2079, 0.9781);
const GT_DIR_D : vec2f = vec2f(-0.8387, 0.5446);

// Smooth value noise in [0, 1]; the lattice values are hash21 of the corner, with the inner hash shared by the two corners of a row.
fn gtValue(p : vec2f) -> f32 {
  let i = floor(p);
  let f = p - i;
  let u = f * f * (3.0 - 2.0 * f);
  let b = bitcast<vec2u>(vec2i(i));
  let r0 = pcg(b.y);
  let r1 = pcg(b.y + 1u);
  return mix(mix(u01(pcg(b.x + r0)), u01(pcg(b.x + 1u + r0)), u.x), mix(u01(pcg(b.x + r1)), u01(pcg(b.x + 1u + r1)), u.x), u.y);
}

// 1 while a pixel extent covers under a third of the feature, 0 once it covers most of it.
fn gtVisible(extent : f32, size : f32) -> f32 {
  return 1.0 - smoothstep(0.3, 0.8, extent / size);
}

fn grassClumpTone(xz : vec2f, fp : f32) -> vec3f {
  let tuft = mix(0.5, gtValue(xz * 2.2), gtVisible(fp, 0.45));
  let swath = mix(0.5, gtValue(xz * 0.55 + vec2f(17.0, 5.0)), gtVisible(fp, 1.8));
  return (0.7 + 0.6 * tuft) * mix(vec3f(0.96, 0.99, 1.07), vec3f(1.04, 1.01, 0.92), swath);
}

// One band of streaks: value noise stretched along e2 (`sv` metres) and narrow across it (`su` metres). The band is resolved only when the
// pixel's extent along each of its two axes (the footprint parallelogram projected on it) is small against that axis' feature size, so a
// view along the streaks keeps them and a view across them averages them out.
fn gtStreakBand(xz : vec2f, e1 : vec2f, su : f32, sv : f32, fx : vec2f, fy : vec2f, seed : f32) -> f32 {
  let e2 = vec2f(-e1.y, e1.x);
  let wu = abs(dot(fx, e1)) + abs(dot(fy, e1));
  let wv = abs(dot(fx, e2)) + abs(dot(fy, e2));
  let vis = gtVisible(wu, su) * gtVisible(wv, sv);
  if (vis < 0.01) { return 0.0; }
  return vis * (2.0 * gtValue(vec2f(dot(xz, e1) / su, dot(xz, e2) / sv) + vec2f(seed, 1.7 * seed)) - 1.0);
}

// Four bands 7, 16, 36 and 80 cm across and about 2.4 times as long, each at its own orientation so no single combing direction shows.
fn grassStreak(xz : vec2f, fx : vec2f, fy : vec2f) -> f32 {
  return 0.5 * gtStreakBand(xz, GT_DIR_A, 0.07, 0.17, fx, fy, 3.0)
    + 0.65 * gtStreakBand(xz, GT_DIR_B, 0.16, 0.38, fx, fy, 11.0)
    + 0.6 * gtStreakBand(xz, GT_DIR_C, 0.36, 0.85, fx, fy, 27.0)
    + 0.45 * gtStreakBand(xz, GT_DIR_D, 0.8, 1.9, fx, fy, 41.0);
}

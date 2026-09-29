// World-space noise for terrain shading. Include after common/math.wgsl (hash21, pcg3, u01).

fn tnLatticeHash(ip : vec2i) -> f32 { return hash21(bitcast<vec2u>(ip)); }

fn tnLatticeGradient(ip : vec2i) -> vec2f {
  let a = u01(pcg3(vec3u(bitcast<vec2u>(ip), 11u)).x) * TAU;
  return vec2f(cos(a), sin(a));
}

fn tnQuintic(f : vec2f) -> vec2f { return f * f * f * (f * (f * 6.0 - 15.0) + 10.0); }

// Value noise in [0, 1].
fn tnValue(p : vec2f) -> f32 {
  let i = floor(p);
  let u = tnQuintic(p - i);
  let ip = vec2i(i);
  let a = tnLatticeHash(ip);
  let b = tnLatticeHash(ip + vec2i(1, 0));
  let c = tnLatticeHash(ip + vec2i(0, 1));
  let d = tnLatticeHash(ip + vec2i(1, 1));
  return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
}

// Perlin gradient noise in about [-1, 1]; no axis-aligned grid look, unlike value noise.
fn tnGradient(p : vec2f) -> f32 {
  let i = floor(p);
  let f = p - i;
  let u = tnQuintic(f);
  let ip = vec2i(i);
  let a = dot(tnLatticeGradient(ip), f);
  let b = dot(tnLatticeGradient(ip + vec2i(1, 0)), f - vec2f(1.0, 0.0));
  let c = dot(tnLatticeGradient(ip + vec2i(0, 1)), f - vec2f(0.0, 1.0));
  let d = dot(tnLatticeGradient(ip + vec2i(1, 1)), f - vec2f(1.0, 1.0));
  return mix(mix(a, b, u.x), mix(c, d, u.x), u.y) * 1.4142;
}

const TN_ROT : mat2x2f = mat2x2f(0.8, 0.6, -0.6, 0.8);

// Fractal sum of gradient noise, remapped to about [0, 1]. Octaves are rotated against each other to hide the lattice.
fn tnFbm(p0 : vec2f, octaves : i32) -> f32 {
  var p = p0;
  var sum = 0.0;
  var amp = 0.5;
  var norm = 0.0;
  for (var o = 0; o < octaves; o++) {
    sum += amp * tnGradient(p);
    norm += amp;
    p = TN_ROT * p * 2.03 + vec2f(17.3, 9.1);
    amp *= 0.5;
  }
  return 0.5 + 0.5 * sum / norm;
}

// Two decorrelated tnFbm channels used to warp a lookup domain (about [-1, 1] each).
fn tnWarp2(p : vec2f) -> vec2f {
  return vec2f(tnFbm(p + vec2f(5.2, 1.3), 2), tnFbm(p + vec2f(1.7, 9.2), 2)) * 2.0 - 1.0;
}

// Gradient noise with its analytic derivative: (value, d/dx, d/dy), same scale as tnGradient.
fn tnGradientD(p : vec2f) -> vec3f {
  let i = floor(p);
  let f = p - i;
  let u = tnQuintic(f);
  let du = 30.0 * f * f * (f * (f - 2.0) + 1.0);
  let ip = vec2i(i);
  let ga = tnLatticeGradient(ip);
  let gb = tnLatticeGradient(ip + vec2i(1, 0));
  let gc = tnLatticeGradient(ip + vec2i(0, 1));
  let gd = tnLatticeGradient(ip + vec2i(1, 1));
  let va = dot(ga, f);
  let vb = dot(gb, f - vec2f(1.0, 0.0));
  let vc = dot(gc, f - vec2f(0.0, 1.0));
  let vd = dot(gd, f - vec2f(1.0, 1.0));
  let k = va - vb - vc + vd;
  let value = va + u.x * (vb - va) + u.y * (vc - va) + u.x * u.y * k;
  let grad = ga + u.x * (gb - ga) + u.y * (gc - ga) + u.x * u.y * (ga - gb - gc + gd) + du * (u.yx * k + vec2f(vb - va, vc - va));
  return vec3f(value, grad) * 1.4142;
}

// Fractal sum of tnGradientD: (value in about [-1, 1], d/dx, d/dy) with respect to p0. `fp` is the pixel footprint in p0 units; octaves
// whose lattice cell shrinks toward a pixel fade out, because every octave contributes the same slope and would alias.
fn tnFbmD(p0 : vec2f, octaves : i32, fp : f32) -> vec3f {
  var p = p0;
  var m = mat2x2f(1.0, 0.0, 0.0, 1.0);
  var sum = vec3f(0.0);
  var amp = 0.5;
  var norm = 0.0;
  var scale = 1.0;
  for (var o = 0; o < octaves; o++) {
    let n = tnGradientD(p);
    let vis = 1.0 - smoothstep(0.25, 0.6, fp * scale);
    sum += amp * vis * vec3f(n.x, transpose(m) * n.yz);
    norm += amp;
    m = TN_ROT * m * 2.03;
    p = TN_ROT * p * 2.03 + vec2f(17.3, 9.1);
    amp *= 0.5;
    scale *= 2.03;
  }
  return sum / norm;
}

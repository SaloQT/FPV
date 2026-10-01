// Periodic noise and cell patterns for the ground detail generator (detail_gen.wgsl). Every function wraps its lattice at an integer
// period of uv, so what it returns tiles seamlessly. No bindings: safe to include from compute shaders.

const TAU_D : f32 = 6.28318530718;

fn pcgh(v : u32) -> u32 {
  let s = v * 747796405u + 2891336453u;
  let w = ((s >> ((s >> 28u) + 4u)) ^ s) * 277803737u;
  return (w >> 22u) ^ w;
}
fn hash2(ip : vec2i, seed : u32) -> u32 { return pcgh(u32(ip.x) + pcgh(u32(ip.y) + pcgh(seed))); }
fn f01(h : u32) -> f32 { return f32(h >> 8u) * (1.0 / 16777216.0); }
fn wrapLattice(ip : vec2i, per : vec2i) -> vec2i { return ((ip % per) + per) % per; }

fn pGrad(ip : vec2i, per : vec2i, seed : u32) -> vec2f {
  let a = f01(hash2(wrapLattice(ip, per), seed)) * TAU_D;
  return vec2f(cos(a), sin(a));
}

// Periodic Perlin noise, about [-1, 1]; `per` lattice cells across the tile on each axis.
fn pNoise(uv : vec2f, per : vec2i, seed : u32) -> f32 {
  let p = uv * vec2f(per);
  let i = floor(p);
  let f = p - i;
  let ip = vec2i(i);
  let u = f * f * f * (f * (f * 6.0 - 15.0) + 10.0);
  let a = dot(pGrad(ip, per, seed), f);
  let b = dot(pGrad(ip + vec2i(1, 0), per, seed), f - vec2f(1.0, 0.0));
  let c = dot(pGrad(ip + vec2i(0, 1), per, seed), f - vec2f(0.0, 1.0));
  let d = dot(pGrad(ip + vec2i(1, 1), per, seed), f - vec2f(1.0, 1.0));
  return mix(mix(a, b, u.x), mix(c, d, u.x), u.y) * 1.4142;
}

// Periodic fbm remapped to about [0, 1]; the frequency doubles per octave.
fn pFbm(uv : vec2f, freq : i32, octaves : i32, seed : u32) -> f32 {
  var sum = 0.0;
  var amp = 0.5;
  var norm = 0.0;
  var fr = freq;
  for (var o = 0; o < octaves; o++) {
    sum += amp * pNoise(uv, vec2i(fr), seed + u32(o) * 101u);
    norm += amp;
    amp *= 0.5;
    fr *= 2;
  }
  return 0.5 + 0.5 * sum / norm;
}

fn contrast(x : f32, k : f32) -> f32 { return saturate(0.5 + (x - 0.5) * k); }
fn cavity(h : f32) -> f32 { return 0.4 + 0.6 * smoothstep(0.1, 0.7, h); }

fn srgbEncode(c : vec3f) -> vec3f {
  return select(1.055 * pow(c, vec3f(1.0 / 2.4)) - 0.055, 12.92 * c, c <= vec3f(0.0031308));
}

// Periodic cellular noise that also returns the offset to the nearest feature point (cell units) for per-block facet tilt.
struct Cell {
  f1 : f32,
  f2 : f32,
  id : f32,
  d : vec2f,
};

fn pCell(uv : vec2f, freq : i32, seed : u32) -> Cell {
  let p = uv * f32(freq);
  let base = floor(p);
  let f = p - base;
  let i = vec2i(base);
  var c = Cell(8.0, 8.0, 0.0, vec2f(0.0));
  for (var y = -1; y <= 1; y++) {
    for (var x = -1; x <= 1; x++) {
      let cell = vec2i(x, y);
      let h = hash2(wrapLattice(i + cell, vec2i(freq)), seed);
      let pt = vec2f(cell) + vec2f(f01(h), f01(pcgh(h))) - f;
      let d = dot(pt, pt);
      if (d < c.f1) { c.f2 = c.f1; c.f1 = d; c.id = f01(pcgh(h ^ 2654435769u)); c.d = pt; } else if (d < c.f2) { c.f2 = d; }
    }
  }
  c.f1 = sqrt(c.f1);
  c.f2 = sqrt(c.f2);
  return c;
}

// Jointed, weathered rock: irregular blocks at two scales whose joints fade in and out along their length, each block with its own height

// The topmost of randomly sized, rotated, elongated domes, one jittered candidate per cell of a freq x freq periodic grid (3x3 cells
// searched, so a radius must stay below one cell). `occupy` is the share of cells that hold a stone, `elong` the minor/major axis ratio
// limit. h is 0..1 (negative where no stone covers the texel), rr the squared normalised radius (1 at the rim) and d the offset to the
// stone centre in cell units.
struct Stone {
  h : f32,
  id : f32,
  rr : f32,
  d : vec2f,
};

fn pStones(uv : vec2f, freq : i32, seed : u32, rLo : f32, rHi : f32, elong : f32, occupy : f32) -> Stone {
  let p = uv * f32(freq);
  let base = floor(p);
  let f = p - base;
  let i = vec2i(base);
  var best = Stone(-1.0, 0.0, 1.0, vec2f(0.0));
  for (var y = -1; y <= 1; y++) {
    for (var x = -1; x <= 1; x++) {
      let cell = vec2i(x, y);
      let h0 = hash2(wrapLattice(i + cell, vec2i(freq)), seed);
      let h1 = pcgh(h0);
      let h2 = pcgh(h1);
      let h3 = pcgh(h2);
      let h4 = pcgh(h3);
      if (f01(h4) > occupy) { continue; }
      let pt = vec2f(cell) + vec2f(f01(h0), f01(h1)) - f;
      let r = mix(rLo, rHi, f01(h2));
      let a = f01(h3) * 3.14159265;
      let e = mix(1.0, elong, f01(pcgh(h4)));
      let c = cos(a);
      let s = sin(a);
      let q = vec2f(c * pt.x + s * pt.y, (-s * pt.x + c * pt.y) / e);
      let rr = dot(q, q) / (r * r);
      if (rr >= 1.0) { continue; }
      let hh = sqrt(1.0 - rr) * (0.55 + 0.45 * f01(pcgh(h4 ^ 2654435769u)));
      if (hh > best.h) { best = Stone(hh, f01(pcgh(h3 ^ 40503u)), rr, pt); }
    }
  }
  return best;
}

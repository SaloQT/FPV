const PI : f32 = 3.14159265358979;
const TAU : f32 = 6.28318530717959;
const INV_PI : f32 = 0.31830988618379;
const EMISSIVE_MAX_NITS : f32 = 20000.0;

fn saturate1(x : f32) -> f32 { return clamp(x, 0.0, 1.0); }
fn sq(x : f32) -> f32 { return x * x; }

// PCG hash (Jarzynski/Olano). Good quality, cheap; use for per-pixel/per-thread randomness.
fn pcg(v : u32) -> u32 {
  let s = v * 747796405u + 2891336453u;
  let w = ((s >> ((s >> 28u) + 4u)) ^ s) * 277803737u;
  return (w >> 22u) ^ w;
}
fn pcg3(v : vec3u) -> vec3u {
  var x = v * 1664525u + 1013904223u;
  x.x += x.y * x.z; x.y += x.z * x.x; x.z += x.x * x.y;
  x = x ^ (x >> vec3u(16u));
  x.x += x.y * x.z; x.y += x.z * x.x; x.z += x.x * x.y;
  return x;
}
fn u01(h : u32) -> f32 { return f32(h >> 8u) * (1.0 / 16777216.0); }
fn hash11(x : u32) -> f32 { return u01(pcg(x)); }
fn hash21(p : vec2u) -> f32 { return u01(pcg(p.x + pcg(p.y))); }
fn hash31(p : vec3u) -> f32 { return u01(pcg3(p).x); }

// Octahedral unit-vector encoding into [0,1]^2 (for the G-buffer normal).
fn octEncode(n : vec3f) -> vec2f {
  let a = n / (abs(n.x) + abs(n.y) + abs(n.z));
  var e = a.xy;
  if (a.z < 0.0) { e = (1.0 - abs(a.yx)) * select(vec2f(-1.0), vec2f(1.0), a.xy >= vec2f(0.0)); }
  return e * 0.5 + 0.5;
}
fn octDecode(f : vec2f) -> vec3f {
  let e = f * 2.0 - 1.0;
  var n = vec3f(e.x, e.y, 1.0 - abs(e.x) - abs(e.y));
  let t = saturate1(-n.z);
  n.x += select(t, -t, n.x >= 0.0);
  n.y += select(t, -t, n.y >= 0.0);
  return normalize(n);
}

// Orthonormal basis around n (Duff et al. 2017).
fn basisFromNormal(n : vec3f) -> mat3x3f {
  let s = select(-1.0, 1.0, n.z >= 0.0);
  let a = -1.0 / (s + n.z);
  let b = n.x * n.y * a;
  let t = vec3f(1.0 + s * n.x * n.x * a, s * b, -s * n.x);
  let bt = vec3f(b, s + n.y * n.y * a, -n.y);
  return mat3x3f(t, bt, n);
}

fn cosineHemisphere(u : vec2f) -> vec3f {
  let r = sqrt(u.x);
  let phi = TAU * u.y;
  return vec3f(r * cos(phi), r * sin(phi), sqrt(max(0.0, 1.0 - u.x)));
}

fn luminance(c : vec3f) -> f32 { return dot(c, vec3f(0.2126, 0.7152, 0.0722)); }

// World position from reverse-Z depth and pixel-centre UV (uses the jittered inverse matrix).
fn worldFromDepth(uv : vec2f, depth : f32) -> vec3f {
  let ndc = vec4f(uv.x * 2.0 - 1.0, 1.0 - uv.y * 2.0, depth, 1.0);
  let w = frame.invViewProj * ndc;
  return w.xyz / w.w;
}

// Camera-space ray direction (world axes) for a pixel-centre UV.
fn viewRayDir(uv : vec2f) -> vec3f {
  let p = worldFromDepth(uv, 0.0001);
  return normalize(p - frame.camPos.xyz);
}

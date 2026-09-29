// Post dev scene: an analytic, unlit scene evaluated per pixel by ray casting from the jittered camera, so radiance, depth and motion
// vectors are exact (a rasterised mesh would have to be lit by the real modules). Prepended with rc.shader('common/world_bindings.wgsl').
// The G-buffer pass writes depth + motion; the forward pass overwrites hdr with the radiance (nits * pre-exposure, clamped for fp16).
struct Scene {
  sun : vec4f,       // xyz = direction to the sun (moon at night), w = its disc radiance (nits)
  rad : vec4f,       // x = scene radiance scale (1 = midday), y = dev pre-exposure multiplier, z = grid overlay (0/1), w = lamp radiance (nits)
  cube : vec4f,      // xyz = centre, w = yaw (rad)
  cubePrev : vec4f,  // the same one frame earlier
};
@group(2) @binding(0) var<uniform> sc : Scene;

const SKY_HORIZON = vec3f(0.75, 0.85, 1.0) * 18000.0;
const SKY_ZENITH = vec3f(0.25, 0.45, 1.0) * 7000.0;
const SUN_ILLUM = 1.0e5;
const SKY_ILLUM = 1.2e4;
const SUN_RADIUS = 0.007;
const HDR_MAX = 60000.0;
const GATE_COLOR = vec3f(0.9, 0.3, 0.02);
const PANEL_C = vec3f(-4.2, 1.7, -8.0);
const PANEL_H = vec3f(2.4, 1.5, 0.03);
const CUBE_H = vec3f(0.8);
const LAMP_R = 0.12;

const K_SKY = 0u;
const K_GROUND = 1u;
const K_GATE = 2u;
const K_PANEL = 3u;
const K_CUBE = 4u;
const K_LAMP = 5u;

struct Hit { t : f32, kind : u32, n : vec3f, local : vec3f };

fn hash1(x : u32) -> u32 {
  let s = x * 747796405u + 2891336453u;
  let w = ((s >> ((s >> 28u) + 4u)) ^ s) * 277803737u;
  return (w >> 22u) ^ w;
}

fn rnd(a : vec3i) -> f32 { return f32(hash1(u32(a.x) + hash1(u32(a.y) + hash1(u32(a.z))))) / 4294967295.0; }

fn yawRot(a : f32, v : vec3f) -> vec3f {
  let c = cos(a);
  let s = sin(a);
  return vec3f(c * v.x + s * v.z, v.y, -s * v.x + c * v.z);
}

// x = distance (-1 = miss), yzw = outward normal of the entered face.
fn boxHit(o : vec3f, d : vec3f, c : vec3f, h : vec3f) -> vec4f {
  let inv = 1.0 / select(d, vec3f(1e-9), abs(d) < vec3f(1e-9));
  let t0 = (c - h - o) * inv;
  let t1 = (c + h - o) * inv;
  let tmin = min(t0, t1);
  let tn = max(max(tmin.x, tmin.y), tmin.z);
  let tf = min(min(max(t0, t1).x, max(t0, t1).y), max(t0, t1).z);
  if (tn > tf || tn < 0.0) { return vec4f(-1.0, 0.0, 0.0, 0.0); }
  let axis = step(tmin.yzx, tmin) * step(tmin.zxy, tmin);
  return vec4f(tn, -sign(d) * axis);
}

fn sphereHit(o : vec3f, d : vec3f, c : vec3f, r : f32) -> f32 {
  let oc = o - c;
  let b = dot(oc, d);
  let h = b * b - (dot(oc, oc) - r * r);
  return select(-1.0, -b - sqrt(max(h, 0.0)), h >= 0.0);
}

fn consider(b : ptr<function, Hit>, t : f32, kind : u32, n : vec3f, local : vec3f) {
  if (t > 0.0 && t < (*b).t) { (*b).t = t; (*b).kind = kind; (*b).n = n; (*b).local = local; }
}

fn trace(o : vec3f, d : vec3f) -> Hit {
  var b = Hit(1e9, K_SKY, vec3f(0.0, 1.0, 0.0), vec3f(0.0));
  if (d.y < -1e-5) { consider(&b, -o.y / d.y, K_GROUND, vec3f(0.0, 1.0, 0.0), vec3f(0.0)); }
  for (var i = 0; i < 3; i++) {
    let z = -10.0 - 11.0 * f32(i);
    for (var k = 0; k < 3; k++) {
      let post = k < 2;
      let c = select(vec3f(0.0, 2.45, z), vec3f(select(-1.5, 1.5, k == 1), 1.2, z), post);
      let h = select(vec3f(1.58, 0.08, 0.08), vec3f(0.08, 1.2, 0.08), post);
      let r = boxHit(o, d, c, h);
      consider(&b, r.x, K_GATE, r.yzw, vec3f(0.0));
    }
  }
  let p = boxHit(o, d, PANEL_C, PANEL_H);
  consider(&b, p.x, K_PANEL, p.yzw, vec3f(0.0));
  let ol = yawRot(-sc.cube.w, o - sc.cube.xyz);
  let dl = yawRot(-sc.cube.w, d);
  let cb = boxHit(ol, dl, vec3f(0.0), CUBE_H);
  consider(&b, cb.x, K_CUBE, yawRot(sc.cube.w, cb.yzw), ol + dl * cb.x);
  for (var i = 0; i < 4; i++) {
    let lp = vec3f(select(-1.6, 1.6, (i & 1) == 1), 2.6, -10.0 - 11.0 * f32(i >> 1));
    consider(&b, sphereHit(o, d, lp, LAMP_R), K_LAMP, vec3f(0.0, 1.0, 0.0), vec3f(0.0));
  }
  return b;
}

fn skyBase(d : vec3f) -> vec3f {
  let t = pow(saturate(d.y), 0.45);
  let aureole = pow(max(dot(d, sc.sun.xyz), 0.0), 96.0) * 4.0e4;
  return (mix(SKY_HORIZON, SKY_ZENITH, t) + vec3f(1.0, 0.85, 0.6) * aureole) * sc.rad.x;
}

fn lit(albedo : vec3f, n : vec3f, shadow : f32) -> vec3f {
  let e = SUN_ILLUM * max(dot(n, sc.sun.xyz), 0.0) * shadow + SKY_ILLUM * (0.5 + 0.5 * n.y);
  return albedo * e * sc.rad.x / PI;
}

fn groundAlbedo(p : vec2f) -> vec3f {
  let cell = vec2i(floor(p * 0.5));
  let base = mix(vec3f(0.12, 0.2, 0.08), vec3f(0.5, 0.45, 0.3), f32((cell.x + cell.y) & 1));
  let line = min(abs(fract(p.x + 0.5) - 0.5), abs(fract(p.y + 0.5) - 0.5));
  return select(base, vec3f(0.9), line < 0.015);
}

fn groundShadow(p : vec2f) -> f32 {
  return select(1.0, 0.03, p.x > -12.0 && p.x < -6.5 && p.y < -16.0 && p.y > -30.0);
}

// Lower half: 5x7 pseudo glyphs in coloured rows; upper left: zone plate (frequency sweeps past Nyquist); upper right: thin diagonal stripes.
fn panelAlbedo(p : vec3f) -> vec3f {
  let uv = p.xy - (PANEL_C.xy - PANEL_H.xy);
  if (uv.y >= 3.0 * 0.5) {
    if (uv.x < 2.4) {
      let r = uv - vec2f(1.2, 2.25);
      return vec3f(0.5 + 0.45 * sin(40.0 * dot(r, r)));
    }
    return select(vec3f(0.9), vec3f(0.8, 0.05, 0.05), fract((uv.x + uv.y) * 25.0) < 0.5);
  }
  let g = vec2i(floor(uv / 0.06));
  let gl = vec2i(g.x / 6, g.y / 9);
  let px = vec2i(g.x - gl.x * 6, g.y - gl.y * 9);
  let on = px.x < 5 && px.y < 7 && rnd(vec3i(gl, px.x + 5 * px.y)) > 0.5;
  let hue = rnd(vec3i(gl.y, 7, 3));
  let colour = 0.5 + 0.5 * cos(6.2831853 * (hue + vec3f(0.0, 0.33, 0.67)));
  return select(vec3f(0.03), colour, on);
}

fn cubeAlbedo(l : vec3f) -> vec3f {
  let a = abs(l);
  let onX = a.x >= a.y && a.x >= a.z;
  let onY = !onX && a.y >= a.z;
  let uv = select(select(l.xy, l.xz, onY), l.yz, onX);
  let face = select(select(vec3f(0.15, 0.25, 0.9), vec3f(0.15, 0.8, 0.15), onY), vec3f(0.9, 0.15, 0.1), onX);
  let check = f32((i32(floor(uv.x * 2.5)) + i32(floor(uv.y * 2.5))) & 1);
  let edge = max(abs(uv.x), abs(uv.y)) > 0.72;
  return select(face * (0.45 + 0.55 * check), vec3f(0.02), edge);
}

// Scene radiance in nits along a ray.
fn radiance(h : Hit, o : vec3f, d : vec3f) -> vec3f {
  let p = o + d * h.t;
  switch (h.kind) {
    case 1u: {
      let shade = lit(groundAlbedo(p.xz), h.n, groundShadow(p.xz));
      return mix(shade, skyBase(normalize(vec3f(d.x, 0.0, d.z))), 1.0 - exp(-h.t / 300.0));
    }
    case 2u: { return lit(GATE_COLOR, h.n, 1.0); }
    case 3u: { return lit(panelAlbedo(p), h.n, 1.0); }
    case 4u: { return lit(cubeAlbedo(h.local), h.n, 1.0); }
    case 5u: { return vec3f(1.0, 0.85, 0.6) * sc.rad.w; }
    default: {
      let disc = 1.0 - smoothstep(SUN_RADIUS * 0.9, SUN_RADIUS, acos(min(dot(d, sc.sun.xyz), 1.0)));
      return skyBase(d) + vec3f(1.0, 0.97, 0.9) * sc.sun.w * disc;
    }
  }
}

fn gridColor(px : vec2f) -> vec3f {
  let dist = abs(fract(px / 60.0 + 0.5) - 0.5) * 60.0;
  let c = px - 0.5 * frame.screen.xy;
  let axis = min(abs(c.x), abs(c.y)) < 1.4;
  let line = min(dist.x, dist.y) < 1.4;
  return vec3f(select(select(300.0, 3000.0, line), 3000.0, axis)) * sc.rad.x;
}

fn viewRay(px : vec2f) -> vec3f {
  let ndc = vec2f(px.x * frame.screen.z * 2.0 - 1.0, 1.0 - px.y * frame.screen.w * 2.0);
  let w = frame.invViewProj * vec4f(ndc, 1.0, 1.0);
  return normalize(w.xyz / w.w - frame.camPos.xyz);
}

fn uvOfClip(clip : vec4f) -> vec2f {
  let ndc = clip.xy / clip.w;
  return vec2f(ndc.x * 0.5 + 0.5, 0.5 - ndc.y * 0.5);
}

@vertex fn vs(@builtin(vertex_index) i : u32) -> @builtin(position) vec4f {
  let p = vec2f(f32((i << 1u) & 2u), f32(i & 2u));
  return vec4f(p * 2.0 - 1.0, 0.0, 1.0);
}

struct GOut {
  @location(0) albedo : vec4f,
  @location(1) normal : vec4f,
  @location(2) misc : vec4f,
  @location(3) motion : vec2f,
  @builtin(frag_depth) depth : f32,
};

@fragment fn fs_gbuffer(@builtin(position) pos : vec4f) -> GOut {
  let o = frame.camPos.xyz;
  let d = viewRay(pos.xy);
  let h = trace(o, d);
  let sky = h.kind == K_SKY;
  let p = o + d * h.t;
  var prevWorld = vec4f(p, 1.0);
  if (h.kind == K_CUBE) { prevWorld = vec4f(sc.cubePrev.xyz + yawRot(sc.cubePrev.w, h.local), 1.0); }
  // Sky is at infinity: it moves with the camera rotation only.
  let curr = select(vec4f(p, 1.0), vec4f(d, 0.0), sky);
  let prev = select(prevWorld, vec4f(d, 0.0), sky);
  let currClip = frame.viewProjUnjittered * curr;
  let prevClip = frame.prevViewProj * prev;
  var out : GOut;
  out.albedo = vec4f(0.18, 0.18, 0.18, 1.0);
  out.normal = vec4f(octEncode(h.n), 1.0, 0.0);
  out.misc = vec4f(select(6.0, 0.0, sky) / 255.0, 0.0, 0.0, 0.0);
  out.motion = select(vec2f(0.0), uvOfClip(prevClip) - uvOfClip(currClip), prevClip.w > 1e-4 && currClip.w > 1e-4);
  let clip = frame.viewProj * vec4f(p, 1.0);
  out.depth = select(saturate(clip.z / clip.w), 0.0, sky);
  return out;
}

@fragment fn fs_forward(@builtin(position) pos : vec4f) -> @location(0) vec4f {
  let o = frame.camPos.xyz;
  let d = viewRay(pos.xy);
  var nits = radiance(trace(o, d), o, d);
  // The grid lives in unjittered screen space, so TAA has to resolve it back to the exact line positions.
  if (sc.rad.z > 0.5) { nits = gridColor(pos.xy - vec2f(frame.jitter.x * 0.5 * frame.screen.x, -frame.jitter.y * 0.5 * frame.screen.y)); }
  return vec4f(min(nits * frame.params.y * sc.rad.y, vec3f(HDR_MAX)), 1.0);
}

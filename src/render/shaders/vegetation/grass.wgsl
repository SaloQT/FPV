// Grass blades. One instance per blade record (grass_cull.wgsl); the vertices are a strip of rows, two vertices per row, plus a tip vertex
// when HAS_TIP. LOD0/1/2 only differ in NSEG/HAS_TIP. All animation is a bend of the blade axis: an arc whose tip is displaced by
// H * sin(tilt), where the tilt vector adds the blade's own curl, the wind lean and flutter, prop wash and trample.
#include "vegetation/veg_params.wgsl"
#include "vegetation/veg_wind.wgsl"
#include "vegetation/grass_blade.wgsl"
#include "terrain/gbuffer.wgsl"

@group(2) @binding(1) var<storage, read> blades : array<Blade>;

const NSEG : u32 = ${NSEG}u;
const HAS_TIP : bool = ${HAS_TIP};
const MIN_HALF_PX : f32 = 0.35;
const MAX_TILT : f32 = 1.45;
const GRASS_ID : f32 = 2.0;
const TRANSLUCENCY : f32 = 0.6;

const STRAW : vec3f = vec3f(0.30, 0.235, 0.085);
const SEED_HEAD : vec3f = vec3f(0.24, 0.17, 0.065);

struct VsOut {
  @builtin(position) pos : vec4f,
  @location(0) world : vec3f,
  @location(1) nrm : vec3f,
  @location(2) terrainNrm : vec3f,
  @location(3) albedo : vec3f,
  @location(4) shade : vec2f,   // x = cavity, y = roughness
  @location(5) motion : vec2f,
};

fn flowerColor(code : u32) -> vec3f {
  switch (code) {
    case 1u: { return vec3f(0.62, 0.60, 0.52); }
    case 2u: { return vec3f(0.60, 0.42, 0.025); }
    case 3u: { return vec3f(0.20, 0.055, 0.32); }
    default: { return vec3f(0.50, 0.03, 0.03); }
  }
}

// Lean, flutter, wash and trample as one tilt vector (radians) plus the wash squash factor.
fn bladeTilt(root : vec3f, h : f32, time : f32, rnd : f32, stiff : f32) -> vec3f {
  let v = windAt(root, time);
  let sp = length(v);
  let dir = v / max(sp, 1.0e-3);
  let lean = dir * (1.0 - exp(-sp * (0.05 + 0.15 * h))) * stiff;
  let freq = TAU * 0.8 / pow(0.05 + h, 0.9);
  let phase = freq * time + dot(root.xz, vp.wind.xy) * 0.9 + rnd * 6.0;
  let flutter = (sin(phase) * 0.6 + sin(phase * 2.3 + 1.3) * 0.4) * 0.16 * saturate1(sp / 6.0) * stiff;
  let across = vec2f(-dir.y, dir.x);
  var tilt = lean + (dir + 0.4 * across * sin(phase * 0.7)) * flutter;
  let wash = washAt(root, h, time, rnd);
  tilt += wash.xy + trampleAt(root);
  return vec3f(tilt, wash.z);
}

@vertex
fn vs(@builtin(vertex_index) vid : u32, @builtin(instance_index) iid : u32) -> VsOut {
  let b = blades[iid];
  let row = vid >> 1u;
  let isTip = HAS_TIP && row == NSEG;
  let sv = select(select(-1.0, 1.0, (vid & 1u) == 1u), 0.0, isTip);
  let t = f32(row) / f32(NSEG);

  let yaw = f32(b.info & 4095u) * (TAU / 4095.0);
  let species = (b.info >> 12u) & 7u;
  let dry = f32((b.info >> 15u) & 255u) / 255.0;
  let rnd = f32(b.info >> 23u) / 511.0;
  let tintCode = unpack4x8unorm(b.tint);
  let code = u32(tintCode.a * 255.0 + 0.5);
  let isFlower = code >= 1u && code <= 4u;
  let isSeed = code == 5u;
  let turf = tintCode.rgb * tintCode.rgb * 0.5;
  let time = frame.camPos.w;

  var curl = 0.12 + 0.35 * rnd;
  var stiff = 1.0;
  switch (species) {
    case 1u: { curl = 0.25 + 0.4 * rnd; }
    case 2u: { curl = 0.5 + 0.55 * rnd; }
    case 3u: { curl = 0.05 + 0.2 * rnd; stiff = 0.7; }
    default: {}
  }
  if (isFlower) { curl *= 0.4; }

  let bt = bladeTilt(b.pos, b.height, time, rnd, stiff);
  let H = b.height * (1.0 - 0.35 * bt.z);
  let dirY = vec2f(cos(yaw), sin(yaw));
  let tilt = dirY * curl + bt.xy;
  let tiltLen = max(length(tilt), 1.0e-4);
  let ang = min(tiltLen, MAX_TILT);
  let dirB = tilt / tiltLen;
  let A = sin(ang);

  let hh = H * t;
  let off = H * A * t * t;
  let y = sqrt(max(hh * hh - off * off, 0.02 * hh * hh));
  let centre = b.pos + vec3f(dirB.x * off, y, dirB.y * off);

  let slope = (1.0 - 2.0 * A * A * t * t) / sqrt(max(1.0 - A * A * t * t, 0.01));
  let tang = normalize(vec3f(dirB.x * 2.0 * A * t, slope, dirB.y * 2.0 * A * t));
  let side0 = vec3f(-dirY.y, 0.0, dirY.x);
  var sideB = vec3f(-dirB.y, 0.0, dirB.x);
  if (dot(sideB, side0) < 0.0) { sideB = -sideB; }
  let side = normalize(mix(side0, sideB, smoothstep(0.0, 0.8, t)));
  let nb = normalize(cross(side, tang));

  var wf = 1.0 - 0.85 * t * t;
  let headRow = select(NSEG, NSEG - 1u, HAS_TIP);
  if (isFlower) { wf = select(0.25, 3.6, row == headRow); }
  if (isSeed && t > 0.66) { wf = 1.9; }
  if (isTip) { wf = 0.0; }

  let toCam = frame.camPos.xyz - centre;
  let vdir = normalize(toCam);
  let vr = normalize(cross(vdir, vec3f(0.0, 1.0, 0.0)) + vec3f(1.0e-5, 0.0, 0.0));
  let c = dot(side, vr);
  let sideEff = side + vr * (select(-1.0, 1.0, c >= 0.0) * max(abs(c), 0.55) - c);

  let clip0 = frame.viewProj * vec4f(centre, 1.0);
  let pxPerM = frame.screen.y * 0.5 * frame.proj[1][1] / max(clip0.w, 0.05);
  let hw = max(b.halfWidth * wf, select(MIN_HALF_PX / pxPerM, 0.0, isTip));
  let world = centre + sideEff * (sv * hw);

  let gt = pow(t, 0.75);
  var base = turf * (0.78 + 0.44 * rnd);
  if (species == 3u) { base *= vec3f(0.8, 1.0, 0.92); }
  var col = base * mix(0.32, 1.55, gt) * mix(vec3f(1.0), vec3f(1.12, 1.04, 0.62), 0.6 * gt);
  col = mix(col, STRAW * mix(0.45, 1.0, gt), 0.5 * dry);
  if (isSeed && t > 0.66) { col = SEED_HEAD; }
  if (isFlower && row >= headRow) { col = flowerColor(code); }

  let tn2 = unpack2x16snorm(b.nrm);
  let tn = vec3f(tn2.x, sqrt(max(1.0 - dot(tn2, tn2), 0.0)), tn2.y);

  var o : VsOut;
  o.pos = frame.viewProj * vec4f(world, 1.0);
  o.world = world;
  o.nrm = normalize(nb + side * (0.5 * sv));
  o.terrainNrm = tn;
  o.albedo = col;
  o.shade = vec2f(mix(0.3, 1.0, saturate1(t * 1.6)), mix(0.72, 0.6, gt));
  o.motion = motionVector(world);
  return o;
}

@fragment
fn fs(in : VsOut) -> FsOut {
  var n = normalize(in.nrm);
  if (dot(n, frame.camPos.xyz - in.world) < 0.0) { n = -n; }
  n = normalize(mix(n, normalize(in.terrainNrm), 0.5));
  var o : FsOut;
  o.albedo = vec4f(in.albedo, in.shade.x);
  o.normal = vec4f(octEncode(n), in.shade.y, 0.0);
  o.misc = vec4f(GRASS_ID / 255.0, TRANSLUCENCY, 0.0, 0.0);
  o.motion = in.motion;
  return o;
}

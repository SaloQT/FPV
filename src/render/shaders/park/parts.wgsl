#include "objects/common.wgsl"
struct Instance { pos : vec4f, rot : vec4f, half : vec4f, color : vec4f, previous : vec4f, previousRot : vec4f, anim : vec4f, previousAnim : vec4f }
@group(2) @binding(0) var<storage, read> instances : array<Instance>;
@group(2) @binding(1) var<storage, read> visibleInstances : array<u32>;
// anim.w = 1 is ordinary gait; >=2 points to a compact per-frame record, independently for previousAnim.
struct StairContact { feet : vec4f, pelvis : vec4f }
@group(2) @binding(2) var<storage, read> stairContacts : array<StairContact>;
fn rotatePart(q : vec4f, v : vec3f) -> vec3f { let t = 2.0 * cross(q.xyz, v); return v + q.w * t + cross(q.xyz, t); }
struct SkinVertex { pos : vec3f, normal : vec3f }
// Identity comes from persistent appearance data, never a compacted draw-instance index.
fn guestVariation(tint : vec3f, skin : f32) -> vec4f {
  let seed = dot(tint, vec3f(31.17, 73.29, 113.53)) + skin * 91.71;
  return fract(sin(vec4f(seed, seed + 13.7, seed + 41.3, seed + 67.9)) * vec4f(13758.5453, 43758.5453, 23421.631, 19423.718));
}
// Children have larger heads for their stature; the head grows about the base of the neck.
const GUEST_CHILD_HEAD_GAIN : f32 = ${GUEST_CHILD_HEAD_GAIN};
const GUEST_CHILD_HEIGHT : f32 = ${GUEST_CHILD_HEIGHT};
const GUEST_CHILD_SPAN : f32 = ${GUEST_CHILD_SPAN};
fn guestHeadScale(height : f32) -> f32 { return 1.0 + GUEST_CHILD_HEAD_GAIN * clamp((GUEST_CHILD_HEIGHT - height) / GUEST_CHILD_SPAN, 0.0, 1.0); }
// A rider astride a mount (instance colour w = 1) swings each thigh outward about the vertical through the hip, further for shorter riders.
const GUEST_HIP_X : f32 = ${GUEST_HIP_X};
const GUEST_STRADDLE_YAW : f32 = ${GUEST_STRADDLE_YAW};
const GUEST_STRADDLE_SPREAD : f32 = ${GUEST_STRADDLE_SPREAD};
const GUEST_STRADDLE_SHORT : f32 = ${GUEST_STRADDLE_SHORT};
const GUEST_HEIGHT_REFERENCE : f32 = ${GUEST_HEIGHT_REFERENCE};
fn straddleYaw(height : f32) -> f32 { return GUEST_STRADDLE_YAW + GUEST_STRADDLE_SPREAD * min(GUEST_STRADDLE_SHORT, max(0.0, GUEST_HEIGHT_REFERENCE - height)); }
fn guestForm(p : vec3f, n : vec3f, appearance : vec4f, height : f32) -> SkinVertex {
  let t = clamp((p.y - 0.80) / 0.10, 0.0, 1.0);
  let blend = t * t * (3.0 - 2.0 * t); let derivative = 60.0 * t * (1.0 - t);
  let body = vec2f(mix(0.88, 1.15, appearance.x), mix(0.88, 1.20, appearance.y));
  let grow = guestHeadScale(height);
  let head = vec2f(mix(0.82, 0.94, appearance.z), mix(0.95, 1.05, appearance.w)) * grow;
  let shape = mix(body, head, blend); let slope = (head - body) * derivative;
  // Inverse-transpose of the varying-width deformation, before both current and previous skeletal poses.
  let ky = 1.0 + (grow - 1.0) * blend; let stretch = ky + (grow - 1.0) * derivative * (p.y - 0.84);
  return SkinVertex(vec3f(p.x * shape.x, 0.84 + (p.y - 0.84) * ky, p.z * shape.y), normalize(vec3f(n.x / shape.x, (n.y - p.x * slope.x * n.x / shape.x - p.z * slope.y * n.z / shape.y) / stretch, n.z / shape.y)));
}
fn bendX(p : vec3f, c : f32, s : f32) -> vec3f { return vec3f(p.x, c * p.y - s * p.z, s * p.y + c * p.z); }
const GUEST_SEAT_Y : f32 = ${GUEST_SEAT_Y};
const GUEST_SEAT_BACK_FACE : f32 = ${GUEST_SEAT_BACK_FACE};
const GUEST_SEAT_PAN_FRONT : f32 = ${GUEST_SEAT_PAN_FRONT};
const GUEST_KNEE_REACH : f32 = ${GUEST_KNEE_REACH};
const GUEST_HEAD_BACK : f32 = ${GUEST_HEAD_BACK};
const GUEST_TORSO_BACK : f32 = ${GUEST_TORSO_BACK};
const GUEST_SHOULDER_Y : f32 = ${GUEST_SHOULDER_Y};
const GUEST_ELBOW_Y : f32 = ${GUEST_ELBOW_Y};
const GUEST_PALM_Y : f32 = ${GUEST_PALM_Y};
const GUEST_GRIP_Y : f32 = ${GUEST_GRIP_Y};
const GUEST_GRIP_Z : f32 = ${GUEST_GRIP_Z};
const GUEST_HIP_Y : f32 = ${GUEST_HIP_Y};
const GUEST_KNEE_Y : f32 = ${GUEST_KNEE_Y};
const GUEST_ANKLE_Y : f32 = ${GUEST_ANKLE_Y};
const GUEST_GAIT_RATE : f32 = ${GUEST_GAIT_RATE};
const GUEST_GAIT_HEIGHT : f32 = ${GUEST_GAIT_HEIGHT};
const GUEST_STRIDE_LIMIT : f32 = ${GUEST_STRIDE_LIMIT};
const GUEST_STEP_LIFT : f32 = ${GUEST_STEP_LIFT};
const GUEST_KNEE_FLEX : f32 = ${GUEST_KNEE_FLEX};
const GUEST_SEATED_ANGLE : f32 = ${GUEST_SEATED_ANGLE};
struct GuestLeg { hip : vec2f, knee : vec2f, ankle : vec2f, drop : f32 }
fn guestRate(height : f32) -> f32 { return GUEST_GAIT_RATE * GUEST_GAIT_HEIGHT / max(height, 0.5); }
fn walkingLeg(anim : vec4f, height : f32, right : bool) -> GuestLeg {
  if (anim.w >= 2.0) {
    let contact = stairContacts[u32(anim.w - 2.0)]; let contactTargets = contact.feet; let reach = GUEST_HIP_Y - GUEST_ANKLE_Y;
    let hip = min(GUEST_HIP_Y - contact.pelvis.x, min(contactTargets.x + GUEST_ANKLE_Y + sqrt(max(0.0, reach * reach - contactTargets.y * contactTargets.y)), contactTargets.z + GUEST_ANKLE_Y + sqrt(max(0.0, reach * reach - contactTargets.w * contactTargets.w)))) - GUEST_KNEE_FLEX * clamp(anim.y / 1.2, 0.0, 1.0);
    let drop = GUEST_HIP_Y - hip; let point = select(contactTargets.xy, contactTargets.zw, right);
    let y = point.x + GUEST_ANKLE_Y + drop; let z = point.y; let dy = y - GUEST_HIP_Y;
    let distance = max(0.000000001, length(vec2f(dy, z))); let cb = min(1.0, distance / (2.0 * (GUEST_HIP_Y - GUEST_KNEE_Y))); let sb = sqrt(max(0.0, 1.0 - cb * cb));
    let ca = -dy / distance; let sa = -z / distance;
    return GuestLeg(vec2f(ca * cb - sa * sb, sa * cb + ca * sb), vec2f(2.0 * cb * cb - 1.0, -2.0 * cb * sb), vec2f(y, z), drop);
  }
  let activity = clamp(anim.y / 1.2, 0.0, 1.0);
  let stride = min(GUEST_STRIDE_LIMIT, max(anim.y, 0.0) * 3.141592654 / (2.0 * guestRate(height) * max(height, 0.5)));
  let phase = fract(anim.x * guestRate(height) / 6.283185307 + select(0.0, 0.5, right));
  let swing = fract(phase * 2.0); let stanceZ = (swing * 2.0 - 1.0) * stride; let reach = GUEST_HIP_Y - GUEST_ANKLE_Y;
  let swingZ = (1.0 + 2.0 * swing - 12.0 * swing * swing + 8.0 * swing * swing * swing) * stride;
  let liftWave = sin(3.141592654 * swing);
  let swingLift = GUEST_STEP_LIFT * activity * liftWave * liftWave;
  let drop = max(reach - sqrt(max(0.0, reach * reach - stanceZ * stanceZ)), reach - sqrt(max(0.0, reach * reach - swingZ * swingZ)) - swingLift) + GUEST_KNEE_FLEX * activity;
  let z = select(swingZ, stanceZ, phase < 0.5); let lift = select(swingLift, 0.0, phase < 0.5);
  let y = GUEST_ANKLE_Y + lift + drop; let dy = y - GUEST_HIP_Y;
  let distance = length(vec2f(dy, z)); let cb = min(1.0, distance / (2.0 * (GUEST_HIP_Y - GUEST_KNEE_Y))); let sb = sqrt(max(0.0, 1.0 - cb * cb));
  let ca = -dy / distance; let sa = -z / distance;
  return GuestLeg(vec2f(ca * cb - sa * sb, sa * cb + ca * sb), vec2f(2.0 * cb * cb - 1.0, -2.0 * cb * sb), vec2f(y, z), drop);
}
// Seated arm: shoulder angle and elbow bend that put the palm on the grip point (same as guestGripArm in guestPose.ts).
// Metres a seated guest sits forward of the seat centre (same as guestSeatSetback in guestPose.ts).
fn seatSetback(height : f32, panFront : f32) -> f32 { return max(0.0, max(max(GUEST_TORSO_BACK, GUEST_HEAD_BACK * guestHeadScale(height)) * height - GUEST_SEAT_BACK_FACE, panFront - GUEST_KNEE_REACH * height)); }
fn gripArm(height : f32, panFront : f32) -> vec2f {
  let upper = GUEST_SHOULDER_Y - GUEST_ELBOW_Y; let lower = GUEST_ELBOW_Y - GUEST_PALM_Y;
  let dy = GUEST_SEAT_Y + GUEST_GRIP_Y / height - GUEST_SHOULDER_Y; let dz = (GUEST_GRIP_Z + seatSetback(height, panFront)) / height;
  let reach = min(upper + lower - 0.0001, max(abs(upper - lower) + 0.0001, length(vec2f(dy, dz))));
  let toward = atan2(-dz, -dy); let bend = acos(clamp((upper * upper + reach * reach - lower * lower) / (2.0 * upper * reach), -1.0, 1.0));
  let shoulder = toward - bend; let elbowY = -upper * cos(shoulder); let elbowZ = -upper * sin(shoulder);
  let forearm = atan2(-(dz - elbowZ), -(dy - elbowY));
  return vec2f(shoulder, forearm - shoulder);
}
fn limb(p : vec3f, n : vec3f, joint : u32, weight : f32, anim : vec4f, height : f32, seatAngle : f32, straddle : f32, panFront : f32) -> SkinVertex {
  var v = SkinVertex(p, n);
  if (anim.w < 0.5) { return v; }
  let arm = joint == 2u || joint == 3u || joint == 10u || joint == 11u;
  let leg = joint >= 4u && joint <= 9u;
  var drop = 0.0;
  if (anim.z <= 0.0 && (anim.y > 0.00001 || anim.w >= 2.0)) {
    let pose = walkingLeg(anim, height, (joint & 1u) == 1u); drop = pose.drop;
    if (leg) {
      if (joint >= 8u) {
        // Independent ankle joints keep the complete sole level throughout stance.
        return SkinVertex(p + vec3f(0.0, pose.ankle.x - GUEST_ANKLE_Y - drop, pose.ankle.y), n);
      }
      if (joint >= 6u) {
        let childPivot = vec3f(0.0, GUEST_KNEE_Y, 0.0);
        v.pos = mix(p, bendX(p - childPivot, pose.knee.x, pose.knee.y) + childPivot, weight);
        v.normal = mix(n, bendX(n, pose.knee.x, pose.knee.y), weight);
      }
      let pivot = vec3f(0.0, GUEST_HIP_Y, 0.0);
      v.pos = bendX(v.pos - pivot, pose.hip.x, pose.hip.y) + pivot - vec3f(0.0, drop, 0.0);
      v.normal = bendX(v.normal, pose.hip.x, pose.hip.y); return v;
    }
  }
  if (joint == 1u) {
    // Small independent head turns keep queues alive without moving the physical torso capsule.
    let angle = sin(anim.x * 0.63) * 0.14; let c = cos(angle); let s = sin(angle);
    v.pos = vec3f(c * p.x + s * p.z, p.y - drop, -s * p.x + c * p.z);
    v.normal = vec3f(c * n.x + s * n.z, n.y, -s * n.x + c * n.z);
    return v;
  }
  if (!arm && !leg) { v.pos.y -= drop; return v; }
  let gait = cos(anim.x * guestRate(height) + select(0.0, 3.141592654, (joint & 1u) == 1u)) * min(anim.y, 1.2) * 0.42;
  let seated = anim.z;
  var grip = vec2f(0.7, 1.15);
  if (arm && seated > 0.0) { grip = gripArm(height, panFront); }
  let angle = select(gait, -gait, arm) * (1.0 - seated) + select(max(GUEST_SEATED_ANGLE, seatAngle), grip.x, arm) * seated;
  let pivot = vec3f(0.0, select(0.525, 0.785, arm), 0.0);
  // Shared elbow/knee rings blend both bones, keeping the surface joined throughout a ride.
  if ((joint >= 6u && joint <= 11u)) {
    let childPivot = vec3f(0.0, select(0.285, 0.615, arm), 0.0);
    let bend = select(-max(0.0, gait) * 0.75 * (1.0 - seated) - max(GUEST_SEATED_ANGLE, seatAngle) * seated, 0.12 * (1.0 - seated) + grip.y * seated, arm);
    let bc = cos(bend); let bs = sin(bend);
    v.pos = mix(p, bendX(p - childPivot, bc, bs) + childPivot, weight);
    v.normal = mix(n, bendX(n, bc, bs), weight);
  }
  let c = cos(angle); let s = sin(angle);
  v.pos = bendX(v.pos - pivot, c, s) + pivot - vec3f(0.0, drop, 0.0); v.normal = bendX(v.normal, c, s);
  if (leg && straddle > 0.0 && seated > 0.0) {
    let side = select(-1.0, 1.0, (joint & 1u) == 1u); let psi = -side * straddleYaw(height) * straddle * seated;
    let cy = cos(psi); let sy = sin(psi); let hx = side * GUEST_HIP_X; let d = v.pos.x - hx;
    v.pos = vec3f(hx + cy * d + sy * v.pos.z, v.pos.y, -sy * d + cy * v.pos.z);
    v.normal = vec3f(cy * v.normal.x + sy * v.normal.z, v.normal.y, -sy * v.normal.x + cy * v.normal.z);
  }
  return v;
}
struct Out { @builtin(position) pos : vec4f, @location(0) world : vec3f, @location(1) normal : vec3f,
  @location(2) color : vec4f, @location(3) params : vec4f, @location(4) prev : vec4f, @location(5) curr : vec4f, @location(6) local : vec3f,
  @location(7) surface : vec4f, @location(8) tint : vec3f }
@vertex fn vs(@location(0) p : vec3f, @location(1) n : vec3f, @location(2) jointf : f32, @builtin(instance_index) id : u32) -> Out {
  let a = instances[visibleInstances[id]]; let packedJoint = u32(jointf); let joint = packedJoint & 15u; let material = packedJoint >> 4u;
  let weight = fract(jointf) * 2.0; var appearance = vec4f(0.0);
  var shaped = SkinVertex(p, n);
  if (a.anim.w > 0.5) {
    appearance = guestVariation(a.color.rgb, a.previous.w);
    let hairstyle = u32(appearance.y * 5.0);
    if (material == 11u || (material == 4u && p.y > 0.955)) {
      let volume = select(vec3f(1.0), vec3f(1.06, 1.09, 1.04), hairstyle == 1u || hairstyle == 2u);
      shaped.pos = (p - vec3f(0.0, 0.929, 0.004)) * volume + vec3f(0.0, 0.929, 0.004); shaped.normal = normalize(n / volume);
    }
    if (material == 10u) {
      if (hairstyle < 3u) { shaped.pos = vec3f(0.0, 0.935, 0.04); }
      else if (hairstyle == 4u) { shaped.pos = vec3f(p.x * 2.5, p.y + 0.014, (p.z - 0.07) * 1.1 + 0.048); shaped.normal = normalize(n / vec3f(2.5, 1.0, 1.1)); }
    }
    shaped = guestForm(shaped.pos, shaped.normal, appearance, a.half.y);
  }
  var skinned = limb(shaped.pos, shaped.normal, joint, weight, a.anim, a.half.y, a.half.w, a.color.w, a.pos.w);
  if (a.anim.w > 0.5) { // A rider astride a mount has no seat back to sit clear of.
    skinned.pos.z -= seatSetback(a.half.y, a.pos.w) / a.half.y * a.anim.z * (1.0 - a.color.w); }
  let local = skinned.pos * a.half.xyz;
  let world = rotatePart(a.rot, local) + a.pos.xyz;
  var previousSkin = limb(shaped.pos, shaped.normal, joint, weight, a.previousAnim, a.half.y, a.half.w, a.color.w, a.pos.w).pos;
  if (a.anim.w > 0.5) { previousSkin.z -= seatSetback(a.half.y, a.pos.w) / a.half.y * a.previousAnim.z * (1.0 - a.color.w); }
  let previous = rotatePart(a.previousRot, previousSkin * a.half.xyz) + a.previous.xyz;
  var color = a.color;
  if (a.anim.w > 0.5) {
    let variant = appearance.z;
    let skin = mix(vec3f(0.12, 0.057, 0.03), vec3f(0.65, 0.39, 0.25), a.previous.w);
    if (material == 1u) { color = vec4f(mix(vec3f(0.12, 0.057, 0.03), vec3f(0.65, 0.39, 0.25), a.previous.w), 0.0); }
    if (material == 2u) { color = vec4f(mix(vec3f(0.028, 0.045, 0.07), vec3f(0.32, 0.26, 0.17), floor(variant * 3.0) * 0.5), 0.0); }
    if (material == 3u) { color = vec4f(select(vec3f(0.025, 0.026, 0.029), vec3f(0.55, 0.52, 0.47), variant > 0.67), 0.0); }
    if (material == 4u || material == 10u || material == 11u) { color = vec4f(mix(vec3f(0.014, 0.008, 0.005), vec3f(0.23, 0.13, 0.044), variant * variant), 0.0); }
    if (material == 5u) { color = vec4f(0.012, 0.008, 0.006, 0.0); }
    if (material == 6u) { color = vec4f(0.49, 0.48, 0.43, 0.0); }
    if (material == 7u) { color = vec4f(mix(vec3f(0.04, 0.018, 0.007), vec3f(0.06, 0.12, 0.13), appearance.y), 0.0); }
    if (material == 8u) { color = vec4f(mix(skin, skin * vec3f(0.88, 0.58, 0.61), 0.48), 0.0); }
    if (material == 9u) { color = vec4f(skin * vec3f(0.48, 0.34, 0.32), 0.0); }
  }
  var o : Out; o.pos = frame.viewProj * vec4f(world, 1.0); o.world = world;
  o.normal = normalize(rotatePart(a.rot, skinned.normal / max(a.half.xyz, vec3f(0.001))));
  o.color = color; o.tint = a.color.rgb; o.params = vec4f(a.pos.w, a.half.w, a.color.w, a.anim.w);
  let grainAxis = select(select(2.0, 1.0, a.half.y >= a.half.z), 0.0, a.half.x >= max(a.half.y, a.half.z));
  o.surface = vec4f(n, grainAxis);
  if (a.anim.w > 0.5) { o.surface = vec4f(p, f32(material)); o.params = vec4f(a.previous.w, appearance.w, appearance.z, a.anim.w); }
  o.prev = frame.prevViewProj * vec4f(previous, 1.0); o.curr = frame.viewProjUnjittered * vec4f(world, 1.0); o.local = local; return o;
}
@fragment fn fs(i : Out) -> GOut {
  let fp = max(length(dpdx(i.world)), length(dpdy(i.world)));
  let localNormal = abs(i.surface.xyz);
  let uv = select(select(i.local.xy, i.local.zy, localNormal.x > localNormal.z), i.local.xz, localNormal.y >= max(localNormal.x, localNormal.z));
  let uvFootprint = max(abs(dpdx(uv)), abs(dpdy(uv)));
  let restFootprint = abs(dpdx(i.surface.xyz)) + abs(dpdy(i.surface.xyz));
  if (i.params.w > 0.5) {
    let rest = i.surface.xyz; let material = u32(round(i.surface.w)); let outfit = i.params.y;
    let skin = mix(vec3f(0.12, 0.057, 0.03), vec3f(0.65, 0.39, 0.25), i.params.x);
    var color = i.color.rgb; var roughness = 0.87; var skinSurface = material == 1u || material == 8u || material == 9u;
    let shorts = outfit < 0.38 && material == 2u && rest.y < mix(0.31, 0.36, outfit / 0.38);
    let sleeves = outfit > 0.70 && material == 1u && rest.y < 0.70 && rest.y > 0.485;
    if (shorts) { color = skin; skinSurface = true; }
    if (sleeves) { color = i.tint; skinSurface = false; }
    let cloth = material == 0u || (material == 2u && !shorts) || sleeves;
    if (cloth) {
      let resolved = 1.0 - smoothstep(0.007, 0.028, fp);
      let weave = sin(rest.x * 2800.0) * sin(rest.y * 2800.0) * (1.0 - smoothstep(0.0004, 0.002, fp));
      let folds = sin(rest.y * 82.0 + sin(rest.x * 28.0) * 1.8) * 0.017 * resolved;
      color *= 1.0 + weave * 0.025 + folds;
      if (material == 0u) {
        let aa = max(restFootprint.y, 0.0005);
        let collar = 1.0 - smoothstep(0.004 - aa, 0.004 + aa, abs(rest.y - 0.831));
        let hem = 1.0 - smoothstep(0.001 - aa, 0.001 + aa, abs(rest.y - 0.532));
        color *= 1.0 - (collar * 0.18 + hem * 0.07) * resolved;
        if (outfit > 0.38 && outfit < 0.70) {
          let stripe = sin(rest.y * 102.0); color *= 1.0 + stripe * 0.12 * resolved;
        }
      }
    }
    if (skinSurface) { roughness = 0.55; color *= 1.0 + (vnoise3(rest * 1150.0) - 0.5) * 0.028 * (1.0 - smoothstep(0.0006, 0.003, fp)); }
    if (material == 4u || material == 10u || material == 11u) {
      roughness = 0.67;
      let strands = (vnoise3(rest * vec3f(920.0, 75.0, 920.0)) - 0.5) * (1.0 - smoothstep(0.001, 0.006, fp));
      color *= 1.0 + strands * 0.1;
    }
    if (material == 5u || material == 6u || material == 7u) { roughness = 0.28; }
    if (material == 3u) { roughness = 0.74; }
    var guest = newSurf(color, normalize(i.normal), roughness, select(10u, 9u, cloth));
    guest.translucency = select(0.0, 0.045, skinSurface);
    return packG(guest, i.prev, i.curr);
  }
  // All coordinates are in metres and remain attached to a moving ride, including its previous pose.
  let wood = select(select(i.local.zxy, i.local.yxz, i.surface.w < 1.5), i.local, i.surface.w < 0.5);
  let endGrain = select(select(localNormal.z, localNormal.y, i.surface.w < 1.5), localNormal.x, i.surface.w < 0.5);
  let microVisible = 1.0 - smoothstep(0.002, 0.012, fp);
  var s = newSurf(i.color.rgb, normalize(i.normal), i.params.x, 10u);
  s.metalness = i.params.y; s.emissive = i.color.w;
  let surface = i32(round(-i.params.w));
  var variation = 0.0;
  if (surface == 1) {
    // Concrete aggregate and fine pores have centred, low-amplitude contrast: no baked darkening.
    let aggregate = (vnoise3(i.local * 32.0) - 0.5) * (1.0 - smoothstep(0.008, 0.045, fp));
    let pores = (vnoise3(i.local * 155.0) - 0.5) * (1.0 - smoothstep(0.001, 0.006, fp));
    variation = aggregate * 0.095 + pores * pores * pores * 0.2;
    s.roughness = max(s.roughness, 0.8) + aggregate * 0.045 + pores * 0.035;
  } else if (surface == 2) {
    // The first wood coordinate follows the longest part axis, including rotated bench slats.
    let broad = (vnoise3(wood * vec3f(0.65, 7.0, 7.0)) - 0.5) * (1.0 - smoothstep(0.025, 0.16, fp));
    let fibres = (vnoise3(wood * vec3f(0.8, 125.0, 125.0)) - 0.5) * microVisible;
    let rings = sin(length(wood.yz) * 180.0 + broad * 3.0) * (1.0 - smoothstep(0.004, 0.026, fp));
    variation = broad * 0.14 + mix(fibres * 0.14, rings * 0.045, smoothstep(0.6, 0.95, endGrain));
    s.roughness = max(s.roughness, 0.62) + broad * 0.045;
  } else if (surface == 3) {
    let weaveVisible = 1.0 - smoothstep(0.0007, 0.0035, max(uvFootprint.x, uvFootprint.y));
    let weave = sin(uv.x * 1800.0) * sin(uv.y * 1800.0) * weaveVisible;
    variation = weave * 0.035;
    s.roughness = max(s.roughness, 0.86) + weave * 0.025;
    s.material = 9u;
  } else if (surface == 4) {
    let cellSize = vec2f(0.38, 0.18);
    let row = floor(uv.y / cellSize.y);
    let cell = uv / cellSize + vec2f(fract(row * 0.5), 0.0);
    let edgeDistance = min(fract(cell), vec2f(1.0) - fract(cell)) * cellSize;
    let aa = max(0.0001, max(uvFootprint.x, uvFootprint.y));
    let mortar = 1.0 - smoothstep(0.006 - aa, 0.006 + aa, min(edgeDistance.x, edgeDistance.y));
    let block = hash21(bitcast<vec2u>(vec2i(floor(cell)))) - 0.5;
    let resolved = 1.0 - smoothstep(0.045, 0.2, fp);
    // 9.61% mortar coverage for these dimensions; subtract the mean before modulating base albedo.
    variation = (block * 0.09 - (mortar - 0.09614) * 0.13) * resolved;
    s.roughness = max(s.roughness, 0.79) + (mortar - 0.09614) * 0.045 * resolved;
  } else if (surface == 5) {
    let leafVariation = (vnoise3(i.local * 3.0) - 0.5) * (1.0 - smoothstep(0.08, 0.35, fp));
    variation = leafVariation * 0.11; s.roughness = max(s.roughness, 0.77) + leafVariation * 0.04;
    s.translucency = 0.14; s.material = 5u;
  } else if (surface == 6) {
    s.roughness = min(s.roughness, 0.16); s.metalness = 0.0;
  } else if (surface == 7) {
    // A continuous metre-scaled paving field crosses the joined public path pieces.
    // The 4 mm joints and 1.2 mm chamfers fade at distance rather than aliasing into a grid.
    let size = vec2f(0.4, 0.2);
    let cell = i.world.xz / size + vec2f(fract(floor(i.world.z / size.y) * 0.5), 0.0);
    let fraction = fract(cell); let edge = min(fraction, vec2f(1.0) - fraction) * size;
    let axis = edge.x < edge.y; let distance = min(edge.x, edge.y);
    let aa = max(fp * 0.55, 0.0003);
    let resolved = 1.0 - smoothstep(0.055, 0.18, fp);
    let joint = 1.0 - smoothstep(0.002 - aa, 0.002 + aa, distance);
    let stone = hash21(bitcast<vec2u>(vec2i(floor(cell)))) - 0.5;
    let grain = (vnoise3(i.world * 65.0) - 0.5) * (1.0 - smoothstep(0.003, 0.02, fp));
    variation = (stone * 0.16 - (joint - 0.03) * 0.3) * resolved + grain * 0.055;
    s.roughness = 0.84 + (stone * 0.06 + joint * 0.08) * resolved;
    let bevelWidth = max(0.004, aa * 2.0); let t = clamp((distance - 0.002) / bevelWidth, 0.0, 1.0);
    let slope = 0.0012 / bevelWidth * 6.0 * t * (1.0 - t) * resolved * smoothstep(0.8, 0.98, i.normal.y);
    let slopeX = select(0.0, select(-1.0, 1.0, fraction.x < 0.5), axis) * slope;
    let slopeZ = select(select(-1.0, 1.0, fraction.y < 0.5), 0.0, axis) * slope;
    s.normal = normalize(s.normal - vec3f(slopeX, 0.0, slopeZ));
  } else {
    variation = (vnoise3(i.local * 90.0) - 0.5) * 0.1 * microVisible;
  }
  s.albedo *= 1.0 + variation;
  if (i.params.z > 0.0) { s.material = 7u; }
  return packG(s, i.prev, i.curr);
}

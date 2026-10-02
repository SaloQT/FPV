// Quad forward pass: smoky blur discs where the props spin too fast to see, and additive glow sprites on the LEDs and the camera lens.
#include "objects/quad_bindings.wgsl"
#include "common/atmosphere_sample.wgsl"

const DISC_R : f32 = ${PROP_R} * 1.04;
const DISC_ALBEDO : vec3f = vec3f(0.06, 0.057, 0.055);

// Corner of the unit quad for the six vertices of two triangles.
fn cornerOf(vi : u32) -> vec2f {
  return vec2f(select(-1.0, 1.0, vi == 1u || vi == 2u || vi == 4u), select(-1.0, 1.0, vi == 2u || vi == 4u || vi == 5u));
}

struct DiscOut {
  @builtin(position) pos : vec4f,
  @location(0) rel : vec2f,
  @location(1) world : vec3f,
  @location(2) @interpolate(flat) motor : u32,
};

@vertex fn vsDisc(@builtin(vertex_index) vi : u32, @builtin(instance_index) motor : u32) -> DiscOut {
  let c = cornerOf(vi);
  let centre = quad.prop[motor].xyz;
  let w = quad.model * vec4f(centre + vec3f(c.x, 0.0, c.y) * DISC_R, 1.0);
  var o : DiscOut;
  o.pos = frame.viewProj * w;
  o.rel = c;
  o.world = w.xyz;
  o.motor = motor;
  return o;
}

@fragment fn fsDisc(in : DiscOut) -> @location(0) vec4f {
  let r = length(in.rel);
  // Empty over the hub, densest toward the tip ring, soft at the rim: blades spend the most time out there.
  let profile = smoothstep(0.14, 0.3, r) * (0.55 + 0.45 * smoothstep(0.55, 0.95, r)) * (1.0 - smoothstep(0.93, 1.0, r));
  let alpha = quad.spin[in.motor].w * profile;
  if (alpha < 1e-4) { discard; }
  let axis = normalize(quadRot() * vec3f(0.0, 1.0, 0.0));
  let rAtm = atmosRadiusAtHeight(in.world.y);
  let sun = frame.sunIrradiance.rgb * frame.sunIrradiance.w * sampleTransmittance(rAtm, frame.sunDir.y) * abs(dot(axis, frame.sunDir.xyz));
  let moonUp = select(0.0, 1.0, frame.moonDir.y > 0.0);
  let moon = frame.moonIrradiance.rgb * moonUp * sampleTransmittance(rAtm, max(frame.moonDir.y, 0.0)) * abs(dot(axis, frame.moonDir.xyz));
  let sky = sampleSkyView(vec3f(0.0, 1.0, 0.0));
  let lit = DISC_ALBEDO * ((sun + moon) * INV_PI + sky) * frame.params.y;
  let dist = length(frame.camPos.xyz - in.world);
  let ap = sampleAerialPerspective(in.pos.xy * frame.screen.zw, dist);
  return vec4f((lit * ap.a + ap.rgb * frame.params.y) * alpha, alpha);
}

struct SpriteOut {
  @builtin(position) pos : vec4f,
  @location(0) rel : vec2f,
  @location(1) @interpolate(flat) id : u32,
  @location(2) dist : f32,
  @location(3) facing : f32,
};

@vertex fn vsSprite(@builtin(vertex_index) vi : u32, @builtin(instance_index) id : u32) -> SpriteOut {
  let c = cornerOf(vi);
  let a = quad.sprite[id];
  let anchor = (quad.model * vec4f(a.xyz, 1.0)).xyz;
  let toCam = frame.camPos.xyz - anchor;
  let dist = length(toCam);
  let dirCam = toCam / max(dist, 1e-4);
  let right = vec3f(frame.view[0][0], frame.view[1][0], frame.view[2][0]);
  let up = vec3f(frame.view[0][1], frame.view[1][1], frame.view[2][1]);
  let radius = a.w + 0.006 * dist;
  // Pulled toward the camera so the glow is not cut by the part it sits on; hidden by `facing` when that part is between it and the eye.
  let w = anchor + dirCam * 0.006 + (right * c.x + up * c.y) * radius;
  let normal = select(vec3f(0.0, 1.0, 0.0), quad.lens.xyz, id == 4u);
  var o : SpriteOut;
  o.pos = frame.viewProj * vec4f(w, 1.0);
  o.rel = c;
  o.id = id;
  o.dist = dist;
  o.facing = smoothstep(-0.1, 0.3, dot(dirCam, normalize(quadRot() * normal)));
  return o;
}

// Display value of the sun's reflection in the lens dome: brightest when the half vector between sun and eye lines up with the lens axis.
fn lensGlint(dirCam : vec3f) -> f32 {
  let axis = normalize(quadRot() * quad.lens.xyz);
  let h = normalize(dirCam + frame.sunDir.xyz);
  let sunT = sampleTransmittance(atmosRadiusAtHeight(frame.camPos.y), max(frame.sunDir.y, 0.0));
  return quad.lens.w * pow(saturate1(dot(h, axis)), 24.0) * frame.sunIrradiance.w * saturate1(luminance(sunT) * 2.0);
}

@fragment fn fsSprite(in : SpriteOut) -> @location(0) vec4f {
  let r2 = dot(in.rel, in.rel);
  let k = max(1.0 - r2, 0.0);
  let profile = k * k * exp(-2.0 * r2);
  var colour = vec3f(1.0, 0.97, 0.9);
  var shown = 0.0;
  if (in.id < 4u) {
    let led = quad.led[in.id];
    colour = led.rgb;
    shown = glowShown(led.a, 1.0);
  } else {
    shown = lensGlint(normalize(frame.camPos.xyz - (quad.model * vec4f(quad.sprite[4].xyz, 1.0)).xyz));
  }
  let ap = sampleAerialPerspective(in.pos.xy * frame.screen.zw, in.dist);
  return vec4f(colour * (shown * profile * in.facing) * ap.a, 0.0);
}

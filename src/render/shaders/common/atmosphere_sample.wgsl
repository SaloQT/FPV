// Atmosphere LUT sampling (Hillaire 2020, "A Scalable and Production Ready Sky and Atmosphere Rendering Technique").
// Include AFTER common/world_bindings.wgsl. The atmosphere module fills the LUTs with EXACTLY these parameterisations
// (the *Params functions below are the inverses it needs when rendering into a LUT texel).
//
// Radii are in km. Rb = frame.sky.x (planet), Rt = frame.sky.y (atmosphere top). World +Y is "up"; the planet centre is
// (0, -(Rb + datum), 0) far below, so local up is +Y everywhere in the few-km-wide world.
// Radius of a world-space height y:  r = Rb + frame.sky.z + (y - frame.camPos.y) / 1000   (sky.z = camera height above the datum, km).
//
// transmittanceLUT  rgba16float 256x64, rgb = transmittance from height r along zenith cosine mu to the atmosphere top (planet ignored).
//   uv = (x_mu, x_r);  H = sqrt(Rt^2 - Rb^2);  rho = sqrt(r^2 - Rb^2);  x_r = rho / H
//   d = -r*mu + sqrt(r^2*(mu^2-1) + Rt^2);  d_min = Rt - r;  d_max = rho + H;  x_mu = (d - d_min) / (d_max - d_min)
//   Texel (i,j) is generated at uv = ((i + 0.5) / 256, (j + 0.5) / 64) and sampled at uv directly (no sub-texel remap).
// multiScatterLUT   rgba16float 32x32, rgb = multiple-scattering luminance factor. uv = (mu_sun*0.5 + 0.5, (r - Rb) / (Rt - Rb)),
//   both remapped with unitToSubUv(., 32).
// skyViewLUT        rgba16float 192x108, rgb = sky radiance (nits, not pre-exposed) seen from the CAMERA radius r = Rb + frame.sky.z,
//   rebuilt every frame for the current sun. uv = skyViewUv(): v = zenith angle with the horizon at v = 0.5 and sqrt-compressed toward it
//   (upper half: sky, lower half: below the horizon), u = sqrt((1 - cosAz) / 2) where cosAz is the cosine of the azimuth between the
//   view and the sun measured on the horizontal plane. Both remapped with unitToSubUv (unit 0 and 1 land on the first and last texel centres). When rendering a texel, use
//   up = (0,1,0), sunDir = (sqrt(1 - mu_s^2), mu_s, 0), viewDir = (sinZ*cosAz, cosZ, sinZ*sqrt(1 - cosAz^2)) from skyViewParams().
// aerialPerspective rgba16float 32x32x32 froxels: xy = screen uv (texel centres), z = apDistanceToSlice(distance from the camera along the
//   pixel ray) with texel k centred at (k + 0.5) / 32. rgb = in-scattered radiance (nits, not pre-exposed) from the camera to that distance,
//   a = mean RGB transmittance over the same distance. Composite:  colour = colour * a + rgb.

const AP_SLICES : f32 = 32.0;
const AP_MAX_DISTANCE_M : f32 = 12000.0;
const AP_DEPTH_K : f32 = 6.0;

fn atmosRadiusAtHeight(worldY : f32) -> f32 {
  return max(frame.sky.x + frame.sky.z + (worldY - frame.camPos.y) * 0.001, frame.sky.x + 1e-4);
}

fn unitToSubUv(u : f32, res : f32) -> f32 { return (u * (res - 1.0) + 0.5) / res; }
fn subUvToUnit(u : f32, res : f32) -> f32 { return (u - 0.5 / res) * (res / (res - 1.0)); }

fn transmittanceUv(r : f32, mu : f32) -> vec2f {
  let rb = frame.sky.x;
  let rt = frame.sky.y;
  let h = sqrt(max(rt * rt - rb * rb, 0.0));
  let rho = sqrt(max(r * r - rb * rb, 0.0));
  let d = max(0.0, -r * mu + sqrt(max(r * r * (mu * mu - 1.0) + rt * rt, 0.0)));
  let dMin = rt - r;
  let dMax = rho + h;
  return vec2f(saturate1((d - dMin) / max(dMax - dMin, 1e-6)), saturate1(rho / h));
}

// Inverse of transmittanceUv: returns (r, mu) for a LUT uv.
fn transmittanceParams(uv : vec2f) -> vec2f {
  let rb = frame.sky.x;
  let rt = frame.sky.y;
  let h = sqrt(max(rt * rt - rb * rb, 0.0));
  let rho = h * uv.y;
  let r = sqrt(rho * rho + rb * rb);
  let dMin = rt - r;
  let dMax = rho + h;
  let d = dMin + uv.x * (dMax - dMin);
  let mu = select(clamp((h * h - rho * rho - d * d) / (2.0 * r * d), -1.0, 1.0), 1.0, d == 0.0);
  return vec2f(r, mu);
}

fn sampleTransmittance(r : f32, mu : f32) -> vec3f {
  return textureSampleLevel(transmittanceLUT, linearClamp, transmittanceUv(r, mu), 0.0).rgb;
}

// Cosine of the azimuth between a direction and the sun, both projected on the horizontal plane (1 when either is vertical).
fn azimuthCosToSun(dir : vec3f) -> f32 {
  let s = vec2f(frame.sunDir.x, frame.sunDir.z);
  let v = vec2f(dir.x, dir.z);
  let sl = length(s);
  let vl = length(v);
  if (sl < 1e-5 || vl < 1e-5) { return 1.0; }
  return dot(s, v) / (sl * vl);
}

fn skyViewUv(dir : vec3f, r : f32) -> vec2f {
  let rb = frame.sky.x;
  let cosBeta = sqrt(max(r * r - rb * rb, 0.0)) / r;
  let beta = acos(cosBeta);
  let zenithHorizon = PI - beta;
  let zenith = acos(clamp(dir.y, -1.0, 1.0));
  var v : f32;
  if (zenith < zenithHorizon) {
    v = (1.0 - sqrt(1.0 - zenith / zenithHorizon)) * 0.5;
  } else {
    v = sqrt(saturate1((zenith - zenithHorizon) / beta)) * 0.5 + 0.5;
  }
  let u = sqrt(saturate1(0.5 - 0.5 * azimuthCosToSun(dir)));
  return vec2f(unitToSubUv(u, 192.0), unitToSubUv(v, 108.0));
}

// Inverse of skyViewUv for camera radius r: returns (cos zenith, cos azimuth-to-sun).
fn skyViewParams(uv : vec2f, r : f32) -> vec2f {
  let rb = frame.sky.x;
  let u = subUvToUnit(uv.x, 192.0);
  let v = subUvToUnit(uv.y, 108.0);
  let cosBeta = sqrt(max(r * r - rb * rb, 0.0)) / r;
  let beta = acos(cosBeta);
  let zenithHorizon = PI - beta;
  var cosZenith : f32;
  if (v < 0.5) {
    let c = 1.0 - 2.0 * v;
    cosZenith = cos(zenithHorizon * (1.0 - c * c));
  } else {
    let c = 2.0 * v - 1.0;
    cosZenith = cos(zenithHorizon + beta * c * c);
  }
  return vec2f(cosZenith, 1.0 - 2.0 * u * u);
}

// Sky radiance (nits, not pre-exposed) toward a world direction from the camera's radius.
fn sampleSkyView(dir : vec3f) -> vec3f {
  let uv = skyViewUv(dir, frame.sky.x + frame.sky.z);
  return textureSampleLevel(skyViewLUT, linearClamp, uv, 0.0).rgb;
}

fn apSliceToDistance(w : f32) -> f32 {
  return AP_MAX_DISTANCE_M * (exp(AP_DEPTH_K * w) - 1.0) / (exp(AP_DEPTH_K) - 1.0);
}
fn apDistanceToSlice(d : f32) -> f32 {
  return log(1.0 + d * (exp(AP_DEPTH_K) - 1.0) / AP_MAX_DISTANCE_M) / AP_DEPTH_K;
}

// rgb = in-scatter (nits), a = transmittance; faded to (0, 1) inside the first froxel where the LUT has no data.
fn sampleAerialPerspective(screenUv : vec2f, distanceM : f32) -> vec4f {
  let ap = textureSampleLevel(aerialPerspective, linearClamp, vec3f(screenUv, apDistanceToSlice(distanceM)), 0.0);
  let fade = saturate1(distanceM / apSliceToDistance(0.5 / AP_SLICES));
  return vec4f(ap.rgb * fade, mix(1.0, ap.a, fade));
}

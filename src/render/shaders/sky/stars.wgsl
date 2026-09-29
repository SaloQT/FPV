// Stars and planets: one instanced quad each, added (one, one) onto the sky already in the HDR target. Depth test 'equal' against the
// cleared depth 0: a direction has clip z = 0 exactly, so the quad only lands on pixels no geometry covered.
//
// UNIT CHAIN: a star of apparent magnitude m gives an illuminance E = 10^(-0.4 (m + 14.18)) lux at the observer (src/world/astro/stars.ts
// magToIlluminance). The point-spread function spreads E over pixels; a pixel that receives the fraction f of it shows the radiance
// L = f E / Omega_pixel [lux / sr = nits], Omega_pixel = (2 / (proj[1][1] height))^2 cos^3(theta): the pixel's solid angle at the screen
// centre, shrunk by the rectilinear projection at theta off the view axis (cos theta = clip.w of a unit direction). Colour is the B-V colour with
// luminance 1 (starData.ts), times the LUT transmittance along the star's direction (extinction and reddening through the air mass),
// times the sky's cloud transmittance, times frame.params.y (pre-exposure) once. f is the Gaussian PSF (sigma STAR_SIGMA px) integrated
// over the pixel box with erf, so the flux stays 1 whatever the sub-pixel position and TAA jitter. Stars of magnitude <= 2 also get a
// wider halo and a four-point diffraction cross, both carrying part of the flux so the total is unchanged.
//
// Instance data: (direction xyz, magnitude), (colour rgb, id). Stars: direction is J2000 equatorial and is rotated by frame.celestial;
// planets (id >= 1000): the direction is already a world direction.
#include "common/world_bindings.wgsl"
#include "common/atmosphere_sample.wgsl"
#include "sky/atmos_params.wgsl"
#include "sky/atmos_uniforms.wgsl"

@group(2) @binding(0) var<uniform> ap : AtmosParams;
@group(2) @binding(4) var cloudTex : texture_2d<f32>;

const STAR_SIGMA : f32 = 0.7;
const HALO_FRACTION_MAX : f32 = 0.12;
const SPIKE_FRACTION_MAX : f32 = 0.10;
const SPIKE_SIGMA : f32 = 0.8;
const CULL_EXPOSED : f32 = 1.0 / 1024.0;
const CORE_PEAK : f32 = 0.27;
const STAR_LUX_ZERO_MAG : f32 = 14.18;
const MIN_COS_OFF_AXIS : f32 = 0.1;
const PEAK_LIMIT : f32 = 30000.0;

struct VsOut {
  @builtin(position) pos : vec4f,
  @location(0) local : vec2f,
  @location(1) @interpolate(flat) radiance : vec3f,
  @location(2) @interpolate(flat) shape : vec4f,
};

fn erf1(x : f32) -> f32 {
  let x2 = x * x;
  let t = x2 * (4.0 / PI + 0.147 * x2) / (1.0 + 0.147 * x2);
  return sign(x) * sqrt(1.0 - exp(-t));
}

// Fraction of a unit Gaussian (sigma in px) landing inside the pixel box centred x pixels from the star, along one axis.
fn boxGauss(x : f32, sigma : f32) -> f32 {
  let k = 1.0 / (sigma * 1.41421356);
  return 0.5 * (erf1((x + 0.5) * k) - erf1((x - 0.5) * k));
}

fn kastenYoungAirMass(cosZ : f32) -> f32 {
  let c = max(cosZ, 0.0);
  let zDeg = acos(c) * (180.0 / PI);
  return 1.0 / (c + 0.50572 * pow(96.07995 - zDeg, -1.6364));
}

// Scintillation: smooth multiplicative flicker whose amplitude grows with the air mass, plus a little chromatic flashing near the horizon.
fn twinkle(id : f32, airMass : f32, planet : bool) -> vec3f {
  let amp = ap.flags.w * min(0.7, 0.02 + 0.03 * pow(airMass, 1.75)) * select(1.0, 0.25, planet);
  let t = frame.camPos.w;
  let h = hash11(u32(id));
  let a = sin(t * (9.0 + 5.0 * h) + h * 61.0);
  let b = sin(t * (23.0 + 7.0 * fract(h * 7.3)) + h * 113.0);
  let c = sin(t * (14.0 + 6.0 * fract(h * 3.1)) + h * 37.0);
  let n = 0.6 * a + 0.4 * b;
  return max(vec3f(0.0), vec3f(1.0 + amp * n) + vec3f(c, -c, 0.5 * c) * (0.3 * amp * saturate1((airMass - 1.5) / 4.0)));
}

@vertex
fn vs(@builtin(vertex_index) vi : u32, @location(0) dirMag : vec4f, @location(1) colorId : vec4f) -> VsOut {
  var o : VsOut;
  o.pos = vec4f(0.0, 0.0, 2.0, 1.0);
  o.local = vec2f(0.0);
  o.radiance = vec3f(0.0);
  o.shape = vec4f(0.0);

  let planet = colorId.w >= 1000.0;
  let m = mat3x3f(frame.celestial[0].xyz, frame.celestial[1].xyz, frame.celestial[2].xyz);
  let dir = normalize(select(m * dirMag.xyz, dirMag.xyz, planet));
  let mag = dirMag.w;
  let r = frame.sky.x + frame.sky.z;
  if (ap.sky2.y < 0.5 || (!planet && mag > ap.sky2.w) || planetVisibility(vec3f(0.0, r, 0.0), dir) < 0.5) { return o; }
  if (dot(dir, frame.moonDir.xyz) > cos(frame.moonDir.w) || dot(dir, frame.sunDir.xyz) > cos(frame.sunDir.w)) { return o; }

  let bright = saturate1((2.0 - mag) / 3.5);
  let haloFrac = HALO_FRACTION_MAX * bright;
  let spikeFrac = SPIKE_FRACTION_MAX * bright;
  let haloSigma = 1.6 + 1.6 * bright;
  let spikeLen = 6.0 + 14.0 * bright;
  let extent = select(3.0, max(3.5 * spikeLen, 4.5 * haloSigma), bright > 0.0);

  let clip = frame.viewProj * vec4f(dir, 0.0);
  if (clip.w <= 1e-6) { return o; }
  let ndc = clip.xy / clip.w;
  let perPx = 2.0 * frame.screen.zw;
  if (any(abs(ndc) > vec2f(1.0) + perPx * (extent + 1.0))) { return o; }

  let pixelAngle = 2.0 / (frame.proj[1][1] * frame.screen.y);
  let cosOff = max(clip.w, MIN_COS_OFF_AXIS);
  let pixelOmega = pixelAngle * pixelAngle * cosOff * cosOff * cosOff;
  let lux = pow(10.0, -0.4 * (mag + STAR_LUX_ZERO_MAG)) * ap.flags.z;
  let air = kastenYoungAirMass(dir.y);
  let trans = sampleTransmittance(r, max(dir.y, 0.0));
  let uv = clamp(vec2f(ndc.x * 0.5 + 0.5, 0.5 - ndc.y * 0.5), vec2f(0.0), vec2f(1.0));
  let cloud = textureSampleLevel(cloudTex, linearClamp, uv, 0.0).a;
  var radiance = colorId.rgb * trans * twinkle(colorId.w, air, planet) * (lux * cloud * frame.params.y / pixelOmega);
  let peak = max(radiance.r, max(radiance.g, radiance.b)) * CORE_PEAK;
  if (peak < CULL_EXPOSED) { return o; }
  // The additive blend must not push the half-float target to infinity, whatever the exposure and the off-axis gain.
  radiance *= min(1.0, PEAK_LIMIT / peak);

  var corners = array<vec2f, 6>(vec2f(-1.0, -1.0), vec2f(1.0, -1.0), vec2f(-1.0, 1.0), vec2f(-1.0, 1.0), vec2f(1.0, -1.0), vec2f(1.0, 1.0));
  let corner = corners[vi];
  o.pos = vec4f(ndc + vec2f(corner.x, -corner.y) * perPx * extent, 0.0, 1.0);
  o.local = corner * extent;
  o.radiance = radiance;
  o.shape = vec4f(haloFrac, haloSigma, spikeFrac, spikeLen);
  return o;
}

@fragment
fn fs(in : VsOut) -> @location(0) vec4f {
  let d = in.local;
  let haloFrac = in.shape.x;
  let haloSigma = in.shape.y;
  let spikeFrac = in.shape.z;
  let spikeLen = in.shape.w;
  var f = boxGauss(d.x, STAR_SIGMA) * boxGauss(d.y, STAR_SIGMA) * (1.0 - haloFrac - spikeFrac);
  if (haloFrac > 0.0) {
    f += haloFrac * exp(-dot(d, d) / (2.0 * haloSigma * haloSigma)) / (TAU * haloSigma * haloSigma);
    let fall = vec2f(1.0 / sq(1.0 + abs(d.x) / spikeLen), 1.0 / sq(1.0 + abs(d.y) / spikeLen));
    f += (spikeFrac / (4.0 * spikeLen)) * (boxGauss(d.y, SPIKE_SIGMA) * fall.x + boxGauss(d.x, SPIKE_SIGMA) * fall.y);
  }
  return vec4f(in.radiance * f, 0.0);
}

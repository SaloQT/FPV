// Atmosphere medium, phase functions and single-scattering step (Hillaire 2020). Include after common/math.wgsl + common/frame.wgsl
// and after common/atmosphere_sample.wgsl (needs sampleTransmittance, multiScatterLUT, unitToSubUv). Mirrors src/render/atmosphere/physics.ts.
//
// UNIT CHAIN: coefficients are per km, positions and step lengths in km, lights are illuminance in lux (top of atmosphere), phase
// functions are per steradian, so   radiance [nits] = lux * sum( T * sigma_s[1/km] * phase[1/sr] * T_light * ds[km] ).
// Planet-centred coordinates: the camera is at (0, Rb + frame.sky.z, 0); +Y is local up at the camera.

const RAYLEIGH_SCATTER : vec3f = vec3f(5.802e-3, 13.558e-3, 33.1e-3);
const RAYLEIGH_H : f32 = 8.0;
const MIE_SCATTER : f32 = 0.092;
const MIE_EXTINCTION : f32 = 0.1;
const MIE_H : f32 = 1.4;
const MIE_G : f32 = 0.76;
const MIE_BACK_G : f32 = -0.3;
const MIE_BACK_WEIGHT : f32 = 0.2;
const OZONE_ABSORB : vec3f = vec3f(0.65e-3, 1.881e-3, 0.085e-3);
const OZONE_CENTER : f32 = 25.0;
const OZONE_HALF : f32 = 15.0;
const GROUND_ALBEDO : f32 = 0.3;

struct Medium {
  scatterR : vec3f,
  scatterM : f32,
  extinction : vec3f,
};

fn mediumAt(heightKm : f32) -> Medium {
  let h = max(heightKm, 0.0);
  let dR = exp(-h / RAYLEIGH_H);
  let dM = exp(-h / MIE_H);
  let dO = max(0.0, 1.0 - abs(h - OZONE_CENTER) / OZONE_HALF);
  var m : Medium;
  m.scatterR = RAYLEIGH_SCATTER * dR;
  m.scatterM = MIE_SCATTER * dM;
  m.extinction = m.scatterR + vec3f(MIE_EXTINCTION * dM) + OZONE_ABSORB * dO;
  return m;
}

fn rayleighPhase(c : f32) -> f32 { return (3.0 / (16.0 * PI)) * (1.0 + c * c); }

fn cornetteShanksPhase(c : f32, g : f32) -> f32 {
  let g2 = g * g;
  return (3.0 / (8.0 * PI)) * ((1.0 - g2) * (1.0 + c * c)) / ((2.0 + g2) * pow(max(1.0 + g2 - 2.0 * g * c, 1e-4), 1.5));
}

fn hgPhase(c : f32, g : f32) -> f32 {
  let g2 = g * g;
  return (1.0 - g2) / (4.0 * PI * pow(max(1.0 + g2 - 2.0 * g * c, 1e-4), 1.5));
}

// Forward aureole lobe plus a weak back lobe; mirrors miePhase() in physics.ts.
fn miePhase(c : f32) -> f32 {
  return (1.0 - MIE_BACK_WEIGHT) * cornetteShanksPhase(c, MIE_G) + MIE_BACK_WEIGHT * hgPhase(c, MIE_BACK_G);
}

// Near and far distances of the ray o + t d against a sphere of radius R centred at the origin; x > y means no hit.
fn raySphere(o : vec3f, d : vec3f, radius : f32) -> vec2f {
  let b = dot(o, d);
  let c = dot(o, o) - radius * radius;
  let disc = b * b - c;
  if (disc < 0.0) { return vec2f(1.0, -1.0); }
  let s = sqrt(disc);
  return vec2f(-b - s, -b + s);
}

// 1 if the ray from p toward lightDir clears the planet, 0 if the planet blocks it (Earth's shadow).
fn planetVisibility(p : vec3f, lightDir : vec3f) -> f32 {
  let b = dot(p, lightDir);
  let c = dot(p, p) - frame.sky.x * frame.sky.x;
  return select(1.0, 0.0, b < 0.0 && b * b - c > 0.0);
}

fn sampleMultiScatter(r : f32, muLight : f32) -> vec3f {
  let uv = vec2f(unitToSubUv(muLight * 0.5 + 0.5, 32.0), unitToSubUv(saturate1((r - frame.sky.x) / (frame.sky.y - frame.sky.x)), 32.0));
  return textureSampleLevel(multiScatterLUT, linearClamp, uv, 0.0).rgb;
}

struct StepResult {
  dL : vec3f,
  trans : vec3f,
};

// One segment [p, p + dir*dt] lit by a collimated light of illuminance lightE. dL is the radiance gathered over the segment
// (to be weighted by the throughput at its start), trans the segment transmittance. Analytic integration of S*T over the step.
fn scatterStep(p : vec3f, dir : vec3f, dt : f32, lightDir : vec3f, lightE : vec3f) -> StepResult {
  let r = length(p);
  let med = mediumAt(r - frame.sky.x);
  let up = p / r;
  let muL = dot(up, lightDir);
  let c = dot(dir, lightDir);
  let direct = sampleTransmittance(r, muL) * planetVisibility(p, lightDir) * (med.scatterR * rayleighPhase(c) + vec3f(med.scatterM * miePhase(c)));
  let multi = sampleMultiScatter(r, muL) * (med.scatterR + vec3f(med.scatterM));
  let s = lightE * (direct + multi);
  let stepT = exp(-med.extinction * dt);
  var res : StepResult;
  res.dL = (s - s * stepT) / max(med.extinction, vec3f(1e-9));
  res.trans = stepT;
  return res;
}

// Radiance leaving the ground point pg toward the camera when lit by lightE (Lambert, albedo GROUND_ALBEDO), before path attenuation.
fn groundRadianceAt(pg : vec3f, lightDir : vec3f, lightE : vec3f) -> vec3f {
  let r = length(pg);
  let muG = dot(pg / r, lightDir);
  return lightE * sampleTransmittance(r, muG) * max(muG, 0.0) * (GROUND_ALBEDO * INV_PI);
}

// Sky-view uv from a zenith cosine and the cosine of the azimuth to the light (same map as skyViewUv() in common/atmosphere_sample.wgsl).
fn skyViewUvCos(cosZenith : f32, cosAz : f32, r : f32) -> vec2f {
  let rb = frame.sky.x;
  let beta = acos(sqrt(max(r * r - rb * rb, 0.0)) / r);
  let zenithHorizon = PI - beta;
  let zenith = acos(clamp(cosZenith, -1.0, 1.0));
  var v : f32;
  if (zenith < zenithHorizon) {
    v = (1.0 - sqrt(1.0 - zenith / zenithHorizon)) * 0.5;
  } else {
    v = sqrt(saturate1((zenith - zenithHorizon) / beta)) * 0.5 + 0.5;
  }
  let u = sqrt(saturate1(0.5 - 0.5 * cosAz));
  return vec2f(unitToSubUv(u, 192.0), unitToSubUv(v, 108.0));
}

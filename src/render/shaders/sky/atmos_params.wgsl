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
// Boundary-layer haze: the aerosol of the mixed layer over the land, its density falling from the land datum (the observer's altitude, where
// the terrain stands) with a short scale height. The MIE layer above runs from sea level, so at an upland site it left the valley air nearly
// clean (about 70 km visibility) and mountains 5-10 km away as crisp as the foreground; with this layer the air near the ground sees about
// 34 km, as on a clear summer day, while a vertical path gains only about 0.03 optical depth and the zenith keeps its blue. Mirrors physics.ts.
const HAZE_SCATTER : f32 = 0.055;
const HAZE_EXTINCTION : f32 = 0.06;
const HAZE_H : f32 = 0.5;
const MIE_G : f32 = 0.6;
const MIE_NARROW_G : f32 = 0.96;
const MIE_NARROW_WEIGHT : f32 = 0.12;
const MIE_SIDE_G : f32 = 0.3;
const MIE_SIDE_WEIGHT : f32 = 0.22;
const MIE_BACK_G : f32 = -0.3;
const MIE_BACK_WEIGHT : f32 = 0.16;
const OZONE_ABSORB : vec3f = vec3f(1.5e-3, 1.65e-3, 0.09e-3);
const OZONE_CENTER : f32 = 25.0;
const OZONE_HALF : f32 = 15.0;
const GROUND_ALBEDO : f32 = 0.3;
const MOON_SCATTER_TINT : vec3f = vec3f(0.92, 1.0, 1.1);
const MS_DIPOLE : f32 = 0.8;
const MS_DIPOLE_MU_LO : f32 = -0.1;
const MS_DIPOLE_MU_HI : f32 = 0.03;

struct Medium {
  scatterR : vec3f,
  scatterM : f32,
  extinction : vec3f,
};

// Height of the land datum above sea level (km): the camera's height above sea level less its height in the world.
fn hazeDatumKm() -> f32 { return max(frame.sky.z - frame.camPos.y * 0.001, 0.0); }

fn mediumAt(heightKm : f32) -> Medium {
  let h = max(heightKm, 0.0);
  let dR = exp(-h / RAYLEIGH_H);
  let dM = exp(-h / MIE_H);
  let dH = exp(-max(h - hazeDatumKm(), 0.0) / HAZE_H);
  let dO = max(0.0, 1.0 - abs(h - OZONE_CENTER) / OZONE_HALF);
  var m : Medium;
  m.scatterR = RAYLEIGH_SCATTER * dR;
  m.scatterM = MIE_SCATTER * dM + HAZE_SCATTER * dH;
  m.extinction = m.scatterR + vec3f(MIE_EXTINCTION * dM + HAZE_EXTINCTION * dH) + OZONE_ABSORB * dO;
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

// Narrow glare peak, broad forward lobe, side lobe and weak back lobe; mirrors miePhase() in physics.ts.
fn miePhase(c : f32) -> f32 {
  let broad = 1.0 - MIE_NARROW_WEIGHT - MIE_SIDE_WEIGHT - MIE_BACK_WEIGHT;
  return broad * cornetteShanksPhase(c, MIE_G) + MIE_NARROW_WEIGHT * hgPhase(c, MIE_NARROW_G)
    + MIE_SIDE_WEIGHT * hgPhase(c, MIE_SIDE_G) + MIE_BACK_WEIGHT * hgPhase(c, MIE_BACK_G);
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

// Twilight anisotropy of the multiple-scattering term (see multiScatterDipole() in physics.ts); dir . horizontal light direction at the zenith is 0.
fn multiScatterDipole(muL : f32, lightDir : vec3f, dir : vec3f) -> f32 {
  let hl = length(lightDir.xz);
  if (hl < 1e-4) { return 1.0; }
  return 1.0 + MS_DIPOLE * (1.0 - smoothstep(MS_DIPOLE_MU_LO, MS_DIPOLE_MU_HI, muL)) * (dot(dir.xz, lightDir.xz) / hl);
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
  let multi = sampleMultiScatter(r, muL) * (med.scatterR + vec3f(med.scatterM)) * multiScatterDipole(muL, lightDir, dir);
  let s = lightE * (direct + multi);
  let stepT = exp(-med.extinction * dt);
  var res : StepResult;
  res.dL = (s - s * stepT) / max(med.extinction, vec3f(1e-9));
  res.trans = stepT;
  return res;
}

// Albedo of the land seen past the terrain: the mean of meadow, forest and bare ground from the air (0.06-0.12, green-tinted).
const LANDSCAPE_ALBEDO : vec3f = vec3f(0.075, 0.095, 0.055);

// Radius (km) of the land surface round the camera. The planet's sphere is sea level, but the terrain stands at the observer's altitude
// (its datum) plus its own heights: rays that pass under the land's horizon but over the sea-level one used to graze 1-2 km of dense air
// and showed as a bright band (beige by day, orange at dawn, dark at night) between the last terrain ring and the sky. They hit the land.
fn landRadius(r : f32) -> f32 {
  let farH = frame.terrain.z + 0.35 * (frame.terrain.w - frame.terrain.z);
  return clamp(r - (frame.camPos.y - farH) * 0.001, frame.sky.x, r - 1e-4);
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

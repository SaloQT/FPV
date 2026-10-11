// Cloud lighting shared by the march and the shadow passes: which lights matter, phase functions, the multiple-scattering octave sum,
// the light march through the cumulus, and the ambient from the sky-view LUT.
//
// UNIT CHAIN: light illuminance E [lux, top of atmosphere, frame.sunIrradiance / frame.moonIrradiance] times the atmosphere transmittance
// to the sample and the planet's shadow gives the lux reaching it. In-scattered radiance per km of path is
//   sigma_s [1/km] * ( E_eff [lux] * phase [1/sr] * exp(-tau_light) + L_ambient [nits] )
// with sigma_s = sigma_e (cloud droplets do not absorb). Integrated analytically over a step of optical depth tau_s = sigma_e * ds [km]:
//   dL [nits] = T * (E_eff * msPhase + L_ambient) * (1 - exp(-tau_s)) ; T *= exp(-tau_s)
// so sigma_e cancels and the radiance stays in nits (never pre-exposed).
#include "sky/cloud_density.wgsl"

const PHASE_G_FORWARD : f32 = 0.8;
const PHASE_G_BACK : f32 = -0.3;
const PHASE_FORWARD_WEIGHT : f32 = 0.7;
const MS_ENERGY : f32 = 0.5;
const MS_EXTINCTION : f32 = 0.5;
const MS_ANISOTROPY : f32 = 0.5;
const LIGHT_STEP_KM : f32 = 0.06;
const LIGHT_DETAIL_STEPS : i32 = 2;
const AMBIENT_FLOOR : f32 = 0.75;
// Share of the sky light falling on a cloud's top that multiple scattering carries down through it to its base. Without it a base is lit
// only by the ground's bounce, which at night (no direct light, a dark ground) leaves the clouds as black cut-outs against the airglow and
// starlight; real clouds pass a good part of the light down (a thick cumulus deck still lets through a fifth to a half).
const DIFFUSE_THROUGH : f32 = 0.6;

struct CloudLight {
  dir : vec3f,
  toa : vec3f,
  w : f32,
};

struct CloudLights {
  sun : CloudLight,
  moon : CloudLight,
};

struct Ambient {
  top : vec3f,
  bottom : vec3f,
};

// Sun and moon as cloud lights. A light is marched (w = 1) only if its illuminance at the layer is within 50x of the brighter one:
// at night the sun is off, by day the moon is, and both run only in the twilight overlap.
fn cloudLights(rMid : f32) -> CloudLights {
  let p = vec3f(0.0, rMid, 0.0);
  var res : CloudLights;
  res.sun.dir = frame.sunDir.xyz;
  res.sun.toa = frame.sunIrradiance.rgb;
  res.moon.dir = frame.moonDir.xyz;
  res.moon.toa = frame.moonIrradiance.rgb * select(0.0, 1.0, ap.flags.x > 0.5);
  let ls = luminance(res.sun.toa * sampleTransmittance(rMid, res.sun.dir.y)) * planetVisibility(p, res.sun.dir);
  let lm = luminance(res.moon.toa * sampleTransmittance(rMid, res.moon.dir.y)) * planetVisibility(p, res.moon.dir);
  let top = max(ls, lm);
  res.sun.w = select(0.0, 1.0, ls > 0.02 * top && ls > 0.0);
  res.moon.w = select(0.0, 1.0, lm > 0.02 * top && lm > 0.0);
  return res;
}

// Light reaching the point p (planet-centred km, radius r) from a light: TOA illuminance x transmittance x planet shadow.
fn lightAt(l : CloudLight, p : vec3f, r : f32) -> vec3f {
  return l.toa * sampleTransmittance(r, dot(p, l.dir) / r) * planetVisibility(p, l.dir);
}

// Dual-lobe Henyey-Greenstein; ecc scales both lobes' anisotropy (the multiple-scattering octaves use it to widen the phase).
fn cloudPhase(c : f32, ecc : f32) -> f32 {
  return mix(hgPhase(c, PHASE_G_BACK * ecc), hgPhase(c, PHASE_G_FORWARD * ecc), PHASE_FORWARD_WEIGHT);
}

// Multiple-scattering octave sum (Wrenninge 2015, Hillaire 2016): octave i carries energy MS_ENERGY^i, sees the optical depth to the
// light shrunk by MS_EXTINCTION^i (multiply-scattered light reaches deeper) and a phase that is MS_ANISOTROPY^i as directional.
fn cloudInscatter(c : f32, tauLight : f32) -> f32 {
  var sum = 0.0;
  var a = 1.0;
  var b = 1.0;
  var e = 1.0;
  for (var i = 0; i < 3; i++) {
    sum += a * exp(-tauLight * b) * cloudPhase(c, e);
    a *= MS_ENERGY;
    b *= MS_EXTINCTION;
    e *= MS_ANISOTROPY;
  }
  return sum;
}

// Beer-Powder (Schneider 2015): thin cloud edges scatter less than Beer's law alone suggests when seen away from the light.
fn powderTerm(sigmaE : f32, c : f32) -> f32 {
  return mix(1.0, 1.0 - exp(-2.0 * sigmaE * 0.1), 0.5 * (1.0 - c));
}

// Diffuse transmission of the light through the cloud: light that has scattered many times on its way in arrives from every direction,
// and a thick cloud passes a good share of it (two-stream, conservative scattering: T = 1 / (1 + 0.75 tau (1 - g)), a fifth through
// tau 30). It is what makes a cumulus base grey-white instead of sky-blue and its shaded flanks soft grey instead of black, while the
// single-scattering octaves keep the bright, crisp sunlit billows.
const DIFFUSE_SHARE : f32 = 0.3;
const DIFFUSE_G : f32 = 0.85;

// The slab formula holds for a cloud wider than it is deep; a cumulus loses diffuse light out of its sides, so it also fades with the
// depth to the light (DIFFUSE_LEAK per unit of optical depth), which keeps the far side of a low-sun cloud in shade.
const DIFFUSE_LEAK : f32 = 0.04;

fn cloudDiffuse(tauLight : f32) -> f32 {
  return DIFFUSE_SHARE * INV_PI * exp(-DIFFUSE_LEAK * tauLight) / (1.0 + 0.75 * (1.0 - DIFFUSE_G) * tauLight);
}

// Optical depth from p toward l through the cumulus: `steps` samples at exponentially growing spacing (60 m doubling), ending once
// the ray has left the layer. `nearDetail` puts the erosion detail into the first LIGHT_DETAIL_STEPS steps (60 + 120 m), so the small
// billows shade each other (sunlit cauliflower tops over darker crevices, a mottled base from below); the rest of the path is far
// enough that the mean erosion stands in for it.
fn cumulusLightTau(p : vec3f, l : vec3f, steps : i32, datumR : f32, nearDetail : f32) -> f32 {
  var tau = 0.0;
  var t = 0.0;
  var ds = LIGHT_STEP_KM;
  for (var i = 0; i < steps; i++) {
    let q = p + l * (t + 0.5 * ds);
    let rq = length(q);
    let h = rq - datumR;
    let rising = dot(q, l) > 0.0;
    if ((h > ap.cloudB.y && rising) || (h < ap.cloudB.x && !rising)) { break; }
    tau += CUMULUS_SIGMA_KM * ap.cloudA.z * cumulusDensity(layerPlane(q, ap.wind.xy), h, select(0.0, nearDetail, i < LIGHT_DETAIL_STEPS)) * ds;
    t += ds;
    ds *= 2.0;
  }
  return tau;
}

// Ambient radiance (nits) around the cloud layer: the sky hemisphere from the world sky-view LUT, and the ground's bounce (Lambert
// albedo LANDSCAPE_ALBEDO, lit by the direct light and the sky, dimmed by the cloud cover's own shadow on the ground).
fn cloudAmbient(lights : CloudLights, rGround : f32) -> Ambient {
  let s = 0.70710678;
  var res : Ambient;
  res.top = 0.4 * sampleSkyView(vec3f(0.0, 1.0, 0.0))
    + 0.15 * (sampleSkyView(vec3f(s, s, 0.0)) + sampleSkyView(vec3f(-s, s, 0.0)) + sampleSkyView(vec3f(0.0, s, s)) + sampleSkyView(vec3f(0.0, s, -s)));
  // The sky near the horizon lights a cloud's sides: by day it is about as bright as the zenith, but at night the airglow is several times
  // brighter there (the slant path through its shell), and it is what keeps distant clouds grey instead of black.
  let horizon = sampleSkyView(vec3f(0.98, 0.2, 0.0)) + sampleSkyView(vec3f(-0.98, 0.2, 0.0)) + sampleSkyView(vec3f(0.0, 0.2, 0.98)) + sampleSkyView(vec3f(0.0, 0.2, -0.98));
  res.top = 0.8 * res.top + 0.05 * horizon;
  let p = vec3f(0.0, rGround, 0.0);
  let direct = lights.sun.toa * sampleTransmittance(rGround, lights.sun.dir.y) * (max(lights.sun.dir.y, 0.0) * planetVisibility(p, lights.sun.dir) * lights.sun.w)
    + lights.moon.toa * sampleTransmittance(rGround, lights.moon.dir.y) * (max(lights.moon.dir.y, 0.0) * planetVisibility(p, lights.moon.dir) * lights.moon.w);
  // The land under the clouds (meadow, forest, fields) reflects about 0.1, not the grey 0.3 of the atmosphere's multiple-scattering ground:
  // a sunlit 0.3 lit a cumulus base from below brighter than the sky beside it, so the bases read flat cream instead of grey.
  res.bottom = LANDSCAPE_ALBEDO * (direct * INV_PI + res.top) * (1.0 - 0.6 * ap.cloudA.x) + DIFFUSE_THROUGH * res.top;
  return res;
}

// Ambient radiance inside the cumulus at height fraction hf: ground bounce at the base, sky at the top, never fully dark.
fn ambientAt(a : Ambient, hf : f32) -> vec3f {
  return mix(a.bottom, a.top, smoothstep(0.0, 1.0, hf)) * (AMBIENT_FLOOR + (1.0 - AMBIENT_FLOOR) * smoothstep(0.0, 0.6, hf));
}

// Share of the light on a cloud's top that diffuses down to a point tauLight (optical depth toward the light) inside it: the slab
// transmission with side leak of cloudDiffuse, without its share.
fn cloudThrough(tauLight : f32) -> f32 {
  return exp(-DIFFUSE_LEAK * tauLight) / (1.0 + 0.75 * (1.0 - DIFFUSE_G) * tauLight);
}

// ambientAt for a sample whose optical depth toward the key light is tauUp (negative when no light is marched). The sky light passed
// down through the cloud (DIFFUSE_THROUGH in a.bottom) is scaled by how much cloud stands above the sample, so a base under a deep
// tower is dark grey and one under a thin cap is pale: the mottled, dark-centred base of a cumulus seen from below, instead of an
// evenly lit underside.
fn ambientThroughAt(a : Ambient, hf : f32, tauUp : f32) -> vec3f {
  if (tauUp < 0.0) { return ambientAt(a, hf); }
  let lost = DIFFUSE_THROUGH * a.top * (1.0 - cloudThrough(tauUp)) * (1.0 - smoothstep(0.0, 1.0, hf)) * AMBIENT_FLOOR;
  return max(ambientAt(a, hf) - lost, vec3f(0.0));
}

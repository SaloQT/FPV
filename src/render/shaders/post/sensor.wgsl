// Sensor model: Poisson-Gaussian noise in exposed scene-linear light, plus the integer hashes shared with video.wgsl.
// Post passes do not bind the frame uniform, so these hashes are local instead of common/math.wgsl (which needs `frame`).

const TAU : f32 = 6.28318530717959;

// shot: signal variance per unit signal at the reference gain (~3000 e- full well); read: read-noise sigma at unity gain.
// Both scale with the ISO gain (shot as G, read as sqrt(G) after the analog stage), so the relative grain falls as the signal rises.
// The exposure's gain EV is the whole brightening over noon; the first shutterEv of it is shutter time and aperture, not ISO. The ISO stage
// stops at maxGainEv; the rest of a starlight exposure (up to +22.8 EV) is optics and frame integration, which add no noise of their own.
// nrFloor: the camera's temporal noise reduction cuts the noise amplitude to this share at the full ISO gain (1 = off), linearly in gain EV.
// chroma: share of the noise variance that is independent per channel (the rest is one luma-correlated draw): a camera's colour
// noise is weaker than its luma noise, and it does not grow towards the night.
struct SensorModel {
  shot : f32,
  read : f32,
  maxGainEv : f32,
  chroma : f32,
  shutterEv : f32,
  nrFloor : f32,
};
const SENSOR : SensorModel = SensorModel(3.0e-4, 4.0e-3, 10.0, 0.2, 4.0, 0.33);

fn pcgHash(v : u32) -> u32 {
  let s = v * 747796405u + 2891336453u;
  let w = ((s >> ((s >> 28u) + 4u)) ^ s) * 277803737u;
  return (w >> 22u) ^ w;
}

fn pcg3d(v : vec3u) -> vec3u {
  var x = v * 1664525u + 1013904223u;
  x.x += x.y * x.z; x.y += x.z * x.x; x.z += x.x * x.y;
  x = x ^ (x >> vec3u(16u));
  x.x += x.y * x.z; x.y += x.z * x.x; x.z += x.x * x.y;
  return x;
}

// Uniform in the open interval (0, 1): safe to feed to log().
fn unitOpen(h : u32) -> f32 { return (f32(h >> 8u) + 0.5) * (1.0 / 16777216.0); }

// Four independent standard normals (two Box-Muller pairs) for one pixel of one frame.
fn gauss4(pix : vec2u, frame : u32) -> vec4f {
  let h0 = pcg3d(vec3u(pix, frame));
  let h1 = pcg3d(h0 ^ vec3u(0x9e3779b9u));
  let ra = sqrt(-2.0 * log(unitOpen(h0.x)));
  let rb = sqrt(-2.0 * log(unitOpen(h1.x)));
  let pa = TAU * unitOpen(h0.y);
  let pb = TAU * unitOpen(h1.y);
  return vec4f(ra * cos(pa), ra * sin(pa), rb * cos(pb), rb * sin(pb));
}

// Additive noise for the exposed signal `c`. amp is the user's videoNoise scaled to a multiplier; gainEv is the sensor gain over daylight.
fn sensorNoise(c : vec3f, pix : vec2f, frame : u32, gainEv : f32, amp : f32) -> vec3f {
  let isoEv = clamp(gainEv - SENSOR.shutterEv, 0.0, SENSOR.maxGainEv - SENSOR.shutterEv);
  let gain = exp2(isoEv);
  let nr = mix(1.0, SENSOR.nrFloor, isoEv / (SENSOR.maxGainEv - SENSOR.shutterEv));
  let sigma = (amp * nr) * sqrt(SENSOR.shot * max(c, vec3f(0.0)) * gain + SENSOR.read * SENSOR.read * gain);
  let g = gauss4(vec2u(pix), frame);
  return (sqrt(1.0 - SENSOR.chroma) * g.w + sqrt(SENSOR.chroma) * g.xyz) * sigma;
}

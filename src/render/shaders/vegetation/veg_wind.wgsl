// Ambient wind, rotor prop wash and trample, shared by grass and trees. All bend results are (x, z) tilt angles in radians of the
// blade axis away from vertical, so callers just add them and clamp.
#include "vegetation/veg_params.wgsl"

const WASH_ROTOR_AREA : f32 = 0.0507;   // four 5" props: 4 * pi * 0.0635^2
const AIR_DENSITY : f32 = 1.2;

fn vegLattice(p : vec2f) -> f32 {
  let i = floor(p);
  let f = p - i;
  let u = f * f * (3.0 - 2.0 * f);
  let ip = bitcast<vec2u>(vec2i(i));
  let a = hash21(ip);
  let b = hash21(ip + vec2u(1u, 0u));
  let c = hash21(ip + vec2u(0u, 1u));
  let d = hash21(ip + vec2u(1u, 1u));
  return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
}

// Local air velocity (x, z) in m/s: gusts travel along the mean wind as two wave trains (about 57 m and 14 m long) that modulate the mean
// speed, plus turbulence advected by the flow.
fn windAt(pos : vec3f, t : f32) -> vec2f {
  let dir = vp.wind.xy;
  let speed = vp.wind.z;
  let along = dot(pos.xz, dir);
  let across = dot(pos.xz, vec2f(-dir.y, dir.x));
  let phase = along - 0.8 * speed * t;
  let g1 = 0.5 + 0.5 * sin(phase * 0.11 + 0.35 * sin(across * 0.05));
  let g2 = 0.5 + 0.5 * sin(phase * 0.46 + across * 0.13 + 1.7);
  let gust = 0.45 + 0.75 * g1 * (0.55 + 0.45 * g2);
  let adv = pos.xz * 0.55 - dir * speed * 0.5 * t;
  let turb = vec2f(vegLattice(adv), vegLattice(adv + vec2f(17.3, 4.1))) - vec2f(0.5);
  return dir * (speed * gust) + turb * (0.9 * speed);
}

// Prop wash: momentum-theory induced velocity of the four rotors, a turbulent jet that decays with distance below the quad, and a wall
// jet spreading outward along the ground. The footprint trails behind a moving quad. Returns (bend x, bend z, height squash 0..1).
fn washAt(root : vec3f, h : f32, t : f32, rnd : f32) -> vec3f {
  let thrust = vp.quad.w;
  if (thrust < 0.3) { return vec3f(0.0); }
  let vi = sqrt(thrust / (2.0 * AIR_DENSITY * WASH_ROTOR_AREA));
  let depth = vp.quad.y - root.y;
  if (depth < 0.02 || depth > 8.0) { return vec3f(0.0); }
  let lag = clamp(depth / (2.0 * vi), 0.0, 0.7);
  let centre = vp.quad.xz - vp.quadVel.xz * lag;
  let rel = root.xz - centre;
  let r = length(rel);
  let radial = select(vec2f(cos(rnd * TAU), sin(rnd * TAU)), rel / max(r, 1e-4), r > 0.02);
  let jet = 2.0 * vi * min(1.0, 0.75 / (depth + 0.05));
  let rp = 0.3 + 0.55 * depth;
  let x = r / rp;
  let u = jet * x * exp(1.0 - x);
  let mag = 1.5 * (1.0 - exp(-0.03 * u * u * (0.25 + 2.0 * h)));
  let swirl = vec2f(-radial.y, radial.x);
  let shiver = sin(t * 41.0 + rnd * 97.0) * 0.22 * mag + sin(t * 23.0 + rnd * 41.0) * 0.12 * mag;
  let dir = radial + 0.3 * swirl + 0.5 * shiver * swirl;
  let squash = saturate1(u / 9.0) * exp(-x * x);
  return vec3f(dir * (mag + shiver), squash);
}

// Body contact when the quad sits on or just above the grass: blades under the frame are pushed outward and flat.
fn trampleAt(root : vec3f) -> vec2f {
  let above = vp.quad.y - root.y;
  if (above > 0.6 || above < -0.2) { return vec2f(0.0); }
  let rel = root.xz - vp.quad.xz;
  let r = length(rel);
  if (r > 0.3) { return vec2f(0.0); }
  let k = 1.0 - r / 0.3;
  return rel / max(r, 1e-3) * (1.2 * k * k);
}

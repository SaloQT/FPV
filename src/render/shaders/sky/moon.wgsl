// Procedural Moon. Include after sky/atmos_uniforms.wgsl and the `ap : AtmosParams` binding (needs frame, ap, math.wgsl).
//
// UNIT CHAIN: albedo [-] * E_sun [lux at the moon, frame.sunIrradiance.rgb] / pi = radiance [nits] of a Lambertian patch facing the sun.
// Lommel-Seeliger (2 mu0 / (mu0 + mu), equal to 1 at full phase) times an opposition surge is the lunar phase function, so a full moon is
// ~4-5e3 nits at the disc centre, which integrates over the disc (pi R^2 sr) to the ~0.3 lux of frame.moonIrradiance. The result is
// multiplied by the atmospheric transmittance toward the moon by the caller (sky.wgsl).
//
// Disc frame: x = right, y = lunar north (the ecliptic pole projected on the sky), z = toward the observer. The near side faces Earth
// (libration ignored), so the selenographic longitude/latitude of a disc point (x,y,z) are atan2(x,z), asin(y): Mare Crisium (+59 deg)
// sits on the right, Tycho (-43 deg) at the bottom.

const MOON_HIGHLAND : vec3f = vec3f(0.128, 0.120, 0.106);
const MOON_MARE : vec3f = vec3f(0.064, 0.063, 0.062);
const EARTHSHINE_TINT : vec3f = vec3f(0.85, 0.97, 1.15);
const EARTHSHINE_FRACTION : f32 = 1.5e-3;
const SURGE_AMPLITUDE : f32 = 0.35;
const SURGE_WIDTH : f32 = 0.07;
const MARIA_COUNT : u32 = ${MARIA_ROWS}u / 2u;

fn vnoise3(p : vec3f) -> f32 {
  let i = floor(p);
  let f = fract(p);
  let u = f * f * (3.0 - 2.0 * f);
  let b = vec3u(vec3i(i));
  let a0 = mix(hash31(b), hash31(b + vec3u(1u, 0u, 0u)), u.x);
  let a1 = mix(hash31(b + vec3u(0u, 1u, 0u)), hash31(b + vec3u(1u, 1u, 0u)), u.x);
  let a2 = mix(hash31(b + vec3u(0u, 0u, 1u)), hash31(b + vec3u(1u, 0u, 1u)), u.x);
  let a3 = mix(hash31(b + vec3u(0u, 1u, 1u)), hash31(b + vec3u(1u, 1u, 1u)), u.x);
  return mix(mix(a0, a1, u.y), mix(a2, a3, u.y), u.z);
}

fn fbm3(p : vec3f) -> f32 {
  return 0.5 * vnoise3(p) + 0.25 * vnoise3(p * 2.03 + 11.7) + 0.125 * vnoise3(p * 4.11 + 23.1) + 0.0625 * vnoise3(p * 8.3 + 37.9);
}

// Smooth 1D value noise that repeats every `period` cells (rays around a crater close seamlessly at azimuth 2 pi).
fn periodicNoise1(x : f32, period : u32, salt : u32) -> f32 {
  let f = fract(x);
  let u = f * f * (3.0 - 2.0 * f);
  let n = i32(period);
  let i0 = u32(((i32(floor(x)) % n) + n) % n);
  let i1 = (i0 + 1u) % period;
  return mix(hash11(i0 + salt), hash11(i1 + salt), u);
}

// Dark maria: the strongest of the elliptical patches around the tabulated selenographic centres, with a noise-eroded edge.
fn mareMask(lon : f32, lat : f32, edgeNoise : f32) -> f32 {
  var m = 0.0;
  for (var k = 0u; k < MARIA_COUNT; k++) {
    let a = ap.maria[2u * k];
    let b = ap.maria[2u * k + 1u];
    if (b.w > 0.5) { continue; }
    let dx = (lon - a.x) * cos(0.5 * (lat + a.y));
    let dy = lat - a.y;
    let c = cos(b.z);
    let s = sin(b.z);
    let x = (dx * c + dy * s) / a.z;
    let y = (dy * c - dx * s) / a.w;
    let d = sqrt(x * x + y * y) * (1.0 + 0.35 * (edgeNoise - 0.5));
    m = max(m, b.x * (1.0 - smoothstep(1.0 - b.y, 1.0, d)));
  }
  return m;
}

// Bright ejecta blankets and radial rays of the young craters (Tycho, Copernicus, Kepler, Aristarchus, Proclus).
fn crater_rays(lon : f32, lat : f32, p : vec3f) -> f32 {
  var bright = 0.0;
  for (var k = 0u; k < MARIA_COUNT; k++) {
    let a = ap.maria[2u * k];
    let b = ap.maria[2u * k + 1u];
    if (b.w < 0.5) { continue; }
    let cl = cos(a.y);
    let c = vec3f(cl * sin(a.x), sin(a.y), cl * cos(a.x));
    let east = vec3f(cos(a.x), 0.0, -sin(a.x));
    let north = vec3f(-sin(a.y) * sin(a.x), cos(a.y), -sin(a.y) * cos(a.x));
    let t = p - c * dot(p, c);
    let arc = acos(clamp(dot(p, c), -1.0, 1.0));
    let az = atan2(dot(t, north), dot(t, east)) * (1.0 / TAU) + 0.5;
    let salt = 977u + 131u * k;
    let streak = periodicNoise1(az * 36.0, 36u, salt) * periodicNoise1(az * 13.0, 13u, salt + 61u);
    let ray = pow(streak, 1.5) * 2.4 * exp(-arc / (a.z * 26.0)) * smoothstep(a.z * 0.6, a.z * 1.8, arc);
    let halo = exp(-sq(arc / (a.z * 1.15)));
    bright = max(bright, b.x * (0.75 * halo + 0.55 * ray));
  }
  return bright;
}

struct CraterSample {
  albedo : f32,
  slope : vec3f,
};

// Hashed craters on three scales: 3D cells whose centres are jittered balls cut by the sphere, so the visible craters are circles.
fn craterLayer(p : vec3f, freq : f32, seed : u32, amount : f32, cs : ptr<function, CraterSample>) {
  let q = p * freq;
  let base = floor(q - 0.5);
  for (var i = 0u; i < 8u; i++) {
    let o = vec3f(f32(i & 1u), f32((i >> 1u) & 1u), f32((i >> 2u) & 1u));
    let cell = base + o;
    let h = pcg3(vec3u(vec3i(cell)) + vec3u(seed));
    if (u01(h.z) > 0.72) { continue; }
    let centre = cell + 0.3 + 0.4 * vec3f(u01(h.x), u01(h.y), u01(pcg(h.x + h.y)));
    let radius = 0.09 + 0.22 * pow(u01(pcg(h.z + 3u)), 2.0);
    let d = q - centre;
    let dl = length(d);
    let x = dl / radius;
    if (x > 2.2) { continue; }
    let fresh = select(0.0, 1.0, u01(pcg(h.y + 7u)) > 0.86);
    var dh = 0.0;
    if (x < 1.0) { dh = 2.0 * x; } else { dh = -3.2 * (x - 1.0) * exp(-sq((x - 1.0) / 0.35)) * 2.0; }
    let g = d / max(dl, 1e-5);
    let tangent = g - p * dot(g, p);
    (*cs).slope += tangent * dh * 0.34 * amount;
    (*cs).albedo *= 1.0 - 0.12 * amount * (1.0 - smoothstep(0.0, 1.0, x)) + 0.07 * amount * exp(-sq((x - 1.0) / 0.25)) + 0.38 * fresh * amount * exp(-sq(x / 1.6));
  }
}

// Radiance of the moon in the direction dir (rgb, nits, before atmospheric extinction) and the disc's antialiased pixel coverage (a).
fn moonRadiance(dir : vec3f, pixelAngle : f32) -> vec4f {
  let m = frame.moonDir.xyz;
  let radius = frame.moonDir.w;
  let c = dot(dir, m);
  if (c <= 0.0) { return vec4f(0.0); }
  let theta = atan2(length(cross(dir, m)), c);
  let coverage = saturate((radius - theta) / pixelAngle + 0.5);
  if (coverage <= 0.0) { return vec4f(0.0); }

  let nUp = normalize(ap.eclNorth.xyz - m * dot(ap.eclNorth.xyz, m));
  let right = cross(m, nUp);
  var xy = vec2f(dot(dir, right), dot(dir, nUp)) / sin(radius);
  let len = length(xy);
  xy = xy / max(len, 1.0);
  let p = vec3f(xy, sqrt(max(1.0 - dot(xy, xy), 0.0)));
  let lon = atan2(p.x, p.z);
  let lat = asin(clamp(p.y, -1.0, 1.0));

  var cs : CraterSample;
  cs.albedo = 1.0;
  cs.slope = vec3f(0.0);
  craterLayer(p, 5.0, 11u, 1.0, &cs);
  craterLayer(p, 12.0, 23u, 0.8, &cs);
  craterLayer(p, 30.0, 47u, 0.6, &cs);

  let mott = fbm3(p * 5.5 + 3.1);
  let edgeNoise = fbm3(p * 9.0 + 17.0);
  let mare = mareMask(lon, lat, edgeNoise);
  let rays = crater_rays(lon, lat, p);
  var albedo = mix(MOON_HIGHLAND, MOON_MARE, mare * 0.92) * (0.82 + 0.36 * mott);
  albedo = albedo * cs.albedo * (1.0 + 0.9 * rays * (1.0 - mare));

  let sunWorld = frame.sunDir.xyz;
  let sunDisc = normalize(vec3f(dot(sunWorld, right), dot(sunWorld, nUp), -dot(sunWorld, m)));
  let n = normalize(p - cs.slope);
  let mu = max(n.z, 1e-3);
  let mu0 = max(dot(n, sunDisc), 0.0);
  let geometric = select(0.0, 1.0, dot(p, sunDisc) > -0.02);
  let phaseAngle = acos(clamp(sunDisc.z, -1.0, 1.0));
  let surge = 1.0 + SURGE_AMPLITUDE * exp(-phaseAngle / SURGE_WIDTH);
  let sunTerm = (2.0 * mu0 / (mu0 + mu)) * surge * geometric;
  let earthshine = EARTHSHINE_FRACTION * (1.0 - frame.moonIrradiance.w) * mu;
  let e = frame.sunIrradiance.rgb * INV_PI;
  return vec4f(albedo * (e * sunTerm + e * EARTHSHINE_TINT * earthshine), coverage);
}

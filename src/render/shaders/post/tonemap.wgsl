// Display transform: Stephen Hill's fit of the ACES RRT+ODT (sRGB/D65 in and out), highlight desaturation, soft gamut clamp, FPV-camera grade, sRGB OETF.
// Input is scene-linear light already multiplied by the exposure ratio (0.22 ~ mid grey); output of `tonemap` is display-linear in [0, 1].

struct Grade {
  preScale : f32,
  saturation : f32,
  contrast : f32,
  desatStart : f32,
  desatEnd : f32,
};

// preScale 1/0.6 is the fit's own exposure convention; saturation and contrast mimic an FPV camera's punchy ISP tuning.
const GRADE : Grade = Grade(1.6666667, 1.15, 0.2, 3.0, 30.0);

// WGSL matrices are column-major: these are the transposes of the published row-major matrices.
const ACES_IN : mat3x3f = mat3x3f(
  vec3f(0.59719, 0.07600, 0.02840),
  vec3f(0.35458, 0.90834, 0.13383),
  vec3f(0.04823, 0.01566, 0.83777));
const ACES_OUT : mat3x3f = mat3x3f(
  vec3f(1.60475, -0.10208, -0.00327),
  vec3f(-0.53108, 1.10813, -0.07276),
  vec3f(-0.07367, -0.00605, 1.07602));

fn rrtOdtFit(v : vec3f) -> vec3f {
  let a = v * (v + 0.0245786) - 0.000090537;
  let b = v * (0.983729 * v + 0.4329510) + 0.238081;
  return a / b;
}

fn lumaOf(c : vec3f) -> f32 { return dot(c, vec3f(0.2126, 0.7152, 0.0722)); }

// Pull an out-of-gamut colour towards its own luminance until no channel is negative, then clip the top.
fn gamutClamp(c : vec3f) -> vec3f {
  let l = max(lumaOf(c), 0.0);
  let m = min(c.r, min(c.g, c.b));
  var o = c;
  if (m < 0.0) { o = vec3f(l) + (c - vec3f(l)) * (l / max(l - m, 1e-5)); }
  return clamp(o, vec3f(0.0), vec3f(1.0));
}

// Very bright light burns to white (the sensor saturates all three channels), not to a saturated colour.
fn highlightDesaturate(c : vec3f) -> vec3f {
  let l = lumaOf(c);
  let w = smoothstep(GRADE.desatStart, GRADE.desatEnd, l);
  return mix(c, vec3f(l), w);
}

fn tonemap(sceneLinear : vec3f) -> vec3f {
  let c = highlightDesaturate(max(sceneLinear, vec3f(0.0)) * GRADE.preScale);
  let t = gamutClamp(ACES_OUT * rrtOdtFit(ACES_IN * c));
  let l = lumaOf(t);
  return clamp(vec3f(l) + (t - vec3f(l)) * GRADE.saturation, vec3f(0.0), vec3f(1.0));
}

fn srgbEncode(x : vec3f) -> vec3f {
  let c = clamp(x, vec3f(0.0), vec3f(1.0));
  return select(1.055 * pow(c, vec3f(1.0 / 2.4)) - 0.055, 12.92 * c, c <= vec3f(0.0031308));
}

fn srgbDecode(x : vec3f) -> vec3f {
  let c = clamp(x, vec3f(0.0), vec3f(1.0));
  return select(pow((c + 0.055) / 1.055, vec3f(2.4)), c / 12.92, c <= vec3f(0.04045));
}

// Smoothstep-blended S-curve in the encoded domain: pivots at 0.5 and leaves 0 and 1 fixed.
fn gradeContrast(e : vec3f) -> vec3f {
  return mix(e, e * e * (3.0 - 2.0 * e), GRADE.contrast);
}

// Interleaved gradient noise (Jimenez 2014): a cheap, well-distributed per-pixel pattern.
fn ign(p : vec2f) -> f32 {
  return fract(52.9829189 * fract(dot(p, vec2f(0.06711056, 0.00583715))));
}

// Triangular-PDF dither of +-1 output LSB: two decorrelated IGN lanes, rotated every frame so it averages out in time.
fn tpdfDither(pix : vec2f, frame : u32) -> f32 {
  let f = f32(frame & 63u);
  return ign(pix + vec2f(5.588238, 5.588238) * f) + ign(pix.yx + vec2f(47.0, 13.0) + vec2f(8.311, 3.917) * f) - 1.0;
}

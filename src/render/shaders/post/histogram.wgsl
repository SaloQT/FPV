// Auto-exposure metering on the resolved (pre-exposed) image.
//  hist   : 64-bin log2-luminance histogram, weighted towards the centre and the ground, linear split between neighbouring bins.
//  reduce : soft-clipped trimmed mean (dark shade tail cut) and bright-eighth EV -> scene-referred target exposure with highlight priority
//           -> smoothed persistent state -> `ratioOut`.
// State is the TOTAL exposure in EV (pre-exposure * ratio), so CPU pre-exposure changes never look like a scene change.
const BINS : u32 = 64u;
const EV_MIN : f32 = ${EV_MIN};
const EV_MAX : f32 = ${EV_MAX};
const KEY : f32 = ${KEY};
const KEY_KNEE_EV : f32 = ${KEY_KNEE_EV};
const KEY_SLOPE : f32 = ${KEY_SLOPE};
const NIGHT_KNEE_EV : f32 = ${NIGHT_KNEE_EV};
const NIGHT_SLOPE : f32 = ${NIGHT_SLOPE};
const NIGHT_BLEND_HI_EV : f32 = ${NIGHT_BLEND_HI_EV};
const NIGHT_BLEND_LO_EV : f32 = ${NIGHT_BLEND_LO_EV};
const NIGHT_MARGIN_EV : f32 = ${NIGHT_MARGIN_EV};
const EXPECTED_MEAN_EV : f32 = ${EXPECTED_MEAN_EV};
const KNEE : f32 = ${KNEE};
const KNEE_W : f32 = ${KNEE_WIDTH};
const CENTER_BIAS : f32 = ${CENTER_BIAS};
const VERT_BIAS : f32 = ${VERT_BIAS};
const CLIP_FRAC : f32 = ${CLIP_FRAC};
const CLIP_EV : f32 = ${CLIP_EV};
const PROTECT_MAX_EV : f32 = ${PROTECT_MAX_EV};
const STRIDE : u32 = ${STRIDE}u;
const WEIGHT_SCALE : f32 = ${WEIGHT_SCALE};
const TRIM_LOW : f32 = ${TRIM_LOW};
const TRIM_LOW_NIGHT : f32 = ${TRIM_LOW_NIGHT};
const TRIM_BLEND_LO_EV : f32 = ${TRIM_BLEND_LO_EV};
const TRIM_BLEND_HI_EV : f32 = ${TRIM_BLEND_HI_EV};
const TRIM_HIGH : f32 = ${TRIM_HIGH};
const TAU_BRIGHTEN : f32 = ${TAU_BRIGHTEN};
const TAU_DARKEN : f32 = ${TAU_DARKEN};
const DEADBAND : f32 = ${DEADBAND};
const MAX_DT : f32 = ${MAX_DT};
const DAY_TOTAL_EV : f32 = ${DAY_TOTAL_EV};
const MAX_GAIN_EV : f32 = ${MAX_GAIN_EV};
const MIN_GAIN_EV : f32 = ${MIN_GAIN_EV};
const MAX_RATIO_EV : f32 = ${MAX_RATIO_EV};
const LOG2_KEY : f32 = log2(KEY);

struct Params { pre : f32, dt : f32, frame : u32, reset : u32 };

@group(0) @binding(0) var resolved : texture_2d<f32>;
@group(0) @binding(1) var<storage, read_write> histogram : array<atomic<u32>, 64>;
@group(0) @binding(2) var<uniform> params : Params;
// state[0] = smoothed total exposure (EV, log2 of pre-exposure * ratio), state[1] = 1 once initialised.
@group(0) @binding(3) var<storage, read_write> adapt : array<f32, 4>;
// ratioOut = (ratio, sensor gain EV over the daylight reference, metered mean EV, total exposure EV).
@group(0) @binding(4) var<storage, read_write> ratioOut : array<f32, 4>;

var<workgroup> wgHist : array<atomic<u32>, 64>;
var<workgroup> wgBins : array<f32, 64>;

fn softClipEv(ev : f32) -> f32 {
  let rel = ev - LOG2_KEY;
  return select(KNEE + KNEE_W * tanh((rel - KNEE) / KNEE_W), rel, rel <= KNEE) + LOG2_KEY;
}

@compute @workgroup_size(16, 16)
fn hist(@builtin(global_invocation_id) gid : vec3u, @builtin(local_invocation_index) li : u32) {
  if (li < BINS) { atomicStore(&wgHist[li], 0u); }
  workgroupBarrier();
  let dims = textureDimensions(resolved);
  let p = gid.xy * STRIDE + vec2u(params.frame % STRIDE, (params.frame / STRIDE) % STRIDE);
  if (p.x < dims.x && p.y < dims.y) {
    let l = dot(textureLoad(resolved, p, 0).rgb, vec3f(0.2126, 0.7152, 0.0722));
    // Skip NaN/Inf (exponent bits all set) instead of letting them poison a bin.
    if ((bitcast<u32>(l) & 0x7f800000u) != 0x7f800000u) {
      let q = (vec2f(p) + 0.5) / vec2f(dims) * 2.0 - 1.0;
      let radial = 1.0 - CENTER_BIAS * saturate(dot(q, q) * 0.5);
      let wTotal = u32(round(WEIGHT_SCALE * radial * (1.0 + VERT_BIAS * clamp(q.y, -1.0, 1.0))));
      let ev = log2(max(l, 1e-9));
      let pos = clamp((ev - EV_MIN) / (EV_MAX - EV_MIN) * f32(BINS) - 0.5, 0.0, f32(BINS - 1u));
      let i0 = u32(floor(pos));
      let w1 = u32(round(f32(wTotal) * (pos - floor(pos))));
      atomicAdd(&wgHist[i0], wTotal - w1);
      atomicAdd(&wgHist[min(i0 + 1u, BINS - 1u)], w1);
    }
  }
  workgroupBarrier();
  if (li < BINS) {
    let v = atomicLoad(&wgHist[li]);
    if (v != 0u) { atomicAdd(&histogram[li], v); }
  }
}

fn binCenterEv(i : u32) -> f32 { return EV_MIN + (f32(i) + 0.5) / f32(BINS) * (EV_MAX - EV_MIN); }

// EV above which the brightest CLIP_FRAC of the weight lies, interpolated inside its bin (mirrors topQuantileEv in post/exposure.ts).
fn topQuantileEv(total : f32) -> f32 {
  let want = CLIP_FRAC * total;
  let width = (EV_MAX - EV_MIN) / f32(BINS);
  var cum = 0.0;
  for (var k = BINS - 1u; k > 0u; k--) {
    let h = wgBins[k];
    if (cum + h >= want) { return binCenterEv(k) + (0.5 - (want - cum) / max(h, 1.0)) * width; }
    cum += h;
  }
  return binCenterEv(0u);
}

// Weight of the CPU's astronomy-based scene estimate (it is encoded in the pre-exposure) against the metered mean: 1 in the dark.
fn nightWeight(preEv : f32) -> f32 {
  return 1.0 - smoothstep(NIGHT_BLEND_LO_EV, NIGHT_BLEND_HI_EV, EXPECTED_MEAN_EV - preEv);
}

// The key falls with the scene luminance, the brightest CLIP_FRAC (sunlit ground, sky) may not sit more than CLIP_EV over the key (not in the dark),
// the sensor gain is limited both ways.
// In the dark the estimate replaces the metered mean, but a frame metered more than NIGHT_MARGIN_EV brighter than it (artificial light) still lowers the gain.
fn targetTotalEv(meanEv : f32, highEv : f32, preEv : f32) -> f32 {
  let night = nightWeight(preEv);
  let used = mix(meanEv, EXPECTED_MEAN_EV, night);
  let lumEv = used - preEv;
  let keyEv = LOG2_KEY + KEY_SLOPE * min(lumEv - KEY_KNEE_EV, 0.0) + (NIGHT_SLOPE - KEY_SLOPE) * min(lumEv - NIGHT_KNEE_EV, 0.0);
  let shift = keyEv - used;
  let protectedShift = mix(max(min(shift, LOG2_KEY + CLIP_EV - highEv), shift - PROTECT_MAX_EV), shift, night);
  let floodlit = night * max(meanEv - EXPECTED_MEAN_EV - NIGHT_MARGIN_EV, 0.0);
  let gain = max(clamp(preEv + protectedShift - DAY_TOTAL_EV, MIN_GAIN_EV, MAX_GAIN_EV) - floodlit, MIN_GAIN_EV);
  return preEv + clamp(DAY_TOTAL_EV + gain - preEv, -MAX_RATIO_EV, MAX_RATIO_EV);
}

// Mean of the soft-clipped bin-centre EVs with the darkest trimLow and the brightest TRIM_HIGH of the weight cut.
fn trimmedMeanEv(trimLow : f32, total : f32) -> f32 {
  let lo = trimLow * total;
  let hi = (1.0 - TRIM_HIGH) * total;
  var cum = 0.0;
  var sum = 0.0;
  var kept = 0.0;
  for (var k = 0u; k < BINS; k++) {
    let h = wgBins[k];
    let w = max(min(cum + h, hi) - max(cum, lo), 0.0);
    sum += w * softClipEv(binCenterEv(k));
    kept += w;
    cum += h;
  }
  return sum / max(kept, 1e-6);
}

// The mean the exposure law works on: the night mean fading into the shade-trimmed one with the CPU grey-card luminance (shadeTrimWeight in exposure.ts).
fn meteredMeanEv(total : f32, preEv : f32) -> f32 {
  let night = trimmedMeanEv(TRIM_LOW_NIGHT, total);
  let w = smoothstep(TRIM_BLEND_LO_EV, TRIM_BLEND_HI_EV, EXPECTED_MEAN_EV - preEv);
  return select(night + w * (trimmedMeanEv(TRIM_LOW, total) - night), night, w <= 0.0);
}

@compute @workgroup_size(64)
fn reduce(@builtin(local_invocation_index) i : u32) {
  wgBins[i] = f32(atomicExchange(&histogram[i], 0u));
  workgroupBarrier();
  if (i != 0u) { return; }
  var total = 0.0;
  for (var k = 0u; k < BINS; k++) { total += wgBins[k]; }
  let preEv = log2(max(params.pre, 1e-12));
  var total_ev = adapt[0];
  var meanEv = ratioOut[2];
  if (adapt[1] < 0.5) { total_ev = preEv; }
  if (total > 1.0) {
    meanEv = meteredMeanEv(total, preEv);
    let want = targetTotalEv(meanEv, topQuantileEv(total), preEv);
    if (adapt[1] < 0.5 || params.reset != 0u) {
      total_ev = want;
    } else {
      let err = want - total_ev;
      let eff = sign(err) * max(abs(err) - DEADBAND, 0.0);
      let tau = select(TAU_BRIGHTEN, TAU_DARKEN, err < 0.0);
      total_ev += eff * (1.0 - exp(-clamp(params.dt, 0.0, MAX_DT) / tau));
    }
  }
  adapt[0] = total_ev;
  adapt[1] = 1.0;
  let ratioEv = clamp(total_ev - preEv, -MAX_RATIO_EV, MAX_RATIO_EV);
  ratioOut[0] = exp2(ratioEv);
  ratioOut[1] = preEv + ratioEv - DAY_TOTAL_EV;
  ratioOut[2] = meanEv;
  ratioOut[3] = preEv + ratioEv;
}

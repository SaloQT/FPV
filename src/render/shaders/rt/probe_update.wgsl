// Radiance probe grid update. One 64-thread workgroup per probe (dispatch = grid dimensions). The grid is toroidal: lattice coordinate c
// lives at texel posmod(c, dim). A probe is re-traced when it is fresh (entered the window / first frame) or on its turn in the rotating
// subset (id % K == phase); other probes only carry their old value forward, rescaled for the pre-exposure change. Each traced probe
// projects `raysPerProbe` Fibonacci-sphere radiance samples onto SH-L1 (one rgba16f 3D texture per colour channel = c0..c3) and blends
// them into the old value with the hysteresis factor.
#include "rt/rt_scene.wgsl"

@group(${GRP}) @binding(6) var newR : texture_storage_3d<rgba16float, write>;
@group(${GRP}) @binding(7) var newG : texture_storage_3d<rgba16float, write>;
@group(${GRP}) @binding(8) var newB : texture_storage_3d<rgba16float, write>;
@group(${GRP}) @binding(9) var<storage, read> prevPre : array<f32>;
#ifdef COMPACT
@group(${GRP}) @binding(12) var<storage, read> activeIds : array<u32>;
#endif

const GOLDEN_ANGLE : f32 = 2.399963;
const PROBE_LIFT : f32 = 0.75;
const GROUP_SIZE : u32 = 64u;

var<workgroup> shR : array<vec4f, 64>;
var<workgroup> shG : array<vec4f, 64>;
var<workgroup> shB : array<vec4f, 64>;

fn posmod3(a : vec3i, m : vec3i) -> vec3i { return ((a % m) + m) % m; }

@compute @workgroup_size(64)
fn main(@builtin(workgroup_id) wg : vec3u, @builtin(local_invocation_index) lid : u32) {
  let dim = vec3i(rp.probeDim.xyz);
#ifdef COMPACT
  let activeId = activeIds[wg.x];
  let udim = rp.probeDim.xyz;
  let cell = vec3i(i32(activeId % udim.x), i32((activeId / udim.x) % udim.y), i32(activeId / (udim.x * udim.y)));
#else
  let cell = vec3i(wg);
#endif
  let lattice = rp.probeLo.xyz + posmod3(cell - rp.probeLo.xyz, dim);
  let prevLo = rp.probePrev.xyz;
  let inPrev = all(lattice >= prevLo) && all(lattice < prevLo + dim);
  let fresh = rp.probePrev.w == 1 || !inPrev;
  let id = u32(cell.x + dim.x * (cell.y + dim.y * cell.z));
  let doTrace = fresh || (id % max(rp.dbg.z, 1u)) == rp.dbg.w;
  let pp = prevPre[0];
  let ratio = select(1.0, frame.params.y / pp, pp > 0.0);
  let oldR = fp16Safe(textureLoad(probeR, cell, 0));
  let oldG = fp16Safe(textureLoad(probeG, cell, 0));
  let oldB = fp16Safe(textureLoad(probeB, cell, 0));
  if (!doTrace) {
    if (lid == 0u) {
      textureStore(newR, cell, fp16Safe(oldR * ratio));
      textureStore(newG, cell, fp16Safe(oldG * ratio));
      textureStore(newB, cell, fp16Safe(oldB * ratio));
    }
    return;
  }

  probeGain = ratio;
  var p = vec3f(lattice) * rp.f.y;
  p.y = max(p.y, select(0.0, terrainHeightAt(p.xz), hasTerrain()) + PROBE_LIFT);
  let e = envAt(p.y);
  let steps = rp.cfg.y;
  let total = u32(rp.probeLo.w);
  let h = pcg3(vec3u(bitcast<u32>(lattice.x), bitcast<u32>(lattice.y), bitcast<u32>(lattice.z) ^ (rp.dbg.y * 2654435761u)));
  let u = vec3f(f32(h.x >> 8u), f32(h.y >> 8u), f32(h.z >> 8u)) * (1.0 / 16777216.0);
  let axisZ = 1.0 - 2.0 * u.x;
  let axisS = sqrt(max(0.0, 1.0 - axisZ * axisZ));
  let basis = basisFromNormal(vec3f(axisS * cos(TAU * u.y), axisS * sin(TAU * u.y), axisZ));
  let phi0 = TAU * u.z;

  var cr = vec4f(0.0);
  var cg = vec4f(0.0);
  var cb = vec4f(0.0);
  for (var r = lid; r < total; r += GROUP_SIZE) {
    let z = 1.0 - 2.0 * (f32(r) + 0.5) / f32(total);
    let s = sqrt(max(0.0, 1.0 - z * z));
    let phi = GOLDEN_ANGLE * f32(r) + phi0;
    let d = basis * vec3f(s * cos(phi), s * sin(phi), z);
    let hit = traceScene(p, d, rp.f.w, steps);
    var radiance : vec3f;
    if (hit.kind == KIND_MISS) {
      radiance = skyRadiance(d, e);
    } else {
      radiance = hitRadiance(hit, p, d, e, steps);
    }
    radiance = min(radiance, vec3f(MAX_PROBE_RADIANCE));
    let y = vec4f(SH_Y0, SH_Y1 * d.y, SH_Y1 * d.z, SH_Y1 * d.x);
    cr += y * radiance.r;
    cg += y * radiance.g;
    cb += y * radiance.b;
  }
  shR[lid] = cr;
  shG[lid] = cg;
  shB[lid] = cb;
  workgroupBarrier();
  for (var stride = GROUP_SIZE / 2u; stride > 0u; stride = stride >> 1u) {
    if (lid < stride) {
      shR[lid] += shR[lid + stride];
      shG[lid] += shG[lid + stride];
      shB[lid] += shB[lid + stride];
    }
    workgroupBarrier();
  }
  if (lid == 0u) {
    let norm = 4.0 * PI / f32(total);
    let blend = select(1.0 - rp.f.z, 1.0, fresh);
    textureStore(newR, cell, fp16Safe(mix(oldR * ratio, shR[0] * norm, blend)));
    textureStore(newG, cell, fp16Safe(mix(oldG * ratio, shG[0] * norm, blend)));
    textureStore(newB, cell, fp16Safe(mix(oldB * ratio, shB[0] * norm, blend)));
  }
}

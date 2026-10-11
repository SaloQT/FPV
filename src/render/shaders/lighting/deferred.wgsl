// Deferred lighting compute pass: G-buffer + RT results -> pre-exposed HDR radiance. Writes EVERY pixel of `hdr` (sky pixels get 0,
// or the skyView LUT colour when FALLBACK_SKY is defined because no module draws the sky). Physical units in, pre-exposed out.
#include "common/world_bindings.wgsl"
#include "lighting/sky_safe.wgsl"
#include "common/pbr.wgsl"
#include "rt/rt_map.wgsl"
#include "park/lights.wgsl"
#include "park/shadows.wgsl"

@group(2) @binding(0) var gAlbedo : texture_2d<f32>;
@group(2) @binding(1) var gNormal : texture_2d<f32>;
@group(2) @binding(2) var gMisc : texture_2d<f32>;
@group(2) @binding(3) var gDepth : texture_depth_2d;
@group(2) @binding(4) var sunShadowTex : texture_2d<f32>;
@group(2) @binding(5) var giDiffuseTex : texture_2d<f32>;
@group(2) @binding(6) var giSpecularTex : texture_2d<f32>;
@group(2) @binding(7) var hdrOut : texture_storage_2d<rgba16float, write>;

const GRASS_MATERIAL : u32 = 2u;
const SWARD_FLOOR_MATERIAL : u32 = 11u;
const MAX_HDR : f32 = 60000.0;
const AMBIENT_SAMPLES : u32 = 16u;
const GROUND_ALBEDO : f32 = 0.15;
const HORIZON_EPS : f32 = -0.0145;
// A thin leaf reflects the ambient light that falls on its front and transmits (about 0.8 of that, LEAF_TRANSMITTANCE) what falls on its back; a crown's outer leaf sees
// a darker back, so 0.7 of the back-face share is taken (rt_scene.wgsl: the crown proxy's own scatter model). The back face's light comes from as open a sky as the front's,
// so it is taken in proportion to the leaf's openness: a leaf deep in a crown sees leaves behind it, not sky.
const LEAF_AMBIENT_BACK : f32 = 0.7;
// The baked and traced occlusion of a leaf is mostly other leaves, which are not black: they reflect and transmit about 0.22 (green) of what falls on them and
// that light is scattered on into the crown (multiple scattering), so the occluded part of the ambient is partly refilled. Only a quarter is refilled: with
// half, crown interiors came out nearly as bright as the outer leaves, flatter than any photograph of a crown. The refill is in proportion to the leaf's own
// openness too, since the light scattered into a pocket is what got into that part of the crown: a fixed refill held the deepest pockets at a third of the open
// ambient, 1.2 to 2 stops under the frame where photographs of crowns sit 4 to 5.
const LEAF_AO_FILL : f32 = 0.25;
// Near-field aerial perspective in shade: the share of in-scatter that is skylight rather than direct sun, and the distances (m) over which
// the shading of the air fades out (see the composite at the end of main).
const AP_SHADE_SKY_SHARE : f32 = 0.35;
const AP_SHADE_RANGE_M : vec2f = vec2f(60.0, 400.0);
// G-buffer material id of leaves (FOLIAGE_ID in vegetation/tree.wgsl, MAT_FOLIAGE in objects/track_materials.wgsl).
const FOLIAGE_MATERIAL : u32 = 5u;
// Share of a leaf's direct specular taken back when the eye looks straight toward the sun through it (see its use).
const LEAF_BACKLIT_GLINT_CUT : f32 = 0.85;
// A spray or leaf cluster is a porous volume: most mirror directions off a leaf run into its neighbours, so a translucent leaf reflects only
// this share of the sky the split-sum term gives an open surface, less again by the square of its occlusion (a leaf deep in the crown sees leaves in nearly
// every mirror direction, and those leaves are themselves in shade). Without it dark needles pick up a grey-blue sky sheen and read teal, and crown interiors a grey sheen that lifts their shadows.
const LEAF_SPECULAR_OCCLUSION : f32 = 0.35;

// Depth- and normal-aware upsample of the RT-resolution signals (sun shadow, GI, specular) to a full-resolution pixel. Every RT texel stands
// for the full-res pixel rtSourcePixel() picks this frame (the RT passes use the same mapping), so its depth and normal are re-read from the
// G-buffer there instead of binding the RT aux textures (this pass is at the 16 sampled-texture limit).
struct RtSample { shadow : f32, diffuse : vec4f, specular : vec4f };

const RT_DEPTH_SIGMA : f32 = 0.02;
const RT_NORMAL_POWER : f32 = 8.0;
const RT_MIN_WEIGHT : f32 = 1e-4;

// A non-finite texel (NaN * weight 0 is still NaN, so one would poison its whole bilinear footprint) reads as "no data", never as a black block.
fn finite4(v : vec4f) -> vec4f { return select(vec4f(0.0), v, abs(v) <= vec4f(MAX_HDR)); }

fn rtLoad(q : vec2i) -> RtSample {
  let shadow = textureLoad(sunShadowTex, q, 0).x;
  return RtSample(select(1.0, shadow, shadow >= 0.0 && shadow <= 1.0), finite4(textureLoad(giDiffuseTex, q, 0)), finite4(textureLoad(giSpecularTex, q, 0)));
}

// Specular is accumulated premultiplied by its confidence so an unconfident (zero) neighbour does not darken a confident one.
fn rtAdd(acc : ptr<function, RtSample>, s : RtSample, w : f32) {
  (*acc).shadow += s.shadow * w;
  (*acc).diffuse += s.diffuse * w;
  (*acc).specular += vec4f(s.specular.rgb * s.specular.a, s.specular.a) * w;
}

fn rtResolve(acc : RtSample, wSum : f32) -> RtSample {
  let inv = 1.0 / wSum;
  return RtSample(acc.shadow * inv, acc.diffuse * inv, vec4f(acc.specular.rgb / max(acc.specular.a, RT_MIN_WEIGHT), acc.specular.a * inv));
}

fn sampleRT(px : vec2i, uv : vec2f, depth : f32, world : vec3f, n : vec3f) -> RtSample {
  let rtDims = vec2i(textureDimensions(giDiffuseTex));
  let fullDims = vec2i(textureDimensions(gDepth));
  if (rtDims.x == fullDims.x && rtDims.y == fullDims.y) { return rtLoad(px); }
  let div = select(4, 2, (fullDims.x + 1) / 2 == rtDims.x);
  let z = frame.params.z / depth;
  let p = uv * vec2f(rtDims) - 0.5;
  let base = vec2i(floor(p));
  let f = p - floor(p);
  let hi = rtDims - vec2i(1);
  var bilateral = RtSample(0.0, vec4f(0.0), vec4f(0.0));
  var bilinear = bilateral;
  var wSum = 0.0;
  for (var k = 0; k < 4; k++) {
    let o = vec2i(k & 1, k >> 1);
    let q = clamp(base + o, vec2i(0), hi);
    let bil = select(1.0 - f.x, f.x, o.x == 1) * select(1.0 - f.y, f.y, o.y == 1);
    let s = rtLoad(q);
    rtAdd(&bilinear, s, bil);
    let src = rtSourcePixel(q, div, fullDims, frame.misc.x);
    let dq = textureLoad(gDepth, src, 0);
    if (dq <= 0.0) { continue; }
    let nq = octDecode(textureLoad(gNormal, src, 0).xy);
    // Distance to this pixel's tangent plane, not the depth difference: on a grazing slope a tap a pixel away is metres deeper yet still coplanar.
    let planeDist = abs(dot(n, worldFromDepth((vec2f(src) + 0.5) * frame.screen.zw, dq) - world));
    let w = bil * exp(-planeDist / (RT_DEPTH_SIGMA * z)) * pow(max(dot(n, nq), 0.0), RT_NORMAL_POWER);
    rtAdd(&bilateral, s, w);
    wSum += w;
  }
  if (wSum > RT_MIN_WEIGHT) { return rtResolve(bilateral, wSum); }
  return rtResolve(bilinear, 1.0);
}

// Radiance (nits, not pre-exposed) of the ground seen from above: a Lambertian bounce of the key lights and the zenith sky.
fn groundRadiance(sunE : vec3f, moonE : vec3f, zenithSky : vec3f) -> vec3f {
  let direct = sunE * max(frame.sunDir.y, 0.0) + moonE * max(frame.moonDir.y, 0.0);
  return GROUND_ALBEDO * (direct * INV_PI + 0.6 * zenithSky);
}

// Sky radiance above the horizon, blending into the estimated ground below it.
fn envRadiance(dir : vec3f, ground : vec3f) -> vec3f {
  return mix(skyNits(dir), ground, 1.0 - smoothstep(-0.08, 0.0, dir.y));
}

// Cosine-weighted mean of the environment around n == Lambert irradiance / pi (used when no GI is available).
fn ambientFallback(n : vec3f, px : vec2i, ground : vec3f) -> vec3f {
  let basis = basisFromNormal(n);
  // Golden-ratio shift per frame so TAA averages the 16-sample noise instead of seeing a frozen screen-space pattern.
  let rot = fract(textureLoad(blueNoise, vec2i(px.x & 127, px.y & 127), 0).x + f32(frame.misc.x & 63u) * 0.6180339887);
  var sum = vec3f(0.0);
  for (var i = 0u; i < AMBIENT_SAMPLES; i++) {
    let u = vec2f((f32(i) + 0.5) / f32(AMBIENT_SAMPLES), fract(f32(i) * 0.7548776662 + rot));
    sum += envRadiance(basis * cosineHemisphere(u), ground);
  }
  return sum / f32(AMBIENT_SAMPLES);
}

// Total exposure at the camera's full night gain, as NIGHT_TOTAL_EXPOSURE in objects/common.wgsl and objects/ledGlow.ts (a test keeps them equal).
const EMISSIVE_NIGHT_TOTAL_EXPOSURE : f32 = 1186.0;

// Emitted light of an emissive surface (gate LEDs, lamps) in pre-exposed units: the physical value while it stays under the cap the LED glow ribbons
// use (objects/ledGlow.ts glowShown), which holds its display level near 4x its strength, at most 2.2. By day the cap never bites; at night a raw
// 20000-nit strip is thousands of times past white, and its bloom whites out the screen as the drone flies through a gate.
fn emissiveShown(strength : f32, pre : f32) -> f32 {
  return min(strength * EMISSIVE_MAX_NITS * pre, clamp(strength * 4.0, 0.15, 2.2) * max(1.0, pre / EMISSIVE_NIGHT_TOTAL_EXPOSURE));
}

@compute @workgroup_size(8, 8)
fn main(@builtin(global_invocation_id) gid : vec3u) {
  let dims = textureDimensions(hdrOut);
  if (gid.x >= dims.x || gid.y >= dims.y) { return; }
  let px = vec2i(gid.xy);
  let uv = (vec2f(gid.xy) + 0.5) * frame.screen.zw;
  let pre = frame.params.y;
  let depth = textureLoad(gDepth, px, 0);
  if (depth <= 0.0) {
#ifdef FALLBACK_SKY
    textureStore(hdrOut, px, vec4f(min(finiteNits(sampleSkyView(viewRayDir(uv))) * pre, vec3f(MAX_HDR)), 1.0));
#else
    textureStore(hdrOut, px, vec4f(0.0, 0.0, 0.0, 1.0));
#endif
    return;
  }

  let alb = textureLoad(gAlbedo, px, 0);
  let nrm = textureLoad(gNormal, px, 0);
  let msc = textureLoad(gMisc, px, 0);
  let n = octDecode(nrm.xy);
  // Grass (material 2) has no wetness; its misc.b carries the blade's sun occlusion inside the sward (grass.wgsl), the shade the blades cast
  // on each other, which the ray-traced shadow does not see.
  // The turf between the blades (material 11) carries the same occlusion in misc.g, where other materials keep translucency.
  let matId = u32(msc.r * 255.0 + 0.5);
  let grassy = matId == GRASS_MATERIAL;
  let swardFloor = matId == SWARD_FLOOR_MATERIAL;
  // Trees (material 5) carry in misc.b the sunlight their bark's own relief shades (tree.wgsl: the furrows), and are never wet.
  let barkShade = select(0.0, saturate1(msc.b), matId == FOLIAGE_MATERIAL);
  let swardShade = max(select(select(0.0, saturate1(msc.g), swardFloor), saturate1(msc.b), grassy), barkShade);
  let translucency = select(msc.g, 0.0, swardFloor);
  let wet = select(msc.b, 0.0, grassy || matId == FOLIAGE_MATERIAL);
  let rough = clamp(nrm.z * mix(1.0, 0.4, wet), 0.02, 1.0);
  let metal = saturate1(nrm.w);
  let baseColor = alb.rgb * mix(1.0, 0.6, wet);
  let diffuseColor = baseColor * (1.0 - metal);
  let f0 = mix(vec3f(0.04), baseColor, metal);

  let world = worldFromDepth(uv, depth);
  let toCam = frame.camPos.xyz - world;
  let dist = length(toCam);
  let v = toCam / max(dist, 1e-4);
  let nv = max(dot(n, v), 1e-3);

  let r = atmosRadiusAtHeight(world.y);
  let sunOn = frame.sunIrradiance.w != 0.0;
  let moonUp = select(0.0, 1.0, frame.moonDir.y > HORIZON_EPS);
  var sunE = vec3f(0.0);
  var moonE = vec3f(0.0);
  // These are uniform light-enable gates, not intensity approximations. Keep the irradiance
  // values for the ground bounce below, but do not sample extinction for an inactive light.
  if (sunOn) { sunE = frame.sunIrradiance.rgb * frame.sunIrradiance.w * sampleTransmittance(r, frame.sunDir.y); }
  if (moonUp > 0.0) { moonE = frame.moonIrradiance.rgb * moonUp * sampleTransmittance(r, frame.moonDir.y); }

  let rt = sampleRT(px, uv, depth, world, n);
  let visibility = rt.shadow;
  let keyIsMoon = frame.misc.w == 1u;
  let sunVis = select(visibility, 1.0, keyIsMoon) * (1.0 - swardShade);
  let moonVis = select(1.0, visibility, keyIsMoon) * (1.0 - swardShade);
  var sunDirect = vec3f(0.0);
  var moonDirect = vec3f(0.0);
  // Leaves (material 5: trees, track foliage, park plants) pass yellow-green light; other translucent surfaces pass their own colour.
  let leafy = u32(msc.r * 255.0 + 0.5) == FOLIAGE_MATERIAL;
  let transmitColor = select(diffuseColor, leafTransmitColour(diffuseColor), leafy);
  if (sunOn) { sunDirect = directLight(frame.sunDir.xyz, n, v, diffuseColor, transmitColor, f0, rough, translucency, sunE * sunVis, frame.sunDir.w); }
  if (moonUp > 0.0) { moonDirect = directLight(frame.moonDir.xyz, n, v, diffuseColor, transmitColor, f0, rough, translucency, moonE * moonVis, frame.moonDir.w); }
  // A leaf between the eye and the sun glows: the forward-scattered part of what it transmits.
  if (sunOn && leafy) { sunDirect += leafForwardScatter(frame.sunDir.xyz, n, v, transmitColor, msc.g, sunE * sunVis) + leafBackDiffuse(frame.sunDir.xyz, n, v, transmitColor, msc.g, sunE * sunVis); }
  // Looking toward the sun through a crown, the single-normal leaf model sees grazing GGX highlights on nearly every card that faces the sun a
  // little, which turns whole sprays cream-white; a real canopy shows only a scatter of glints there, most leaves hidden by others or turned
  // away. That share of the specular is taken back as the view turns toward the sun.
  if (sunOn && leafy) { sunDirect -= directSpecular(frame.sunDir.xyz, n, v, f0, rough, sunE * sunVis, frame.sunDir.w) * (LEAF_BACKLIT_GLINT_CUT * smoothstep(0.0, 0.7, -dot(frame.sunDir.xyz, v))); }
  let direct = sunDirect + moonDirect;
  let indoor = parkRoom(world) >= 0;
  var litDirect = select(direct, vec3f(0.0), indoor);
  let lightRange = parkLightRange(world);
  for (var i = 0u; i < lightRange.y; i++) {
    let index = parkLightIndex(lightRange.x + i); let eLocal = parkIrradiance(world, index);
    if (eLocal.w < 0.05 || max(eLocal.x, max(eLocal.y, eLocal.z)) < 0.001) { continue; }
    let l = normalize(park.data[index * 2u].xyz - world);
    if (dot(n, l) > 0.0) { litDirect += directLight(l, n, v, diffuseColor, diffuseColor, f0, rough, 0.0, eLocal.rgb, 0.02) * parkShadow(world + n * 0.035, l, max(0.0, eLocal.w - 0.35)); }
  }

  let zenithSky = skyNits(vec3f(0.0, 1.0, 0.0));
  let ground = groundRadiance(sunE, moonE, zenithSky);
  let gd = rt.diffuse;
  let gs = rt.specular;
  var ao = alb.a;
  var irradianceOverPi : vec3f;
  if (gd.a > 0.0) {
    irradianceOverPi = gd.rgb;
    ao = ao * gd.a;
  } else {
    irradianceOverPi = ambientFallback(n, px, ground) * pre;
  }
  let reflDir = normalize(mix(reflect(-v, n), n, rough * rough));
  let specRadiance = mix(envRadiance(reflDir, ground) * pre, gs.rgb, saturate1(gs.a));
  let leafAmbient = (1.0 + LEAF_AMBIENT_BACK * LEAF_TRANSMITTANCE * translucency * ao) * mix(ao, 1.0, LEAF_AO_FILL * translucency * ao);
  var indirect = diffuseColor * irradianceOverPi * leafAmbient
               + specRadiance * envBrdfApprox(f0, rough, nv) * specularOcclusion(nv, ao, rough) * select(1.0, LEAF_SPECULAR_OCCLUSION * ao * ao, leafy && msc.g > 0.0);
  if (indoor) { indirect = diffuseColor * gd.rgb * leafAmbient + gs.rgb * gs.a * envBrdfApprox(f0, rough, nv); }

  var color = litDirect * pre + indirect + emissiveShown(msc.a, pre) * alb.rgb;
  let ap = sampleAerialPerspective(uv, dist);
  // The aerial-perspective volume treats all air as sunlit; the air between the camera and a shaded surface nearby is mostly in the same
  // shade (under and among the trees), so near it keeps only the skylight-scattered share of its in-scatter. Far away the path runs through
  // open sunlit air above the canopy and the volume's value stands.
  let apShade = mix(1.0, mix(AP_SHADE_SKY_SHARE, 1.0, saturate1(visibility)), 1.0 - smoothstep(AP_SHADE_RANGE_M.x, AP_SHADE_RANGE_M.y, dist));
  if (!indoor) { color = color * select(1.0, ap.a, ap.a >= 0.0 && ap.a <= 1.0) + finiteNits(ap.rgb) * pre * apShade; }
  textureStore(hdrOut, px, vec4f(clamp(color, vec3f(0.0), vec3f(MAX_HDR)), 1.0));
}

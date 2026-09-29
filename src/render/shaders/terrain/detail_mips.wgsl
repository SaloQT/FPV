// Box downsample of one mip level of the detail arrays. Albedo is averaged in linear light; normal slopes average (flattening with
// distance) and their variance is folded into roughness so specular does not shimmer.
@group(0) @binding(0) var srcA : texture_2d_array<f32>;
@group(0) @binding(1) var srcB : texture_2d_array<f32>;
@group(0) @binding(2) var dstA : texture_storage_2d_array<rgba8unorm, write>;
@group(0) @binding(3) var dstB : texture_storage_2d_array<rgba8unorm, write>;

fn srgbDecode(c : vec3f) -> vec3f {
  return select(pow((c + 0.055) / 1.055, vec3f(2.4)), c / 12.92, c <= vec3f(0.04045));
}
fn srgbEncode(c : vec3f) -> vec3f {
  return select(1.055 * pow(c, vec3f(1.0 / 2.4)) - 0.055, 12.92 * c, c <= vec3f(0.0031308));
}

@compute @workgroup_size(8, 8, 1)
fn main(@builtin(global_invocation_id) gid : vec3u) {
  let dims = textureDimensions(dstA);
  if (gid.x >= dims.x || gid.y >= dims.y) { return; }
  let layer = i32(gid.z);
  let base = vec2i(gid.xy) * 2;
  var a = vec4f(0.0);
  var slope = vec2f(0.0);
  var slope2 = 0.0;
  var rough2 = 0.0;
  var ao = 0.0;
  for (var i = 0; i < 4; i++) {
    let p = base + vec2i(i & 1, i >> 1);
    let ta = textureLoad(srcA, p, layer, 0);
    let tb = textureLoad(srcB, p, layer, 0);
    a += vec4f(srgbDecode(ta.rgb), ta.a);
    let s = tb.xy * 2.0 - 1.0;
    slope += s;
    slope2 += dot(s, s);
    rough2 += tb.z * tb.z;
    ao += tb.w;
  }
  a *= 0.25;
  slope *= 0.25;
  let variance = max(0.25 * slope2 - dot(slope, slope), 0.0);
  let rough = sqrt(min(0.25 * rough2 + 0.25 * variance, 1.0));
  textureStore(dstA, vec2i(gid.xy), layer, vec4f(srgbEncode(a.rgb), a.a));
  textureStore(dstB, vec2i(gid.xy), layer, vec4f(slope * 0.5 + 0.5, rough, ao * 0.25));
}

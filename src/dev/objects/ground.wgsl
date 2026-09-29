// Dev ground: a heightfield grid draped on the terrain height texture, mown-lawn look. Prepended with common/world_bindings.wgsl.
struct VOut {
  @builtin(position) pos : vec4f,
  @location(0) world : vec3f,
  @location(1) prevClip : vec4f,
  @location(2) currClip : vec4f,
};

fn uvOfClip(clip : vec4f) -> vec2f {
  let ndc = clip.xy / clip.w;
  return vec2f(ndc.x * 0.5 + 0.5, 0.5 - ndc.y * 0.5);
}

@vertex fn vs(@location(0) xz : vec2f) -> VOut {
  let p = vec4f(xz.x, terrainHeightAt(xz) - 0.02, xz.y, 1.0);
  var o : VOut;
  o.pos = frame.viewProj * p;
  o.world = p.xyz;
  o.prevClip = frame.prevViewProj * p;
  o.currClip = frame.viewProjUnjittered * p;
  return o;
}

fn noise(p : vec2f) -> f32 {
  let i = floor(p);
  let f = fract(p);
  let u = f * f * (3.0 - 2.0 * f);
  let c = vec2u(vec2i(i) + vec2i(4096));
  return mix(mix(hash21(c), hash21(c + vec2u(1u, 0u)), u.x), mix(hash21(c + vec2u(0u, 1u)), hash21(c + vec2u(1u, 1u)), u.x), u.y);
}

struct FOut {
  @location(0) albedo : vec4f,
  @location(1) normal : vec4f,
  @location(2) misc : vec4f,
  @location(3) motion : vec2f,
};

@fragment fn fs(in : VOut) -> FOut {
  let near = 1.0 - saturate1(length(in.world - frame.camPos.xyz) / 40.0);
  let stripe = 0.9 + 0.1 * step(fract(in.world.x / 2.0), 0.5);
  let blades = 0.7 + 0.3 * noise(in.world.xz * 45.0) * near + 0.3 * noise(in.world.xz * 0.8);
  var o : FOut;
  o.albedo = vec4f(vec3f(0.12, 0.2, 0.055) * stripe * blades, 1.0);
  o.normal = vec4f(octEncode(terrainNormalAt(in.world.xz)), 0.95, 0.0);
  o.misc = vec4f(1.0 / 255.0, 0.0, 0.0, 0.0);
  o.motion = uvOfClip(in.prevClip) - uvOfClip(in.currClip);
  return o;
}

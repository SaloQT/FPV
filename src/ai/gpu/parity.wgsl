// Parity harness: each invocation is one scripted flight of the GPU flight model, set up and stepped exactly like a QuadPhysics
// (setWind, setAtmosphere, reset, then step with fixed sticks for a block of physics steps). The host compares the state with
// the TypeScript model after every block. Needs: quadConsts, worldConsts, NENV, the Quad layout bound to `q`, world, quad.

@group(0) @binding(0) var<storage, read_write> S : array<f32>;

struct Flight {
  pos : vec3f, yaw : f32,
  sticks : vec4f,
  wind : vec4f,
  gust : f32, alt : f32, temp : f32, seed : u32,
  world : u32, armed : u32, steps : u32, p0 : u32,
}
@group(0) @binding(1) var<storage, read> flights : array<Flight>;

@compute @workgroup_size(64)
fn parityInit(@builtin(global_invocation_id) gid : vec3u) {
  let e = gid.x;
  if (e >= NENV) { return; }
  let f = flights[e];
  loadQuad(e);
  T = tracks[f.world];
  quadSetWind(f.wind.x, f.wind.y, f.wind.z, f.wind.w, f.gust);
  quadSetAtmosphere(f.alt, f.temp);
  quadReset(f.pos, f.yaw, f.seed);
  storeQuad(e);
}

@compute @workgroup_size(64)
fn parityStep(@builtin(global_invocation_id) gid : vec3u) {
  let e = gid.x;
  if (e >= NENV) { return; }
  let f = flights[e];
  loadQuad(e);
  T = tracks[f.world];
  let st = Sticks(f.sticks.x, f.sticks.y, f.sticks.z, f.sticks.w, f.armed != 0u);
  for (var k = 0u; k < f.steps; k++) { advance(st); }
  storeQuad(e);
}

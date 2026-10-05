// Training environments: each invocation is one drone on one training world. A step holds the brain's action on the sticks for
// PHYSICS_PER_ACTION physics steps of the game's flight model (quad.wgsl), the way BrainPilot flies it in the game, then scores
// the step, ends and restarts the episode when it is over and writes the next observation.
//
// Episodes start like the game's own spawns: on the start pad (padPlacement) or 1.5 m before a gate facing through it
// (gatePlacement), at rest, armed, throttle held at zero until the flight controller accepts the arm (GameSession.airArm).
// Gates count like GateTimer: only the gate due next, through its opening, travelling forwards; a circuit loops, an open
// track finishes at its last gate.
//
// Progress is rewarded along the track's centreline (src/ai/train/pathProgress.ts has the TypeScript copy of pathSearch and
// pathArc): every decision finds the nearest path sample in a window around the last one and rewards the change in arc length,
// so a split-S or a loop that flies away from the next gate still earns its way round. A track without a path falls back to
// the straight-line distance to the gate due next.
//
// Needs: quadConsts, worldConsts, envConsts, the Quad and Env layouts bound to `q` and `ev`, world.wgsl, quad.wgsl, and
// `traceWrite` (envKernel.ts: the dashboard trace, or an empty function).

@group(0) @binding(0) var<storage, read_write> S : array<f32>;
@group(0) @binding(1) var<storage, read_write> E : array<f32>;
// Squashed actions from the policy (each component -1..1).
@group(0) @binding(2) var<storage, read> actions : array<vec4f>;
// The rollout slices of this step: next observations [NENV][OBS_SIZE], rewards and episode ends [NENV].
@group(0) @binding(3) var<storage, read_write> obsOut : array<f32>;
@group(0) @binding(4) var<storage, read_write> rewards : array<f32>;
@group(0) @binding(5) var<storage, read_write> dones : array<f32>;

struct EnvUniform { seed : u32, mode : u32, u0 : u32, u1 : u32 }
@group(0) @binding(6) var<uniform> U : EnvUniform;

const NO_LAP : u32 = 0xffffffffu;
const PAD_LIFT_M : f32 = 0.05;
const RESPAWN_BACK_M : f32 = 1.5;
const RESPAWN_MIN_AGL : f32 = 1.5;

fn hashU(x0 : u32) -> u32 {
  var x = x0;
  x ^= x >> 16u; x *= 0x7feb352du;
  x ^= x >> 15u; x *= 0x846ca68bu;
  x ^= x >> 16u;
  return x;
}

fn rnd() -> f32 { return rngNext(&ev.rngEnv); }

fn gateAt(i : u32) -> Gate { return gates[T.gateOff + i]; }
fn gatePos(g : Gate) -> vec3f { return vec3f(g.px, g.py, g.pz); }

fn pathAt(i : u32) -> vec4f { return paths[T.pathOff + i]; }

// Sample i + d: wrapped on a circuit, clamped on an open track.
fn pathStep(i : u32, d : i32) -> u32 {
  let n = i32(T.pathN);
  let j = i32(i) + d;
  if (T.closed != 0u) { return u32(((j % n) + n) % n); }
  return u32(clamp(j, 0, n - 1));
}

// The nearest sample to p from PATH_BACK behind to PATH_AHEAD ahead of i0 (the first one wins a tie).
fn pathSearch(i0 : u32, p : vec3f) -> u32 {
  var best = i0;
  var bestD = 3.0e38;
  for (var k = 0u; k <= PATH_BACK + PATH_AHEAD; k++) {
    let j = pathStep(i0, i32(k) - i32(PATH_BACK));
    let d = p - pathAt(j).xyz;
    let dd = dot(d, d);
    if (dd < bestD) {
      bestD = dd;
      best = j;
    }
  }
  return best;
}

// Arc length of the point nearest p on the segments either side of sample i.
fn pathArc(i : u32, p : vec3f) -> f32 {
  let c = pathAt(i);
  var s = c.w;
  var best = dot(p - c.xyz, p - c.xyz);
  if (T.closed != 0u || i + 1u < T.pathN) {
    let v = pathAt(pathStep(i, 1)).xyz - c.xyz;
    let l2 = dot(v, v);
    if (l2 > 1e-12) {
      let t = clamp(dot(p - c.xyz, v) / l2, 0.0, 1.0);
      let h = c.xyz + v * t - p;
      let d = dot(h, h);
      if (d < best) {
        best = d;
        s = c.w + t * sqrt(l2);
      }
    }
  }
  if (T.closed != 0u || i > 0u) {
    let a = pathAt(pathStep(i, -1)).xyz;
    let v = c.xyz - a;
    let l2 = dot(v, v);
    if (l2 > 1e-12) {
      let t = clamp(dot(p - a, v) / l2, 0.0, 1.0);
      let h = a + v * t - p;
      if (dot(h, h) < best) { s = c.w - (1.0 - t) * sqrt(l2); }
    }
  }
  return s;
}

// Episode start: a spawn the game uses, a fresh battery, randomised wind, atmosphere and sensor seed.
fn spawn(e : u32) {
  ev.episode++;
  // The pick is drawn for every drone so the random stream is the same with or without the dashboard trace.
  let anyWorld = min(u32(rnd() * f32(N_WORLDS)), N_WORLDS - 1u);
  ev.world = select(anyWorld, e % N_WORLDS, e < TRACE_K);
  T = tracks[ev.world];
  var pos : vec3f;
  var yaw : f32;
  let pick = rnd();
  if (T.nGates == 0u || pick < PAD_SPAWN_PROB) {
    pos = vec3f(T.startX, T.startY + PAD_LIFT_M, T.startZ);
    yaw = T.startYaw;
    ev.next = 0u;
    ev.pathIdx = T.pathStart;
  } else {
    let i = min(u32(rnd() * f32(T.nGates)), T.nGates - 1u);
    let g = gateAt(i);
    let x = g.px - g.fx * RESPAWN_BACK_M;
    let z = g.pz - g.fz * RESPAWN_BACK_M;
    let y = max(g.py - g.fy * RESPAWN_BACK_M, groundHeight(x, z) + RESPAWN_MIN_AGL);
    pos = vec3f(x, y, z);
    yaw = g.yaw;
    ev.next = i;
    ev.pathIdx = u32(g.pathAt);
  }
  if (T.pathN > 0u) {
    ev.pathIdx = pathSearch(ev.pathIdx, pos);
    ev.pathS = pathArc(ev.pathIdx, pos);
  }
  // Wind as the app sets it: calm air has no turbulence or gusts, any wind has turbulence 1 and 1.5 gusts a minute.
  var speed = 0.0;
  if (rnd() >= CALM_PROB) { speed = WIND_MAX * rnd(); }
  let windFrom = TWO_PI * rnd();
  let calm = speed <= 0.0;
  quadSetWind(speed, windFrom, select(1.0, 0.0, calm), select(1.5, 0.0, calm), 0.8);
  quadSetAtmosphere(ALT_MAX * rnd(), TEMP_MIN + (TEMP_MAX - TEMP_MIN) * rnd());
  quadReset(pos, yaw, hashU(U.seed ^ hashU(e * 0x9e3779b9u + ev.episode)));
  ev.prevDist = length(gatePos(gateAt(ev.next)) - pos);
  ev.prevAct = vec4f(0.0, 0.0, 0.0, -1.0);
  ev.stall = 0u;
  ev.epSteps = 0u;
  ev.epRet = 0.0;
  ev.lapStart = NO_LAP;
}

// The observation (src/ai/observe.ts, slot map in src/ai/spec.ts).
fn writeObs(e : u32) {
  let o = e * OBS_SIZE;
  let R = quatToMat3(q.quat);
  // world -> body is R transposed: body = (col0 . v, col1 . v, col2 . v)
  let c0 = vec3f(R.r0.x, R.r1.x, R.r2.x);
  let c1 = vec3f(R.r0.y, R.r1.y, R.r2.y);
  let c2 = vec3f(R.r0.z, R.r1.z, R.r2.z);
  var x : array<f32, OBS_SIZE>;
  let vb = vec3f(dot(c0, q.vel), dot(c1, q.vel), dot(c2, q.vel)) * VEL_SCALE;
  x[0] = vb.x; x[1] = vb.y; x[2] = vb.z;
  x[3] = q.angVel.x * RATE_SCALE; x[4] = q.angVel.y * RATE_SCALE; x[5] = q.angVel.z * RATE_SCALE;
  x[6] = R.r1.x; x[7] = R.r1.y; x[8] = R.r1.z;
  x[9] = clamp(q.pos.y - groundHeight(q.pos.x, q.pos.z), 0.0, AGL_MAX) * AGL_SCALE;
  if (T.nGates > 0u) {
    let g1 = gateAt(ev.next % T.nGates);
    let d = gatePos(g1) - q.pos;
    let dist = length(d);
    if (dist > 1e-6) {
      let u = d / dist;
      x[10] = dot(c0, u); x[11] = dot(c1, u); x[12] = dot(c2, u);
    }
    x[13] = min(dist, DIST_MAX) * DIST_SCALE;
    let f = vec3f(g1.fx, g1.fy, g1.fz);
    let up = vec3f(g1.ux, g1.uy, g1.uz);
    x[14] = dot(c0, f); x[15] = dot(c1, f); x[16] = dot(c2, f);
    x[17] = dot(c0, up); x[18] = dot(c1, up); x[19] = dot(c2, up);
    x[20] = g1.hw * 0.5; x[21] = g1.hh * 0.5;
    x[22] = g1.shape;
    x[39] = clamp(-dot(d, f), -DIST_MAX, DIST_MAX) * DIST_SCALE;
    var after = -1;
    let nx = ev.next % T.nGates;
    if (nx + 1u < T.nGates) { after = i32(nx + 1u); } else if (T.closed != 0u) { after = 0; }
    if (after >= 0) {
      let g2 = gateAt(u32(after));
      let rel = gatePos(g2) - gatePos(g1);
      let el = length(rel);
      let k = select(1.0, DIST_MAX / el, el > DIST_MAX) * DIST_SCALE;
      x[23] = dot(c0, rel) * k; x[24] = dot(c1, rel) * k; x[25] = dot(c2, rel) * k;
      let f2 = vec3f(g2.fx, g2.fy, g2.fz);
      x[26] = dot(c0, f2); x[27] = dot(c1, f2); x[28] = dot(c2, f2);
      x[29] = 1.0;
    }
  }
  for (var i = 0u; i < 4u; i++) {
    x[30u + i] = ev.prevAct[i];
    x[34u + i] = abs(q.mOmega[i]) * MOTOR_SCALE;
  }
  x[38] = batVoltage() / BAT_CELLS - CELL_VOLT_CENTRE;
  for (var i = 0u; i < OBS_SIZE; i++) { obsOut[o + i] = x[i]; }
}

fn endEpisode(crashed : bool, finished : bool) {
  ev.sEpisodes += 1.0;
  ev.sRet += ev.epRet;
  ev.sLen += f32(ev.epSteps);
  if (crashed) { ev.sCrashes += 1.0; }
  if (finished) { ev.sFinishes += 1.0; }
}

// Seeds every environment and writes the first observations.
@compute @workgroup_size(64)
fn initEnvs(@builtin(global_invocation_id) gid : vec3u) {
  let e = gid.x;
  if (e >= NENV) { return; }
  loadQuad(e);
  loadEnv(e);
  ev.rngEnv = hashU(U.seed * 0x632be5abu + e * 0x85ebca6bu + 1u);
  ev.rngPol = hashU(U.seed * 0x27d4eb2fu + e * 0x165667b1u + 7u);
  ev.rngPolHas = 0u;
  ev.episode = 0u;
  ev.sBestLap = 3.0e38;
  spawn(e);
  writeObs(e);
  storeQuad(e);
  storeEnv(e);
}

@compute @workgroup_size(64)
fn stepEnvs(@builtin(global_invocation_id) gid : vec3u) {
  let e = gid.x;
  if (e >= NENV) { return; }
  loadQuad(e);
  loadEnv(e);
  T = tracks[ev.world];
  let act = clamp(actions[e], vec4f(-1.0), vec4f(1.0));
  var st = Sticks(act.x, act.y, act.z, (act.w + 1.0) * 0.5, true);
  var reward = 0.0;
  var crashed = false;
  var finished = false;
  let loopTrack = T.closed != 0u || T.nGates < 2u;
  for (var k = 0u; k < PHYSICS_PER_ACTION; k++) {
    let prev = q.pos;
    // GameSession.airArm: hold the throttle at zero until the flight controller has armed.
    var cmd = st;
    if (q.fcArmed == 0u) { cmd.throttle = 0.0; }
    advance(cmd);
    if (q.crashed != 0u) {
      crashed = true;
      break;
    }
    if (T.nGates == 0u) { continue; }
    let g = gateAt(ev.next);
    if (!gatePassed(g, prev, q.pos)) { continue; }
    reward += GATE_REWARD;
    ev.stall = 0u;
    ev.sGates += 1.0;
    let now = ev.epSteps * PHYSICS_PER_ACTION + k + 1u;
    if (loopTrack) {
      if (ev.next == 0u) {
        if (ev.lapStart != NO_LAP) {
          ev.sLaps += 1.0;
          ev.sBestLap = min(ev.sBestLap, f32(now - ev.lapStart) * DT);
        }
        ev.lapStart = now;
      }
      ev.next = (ev.next + 1u) % T.nGates;
    } else if (ev.next + 1u >= T.nGates) {
      finished = true;
      break;
    } else {
      ev.next++;
    }
    ev.prevDist = length(gatePos(gateAt(ev.next)) - q.pos);
  }
  ev.epSteps++;
  ev.stall++;
  // Progress along the centreline (the short way round a circuit's lap), or toward the gate due next on a track without a
  // path, where a pass restarted the measure from the new gate.
  let dist = length(gatePos(gateAt(ev.next)) - q.pos);
  if (T.pathN > 0u) {
    ev.pathIdx = pathSearch(ev.pathIdx, q.pos);
    let s = pathArc(ev.pathIdx, q.pos);
    var ds = s - ev.pathS;
    if (T.closed != 0u) {
      if (ds > 0.5 * T.pathLength) { ds -= T.pathLength; } else if (ds < -0.5 * T.pathLength) { ds += T.pathLength; }
    }
    if (!finished) { reward += PROGRESS_REWARD * clamp(ds, -PATH_MAX_STEP, PATH_MAX_STEP); }
    ev.pathS = s;
  } else if (!finished) {
    reward += PROGRESS_REWARD * (ev.prevDist - dist);
  }
  ev.prevDist = dist;
  let da = act - ev.prevAct;
  reward -= RATE_PENALTY * dot(q.angVel, q.angVel) + SMOOTH_PENALTY * dot(da, da);
  let p = q.pos;
  let outside = p.x < T.x0 || p.x > T.x1 || p.z < T.z0 || p.z > T.z1 || p.y > T.maxY + CEILING_M || p.y < T.minY - 10.0;
  let empty = batVoltage() / BAT_CELLS < BATTERY_EMPTY_V;
  var done = crashed || finished || outside || empty;
  if (crashed || outside) { reward -= CRASH_PENALTY; }
  if (!done && ev.stall >= STALL_STEPS) {
    reward -= STALL_PENALTY;
    done = true;
  }
  if (!done && ev.epSteps >= EPISODE_STEPS) { done = true; }
  ev.epRet += reward;
  rewards[e] = reward;
  dones[e] = select(0.0, 1.0, done);
  // Dashboard trace (before a reset, so a crash shows where it happened): world, gate due next, crashed, finished, done.
  traceWrite(e, p, ev.world | (min(ev.next, 0xfffu) << 12u) | (select(0u, 1u, crashed || outside) << 24u)
    | (select(0u, 1u, finished) << 25u) | (select(0u, 1u, done) << 26u));
  ev.prevAct = act;
  if (done) {
    endEpisode(crashed || outside, finished);
    spawn(e);
  }
  writeObs(e);
  storeQuad(e);
  storeEnv(e);
}

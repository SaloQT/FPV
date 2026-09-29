// Quad G-buffer pipelines: the rigid body mesh and the spinning props, both moved by the model matrix from group 2.
#include "objects/quad_materials.wgsl"

const PROP_TIP_START : f32 = ${PROP_R} * 0.86;

struct BodyOut {
  @builtin(position) pos : vec4f,
  @location(0) obj : vec3f,
  @location(1) nrm : vec3f,
  @location(2) uv : vec2f,
  @location(3) ao : f32,
  @location(4) @interpolate(flat) a2 : f32,
  @location(5) @interpolate(flat) kind : u32,
  @location(6) prevClip : vec4f,
  @location(7) currClip : vec4f,
};

@vertex fn vsBody(@location(0) p : vec3f, @location(1) n : vec3f, @location(2) uv : vec2f, @location(3) attr : vec4f) -> BodyOut {
  var o : BodyOut;
  let w = quad.model * vec4f(p, 1.0);
  o.pos = frame.viewProj * w;
  o.obj = p;
  o.nrm = n;
  o.uv = uv;
  o.ao = attr.y;
  o.a2 = attr.z;
  o.kind = u32(attr.x + 0.5);
  o.prevClip = frame.prevViewProj * (quad.prevModel * vec4f(p, 1.0));
  o.currClip = frame.viewProjUnjittered * w;
  return o;
}

fn matIn(p : vec3f, n : vec3f, uv : vec2f, ao : f32, a2 : f32, kind : u32, fp : f32) -> MatIn {
  var m : MatIn;
  m.p = p;
  m.n = normalize(n);
  m.uv = uv;
  m.ao = ao;
  m.a2 = a2;
  m.kind = kind;
  m.fp = fp;
  return m;
}

@fragment fn fsBody(in : BodyOut) -> GOut {
  let fp = max(length(dpdx(in.obj)), length(dpdy(in.obj)));
  var s = shadeQuad(matIn(in.obj, in.nrm, in.uv, in.ao, in.a2, in.kind, fp));
  s.normal = normalize(quadRot() * s.normal);
  return packG(s, in.prevClip, in.currClip);
}

// ---- props ----

struct PropOut {
  @builtin(position) pos : vec4f,
  @location(0) local : vec3f,
  @location(1) nrm : vec3f,
  @location(2) ao : f32,
  @location(3) @interpolate(flat) kind : u32,
  @location(4) @interpolate(flat) motor : u32,
  @location(5) prevClip : vec4f,
  @location(6) currClip : vec4f,
};

// The clockwise mesh is drawn for instances 0 and 1 (motors 0 and 2), the counter-clockwise mesh for instances 2 and 3 (motors 1 and 3).
fn motorOfInstance(ii : u32) -> u32 {
  return select(2u * ii, 2u * (ii - 2u) + 1u, ii >= 2u);
}

@vertex fn vsProp(@location(0) p : vec3f, @location(1) n : vec3f, @location(2) uv : vec2f, @location(3) attr : vec4f, @builtin(instance_index) ii : u32) -> PropOut {
  let motor = motorOfInstance(ii);
  let sp = quad.spin[motor];
  let centre = quad.prop[motor].xyz;
  let rot = rotY(sp.x);
  let w = quad.model * vec4f(centre + rot * p, 1.0);
  var o : PropOut;
  o.pos = frame.viewProj * w;
  o.local = p;
  o.nrm = quadRot() * (rot * n);
  o.ao = attr.y;
  o.kind = u32(attr.x + 0.5);
  o.motor = motor;
  // Only blades carry their own spin in the motion vector; the hub is round, and a whole-turn jump would smear it.
  var prevRot = rot;
  if (o.kind == ${K_PROP}u) { prevRot = rotY(sp.y); }
  o.prevClip = frame.prevViewProj * (quad.prevModel * vec4f(centre + prevRot * p, 1.0));
  o.currClip = frame.viewProjUnjittered * w;
  return o;
}

fn bladeSurf(motor : u32, local : vec3f, n : vec3f, ao : f32) -> Surf {
  var s = newSurf(vec3f(0.045, 0.043, 0.042), normalize(n), 0.22, MAT_QUAD);
  // Front props (motors 0 and 3) get bright tips so the quad's heading reads from behind.
  let front = motor == 0u || motor == 3u;
  let tip = smoothstep(PROP_TIP_START, PROP_TIP_START + 0.004, length(local.xz));
  s.albedo = mix(s.albedo, select(vec3f(0.07, 0.07, 0.075), vec3f(0.9, 0.14, 0.02), front), tip);
  s.translucency = 0.25;
  s.ao = ao;
  return s;
}

@fragment fn fsProp(in : PropOut) -> GOut {
  let fp = max(length(dpdx(in.local)), length(dpdy(in.local)));
  let sp = quad.spin[in.motor];
  let blade = in.kind == ${K_PROP}u;
  // Blades thin out stochastically as the rotor speeds up (TAA integrates it into a fade); the hub and nut always stay.
  let noise = hash21(vec2u(in.pos.xy) + vec2u(pcg(frame.misc.x), 0u));
  if (blade && noise >= sp.z) { discard; }
  var s : Surf;
  if (blade) {
    s = bladeSurf(in.motor, in.local, in.nrm, in.ao);
  } else if (in.kind == ${K_STEEL}u) {
    s = steelSurf(matIn(in.local, in.nrm, vec2f(0.0), in.ao, 0.0, in.kind, fp), newSurf(vec3f(0.5), normalize(in.nrm), 0.5, MAT_QUAD));
  } else {
    s = newSurf(vec3f(0.03, 0.03, 0.034), normalize(in.nrm), 0.4, MAT_QUAD);
    s.ao = in.ao;
  }
  return packG(s, in.prevClip, in.currClip);
}

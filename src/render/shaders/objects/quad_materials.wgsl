// Material dispatch of the quad by per vertex kind (K_* defines from materials.ts).
#include "objects/quad_carbon.wgsl"
#include "objects/quad_parts.wgsl"

fn shadeQuad(m : MatIn) -> Surf {
  var s = newSurf(vec3f(0.5), m.n, 0.5, MAT_QUAD);
  s.ao = m.ao;
  switch (m.kind) {
    case ${K_CARBON}u: { s = carbonSurf(m, s); }
    case ${K_ALU}u: { s = aluSurf(m, s); }
    case ${K_PCB}u: { s = pcbSurf(m, s); }
    case ${K_BATTERY}u: { s = batterySurf(m, s); }
    case ${K_RUBBER}u: { s = rubberSurf(m, s); }
    case ${K_MOTOR_BELL}u: { s = bellSurf(m, s); }
    case ${K_MOTOR_BASE}u: { s = baseSurf(m, s); }
    case ${K_PLASTIC}u: { s = plasticSurf(m, s); }
    case ${K_LENS}u: { s = lensSurf(m, s); }
    case ${K_LED}u: { s = ledSurf(m, s); }
    case ${K_WIRE}u: { s = wireSurf(m, s); }
    case ${K_STEEL}u: { s = steelSurf(m, s); }
    default: {}
  }
  return s;
}

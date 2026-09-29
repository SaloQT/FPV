// Shared prologue of the atmosphere LUT compute passes. The passes bind their OWN group 1 (never rc.world.group: the LUTs they write
// are also part of it, and one texture may not be sampled and written in the same dispatch), so the world bindings of
// common/atmosphere_sample.wgsl are re-declared here at the pass's own slots. skyViewLUT / aerialPerspective are unused stand-ins
// (declared only so the shared sampling code compiles); a binding that no entry point uses needs no layout entry.
//
// UNIT CHAIN: see sky/atmos_params.wgsl. All LUT contents are nits (cd/m2) per the lights' illuminance in lux; never pre-exposed.
#include "common/math.wgsl"
#include "common/frame.wgsl"

@group(1) @binding(0) var linearClamp : sampler;
@group(1) @binding(1) var transmittanceLUT : texture_2d<f32>;
@group(1) @binding(2) var multiScatterLUT : texture_2d<f32>;
@group(1) @binding(40) var skyViewLUT : texture_2d<f32>;
@group(1) @binding(41) var aerialPerspective : texture_3d<f32>;

#include "common/atmosphere_sample.wgsl"
#include "sky/atmos_params.wgsl"

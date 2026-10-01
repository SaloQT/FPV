// Sky-view LUT lookups that survive fp16 overflow. The LUT (rgba16float) holds un-exposed nits; near a low sun the aureole exceeds 65504 nits and
// the red channel stores Inf (a 12 x 5 texel patch at azimuth 0 for a 5 degree sun). A bilinear tap with weight 0 on such a texel then yields
// NaN (Inf * 0), and every consumer that averages it (GI rays, radiance probes, temporal history) is poisoned for good. Anything the LUT cannot
// represent reads as its largest finite value.
#include "common/atmosphere_sample.wgsl"

const SKY_NITS_MAX : f32 = 65000.0;

fn finiteNits(c : vec3f) -> vec3f { return select(vec3f(SKY_NITS_MAX), c, abs(c) <= vec3f(SKY_NITS_MAX)); }

fn skyNits(dir : vec3f) -> vec3f { return finiteNits(sampleSkyView(dir)); }

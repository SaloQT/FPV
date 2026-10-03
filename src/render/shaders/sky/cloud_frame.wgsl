// Frame-invariant cloud lighting. Kept in f32 storage (96 bytes, including struct padding),
// never rounded to fp16. Recomputed after the atmosphere LUTs for every encoded cloud frame.
#include "sky/cloud_light.wgsl"

struct CloudFrame {
  lights : CloudLights,
  ambient : Ambient,
};

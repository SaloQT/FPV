#include "sky/cloud_frame.wgsl"

@group(1) @binding(11) var<storage, read_write> cloudFrame : CloudFrame;

@compute @workgroup_size(1)
fn main() {
  let datumR = datumRadius();
  let lights = cloudLights(datumR + 0.5 * (ap.cloudB.x + ap.cloudB.y));
  let amb = cloudAmbient(lights, datumR);
  cloudFrame.lights = lights;
  cloudFrame.ambient = amb;
}

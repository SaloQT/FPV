// Which full-resolution pixel an RT-resolution texel samples this frame. Pure (no bindings): shared by the RT passes and by the
// bilateral upsample in lighting/deferred.wgsl, which must agree on it.
//   div 1: identity.  div 2: one of the 2x2 block by frame parity (0,0) (1,1) (1,0) (0,1).
//   div 4: Bayer-ordered pick inside the 4x4 block; nibble k of BAYER_LO / BAYER_HI is the (x | y << 2) offset for frame k & 15.
const BAYER_LO : u32 = 0xD75F82A0u;
const BAYER_HI : u32 = 0xC6E493B1u;

fn rtSourcePixel(rtPx : vec2i, div : i32, fullDims : vec2i, frameIdx : u32) -> vec2i {
  var off = vec2i(0);
  if (div == 2) {
    let k = frameIdx & 3u;
    off = vec2i(select(0, 1, k == 1u || k == 2u), select(0, 1, k == 1u || k == 3u));
  } else if (div == 4) {
    let k = frameIdx & 15u;
    let w = select(BAYER_LO, BAYER_HI, k >= 8u);
    let nib = (w >> ((k & 7u) * 4u)) & 15u;
    off = vec2i(i32(nib & 3u), i32(nib >> 2u));
  }
  return min(rtPx * div + off, fullDims - vec2i(1));
}

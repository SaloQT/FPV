/** CPU packing of the `RtParams` uniform (shaders/rt/rt_common.wgsl, 8 x vec4 = 128 bytes). Keep the two in sync. */
export const RT_PARAM_BYTES = 128;
export const FLAG_SPEC = 1;
export const FLAG_TERRAIN = 2;

export interface RtParamInput {
  rtWidth: number;
  rtHeight: number;
  fullWidth: number;
  fullHeight: number;
  divisor: number;
  maxSteps: number;
  giRays: number;
  spec: boolean;
  terrain: boolean;
  staticRoot: number;
  dynamicRoot: number;
  visitCap: number;
  frameIndex: number;
  debugView: number;
  seed: number;
  probeStride: number;
  probePhase: number;
  probeLo: readonly [number, number, number];
  probeRays: number;
  probePrevLo: readonly [number, number, number];
  probeAllFresh: boolean;
  probeDim: readonly [number, number, number];
  softness: number;
  probeSpacing: number;
  probeHysteresis: number;
  rayRange: number;
}

export class RtParamBlock {
  readonly buffer = new ArrayBuffer(RT_PARAM_BYTES);
  readonly u32 = new Uint32Array(this.buffer);
  readonly i32 = new Int32Array(this.buffer);
  readonly f32 = new Float32Array(this.buffer);

  write(p: RtParamInput): void {
    const u = this.u32, i = this.i32, f = this.f32;
    u[0] = p.rtWidth; u[1] = p.rtHeight; u[2] = p.fullWidth; u[3] = p.fullHeight;
    u[4] = p.divisor; u[5] = p.maxSteps; u[6] = p.giRays; u[7] = (p.spec ? FLAG_SPEC : 0) | (p.terrain ? FLAG_TERRAIN : 0);
    u[8] = p.staticRoot; u[9] = p.dynamicRoot; u[10] = p.visitCap; u[11] = p.frameIndex;
    u[12] = p.debugView; u[13] = p.seed; u[14] = p.probeStride; u[15] = p.probePhase;
    i[16] = p.probeLo[0]; i[17] = p.probeLo[1]; i[18] = p.probeLo[2]; i[19] = p.probeRays;
    i[20] = p.probePrevLo[0]; i[21] = p.probePrevLo[1]; i[22] = p.probePrevLo[2]; i[23] = p.probeAllFresh ? 1 : 0;
    u[24] = p.probeDim[0]; u[25] = p.probeDim[1]; u[26] = p.probeDim[2]; u[27] = 0;
    f[28] = p.softness; f[29] = p.probeSpacing; f[30] = p.probeHysteresis; f[31] = p.rayRange;
  }
}

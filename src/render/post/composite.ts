import type { Quat } from '../../contracts';
import type { FrameInfo, RenderContext } from '../contracts';
import { bloomEnergy } from './bloom';
import type { CompositeInput, CompositeStage, OutSize, PostParams } from './types';

/**
 * Constants of the FPV camera model. The shader carries the display-side constants (GRADE, SENSOR) itself, see tonemap.wgsl / sensor.wgsl.
 * readout: full-frame sensor readout time; a typical FPV CMOS/analog camera scans top to bottom in about 8 ms, which is what makes fast yaw lean the image.
 * omegaTau: low-pass on the angular velocity estimate (finite differences of the camera quaternion are noisy at 240 fps).
 * cutOmega: an estimate above this is a camera cut or teleport, not motion.
 * jello: vibration amplitude in pixels at `jelloRefOmega` (mean motor speed, rad/s); it grows with the square of the motor speed.
 */
export const COMPOSITE_TUNING = {
  readout: 0.008,
  omegaTau: 0.02,
  maxOmega: 40,
  cutOmega: 200,
  k1: -0.25,
  k2: 0.05,
  caEdgePx: 0.8,
  softEdgePx: 1.2,
  vignetteBase: 0.35,
  noiseGain: 2,
  jelloPx: 0.45,
  jelloRefOmega: 2500,
} as const;

const TWO_PI = Math.PI * 2;
const PARAM_BYTES = 112;
const clamp01 = (v: number): number => (v > 0 ? (v < 1 ? v : 1) : 0);

/** Brown-Conrady coefficients for a `lensDistortion` setting; `zoom` = f(1) keeps the image corner fixed after the inverse mapping. */
export function lensCoefficients(lens: number): { k1: number; k2: number; zoom: number } {
  const t = clamp01(lens);
  const k1 = COMPOSITE_TUNING.k1 * t;
  const k2 = COMPOSITE_TUNING.k2 * t;
  return { k1, k2, zoom: 1 + k1 + k2 };
}

/** Whether the hardware applies the sRGB OETF for this canvas format, and one output code step (0 = do not dither). */
export function canvasFormatInfo(format: GPUTextureFormat): { hwSrgb: boolean; ditherLsb: number } {
  if (format.endsWith('-srgb')) return { hwSrgb: true, ditherLsb: 1 / 255 };
  if (format === 'rgb10a2unorm') return { hwSrgb: false, ditherLsb: 1 / 1023 };
  if (format === 'rgba16float') return { hwSrgb: false, ditherLsb: 0 };
  return { hwSrgb: false, ditherLsb: 1 / 255 };
}

/**
 * Angular velocity (rad/s, in the camera's own axes) that rotates `prev` into `cur` in `dt` seconds. q_cur = q_prev * dq, so dq's
 * vector part is already expressed in the camera frame. Writes `out[0..2]`; returns the rotation angle in radians.
 */
export function angularVelocity(out: number[], prev: Quat, cur: Quat, dt: number): number {
  const [ax, ay, az, aw] = prev;
  const [bx, by, bz, bw] = cur;
  // conj(prev) * cur
  let x = aw * bx - ax * bw - ay * bz + az * by;
  let y = aw * by + ax * bz - ay * bw - az * bx;
  let z = aw * bz - ax * by + ay * bx - az * bw;
  let w = aw * bw + ax * bx + ay * by + az * bz;
  if (w < 0) { x = -x; y = -y; z = -z; w = -w; }
  const s = Math.hypot(x, y, z);
  const angle = 2 * Math.atan2(s, w);
  const k = s > 1e-12 && dt > 0 ? angle / (s * dt) : 0;
  out[0] = x * k;
  out[1] = y * k;
  out[2] = z * k;
  return angle;
}

/** Jello amplitude in pixels for a mean motor speed (rad/s). */
export function jelloAmplitude(meanMotorOmega: number): number {
  const t = clamp01(Math.abs(meanMotorOmega) / COMPOSITE_TUNING.jelloRefOmega);
  return COMPOSITE_TUNING.jelloPx * t * t;
}

export function createCompositeStage(): CompositeStage {
  let device: GPUDevice;
  let layout: GPUBindGroupLayout;
  let pipeline: GPURenderPipeline;
  let sampler: GPUSampler;
  let paramBuffer: GPUBuffer;
  let group: GPUBindGroup | null = null;
  let boundResolved: GPUTextureView | null = null;
  let boundBloom: GPUTextureView | null = null;
  let boundExposure: GPUBuffer | null = null;
  let attachment: GPURenderPassColorAttachment | null = null;
  let desc: GPURenderPassDescriptor | null = null;

  const data = new ArrayBuffer(PARAM_BYTES);
  const f32 = new Float32Array(data);
  const u32 = new Uint32Array(data);
  const prevQuat: Quat = [0, 0, 0, 1];
  const rawOmega = [0, 0, 0];
  const omega = [0, 0, 0];
  let havePrev = false;
  // capture() re-encodes the last frame with the same index; integrating it twice would decay omega and advance the jello phase.
  let lastFrame = -1;
  let jelloPhase = 0;
  let jelloHz = 0;
  let jelloPx = 0;

  return {
    init(rc: RenderContext) {
      device = rc.device;
      const F = GPUShaderStage.FRAGMENT;
      layout = device.createBindGroupLayout({
        label: 'composite',
        entries: [
          { binding: 0, visibility: F, texture: { sampleType: 'float' } },
          { binding: 1, visibility: F, texture: { sampleType: 'float' } },
          { binding: 2, visibility: F, sampler: { type: 'filtering' } },
          { binding: 3, visibility: F, buffer: { type: 'uniform', minBindingSize: 32 } },
          { binding: 4, visibility: F, buffer: { type: 'uniform', minBindingSize: PARAM_BYTES } },
        ],
      });
      sampler = device.createSampler({ label: 'composite linear clamp', magFilter: 'linear', minFilter: 'linear', addressModeU: 'clamp-to-edge', addressModeV: 'clamp-to-edge' });
      paramBuffer = device.createBuffer({ label: 'composite params', size: PARAM_BYTES, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
      const fmt = canvasFormatInfo(rc.canvasFormat);
      const module = rc.module('post/composite.wgsl', { DITHER_LSB: fmt.ditherLsb, OUT_HW_SRGB: fmt.hwSrgb });
      pipeline = device.createRenderPipeline({
        label: 'composite',
        layout: device.createPipelineLayout({ bindGroupLayouts: [layout] }),
        vertex: { module, entryPoint: 'vs' },
        fragment: { module, entryPoint: 'fs', targets: [{ format: rc.canvasFormat }] },
        primitive: { topology: 'triangle-list' },
      });
    },

    resize(_rc: RenderContext, _out: OutSize) {
      group = null;
    },

    update(_rc: RenderContext, f: FrameInfo) {
      if (f.frameIndex === lastFrame) return;
      lastFrame = f.frameIndex;
      const T = COMPOSITE_TUNING;
      const q = f.camera.quat;
      let speed = 0;
      if (havePrev && f.dt > 1e-6) {
        angularVelocity(rawOmega, prevQuat, q, f.dt);
        speed = Math.hypot(rawOmega[0], rawOmega[1], rawOmega[2]);
      }
      if (speed > T.cutOmega || !havePrev || f.dt <= 1e-6) {
        omega[0] = omega[1] = omega[2] = 0;
      } else {
        const a = 1 - Math.exp(-f.dt / T.omegaTau);
        const lim = speed > T.maxOmega ? T.maxOmega / speed : 1;
        for (let i = 0; i < 3; i++) omega[i] += (rawOmega[i] * lim - omega[i]) * a;
      }
      prevQuat[0] = q[0]; prevQuat[1] = q[1]; prevQuat[2] = q[2]; prevQuat[3] = q[3];
      havePrev = true;

      const m = f.quad?.motorOmega;
      const mean = m ? (Math.abs(m[0]) + Math.abs(m[1]) + Math.abs(m[2]) + Math.abs(m[3])) / 4 : 0;
      jelloHz = mean / TWO_PI;
      jelloPx = jelloAmplitude(mean);
      jelloPhase = (jelloPhase + TWO_PI * jelloHz * Math.max(f.dt, 0)) % TWO_PI;
    },

    encode(enc: GPUCommandEncoder, rc: RenderContext, f: FrameInfo, p: PostParams, io: CompositeInput) {
      const T = COMPOSITE_TUNING;
      const w = Math.max(1, p.outWidth);
      const h = Math.max(1, p.outHeight);
      const lens = clamp01(rc.settings.lensDistortion);
      const vn = clamp01(rc.settings.videoNoise);
      const k = lensCoefficients(lens);
      f32[0] = w; f32[1] = h; f32[2] = 1 / w; f32[3] = 1 / h;
      f32[4] = k.k1; f32[5] = k.k2; f32[6] = k.zoom; f32[7] = (T.caEdgePx * lens) / (0.5 * Math.hypot(w, h));
      f32[8] = T.vignetteBase + (1 - T.vignetteBase) * lens;
      f32[9] = T.softEdgePx * lens;
      f32[10] = rc.quality.bloom ? bloomEnergy() : 0;
      f32[11] = T.noiseGain * vn;
      f32[12] = omega[0]; f32[13] = omega[1]; f32[14] = omega[2];
      f32[15] = (0.5 * h) / Math.tan(0.5 * f.camera.fovY);
      f32[16] = jelloPx; f32[17] = jelloPhase; f32[18] = TWO_PI * jelloHz * T.readout; f32[19] = T.readout;
      f32[20] = vn;
      u32[24] = f.frameIndex >>> 0;
      u32[25] = io.debug;
      device.queue.writeBuffer(paramBuffer, 0, data);

      if (!group || boundResolved !== io.resolved || boundBloom !== io.bloom || boundExposure !== io.exposure) {
        boundResolved = io.resolved;
        boundBloom = io.bloom;
        boundExposure = io.exposure;
        group = device.createBindGroup({
          label: 'composite',
          layout,
          entries: [
            { binding: 0, resource: io.resolved },
            { binding: 1, resource: io.bloom },
            { binding: 2, resource: sampler },
            { binding: 3, resource: { buffer: io.exposure, size: 32 } },
            { binding: 4, resource: { buffer: paramBuffer } },
          ],
        });
      }
      if (!attachment || !desc) {
        attachment = { view: io.target, loadOp: 'clear', storeOp: 'store', clearValue: [0, 0, 0, 1] };
        desc = { label: 'composite', colorAttachments: [attachment] };
      }
      attachment.view = io.target;
      const pass = enc.beginRenderPass(desc);
      pass.setPipeline(pipeline);
      pass.setBindGroup(0, group);
      pass.draw(3);
      pass.end();
    },

    destroy() {
      paramBuffer?.destroy();
      group = null;
    },
  };
}

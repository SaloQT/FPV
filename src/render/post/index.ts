import type { Quat, Vec3 } from '../../contracts';
import type { FrameInfo, PostProcessor, RenderContext } from '../contracts';
import { createBloomStage } from './bloom';
import { createCompositeStage } from './composite';
import { createExposureStage } from './exposure';
import { createMotionBlurStage } from './motionBlur';
import { createTaaStage } from './taa';
import type { CompositeInput, OutSize, PostFlags, PostParams } from './types';

/** 0 final, 1 no TAA (composite reads the raw jittered render-res image), 2 exposure heat overlay, 3 bloom only. */
export type PostDebugMode = 0 | 1 | 2 | 3;
export type PostProcessorDev = PostProcessor & {
  setDebug(mode: PostDebugMode): void;
  getStats(): { exposureEv: number | null };
  /** The TAA output and the bloom output of the last encoded frame (both rgba16float, COPY_SRC), for dev readbacks. */
  debugTextures(): { resolved: GPUTexture; bloom: GPUTexture };
};

/**
 * A quad at 100 m/s moves 0.4 m per frame at 240 fps and 10 m in a 10 fps hitch (dt is capped at 0.1 s upstream); anything beyond these
 * per-frame jumps is a teleport or a scene cut whose motion vectors point at nothing, so history is dropped instead of smeared.
 */
export const CUT_DISTANCE_M = 30;
export const CUT_ANGLE_RAD = 2;

export function sanitizeDebug(mode: number): PostDebugMode {
  return mode === 1 || mode === 2 || mode === 3 ? mode : 0;
}

/** Debug mode 1 bypasses the resolve; every other mode composites the TAA output. */
export function pickResolved<T>(mode: PostDebugMode, resolved: T, raw: T): T {
  return mode === 1 ? raw : resolved;
}

/** frameIndex advances by exactly 1 per rendered frame; the same index again is a Renderer.capture() re-encode of the last frame. */
export function frameContinuous(last: number, current: number): boolean {
  return current === last || current === last + 1;
}

/** Rotation angle (rad) between two unit quaternions. */
export function quatAngle(a: Quat, b: Quat): number {
  const d = Math.abs(a[0] * b[0] + a[1] * b[1] + a[2] * b[2] + a[3] * b[3]);
  return 2 * Math.acos(Math.min(d, 1));
}

export function isCameraCut(prevPos: Vec3, prevQuat: Quat, pos: Vec3, quat: Quat): boolean {
  const d = Math.hypot(pos[0] - prevPos[0], pos[1] - prevPos[1], pos[2] - prevPos[2]);
  return d > CUT_DISTANCE_M || quatAngle(prevQuat, quat) > CUT_ANGLE_RAD;
}

export interface HistoryTracker {
  /** Output size or stage resources changed: the next `step` reports a reset. */
  invalidate(): void;
  /** Called once per encoded frame; true when TAA/exposure history must be ignored for this frame. */
  step(frameIndex: number, pos: Vec3, quat: Quat): boolean;
  /** The last `step` saw the same frameIndex as the one before it (a capture re-encode). */
  readonly repeated: boolean;
}

export function createHistoryTracker(): HistoryTracker {
  let pending = true;
  let last = -1;
  let repeated = false;
  const pos: Vec3 = [0, 0, 0];
  const quat: Quat = [0, 0, 0, 1];
  return {
    invalidate() { pending = true; },
    step(frameIndex, p, q) {
      const cut = pending || !frameContinuous(last, frameIndex) || isCameraCut(pos, quat, p, q);
      repeated = !pending && frameIndex === last;
      pending = false;
      last = frameIndex;
      pos[0] = p[0]; pos[1] = p[1]; pos[2] = p[2];
      quat[0] = q[0]; quat[1] = q[1]; quat[2] = q[2]; quat[3] = q[3];
      return cut;
    },
    get repeated() { return repeated; },
  };
}

/**
 * Post-processing orchestrator. Frame order: motion blur -> TAAU (input = motion blur output) -> exposure(resolved) -> bloom(resolved)
 * -> composite(target). All state that crosses frames lives in the stages; this owns only the history-validity decision.
 */
export function createPostProcessor(): PostProcessorDev {
  const motionBlur = createMotionBlurStage();
  const taa = createTaaStage();
  const exposure = createExposureStage();
  const bloom = createBloomStage();
  const composite = createCompositeStage();
  const history = createHistoryTracker();
  const flags: PostFlags = { reset: true, taa: true, bloom: true };
  const params: PostParams = { outWidth: 0, outHeight: 0, preExposure: 1, prevPreExposure: 1 };
  const io = {} as CompositeInput;
  let debug: PostDebugMode = 0;
  let outW = 0;
  let outH = 0;

  return {
    init(rc: RenderContext) {
      motionBlur.init(rc);
      taa.init(rc);
      exposure.init(rc);
      bloom.init(rc);
      composite.init(rc);
    },

    resize(rc: RenderContext, out: OutSize) {
      motionBlur.resize(rc, out);
      taa.resize(rc, out);
      exposure.resize(rc, out);
      bloom.resize(rc, out);
      composite.resize(rc, out);
      // A render-resolution change alone keeps the out-res history valid; only a new output size starts over.
      if (out.width !== outW || out.height !== outH) history.invalidate();
      outW = out.width;
      outH = out.height;
    },

    update(rc: RenderContext, f: FrameInfo) {
      composite.update(rc, f);
    },

    encode(enc: GPUCommandEncoder, rc: RenderContext, f: FrameInfo, target: GPUTextureView, o: { outWidth: number; outHeight: number; preExposure: number; prevPreExposure: number }) {
      flags.reset = history.step(f.frameIndex, f.camera.pos, f.camera.quat);
      flags.taa = rc.quality.taa;
      flags.bloom = rc.quality.bloom;
      params.outWidth = o.outWidth;
      params.outHeight = o.outHeight;
      params.preExposure = o.preExposure;
      // A capture re-encode of the same frame: the history was already rescaled to this pre-exposure by the original encode.
      params.prevPreExposure = history.repeated ? o.preExposure : o.prevPreExposure;

      motionBlur.encode(enc, rc, f, params, flags);
      taa.encode(enc, rc, f, params, flags, motionBlur.output);
      exposure.encode(enc, rc, f, params, flags, taa.resolved);
      bloom.encode(enc, rc, f, params, flags, taa.resolved);

      io.resolved = pickResolved(debug, taa.resolved, rc.gbuf.views.hdr);
      io.bloom = bloom.output;
      io.exposure = exposure.ratio;
      io.target = target;
      io.debug = debug;
      composite.encode(enc, rc, f, params, io);
    },

    setDebug(mode: PostDebugMode) {
      debug = sanitizeDebug(mode);
    },

    getStats() {
      return exposure.getStats();
    },

    debugTextures() {
      return { resolved: taa.resolvedTexture, bloom: bloom.outputTexture };
    },

    destroy() {
      motionBlur.destroy();
      taa.destroy();
      exposure.destroy();
      bloom.destroy();
      composite.destroy();
    },
  };
}

import type { DetailName, GpuProfiler } from '../gpuTimer';
import type { FrameInfo, GBuffer, RenderContext, RenderModule, SceneData } from '../contracts';
import type { TerrainSampler } from '../../contracts';
import { atmosphereOf } from '../atmosphere';
import { buildGroups, type RtGroups } from './groups';
import { createLayouts, type RtLayouts } from './layouts';
import { RtParamBlock, RT_PARAM_BYTES, type RtParamInput } from './params';
import { ATROUS_ITERATIONS, createPipelines, createTestPipeline, type RtPipelines, type Signal } from './pipelines';
import { probeLimits, ProbeGrid, type ProbeLimits } from './probes';
import { runSelfTest, type RtSelfTest } from './selfTest';
import { SceneBuffers } from './sceneBuffers';
import { RtTextures } from './textures';

export type { RtSelfTest };

/** Debug views: 0 off, 1 sun shadow, 2 GI only, 3 ambient occlusion, 4 specular, 5 probe SH, 6 variance (r) and history length (g). */
export const RT_DEBUG_VIEWS = 6;

export interface RtOptions {
  /** Scales the key light's cone angle: 0 = hard shadows, 1 = physical penumbra. */
  softness: number;
  /** Longest diffuse / specular / probe ray in metres. */
  rayRange: number;
  /** Fraction of the old probe value kept by an update (0.9 .. 0.95). */
  probeHysteresis: number;
  /** Probe rays traced per frame at most (null = the quality profile's own budget, see probeLimits); a bigger grid refreshes a rotating 1/K of its probes each frame. */
  probeRayBudget: number | null;
}

export interface RtStats {
  frame: number;
  rtWidth: number;
  rtHeight: number;
  divisor: number;
  giRays: number;
  specular: boolean;
  debugView: number;
  staticPrims: number;
  dynamicPrims: number;
  bvhNodes: number;
  bvhBytes: number;
  staticRebuilds: number;
  probeCount: number;
  probeRaysPerFrame: number;
  probeStride: number;
  probeBytes: number;
  textureBytes: number;
  options: RtOptions;
}

export interface RtAux { rtDepth: GPUTextureView; rtNormal: GPUTextureView }

export interface RTModule extends RenderModule {
  /** Linear depth (r32float, metres, 0 = sky) and octahedral normal / roughness / metalness (rgba16float) of the pixel each RT texel traced this frame. */
  getAux(): RtAux | null;
  stats(): RtStats;
  setDebugView(mode: number): void;
  setOptions(o: Partial<RtOptions>): void;
  /** Runs the GPU tracers against the CPU references on random rays (needs a rendered frame first). */
  selfTest(): Promise<RtSelfTest>;
}

const SELF_TEST_STEPS = 256;
const SPEC_CLEAR = { r: 0, g: 0, b: 0, a: 0 };

function hashFrame(i: number): number {
  let h = (i + 0x9e3779b9) >>> 0;
  h = Math.imul(h ^ (h >>> 16), 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
  return (h ^ (h >>> 16)) >>> 0;
}

/**
 * Compute-shader ray tracer (WebGPU has no hardware ray tracing): a hierarchical heightfield tracer over the terrain max pyramid plus a BVH of
 * analytic proxy primitives feed a soft key-light shadow, one-bounce diffuse GI, GGX specular and an SH-L1 radiance probe grid. Each signal is
 * accumulated over time and filtered with a-trous passes into the G-buffer's own targets.
 */
class RtModule implements RTModule {
  readonly name = 'rt';
  private rc!: RenderContext;
  private layouts!: RtLayouts;
  private pipes!: RtPipelines;
  private buffers!: SceneBuffers;
  private probes!: ProbeGrid;
  private paramBuffer!: GPUBuffer;
  private prevPre!: GPUBuffer;
  private probeSampler!: GPUSampler;
  private clearSky!: GPUTexture;
  private cloudTexture: GPUTexture | null = null;
  private cloudView: GPUTextureView | null = null;
  private tex: RtTextures | null = null;
  private groups: RtGroups | null = null;
  private groupsGeneration = -1;
  private bound: GBuffer | null = null;
  private terrain: TerrainSampler | null = null;
  private testPipeline: GPUComputePipeline | null = null;
  private readonly block = new RtParamBlock();
  private readonly options: RtOptions = { softness: 1, rayRange: 300, probeHysteresis: 0.92, probeRayBudget: null };
  private readonly params: RtParamInput = {
    rtWidth: 0, rtHeight: 0, fullWidth: 0, fullHeight: 0, divisor: 1, maxSteps: 0, giRays: 0, spec: false, terrain: false,
    staticRoot: 0, dynamicRoot: 0, visitCap: 0, frameIndex: 0, debugView: 0, seed: 0,
    probeStride: 1, probePhase: 0, probeLo: [0, 0, 0], probeRays: 0, probePrevLo: [0, 0, 0], probeAllFresh: true, probeDim: [1, 1, 1],
    softness: 1, probeSpacing: 1, probeHysteresis: 0.92, rayRange: 300, cloudCenterX: 0, cloudCenterZ: 0, cloudExtentM: 1,
  };
  private parity = 0;
  private lastFrame: number | null = null;
  private seed = 0;
  private debugView = 0;
  private specWasOn = false;
  private pass: GPUComputePassEncoder | null = null;
  private wx = 0;
  private wy = 0;

  async init(rc: RenderContext): Promise<void> {
    this.rc = rc;
    const d = rc.device;
    this.layouts = createLayouts(d);
    [this.pipes, this.buffers] = await Promise.all([createPipelines(rc, this.layouts), new SceneBuffers(d)]);
    this.probes = new ProbeGrid(d, rc.quality.probes, this.probeLimits(rc.quality));
    this.paramBuffer = d.createBuffer({ label: 'rt params', size: RT_PARAM_BYTES, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
    this.prevPre = d.createBuffer({ label: 'rt prev pre-exposure', size: 16, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST });
    this.probeSampler = d.createSampler({ label: 'rt probe', magFilter: 'linear', minFilter: 'linear', addressModeU: 'repeat', addressModeV: 'repeat', addressModeW: 'repeat' });
    this.clearSky = d.createTexture({ label: 'rt no cloud shadow', format: 'rgba16float', size: [1, 1], usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST });
    d.queue.writeTexture({ texture: this.clearSky }, new Uint16Array([0x3c00, 0x3c00, 0x3c00, 0x3c00]), { bytesPerRow: 8 }, [1, 1]);
    this.allocate(rc);
  }

  resize(rc: RenderContext): void {
    this.allocate(rc);
  }

  setScene(_rc: RenderContext, scene: SceneData): void {
    this.terrain = scene.sampler;
    this.probes.reset();
  }

  getAux(): RtAux | null {
    if (!this.tex) return null;
    return { rtDepth: this.tex.auxDepth[this.parity].view, rtNormal: this.tex.auxNormal[this.parity].view };
  }

  setDebugView(mode: number): void {
    this.debugView = Math.min(RT_DEBUG_VIEWS, Math.max(0, Math.round(mode)));
  }

  setOptions(o: Partial<RtOptions>): void {
    Object.assign(this.options, o);
  }

  stats(): RtStats {
    const b = this.buffers?.stats();
    const g = this.rc?.gbuf;
    return {
      frame: this.lastFrame ?? -1, rtWidth: g?.rtWidth ?? 0, rtHeight: g?.rtHeight ?? 0, divisor: this.rc?.quality.rtDivisor ?? 0,
      giRays: this.rc?.quality.giRays ?? 0, specular: this.rc?.quality.rtSpecular ?? false, debugView: this.debugView,
      staticPrims: b?.staticPrims ?? 0, dynamicPrims: b?.dynamicPrims ?? 0, bvhNodes: b?.nodes ?? 0, bvhBytes: b?.bufferBytes ?? 0,
      staticRebuilds: b?.staticRebuilds ?? 0, probeCount: this.probes?.total ?? 0, probeRaysPerFrame: this.probes?.raysPerFrame ?? 0,
      probeStride: this.probes?.stride ?? 0, probeBytes: this.probes?.bytes ?? 0, textureBytes: this.tex?.bytes ?? 0, options: { ...this.options },
    };
  }

  async selfTest(): Promise<RtSelfTest> {
    const rc = this.rc;
    this.testPipeline ??= await createTestPipeline(rc, this.layouts);
    return runSelfTest(rc, this.layouts, this.testPipeline, this.buffers, this.terrain, SELF_TEST_STEPS);
  }

  private probeLimits(q: RenderContext['quality']): ProbeLimits {
    const own = probeLimits(q);
    return this.options.probeRayBudget === null ? own : { rayBudget: this.options.probeRayBudget, maxStride: own.maxStride };
  }

  private allocate(rc: RenderContext): void {
    this.tex?.destroy();
    this.tex = new RtTextures(rc.device, rc.gbuf.rtWidth, rc.gbuf.rtHeight);
    if (rc.quality.rtSpecular) this.tex.ensureSpec();
    this.bound = rc.gbuf;
    this.groups = null;
  }

  private prepare(rc: RenderContext): RtGroups {
    if (!this.tex || this.bound !== rc.gbuf) this.allocate(rc);
    const tex = this.tex!;
    const limits = this.probeLimits(rc.quality);
    if (!this.probes.matches(rc.quality.probes, limits)) {
      this.probes.destroy();
      this.probes = new ProbeGrid(rc.device, rc.quality.probes, limits);
      this.groups = null;
    }
    if (rc.quality.rtSpecular && !tex.spec) {
      tex.ensureSpec();
      this.groups = null;
    }
    const cloud = atmosphereOf(rc.device)?.getCloudShadowTexture() ?? this.clearSky;
    if (cloud !== this.cloudTexture) {
      this.cloudTexture = cloud;
      this.cloudView = cloud.createView();
      this.groups = null;
    }
    this.buffers.sync(rc.rt);
    if (this.groups && this.groupsGeneration !== this.buffers.generation) this.groups = null;
    if (!this.groups) {
      this.groupsGeneration = this.buffers.generation;
      this.groups = buildGroups({
        rc, layouts: this.layouts, tex, probes: this.probes, buffers: this.buffers, params: this.paramBuffer, prevPre: this.prevPre, probeSampler: this.probeSampler, cloud: this.cloudView!,
      });
    }
    return this.groups;
  }

  encodeRT(enc: GPUCommandEncoder, rc: RenderContext, f: FrameInfo): void {
    const groups = this.prepare(rc);
    if (f.frameIndex !== this.lastFrame) this.advance(f);
    this.writeParams(rc, f);
    const q = rc.quality;
    if (!q.rtSpecular && this.specWasOn) {
      enc.beginRenderPass({ label: 'rt clear specular', colorAttachments: [{ view: rc.gbuf.views.giSpecular, loadOp: 'clear', storeOp: 'store', clearValue: SPEC_CLEAR }] }).end();
    }
    this.specWasOn = q.rtSpecular;

    const par = this.parity;
    this.wx = Math.ceil(rc.gbuf.rtWidth / 8);
    this.wy = Math.ceil(rc.gbuf.rtHeight / 8);
    const compact = this.probes.useCompact;
    // Encode the reset every time, including capture() re-encodes of the same frame index.
    if (compact) enc.clearBuffer(this.probes.work!.args, 0, 4);
    const profiler = rc.profiler?.active ? rc.profiler : undefined;
    let pass = this.pass = enc.beginComputePass(profiler ? profiler.computePass('rt auxiliary', 'rtAux') : { label: 'rt' });
    pass.setBindGroup(0, rc.frame.group);
    this.local(this.pipes.aux, groups.aux[par]);
    if (profiler) pass = this.nextProfilePass(enc, profiler, 'probes');
    const dim = this.probes.dim;
    if (compact) {
      pass.setPipeline(this.pipes.probePlan);
      pass.setBindGroup(1, groups.probePlan![par]);
      pass.dispatchWorkgroups(Math.ceil(dim[0] / 4), Math.ceil(dim[1] / 4), Math.ceil(dim[2] / 4));
      pass.setPipeline(this.pipes.probeCompact);
      pass.setBindGroup(1, rc.world.group);
      pass.setBindGroup(2, groups.probeCompact![par]);
      pass.dispatchWorkgroupsIndirect(this.probes.work!.args, 0);
    } else {
      this.traced(this.pipes.probe, groups.probe[par], dim[0], dim[1], dim[2]);
    }
    this.probes.commit();
    this.signal('shadow', groups, par, enc, profiler);
    this.signal('gi', groups, par, enc, profiler);
    if (q.rtSpecular) this.signal('spec', groups, par, enc, profiler);
    if (profiler) pass = this.nextProfilePass(enc, profiler, 'rtLatch');
    // The latch writes one scalar, not one value per RT texel.
    pass.setPipeline(this.pipes.latch);
    pass.setBindGroup(1, groups.latch);
    pass.dispatchWorkgroups(1);
    pass.end();
    this.pass = null;
  }

  private local(pipeline: GPUComputePipeline, group: GPUBindGroup): void {
    const pass = this.pass!;
    pass.setPipeline(pipeline);
    pass.setBindGroup(1, group);
    pass.dispatchWorkgroups(this.wx, this.wy);
  }

  private traced(pipeline: GPUComputePipeline, group: GPUBindGroup, x: number, y: number, z: number): void {
    const pass = this.pass!;
    pass.setPipeline(pipeline);
    pass.setBindGroup(1, this.rc.world.group);
    pass.setBindGroup(2, group);
    pass.dispatchWorkgroups(x, y, z);
  }

  private nextProfilePass(enc: GPUCommandEncoder, profiler: GpuProfiler, section: DetailName): GPUComputePassEncoder {
    this.pass!.end();
    const pass = this.pass = enc.beginComputePass(profiler.computePass(`rt ${section}`, section));
    pass.setBindGroup(0, this.rc.frame.group);
    return pass;
  }

  private signal(sig: Signal, groups: RtGroups, par: number, enc: GPUCommandEncoder, profiler?: GpuProfiler): void {
    const name = sig === 'spec' ? 'specular' : sig;
    if (profiler) this.nextProfilePass(enc, profiler, `${name}Rays`);
    this.traced(this.pipes.trace[sig], groups.trace[sig]![par], this.wx, this.wy, 1);
    if (profiler) this.nextProfilePass(enc, profiler, `${name}Denoise`);
    this.local(this.pipes.temporal[sig], groups.temporal[sig]![par]);
    for (let i = 0; i < ATROUS_ITERATIONS; i++) this.local(this.pipes.atrous[sig][i], groups.atrous[sig]![par][i]);
  }

  /** Once per frame index: capture() re-encodes the same frame and must see the same history, probe window and noise. */
  private advance(f: FrameInfo): void {
    this.lastFrame = f.frameIndex;
    this.parity ^= 1;
    this.seed = hashFrame(f.frameIndex);
    const [x, , z] = f.camera.pos;
    this.probes.plan(x, z, this.terrain ? this.terrain.heightAt(x, z) : 0);
  }

  private writeParams(rc: RenderContext, f: FrameInfo): void {
    const p = this.params, g = rc.gbuf, q = rc.quality, pr = this.probes, o = this.options;
    p.rtWidth = g.rtWidth; p.rtHeight = g.rtHeight; p.fullWidth = g.width; p.fullHeight = g.height;
    p.divisor = q.rtDivisor; p.maxSteps = q.rtMaxSteps; p.giRays = q.giRays; p.spec = q.rtSpecular; p.terrain = this.terrain !== null;
    p.staticRoot = this.buffers.staticRoot; p.dynamicRoot = this.buffers.dynamicRoot; p.visitCap = q.rtMaxSteps * 2;
    p.frameIndex = f.frameIndex; p.debugView = this.debugView; p.seed = this.seed;
    p.probeStride = pr.stride; p.probePhase = f.frameIndex % pr.stride; p.probeRays = pr.raysPerProbe; p.probeAllFresh = pr.allFresh;
    p.probeLo = pr.lo; p.probePrevLo = pr.prevLo; p.probeDim = pr.dim;
    p.softness = o.softness; p.probeSpacing = pr.spacing; p.probeHysteresis = o.probeHysteresis; p.rayRange = o.rayRange;
    const cm = this.cloudTexture === this.clearSky ? null : atmosphereOf(rc.device)?.getCloudShadowMapping();
    p.cloudCenterX = cm?.centerX ?? 0; p.cloudCenterZ = cm?.centerZ ?? 0; p.cloudExtentM = cm?.extentM ?? 1;
    this.block.write(p);
    rc.device.queue.writeBuffer(this.paramBuffer, 0, this.block.buffer);
  }

  destroy(): void {
    this.tex?.destroy();
    this.probes?.destroy();
    this.buffers?.destroy();
    this.paramBuffer?.destroy();
    this.prevPre?.destroy();
    this.clearSky?.destroy();
    this.tex = null;
    this.groups = null;
  }
}

export function createRTModule(): RTModule {
  return new RtModule();
}

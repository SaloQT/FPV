import type { AstroState, CameraState, QuadState, Settings } from '../contracts';
import type { FrameInfo, PostProcessor, RenderContext, RenderModule, SceneData } from './contracts';
import { recordError, requestDevice, type AdapterDetails, type DeviceSetup } from './deviceSetup';
import { DynamicResolutionController, resolveTargetFps } from './dynamicRes';
import { ExposureController } from './exposure';
import { FrameGraph } from './frameGraph';
import {
  FRAME_UNIFORM_BYTES, FrameUniforms, QUALITY_FLAG_BLOOM, QUALITY_FLAG_RT_SPECULAR, QUALITY_FLAG_TAA,
  type FrameUniformInput, type TerrainUniformInfo,
} from './frameUniforms';
import { createGBuffer, destroyGBuffer, renderSize } from './gbuffer';
import { GpuTimer, PASS_NAMES, type GpuTimingListener } from './gpuTimer';
import { DeferredLighting } from './lighting';
import { ModuleHost } from './moduleHost';
import { createDefaultModules } from './modules';
import { createPostProcessor } from './post';
import { resolveQuality, sameProfile } from './qualityPresets';
import { SceneRegistry } from './rtRegistry';
import { resolveShader, type Defines } from './shaderLib';
import { WorldResources } from './worldBindings';

export interface RendererOptions { gpuProfile?: boolean }

export interface RenderStats {
  frameIndex: number;
  /** CPU time spent inside render(), ms. */
  cpuMs: number;
  /** GPU frame time from timestamp queries (2-3 frames old), null without the feature. */
  gpuMs: number | null;
  fps: number;
  renderWidth: number;
  renderHeight: number;
  outWidth: number;
  outHeight: number;
  dynamicScale: number;
  preExposure: number;
  /** GPU time of the encodeRT section, null without timestamps or without an RT module. */
  rtMs: number | null;
  adapter: string;
  /** GPU milliseconds per frame section, in `PASS_NAMES` order; NaN without timestamp queries. */
  passMs: number[];
  /** Display refresh rate measured at startup (0 until `setDisplayRefresh` was called). */
  displayHz: number;
  displaySource: 'measured' | 'fallback' | 'override' | 'unknown';
  /** The frame rate dynamic resolution aims at: the setting, or the display refresh for 0, never above the frame cap. */
  targetFps: number;
  frameCap: number;
  /** What the dynamic-resolution controller decides on: GPU timestamps, frame times, or nothing when it is off. */
  dynamicDriver: 'gpu' | 'frame-time' | 'off';
  /** Every GPU, shader and module error so far (`errors` keeps only the first 20). */
  errorCount: number;
}

export interface FrameInput {
  dt: number;
  time: number;
  camera: CameraState;
  astro: AstroState;
  quad: QuadState | null;
}

const FPS_SMOOTHING = 0.1;
const MIN_RENDER_SCALE = 0.25;

/** Owns the device, the swapchain, the shared resources and the frame graph; feature modules plug in through RenderModule hooks. */
export class Renderer {
  readonly rt = new SceneRegistry();
  readonly stats: RenderStats;
  readonly device: GPUDevice;
  /** First 20 GPU/shader/module errors (also console.error'd). */
  readonly errors: string[] = [];
  /** Set when the device was lost for a reason other than destroy(). */
  lost: string | null = null;
  /** Called once when the device is lost; the app offers to re-create the renderer. */
  onLost: ((reason: string, message: string) => void) | null = null;
  readonly adapter: AdapterDetails;

  private readonly rc: RenderContext;
  private readonly world: WorldResources;
  private readonly context: GPUCanvasContext;
  private readonly frameUniforms = new FrameUniforms();
  private readonly exposure = new ExposureController();
  private readonly dyn = new DynamicResolutionController();
  private readonly graph = new FrameGraph();
  private readonly timer: GpuTimer;
  private readonly host: ModuleHost;
  private readonly info = {} as FrameInfo;
  private readonly uniformIn = {} as FrameUniformInput;
  private readonly postParams = { outWidth: 0, outHeight: 0, preExposure: 1, prevPreExposure: 1 };
  private readonly reported = new Set<string>();
  private lighting!: DeferredLighting;
  private terrainInfo: TerrainUniformInfo | null = null;
  private last: FrameInput | null = null;
  private outW: number;
  private outH: number;
  private frameIndex = -1;
  private lastStart = 0;
  private destroyed = false;
  private errorCount = 0;

  static async create(canvas: HTMLCanvasElement, settings: Settings, modules?: RenderModule[], post?: PostProcessor, options: RendererOptions = {}): Promise<Renderer> {
    const setup = await requestDevice();
    const r = new Renderer(canvas, settings, setup, modules ?? createDefaultModules(), post ?? createPostProcessor(), options);
    try {
      await r.init();
    } catch (e) {
      r.destroy();
      throw e;
    }
    return r;
  }

  private constructor(private readonly canvas: HTMLCanvasElement, settings: Settings, setup: DeviceSetup, modules: RenderModule[], private readonly post: PostProcessor, readonly options: Readonly<RendererOptions>) {
    const device = setup.device;
    this.device = device;
    this.adapter = setup.adapter;
    device.onuncapturederror = (e) => this.report(`WebGPU uncaptured error: ${e.error.message}`);
    void device.lost.then((l) => {
      if (l.reason === 'destroyed') return;
      this.lost = `${l.reason}: ${l.message}`;
      this.timer.destroy();
      this.report(`WebGPU device lost (${this.lost})`);
      this.onLost?.(l.reason, l.message);
    });
    const context = canvas.getContext('webgpu');
    if (!context) throw new Error('Could not create a WebGPU canvas context.');
    this.context = context;
    const canvasFormat = navigator.gpu.getPreferredCanvasFormat();
    context.configure({ device, format: canvasFormat, usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.COPY_SRC, alphaMode: 'opaque' });

    this.outW = Math.max(1, canvas.width);
    this.outH = Math.max(1, canvas.height);
    this.world = new WorldResources(device);
    this.timer = new GpuTimer(device, setup.features.has('timestamp-query'), options.gpuProfile);
    this.host = new ModuleHost(modules, (m) => this.report(m));
    const quality = resolveQuality(settings);
    const size = renderSize(this.outW, this.outH, this.clampScale(settings.renderScale), 1);
    const frameBuffer = device.createBuffer({ label: 'frame uniforms', size: FRAME_UNIFORM_BYTES, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
    const stages = GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT | GPUShaderStage.COMPUTE;
    const frameLayout = device.createBindGroupLayout({ label: 'frame', entries: [{ binding: 0, visibility: stages, buffer: { type: 'uniform' } }] });
    this.rc = {
      ...(this.timer.detailed ? { profiler: this.timer } : {}),
      device,
      canvasFormat,
      features: setup.features,
      frame: { layout: frameLayout, buffer: frameBuffer, group: device.createBindGroup({ label: 'frame', layout: frameLayout, entries: [{ binding: 0, resource: { buffer: frameBuffer } }] }) },
      world: this.world,
      gbuf: createGBuffer(device, size.width, size.height, quality.rtDivisor),
      rt: this.rt,
      quality,
      settings,
      shader: (path, defines) => resolveShader(path, defines),
      module: (path, defines) => this.createModule(path, defines),
    };
    this.graph.bind(this.rc.gbuf);
    this.stats = {
      frameIndex: 0, cpuMs: 0, gpuMs: null, fps: 0, renderWidth: size.width, renderHeight: size.height, outWidth: this.outW, outHeight: this.outH,
      dynamicScale: 1, preExposure: 1, rtMs: null, adapter: setup.adapterName, passMs: PASS_NAMES.map(() => NaN), displayHz: 0, displaySource: 'unknown',
      targetFps: resolveTargetFps(settings.targetFps, 0, settings.frameCap), frameCap: settings.frameCap, dynamicDriver: 'off', errorCount: 0,
    };
  }

  /** Current total, including errors surfaced asynchronously since the last rendered frame. */
  get totalErrorCount(): number { return this.errorCount; }

  get gpuProfiling() {
    return { requested: this.options.gpuProfile === true, supported: this.rc.features.has('timestamp-query'), mode: this.timer.detailed ? 'detailed' as const : this.rc.features.has('timestamp-query') ? 'coarse' as const : 'unsupported' as const };
  }

  /** Stops admission of future submissions; in-flight callbacks remain deliverable until drainGpuTimings() settles. */
  listenGpuTimings(listener: GpuTimingListener): () => void { return this.timer.listen(listener); }
  drainGpuTimings(timeoutMs = 5000): Promise<boolean> { return this.timer.drain(timeoutMs); }
  get qualityProfile() { return this.rc.quality; }

  private async init(): Promise<void> {
    await this.host.init(this.rc);
    await this.post.init(this.rc);
    this.post.resize(this.rc, { width: this.outW, height: this.outH });
    this.lighting = new DeferredLighting(this.rc, !this.host.drawsSky);
  }

  setScene(scene: SceneData): void {
    const t = scene.terrain;
    this.world.uploadTerrain(t);
    this.terrainInfo = { resolution: t.resolution, cellSize: t.cellSize, minHeight: t.minHeight, maxHeight: t.maxHeight, origin: t.origin };
    this.frameUniforms.resetHistory();
    this.host.setScene(this.rc, scene);
  }

  /** Quality tier or preset, render scale, dynamic resolution, target fps and frame cap can all change at runtime. */
  setSettings(s: Settings): void {
    const prev = this.rc.settings;
    const profile = resolveQuality(s);
    const profileChanged = !sameProfile(profile, this.rc.quality);
    this.rc.settings = s;
    if (profileChanged) this.rc.quality = profile;
    if (profileChanged || s.targetFps !== prev.targetFps || s.frameCap !== prev.frameCap || s.dynamicResolution !== prev.dynamicResolution) this.dyn.reset();
    this.retarget(profileChanged);
  }

  /** The display refresh rate measured at startup (Hz). It is the default frame-rate target and what the dynamic-resolution controller trusts. */
  setDisplayRefresh(hz: number, source: RenderStats['displaySource'] = 'unknown'): void {
    this.stats.displayHz = hz;
    this.stats.displaySource = source;
    this.dyn.setMeasuredRefreshHz(hz);
    this.dyn.reset();
  }

  /** Test hook: reports the device as lost exactly the way a driver reset would, without actually losing it. */
  simulateLoss(message: string): void {
    if (this.lost || this.destroyed) return;
    this.lost = `unknown: ${message}`;
    this.timer.destroy();
    this.report(`WebGPU device lost (${this.lost})`);
    this.onLost?.('unknown', message);
  }

  /** Best known display refresh period in ms (0 when nothing was measured or observed yet). */
  get displayPeriodMs(): number {
    return this.dyn.displayPeriodMs;
  }

  resize(cssWidth: number, cssHeight: number, dpr: number): void {
    const max = this.device.limits.maxTextureDimension2D;
    const w = Math.min(max, Math.max(1, Math.round(cssWidth * dpr)));
    const h = Math.min(max, Math.max(1, Math.round(cssHeight * dpr)));
    if (w !== this.canvas.width) this.canvas.width = w;
    if (h !== this.canvas.height) this.canvas.height = h;
    this.outW = w;
    this.outH = h;
    this.retarget(true);
  }

  /** One full frame. Never throws: a failure is logged once and the frame is skipped. */
  render(f: FrameInput): void {
    if (this.destroyed || this.lost) return;
    const t0 = performance.now();
    const frameMs = this.lastStart > 0 ? t0 - this.lastStart : 0;
    this.lastStart = t0;
    this.last = f;
    try {
      this.encodeFrame(f, frameMs, null);
    } catch (e) {
      this.timer.abortFrame();
      this.reportOnce('render', e);
    }
    this.stats.cpuMs = performance.now() - t0;
  }

  /**
   * Reads back the last presented (post-processed) image. The swapchain texture is not readable after present, so this re-encodes the
   * last FrameInput (same frame index, no exposure/dynamic-resolution/fps update) and copies the result; the FrameInput's objects are
   * read again, so do not mutate them between render() and capture().
   */
  async capture(): Promise<{ width: number; height: number; rgba: Uint8Array }> {
    if (!this.last) throw new Error('capture() called before the first render().');
    const width = this.outW, height = this.outH;
    const bytesPerRow = Math.ceil((width * 4) / 256) * 256;
    const buffer = this.device.createBuffer({ label: 'capture', size: bytesPerRow * height, usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ });
    try {
      this.encodeFrame(this.last, 0, { buffer, bytesPerRow });
      await buffer.mapAsync(GPUMapMode.READ);
      const src = new Uint8Array(buffer.getMappedRange());
      const rgba = new Uint8Array(width * height * 4);
      const swap = this.rc.canvasFormat.startsWith('bgra');
      for (let y = 0; y < height; y++) {
        let s = y * bytesPerRow, d = y * width * 4;
        for (let x = 0; x < width; x++, s += 4, d += 4) {
          rgba[d] = src[s + (swap ? 2 : 0)];
          rgba[d + 1] = src[s + 1];
          rgba[d + 2] = src[s + (swap ? 0 : 2)];
          rgba[d + 3] = 255;
        }
      }
      buffer.unmap();
      return { width, height, rgba };
    } finally {
      this.timer.abortFrame();
      buffer.destroy();
    }
  }

  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    this.host.destroy();
    this.post.destroy?.();
    this.timer.destroy();
    destroyGBuffer(this.rc.gbuf);
    this.world.destroy();
    this.rc.frame.buffer.destroy();
    this.context.unconfigure();
    this.device.destroy();
  }

  private encodeFrame(f: FrameInput, frameMs: number, readback: { buffer: GPUBuffer; bytesPerRow: number } | null): void {
    const rc = this.rc, s = rc.settings;
    if (!readback) {
      this.frameIndex++;
      this.exposure.update(f.dt, f.astro, f.camera.pos[1] + s.observer.altitudeM);
      this.dyn.update(this.timer.gpuMs, frameMs, resolveTargetFps(s.targetFps, this.stats.displayHz, s.frameCap), s.dynamicResolution);
      this.retarget(false);
      this.updateStats(frameMs);
    }
    const g = rc.gbuf, q = rc.quality;
    const info = this.info;
    info.frameIndex = this.frameIndex; info.dt = f.dt; info.time = f.time; info.camera = f.camera; info.astro = f.astro; info.quad = f.quad;
    info.width = g.width; info.height = g.height;
    const u = this.uniformIn;
    u.camera = f.camera; u.astro = f.astro; u.dt = f.dt; u.time = f.time; u.frameIndex = this.frameIndex; u.width = g.width; u.height = g.height;
    u.preExposure = this.exposure.preExposure; u.observerAltitudeM = s.observer.altitudeM; u.jitter = q.taa; u.terrain = this.terrainInfo;
    u.qualityFlags = (q.rtSpecular ? QUALITY_FLAG_RT_SPECULAR : 0) | (q.bloom ? QUALITY_FLAG_BLOOM : 0) | (q.taa ? QUALITY_FLAG_TAA : 0);
    this.frameUniforms.write(u);
    this.device.queue.writeBuffer(rc.frame.buffer, 0, this.frameUniforms.buffer);
    this.host.update(rc, info);
    this.post.update?.(rc, info);

    this.timer.beginFrame(this.frameIndex, readback !== null);
    const enc = this.device.createCommandEncoder({ label: 'frame' });
    const target = this.context.getCurrentTexture();
    const p = this.postParams;
    p.outWidth = this.outW; p.outHeight = this.outH; p.preExposure = this.exposure.preExposure; p.prevPreExposure = this.exposure.prevPreExposure;
    this.graph.encode(enc, rc, this.host, this.lighting, this.post, this.timer, info, target.createView(), p);
    if (readback) enc.copyTextureToBuffer({ texture: target }, { buffer: readback.buffer, bytesPerRow: readback.bytesPerRow }, [this.outW, this.outH]);
    this.timer.resolve(enc);
    this.device.queue.submit([enc.finish()]);
    this.timer.afterSubmit();
  }

  /** Reallocate the G-buffer when the render size or RT divisor changed; `notify` also tells modules/post/lighting (quality or output change). */
  private retarget(notify: boolean): void {
    const rc = this.rc, g = rc.gbuf;
    const size = renderSize(this.outW, this.outH, this.clampScale(rc.settings.renderScale), this.dyn.scale);
    const rtChanged = g.rtWidth !== Math.ceil(size.width / rc.quality.rtDivisor);
    const resized = size.width !== g.width || size.height !== g.height || rtChanged;
    if (!resized && !notify) return;
    if (resized) {
      rc.gbuf = createGBuffer(this.device, size.width, size.height, rc.quality.rtDivisor);
      destroyGBuffer(g);
      this.graph.bind(rc.gbuf);
    }
    this.host.resize(rc);
    this.lighting.rebuild();
    this.post.resize(rc, { width: this.outW, height: this.outH });
  }

  private updateStats(frameMs: number): void {
    const st = this.stats, g = this.rc.gbuf;
    if (frameMs > 0) st.fps = st.fps === 0 ? 1000 / frameMs : st.fps + (1000 / frameMs - st.fps) * FPS_SMOOTHING;
    st.frameIndex = this.frameIndex;
    st.gpuMs = this.timer.gpuMs;
    st.rtMs = this.host.tracesRays ? this.timer.rtMs : null;
    st.renderWidth = g.width; st.renderHeight = g.height;
    st.outWidth = this.outW; st.outHeight = this.outH;
    st.dynamicScale = this.dyn.scale;
    st.preExposure = this.exposure.preExposure;
    const s = this.rc.settings;
    st.targetFps = resolveTargetFps(s.targetFps, st.displayHz, s.frameCap);
    st.frameCap = s.frameCap;
    st.dynamicDriver = !s.dynamicResolution ? 'off' : this.dyn.gpuDriven ? 'gpu' : 'frame-time';
    st.errorCount = this.errorCount;
    for (let i = 0; i < st.passMs.length; i++) st.passMs[i] = this.timer.passMs[i];
  }

  private clampScale(scale: number): number {
    return Math.min(1, Math.max(MIN_RENDER_SCALE, scale));
  }

  private createModule(path: string, defines?: Defines): GPUShaderModule {
    const code = resolveShader(path, defines);
    const module = this.device.createShaderModule({ label: path, code });
    void module.getCompilationInfo().then((info) => {
      const lines = code.split('\n');
      for (const m of info.messages) {
        const text = `WGSL ${path}:${m.lineNum}:${m.linePos} ${m.message}\n    ${lines[m.lineNum - 1] ?? ''}`;
        if (m.type === 'error') this.report(text);
        else if (m.type === 'warning') console.warn(text);
      }
    });
    return module;
  }

  private reportOnce(key: string, e: unknown): void {
    if (this.reported.has(key)) return;
    this.reported.add(key);
    this.report(`renderer ${key} failed: ${e instanceof Error ? (e.stack ?? e.message) : String(e)}`);
  }

  private report(message: string): void {
    this.errorCount++;
    recordError(this.errors, message);
  }
}

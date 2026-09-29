import { DEFAULT_SETTINGS, type CameraState, type Settings } from '../contracts';
import type { PostProcessorDev } from '../render/post';
import { createPostProcessor } from '../render/post';
import { Renderer, type FrameInput } from '../render/renderer';
import { eulerQuat } from './objects/camera';
import { probeGBuffer } from './objects/probe';
import { makeAstro } from './render/astro';
import { drawOsd, probeImage } from './render/osd';
import { createChecks, type StepOptions } from './post/checks';
import { LOOKS, readParams, sunDirFor, type SceneState } from './post/params';
import { createPostScene } from './post/scene';

const DEG = Math.PI / 180;
const CAMERA_POS = [0.8, 1.5, -1] as const;
const SWAY_DEG = 12;
const SWAY_RATE = 7;

/**
 * Post-processing dev page: an analytic HDR scene (checker ground, gates, lamps, resolution panel, spinning cube, sun) through the real post chain.
 * Query: view=scene|sun|grid  exposure=day|night  lens=0..1  noise=0..1  taa=0|1  motion=1 (camera sway + moving cube)  debug=0..3
 * (1 raw hdr, 2 exposure heat, 3 bloom only)  quality=low|medium|high|ultra  scale=<render scale>  frames=<N>  dt=<s>  fov=<deg>  osd=1
 * Numeric checks: window.__fpv.checks.{exposure,pop,finite,grid}(); use --size 480x270 on SwiftShader.
 */
export default async function run(canvas: HTMLCanvasElement, osdCanvas: HTMLCanvasElement): Promise<void> {
  const params = readParams(location.search);
  const look = LOOKS[params.look];
  const settings: Settings = {
    ...DEFAULT_SETTINGS,
    quality: params.quality,
    dynamicResolution: false,
    renderScale: params.scale,
    lensDistortion: params.lens,
    videoNoise: params.noise,
    fov: params.fov,
    observer: { latitudeDeg: 46, longitudeDeg: 8, altitudeM: 300 },
  };
  const state: SceneState = {
    radiance: look.radiance,
    premul: 1,
    prevPremul: 1,
    grid: params.view === 'grid',
    sunDir: sunDirFor(params.view),
    sunNits: look.sunNits,
    lampNits: look.lampNits,
    motion: params.motion,
  };

  const inner = createPostProcessor();
  const post = withPremul(inner, state);
  const renderer = await Renderer.create(canvas, settings, [createPostScene(state)], post);
  post.setDebug(params.debug);
  if (!params.taa) renderer['rc'].quality = { ...renderer['rc'].quality, taa: false };

  const camera: CameraState = { pos: [...CAMERA_POS], quat: [0, 0, 0, 1], fovY: params.fov * DEG, aspect: 16 / 9, near: 0.05, far: 1e5 };
  const input: FrameInput = { dt: params.dt, time: 0, camera, astro: makeAstro(look.time), quad: null };
  const osd = params.osd ? osdCanvas.getContext('2d') : null;
  const pitch = params.view === 'sun' ? 8 : 0;

  let wantedPremul = 1;
  const renderOne = (dt: number): void => {
    input.time += dt;
    input.dt = dt;
    camera.quat = eulerQuat(state.motion ? SWAY_DEG * Math.sin(SWAY_RATE * input.time) : 0, pitch, 0);
    state.prevPremul = state.premul;
    state.premul = wantedPremul;
    post.getStats();
    renderer.render(input);
  };
  const gpuIdle = (): Promise<undefined> => renderer.device.queue.onSubmittedWorkDone();

  /** Renders n frames, each waited for; `premul` stays in force until changed, `dt` defaults to the page's. */
  const step = async (n: number, o: StepOptions = {}): Promise<void> => {
    if (o.premul !== undefined) wantedPremul = o.premul;
    for (let i = 0; i < n; i++) {
      renderOne(o.dt ?? params.dt);
      await gpuIdle();
    }
    await new Promise<void>((r) => setTimeout(r, 0));
  };

  const label = `${params.look} ${params.view}`;
  const publish = (): void => {
    window.__fpv = {
      ready: true,
      stats: renderer.stats,
      errors: renderer.errors,
      probe: () => probeImage(renderer),
      gbuffer: () => probeGBuffer(renderer),
      step,
      exposureEv: () => post.getStats().exposureEv,
      checks: createChecks({ renderer, post, state, settings, step }),
      info: { look: params.look, view: params.view, sunDir: state.sunDir },
    };
  };
  const resize = (): void => {
    const w = Math.max(1, canvas.clientWidth), h = Math.max(1, canvas.clientHeight);
    renderer.resize(w, h, window.devicePixelRatio || 1);
    osdCanvas.width = w;
    osdCanvas.height = h;
    camera.aspect = w / h;
  };
  resize();
  window.addEventListener('resize', resize);

  let frame = 0;
  const tick = async (): Promise<void> => {
    renderOne(params.dt);
    await gpuIdle();
    frame++;
    if (osd) drawOsd(osd, osdCanvas, renderer.stats, `${label} ev ${post.getStats().exposureEv?.toFixed(2) ?? 'n/a'}`);
    if (frame < params.frames && !renderer.lost) requestAnimationFrame(() => void tick());
    else publish();
  };
  requestAnimationFrame(() => void tick());
}

/** Applies the dev pre-exposure multiplier on top of what the renderer's CPU controller reports, as if the controller had jumped. */
function withPremul(inner: PostProcessorDev, state: SceneState): PostProcessorDev {
  const scaled = { outWidth: 0, outHeight: 0, preExposure: 0, prevPreExposure: 0 };
  return {
    ...inner,
    encode(enc, rc, f, target, o) {
      scaled.outWidth = o.outWidth;
      scaled.outHeight = o.outHeight;
      scaled.preExposure = o.preExposure * state.premul;
      scaled.prevPreExposure = o.prevPreExposure * state.prevPremul;
      inner.encode(enc, rc, f, target, scaled);
    },
  };
}

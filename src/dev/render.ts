import { DEFAULT_SETTINGS, type CameraState, type Quat, type Settings, type Vec3 } from '../contracts';
import { createDefaultModules } from '../render/modules';
import { createPostProcessor } from '../render/post';
import type { RenderModule } from '../render/contracts';
import { Renderer, type FrameInput } from '../render/renderer';
import { isTimeOfDay, makeAstro } from './render/astro';
import { createDevAtmosphere } from './render/atmosphere';
import { createDevObjects } from './render/objects';
import { groundHeight, makeSyntheticScene } from './render/terrain';
import { drawOsd, probeImage } from './render/osd';

const ORBIT_RADIUS = 17;
const CAMERA_HEIGHT = 4.5;
const TARGET_HEIGHT = 1.2;
const FOV_Y = (65 * Math.PI) / 180;
const READY_FRAMES = 3;
const MAX_DT = 0.1;

/** `?t=noon|dusk|night  ?frames=N  ?dyn=1  ?quality=low|medium|high|ultra  ?scale=0.5  ?spin=rad/s  ?fps=60  ?atmo=dev|real  ?osd=0` */
function readParams(): { time: 'noon' | 'dusk' | 'night'; frames: number; dyn: boolean; quality: Settings['quality']; scale: number; spin: number; fps: number; atmo: string | null; osd: boolean } {
  const q = new URLSearchParams(location.search);
  const t = q.get('t');
  const quality = q.get('quality');
  const num = (key: string, fallback: number): number => { const v = Number(q.get(key)); return q.has(key) && Number.isFinite(v) ? v : fallback; };
  return {
    time: isTimeOfDay(t) ? t : 'noon',
    frames: num('frames', Infinity),
    dyn: q.get('dyn') === '1',
    quality: quality === 'low' || quality === 'medium' || quality === 'ultra' ? quality : 'high',
    scale: num('scale', 1),
    spin: num('spin', 0.1),
    fps: num('fps', 60),
    atmo: q.get('atmo'),
    osd: q.get('osd') !== '0',
  };
}

/** Rotation whose body -Z axis points along (target - pos) with world +Y as the up hint. */
function lookAtQuat(out: Quat, pos: Vec3, target: Vec3): void {
  let fx = target[0] - pos[0], fy = target[1] - pos[1], fz = target[2] - pos[2];
  const fl = Math.hypot(fx, fy, fz);
  fx /= fl; fy /= fl; fz /= fl;
  let rx = -fz, rz = fx;
  const rl = Math.hypot(rx, rz);
  rx /= rl; rz /= rl;
  const ux = -fy * rz, uy = rz * fx - rx * fz, uz = fy * rx;
  const m00 = rx, m10 = 0, m20 = rz, m01 = ux, m11 = uy, m21 = uz, m02 = -fx, m12 = -fy, m22 = -fz;
  const tr = m00 + m11 + m22;
  if (tr > 0) {
    const s = Math.sqrt(tr + 1) * 2;
    out[0] = (m21 - m12) / s; out[1] = (m02 - m20) / s; out[2] = (m10 - m01) / s; out[3] = s / 4;
  } else if (m00 > m11 && m00 > m22) {
    const s = Math.sqrt(1 + m00 - m11 - m22) * 2;
    out[0] = s / 4; out[1] = (m01 + m10) / s; out[2] = (m02 + m20) / s; out[3] = (m21 - m12) / s;
  } else if (m11 > m22) {
    const s = Math.sqrt(1 + m11 - m00 - m22) * 2;
    out[0] = (m01 + m10) / s; out[1] = s / 4; out[2] = (m12 + m21) / s; out[3] = (m02 - m20) / s;
  } else {
    const s = Math.sqrt(1 + m22 - m00 - m11) * 2;
    out[0] = (m02 + m20) / s; out[1] = (m12 + m21) / s; out[2] = s / 4; out[3] = (m10 - m01) / s;
  }
}

function buildModules(atmo: string | null, sceneSampler: ReturnType<typeof makeSyntheticScene>['sampler']): RenderModule[] {
  const modules = createDefaultModules();
  const useDev = atmo === 'dev' || (atmo !== 'real' && modules[0].name.endsWith('-stub'));
  if (useDev) modules[0] = createDevAtmosphere();
  modules.push(createDevObjects(sceneSampler));
  return modules;
}

export default async function run(canvas: HTMLCanvasElement, osdCanvas: HTMLCanvasElement): Promise<void> {
  const params = readParams();
  const scene = makeSyntheticScene();
  const settings: Settings = {
    ...DEFAULT_SETTINGS,
    quality: params.quality,
    dynamicResolution: params.dyn,
    renderScale: params.scale,
    targetFps: params.fps,
    observer: { latitudeDeg: 46, longitudeDeg: 8, altitudeM: 300 },
  };
  const renderer = await Renderer.create(canvas, settings, buildModules(params.atmo, scene.sampler), createPostProcessor());
  renderer.setScene(scene);

  const astro = makeAstro(params.time);
  const camera: CameraState = { pos: [0, 0, 0], quat: [0, 0, 0, 1], fovY: FOV_Y, aspect: 16 / 9, near: 0.05, far: 1e5 };
  const input: FrameInput = { dt: 0, time: 0, camera, astro, quad: null };
  const target: Vec3 = [0, groundHeight(0, 0) + TARGET_HEIGHT, 0];
  const osd = params.osd ? osdCanvas.getContext('2d') : null;

  let framesLeftUntilReady = READY_FRAMES;
  let frameCount = 0;
  let lastNow = performance.now();
  let startNow = lastNow;

  const publish = (): void => { window.__fpv = { ready: true, stats: renderer.stats, errors: renderer.errors, probe: () => probeImage(renderer) }; };
  const resize = (): void => {
    const w = Math.max(1, canvas.clientWidth), h = Math.max(1, canvas.clientHeight), dpr = window.devicePixelRatio || 1;
    renderer.resize(w, h, dpr);
    osdCanvas.width = w;
    osdCanvas.height = h;
    camera.aspect = w / h;
    framesLeftUntilReady = READY_FRAMES;
  };
  resize();
  window.addEventListener('resize', resize);

  const tick = (now: number): void => {
    const dt = Math.min((now - lastNow) / 1000, MAX_DT);
    lastNow = now;
    const angle = ((now - startNow) / 1000) * params.spin;
    const x = Math.sin(angle) * ORBIT_RADIUS, z = Math.cos(angle) * ORBIT_RADIUS;
    camera.pos[0] = x; camera.pos[1] = groundHeight(x, z) + CAMERA_HEIGHT; camera.pos[2] = z;
    lookAtQuat(camera.quat, camera.pos, target);
    input.dt = dt;
    input.time = (now - startNow) / 1000;
    renderer.render(input);
    frameCount++;
    if (osd && frameCount % 10 === 0) drawOsd(osd, osdCanvas, renderer.stats, params.time);
    if (framesLeftUntilReady > 0 && --framesLeftUntilReady === 0) publish();
    if (frameCount < params.frames && !renderer.lost) requestAnimationFrame(tick);
    else if (framesLeftUntilReady > 0) publish();
  };
  requestAnimationFrame(tick);
}

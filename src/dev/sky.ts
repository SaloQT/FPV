import { DEFAULT_SETTINGS, type AstroState, type CameraState, type Quat, type Settings, type Vec3 } from '../contracts';
import { FORMATS, type PostProcessor, type RenderContext, type RenderModule } from '../render/contracts';
import { createAtmosphereModule, type AtmosphereModule, type AtmosphereSettings } from '../render/atmosphere';
import { DEFAULT_ATMOSPHERE_SETTINGS } from '../render/atmosphere/settings';
import { fromHalf } from '../render/half';
import { createDefaultModules } from '../render/modules';
import { createPostProcessor } from '../render/post';
import { Renderer, type FrameInput } from '../render/renderer';
import { SimClock } from '../world/astro';
import { starDirectionEq } from '../world/astro/stars';
import { groundHeight, makeSyntheticScene } from './render/terrain';

const DEG = Math.PI / 180;
const CAMERA_ABOVE_GROUND = 2;
const READY_FRAMES = 3;
const FIXED_DT = 1 / 60;

/**
 * Sky dev page. Query: t=<ISO date-time, local clock unless it carries Z or an offset> tz=<hours east of UTC, default 2> lat lon alt(m)
 * az=<bearing deg from north> el=<deg> fov=<vertical deg> clouds=<0..1 cumulus cover> cirrus=<0..1> quality=low|medium|high|ultra
 * look=sun|moon|<planet name>|<star name: polaris dubhe sirius betelgeuse ...> (aims at that body instead of az/el) stars=0 mw=0 seed frames=<N or inf, default 8> scale=<render scale>
 * st=<start sim seconds> ev=<stops of exposure compensation> osd=0
 */
function readParams() {
  const q = new URLSearchParams(location.search);
  const num = (key: string, fallback: number): number => { const v = Number(q.get(key)); return q.has(key) && q.get(key) !== '' && Number.isFinite(v) ? v : fallback; };
  const quality = q.get('quality');
  const tz = num('tz', 2);
  const t = q.get('t') ?? '2026-06-21T12:00';
  const hasZone = /(Z|[+-]\d\d:?\d\d)$/i.test(t);
  const parsed = Date.parse(hasZone ? t : `${t}Z`);
  const timeMs = (Number.isFinite(parsed) ? parsed : Date.parse('2026-06-21T12:00Z')) - (hasZone ? 0 : tz * 3600000);
  const frames = q.get('frames') === 'inf' ? Infinity : Math.max(READY_FRAMES, num('frames', 8));
  return {
    t, timeMs, lat: num('lat', 46), lon: num('lon', 8), alt: num('alt', 300), az: num('az', 180), el: num('el', 20), fov: num('fov', 60),
    clouds: q.has('clouds') ? Math.min(1, Math.max(0, num('clouds', 0))) : null, cirrus: q.has('cirrus') ? num('cirrus', 0) : null,
    quality: (quality === 'low' || quality === 'medium' || quality === 'ultra' ? quality : 'high') as Settings['quality'],
    stars: q.get('stars') !== '0', mw: q.get('mw') !== '0', seed: num('seed', DEFAULT_SETTINGS.seed), frames, scale: num('scale', 1),
    startTime: num('st', 1000), osd: q.get('osd') !== '0', look: (q.get('look') ?? '').toLowerCase(), ev: num('ev', 0),
  };
}

/** Bright stars for `look=`: J2000 right ascension and declination in degrees. */
const NAMED_STARS: Record<string, [number, number]> = {
  polaris: [37.954, 89.264], dubhe: [165.932, 61.751], merak: [165.46, 56.383], alkaid: [206.885, 49.313], sirius: [101.287, -16.716],
  betelgeuse: [88.793, 7.407], rigel: [78.634, -8.202], vega: [279.235, 38.784], antares: [247.352, -26.432], schedar: [10.127, 56.537],
  caph: [2.295, 59.15], arcturus: [213.915, 19.182],
};

/** World direction of the sun, the moon, a planet or a named star (null when `name` is empty or unknown). */
function bodyDirection(name: string, astro: AstroState): Vec3 | null {
  if (name === 'sun') return astro.sunDir;
  if (name === 'moon') return astro.moonDir;
  const star = NAMED_STARS[name];
  if (star) {
    const eq = starDirectionEq(star[0] * DEG, star[1] * DEG);
    const m = astro.equatorialToWorld;
    return [m[0] * eq[0] + m[1] * eq[1] + m[2] * eq[2], m[3] * eq[0] + m[4] * eq[1] + m[5] * eq[2], m[6] * eq[0] + m[7] * eq[1] + m[8] * eq[2]];
  }
  return astro.planets.find((b) => b.name.toLowerCase() === name)?.dir ?? null;
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

export interface HdrStats {
  width: number;
  height: number;
  nonFinite: number;
  negative: number;
  /** Pixels whose rgb is exactly zero. */
  black: number;
  max: number;
  maxAt: [number, number];
  mean: [number, number, number];
}

/** Wraps the post processor so the pre-exposed HDR target can be copied to the CPU on the next frame (headless verification). */
const BIAS_SHADER = `
@vertex fn vs(@builtin(vertex_index) i : u32) -> @builtin(position) vec4f {
  let p = vec2f(f32((i << 1u) & 2u), f32(i & 2u));
  return vec4f(p * 2.0 - 1.0, 0.0, 1.0);
}
@fragment fn fs() -> @location(0) vec4f { return vec4f(0.0); }`;

/** Exposure compensation for judging the sky when the automatic exposure (ground-metered) clips it: scales the HDR target by 2^ev. */
function exposureBias(ev: number): (enc: GPUCommandEncoder, rc: RenderContext) => void {
  let pipeline: GPURenderPipeline | null = null;
  return (enc, rc) => {
    if (ev === 0) return;
    if (!pipeline) {
      const module = rc.device.createShaderModule({ code: BIAS_SHADER });
      const off: GPUBlendComponent = { srcFactor: 'zero', dstFactor: 'one', operation: 'add' };
      pipeline = rc.device.createRenderPipeline({
        layout: 'auto', vertex: { module, entryPoint: 'vs' },
        fragment: { module, entryPoint: 'fs', targets: [{ format: FORMATS.hdr, blend: { color: { srcFactor: 'zero', dstFactor: 'constant', operation: 'add' }, alpha: off } }] },
      });
    }
    const k = 2 ** ev;
    const pass = enc.beginRenderPass({ colorAttachments: [{ view: rc.gbuf.views.hdr, loadOp: 'load', storeOp: 'store' }] });
    pass.setPipeline(pipeline);
    pass.setBlendConstant([k, k, k, 1]);
    pass.draw(3);
    pass.end();
  };
}

function withHdrProbe(post: PostProcessor, bias: (enc: GPUCommandEncoder, rc: RenderContext) => void) {
  let request: GPUBuffer | null = null;
  let last: { width: number; height: number; data: Uint16Array } | null = null;
  const wrapped: PostProcessor = {
    ...post,
    init: (rc) => post.init(rc),
    resize: (rc, out) => post.resize(rc, out),
    encode(enc, rc, f, target, o) {
      if (request) {
        const g = rc.gbuf;
        enc.copyTextureToBuffer({ texture: g.hdr }, { buffer: request, bytesPerRow: Math.ceil((g.width * 8) / 256) * 256 }, [g.width, g.height]);
      }
      bias(enc, rc);
      post.encode(enc, rc, f, target, o);
    },
  };
  const read = async (device: GPUDevice, width: number, height: number, render: () => void): Promise<HdrStats> => {
    const bytesPerRow = Math.ceil((width * 8) / 256) * 256;
    request = device.createBuffer({ size: bytesPerRow * height, usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ });
    render();
    const buf = request;
    request = null;
    await buf.mapAsync(GPUMapMode.READ);
    const src = new Uint16Array(buf.getMappedRange());
    const data = new Uint16Array(width * height * 4);
    for (let y = 0; y < height; y++) data.set(src.subarray((y * bytesPerRow) / 2, (y * bytesPerRow) / 2 + width * 4), y * width * 4);
    buf.destroy();
    last = { width, height, data };
    return summarise(last);
  };
  const pixel = (x: number, y: number): number[] => {
    if (!last) return [];
    const o = (y * last.width + x) * 4;
    return [0, 1, 2, 3].map((c) => fromHalf(last!.data[o + c]));
  };
  return { post: wrapped, read, pixel };
}

function summarise(img: { width: number; height: number; data: Uint16Array }): HdrStats {
  const s: HdrStats = { width: img.width, height: img.height, nonFinite: 0, negative: 0, black: 0, max: 0, maxAt: [0, 0], mean: [0, 0, 0] };
  const sum = [0, 0, 0];
  for (let i = 0; i < img.width * img.height; i++) {
    let zero = true;
    for (let c = 0; c < 3; c++) {
      const v = fromHalf(img.data[i * 4 + c]);
      if (!Number.isFinite(v)) { s.nonFinite++; continue; }
      if (v < 0) s.negative++;
      if (v !== 0) zero = false;
      sum[c] += v;
      if (v > s.max) { s.max = v; s.maxAt = [i % img.width, Math.floor(i / img.width)]; }
    }
    if (zero) s.black++;
  }
  const n = img.width * img.height;
  s.mean = [sum[0] / n, sum[1] / n, sum[2] / n];
  return s;
}

export default async function run(canvas: HTMLCanvasElement): Promise<void> {
  const p = readParams();
  const scene = makeSyntheticScene();
  const settings: Settings = {
    ...DEFAULT_SETTINGS, quality: p.quality, dynamicResolution: false, renderScale: p.scale, timeMs: p.timeMs, timeScale: 0, seed: p.seed,
    observer: { latitudeDeg: p.lat, longitudeDeg: p.lon, altitudeM: p.alt },
  };
  const sky: Partial<AtmosphereSettings> = { starsEnabled: p.stars, milkyWayEnabled: p.mw };
  if (p.clouds !== null) sky.cloudCoverage = p.clouds;
  if (p.cirrus !== null) sky.cirrusCoverage = p.cirrus;
  sky.cloudsEnabled = (sky.cloudCoverage ?? DEFAULT_ATMOSPHERE_SETTINGS.cloudCoverage) > 0 || (sky.cirrusCoverage ?? DEFAULT_ATMOSPHERE_SETTINGS.cirrusCoverage) > 0;
  const atmosphere: AtmosphereModule = createAtmosphereModule(sky);
  const modules: RenderModule[] = createDefaultModules();
  modules[0] = atmosphere;
  const probe = withHdrProbe(createPostProcessor(), exposureBias(p.ev));
  const renderer = await Renderer.create(canvas, settings, modules, probe.post);
  renderer.setScene(scene);

  const astro = new SimClock(settings).state();
  const pos: Vec3 = [0, groundHeight(0, 0) + CAMERA_ABOVE_GROUND, 0];
  const el = Math.min(89.5, Math.max(-89.5, p.el)) * DEG, az = p.az * DEG;
  const aim = bodyDirection(p.look, astro) ?? [Math.sin(az) * Math.cos(el), Math.sin(el), -Math.cos(az) * Math.cos(el)];
  const target: Vec3 = [pos[0] + aim[0], pos[1] + aim[1], pos[2] + aim[2]];
  const camera: CameraState = { pos, quat: [0, 0, 0, 1], fovY: p.fov * DEG, aspect: 16 / 9, near: 0.05, far: 1e5 };
  lookAtQuat(camera.quat, pos, target);
  const input: FrameInput = { dt: FIXED_DT, time: p.startTime, camera, astro, quad: null };

  let frame = 0;
  const publish = (): void => {
    window.__fpv = {
      ready: true, stats: renderer.stats, errors: renderer.errors, params: p, astro, atmosphere: atmosphere.getSettings(),
      hdrStats: () => probe.read(renderer.device, renderer.stats.renderWidth, renderer.stats.renderHeight, () => renderer.render(input)),
      hdrPixel: probe.pixel,
      setAtmosphere: (s: Partial<AtmosphereSettings>) => atmosphere.setSettings(s),
    };
  };
  const resize = (): void => {
    const w = Math.max(1, canvas.clientWidth), h = Math.max(1, canvas.clientHeight);
    renderer.resize(w, h, window.devicePixelRatio || 1);
    camera.aspect = w / h;
  };
  resize();
  window.addEventListener('resize', resize);

  const tick = (): void => {
    input.time = p.startTime + frame * FIXED_DT;
    renderer.render(input);
    frame++;
    const done = frame >= p.frames;
    if (frame === (Number.isFinite(p.frames) ? p.frames : READY_FRAMES)) publish();
    if (!done && !renderer.lost) requestAnimationFrame(tick);
    else if (!window.__fpv.ready) publish();
  };
  requestAnimationFrame(tick);
}

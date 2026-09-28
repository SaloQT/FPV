import { resolveShader, compileShader } from './render/shaderLib';

declare global {
  interface Window {
    __fpv: { ready: boolean; error?: string; stats?: unknown } & Record<string, unknown>;
  }
}
window.__fpv = { ready: false };

async function boot() {
  const canvas = document.getElementById('view') as HTMLCanvasElement;
  if (!navigator.gpu) throw new Error('WebGPU is not available in this browser.');
  const adapter = await navigator.gpu.requestAdapter({ powerPreference: 'high-performance' });
  if (!adapter) throw new Error('No WebGPU adapter found.');
  const device = await adapter.requestDevice();
  canvas.width = Math.floor(canvas.clientWidth * devicePixelRatio);
  canvas.height = Math.floor(canvas.clientHeight * devicePixelRatio);
  const ctx = canvas.getContext('webgpu')!;
  const format = navigator.gpu.getPreferredCanvasFormat();
  ctx.configure({ device, format, alphaMode: 'opaque' });
  // Scaffold smoke test: the shared WGSL includes must compile together.
  await compileShader(device, 'scaffold', resolveShader('common/world_bindings.wgsl') + '\n@compute @workgroup_size(1) fn main() { let h = terrainHeightAt(vec2f(0.0)); _ = h; _ = frame.params.y; _ = octDecode(octEncode(vec3f(0.0, 1.0, 0.0))); }');
  let frames = 0;
  const draw = () => {
    const enc = device.createCommandEncoder();
    const pass = enc.beginRenderPass({ colorAttachments: [{ view: ctx.getCurrentTexture().createView(), clearValue: { r: 0.05, g: 0.1, b: 0.2, a: 1 }, loadOp: 'clear', storeOp: 'store' }] });
    pass.end();
    device.queue.submit([enc.finish()]);
    window.__fpv.stats = { frames: ++frames };
    requestAnimationFrame(draw);
  };
  requestAnimationFrame(draw);
  await device.queue.onSubmittedWorkDone();
  window.__fpv.ready = true;
}

boot().catch((e) => {
  console.error(e);
  window.__fpv.error = String(e?.stack ?? e);
});

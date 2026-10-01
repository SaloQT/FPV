const OPTIONAL_FEATURES: readonly GPUFeatureName[] = ['timestamp-query', 'float32-filterable', 'indirect-first-instance', 'shader-f16'];

const RAISED_LIMITS: readonly (keyof GPUSupportedLimits)[] = [
  'maxStorageBufferBindingSize',
  'maxBufferSize',
  'maxUniformBufferBindingSize',
  'maxTextureDimension2D',
  'maxTextureDimension3D',
  'maxStorageBuffersPerShaderStage',
  'maxStorageTexturesPerShaderStage',
  'maxSampledTexturesPerShaderStage',
  'maxComputeWorkgroupStorageSize',
  'maxComputeInvocationsPerWorkgroup',
  'maxComputeWorkgroupSizeX',
  'maxComputeWorkgroupSizeY',
  'maxComputeWorkgroupsPerDimension',
  'maxBindGroups',
  'maxColorAttachmentBytesPerSample',
];

export interface AdapterDetails {
  vendor: string;
  architecture: string;
  device: string;
  description: string;
  /** True for a software adapter (SwiftShader, llvmpipe, WARP): correct but a hundred times too slow for real-time use. */
  software: boolean;
}

export interface DeviceSetup {
  device: GPUDevice;
  features: ReadonlySet<string>;
  adapterName: string;
  adapter: AdapterDetails;
}

/** Why the GPU could not be used; the error screen picks its troubleshooting steps from this. */
export type GpuFailureKind = 'no-webgpu' | 'no-adapter' | 'device-request';

export class GpuInitError extends Error {
  constructor(readonly kind: GpuFailureKind, message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = 'GpuInitError';
  }
}

/** Errors are kept in `sink` (first MAX_ERRORS only) and also printed, so shot tooling and the console both see them. */
export const MAX_ERRORS = 20;

export function recordError(sink: string[], message: string): void {
  console.error(message);
  if (sink.length < MAX_ERRORS) sink.push(message);
}

const SOFTWARE_PATTERN = /swiftshader|llvmpipe|softpipe|software|\bwarp\b|microsoft basic render/i;

/** True for a software rasteriser: the adapter says so (`isFallbackAdapter`) or its names give it away. */
export function isSoftwareAdapter(d: Pick<AdapterDetails, 'vendor' | 'architecture' | 'description'>, flagged = false): boolean {
  return flagged || SOFTWARE_PATTERN.test(`${d.vendor} ${d.architecture} ${d.description}`);
}

async function adapterDetails(adapter: GPUAdapter): Promise<AdapterDetails> {
  const legacy = (adapter as unknown as { requestAdapterInfo?: () => Promise<GPUAdapterInfo> }).requestAdapterInfo;
  const info: Partial<GPUAdapterInfo> = adapter.info ?? (legacy ? await legacy.call(adapter) : {});
  const text = (v: unknown): string => (typeof v === 'string' ? v : '');
  const d: AdapterDetails = { vendor: text(info.vendor), architecture: text(info.architecture), device: text(info.device), description: text(info.description), software: false };
  const fallback = (info as { isFallbackAdapter?: boolean }).isFallbackAdapter ?? (adapter as unknown as { isFallbackAdapter?: boolean }).isFallbackAdapter;
  d.software = isSoftwareAdapter(d, fallback === true);
  return d;
}

function describeAdapter(d: AdapterDetails): string {
  const parts = [d.vendor, d.architecture, d.description].filter((x) => x.length > 0);
  return parts.length ? parts.join(' ') : 'unknown adapter';
}

async function pickAdapter(): Promise<GPUAdapter> {
  let adapter: GPUAdapter | null = null;
  try {
    adapter = await navigator.gpu.requestAdapter({ powerPreference: 'high-performance' });
    adapter ??= await navigator.gpu.requestAdapter();
  } catch (e) {
    throw new GpuInitError('no-adapter', `requestAdapter failed: ${(e as Error)?.message ?? e}`, { cause: e });
  }
  if (!adapter) throw new GpuInitError('no-adapter', 'The browser has WebGPU but found no usable graphics adapter.');
  return adapter;
}

/** Requests the device with every optional feature the adapter has and limits raised to what the adapter supports. */
export async function requestDevice(): Promise<DeviceSetup> {
  if (typeof navigator === 'undefined' || !navigator.gpu) throw new GpuInitError('no-webgpu', 'WebGPU is not available in this browser.');
  const adapter = await pickAdapter();
  const requiredFeatures = OPTIONAL_FEATURES.filter((f) => adapter.features.has(f));
  const requiredLimits: Record<string, number> = {};
  const supported = adapter.limits as unknown as Record<string, number>;
  for (const k of RAISED_LIMITS) if (typeof supported[k] === 'number') requiredLimits[k] = supported[k];
  let device: GPUDevice;
  try {
    device = await adapter.requestDevice({ requiredFeatures, requiredLimits });
  } catch (e) {
    throw new GpuInitError('device-request', `requestDevice failed: ${(e as Error)?.message ?? e}`, { cause: e });
  }
  const details = await adapterDetails(adapter);
  return { device, features: new Set(requiredFeatures), adapterName: describeAdapter(details), adapter: details };
}

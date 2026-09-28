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

export interface DeviceSetup {
  device: GPUDevice;
  features: ReadonlySet<string>;
  adapterName: string;
}

/** Errors are kept in `sink` (first MAX_ERRORS only) and also printed, so shot tooling and the console both see them. */
export const MAX_ERRORS = 20;

export function recordError(sink: string[], message: string): void {
  console.error(message);
  if (sink.length < MAX_ERRORS) sink.push(message);
}

function describeAdapter(adapter: GPUAdapter): string {
  const i = adapter.info;
  const parts = [i?.vendor, i?.architecture, i?.description].filter((s) => !!s);
  return parts.length ? parts.join(' ') : 'unknown adapter';
}

/** Requests the device with every optional feature the adapter has and limits raised to what the adapter supports. */
export async function requestDevice(): Promise<DeviceSetup> {
  if (!navigator.gpu) throw new Error('WebGPU is not available in this browser.');
  const adapter = await navigator.gpu.requestAdapter({ powerPreference: 'high-performance' });
  if (!adapter) throw new Error('No WebGPU adapter found.');
  const requiredFeatures = OPTIONAL_FEATURES.filter((f) => adapter.features.has(f));
  const requiredLimits: Record<string, number> = {};
  const supported = adapter.limits as unknown as Record<string, number>;
  for (const k of RAISED_LIMITS) if (typeof supported[k] === 'number') requiredLimits[k] = supported[k];
  const device = await adapter.requestDevice({ requiredFeatures, requiredLimits });
  return { device, features: new Set(requiredFeatures), adapterName: describeAdapter(adapter) };
}

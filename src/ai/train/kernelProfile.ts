/** Opt-in per-dispatch timestamp pairs. Normal training keeps its single compute pass. */
export interface KernelTiming {
  name: string;
  dispatches: number;
  validSamples: number;
  invalidSamples: number;
  zeroSamples: number;
  totalMs: number | null;
}
export interface KernelProfile {
  mode: 'timestamp' | 'unsupported';
  totalMs: number | null;
  spanMs: number | null;
  kernels: KernelTiming[];
}

/** Subtract integer nanoseconds before converting to Number, to preserve precision on long-lived GPUs. */
export function decodeKernelTimes(times: BigUint64Array, names: readonly string[]): KernelProfile {
  const kernels = new Map<string, KernelTiming>();
  for (let i = 0; i < names.length; i++) {
    const name = names[i];
    let k = kernels.get(name);
    if (!k) { k = { name, dispatches: 0, validSamples: 0, invalidSamples: 0, zeroSamples: 0, totalMs: null }; kernels.set(name, k); }
    k.dispatches++;
    const a = times[2 * i], b = times[2 * i + 1];
    if (a === undefined || b === undefined || a === 0n || b < a) { k.invalidSamples++; continue; }
    const ms = Number(b - a) / 1e6;
    k.validSamples++;
    if (ms === 0) k.zeroSamples++;
    k.totalMs = (k.totalMs ?? 0) + ms;
  }
  const rows = [...kernels.values()];
  const valid = rows.some(k => k.validSamples > 0);
  const a = times[0], b = times[2 * names.length - 1];
  return {
    mode: 'timestamp',
    totalMs: valid ? rows.reduce((s, k) => s + (k.totalMs ?? 0), 0) : null,
    spanMs: a !== undefined && b !== undefined && a > 0n && b >= a ? Number(b - a) / 1e6 : null,
    kernels: rows,
  };
}

export class KernelProfiler {
  readonly bytes: number;
  private readonly queries: GPUQuerySet;
  private readonly resolved: GPUBuffer;
  private names: string[] = [];
  constructor(device: GPUDevice, dispatches: number) {
    const count = 2 * dispatches;
    if (count > 8192) throw new Error(`Kernel profiling requires ${count} timestamp queries (limit 8192); reduce steps, epochs or minibatches`);
    this.bytes = count * 8;
    this.queries = device.createQuerySet({ label: 'training kernel timestamps', type: 'timestamp', count });
    this.resolved = device.createBuffer({ label: 'training timestamp resolve', size: this.bytes, usage: GPUBufferUsage.QUERY_RESOLVE | GPUBufferUsage.COPY_SRC });
  }
  begin(): void { this.names = []; }
  pass(name: string): GPUComputePassDescriptor {
    const first = this.names.length * 2;
    this.names.push(name);
    return { label: name, timestampWrites: { querySet: this.queries, beginningOfPassWriteIndex: first, endOfPassWriteIndex: first + 1 } };
  }
  resolve(enc: GPUCommandEncoder, staging: GPUBuffer, offset: number): void {
    const count = this.names.length * 2;
    if (!count) return;
    enc.resolveQuerySet(this.queries, 0, count, this.resolved, 0);
    enc.copyBufferToBuffer(this.resolved, 0, staging, offset, count * 8);
  }
  read(mapped: ArrayBuffer, offset: number): KernelProfile {
    return decodeKernelTimes(new BigUint64Array(mapped.slice(offset, offset + this.names.length * 16)), this.names);
  }
}

import { describe, expect, it } from 'vitest';
import { GpuInitError, isSoftwareAdapter, recordError, MAX_ERRORS } from './deviceSetup';

describe('isSoftwareAdapter', () => {
  it('recognises the common software rasterisers by name', () => {
    expect(isSoftwareAdapter({ vendor: 'google', architecture: 'swiftshader', description: 'SwiftShader Device (Subzero)' })).toBe(true);
    expect(isSoftwareAdapter({ vendor: 'mesa', architecture: '', description: 'llvmpipe (LLVM 15.0.7, 256 bits)' })).toBe(true);
    expect(isSoftwareAdapter({ vendor: 'microsoft', architecture: '', description: 'Microsoft Basic Render Driver' })).toBe(true);
    expect(isSoftwareAdapter({ vendor: 'microsoft', architecture: 'warp', description: '' })).toBe(true);
  });

  it('does not flag real GPUs', () => {
    expect(isSoftwareAdapter({ vendor: 'nvidia', architecture: 'ada', description: 'NVIDIA GeForce RTX 4080' })).toBe(false);
    expect(isSoftwareAdapter({ vendor: 'amd', architecture: 'rdna-3', description: 'AMD Radeon RX 7800 XT' })).toBe(false);
    expect(isSoftwareAdapter({ vendor: 'apple', architecture: 'metal-3', description: 'Apple M2' })).toBe(false);
    expect(isSoftwareAdapter({ vendor: 'intel', architecture: 'gen-12lp', description: 'Intel(R) Iris(R) Xe Graphics' })).toBe(false);
  });

  it('trusts the adapter\'s own fallback flag', () => {
    expect(isSoftwareAdapter({ vendor: 'x', architecture: 'y', description: 'z' }, true)).toBe(true);
  });
});

describe('GpuInitError', () => {
  it('carries the failure kind for the error screen', () => {
    const e = new GpuInitError('no-adapter', 'nothing');
    expect(e).toBeInstanceOf(Error);
    expect(e.kind).toBe('no-adapter');
    expect(e.message).toBe('nothing');
  });
});

describe('recordError', () => {
  it('keeps only the first MAX_ERRORS messages but always prints', () => {
    const sink: string[] = [];
    const spy = console.error;
    let printed = 0;
    console.error = () => { printed++; };
    try {
      for (let i = 0; i < MAX_ERRORS + 5; i++) recordError(sink, `e${i}`);
    } finally {
      console.error = spy;
    }
    expect(sink).toHaveLength(MAX_ERRORS);
    expect(sink[0]).toBe('e0');
    expect(printed).toBe(MAX_ERRORS + 5);
  });
});

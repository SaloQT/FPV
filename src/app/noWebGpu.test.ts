import { describe, expect, it } from 'vitest';

// Every module the app loads must import on a browser without WebGPU (no GPUShaderStage/GPUTextureUsage/... globals), or the page
// goes blank before the failure panel can run.
const modules = import.meta.glob(['../**/*.ts', '!../**/*.test.ts', '!../dev/**', '!../main.ts']);

describe('module load without WebGPU', () => {
  it('has no WebGPU globals in this environment', () => {
    for (const name of ['GPUShaderStage', 'GPUTextureUsage', 'GPUBufferUsage', 'GPUMapMode', 'GPUColorWrite']) {
      expect((globalThis as Record<string, unknown>)[name]).toBeUndefined();
    }
  });

  it('imports every non-dev module without reading a GPU global', async () => {
    const failures: string[] = [];
    for (const [path, load] of Object.entries(modules)) {
      try {
        await load();
      } catch (e) {
        const message = String((e as Error)?.message ?? e);
        if (/\bGPU\w*\b/.test(message) && /not defined|undefined/.test(message)) failures.push(`${path}: ${message}`);
      }
    }
    expect(failures).toEqual([]);
  }, 60_000);
});

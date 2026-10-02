import { loadEnv } from 'vite';
import { defineConfig } from 'vitest/config';

// What the failure panel needs stays in the entry chunk: the entry must still run to show it when the rest of the app cannot load.
const failurePanel = /[\\/]src[\\/]ui[\\/](errorScreen|errorMessages|dom)\.ts$|[\\/]src[\\/]ui[\\/]panels\.css/;
const area = (re: RegExp) => (id: string): boolean => re.test(id) && !failurePanel.test(id);

export default defineConfig(({ mode }) => ({
  // Relative asset URLs: the build runs from any directory of a static host, not only the domain root.
  base: './',
  server: { headers: { 'Cross-Origin-Opener-Policy': 'same-origin', 'Cross-Origin-Embedder-Policy': 'require-corp' } },
  build: {
    target: 'es2022',
    // Source maps are for debugging a deployment: opt in with `FPV_SOURCEMAP=1 npm run build`; the default build ships none.
    sourcemap: loadEnv(mode, '.', 'FPV_').FPV_SOURCEMAP === '1',
    rolldownOptions: {
      output: {
        // The WGSL sources (a third of a megabyte of text) and the three big code areas are separate chunks, each well under the size
        // warning, so a change in one area does not re-download the others.
        codeSplitting: {
          groups: [
            { name: 'shaders', test: /[\\/]src[\\/]render[\\/](shaders[\\/]|shaderLib\.ts)/, priority: 4, includeDependenciesRecursively: false },
            { name: 'render', test: /[\\/]src[\\/]render[\\/]/, priority: 3, includeDependenciesRecursively: false },
            { name: 'world', test: /[\\/]src[\\/]((world|sim|game)[\\/]|contracts\.ts)/, priority: 2, includeDependenciesRecursively: false },
            { name: 'ui', test: area(/[\\/]src[\\/](ui|app|input|audio)[\\/]/), priority: 1, includeDependenciesRecursively: false },
          ],
        },
      },
    },
  },
  worker: { format: 'es' },
  test: { environment: 'node', include: ['src/**/*.test.ts'] },
}));

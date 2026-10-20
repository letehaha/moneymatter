import { builtinModules } from 'module';
import path from 'path';
import { defineConfig } from 'vite';

import pkg from './package.json';

/**
 * The chat sandbox worker is started with `new Worker(file)`, so it cannot live inside the app bundle.
 * It is built after the app (see the `build` script) into the same `dist/`, as `sandbox-worker.js`.
 * It imports no repo code at run time, only the QuickJS packages, which stay external.
 */
export default defineConfig({
  build: {
    target: 'node23',
    outDir: 'dist',
    lib: {
      entry: path.resolve(import.meta.dirname, 'src/services/chat/sandbox/sandbox-worker.mts'),
      formats: ['cjs'],
    },
    rollupOptions: {
      external: [...builtinModules, ...builtinModules.map((m) => `node:${m}`), ...Object.keys(pkg.dependencies || {})],
      output: { entryFileNames: 'sandbox-worker.js', interop: 'auto' },
    },
    sourcemap: true,
    // The app build wrote dist/ first; this one adds to it.
    emptyOutDir: false,
    minify: false,
  },
});

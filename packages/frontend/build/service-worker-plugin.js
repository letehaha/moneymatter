import { build } from 'esbuild';
import { fileURLToPath } from 'url';

const SW_ENTRY = fileURLToPath(new URL('../src/service-worker/sw.ts', import.meta.url));
const SW_FILE_NAME = 'sw.js';

/** Bundles the worker into one classic script: a worker registered without `type: 'module'` cannot `import`. */
const bundleServiceWorker = async ({ minify }) => {
  const result = await build({
    entryPoints: [SW_ENTRY],
    bundle: true,
    write: false,
    format: 'iife',
    target: 'es2020',
    platform: 'browser',
    minify,
    sourcemap: false,
    legalComments: 'none',
    logLevel: 'silent',
  });
  return result.outputFiles[0].text;
};

/**
 * Emits the push service worker as /sw.js. The build writes it to the output root and the dev
 * server answers /sw.js from an in-memory build on every request, so edits show up on reload.
 * It sits at the root so its scope covers the whole app.
 */
export const serviceWorkerPlugin = () => ({
  name: 'service-worker',
  async generateBundle() {
    this.emitFile({
      type: 'asset',
      fileName: SW_FILE_NAME,
      source: await bundleServiceWorker({ minify: true }),
    });
  },
  configureServer(server) {
    server.middlewares.use(async (req, res, next) => {
      const pathname = (req.url ?? '').split('?')[0];
      if (pathname !== `/${SW_FILE_NAME}`) return next();

      try {
        const source = await bundleServiceWorker({ minify: false });
        res.setHeader('Content-Type', 'application/javascript');
        res.setHeader('Cache-Control', 'no-cache');
        res.end(source);
      } catch (error) {
        next(error);
      }
    });
  },
});

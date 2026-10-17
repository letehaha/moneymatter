import tailwind from '@tailwindcss/vite';
import vue from '@vitejs/plugin-vue';
import autoprefixer from 'autoprefixer';
import { execSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { defineConfig, loadEnv } from 'vite';
import svgLoader from 'vite-svg-loader';

import { serviceWorkerPlugin } from './build/service-worker-plugin.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Resolve the build's commit hash. CI sets VITE_APP_COMMIT_HASH from
// $GITHUB_SHA; locally we shell out to git; if neither works (e.g. running
// outside a git checkout) fall back to a per-build random id so dev builds
// at least have a stable, unique value within a single session.
const resolveAppVersion = () => {
  const fromEnv = process.env.VITE_APP_COMMIT_HASH;
  if (fromEnv) return fromEnv;
  try {
    return execSync('git rev-parse HEAD', { cwd: __dirname }).toString().trim();
  } catch {
    return `dev-${Date.now()}`;
  }
};

// Emit /version.json next to the bundle so the running app can poll it and
// detect a fresh deploy. Pairs with __APP_VERSION__ injected into the bundle
// via Vite's `define`; mismatch between the two triggers a reload prompt.
const versionJsonPlugin = ({ version }) => ({
  name: 'app-version-json',
  apply: 'build',
  generateBundle() {
    this.emitFile({
      type: 'asset',
      fileName: 'version.json',
      source: `${JSON.stringify({ version, builtAt: new Date().toISOString() })}\n`,
    });
  },
});

// https://vitejs.dev/config/
export default async ({ mode }) => {
  process.env = { ...process.env, ...loadEnv(mode, path.resolve(__dirname, '../../'), '') };

  const certPath = path.resolve(__dirname, '../../docker/dev/certs/cert.pem');
  const keyPath = path.resolve(__dirname, '../../docker/dev/certs/key.pem');

  // Only enable HTTPS if certs exist (skip on CI)
  const httpsConfig =
    fs.existsSync(certPath) && fs.existsSync(keyPath)
      ? {
          key: fs.readFileSync(keyPath),
          cert: fs.readFileSync(certPath),
        }
      : undefined;

  const serverConfig = {
    port: process.env.PORT,
    host: process.env.HOST,
    ...(httpsConfig && { https: httpsConfig }),
    hmr: process.env.HMR_HOST ? { host: process.env.HMR_HOST } : true,
  };

  // Only add Sentry plugin in production build when auth token is available
  const sentryEnabled = mode === 'production' && process.env.SENTRY_AUTH_TOKEN;

  // Dynamically import Sentry plugin only when needed
  let sentryPlugin = null;
  if (sentryEnabled) {
    const { sentryVitePlugin } = await import('@sentry/vite-plugin');
    sentryPlugin = sentryVitePlugin({
      org: process.env.SENTRY_ORG,
      project: process.env.SENTRY_PROJECT,
      authToken: process.env.SENTRY_AUTH_TOKEN,
    });
  }

  const appVersion = resolveAppVersion();
  // Bumped in the "Release vX.Y.Z" PR. A git tag can't be used: the release is
  // published after the image for its merge commit is already building.
  const { version: appRelease } = JSON.parse(fs.readFileSync(path.resolve(__dirname, 'package.json'), 'utf8'));

  return defineConfig({
    // Every .env file lives at the repo root, not in this package. Without this
    // Vite would look for them beside vite.config.js and silently expose no
    // VITE_* vars on import.meta.env — the loadEnv call above only populates
    // process.env for this config file.
    envDir: path.resolve(__dirname, '../../'),
    define: {
      __APP_VERSION__: JSON.stringify(appVersion),
      __APP_RELEASE__: JSON.stringify(appRelease),
    },
    plugins: [
      vue(),
      tailwind(),
      svgLoader(),
      versionJsonPlugin({ version: appVersion }),
      serviceWorkerPlugin(),
      sentryPlugin,
    ].filter(Boolean),
    build: {
      sourcemap: true,
      rollupOptions: {
        output: {
          // Split large vendor libraries into separate chunks
          manualChunks: {
            // Analytics - can be deferred
            posthog: ['posthog-js'],
            // Error tracking - separate but still loaded early
            sentry: ['@sentry/vue'],
          },
        },
      },
    },
    server: serverConfig,
    resolve: {
      alias: [
        {
          find: '@',
          replacement: path.resolve(__dirname, 'src'),
        },
        {
          find: '@bt/shared',
          replacement: path.resolve(__dirname, '../shared/src'),
        },
        {
          find: '@tests',
          replacement: path.resolve(__dirname, 'tests'),
        },
      ],
    },
    test: {
      globals: true,
      include: ['src/**/?(*.)+(spec|test).[jt]s?(x)'],
      environment: 'jsdom',
      watch: false,
    },
    css: {
      postcss: {
        plugins: [autoprefixer()],
      },
    },
  });
};

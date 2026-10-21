import path from 'node:path';

/**
 * unpdf's `./pdfjs` subpath is ESM-only and declared with an `import` condition,
 * so neither Node's CJS resolver nor Jest can reach it by specifier.
 */
const UNPDF_PDFJS_BUNDLE = path.join(path.dirname(require.resolve('unpdf')), 'pdfjs.mjs');

/** @type {import('ts-jest/dist/types').InitialOptionsTsJest} */

export default {
  preset: 'ts-jest',
  verbose: true,
  testEnvironment: 'node',
  testMatch: ['**/?(*.)+(spec).[jt]s?(x)'],
  transform: {
    '^.+\\.ts?$': [
      'ts-jest',
      {
        tsconfig: '<rootDir>/tsconfig.json',
        // Transpile-only, matching the vite/esbuild prod build. Type errors are
        // caught by `npm run typecheck`, which CI runs in the backend matrix.
        isolatedModules: true,
      },
    ],
    // mdb-reader (the Microsoft Money parser's Access reader) ships as pure ESM,
    // which Jest's CommonJS runtime cannot load. Compile it down instead of
    // stubbing it, so tests exercise the real reader.
    '[/\\\\]node_modules[/\\\\]mdb-reader[/\\\\].+\\.js$': '<rootDir>/src/tests/transformers/esm-to-cjs.js',
    '[/\\\\]node_modules[/\\\\]ofx-js[/\\\\].+\\.js$': '<rootDir>/src/tests/transformers/esm-to-cjs.js',
    // unpdf's CJS entry reaches its pdf.js bundle through `await import()`, which
    // Jest's VM refuses without --experimental-vm-modules. Compiling both files to
    // CommonJS turns that into a `require` Jest can resolve.
    '[/\\\\]node_modules[/\\\\]unpdf[/\\\\]dist[/\\\\].+\\.(c|m)?js$': '<rootDir>/src/tests/transformers/esm-to-cjs.js',
    '[/\\\\]node_modules[/\\\\]@faker-js[/\\\\]faker[/\\\\].+\\.js$': '<rootDir>/src/tests/transformers/esm-to-cjs.js',
  },
  // Everything in node_modules stays untransformed except the ESM-only packages
  // listed here, which would otherwise fail to parse.
  transformIgnorePatterns: ['/node_modules/(?!(mdb-reader|ofx-js|unpdf|@faker-js/faker)/)'],
  moduleNameMapper: {
    '^unpdf/pdfjs$': UNPDF_PDFJS_BUNDLE,
    // Mock better-auth ESM modules with our CommonJS compatible versions
    '^better-auth$': '<rootDir>/src/tests/mocks/better-auth/index.ts',
    '^better-auth/node$': '<rootDir>/src/tests/mocks/better-auth/node.ts',
    '^@better-auth/oauth-provider$': '<rootDir>/src/tests/mocks/better-auth/oauth-provider.ts',
    '^better-auth/plugins$': '<rootDir>/src/tests/mocks/better-auth/plugins.ts',
    '^@better-auth/passkey$': '<rootDir>/src/tests/mocks/better-auth/passkey.ts',
    '^@better-auth/expo$': '<rootDir>/src/tests/mocks/better-auth/expo.ts',
    // Mock MCP SDK ESM modules with our CommonJS compatible versions
    '^@modelcontextprotocol/sdk/server/mcp\\.js$': '<rootDir>/src/tests/mocks/mcp-sdk/server-mcp.ts',
    '^@modelcontextprotocol/sdk/server/streamableHttp\\.js$':
      '<rootDir>/src/tests/mocks/mcp-sdk/server-streamable-http.ts',
    '@bt/shared/(.*)': '<rootDir>/../shared/src/$1',
    '@routes/(.*)': '<rootDir>/src/routes/$1',
    '@middlewares/(.*)': '<rootDir>/src/middlewares/$1',
    '@crons/(.*)': '<rootDir>/src/crons/$1',
    '@common/(.*)': '<rootDir>/src/common/$1',
    '@i18n/(.*)': '<rootDir>/src/i18n/$1',
    '@controllers/(.*)': '<rootDir>/src/controllers/$1',
    '@migrations/(.*)': '<rootDir>/src/migrations/$1',
    '@models/(.*)': '<rootDir>/src/models/$1',
    '@tests/(.*)': '<rootDir>/src/tests/$1',
    '@js/(.*)': '<rootDir>/src/js/$1',
    '@services/(.*)': '<rootDir>/src/services/$1',
    '@root/(.*)': '<rootDir>/src/$1',
    '@config/(.*)': '<rootDir>/src/config/$1',
  },
};

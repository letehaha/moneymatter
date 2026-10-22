import type { KnipConfig } from 'knip';

const config: KnipConfig = {
  // TODO: fix because it's wrong ignoring them
  ignoreBinaries: ['knip', 'vue-tsc', 'vitest', 'playwright', 'oxlint', 'vite'],
  // Colocated unit tests, so exports consumed only by a test are not flagged.
  entry: ['src/**/*.{test,spec}.{ts,tsx}'],
  ignore: [
    'wallaby.js',
    'tests/**/**',
    'e2e/**/**',
    // keep them all for now
    'src/components/lib/**/**',
    // Only consumer is the kept-but-unused lib ActionButton
    'src/composable/use-action-state.ts',
    // Loaded by a <script src="/config.js"> tag in index.html, which knip does
    // not follow. The self-host container entrypoint overwrites it at boot.
    'public/config.js',
  ],
  ignoreDependencies: [
    // needed for build
    'vue-tsc',

    // peerDependency of v-calendar
    '@popperjs/core',
  ],
  rules: {
    // Disables "Dubplicate exports" warning. In some components we want to keep
    // exporting the component both as the variable and as a "default export"
    duplicates: 'off',
    // Knip can't follow imports made inside `<script>` blocks of .vue files
    // without an SFC compiler plugin, so every TS file consumed only by Vue
    // components shows up as unused. Until the config is reworked to register
    // a Vue compiler + tune project globs, downgrade this category so CI
    // doesn't block on the pre-existing false positives.
    files: 'warn',
    // Same rationale: deps imported only inside .vue script blocks look unused.
    dependencies: 'warn',
    devDependencies: 'warn',
    // Same rationale plus stale .js artifacts (tsc emit) littering src/ that
    // re-export everything by mirror of their .ts sibling.
    exports: 'warn',
    nsExports: 'warn',
    types: 'warn',
    nsTypes: 'warn',
    // enumMembers: "off",
  },
};

export default config;

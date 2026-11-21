import type { KnipConfig } from 'knip';

const config: KnipConfig = {
  entry: [
    'src/app.ts',
    // Test files as entry points so exports used only in tests are not flagged
    'src/**/*.e2e.ts',
    'src/**/*.unit.ts',
    'src/tests/**',
    // jest config files
    'jest.config.*.ts',
    // Loaded by sequelize-cli, not imported: entries rather than ignores so their own
    // imports (src/migrations/utils) still get dead-code checked
    'src/migrations/*.ts',
    // Reached only through a test file's `@jest-environment` docblock
    'src/services/budget-plans/periods/new-york-timezone-environment.ts',
  ],
  ignoreBinaries: ['knip', 'ts-node', 'nodemon', 'cross-env', 'sequelize-cli', 'jest', 'oxlint', 'tsc', 'vite'],
  ignore: [
    'config/**',
    'src/migrations/*.js',
    // Barrel file re-exporting 3rd-party API types - @public is set on source files
    'src/services/bank-data-providers/enablebanking/types/index.ts',
  ],
  ignoreDependencies: [
    // CLI tool, invoked via npx not imported
    'sequelize-cli',
    // Used in npm scripts, not via imports
    'cross-env',
    'jest',
    'nodemon',
    // Sub-packages bundled with their parent; available at runtime without being listed
    '@jest/globals', // bundled with jest
    'umzug', // bundled with sequelize-cli
    // A test's `@jest-environment <rootDir>/...` docblock, read as a package name
    'vitest-environment-<rootDir>',
  ],
  rules: {
    duplicates: 'off',
  },
};

export default config;

import { afterEach, beforeEach } from '@jest/globals';
import { mkdtempSync, existsSync, readFileSync, rmSync, writeFileSync } from 'fs';
import os from 'os';
import path from 'path';

export const FAKE_CLAUDE_PATH = path.join(__dirname, '../fixtures/ai-cli/fake-claude.mjs');
export const FAKE_CODEX_PATH = path.join(__dirname, '../fixtures/ai-cli/fake-codex.mjs');

const MANAGED_ENV_VARS = [
  'AI_CLI_CLAUDE_PATH',
  'AI_CLI_CODEX_PATH',
  'MM_FAKE_CLI_STATE_DIR',
  'MM_FAKE_CLI_SCENARIO',
  'MM_FAKE_CLI_RESPONSE_FILE',
] as const;

export type FakeCliResponse = { text: string } | { structuredOutput: unknown } | { scenario: string };

export interface FakeCliRun {
  bin: 'claude' | 'codex';
  argv: string[];
  stdin: string;
  cwd: string;
  envKeys: string[];
  [extra: string]: unknown;
}

/**
 * Points both CLI paths at the fake binaries for every test in the file, with a fresh
 * `MM_FAKE_CLI_STATE_DIR` per test, and restores the environment afterwards. The fakes record each
 * invocation (argv, stdin, env names) in that directory.
 */
export function useFakeAiClis() {
  const saved: Partial<Record<(typeof MANAGED_ENV_VARS)[number], string | undefined>> = {};
  let stateDir = '';

  beforeEach(() => {
    for (const name of MANAGED_ENV_VARS) saved[name] = process.env[name];

    stateDir = mkdtempSync(path.join(os.tmpdir(), 'mm-fake-cli-state-'));
    process.env.AI_CLI_CLAUDE_PATH = FAKE_CLAUDE_PATH;
    process.env.AI_CLI_CODEX_PATH = FAKE_CODEX_PATH;
    process.env.MM_FAKE_CLI_STATE_DIR = stateDir;
    delete process.env.MM_FAKE_CLI_SCENARIO;
    delete process.env.MM_FAKE_CLI_RESPONSE_FILE;
  });

  afterEach(() => {
    for (const name of MANAGED_ENV_VARS) {
      if (saved[name] === undefined) {
        delete process.env[name];
      } else {
        process.env[name] = saved[name];
      }
    }

    rmSync(stateDir, { recursive: true, force: true });
  });

  const readRuns = (): FakeCliRun[] => {
    const file = path.join(stateDir, 'runs.jsonl');

    if (!existsSync(file)) return [];

    return readFileSync(file, 'utf8')
      .split('\n')
      .filter(Boolean)
      .map((line) => JSON.parse(line));
  };

  return {
    /** Every fake CLI invocation of the current test, in order. */
    readRuns,
    /** The Nth recorded invocation; throws when the CLI was not run that many times. */
    getRun: ({ index = 0 }: { index?: number } = {}): FakeCliRun => {
      const run = readRuns()[index];

      if (!run) throw new Error(`The fake CLI was not run ${index + 1} time(s)`);

      return run;
    },
    /** True when a fake got past the point where the adapter should have killed it. */
    didRunComplete: () => existsSync(path.join(stateDir, 'run-completed')),
    setScenario: ({ scenario }: { scenario: string }) => {
      process.env.MM_FAKE_CLI_SCENARIO = scenario;
    },
    /** The Nth run answers with the Nth entry; the last entry repeats. */
    setResponses: ({ responses }: { responses: FakeCliResponse[] }) => {
      const file = path.join(stateDir, 'responses.json');

      writeFileSync(file, JSON.stringify({ responses }));
      process.env.MM_FAKE_CLI_RESPONSE_FILE = file;
    },
    getStateDir: () => stateDir,
  };
}

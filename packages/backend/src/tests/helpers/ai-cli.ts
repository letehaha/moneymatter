import { afterEach, beforeEach } from '@jest/globals';
import { mkdtempSync, existsSync, readFileSync, rmSync, writeFileSync } from 'fs';
import os from 'os';
import path from 'path';

import { formatCategorizationLines } from '../mocks/anthropic/mock-api';

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
  pid: number;
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

    // A fake CLI killed at the end of a test may still be writing into the directory; retry on ENOTEMPTY.
    rmSync(stateDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
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
    /**
     * Resolves once the fake CLI has recorded its Nth invocation, i.e. the child is up and running.
     * Polls instead of sleeping, so a loaded machine only makes it slower, not flaky.
     */
    waitForRun: async ({ index = 0, timeoutMs = 10_000 }: { index?: number; timeoutMs?: number } = {}) => {
      const deadline = Date.now() + timeoutMs;

      while (readRuns().length <= index) {
        if (Date.now() > deadline) throw new Error(`The fake CLI did not start run ${index + 1} in ${timeoutMs}ms`);

        await new Promise((resolve) => setTimeout(resolve, 10));
      }
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

/** Switches the current test's fake CLI runs to a failure mode; `useFakeAiClis` clears it after the test. */
export function useFakeCliScenario({ scenario }: { scenario: string }) {
  process.env.MM_FAKE_CLI_SCENARIO = scenario;
}

/**
 * The Nth fake CLI run of the current test answers with the Nth entry (the last entry repeats). Needs
 * `useFakeAiClis` in the file: the response file lives in its per-test state directory, which is removed
 * after the test.
 */
export function useFakeCliResponses({ responses }: { responses: FakeCliResponse[] }) {
  const stateDir = process.env.MM_FAKE_CLI_STATE_DIR;

  if (!stateDir) throw new Error('useFakeCliResponses needs useFakeAiClis() in the test file');

  const file = path.join(stateDir, 'responses.json');

  writeFileSync(file, JSON.stringify({ responses }));
  process.env.MM_FAKE_CLI_RESPONSE_FILE = file;
}

/** A categorization answer in the same "t<n>:c<n>" lines the Anthropic mock produces. */
export function fakeCategorizationAnswer({
  categorizations,
}: {
  categorizations: Record<number, number>;
}): FakeCliResponse {
  return { text: formatCategorizationLines({ categorizations }) || '# No categorizations' };
}

export interface FakeStatementTransaction {
  /** `YYYY-MM-DD` or `YYYY-MM-DD HH:MM:SS` */
  date: string;
  description: string;
  merchant?: string;
  amount: number;
  type: 'income' | 'expense';
  balance?: number;
}

const toCsvField = ({ value }: { value: string | number | undefined }) => {
  const text = value === undefined ? '' : String(value);

  return /[",\n]/.test(text) ? `"${text.replaceAll('"', '')}"` : text;
};

/**
 * A statement-parser answer: the parser asks the model for CSV, a metadata line first, then one row per
 * transaction (date, description, merchant, amount, E/I, balance, confidence).
 */
export function fakeStatementAnswer({
  transactions,
  bankName = 'Fake Bank',
  accountNumberLast4 = '1234',
  currencyCode = 'USD',
}: {
  transactions: FakeStatementTransaction[];
  bankName?: string;
  accountNumberLast4?: string;
  currencyCode?: string;
}): FakeCliResponse {
  const metadata = [bankName, accountNumberLast4, '', '', currencyCode].map((value) => toCsvField({ value }));
  const rows = transactions.map((tx) =>
    [tx.date, tx.description, tx.merchant, tx.amount, tx.type === 'income' ? 'I' : 'E', tx.balance, 95]
      .map((value) => toCsvField({ value }))
      .join(','),
  );

  return { text: [metadata.join(','), ...rows].join('\n') };
}

/** An invoice-extraction answer that passes `invoiceSchema` (non-empty vendor, positive total, real ISO date). */
export function fakeInvoiceAnswer({
  vendorName = 'Fake Vendor Ltd',
  customerName = null,
  totalAmount = 120.5,
  currencyCode = 'USD',
  issueDate = '2026-01-15',
  invoiceNumber = 'INV-001',
  invoiceUrl = null,
}: {
  vendorName?: string;
  customerName?: string | null;
  totalAmount?: number;
  currencyCode?: string;
  issueDate?: string;
  invoiceNumber?: string | null;
  invoiceUrl?: string | null;
} = {}): FakeCliResponse {
  return {
    structuredOutput: {
      isInvoice: true,
      vendorName,
      customerName,
      totalAmount,
      currencyCode,
      issueDate,
      invoiceNumber,
      invoiceUrl,
    },
  };
}

import { AICliProvider, AI_PROVIDER, CATEGORIZATION_SOURCE, type RecordId } from '@bt/shared/types';
import { afterEach, beforeEach, describe, expect, it } from '@jest/globals';
import { resetCliAuthSessions } from '@services/ai/cli/login/cli-auth-sessions';
import { RateLimitService } from '@services/common/rate-limit.service';
import { PNG_1X1_BASE64 } from '@tests/fixtures/statement-parser-fixtures';
import * as helpers from '@tests/helpers';
import {
  fakeCategorizationAnswer,
  fakeInvoiceAnswer,
  fakeStatementAnswer,
  useFakeAiClis,
  useFakeCliResponses,
  useFakeCliScenario,
} from '@tests/helpers/ai-cli';
import { useSelfHostWithoutServerAiKeys } from '@tests/helpers/ai-test-env';
import { errorMessage, getTestUserId, readStoredConnections } from '@tests/helpers/user-settings';
import fs from 'node:fs';
import path from 'node:path';

const CLAUDE = AI_PROVIDER.claudeCode;
const CODEX = AI_PROVIDER.codex;

const DEFAULT_MODEL: Record<AICliProvider, string> = {
  [CLAUDE]: 'sonnet',
  [CODEX]: 'gpt-6-astra',
};

const TEXT_INVOICE_PDF = fs.readFileSync(
  path.resolve(__dirname, '../../tests/fixtures/invoice-matching/text-invoice.pdf'),
);

const STATEMENT_CSV = ['date;description;amount', '2026-06-01;Grocery store;-42.10', '2026-06-02;Salary;2500.00'].join(
  '\n',
);
const STATEMENT_FILE_BASE64 = Buffer.from(STATEMENT_CSV, 'utf-8').toString('base64');

const TEMPORARY_COPY = /temporarily unavailable/i;
const RUN_SETTLE_TIMEOUT_MS = 15_000;
const TEST_TIMEOUT_MS = 60_000;

async function signIn({ provider }: { provider: AICliProvider }): Promise<string> {
  const { id } = await helpers.startCliAuthSession({ provider, raw: true });

  if (provider === CLAUDE) await helpers.submitCliAuthCode({ id, code: 'good-code' });

  await helpers.waitForCliAuthSession({ id, status: 'succeeded' });

  return id;
}

async function createSignedInConnection({ provider, model }: { provider: AICliProvider; model?: string }) {
  const cliAuthSessionId = await signIn({ provider });
  const response = await helpers.createAiConnection({
    provider,
    name: provider === CLAUDE ? 'Claude subscription' : 'ChatGPT subscription',
    model: model ?? DEFAULT_MODEL[provider],
    cliAuthSessionId,
  });

  expect(response.statusCode).toBe(201);

  return response.body.response;
}

async function readStoredConnection({ connectionId }: { connectionId: string }) {
  const stored = (await readStoredConnections({ userId: await getTestUserId() })).find(
    (connection) => connection.id === connectionId,
  );

  if (!stored) throw new Error(`Connection ${connectionId} is not stored`);

  return stored;
}

async function seedUncategorizedTransaction(): Promise<RecordId> {
  const user = await helpers.getUserInfo({ raw: true });
  const account = await helpers.createAccount({ raw: true });
  const [transaction] = await helpers.createTransaction({
    payload: helpers.buildTransactionPayload({
      accountId: account.id,
      categoryId: user.defaultCategoryId as RecordId,
      amount: 100,
      note: 'Coffee shop',
    }),
    raw: true,
  });

  return transaction.id;
}

async function triggerCategorization() {
  const response = await helpers.triggerAiCategorization();

  expect(response.statusCode).toBe(200);
  expect(response.body.response.enqueued).toBe(true);
}

/** A run that finishes cleanly leaves no terminal record, so the status just settles back to idle. */
async function runCategorization() {
  await triggerCategorization();

  await helpers.waitForCategorizationStatus({
    predicate: (status) => status.status === 'idle',
    timeoutMs: RUN_SETTLE_TIMEOUT_MS,
  });
}

/** A stopped run still completes, and its cause is served exactly once: the poll that sees it keeps it. */
async function runStoppedCategorization(): Promise<string | undefined> {
  await triggerCategorization();

  const status = await helpers.waitForCategorizationStatus({
    predicate: (candidate) => candidate.status === 'completed' && Boolean(candidate.errorMessage),
    timeoutMs: RUN_SETTLE_TIMEOUT_MS,
  });

  return status.status === 'idle' ? undefined : status.errorMessage;
}

describe('AI features on subscription CLI connections', () => {
  useSelfHostWithoutServerAiKeys();
  const fakes = useFakeAiClis();

  beforeEach(async () => {
    // Sign-ins and probes share one per-minute budget that this file spends quickly.
    await RateLimitService.resetRateLimit(`ai-connection-probe:user:${await getTestUserId()}`);
  });

  afterEach(() => {
    resetCliAuthSessions();
    delete process.env.AI_CLI_RUN_TIMEOUT_MS;
  });

  describe('successful runs', () => {
    it(
      'categorizes transactions on a Claude Code connection',
      async () => {
        await createSignedInConnection({ provider: CLAUDE });
        const transactionId = await seedUncategorizedTransaction();

        useFakeCliResponses({ responses: [fakeCategorizationAnswer({ categorizations: { 1: 1 } })] });

        await runCategorization();

        const [transaction] = await helpers.getTransactionsByIds({ ids: [transactionId], raw: true });

        expect(transaction!.categorizationMeta?.source).toBe(CATEGORIZATION_SOURCE.ai);
      },
      TEST_TIMEOUT_MS,
    );

    it('reads an image statement on a Codex connection and hands the image to the CLI', async () => {
      await createSignedInConnection({ provider: CODEX });

      useFakeCliResponses({
        responses: [
          fakeStatementAnswer({
            transactions: [
              {
                date: '2026-06-01',
                description: 'LIDL STOCKHOLM',
                merchant: 'LIDL STOCKHOLM',
                amount: 42.1,
                type: 'expense',
              },
              { date: '2026-06-02', description: 'Salary', amount: 2500, type: 'income' },
            ],
          }),
        ],
      });

      const result = await helpers.statementExtract({ payload: { fileBase64: PNG_1X1_BASE64 }, raw: true });

      expect(result.fileType).toBe('image');
      expect(result.transactions).toHaveLength(2);
      expect(result.transactions[0]).toMatchObject({ amount: 42.1, type: 'expense', merchant: 'LIDL STOCKHOLM' });
      expect(result.transactions[1]).toMatchObject({ amount: 2500, type: 'income' });

      const run = fakes.readRuns().findLast((entry) => entry.bin === 'codex' && entry.argv[0] === 'exec');

      expect(run?.argv).toContain('-i');
    });

    it('extracts the fields of a text PDF invoice on a Claude Code connection through the schema tool', async () => {
      await createSignedInConnection({ provider: CLAUDE });

      useFakeCliResponses({
        responses: [
          fakeInvoiceAnswer({
            vendorName: 'Acme Cloud Services',
            customerName: 'Northwind Studio',
            totalAmount: 123.45,
            currencyCode: global.BASE_CURRENCY_CODE,
            issueDate: '2026-06-10',
            invoiceNumber: 'INV-2026-0042',
          }),
        ],
      });

      const result = await helpers.matchInvoice({ file: TEXT_INVOICE_PDF });

      expect(result.statusCode).toBe(200);
      expect(result.response!.invoice).toMatchObject({
        vendorName: 'Acme Cloud Services',
        customerName: 'Northwind Studio',
        totalAmount: 123.45,
        issueDate: '2026-06-10',
        invoiceNumber: 'INV-2026-0042',
      });

      const run = fakes.readRuns().findLast((entry) => entry.bin === 'claude' && entry.argv.includes('--model'));

      expect(run?.argv).toContain('--json-schema');
      // The PDF went as its text: the CLI providers take images only.
      expect(run?.stdin).toContain('Acme Cloud Services billed to Northwind Studio');
      expect(run?.stdin).not.toContain('application/pdf');
    });

    it('sends an image invoice to a Codex connection as an attachment', async () => {
      await createSignedInConnection({ provider: CODEX });

      useFakeCliResponses({
        responses: [fakeInvoiceAnswer({ vendorName: 'Image Vendor', currencyCode: global.BASE_CURRENCY_CODE })],
      });

      const result = await helpers.matchInvoice({ file: Buffer.from(PNG_1X1_BASE64, 'base64') });

      expect(result.errorMessage).toBeNull();
      expect(result.statusCode).toBe(200);
      expect(result.response!.invoice.vendorName).toBe('Image Vendor');
      expect(fakes.readRuns().findLast((entry) => entry.bin === 'codex' && entry.argv[0] === 'exec')?.argv).toContain(
        '-i',
      );
    });
  });

  describe('failing runs', () => {
    it('fails closed on a tool call in a schema run: temporary message, nothing stored', async () => {
      const connection = await createSignedInConnection({ provider: CLAUDE });

      useFakeCliResponses({ responses: [fakeInvoiceAnswer()] });
      useFakeCliScenario({ scenario: 'tool-call-with-schema' });

      const result = await helpers.matchInvoice({ file: TEXT_INVOICE_PDF });

      expect(result.statusCode).not.toBe(200);
      expect(result.response).toBeNull();
      expect(result.errorMessage).toMatch(TEMPORARY_COPY);
      expect(fakes.didRunComplete()).toBe(false);
      expect((await readStoredConnection({ connectionId: connection.id })).status).toBe('valid');
    });

    it('fails closed on a tool call: temporary message, connection stays valid, no answer stored', async () => {
      const connection = await createSignedInConnection({ provider: CLAUDE });
      const transactionId = await seedUncategorizedTransaction();

      useFakeCliResponses({ responses: [fakeCategorizationAnswer({ categorizations: { 1: 1 } })] });
      useFakeCliScenario({ scenario: 'tool-call' });

      expect(await runStoppedCategorization()).toMatch(TEMPORARY_COPY);
      expect(fakes.didRunComplete()).toBe(false);

      const [transaction] = await helpers.getTransactionsByIds({ ids: [transactionId], raw: true });

      expect(transaction!.categorizationMeta?.source).not.toBe(CATEGORIZATION_SOURCE.ai);
      expect((await readStoredConnection({ connectionId: connection.id })).status).toBe('valid');
    });

    it('fails closed on a Codex tool item: temporary message, connection stays valid', async () => {
      const connection = await createSignedInConnection({ provider: CODEX });

      useFakeCliScenario({ scenario: 'tool-call' });

      const response = await helpers.statementExtract({ payload: { fileBase64: STATEMENT_FILE_BASE64 } });

      expect(errorMessage({ response })).toMatch(TEMPORARY_COPY);
      expect((await readStoredConnection({ connectionId: connection.id })).status).toBe('valid');
    });

    it('names the subscription limit and its reset time, and keeps the connection valid', async () => {
      const connection = await createSignedInConnection({ provider: CLAUDE, model: 'fake-rate-limit' });

      const response = await helpers.statementExtract({ payload: { fileBase64: STATEMENT_FILE_BASE64 } });

      expect(errorMessage({ response })).toBe(
        'Your Claude Code subscription usage limit is reached. It resets at 2030-01-01 00:00 UTC.',
      );
      expect((await readStoredConnection({ connectionId: connection.id })).status).toBe('valid');
    });

    it(
      'stops a categorization run on the subscription limit with the same copy',
      async () => {
        const connection = await createSignedInConnection({ provider: CLAUDE, model: 'fake-rate-limit' });

        await seedUncategorizedTransaction();

        expect(await runStoppedCategorization()).toBe(
          'Your Claude Code subscription usage limit is reached. It resets at 2030-01-01 00:00 UTC.',
        );
        expect((await readStoredConnection({ connectionId: connection.id })).status).toBe('valid');
      },
      TEST_TIMEOUT_MS,
    );

    it('flags the connection with the sign-in-again copy when the CLI rejects the credential', async () => {
      const connection = await createSignedInConnection({ provider: CLAUDE });

      useFakeCliScenario({ scenario: 'auth' });

      const response = await helpers.statementExtract({ payload: { fileBase64: STATEMENT_FILE_BASE64 } });

      expect(errorMessage({ response })).toContain('Sign in again in Settings → AI');

      const stored = await readStoredConnection({ connectionId: connection.id });

      expect(stored.status).toBe('invalid');
      expect(stored.lastError).toContain('Sign in again in Settings → AI');
    });

    it(
      'flags a connection whose CLI went missing with the not-installed copy',
      async () => {
        const claude = await createSignedInConnection({ provider: CLAUDE });

        await seedUncategorizedTransaction();

        process.env.AI_CLI_CLAUDE_PATH = '/nonexistent/claude';

        expect(await runStoppedCategorization()).toContain('The Claude Code CLI is not installed in the backend image');

        const stored = await readStoredConnection({ connectionId: claude.id });

        expect(stored.status).toBe('invalid');
        expect(stored.lastError).toContain('The Claude Code CLI is not installed in the backend image');
      },
      TEST_TIMEOUT_MS,
    );

    it('flags a Codex connection whose CLI went missing during a statement import', async () => {
      const codex = await createSignedInConnection({ provider: CODEX });

      process.env.AI_CLI_CODEX_PATH = '/nonexistent/codex';

      const response = await helpers.statementExtract({ payload: { fileBase64: PNG_1X1_BASE64 } });

      expect(errorMessage({ response })).toContain('The Codex CLI is not installed in the backend image');
      expect((await readStoredConnection({ connectionId: codex.id })).status).toBe('invalid');
    });

    it(
      'keeps a connection valid and reports a temporary failure when a run times out',
      async () => {
        const connection = await createSignedInConnection({ provider: CLAUDE });

        process.env.AI_CLI_RUN_TIMEOUT_MS = '1500';
        useFakeCliScenario({ scenario: 'hang' });

        const response = await helpers.statementExtract({ payload: { fileBase64: STATEMENT_FILE_BASE64 } });

        expect(errorMessage({ response })).toMatch(TEMPORARY_COPY);
        expect((await readStoredConnection({ connectionId: connection.id })).status).toBe('valid');
      },
      TEST_TIMEOUT_MS,
    );
  });
});

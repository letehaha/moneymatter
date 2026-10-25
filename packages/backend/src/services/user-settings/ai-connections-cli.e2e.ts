import {
  AICliProvider,
  AI_PROVIDER,
  CATEGORIZATION_SOURCE,
  CLI_AI_MODELS,
  CreateAIConnectionBody,
  type RecordId,
} from '@bt/shared/types';
import { decryptToken } from '@common/utils/encryption';
import { afterEach, beforeEach, describe, expect, it } from '@jest/globals';
import { ERROR_CODES } from '@js/errors';
import { resetCliAuthSessions } from '@services/ai/cli/login/cli-auth-sessions';
import { RateLimitService } from '@services/common/rate-limit.service';
import * as helpers from '@tests/helpers';
import {
  fakeCategorizationAnswer,
  useFakeAiClis,
  useFakeCliResponses,
  useFakeCliScenario,
} from '@tests/helpers/ai-cli';
import { useSelfHostWithoutServerAiKeys } from '@tests/helpers/ai-test-env';
import { sleep } from '@tests/helpers/common';
import { asUser, signUpSecondUser } from '@tests/helpers/share';
import {
  createOpenAiConnection,
  errorMessage,
  getTestUserId,
  patchStoredConnection,
  readStoredConnections,
} from '@tests/helpers/user-settings';

const CLAUDE = AI_PROVIDER.claudeCode;
const CODEX = AI_PROVIDER.codex;

const DEFAULT_MODEL: Record<AICliProvider, string> = {
  [CLAUDE]: 'sonnet',
  [CODEX]: 'gpt-6-astra',
};

const DAY_MS = 24 * 60 * 60 * 1000;
const RUN_SETTLE_TIMEOUT_MS = 15_000;
const TEST_TIMEOUT_MS = 60_000;

/** Claude asks for a code on the sign-in page; Codex finishes on its own once the device code is approved. */
async function signIn({ provider }: { provider: AICliProvider }): Promise<string> {
  const { id } = await helpers.startCliAuthSession({ provider, raw: true });

  if (provider === CLAUDE) await helpers.submitCliAuthCode({ id, code: 'good-code' });

  await helpers.waitForCliAuthSession({ id, status: 'succeeded' });

  return id;
}

function createCliConnection({
  provider,
  cliAuthSessionId,
  name = provider === CLAUDE ? 'Claude subscription' : 'ChatGPT subscription',
  model = DEFAULT_MODEL[provider],
  ...rest
}: { provider: AICliProvider; name?: string; model?: string } & Partial<CreateAIConnectionBody>) {
  return helpers.createAiConnection({ provider, name, model, cliAuthSessionId, ...rest });
}

async function createSignedInConnection({ provider, model }: { provider: AICliProvider; model?: string }) {
  const cliAuthSessionId = await signIn({ provider });

  const response = await createCliConnection({ provider, cliAuthSessionId, model });

  expect(response.statusCode).toBe(201);

  return response.body.response;
}

async function readStoredCredential({ connectionId }: { connectionId: string }) {
  const stored = (await readStoredConnections({ userId: await getTestUserId() })).find(
    (connection) => connection.id === connectionId,
  );

  return { keyEncrypted: stored?.keyEncrypted, status: stored?.status, stored };
}

/** The credential a stored connection holds right now, decrypted for the assertion only. */
async function readDecryptedCredential({ connectionId }: { connectionId: string }) {
  const { keyEncrypted } = await readStoredCredential({ connectionId });

  return decryptToken(keyEncrypted!);
}

async function waitForStoredRefreshToken({
  connectionId,
  refreshToken,
  timeoutMs = 5_000,
}: {
  connectionId: string;
  refreshToken: string;
  timeoutMs?: number;
}): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  let current = '';

  while (Date.now() < deadline) {
    current = JSON.parse(await readDecryptedCredential({ connectionId })).tokens.refresh_token;

    if (current === refreshToken) return;

    await sleep(100);
  }

  throw new Error(`Stored refresh token is ${current}, expected ${refreshToken}`);
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

async function runCategorization() {
  const response = await helpers.triggerAiCategorization();

  expect(response.statusCode).toBe(200);
  expect(response.body.response.enqueued).toBe(true);

  await helpers.waitForCategorizationStatus({
    predicate: (status) => status.status === 'idle',
    timeoutMs: RUN_SETTLE_TIMEOUT_MS,
  });
}

describe('Subscription CLI connections', () => {
  useSelfHostWithoutServerAiKeys();
  const fakes = useFakeAiClis();

  let adminUsersBeforeTest: string | undefined;

  beforeEach(async () => {
    adminUsersBeforeTest = process.env.ADMIN_USERS;
    // Sign-ins and probes share one per-minute budget that this file spends quickly.
    await RateLimitService.resetRateLimit(`ai-connection-probe:user:${await getTestUserId()}`);
  });

  afterEach(() => {
    resetCliAuthSessions();

    if (adminUsersBeforeTest === undefined) {
      delete process.env.ADMIN_USERS;
    } else {
      process.env.ADMIN_USERS = adminUsersBeforeTest;
    }
  });

  describe('create', () => {
    it('starts with no connections', async () => {
      expect(await helpers.getAiConnections({ raw: true })).toEqual([]);
    });

    it('stores a Claude Code connection from a signed-in session and reports the token expiry', async () => {
      const cliAuthSessionId = await signIn({ provider: CLAUDE });

      const response = await createCliConnection({ provider: CLAUDE, cliAuthSessionId });

      expect(response.statusCode).toBe(201);

      const connection = response.body.response;
      const expiresInMs = new Date(connection.credentialExpiresAt!).getTime() - Date.now();

      expect(connection).toMatchObject({
        provider: CLAUDE,
        model: 'sonnet',
        hasApiKey: true,
        status: 'valid',
      });
      expect(expiresInMs).toBeGreaterThan(364 * DAY_MS);
      expect(expiresInMs).toBeLessThanOrEqual(366 * DAY_MS);
      expect(JSON.stringify(response.body)).not.toMatch(/keyEncrypted|sk-ant-oat/);
      expect(JSON.stringify(await helpers.getAiConnections({ raw: true }))).not.toMatch(/keyEncrypted|sk-ant-oat/);

      const { keyEncrypted, stored } = await readStoredCredential({ connectionId: connection.id });

      expect(keyEncrypted).toBeTruthy();
      expect(keyEncrypted).not.toContain('sk-ant-oat');
      expect(stored?.credentialExpiresAt).toBe(connection.credentialExpiresAt);
      expect(fakes.readRuns().find((run) => run.argv.includes('--model'))?.argv).toContain('sonnet');

      // The session is spent by the save.
      expect((await helpers.getCliAuthSession({ id: cliAuthSessionId })).statusCode).toBe(404);
    });

    it('stores a Codex connection from a signed-in session, without an expiry', async () => {
      const cliAuthSessionId = await signIn({ provider: CODEX });

      const response = await createCliConnection({ provider: CODEX, cliAuthSessionId });

      expect(response.statusCode).toBe(201);
      expect(response.body.response).toMatchObject({ provider: CODEX, model: 'gpt-6-astra', hasApiKey: true });
      expect(response.body.response.credentialExpiresAt).toBeUndefined();
      expect(JSON.stringify(response.body)).not.toMatch(/keyEncrypted|refresh_token/);

      const credential = await readDecryptedCredential({ connectionId: response.body.response.id });

      expect(JSON.parse(credential).tokens.refresh_token).toBe('rt-fake-initial');
    });

    it('lets the same sign-in be tested and then saved, and refuses a second save with it', async () => {
      const cliAuthSessionId = await signIn({ provider: CLAUDE });

      const test = await helpers.testAiConnection({ provider: CLAUDE, model: 'sonnet', cliAuthSessionId });

      expect(test.statusCode).toBe(200);
      expect(test.body.response).toEqual({ isValid: true });

      const created = await createCliConnection({ provider: CLAUDE, cliAuthSessionId });

      expect(created.statusCode).toBe(201);

      const again = await createCliConnection({ provider: CLAUDE, cliAuthSessionId, name: 'Second try' });

      expect(again.statusCode).toBe(ERROR_CODES.ValidationError);
      expect(await helpers.getAiConnections({ raw: true })).toHaveLength(1);
    });

    it('keeps the sign-in usable after a failed probe, so a retry can succeed', async () => {
      const cliAuthSessionId = await signIn({ provider: CLAUDE });

      useFakeCliScenario({ scenario: 'auth' });

      const rejected = await createCliConnection({ provider: CLAUDE, cliAuthSessionId });

      expect(rejected.statusCode).toBe(ERROR_CODES.ValidationError);
      expect(errorMessage({ response: rejected })).toContain('rejected the sign-in');
      expect(await helpers.getAiConnections({ raw: true })).toEqual([]);
      expect((await helpers.getCliAuthSession({ id: cliAuthSessionId, raw: true })).status).toBe('succeeded');

      delete process.env.MM_FAKE_CLI_SCENARIO;

      const retried = await createCliConnection({ provider: CLAUDE, cliAuthSessionId });

      expect(retried.statusCode).toBe(201);
    });

    it.each([
      ['a subscription limit', 'fake-rate-limit', undefined],
      ['an overloaded service', undefined, 'overloaded'],
    ])('still saves the connection when the probe hits %s', async (_label, model, scenario) => {
      const cliAuthSessionId = await signIn({ provider: CLAUDE });

      if (scenario) useFakeCliScenario({ scenario });

      const response = await createCliConnection({ provider: CLAUDE, cliAuthSessionId, model });

      expect(response.statusCode).toBe(201);
      expect(response.body.response.status).toBe('valid');
    });

    it.each([
      ['auth', 'rejected the sign-in'],
      ['model-not-found', 'on this subscription'],
      ['exit-1', 'something broke'],
      ['tool-call', 'tried to use a tool'],
    ])('refuses to save when the probe fails with the %s scenario', async (scenario, expectedText) => {
      const cliAuthSessionId = await signIn({ provider: CLAUDE });

      useFakeCliScenario({ scenario });

      const response = await createCliConnection({ provider: CLAUDE, cliAuthSessionId });

      expect(response.statusCode).toBe(ERROR_CODES.ValidationError);
      expect(errorMessage({ response })).toContain(expectedText);
      expect(await helpers.getAiConnections({ raw: true })).toEqual([]);
    });

    it('still saves and runs a connection stored with a pinned Claude id from before the alias list', async () => {
      const cliAuthSessionId = await signIn({ provider: CLAUDE });

      const response = await createCliConnection({ provider: CLAUDE, cliAuthSessionId, model: 'claude-sonnet-5-5' });

      expect(response.statusCode).toBe(201);
      expect(response.body.response).toMatchObject({ model: 'claude-sonnet-5-5', status: 'valid' });
      expect(fakes.readRuns().find((run) => run.argv.includes('--model'))?.argv).toContain('claude-sonnet-5-5');
    });

    it('lists the curated models for each CLI provider without a sign-in', async () => {
      for (const provider of [CLAUDE, CODEX] as const) {
        const { models } = await helpers.listAiConnectionModels({ provider, raw: true });

        expect(models).toEqual(CLI_AI_MODELS[provider].map((model) => model.id));
        expect(new Set(models).size).toBe(models.length);
      }

      expect(fakes.readRuns()).toEqual([]);
    });

    describe('refused requests', () => {
      it('needs a sign-in session', async () => {
        const response = await createCliConnection({ provider: CLAUDE });

        expect(response.statusCode).toBe(ERROR_CODES.ValidationError);
      });

      it('refuses an unknown session id', async () => {
        const response = await createCliConnection({
          provider: CLAUDE,
          cliAuthSessionId: '7b7cbb84-9bc0-4cb4-8f2b-0a0d5a1ab3f1',
        });

        expect(response.statusCode).toBe(ERROR_CODES.ValidationError);
      });

      it('refuses a session of another provider', async () => {
        const cliAuthSessionId = await signIn({ provider: CLAUDE });

        const response = await createCliConnection({ provider: CODEX, cliAuthSessionId });

        expect(response.statusCode).toBe(ERROR_CODES.ValidationError);
        expect((await helpers.getCliAuthSession({ id: cliAuthSessionId, raw: true })).status).toBe('succeeded');
      });

      it('refuses a session that belongs to another user', async () => {
        const cliAuthSessionId = await signIn({ provider: CLAUDE });
        const other = await signUpSecondUser();
        const otherUsername = await asUser({
          cookies: other.cookies,
          fn: async () => (await helpers.getUserInfo({ raw: true })).username,
        });

        process.env.ADMIN_USERS = `${process.env.ADMIN_USERS},${otherUsername}`;

        const response = await asUser({
          cookies: other.cookies,
          fn: () => createCliConnection({ provider: CLAUDE, cliAuthSessionId }),
        });

        expect(response.statusCode).toBe(ERROR_CODES.ValidationError);
        expect((await helpers.getCliAuthSession({ id: cliAuthSessionId, raw: true })).status).toBe('succeeded');
      });

      it.each([
        ['an API key', { apiKey: 'sk-ant-api03-typed-by-hand' }],
        ['a key borrowed from another connection', { keyFromConnectionId: '7b7cbb84-9bc0-4cb4-8f2b-0a0d5a1ab3f1' }],
        ['a base URL', { baseUrl: 'https://llm.example.com/v1' }],
      ])('refuses %s on a CLI provider', async (_label, extra) => {
        const cliAuthSessionId = await signIn({ provider: CLAUDE });

        const response = await createCliConnection({ provider: CLAUDE, cliAuthSessionId, ...extra });

        expect(response.statusCode).toBe(ERROR_CODES.ValidationError);
        expect(await helpers.getAiConnections({ raw: true })).toEqual([]);
      });

      it('refuses a sign-in session on a native provider', async () => {
        const cliAuthSessionId = await signIn({ provider: CLAUDE });

        const response = await helpers.createAiConnection({
          provider: AI_PROVIDER.openai,
          name: 'GPT',
          model: 'gpt-5.6-terra',
          apiKey: 'sk-test',
          cliAuthSessionId,
        });

        expect(response.statusCode).toBe(ERROR_CODES.ValidationError);
      });

      it('refuses everyone outside ADMIN_USERS with the not-allowed status', async () => {
        const cliAuthSessionId = await signIn({ provider: CLAUDE });

        process.env.ADMIN_USERS = 'somebody-else';

        const created = await createCliConnection({ provider: CLAUDE, cliAuthSessionId });
        const tested = await helpers.testAiConnection({ provider: CLAUDE, model: 'sonnet', cliAuthSessionId });

        expect(created.statusCode).toBe(ERROR_CODES.NotAllowed);
        expect(tested.statusCode).toBe(ERROR_CODES.NotAllowed);
        expect(await helpers.getAiConnections({ raw: true })).toEqual([]);
      });

      it('refuses updating and testing a stored CLI connection once the user left ADMIN_USERS', async () => {
        const connection = await createSignedInConnection({ provider: CLAUDE });
        const before = await readStoredCredential({ connectionId: connection.id });

        process.env.ADMIN_USERS = 'somebody-else';

        const updated = await helpers.updateAiConnection({ id: connection.id, name: 'Renamed' });
        const tested = await helpers.testAiConnection({ connectionId: connection.id });

        expect(updated.statusCode).toBe(ERROR_CODES.NotAllowed);
        expect(tested.statusCode).toBe(ERROR_CODES.NotAllowed);
        expect((await readStoredCredential({ connectionId: connection.id })).keyEncrypted).toBe(before.keyEncrypted);
      });
    });
  });

  describe('update', () => {
    it('refuses an API key on a CLI connection', async () => {
      const connection = await createSignedInConnection({ provider: CLAUDE });

      const response = await helpers.updateAiConnection({ id: connection.id, apiKey: 'sk-ant-api03-typed-by-hand' });

      expect(response.statusCode).toBe(ERROR_CODES.ValidationError);
    });

    it('re-authenticates with a new sign-in: new credential, fresh expiry, valid again', async () => {
      const connection = await createSignedInConnection({ provider: CLAUDE });
      const before = await readStoredCredential({ connectionId: connection.id });

      await patchStoredConnection({
        connectionId: connection.id,
        patch: { status: 'invalid', lastError: 'rejected', invalidatedAt: new Date().toISOString() },
      });

      const cliAuthSessionId = await signIn({ provider: CLAUDE });
      const response = await helpers.updateAiConnection({ id: connection.id, cliAuthSessionId });

      expect(response.statusCode).toBe(200);
      expect(response.body.response.status).toBe('valid');
      expect(response.body.response.lastError).toBeUndefined();

      const after = await readStoredCredential({ connectionId: connection.id });

      expect(after.keyEncrypted).not.toBe(before.keyEncrypted);
      expect(after.status).toBe('valid');
      expect((await helpers.getCliAuthSession({ id: cliAuthSessionId })).statusCode).toBe(404);
    });

    it('refuses a re-authentication with a session of another provider and keeps the credential', async () => {
      const connection = await createSignedInConnection({ provider: CODEX });
      const before = await readStoredCredential({ connectionId: connection.id });
      const claudeSession = await signIn({ provider: CLAUDE });

      const response = await helpers.updateAiConnection({ id: connection.id, cliAuthSessionId: claudeSession });

      expect(response.statusCode).toBe(ERROR_CODES.ValidationError);
      expect((await readStoredCredential({ connectionId: connection.id })).keyEncrypted).toBe(before.keyEncrypted);
    });

    it('refuses a sign-in session on a native connection', async () => {
      const native = await createOpenAiConnection();
      const cliAuthSessionId = await signIn({ provider: CLAUDE });

      const response = await helpers.updateAiConnection({ id: native.id, cliAuthSessionId });

      expect(response.statusCode).toBe(ERROR_CODES.ValidationError);
    });

    it('keeps the credential the model-change probe refreshed instead of the one read before it', async () => {
      const connection = await createSignedInConnection({ provider: CODEX });
      const before = await readStoredCredential({ connectionId: connection.id });

      useFakeCliScenario({ scenario: 'refresh' });

      const response = await helpers.updateAiConnection({ id: connection.id, model: 'gpt-6-sol' });

      expect(response.statusCode).toBe(200);
      expect(response.body.response.model).toBe('gpt-6-sol');

      const after = await readStoredCredential({ connectionId: connection.id });

      expect(after.keyEncrypted).not.toBe(before.keyEncrypted);
      expect(JSON.parse(await readDecryptedCredential({ connectionId: connection.id })).tokens.refresh_token).toMatch(
        /^rt-refreshed-/,
      );
    });

    it('renames a CLI connection without probing it or touching the credential', async () => {
      const connection = await createSignedInConnection({ provider: CLAUDE });
      const before = await readStoredCredential({ connectionId: connection.id });
      const runsBefore = fakes.readRuns().length;

      const response = await helpers.updateAiConnection({ id: connection.id, name: 'Renamed' });

      expect(response.statusCode).toBe(200);
      expect(response.body.response.name).toBe('Renamed');
      expect(fakes.readRuns()).toHaveLength(runsBefore);
      expect((await readStoredCredential({ connectionId: connection.id })).keyEncrypted).toBe(before.keyEncrypted);
    });
  });

  describe('test', () => {
    it('refreshes the stored Codex credential when the probe makes the CLI rotate it', async () => {
      const connection = await createSignedInConnection({ provider: CODEX });
      const before = await readStoredCredential({ connectionId: connection.id });

      useFakeCliScenario({ scenario: 'refresh' });

      const response = await helpers.testAiConnection({ connectionId: connection.id });

      expect(response.body.response).toEqual({ isValid: true });

      const after = await readStoredCredential({ connectionId: connection.id });

      expect(after.keyEncrypted).not.toBe(before.keyEncrypted);
      expect(after.status).toBe('valid');
      expect(JSON.parse(await readDecryptedCredential({ connectionId: connection.id })).tokens.refresh_token).toMatch(
        /^rt-refreshed-/,
      );
    });

    it('records an invalid verdict on a stored Claude connection whose probe fails', async () => {
      const connection = await createSignedInConnection({ provider: CLAUDE });

      useFakeCliScenario({ scenario: 'exit-1' });

      const response = await helpers.testAiConnection({ connectionId: connection.id });

      expect(response.body.response.isValid).toBe(false);

      const { status, stored } = await readStoredCredential({ connectionId: connection.id });

      expect(status).toBe('invalid');
      expect(stored?.lastError).toContain('something broke');
    });

    it('does not record a verdict for a draft override of the stored connection', async () => {
      const connection = await createSignedInConnection({ provider: CLAUDE });

      useFakeCliScenario({ scenario: 'model-not-found' });

      const response = await helpers.testAiConnection({ connectionId: connection.id, model: 'opus' });

      expect(response.body.response.isValid).toBe(false);
      expect((await readStoredCredential({ connectionId: connection.id })).status).toBe('valid');
    });

    it('refuses an API key for a stored CLI connection', async () => {
      const connection = await createSignedInConnection({ provider: CLAUDE });

      const response = await helpers.testAiConnection({ connectionId: connection.id, apiKey: 'sk-ant-api03-x' });

      expect(response.statusCode).toBe(ERROR_CODES.ValidationError);
    });
  });

  describe('runs on a stored connection', () => {
    it(
      'persists the credential a run refreshed before it hit the subscription limit',
      async () => {
        const connection = await createSignedInConnection({ provider: CODEX });
        const before = await readStoredCredential({ connectionId: connection.id });
        const transactionId = await seedUncategorizedTransaction();

        useFakeCliResponses({ responses: [fakeCategorizationAnswer({ categorizations: { 1: 1 } })] });
        useFakeCliScenario({ scenario: 'refresh-then-limit' });

        await runCategorization();

        const [transaction] = await helpers.getTransactionsByIds({ ids: [transactionId], raw: true });

        expect(transaction!.categorizationMeta?.source).not.toBe(CATEGORIZATION_SOURCE.ai);

        const after = await readStoredCredential({ connectionId: connection.id });

        expect(after.keyEncrypted).not.toBe(before.keyEncrypted);
        expect(after.status).toBe('valid');
      },
      TEST_TIMEOUT_MS,
    );

    it(
      'starts every run from the credential the previous one saved when refresh tokens are single-use',
      async () => {
        const connection = await createSignedInConnection({ provider: CODEX });
        const execRunsBefore = fakes.readRuns().filter((run) => run.argv[0] === 'exec').length;

        useFakeCliResponses({ responses: [{ text: '# No categorizations' }] });
        useFakeCliScenario({ scenario: 'rotating' });

        const test = await helpers.testAiConnection({ connectionId: connection.id });

        expect(test.body.response).toEqual({ isValid: true });

        // A run that categorizes nothing leaves its transactions as attempted, so each run gets a fresh one.
        await seedUncategorizedTransaction();
        await runCategorization();
        await seedUncategorizedTransaction();
        await runCategorization();

        const execRuns = fakes.readRuns().filter((run) => run.argv[0] === 'exec');

        expect(execRuns).toHaveLength(execRunsBefore + 3);
        expect((await readStoredCredential({ connectionId: connection.id })).status).toBe('valid');

        // One rotation per run: the test probe and the two runs each presented the token the previous one saved.
        await expect(
          waitForStoredRefreshToken({ connectionId: connection.id, refreshToken: 'rt-rotated-3' }),
        ).resolves.toBeUndefined();
      },
      TEST_TIMEOUT_MS,
    );
  });

  describe('delete', () => {
    it('removes a Claude Code connection without running a logout', async () => {
      const connection = await createSignedInConnection({ provider: CLAUDE });
      const runsBefore = fakes.readRuns().length;

      const response = await helpers.deleteAiConnection({ id: connection.id });

      expect(response.statusCode).toBe(200);
      expect(await helpers.getAiConnections({ raw: true })).toEqual([]);
      expect(fakes.readRuns()).toHaveLength(runsBefore);
    });

    it('signs a Codex connection out first, then removes it', async () => {
      const connection = await createSignedInConnection({ provider: CODEX });

      const response = await helpers.deleteAiConnection({ id: connection.id });

      expect(response.statusCode).toBe(200);
      expect(await helpers.getAiConnections({ raw: true })).toEqual([]);
      expect(fakes.readRuns().filter((run) => run.mode === 'logout')).toHaveLength(1);
    });

    it('removes a Codex connection even when the logout fails', async () => {
      const connection = await createSignedInConnection({ provider: CODEX });

      useFakeCliScenario({ scenario: 'logout-fail' });

      const response = await helpers.deleteAiConnection({ id: connection.id });

      expect(response.statusCode).toBe(200);
      expect(await helpers.getAiConnections({ raw: true })).toEqual([]);
    });

    it('removes a Codex connection even when the CLI is gone', async () => {
      const connection = await createSignedInConnection({ provider: CODEX });

      process.env.AI_CLI_CODEX_PATH = '/nonexistent/codex';

      const response = await helpers.deleteAiConnection({ id: connection.id });

      expect(response.statusCode).toBe(200);
      expect(await helpers.getAiConnections({ raw: true })).toEqual([]);
    });
  });
});

import { AICliProvider, AI_PROVIDER } from '@bt/shared/types';
import { decryptToken } from '@common/utils/encryption';
import { afterEach, beforeEach, describe, expect, it } from '@jest/globals';
import { resetCliAuthSessions } from '@services/ai/cli/login/cli-auth-sessions';
import { RateLimitService } from '@services/common/rate-limit.service';
import * as helpers from '@tests/helpers';
import { useFakeAiClis, useFakeCliScenario } from '@tests/helpers/ai-cli';
import { useSelfHostWithoutServerAiKeys } from '@tests/helpers/ai-test-env';
import { sleep } from '@tests/helpers/common';
import { getTestUserId, readStoredConnections } from '@tests/helpers/user-settings';
import fs from 'node:fs';
import path from 'node:path';

const CLAUDE = AI_PROVIDER.claudeCode;
const CODEX = AI_PROVIDER.codex;

const DEFAULT_MODEL: Record<AICliProvider, string> = {
  [CLAUDE]: 'sonnet',
  [CODEX]: 'gpt-6-astra',
};

const TEST_TIMEOUT_MS = 60_000;
const SETTLE_TIMEOUT_MS = 8_000;

async function createSignedInConnection({ provider }: { provider: AICliProvider }) {
  const { id: cliAuthSessionId } = await helpers.startCliAuthSession({ provider, raw: true });

  if (provider === CLAUDE) await helpers.submitCliAuthCode({ id: cliAuthSessionId, code: 'good-code' });

  await helpers.waitForCliAuthSession({ id: cliAuthSessionId, status: 'succeeded' });

  const response = await helpers.createAiConnection({
    provider,
    name: provider === CLAUDE ? 'Claude subscription' : 'ChatGPT subscription',
    model: DEFAULT_MODEL[provider],
    cliAuthSessionId,
  });

  expect(response.statusCode).toBe(201);

  return response.body.response;
}

async function readStoredRefreshToken({ connectionId }: { connectionId: string }): Promise<string> {
  const stored = (await readStoredConnections({ userId: await getTestUserId() })).find(
    (connection) => connection.id === connectionId,
  );

  return JSON.parse(decryptToken(stored!.keyEncrypted!)).tokens.refresh_token;
}

const isProcessAlive = ({ pid }: { pid: number }) => {
  try {
    process.kill(pid, 0);

    return true;
  } catch {
    return false;
  }
};

/** Runs two probes of the connection at the same time; each fake CLI answers only once both are alive. */
async function probeTwiceAtOnce({ connectionId }: { connectionId: string }) {
  return Promise.all([helpers.testAiConnection({ connectionId }), helpers.testAiConnection({ connectionId })]);
}

describe('Parallel CLI runs on one connection', () => {
  useSelfHostWithoutServerAiKeys();
  const fakes = useFakeAiClis();

  beforeEach(async () => {
    // Sign-ins and probes share one per-minute budget that this file spends quickly.
    await RateLimitService.resetRateLimit(`ai-connection-probe:user:${await getTestUserId()}`);
  });

  afterEach(() => {
    resetCliAuthSessions();
  });

  it.each<AICliProvider>([CLAUDE, CODEX])(
    'lets two %s runs of one connection overlap and both succeed',
    async (provider) => {
      const connection = await createSignedInConnection({ provider });
      const runsBefore = fakes.readRuns().length;

      useFakeCliScenario({ scenario: 'parallel' });

      const responses = await probeTwiceAtOnce({ connectionId: connection.id });

      expect(responses.map((response) => response.body.response)).toEqual([{ isValid: true }, { isValid: true }]);
      expect(fakes.readRuns().slice(runsBefore)).toHaveLength(2);
    },
    TEST_TIMEOUT_MS,
  );

  it(
    'shares one CODEX_HOME between overlapping Codex runs, so a refresh by one is read by the other and persisted',
    async () => {
      const connection = await createSignedInConnection({ provider: CODEX });
      const runsBefore = fakes.readRuns().length;

      useFakeCliScenario({ scenario: 'peer-refresh' });

      const responses = await probeTwiceAtOnce({ connectionId: connection.id });

      expect(responses.map((response) => response.body.response)).toEqual([{ isValid: true }, { isValid: true }]);

      const [first, second] = fakes.readRuns().slice(runsBefore);

      expect(first!.codexHome).toBeTruthy();
      expect(first!.codexHome).toBe(second!.codexHome);

      const observed = fs
        .readdirSync(fakes.getStateDir())
        .filter((name) => name.startsWith('observed-'))
        .map((name) => JSON.parse(fs.readFileSync(path.join(fakes.getStateDir(), name), 'utf8')));

      expect(observed).toEqual([{ refreshToken: 'rt-shared-refreshed' }]);
      expect(await readStoredRefreshToken({ connectionId: connection.id })).toBe('rt-shared-refreshed');
      expect(fs.existsSync(first!.codexHome as string)).toBe(false);
    },
    TEST_TIMEOUT_MS,
  );

  describe('disconnecting while runs are active', () => {
    it.each<AICliProvider>([CLAUDE, CODEX])(
      'cancels the active %s run, kills its process and still removes the connection',
      async (provider) => {
        const connection = await createSignedInConnection({ provider });
        const runsBefore = fakes.readRuns().length;

        useFakeCliScenario({ scenario: 'hang' });

        const probe = helpers.testAiConnection({ connectionId: connection.id });

        await fakes.waitForRun({ index: runsBefore });

        const hungPid = fakes.getRun({ index: runsBefore }).pid;

        const deletion = await helpers.deleteAiConnection({ id: connection.id });

        expect(deletion.statusCode).toBe(200);
        expect(await helpers.getAiConnections({ raw: true })).toEqual([]);

        // The cancelled probe settles on its own instead of waiting out its 90 s timeout.
        const settled = await Promise.race([probe, sleep(SETTLE_TIMEOUT_MS).then(() => 'pending' as const)]);

        expect(settled).not.toBe('pending');

        const deadline = Date.now() + SETTLE_TIMEOUT_MS;

        while (isProcessAlive({ pid: hungPid }) && Date.now() < deadline) await sleep(50);

        expect(isProcessAlive({ pid: hungPid })).toBe(false);

        const logouts = fakes.readRuns().filter((run) => run.mode === 'logout');

        expect(logouts).toHaveLength(provider === CODEX ? 1 : 0);
      },
      TEST_TIMEOUT_MS,
    );
  });
});

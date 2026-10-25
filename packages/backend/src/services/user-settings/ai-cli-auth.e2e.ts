import { AI_PROVIDER } from '@bt/shared/types';
import { afterEach, beforeEach, describe, expect, it } from '@jest/globals';
import { ERROR_CODES } from '@js/errors';
import { resetCliAuthSessions } from '@services/ai/cli/login/cli-auth-sessions';
import * as helpers from '@tests/helpers';
import { useFakeAiClis, useFakeCliScenario } from '@tests/helpers/ai-cli';
import { runAsCloud, useSelfHostWithoutServerAiKeys } from '@tests/helpers/ai-test-env';
import { randomUUID } from 'node:crypto';

const CLAUDE_TOKEN_PREFIX = 'sk-ant-oat';

const callEveryAuthSessionRoute = async ({ id = randomUUID() }: { id?: string } = {}) => {
  return [
    await helpers.startCliAuthSession({ provider: AI_PROVIDER.claudeCode }),
    await helpers.getCliAuthSession({ id }),
    await helpers.submitCliAuthCode({ id, code: 'code' }),
    await helpers.cancelCliAuthSession({ id }),
  ];
};

describe('Subscription CLI sign-in endpoints', () => {
  useSelfHostWithoutServerAiKeys();
  useFakeAiClis();

  let adminUsersBeforeTest: string | undefined;

  beforeEach(() => {
    adminUsersBeforeTest = process.env.ADMIN_USERS;
  });

  afterEach(() => {
    resetCliAuthSessions();

    if (adminUsersBeforeTest === undefined) {
      delete process.env.ADMIN_USERS;
    } else {
      process.env.ADMIN_USERS = adminUsersBeforeTest;
    }
  });

  describe('GET /availability', () => {
    it('answers 200 with not-self-host on a cloud instance', async () => {
      runAsCloud();

      const response = await helpers.getCliAvailability();

      expect(response.statusCode).toBe(200);
      expect(response.body.response).toEqual({ available: false, reason: 'not-self-host', providers: [] });
    });

    it('answers 200 with not-admin for a self-host user outside ADMIN_USERS', async () => {
      process.env.ADMIN_USERS = 'somebody-else';

      const response = await helpers.getCliAvailability();

      expect(response.statusCode).toBe(200);
      expect(response.body.response).toEqual({ available: false, reason: 'not-admin', providers: [] });
    });

    it('answers 200 with admin-not-configured when ADMIN_USERS is empty', async () => {
      process.env.ADMIN_USERS = '';

      const response = await helpers.getCliAvailability();

      expect(response.statusCode).toBe(200);
      expect(response.body.response).toEqual({
        available: false,
        reason: 'admin-not-configured',
        providers: [],
      });
    });

    it('lists both CLIs as installed for an admin on self-host', async () => {
      const availability = await helpers.getCliAvailability({ raw: true });

      expect(availability.available).toBe(true);
      expect(availability.reason).toBeUndefined();
      expect(availability.providers).toEqual([
        { provider: AI_PROVIDER.claudeCode, installed: true, version: expect.stringContaining('Claude Code') },
        { provider: AI_PROVIDER.codex, installed: true, version: expect.stringContaining('codex') },
      ]);
    });

    it('reports a CLI as not installed when its binary is missing', async () => {
      process.env.AI_CLI_CLAUDE_PATH = '/nonexistent/claude';
      process.env.AI_CLI_CODEX_PATH = '/nonexistent/codex';

      const availability = await helpers.getCliAvailability({ raw: true });

      expect(availability.available).toBe(true);
      expect(availability.providers).toEqual([
        { provider: AI_PROVIDER.claudeCode, installed: false, version: null },
        { provider: AI_PROVIDER.codex, installed: false, version: null },
      ]);
    });
  });

  describe('Claude Code sign-in', () => {
    it('runs start, code and success without ever returning the token', async () => {
      const started = await helpers.startCliAuthSession({ provider: AI_PROVIDER.claudeCode });

      expect(started.statusCode).toBe(201);
      expect(started.body.response).toMatchObject({
        provider: AI_PROVIDER.claudeCode,
        status: 'awaiting-user',
        authUrl: expect.stringMatching(/^https:\/\/\S*oauth\S*$/),
      });
      expect(started.body.response.userCode).toBeUndefined();

      const { id } = started.body.response;
      const submitted = await helpers.submitCliAuthCode({ id, code: 'good-code' });

      expect(submitted.statusCode).toBe(200);
      expect(submitted.body.response.status).toBe('verifying');

      const finished = await helpers.waitForCliAuthSession({ id, status: 'succeeded' });
      const polled = await helpers.getCliAuthSession({ id });

      expect(finished.error).toBeUndefined();
      expect(JSON.stringify(finished)).not.toContain(CLAUDE_TOKEN_PREFIX);
      expect(JSON.stringify(polled.body)).not.toContain(CLAUDE_TOKEN_PREFIX);
      expect(JSON.stringify(submitted.body)).not.toContain('good-code');
    });

    it('fails the session with a redacted message on a bad code', async () => {
      const { id } = await helpers.startCliAuthSession({ provider: AI_PROVIDER.claudeCode, raw: true });

      await helpers.submitCliAuthCode({ id, code: 'bad-code' });

      await expect(helpers.waitForCliAuthSession({ id, status: 'succeeded' })).rejects.toThrow(/settled as failed/);

      const failed = await helpers.getCliAuthSession({ id, raw: true });

      expect(failed.status).toBe('failed');
      expect(failed.error).toBeTruthy();
      expect(failed.error).not.toContain('bad-code');
      expect(failed.error).not.toContain(CLAUDE_TOKEN_PREFIX);
    });

    it('reports a failed session when the login prints no URL', async () => {
      useFakeCliScenario({ scenario: 'no-url' });

      const started = await helpers.startCliAuthSession({ provider: AI_PROVIDER.claudeCode });

      expect(started.statusCode).toBe(201);
      expect(started.body.response.status).toBe('failed');
      expect(started.body.response.authUrl).toBeUndefined();
      expect(started.body.response.error).toBeTruthy();
    }, 60_000);

    it('refuses a code that is not printable text with 422', async () => {
      const { id } = await helpers.startCliAuthSession({ provider: AI_PROVIDER.claudeCode, raw: true });

      const emptyCode = await helpers.submitCliAuthCode({ id, code: '   ' });
      const controlCode = await helpers.submitCliAuthCode({ id, code: 'abc\u0007def' });
      const longCode = await helpers.submitCliAuthCode({ id, code: 'a'.repeat(501) });

      expect(emptyCode.statusCode).toBe(ERROR_CODES.ValidationError);
      expect(controlCode.statusCode).toBe(ERROR_CODES.ValidationError);
      expect(longCode.statusCode).toBe(ERROR_CODES.ValidationError);
      expect((await helpers.getCliAuthSession({ id, raw: true })).status).toBe('awaiting-user');
    });
  });

  describe('Codex sign-in', () => {
    it('returns the URL and the device code, then succeeds without a code step', async () => {
      const started = await helpers.startCliAuthSession({ provider: AI_PROVIDER.codex });

      expect(started.statusCode).toBe(201);
      expect(started.body.response).toMatchObject({
        provider: AI_PROVIDER.codex,
        status: 'awaiting-user',
        authUrl: expect.stringMatching(/^https:\/\/\S+$/),
        userCode: expect.stringMatching(/^[A-Z0-9]{4,}-[A-Z0-9]{4,}$/),
      });

      const finished = await helpers.waitForCliAuthSession({ id: started.body.response.id, status: 'succeeded' });

      expect(finished.error).toBeUndefined();
      expect(JSON.stringify(finished)).not.toContain('refresh_token');
    });

    it('fails the session when the login is denied', async () => {
      useFakeCliScenario({ scenario: 'denied' });

      const { id } = await helpers.startCliAuthSession({ provider: AI_PROVIDER.codex, raw: true });

      await expect(helpers.waitForCliAuthSession({ id, status: 'succeeded' })).rejects.toThrow(/settled as failed/);
    });

    it('refuses a pasted code with 422 because Codex has no code step', async () => {
      const { id } = await helpers.startCliAuthSession({ provider: AI_PROVIDER.codex, raw: true });

      const response = await helpers.submitCliAuthCode({ id, code: 'whatever' });

      expect(response.statusCode).toBe(ERROR_CODES.ValidationError);
    });
  });

  describe('session lifecycle', () => {
    it('answers 404 for a session id that does not exist', async () => {
      const response = await helpers.getCliAuthSession({ id: randomUUID() });

      expect(response.statusCode).toBe(ERROR_CODES.NotFoundError);
    });

    it('answers 422 for an id that is not a UUID', async () => {
      const response = await helpers.getCliAuthSession({ id: 'not-a-uuid' });

      expect(response.statusCode).toBe(ERROR_CODES.ValidationError);
    });

    it('refuses an unknown provider with 422', async () => {
      const response = await helpers.startCliAuthSession({ provider: AI_PROVIDER.openai });

      expect(response.statusCode).toBe(ERROR_CODES.ValidationError);
    });

    it('cancels a session with 204 and answers 404 afterwards', async () => {
      const { id } = await helpers.startCliAuthSession({ provider: AI_PROVIDER.claudeCode, raw: true });

      const cancelled = await helpers.cancelCliAuthSession({ id });

      expect(cancelled.statusCode).toBe(204);
      expect((await helpers.getCliAuthSession({ id })).statusCode).toBe(ERROR_CODES.NotFoundError);
      expect((await helpers.cancelCliAuthSession({ id })).statusCode).toBe(ERROR_CODES.NotFoundError);
    });

    it('replaces the earlier session when the same provider is started again', async () => {
      const first = await helpers.startCliAuthSession({ provider: AI_PROVIDER.claudeCode, raw: true });
      const second = await helpers.startCliAuthSession({ provider: AI_PROVIDER.claudeCode, raw: true });

      expect(second.id).not.toBe(first.id);
      expect((await helpers.getCliAuthSession({ id: first.id })).statusCode).toBe(ERROR_CODES.NotFoundError);
      expect((await helpers.getCliAuthSession({ id: second.id })).statusCode).toBe(200);
    });
  });

  describe('access gate on the /auth-sessions routes', () => {
    it('answers 401 on every route for a self-host user outside ADMIN_USERS', async () => {
      process.env.ADMIN_USERS = 'somebody-else';

      const responses = await callEveryAuthSessionRoute();

      expect(responses.map((response) => response.statusCode)).toEqual([401, 401, 401, 401]);
    });

    it('answers 404 on every route on a cloud instance, even for a session that exists', async () => {
      // A live session, so get/submit/cancel can only answer 404 because of the cloud gate.
      const started = await helpers.startCliAuthSession({ provider: AI_PROVIDER.claudeCode, raw: true });

      runAsCloud();

      const responses = await callEveryAuthSessionRoute({ id: started.id });

      expect(responses.map((response) => response.statusCode)).toEqual([404, 404, 404, 404]);
    });
  });
});

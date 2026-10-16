import { AI_PROVIDER, AICliProvider, AINativeProvider } from '@bt/shared/types';
import type { Equals, Expect } from '@bt/shared/types/type-testing';
import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals';
import { NotAllowedError } from '@js/errors';
import { getUsernameById } from '@models/users.model';

import { assertCliAiAllowed, getCliAiAccess } from './cli-access';

jest.mock('@models/users.model', () => ({ getUsernameById: jest.fn() }));

const getUsernameByIdMock = jest.mocked(getUsernameById);

const USER_ID = 1;

const restoreEnv = ({ name, value }: { name: string; value: string | undefined }) => {
  if (value === undefined) delete process.env[name];
  else process.env[name] = value;
};

describe('cli access', () => {
  const originalSelfHost = process.env.IS_SELF_HOST;
  const originalAdminUsers = process.env.ADMIN_USERS;

  beforeEach(() => {
    process.env.IS_SELF_HOST = 'true';
    process.env.ADMIN_USERS = 'root, owner';
    getUsernameByIdMock.mockResolvedValue('owner');
  });

  afterEach(() => {
    restoreEnv({ name: 'IS_SELF_HOST', value: originalSelfHost });
    restoreEnv({ name: 'ADMIN_USERS', value: originalAdminUsers });
    jest.clearAllMocks();
  });

  describe('getCliAiAccess', () => {
    it('refuses on cloud before looking at the user', async () => {
      process.env.IS_SELF_HOST = 'false';

      await expect(getCliAiAccess({ userId: USER_ID })).resolves.toEqual({ allowed: false, reason: 'not-self-host' });
      expect(getUsernameByIdMock).not.toHaveBeenCalled();
    });

    it('reports an unconfigured admin list on self-host', async () => {
      process.env.ADMIN_USERS = '';

      await expect(getCliAiAccess({ userId: USER_ID })).resolves.toEqual({
        allowed: false,
        reason: 'admin-not-configured',
      });
    });

    it('refuses a self-host user who is not in ADMIN_USERS', async () => {
      getUsernameByIdMock.mockResolvedValue('somebody-else');

      await expect(getCliAiAccess({ userId: USER_ID })).resolves.toEqual({ allowed: false, reason: 'not-admin' });
    });

    it('refuses a user that no longer exists', async () => {
      getUsernameByIdMock.mockResolvedValue(null);

      await expect(getCliAiAccess({ userId: USER_ID })).resolves.toEqual({ allowed: false, reason: 'not-admin' });
    });

    it('allows an admin on self-host', async () => {
      await expect(getCliAiAccess({ userId: USER_ID })).resolves.toEqual({ allowed: true });
      expect(getUsernameByIdMock).toHaveBeenCalledWith({ id: USER_ID });
    });
  });

  describe('assertCliAiAllowed', () => {
    it('resolves for an admin on self-host', async () => {
      await expect(assertCliAiAllowed({ userId: USER_ID })).resolves.toBeUndefined();
    });

    it.each([
      ['cloud', () => (process.env.IS_SELF_HOST = 'false')],
      ['an empty admin list', () => (process.env.ADMIN_USERS = '')],
      ['a non-admin', () => getUsernameByIdMock.mockResolvedValue('somebody-else')],
    ])('throws NotAllowedError for %s', async (_name, arrange) => {
      arrange();

      await expect(assertCliAiAllowed({ userId: USER_ID })).rejects.toBeInstanceOf(NotAllowedError);
    });
  });
});

/** @public type-level checks, exported only so they aren't flagged as unused. */
export type NativeProvidersExcludeCliProviders = Expect<
  Equals<AINativeProvider, AI_PROVIDER.openai | AI_PROVIDER.anthropic | AI_PROVIDER.google>
>;
export type CliProvidersAreNotNative = Expect<Equals<Extract<AINativeProvider, AICliProvider>, never>>;

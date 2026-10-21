import { FEATURES, type RecordId, USER_ROLES } from '@bt/shared/types';
import { beforeEach, describe, expect, it, jest } from '@jest/globals';

// Blocks the real modules, whose import chains open the auth pool and Redis connections.
jest.mock('@config/auth', () => ({ authPool: { query: jest.fn() } }));
jest.mock('@js/utils/cache', () => ({
  CacheClient: jest.fn().mockImplementation(() => ({ read: jest.fn(async () => null), write: jest.fn() })),
}));
jest.mock('@models/users.model', () => ({ __esModule: true, default: { findOne: jest.fn() } }));
jest.mock('@services/entitlements/resolve-entitlements.service', () => ({ getEntitlementsByUserId: jest.fn() }));

import { authPool } from '@config/auth';
import Users from '@models/users.model';
import { getEntitlementsByUserId } from '@services/entitlements/resolve-entitlements.service';

import { buildMcpAuthInfo, verifyMcpToken } from './auth';

const query = jest.mocked(authPool.query);
const findUser = jest.mocked(Users.findOne);
const entitlements = jest.mocked(getEntitlementsByUserId);

describe('verifyMcpToken', () => {
  beforeEach(() => {
    jest.resetAllMocks();
    query.mockResolvedValue({
      rows: [{ userId: 'auth-1', clientId: 'client-1', scopes: '["finance:read"]', expiresAt: null }],
    } as never);
    findUser.mockResolvedValue({
      id: 7,
      authUserId: 'auth-1',
      username: 'jane',
      role: USER_ROLES.common,
    } as never);
  });

  it('carries readOnly and the plan features beside the user in the auth info', async () => {
    entitlements.mockResolvedValueOnce({
      readOnly: false,
      features: [FEATURES.budget_plan, FEATURES.attachments],
    } as never);

    const info = await verifyMcpToken({ authorizationHeader: 'Bearer abc' });

    expect(entitlements).toHaveBeenCalledTimes(1);
    expect(entitlements).toHaveBeenCalledWith({ userId: 7 });
    expect(info.extra).toEqual({
      userId: 7,
      authUserId: 'auth-1',
      username: 'jane',
      role: USER_ROLES.common,
      readOnly: false,
      features: [FEATURES.budget_plan, FEATURES.attachments],
    });
  });

  it('carries no features for a plan without any', async () => {
    entitlements.mockResolvedValueOnce({ readOnly: true, features: [] } as never);

    const info = await verifyMcpToken({ authorizationHeader: 'Bearer abc' });

    expect(info.extra.readOnly).toBe(true);
    expect(info.extra.features).toEqual([]);
  });
});

describe('verifyMcpToken auth info', () => {
  it('returns the token, client, scopes and expiry of an OAuth token with the resolved user', async () => {
    jest.resetAllMocks();
    const expiresAt = new Date('2030-01-01T00:00:00.000Z');
    query.mockResolvedValue({
      rows: [
        {
          userId: 'auth-1',
          clientId: 'client-1',
          scopes: '["finance:read","finance:write"]',
          expiresAt: expiresAt.toISOString(),
        },
      ],
    } as never);
    findUser.mockResolvedValue({ id: 7, authUserId: 'auth-1', username: 'jane', role: USER_ROLES.common } as never);
    entitlements.mockResolvedValueOnce({ readOnly: false, features: [FEATURES.budget_plan] } as never);

    const info = await verifyMcpToken({ authorizationHeader: 'Bearer abc' });

    expect(info).toEqual({
      token: 'abc',
      clientId: 'client-1',
      scopes: ['finance:read', 'finance:write'],
      expiresAt: expiresAt.getTime() / 1000,
      extra: {
        userId: 7,
        authUserId: 'auth-1',
        username: 'jane',
        role: USER_ROLES.common,
        readOnly: false,
        features: [FEATURES.budget_plan],
      },
    });
  });
});

describe('buildMcpAuthInfo', () => {
  const user = { id: 9, authUserId: 'auth-9' as RecordId, username: 'sam', role: USER_ROLES.common };

  beforeEach(() => {
    jest.resetAllMocks();
  });

  it('resolves readOnly and features through the entitlements of the user', async () => {
    entitlements.mockResolvedValueOnce({ readOnly: true, features: [FEATURES.attachments] } as never);

    const info = await buildMcpAuthInfo({
      user,
      clientId: 'moneymatter-chat',
      scopes: ['finance:read'],
      expiresAt: 1_900_000_000,
      token: 'moneymatter-chat:in-process',
    });

    expect(entitlements).toHaveBeenCalledTimes(1);
    expect(entitlements).toHaveBeenCalledWith({ userId: 9 });
    expect(info).toEqual({
      token: 'moneymatter-chat:in-process',
      clientId: 'moneymatter-chat',
      scopes: ['finance:read'],
      expiresAt: 1_900_000_000,
      extra: {
        userId: 9,
        authUserId: 'auth-9',
        username: 'sam',
        role: USER_ROLES.common,
        readOnly: true,
        features: [FEATURES.attachments],
      },
    });
  });

  it('leaves expiresAt undefined when the token has none', async () => {
    entitlements.mockResolvedValueOnce({ readOnly: false, features: [] } as never);

    const info = await buildMcpAuthInfo({ user, clientId: 'c', scopes: [], token: 't' });

    expect(info.expiresAt).toBeUndefined();
    expect(info.extra.readOnly).toBe(false);
  });
});

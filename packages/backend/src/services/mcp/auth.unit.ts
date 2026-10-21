import { USER_ROLES } from '@bt/shared/types';
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

import { verifyMcpToken } from './auth';

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

  it('carries readOnly beside the user in the auth info', async () => {
    entitlements.mockResolvedValueOnce({ readOnly: false } as never);

    const info = await verifyMcpToken({ authorizationHeader: 'Bearer abc' });

    expect(entitlements).toHaveBeenCalledTimes(1);
    expect(entitlements).toHaveBeenCalledWith({ userId: 7 });
    expect(info.extra).toEqual({
      userId: 7,
      authUserId: 'auth-1',
      username: 'jane',
      role: USER_ROLES.common,
      readOnly: false,
    });
  });
});

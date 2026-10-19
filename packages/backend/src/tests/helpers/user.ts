import { AuthSessionInfo, UserInfoResponse } from '@bt/shared/types';
import { authPool } from '@config/auth';

import { makeRequest } from './common';

/**
 * `GET /user` returns the authenticated user's row enriched with `email` and
 * `isAdmin`. Tests use it to read server-derived defaults (e.g.
 * `defaultCategoryId`) instead of assuming what the seed produced.
 */
export async function getUserInfo<R extends boolean | undefined = undefined>({ raw }: { raw?: R } = {}) {
  return makeRequest<UserInfoResponse, R>({
    method: 'get',
    url: '/user',
    raw,
  });
}

/** `GET /user/sessions`: the signed-in user's active login sessions. */
export async function listAuthSessions<R extends boolean | undefined = undefined>({ raw }: { raw?: R } = {}) {
  return makeRequest<AuthSessionInfo[], R>({
    method: 'get',
    url: '/user/sessions',
    raw,
  });
}

/**
 * Insert a `ba_session` row. The suite's default user already owns one (`test-session-token`);
 * `createdAt` defaults to now and `expiresAt` to a day ahead, like a fresh sign-in.
 */
export async function createTestAuthSession({
  token,
  userId = 'test-user-id',
  createdAt = new Date(),
  expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000),
  userAgent = 'test-agent',
}: {
  token: string;
  userId?: string;
  createdAt?: Date;
  expiresAt?: Date;
  userAgent?: string;
}) {
  await authPool.query(
    `INSERT INTO ba_session (id, "userId", token, "expiresAt", "ipAddress", "userAgent", "createdAt", "updatedAt")
     VALUES ($1, $2, $3, $4, '127.0.0.1', $5, $6, $6)`,
    [`${token}-id`, userId, token, expiresAt, userAgent, createdAt],
  );
}

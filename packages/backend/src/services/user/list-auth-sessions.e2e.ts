import { API_RESPONSE_STATUS } from '@bt/shared/types';
import { authPool } from '@config/auth';
import { describe, expect, it } from '@jest/globals';
import * as helpers from '@tests/helpers';

const DAY_MS = 24 * 60 * 60 * 1000;
const SEEDED_SESSION_TOKEN = 'test-session-token';

describe('GET /user/sessions', () => {
  it('returns 401 when not authenticated', async () => {
    const res = await helpers.withoutSession(() => helpers.listAuthSessions({ raw: false }));

    expect(res.statusCode).toBe(401);
    expect(res.body.status).toBe(API_RESPONSE_STATUS.error);
  });

  it("returns the user's session with the fields the revoke actions need", async () => {
    const sessions = await helpers.listAuthSessions({ raw: true });

    expect(sessions).toHaveLength(1);
    expect(sessions[0]).toEqual({
      id: 'test-user-id-session',
      userId: 'test-user-id',
      token: SEEDED_SESSION_TOKEN,
      ipAddress: '127.0.0.1',
      userAgent: 'test-agent',
      createdAt: expect.any(String),
      updatedAt: expect.any(String),
      expiresAt: expect.any(String),
    });
  });

  it('lists every active session even when the current one was created more than 24 hours ago', async () => {
    await authPool.query(`UPDATE ba_session SET "createdAt" = NOW() - INTERVAL '3 days' WHERE token = $1`, [
      SEEDED_SESSION_TOKEN,
    ]);
    await helpers.createTestAuthSession({
      token: 'other-device-token',
      createdAt: new Date(Date.now() - 5 * DAY_MS),
      expiresAt: new Date(Date.now() + 2 * DAY_MS),
    });

    const sessions = await helpers.listAuthSessions({ raw: true });

    expect(sessions.map((s) => s.token).toSorted()).toEqual(['other-device-token', SEEDED_SESSION_TOKEN]);
  });

  it('leaves out expired sessions', async () => {
    await helpers.createTestAuthSession({
      token: 'expired-token',
      createdAt: new Date(Date.now() - 8 * DAY_MS),
      expiresAt: new Date(Date.now() - DAY_MS),
    });

    const sessions = await helpers.listAuthSessions({ raw: true });

    expect(sessions.map((s) => s.token)).toEqual([SEEDED_SESSION_TOKEN]);
  });

  it("leaves out other users' sessions", async () => {
    await authPool.query(
      `INSERT INTO ba_user (id, name, email, "emailVerified", "createdAt", "updatedAt")
       VALUES ('other-auth-user', 'Other', 'other@test.local', true, NOW(), NOW())`,
    );
    await helpers.createTestAuthSession({ token: 'foreign-token', userId: 'other-auth-user' });

    const sessions = await helpers.listAuthSessions({ raw: true });

    expect(sessions.map((s) => s.token)).toEqual([SEEDED_SESSION_TOKEN]);
  });

  it('puts the most recently active session first', async () => {
    await authPool.query(`UPDATE ba_session SET "updatedAt" = NOW() - INTERVAL '2 hours' WHERE token = $1`, [
      SEEDED_SESSION_TOKEN,
    ]);
    await helpers.createTestAuthSession({ token: 'newer-token' });

    const sessions = await helpers.listAuthSessions({ raw: true });

    expect(sessions.map((s) => s.token)).toEqual(['newer-token', SEEDED_SESSION_TOKEN]);
  });
});

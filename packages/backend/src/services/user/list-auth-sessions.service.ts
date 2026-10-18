import { AuthSessionInfo } from '@bt/shared/types';
import { authPool } from '@config/auth';

interface AuthSessionRow {
  id: string;
  userId: string;
  token: string;
  ipAddress: string | null;
  userAgent: string | null;
  createdAt: Date;
  updatedAt: Date;
  expiresAt: Date;
}

/**
 * The user's unexpired better-auth sessions, most recently active first.
 *
 * better-auth's own `/list-sessions` rejects a session created more than `session.freshAge` ago, which would
 * hide the list from anyone signed in for over a day. The same freshness gate protects adding a passkey and
 * unlinking a login method, so `freshAge` stays at its default and this route reads the rows directly.
 */
export async function listAuthSessions({ authUserId }: { authUserId: string }): Promise<AuthSessionInfo[]> {
  const result = await authPool.query<AuthSessionRow>(
    `SELECT id, "userId", token, "ipAddress", "userAgent", "createdAt", "updatedAt", "expiresAt"
     FROM ba_session
     WHERE "userId" = $1 AND "expiresAt" > NOW()
     ORDER BY "updatedAt" DESC, id`,
    [authUserId],
  );

  return result.rows.map((row) => ({
    id: row.id,
    userId: row.userId,
    token: row.token,
    ipAddress: row.ipAddress,
    userAgent: row.userAgent,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    expiresAt: row.expiresAt.toISOString(),
  }));
}

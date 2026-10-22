import { UserRole } from '@bt/shared/types';
import { OAUTH_RESOURCE_IDENTIFIERS, authPool } from '@config/auth';
import { Unauthorized } from '@js/errors';
import { CacheClient } from '@js/utils/cache';
import { logger } from '@js/utils/logger';
import Users from '@models/users.model';
import { getEntitlementsByUserId } from '@services/entitlements/resolve-entitlements.service';
import { parseScopes } from '@services/mcp/tools/helpers';
import { createHash } from 'node:crypto';

type AppUser = Pick<Users, 'username' | 'id' | 'authUserId' | 'role'>;

const CACHE_KEY_PREFIX = 'mcp_auth_user:';

const mcpUserCache = new CacheClient<AppUser>({
  ttl: 300, // 5 minutes — MCP tokens are long-lived (72h)
  logPrefix: 'McpAuthUserCache',
});

interface TokenRow {
  userId: string;
  clientId: string;
  scopes: string | null;
  resources: string | null;
  expiresAt: string | null;
  revoked: string | null;
  sessionId: string | null;
  sessionExpiresAt: string | null;
}

export interface McpAuthInfo {
  token: string;
  clientId: string;
  scopes: string[];
  expiresAt?: number;
  extra: {
    userId: number;
    authUserId: string;
    username: string;
    role: UserRole;
    readOnly: boolean;
  };
}

/**
 * Hash a token the same way better-auth stores it: SHA-256, base64url, no padding.
 */
function hashToken({ token }: { token: string }): string {
  const hash = createHash('sha256').update(token).digest();
  return hash.toString('base64url');
}

/**
 * Verify an OAuth access token by querying the ba_oauth_access_token table directly,
 * mirroring better-auth's opaque-token introspection: expiry, `revoked`, the ended
 * session of a session-bound token, and the resource binding (RFC 8707).
 * Tokens are stored as SHA-256 hashes (base64url) by better-auth's oauth-provider.
 */
async function verifyAccessToken({ token }: { token: string }): Promise<McpAuthInfo> {
  const hashedToken = hashToken({ token });

  const result = await authPool.query<TokenRow>(
    `SELECT at."userId", at."clientId", at."scopes", at."resources", at."expiresAt", at."revoked",
            at."sessionId", s."expiresAt" AS "sessionExpiresAt"
     FROM "ba_oauth_access_token" at
     LEFT JOIN "ba_session" s ON s.id = at."sessionId"
     WHERE at."token" = $1
     LIMIT 1`,
    [hashedToken],
  );

  const tokenRecord = result.rows[0];
  if (!tokenRecord) {
    throw new Unauthorized({ message: 'Token not found' });
  }

  if (!tokenRecord.expiresAt || new Date(tokenRecord.expiresAt) < new Date()) {
    throw new Unauthorized({ message: 'Token expired' });
  }

  if (tokenRecord.revoked) {
    throw new Unauthorized({ message: 'Token revoked' });
  }

  if (tokenRecord.sessionId && (!tokenRecord.sessionExpiresAt || new Date(tokenRecord.sessionExpiresAt) < new Date())) {
    throw new Unauthorized({ message: 'Token session ended' });
  }

  // Tokens issued before resource binding carry no resources and stay valid.
  const resources = parseScopes({ scopes: tokenRecord.resources });
  if (resources.length > 0 && !resources.some((r) => OAUTH_RESOURCE_IDENTIFIERS.includes(r))) {
    throw new Unauthorized({ message: 'Token not issued for this resource' });
  }

  const authUserId = tokenRecord.userId;
  if (!authUserId) {
    throw new Unauthorized({ message: 'Token has no user' });
  }

  // Resolve app user from auth user ID (with caching)
  const cacheKey = `${CACHE_KEY_PREFIX}${authUserId}`;
  let user = await mcpUserCache.read(cacheKey);

  if (!user) {
    user = (await Users.findOne({
      where: { authUserId },
      attributes: ['username', 'id', 'authUserId', 'role'],
      raw: true,
    })) as AppUser | null;

    if (user) {
      await mcpUserCache.write({ key: cacheKey, value: user });
    }
  }

  if (!user) {
    throw new Unauthorized({ message: 'App user not found for auth user' });
  }

  const scopes = parseScopes({ scopes: tokenRecord.scopes });
  const { readOnly } = await getEntitlementsByUserId({ userId: user.id });

  return {
    token,
    clientId: tokenRecord.clientId || 'unknown',
    scopes,
    expiresAt: tokenRecord.expiresAt ? new Date(tokenRecord.expiresAt).getTime() / 1000 : undefined,
    extra: {
      userId: user.id,
      authUserId: user.authUserId,
      username: user.username,
      role: user.role,
      readOnly,
    },
  };
}

/**
 * Extract and verify the OAuth bearer token from the Authorization header.
 */
export async function verifyMcpToken({ authorizationHeader }: { authorizationHeader?: string }): Promise<McpAuthInfo> {
  if (!authorizationHeader?.startsWith('Bearer ')) {
    throw new Unauthorized({ message: 'Missing or invalid Authorization header' });
  }

  const token = authorizationHeader.slice(7);

  try {
    return await verifyAccessToken({ token });
  } catch (error) {
    // Unauthorized is routine client churn and stays out of Sentry; anything else
    // (auth DB, Redis, entitlements) is a real failure and is captured.
    logger.error(error as Error);
    throw error;
  }
}

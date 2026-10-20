import { Feature, UserRole } from '@bt/shared/types';
import { hashToken } from '@common/lib/hash-token';
import { authPool } from '@config/auth';
import { Unauthorized } from '@js/errors';
import { CacheClient } from '@js/utils/cache';
import { logger } from '@js/utils/logger';
import Users from '@models/users.model';
import { getEntitlementsByUserId } from '@services/entitlements/resolve-entitlements.service';
import { parseScopes } from '@services/mcp/tools/helpers';

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
  expiresAt: string | null;
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
    /** Plan features, active feature trials included; what `requireFeatureAccess` checks. */
    features: readonly Feature[];
  };
}

/**
 * Builds the auth info every tool handler reads from `extra.authInfo`. The plan entitlements
 * (`readOnly`, `features`) are resolved here, on every call, so a lapsed plan takes effect
 * without waiting for a token to expire. `expiresAt` is in epoch seconds, as the MCP SDK expects.
 */
export async function buildMcpAuthInfo({
  user,
  clientId,
  scopes,
  expiresAt,
  token,
}: {
  user: AppUser;
  clientId: string;
  scopes: string[];
  expiresAt?: number;
  token: string;
}): Promise<McpAuthInfo> {
  const { readOnly, features } = await getEntitlementsByUserId({ userId: user.id });

  return {
    token,
    clientId,
    scopes,
    expiresAt,
    extra: {
      userId: user.id,
      authUserId: user.authUserId,
      username: user.username,
      role: user.role,
      readOnly,
      features,
    },
  };
}

/**
 * Verify an OAuth access token by querying the ba_oauth_access_token table directly.
 * Tokens are stored as SHA-256 hashes (base64url) by better-auth's oauth-provider.
 * Resolves the app user from the auth user ID stored on the token.
 */
async function verifyAccessToken({ token }: { token: string }): Promise<McpAuthInfo> {
  const hashedToken = hashToken({ token });

  // Query the OAuth access token table directly
  const result = await authPool.query<TokenRow>(
    `SELECT "userId", "clientId", "scopes", "expiresAt"
     FROM "ba_oauth_access_token"
     WHERE "token" = $1
     LIMIT 1`,
    [hashedToken],
  );

  const tokenRecord = result.rows[0];
  if (!tokenRecord) {
    throw new Unauthorized({ message: 'Token not found' });
  }

  // Check expiration
  if (tokenRecord.expiresAt && new Date(tokenRecord.expiresAt) < new Date()) {
    throw new Unauthorized({ message: 'Token expired' });
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

  return buildMcpAuthInfo({
    user,
    clientId: tokenRecord.clientId || 'unknown',
    scopes: parseScopes({ scopes: tokenRecord.scopes }),
    expiresAt: tokenRecord.expiresAt ? new Date(tokenRecord.expiresAt).getTime() / 1000 : undefined,
    token,
  });
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

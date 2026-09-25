import { API_ERROR_CODES, API_RESPONSE_STATUS } from '@bt/shared/types';
import { getCurrentSessionId } from '@common/lib/cls/session-id';
import { auth } from '@config/auth';
import { CacheClient } from '@js/utils/cache';
import { logger } from '@js/utils/logger';
import { captureException, setSentryUser } from '@js/utils/sentry';
import { enforceReadOnly } from '@middlewares/entitlements';
import Users from '@models/users.model';
import { APIError } from 'better-auth';
import { fromNodeHeaders } from 'better-auth/node';
import { NextFunction, Request, Response } from 'express';
import type { WhereOptions } from 'sequelize';

export type AppUser = Pick<
  Users,
  'username' | 'id' | 'authUserId' | 'role' | 'plan' | 'trialEndsAt' | 'firstBudgetPlanAt'
>;

/** Versioned: entries written with an older `AppUser` shape must not be read after deploy. */
export const APP_USER_CACHE_KEY_PREFIX = 'auth_user:v3:';

const appUserCache = new CacheClient<AppUser>({
  ttl: 60, // 60 seconds
  logPrefix: 'AuthUserCache',
});

export const findAppUser = ({ where }: { where: WhereOptions<Users> }) =>
  Users.findOne({
    where,
    attributes: ['username', 'id', 'authUserId', 'role', 'plan', 'trialEndsAt', 'firstBudgetPlanAt'],
    raw: true,
  }) as Promise<AppUser | null>;

/** Remove a user from the cache (e.g., after profile update). Await it: a response that
 *  races the delete can be re-read from the stale entry. */
export function invalidateAppUserCache({ authUserId }: { authUserId: string }): Promise<void> {
  return appUserCache.delete(`${APP_USER_CACHE_KEY_PREFIX}${authUserId}`);
}

/**
 * Middleware to authenticate requests using better-auth sessions.
 *
 * This middleware:
 * 1. Validates the session using better-auth
 * 2. Looks up the app user by authUserId
 * 3. Attaches the user to req.user for downstream handlers
 */
export const authenticateSession = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const session = await auth.api.getSession({ headers: fromNodeHeaders(req.headers) });

    if (!session || !session.user) {
      return res.status(401).json({
        status: API_RESPONSE_STATUS.error,
        response: {
          message: 'Unauthorized',
          code: API_ERROR_CODES.unauthorized,
        },
      });
    }

    const authUserId = session.user.id;
    const cacheKey = `${APP_USER_CACHE_KEY_PREFIX}${authUserId}`;

    // Check Redis cache first
    let user = await appUserCache.read(cacheKey);

    if (!user) {
      // Cache miss — look up the app user by authUserId
      user = await findAppUser({ where: { authUserId } });

      if (user) {
        await appUserCache.write({ key: cacheKey, value: user });
      }
    }

    if (!user) {
      return res.status(401).json({
        status: API_RESPONSE_STATUS.error,
        response: {
          message: 'User not found',
          code: API_ERROR_CODES.unauthorized,
        },
      });
    }

    // Attach user to request for downstream handlers
    req.user = user;

    // Set user context for Sentry error tracking (includes sessionId for correlation)
    setSentryUser({
      userId: user.id,
      username: user.username,
      email: session.user.email,
      sessionId: getCurrentSessionId(),
    });
  } catch (error) {
    // `getSession` throws APIError for a rejected credential (malformed or undecryptable
    // cookie, vanished session); everything else is infrastructure (auth store, cache, DB),
    // where a 401 would make the client drop a still-valid session.
    if (error instanceof APIError) {
      return res.status(401).json({
        status: API_RESPONSE_STATUS.error,
        response: {
          message: 'Unauthorized',
          code: API_ERROR_CODES.unauthorized,
        },
      });
    }

    logger.error({ message: 'Session authentication failed', error: error as Error });
    captureException({ error });

    return next(error);
  }

  return enforceReadOnly(req, res, next);
};

/**
 * Better-auth session lifecycle hooks.
 *
 * Note: Models and services are imported dynamically to avoid circular
 * dependency issues during Sequelize initialization.
 */
import { USER_ROLES } from '@bt/shared/types';
import { logger } from '@js/utils/logger';
import { type LoginMethod, identifyUser, trackLogin } from '@js/utils/posthog';
import type { Pool } from 'pg';

/**
 * Creates session hooks for better-auth.
 * @param pool - PostgreSQL connection pool for querying auth tables
 */
export function createSessionHooks({ pool }: { pool: Pool }) {
  return {
    create: {
      // Identify user in PostHog on login (ensures old users get identified)
      after: async (session: { id: string; userId: string }) => {
        // Fire and forget - don't block login
        (async () => {
          try {
            // Dynamic import to avoid circular dependency
            const { getUserByAuthUserId } = await import('@models/users.model');
            const appUser = await getUserByAuthUserId({ authUserId: session.userId });

            if (!appUser) {
              logger.info(`PostHog: App user not found for authUserId: ${session.userId}`);
              return;
            }

            // Get email and login method in parallel
            const [userResult, accountResult] = await Promise.all([
              pool.query('SELECT email FROM ba_user WHERE id = $1', [session.userId]),
              // Get the most recently used account to determine login method
              pool.query('SELECT "providerId" FROM ba_account WHERE "userId" = $1 ORDER BY "updatedAt" DESC LIMIT 1', [
                session.userId,
              ]),
            ]);

            const email = userResult.rows[0]?.email;
            const providerId = accountResult.rows[0]?.providerId as string | undefined;

            // Map providerId to LoginMethod
            const providerToMethod: Record<string, LoginMethod> = {
              credential: 'email',
              google: 'google',
              github: 'github',
              apple: 'apple',
              oidc: 'oidc',
              passkey: 'passkey',
            };
            const method: LoginMethod = providerToMethod[providerId ?? ''] ?? 'email';

            const isDemo = appUser.role === USER_ROLES.demo;

            // Identify user (updates properties if already identified)
            identifyUser({
              userId: appUser.id,
              properties: {
                email,
                username: appUser.username,
                is_demo: isDemo,
                user_role: appUser.role,
              },
            });

            // Track login event
            trackLogin({
              userId: appUser.id,
              method,
              sessionId: session.id,
            });
          } catch (error) {
            logger.error({ message: 'Failed to track login in PostHog', error: error as Error });
          }
        })();
      },
    },
    delete: {
      // Clean up demo user data on signout
      after: async (session: { userId: string }) => {
        // Fire and forget - don't block signout
        (async () => {
          try {
            // Dynamic imports to avoid circular dependency
            const Users = (await import('@models/users.model')).default;
            const { cleanupDemoUser } = await import('@services/demo/cleanup-demo-users.service');

            // Check if this is a demo user
            const appUser = await Users.findOne({
              where: { authUserId: session.userId },
              attributes: ['id', 'role'],
              raw: true,
            });

            if (appUser?.role === USER_ROLES.demo) {
              logger.info(`Demo user ${appUser.id} signed out - cleaning up data`);
              await cleanupDemoUser({ userId: appUser.id });
              logger.info(`Demo user ${appUser.id} cleanup complete`);
            }
          } catch (error) {
            logger.error({ message: 'Failed to cleanup demo user on signout', error: error as Error });
          }
        })();
      },
    },
  };
}

import { expo } from '@better-auth/expo';
import { oauthProvider } from '@better-auth/oauth-provider';
import { passkey } from '@better-auth/passkey';
import { PASSWORD_MAX_LENGTH, PASSWORD_MIN_LENGTH } from '@bt/shared/const/auth';
import { OAUTH_PROVIDERS_LIST } from '@bt/shared/types';
import { EnvVar, isEnvConfigured } from '@common/utils/env';
import { createSessionHooks } from '@config/auth-hooks/session-hooks';
import { shouldUseSecureCookies } from '@config/should-use-secure-cookies';
import { isAuthApiError } from '@controllers/helpers/error-handler';
import { t } from '@i18n/index';
import { logger } from '@js/utils/logger';
import { identifyUser, trackSignup } from '@js/utils/posthog';
import { captureException } from '@js/utils/sentry';
import { CLIENT_IP_HEADER } from '@middlewares/client-ip-header';
import { redisClient } from '@root/redis-client';
import { appName, fromEmail, isEmailEnabled } from '@services/email';
import { sendEmail } from '@services/email/send-email';
import { createAppUserWithUniqueUsername, seedUserDefaults } from '@services/user/create-user-with-defaults.service';
import { sendPasswordResetEmail } from '@services/user/send-password-reset-email';
import { areSignupsOpen } from '@services/user/signups-open.service';
import bcrypt from 'bcryptjs';
import { APIError, betterAuth } from 'better-auth';
import { jwt } from 'better-auth/plugins';
import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';

// Fail-fast: AUTH_ORIGIN must be set in production. Without it, OAuth error
// redirects, login/consent pages, and trusted origins all fall back to
// localhost:8100, which would break the auth flow on the live site.
if (process.env.NODE_ENV === 'production' && !process.env.AUTH_ORIGIN) {
  throw new Error(
    'AUTH_ORIGIN env var is required in production (used by trustedOrigins, OAuth pages, passkey origin, and error redirects).',
  );
}

// Create a separate pg Pool for better-auth
// This is required because better-auth uses raw SQL queries
const pool = new Pool({
  host: process.env.APPLICATION_DB_HOST,
  port: parseInt(process.env.APPLICATION_DB_PORT as string, 10),
  user: process.env.APPLICATION_DB_USERNAME,
  password: process.env.APPLICATION_DB_PASSWORD,
  // In test environment, use per-worker database (same as Sequelize)
  database:
    process.env.NODE_ENV === 'test' && process.env.JEST_WORKER_ID
      ? `${process.env.APPLICATION_DB_DATABASE}-${process.env.JEST_WORKER_ID}`
      : process.env.APPLICATION_DB_DATABASE,
});

// Without a listener, an idle client killed by Postgres (e.g. DB restart) crashes the process.
pool.on('error', (error) => logger.error({ message: 'better-auth pg pool idle client error', error }));

// In dev mode, trust the common localhost variants of the frontend port so a
// self-host setup with a misconfigured ALLOWED_ORIGINS still completes auth.
// Mirrors the localhost allow-list in setup-middleware.ts's CORS check.
// Fixed window: the first hit sets the key TTL, later hits only increment, so INCR and
// EXPIRE must be one atomic step or two hits racing on a fresh key leave it with no TTL.
const RATE_LIMIT_CONSUME_SCRIPT = `
local count = redis.call('INCR', KEYS[1])
if count == 1 then redis.call('EXPIRE', KEYS[1], ARGV[1]) end
if count > tonumber(ARGV[2]) then return { 0, redis.call('TTL', KEYS[1]) } end
return { 1, 0 }
`;
const SESSION_COOKIE_CACHE_MAX_AGE = 5 * 60;

const OAUTH_BASE_URL = process.env.BETTER_AUTH_URL || 'https://localhost:8081';
const OAUTH_MCP_URL = process.env.MCP_BASE_URL || OAUTH_BASE_URL;
// MCP clients send the resource URL (e.g. https://mcp.moneymatter.app/mcp) as the token audience.
export const OAUTH_RESOURCE_IDENTIFIERS = [...new Set([OAUTH_BASE_URL, OAUTH_MCP_URL, `${OAUTH_MCP_URL}/mcp`])];
const DEFAULT_SESSION_CACHE_VERSION = '1';
const sessionCacheVersionKey = ({ userId }: { userId: string }) => `auth:session-cache-version:${userId}`;

const DEV_TRUSTED_ORIGINS =
  process.env.NODE_ENV === 'development'
    ? ['http://localhost:8100', 'https://localhost:8100', 'http://127.0.0.1:8100', 'https://127.0.0.1:8100']
    : [];

export const auth = betterAuth({
  database: pool,
  basePath: '/api/v1/auth',
  baseURL: process.env.BETTER_AUTH_URL || 'https://localhost:8081',
  trustedOrigins: [
    process.env.AUTH_ORIGIN || 'https://localhost:8100',
    ...(process.env.ALLOWED_ORIGINS || '')
      .split(',')
      .map((o) => o.trim())
      .filter(Boolean),
    ...DEV_TRUSTED_ORIGINS,
    // Native iOS app: callback scheme, and the `expo-origin` value its cookie-bearing requests must send.
    // Kept out of ALLOWED_ORIGINS, which also feeds browser CORS.
    'moneymatter://',
  ],

  // Custom table names with ba_ prefix to avoid conflicts
  user: {
    modelName: 'ba_user',
  },
  session: {
    modelName: 'ba_session',
    expiresIn: 60 * 60 * 24 * 7, // 7 days
    updateAge: 60 * 60 * 24, // Refresh session daily
    // Required by @better-auth/oauth-provider – sessions must be persisted in DB
    storeSessionInDatabase: true,
    // Cache session data in a signed cookie to avoid DB lookups on every request.
    // Reduces ba_user queries from ~3.7k/week to ~100-200 (once per 5min per session).
    cookieCache: {
      enabled: true,
      maxAge: SESSION_COOKIE_CACHE_MAX_AGE,
      // Bumped on password reset so cached cookies minted before it stop being trusted immediately.
      // On Redis failure, return a version no cookie carries so the session is re-read from the DB.
      version: async (_session, user) => {
        try {
          return (await redisClient.get(sessionCacheVersionKey({ userId: user.id }))) ?? DEFAULT_SESSION_CACHE_VERSION;
        } catch (error) {
          logger.warn('Failed to read session cache version', { error: (error as Error).message });
          return randomUUID();
        }
      },
    },
  },
  account: {
    modelName: 'ba_account',
    // Allow auto-linking OAuth accounts to existing users with matching verified email
    // This is the standard behavior for most apps - if someone controls an OAuth account
    // with a verified email, they're the legitimate owner of that email
    accountLinking: {
      enabled: true,
      trustedProviders: [...OAUTH_PROVIDERS_LIST],
    },
  },
  verification: {
    modelName: 'ba_verification',
  },

  // Email and password authentication
  emailAndPassword: {
    enabled: true,
    requireEmailVerification: isEmailEnabled,
    minPasswordLength: PASSWORD_MIN_LENGTH,
    maxPasswordLength: PASSWORD_MAX_LENGTH,
    // Cost 12 follows OWASP 2026 guidance.
    password: {
      hash: async (password: string) => {
        const salt = bcrypt.genSaltSync(12);
        return bcrypt.hashSync(password, salt);
      },
      verify: async ({ password, hash }: { password: string; hash: string }) => {
        return bcrypt.compareSync(password, hash);
      },
    },
    revokeSessionsOnPasswordReset: true,
    ...(isEmailEnabled && {
      sendResetPassword: async ({ user, url }) => {
        // Not awaited: a send round-trip only for existing accounts would reveal which emails are registered.
        void sendPasswordResetEmail({ email: user.email, url, userId: user.id });
      },
    }),
    // Holding the reset link proves inbox ownership; without this, requireEmailVerification would block sign-in.
    // Steps never throw: better-auth's own deleteUserSessions runs after this hook as a backstop.
    onPasswordReset: async ({ user }) => {
      const steps: [string, () => Promise<unknown>][] = [
        ['delete sessions', () => pool.query('DELETE FROM ba_session WHERE "userId" = $1', [user.id])],
        [
          'revoke OAuth access tokens',
          () => pool.query('DELETE FROM ba_oauth_access_token WHERE "userId" = $1', [user.id]),
        ],
        [
          'revoke OAuth refresh tokens',
          () => pool.query('DELETE FROM ba_oauth_refresh_token WHERE "userId" = $1', [user.id]),
        ],
        // Only needs to outlive cookies minted before the reset; after expiry the default version is harmless.
        [
          'bump session cache version',
          () =>
            redisClient.set(
              sessionCacheVersionKey({ userId: user.id }),
              String(Date.now()),
              'EX',
              SESSION_COOKIE_CACHE_MAX_AGE,
            ),
        ],
        [
          'mark email verified',
          () =>
            pool.query('UPDATE ba_user SET "emailVerified" = true WHERE id = $1 AND "emailVerified" = false', [
              user.id,
            ]),
        ],
      ];
      for (const [step, run] of steps) {
        try {
          await run();
        } catch (error) {
          logger.error({ message: `Password reset: failed to ${step}`, error: error as Error }, { userId: user.id });
        }
      }
    },
  },

  // Email verification via Resend
  emailVerification: {
    sendOnSignUp: true,
    autoSignInAfterVerification: true,
    sendVerificationEmail: async ({ user, url }) => {
      try {
        const result = await sendEmail({
          from: `${appName} <${fromEmail}>`,
          to: user.email,
          subject: `Verify your ${appName} email`,
          html: `
            <div style="font-family: sans-serif; max-width: 600px; margin: 0 auto;">
              <h2>Welcome to ${appName}!</h2>
              <p>Please verify your email address by clicking the button below:</p>
              <p style="margin: 24px 0;">
                <a href="${url}" style="background-color: #0070f3; color: white; padding: 12px 24px; text-decoration: none; border-radius: 6px; display: inline-block;">
                  Verify Email
                </a>
              </p>
              <p style="color: #666; font-size: 14px;">
                Or copy and paste this link: <br/>
                <a href="${url}" style="color: #0070f3;">${url}</a>
              </p>
              <p style="color: #999; font-size: 12px; margin-top: 32px;">
                If you didn't create an account, you can safely ignore this email.
              </p>
            </div>
          `,
        });
        if (result) {
          logger.info(`Verification email sent to ${user.email}, resendId: ${result.data?.id}`);
        }
      } catch (error) {
        logger.error({ message: 'Failed to send verification email', error: error as Error });
        throw error;
      }
    },
  },

  // OAuth providers
  socialProviders: {
    google: {
      clientId: process.env.GOOGLE_CLIENT_ID || '',
      clientSecret: process.env.GOOGLE_CLIENT_SECRET || '',
      enabled:
        isEnvConfigured(EnvVar.GOOGLE_CLIENT_ID, process.env.GOOGLE_CLIENT_ID) &&
        isEnvConfigured(EnvVar.GOOGLE_CLIENT_SECRET, process.env.GOOGLE_CLIENT_SECRET),
    },
    github: {
      clientId: process.env.GITHUB_CLIENT_ID || '',
      clientSecret: process.env.GITHUB_CLIENT_SECRET || '',
      enabled:
        isEnvConfigured(EnvVar.GITHUB_CLIENT_ID, process.env.GITHUB_CLIENT_ID) &&
        isEnvConfigured(EnvVar.GITHUB_CLIENT_SECRET, process.env.GITHUB_CLIENT_SECRET),
    },
  },

  // Plugins
  plugins: [
    // jwt() must be loaded because @better-auth/oauth-provider references it
    // internally even when disableJwtPlugin is true (unguarded getJwtPlugin calls).
    jwt({
      // Nothing reads the `set-auth-jwt` header; leaving it on costs a ba_jwks
      // query and a JWT signature on every getSession call.
      disableSettingJwtHeader: true,
      schema: {
        jwks: { modelName: 'ba_jwks' },
      },
    }),
    oauthProvider({
      loginPage: `${process.env.AUTH_ORIGIN || 'https://localhost:8100'}/sign-in`,
      consentPage: `${process.env.AUTH_ORIGIN || 'https://localhost:8100'}/oauth/authorize`,
      // 'claudeai' is a no-op scope required as a workaround: Claude.ai adds it to
      // client registration requests and better-auth rejects unknown scopes with 400.
      // See: https://github.com/anthropics/claude-ai-mcp/issues/111
      // finance:write and finance:delete gate mutation tools. They're accepted by the
      // consent flow but not advertised in public metadata until the first tool using
      // them ships – see oauth-metadata.route.ts and the static .well-known mirrors.
      scopes: ['finance:read', 'finance:write', 'finance:delete', 'profile:read', 'offline_access', 'claudeai'],
      accessTokenExpiresIn: 72 * 60 * 60, // 72 hours
      refreshTokenExpiresIn: 60 * 24 * 60 * 60, // 60 days
      allowDynamicClientRegistration: true,
      allowUnauthenticatedClientRegistration: true,
      grantTypes: ['authorization_code', 'refresh_token'],
      // Use opaque tokens stored in DB (not JWTs) – our MCP auth verifies via DB lookup
      disableJwtPlugin: true,
      resources: OAUTH_RESOURCE_IDENTIFIERS,
      // Clients self-register (Claude.ai etc.) and get no ba_oauth_client_resource links,
      // so per-client linkage would reject every token request with invalid_target.
      enforcePerClientResources: false,
      schema: {
        oauthClient: { modelName: 'ba_oauth_client' },
        oauthAccessToken: { modelName: 'ba_oauth_access_token' },
        oauthRefreshToken: { modelName: 'ba_oauth_refresh_token' },
        oauthConsent: { modelName: 'ba_oauth_consent' },
        oauthResource: { modelName: 'ba_oauth_resource' },
        oauthClientResource: { modelName: 'ba_oauth_client_resource' },
        oauthClientAssertion: { modelName: 'ba_oauth_client_assertion' },
      },
    }),
    passkey({
      rpID: process.env.AUTH_RP_ID || 'localhost',
      rpName: process.env.AUTH_RP_NAME || 'MoneyMatter',
      origin: process.env.AUTH_ORIGIN || 'https://localhost:8100',
      schema: {
        passkey: {
          modelName: 'ba_passkey',
        },
      },
    }),
    // Native iOS app: /expo-authorization-proxy for OAuth, and the session cookie appended
    // as ?cookie= on redirects to non-http trusted callbacks. Web flows are untouched.
    expo(),
  ],

  // Enable rate limiting in production only. Disable in test/dev/preview
  // environments to avoid flaky Playwright tests and local dev friction.
  rateLimit: {
    enabled: process.env.NODE_ENV === 'production' && process.env.DISABLE_AUTH_RATE_LIMIT !== 'true',
    // The default in-memory store only evicts a key when that same key is read
    // again after expiry, so entries for IPs that never return are kept forever.
    customStorage: {
      consume: async (key, rule) => {
        const [allowed, ttl] = (await redisClient.eval(
          RATE_LIMIT_CONSUME_SCRIPT,
          1,
          `auth-rate-limit:${key}`,
          rule.window,
          rule.max,
        )) as [number, number];
        return { allowed: allowed === 1, retryAfter: allowed === 1 ? null : Math.max(ttl, 1) };
      },
    },
  },

  // Advanced options
  advanced: {
    // better-auth's `x-forwarded-for` reader rejects multi-hop chains, and its `trustedProxies` can't see
    // the socket peer, so it would believe a forged header. Read the address Express resolved instead.
    ipAddress: { ipAddressHeaders: [CLIENT_IP_HEADER] },
    // Cookie settings for session. The prefix is overridable because cookies are
    // keyed by host, not port: parallel git worktrees all share `localhost`, so a
    // shared prefix means signing into one worktree overwrites another's session
    // cookie. Each worktree sets a distinct prefix (see scripts/docker-dev.sh) so
    // their session cookies coexist.
    cookiePrefix: process.env.BETTER_AUTH_COOKIE_PREFIX || 'bt_auth',
    // Secure cookies only when the app is actually served over https – a
    // production build served over plain http (self-host trial on a LAN IP)
    // would otherwise have its session cookie silently dropped by the
    // browser. Rationale in shouldUseSecureCookies.
    useSecureCookies: shouldUseSecureCookies({
      nodeEnv: process.env.NODE_ENV,
      betterAuthUrl: process.env.BETTER_AUTH_URL,
    }),
  },

  // Error handling - redirect OAuth errors to frontend callback page
  onAPIError: {
    // Defining onError replaces better-auth's own error logging, so 4xx are
    // logged too (info: Loki only, no Sentry noise from failed logins).
    onError: (error) => {
      if (isAuthApiError(error) && error.statusCode < 500) {
        logger.info(`better-auth ${error.statusCode}: ${error.message}`, { code: error.body?.code });
        return;
      }
      logger.error({ message: 'better-auth API error', error: error as Error });
    },
    errorURL: process.env.AUTH_ORIGIN
      ? `${process.env.AUTH_ORIGIN}/auth/callback`
      : 'https://localhost:8100/auth/callback',
  },

  // Callbacks for user lifecycle events
  databaseHooks: {
    user: {
      create: {
        // Guard user-create, not the email endpoint: OAuth signups must hit the
        // cap too. Not race-safe under concurrent signups; fine at self-host scale.
        before: async (user) => {
          if (!(await areSignupsOpen())) {
            throw new APIError('FORBIDDEN', {
              message: t({ key: 'auth.errors.signupsDisabled' }),
              code: 'SIGNUPS_DISABLED',
            });
          }
          return { data: user };
        },
        // After a new auth user is created, create the matching app user.
        //
        // Better-auth commits ba_user/ba_account BEFORE this hook fires, so
        // failures here have two distinct shapes:
        //
        //   1. App-user creation fails (no Users row at all). The user is
        //      unusable: they can't retry signup (email taken in ba_user) and
        //      can't sign in (no app user → 401). We delete the orphan
        //      ba_user (cascades to ba_account/ba_session) and re-throw so
        //      the signup endpoint returns 5xx and the client can retry.
        //
        //   2. Default seeding fails AFTER the user row exists. The account
        //      is usable; categories/tags can be reconciled manually. We log
        //      to Sentry and return – better than locking out a working
        //      account because of a non-critical seed step.
        after: async (user) => {
          // Trim user.name at the source so whitespace-only values (e.g. " ")
          // are treated as missing – without this they're truthy and skip
          // the email-prefix fallback, producing a generic "user" slug.
          const trimmedName = typeof user.name === 'string' ? user.name.trim() : '';
          // `username` becomes the slug; `fullName` becomes firstName/lastName.
          // We deliberately don't pass the email-prefix or "user" fallbacks as
          // fullName – those aren't real human names and would clutter the
          // display fields.
          const usernameSource = trimmedName || user.email?.split('@')[0] || 'user';
          let appUser: Awaited<ReturnType<typeof createAppUserWithUniqueUsername>>;

          try {
            logger.info(`Creating app user profile for auth user: ${user.id}`);
            appUser = await createAppUserWithUniqueUsername({
              username: usernameSource,
              fullName: trimmedName || null,
              authUserId: user.id,
              email: user.email,
            });
            logger.info(`Successfully created app user profile with id: ${appUser.id}`);
          } catch (error) {
            logger.error({
              message: 'Failed to create app user – rolling back ba_user',
              error: error as Error,
            });
            captureException({
              error,
              context: {
                stage: 'createAppUserWithUniqueUsername',
                authUserId: user.id,
                email: user.email,
                requestedName: user.name,
                errorName: error instanceof Error ? error.name : 'unknown',
              },
            });

            // Compensating delete so the email is freed and the user can
            // retry signup. ba_account / ba_session cascade via FK.
            try {
              await pool.query('DELETE FROM ba_user WHERE id = $1', [user.id]);
            } catch (rollbackError) {
              // Critical: original signup failed AND we couldn't free the
              // email. The user is locked out until ops intervenes. Log to
              // both Sentry (production) and the local logger (so non-prod
              // environments without DSN still surface the issue).
              logger.error({
                message: 'CRITICAL: failed to roll back orphaned ba_user; user locked out',
                error: rollbackError as Error,
              });
              captureException({
                error: rollbackError,
                context: {
                  stage: 'rollbackOrphanBaUser',
                  authUserId: user.id,
                  email: user.email,
                  originalError: error instanceof Error ? error.message : String(error),
                },
              });
            }

            throw error;
          }

          try {
            await seedUserDefaults({ userId: appUser.id });
          } catch (error) {
            logger.error({
              message: 'Failed to seed default categories/tags for new user (non-fatal)',
              error: error as Error,
            });
            captureException({
              error,
              context: {
                stage: 'seedUserDefaults',
                authUserId: user.id,
                appUserId: appUser.id,
                errorName: error instanceof Error ? error.name : 'unknown',
              },
            });
            // Do NOT re-throw: the user has a usable app account, partial
            // seed state is recoverable manually.
          }

          try {
            identifyUser({
              userId: appUser.id,
              properties: {
                email: user.email,
                username: appUser.username,
                createdAt: new Date().toISOString(),
              },
            });

            // Determine signup method based on accounts
            // Note: At this point we don't have easy access to the account type,
            // so we track it as 'email' by default. OAuth signups will be tracked
            // separately if needed.
            trackSignup({
              userId: appUser.id,
              email: user.email,
              username: appUser.username,
              method: 'email',
            });
          } catch (analyticsError) {
            logger.warn('Analytics tracking failed during signup (non-fatal)', {
              error: analyticsError instanceof Error ? analyticsError.message : String(analyticsError),
              authUserId: user.id,
            });
          }
        },
      },
    },
    session: createSessionHooks({ pool }),
  },
});

// Also export the pool for migrations
export { pool as authPool };

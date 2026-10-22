/**
 * Mock implementation of better-auth for Jest tests.
 * Re-exports from the actual package where possible, mocks ESM-only parts.
 */
import { requestContext } from '@common/request-context';
import { connection } from '@models/index';
import { isIP } from 'node:net';

// Types and non-ESM exports can come from actual package
// For now, provide a basic mock that supports our test scenarios

interface BetterAuthConfig {
  database: unknown;
  basePath?: string;
  user?: { modelName?: string };
  session?: { modelName?: string; expiresIn?: number; updateAge?: number };
  account?: { modelName?: string };
  emailAndPassword?: {
    enabled?: boolean;
    sendResetPassword?: unknown;
    password?: {
      hash?: (password: string) => Promise<string>;
      verify?: (params: { password: string; hash: string }) => Promise<boolean>;
    };
  };
  socialProviders?: Record<string, unknown>;
  plugins?: unknown[];
  advanced?: { ipAddress?: { ipAddressHeaders?: string[] } } & Record<string, unknown>;
  databaseHooks?: {
    user?: {
      create?: {
        before?: (user: unknown) => Promise<unknown>;
        after?: (user: unknown) => Promise<void>;
      };
    };
  };
}

/** Stand-in for better-auth's APIError: hooks throw it to abort with a specific HTTP status. */
export class APIError extends Error {
  status: string | number;
  body?: { message?: string; code?: string };
  statusCode: number;

  constructor(status: string | number = 'INTERNAL_SERVER_ERROR', body?: { message?: string; code?: string }) {
    super(body?.message);
    this.name = 'APIError';
    this.status = status;
    this.body = body;
    const named: Record<string, number> = {
      BAD_REQUEST: 400,
      UNAUTHORIZED: 401,
      FORBIDDEN: 403,
      NOT_FOUND: 404,
      CONFLICT: 409,
      UNPROCESSABLE_ENTITY: 422,
      TOO_MANY_REQUESTS: 429,
      INTERNAL_SERVER_ERROR: 500,
    };
    this.statusCode = typeof status === 'number' ? status : (named[status] ?? 500);
  }
}

interface SignInEmailParams {
  body: { email: string; password: string; rememberMe?: boolean };
  headers?: unknown;
  asResponse?: boolean;
}

interface AuthInstance {
  handler: (request: Request) => Promise<Response>;
  api: {
    getSession: (params: { headers: unknown }) => Promise<{ user: unknown; session: unknown } | null>;
    signInEmail: (params: SignInEmailParams) => Promise<Response>;
    setPassword: (params: { body: { newPassword: string }; headers: unknown }) => Promise<{ status: boolean }>;
  };
}

// Session storage for tracking users across signup/session calls
// Map of session token -> user object
const sessionStore = new Map<string, { id: string; email: string; name?: string }>();

/**
 * Register a session in the mock session store.
 * Useful for tests that create sessions outside the normal auth flow (e.g., demo users).
 */
export function registerMockSession(sessionToken: string, user: { id: string; email: string; name?: string }): void {
  sessionStore.set(sessionToken, user);
}

/**
 * Clear a session from the mock session store.
 */
export function clearMockSession(sessionToken: string): void {
  sessionStore.delete(sessionToken);
}

/**
 * Clear all sessions from the mock session store.
 * Useful for test cleanup.
 */
export function clearAllMockSessions(): void {
  sessionStore.clear();
}

/**
 * Extracts the session token value from a cookie string.
 */
function extractSessionToken(cookie: string | undefined): string | null {
  if (!cookie) return null;
  const match = cookie.match(/bt_auth\.session_token=([^;]+)/);
  return match?.[1] ?? null;
}

/**
 * Resolves the signed-in user from request headers. Accepts a Fetch `Headers` instance
 * (real better-auth shape) or a plain object.
 */
function resolveSession(
  headers: unknown,
): { user: { id: string; email: string; name?: string }; token: string } | null {
  let cookie: string | undefined;
  if (headers instanceof Headers) {
    cookie = headers.get('cookie') ?? headers.get('Cookie') ?? undefined;
  } else {
    const headerObj = headers as Record<string, string | undefined>;
    cookie = headerObj.cookie || headerObj.Cookie;
  }
  const token = extractSessionToken(cookie);
  if (!token) return null;
  const user = sessionStore.get(token);
  return user ? { user, token } : null;
}

/**
 * Approximates better-auth's `getIp`: first header in `ipAddressHeaders` holding exactly one valid IP.
 * Skips its IPv6 /64 masking and its dev/test `127.0.0.1` fallback.
 */
function resolveSessionIpAddress({ config, headers }: { config: BetterAuthConfig; headers: Headers }): string {
  const headerNames = config.advanced?.ipAddress?.ipAddressHeaders ?? ['x-forwarded-for'];

  for (const name of headerNames) {
    const value = headers.get(name)?.trim();
    if (value && isIP(value)) return value;
  }

  return '';
}

/**
 * Creates a better-auth instance.
 * This is a simplified mock that provides the essential API shape.
 */
export function betterAuth(config: BetterAuthConfig): AuthInstance {
  // Store config for later use
  const basePath = config.basePath || '/api/auth';

  return {
    handler: async (request: Request): Promise<Response> => {
      const url = new URL(request.url);
      const path = url.pathname.replace(basePath, '');

      // Basic routing for auth endpoints
      if (path === '/sign-up/email' && request.method === 'POST') {
        const body = (await request.json()) as { email: string; name: string };

        // Extract locale from Accept-Language header for locale-aware signup
        // Note: supertest sends headers in lowercase
        const acceptLanguage = request.headers.get('Accept-Language') || request.headers.get('accept-language');
        const locale = acceptLanguage?.split(',')[0]?.split('-')[0] || 'en';

        const newUser = {
          id: `test-user-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
          email: body.email,
          name: body.name,
        };
        const sessionToken = `test-token-${newUser.id}`;

        // Real better-auth runs the before-hook prior to inserting ba_user
        // and turns a thrown APIError into the response.
        if (config.databaseHooks?.user?.create?.before) {
          try {
            await config.databaseHooks.user.create.before(newUser);
          } catch (err) {
            if (err instanceof APIError) {
              return new Response(JSON.stringify({ message: err.body?.message, code: err.body?.code }), {
                status: err.statusCode,
                headers: { 'Content-Type': 'application/json' },
              });
            }
            throw err;
          }
        }

        // Persist the auth user to mirror better-auth's real behavior:
        // ba_user (and ba_account) are committed BEFORE the after-hook fires.
        // Tests that exercise rollback / orphan-cleanup paths need this row
        // to actually exist so the hook's compensating DELETE has something
        // to remove. Email-collision returns a 409 to mimic better-auth.
        try {
          await connection.sequelize.query(
            `INSERT INTO ba_user (id, name, email, "emailVerified", "createdAt", "updatedAt")
             VALUES (:id, :name, :email, false, NOW(), NOW())`,
            { replacements: { id: newUser.id, name: body.name, email: body.email } },
          );
        } catch {
          return new Response(JSON.stringify({ message: 'Email already in use' }), {
            status: 409,
            headers: { 'Content-Type': 'application/json' },
          });
        }

        // Call databaseHooks.user.create.after. If it throws, propagate so
        // the upstream toNodeHandler can convert it to a 5xx response — this
        // matches real better-auth behaviour and lets tests assert on the
        // rollback path.
        if (config.databaseHooks?.user?.create?.after) {
          await requestContext.run({ locale }, async () => {
            await config.databaseHooks!.user!.create!.after!(newUser);
          });
        }

        // Hook succeeded — register the session for subsequent requests.
        sessionStore.set(sessionToken, newUser);

        return new Response(
          JSON.stringify({
            user: newUser,
            session: {
              id: 'test-session-id',
              token: sessionToken,
              ipAddress: resolveSessionIpAddress({ config, headers: request.headers }),
            },
          }),
          {
            status: 200,
            headers: {
              'Content-Type': 'application/json',
              'Set-Cookie': `bt_auth.session_token=${sessionToken}; Path=/; HttpOnly`,
            },
          },
        );
      }

      if (path === '/sign-in/email' && request.method === 'POST') {
        const body = (await request.json()) as { email: string };
        const user = { id: 'test-user-id', email: body.email };
        const sessionToken = 'test-token';

        // Store session for later lookup
        sessionStore.set(sessionToken, user);

        return new Response(
          JSON.stringify({
            user,
            session: {
              id: 'test-session-id',
              token: sessionToken,
              ipAddress: resolveSessionIpAddress({ config, headers: request.headers }),
            },
          }),
          {
            status: 200,
            headers: {
              'Content-Type': 'application/json',
              'Set-Cookie': `bt_auth.session_token=${sessionToken}; Path=/; HttpOnly`,
            },
          },
        );
      }

      if (path === '/get-session' && request.method === 'GET') {
        const cookie = request.headers.get('Cookie');
        const sessionToken = extractSessionToken(cookie || undefined);

        if (sessionToken) {
          const user = sessionStore.get(sessionToken);
          if (user) {
            return new Response(
              JSON.stringify({
                user,
                session: { id: 'test-session-id', token: sessionToken },
              }),
              { status: 200, headers: { 'Content-Type': 'application/json' } },
            );
          }
        }
        return new Response(JSON.stringify({ session: null, user: null }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }

      if (
        path === '/request-password-reset' &&
        request.method === 'POST' &&
        !config.emailAndPassword?.sendResetPassword
      ) {
        return new Response(
          JSON.stringify({ message: "Reset password isn't enabled", code: 'RESET_PASSWORD_DISABLED' }),
          { status: 400, headers: { 'Content-Type': 'application/json' } },
        );
      }

      if (path === '/sign-out' && request.method === 'POST') {
        return new Response(JSON.stringify({ success: true }), {
          status: 200,
          headers: {
            'Content-Type': 'application/json',
            'Set-Cookie': 'bt_auth.session_token=; Path=/; Expires=Thu, 01 Jan 1970 00:00:00 GMT',
          },
        });
      }

      // Mirrors better-auth's origin check: any `Cookie` header demands an `Origin` header.
      if (path === '/oauth2/register' && request.method === 'POST') {
        if (request.headers.has('cookie') && !request.headers.get('origin')) {
          return new Response(JSON.stringify({ message: 'Missing or null Origin', code: 'MISSING_OR_NULL_ORIGIN' }), {
            status: 403,
            headers: { 'Content-Type': 'application/json' },
          });
        }

        const body = (await request.json()) as Record<string, unknown>;
        return new Response(JSON.stringify({ ...body, client_id: `test-registered-client-${crypto.randomUUID()}` }), {
          status: 201,
          headers: { 'Content-Type': 'application/json' },
        });
      }

      // Default: not found
      return new Response(JSON.stringify({ error: 'Not found' }), {
        status: 404,
        headers: { 'Content-Type': 'application/json' },
      });
    },

    api: {
      getSession: async ({ headers }: { headers: unknown }) => {
        const session = resolveSession(headers);
        if (!session) return null;
        return {
          user: session.user,
          session: { id: 'test-session-id', token: session.token },
        };
      },

      setPassword: async ({ headers }: { body: { newPassword: string }; headers: unknown }) => {
        const session = resolveSession(headers);
        if (!session) {
          throw new APIError('UNAUTHORIZED', { message: 'Unauthorized', code: 'UNAUTHORIZED' });
        }

        const [existing] = await connection.sequelize.query(
          `SELECT id FROM ba_account WHERE "userId" = :userId AND "providerId" = 'credential' LIMIT 1`,
          { replacements: { userId: session.user.id } },
        );
        if ((existing as unknown[]).length > 0) {
          throw new APIError('BAD_REQUEST', {
            message: 'User already has a password set',
            code: 'PASSWORD_ALREADY_SET',
          });
        }

        await connection.sequelize.query(
          `INSERT INTO ba_account (id, "userId", "accountId", "providerId", password, "createdAt", "updatedAt")
           VALUES (:id, :userId, :userId, 'credential', 'hashed_password', NOW(), NOW())`,
          { replacements: { id: `${session.user.id}-credential`, userId: session.user.id } },
        );

        return { status: true };
      },

      signInEmail: async ({ body, asResponse }: SignInEmailParams) => {
        // Look up user by email - in tests, we assume the user exists
        // The demo flow creates the user in the database before calling signInEmail
        const sessionToken = `demo-token-${Date.now()}`;
        const user = { id: `auth-user-for-${body.email}`, email: body.email };

        // Store session for later lookup
        sessionStore.set(sessionToken, user);

        const responseData = {
          redirect: false,
          token: sessionToken,
          url: null,
          user,
        };

        if (asResponse) {
          return new Response(JSON.stringify(responseData), {
            status: 200,
            headers: {
              'Content-Type': 'application/json',
              'Set-Cookie': `bt_auth.session_token=${sessionToken}; Path=/; HttpOnly`,
            },
          });
        }

        // If not asResponse, this would normally return just the data
        // but our interface expects Response for simplicity
        return new Response(JSON.stringify(responseData), {
          status: 200,
          headers: {
            'Content-Type': 'application/json',
            'Set-Cookie': `bt_auth.session_token=${sessionToken}; Path=/; HttpOnly`,
          },
        });
      },
    },
  };
}

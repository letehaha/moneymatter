/**
 * Mock implementation of better-auth/api for Jest tests.
 * The mocked `betterAuth` never runs plugin hooks, so the wrapper only has to exist.
 */
export function createAuthMiddleware<T>(handler: T): T {
  return handler;
}

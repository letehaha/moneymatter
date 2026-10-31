/**
 * Mock implementation of better-auth/plugins for Jest tests.
 */

/**
 * Creates a JWT plugin for better-auth.
 * This is a simplified mock that provides the essential API shape.
 */
export function jwt() {
  return {
    id: 'jwt',
    init: () => ({}),
  };
}

export function genericOAuth() {
  return {
    id: 'generic-oauth',
    init: () => ({}),
  };
}

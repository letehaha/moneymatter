import { createHash } from 'node:crypto';

/**
 * Hash a token the same way better-auth stores it: SHA-256, base64url, no padding.
 */
export function hashToken({ token }: { token: string }): string {
  const hash = createHash('sha256').update(token).digest();
  return hash.toString('base64url');
}

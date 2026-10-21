import { describe, expect, it } from '@jest/globals';

import { hashToken } from './hash-token';

describe('hashToken', () => {
  it('returns the SHA-256 digest as unpadded base64url, the way better-auth stores tokens', () => {
    // Digest of the literal below, computed independently with `openssl dgst -sha256 -binary`.
    expect(hashToken({ token: 'mm-test-token' })).toBe('7nJScpKw3okGoSfrAyz-9ZOcsCq6dRoAVVI3IM-PPF4');
  });

  it('is deterministic and differs between tokens', () => {
    expect(hashToken({ token: 'a' })).toBe(hashToken({ token: 'a' }));
    expect(hashToken({ token: 'a' })).not.toBe(hashToken({ token: 'b' }));
  });

  it('contains no padding or url-unsafe characters', () => {
    expect(hashToken({ token: 'anything' })).toMatch(/^[A-Za-z0-9_-]{43}$/);
  });
});

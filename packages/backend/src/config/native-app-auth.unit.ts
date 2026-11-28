import { describe, expect, it } from '@jest/globals';
import { createHash } from 'node:crypto';

import {
  APPLE_NONCE_ERROR,
  APP_STORE_BUNDLE_ID,
  checkAppleNonce,
  getAppCallbackOrigins,
  resolveNativeAppleAudience,
  resolveServerAuthority,
  stampServerOnAppRedirect,
} from './native-app-auth';

const sha256 = (value: string) => createHash('sha256').update(value).digest('hex');
const HEX = 'a1b2c3d4e5f60718'.repeat(4);
const AUTHORITY = 'moneymatter.app';

const tokenWithNonceClaim = ({ claim }: { claim: unknown }) =>
  ['{"alg":"RS256"}', JSON.stringify({ nonce: claim }), 'signature']
    .map((part) => Buffer.from(part).toString('base64url'))
    .join('.');

/** A token Apple would issue for an app that sent `sha256(nonce)`. */
const idTokenFor = ({ nonce }: { nonce: string }) => ({ token: tokenWithNonceClaim({ claim: sha256(nonce) }), nonce });

describe('resolveServerAuthority', () => {
  // Mirrored row for row in the iOS `Server.parse` tests, so the two normalisations cannot drift.
  it.each([
    ['https://budget.example.com', 'budget.example.com'],
    ['https://budget.example.com/', 'budget.example.com'],
    ['https://Budget.Example.COM', 'budget.example.com'],
    ['https://budget.example.com:443', 'budget.example.com'],
    ['https://budget.example.com:8443', 'budget.example.com:8443'],
    ['https://budget.example.com.', 'budget.example.com'],
    ['https://Budget.Example.com.:8443/app?x=1#y', 'budget.example.com:8443'],
    ['https://192.168.1.20', '192.168.1.20'],
    ['https://192.168.1.20:8443', '192.168.1.20:8443'],
    ['https://budget.example.com:80', 'budget.example.com:80'],
  ])('%s -> %s', (baseUrl, authority) => {
    expect(resolveServerAuthority({ baseUrl })).toBe(authority);
  });

  it.each([
    ['http://localhost:8080', 'localhost:8080'],
    ['http://localhost:80', 'localhost'],
    ['http://budget.example.com:443', 'budget.example.com:443'],
  ])('plain http: %s -> %s', (baseUrl, authority) => {
    expect(resolveServerAuthority({ baseUrl })).toBe(authority);
  });

  it.each(['', 'not a url', 'localhost:8080'])('is empty for a value with no host: "%s"', (baseUrl) => {
    expect(resolveServerAuthority({ baseUrl })).toBe('');
  });
});

describe('resolveNativeAppleAudience', () => {
  it('is off on cloud without a bundle id', () => {
    expect(resolveNativeAppleAudience({ selfHost: false, bundleId: undefined, nativeSignIn: undefined })).toBeNull();
  });

  it('uses the configured bundle id on cloud', () => {
    expect(resolveNativeAppleAudience({ selfHost: false, bundleId: 'com.example.app', nativeSignIn: undefined })).toBe(
      'com.example.app',
    );
  });

  it('defaults to the App Store bundle id on self-host', () => {
    expect(resolveNativeAppleAudience({ selfHost: true, bundleId: undefined, nativeSignIn: undefined })).toBe(
      APP_STORE_BUNDLE_ID,
    );
  });

  it('prefers the configured bundle id on self-host', () => {
    expect(resolveNativeAppleAudience({ selfHost: true, bundleId: 'com.example.app', nativeSignIn: undefined })).toBe(
      'com.example.app',
    );
  });

  it.each([
    { selfHost: true, bundleId: undefined },
    { selfHost: true, bundleId: 'com.example.app' },
    { selfHost: false, bundleId: 'com.example.app' },
  ])('is off when APPLE_NATIVE_SIGN_IN=false (%o)', (input) => {
    expect(resolveNativeAppleAudience({ ...input, nativeSignIn: 'false' })).toBeNull();
  });

  it.each(['FALSE', ' false ', 'False'])('is off for "%s"', (nativeSignIn) => {
    expect(resolveNativeAppleAudience({ selfHost: true, bundleId: undefined, nativeSignIn })).toBeNull();
  });

  it.each(['true', '', '0'])('stays on for "%s"', (nativeSignIn) => {
    expect(resolveNativeAppleAudience({ selfHost: true, bundleId: undefined, nativeSignIn })).toBe(APP_STORE_BUNDLE_ID);
  });
});

describe('getAppCallbackOrigins', () => {
  it('never trusts the self-host scheme on cloud', () => {
    expect(getAppCallbackOrigins({ selfHost: false })).toEqual(['moneymatter://']);
  });

  it('trusts both schemes on self-host', () => {
    expect(getAppCallbackOrigins({ selfHost: true })).toEqual(['moneymatter://', 'moneymatter-selfhost://']);
  });
});

describe('checkAppleNonce', () => {
  describe.each([
    { selfHost: false, validNonce: HEX },
    { selfHost: true, validNonce: `${AUTHORITY}|${HEX}` },
  ])('selfHost=$selfHost', ({ selfHost, validNonce }) => {
    const check = ({ idToken }: { idToken: unknown }) => checkAppleNonce({ idToken, selfHost, authority: AUTHORITY });
    const token = tokenWithNonceClaim({ claim: sha256(validNonce) });

    it('accepts the nonce whose hash the token carries', () => {
      expect(check({ idToken: { token, nonce: validNonce } })).toBeNull();
    });

    it.each([
      ['missing nonce', { token }],
      ['empty nonce', { token, nonce: '' }],
      ['non-string nonce', { token, nonce: 42 }],
      ['array nonce', { token, nonce: [validNonce] }],
      ['idToken that is not an object', 'token'],
      ['missing token', { nonce: validNonce }],
      ['non-string token', { token: 42, nonce: validNonce }],
      ['token that is not a JWT', { token: 'garbage', nonce: validNonce }],
      ['token with a non-JSON payload', { token: 'a.b.c', nonce: validNonce }],
      ['token whose payload is null', { token: `a.${Buffer.from('null').toString('base64url')}.c`, nonce: validNonce }],
      ['token without a nonce claim', { token: tokenWithNonceClaim({ claim: undefined }), nonce: validNonce }],
      [
        'nonce the token was not issued for',
        { token: tokenWithNonceClaim({ claim: sha256('other') }), nonce: validNonce },
      ],
      // better-auth alone accepts this: its nonce check also passes on an exact match with the claim.
      ['the hash itself passed as the nonce', { token, nonce: sha256(validNonce) }],
      [
        'a raw nonce stored in the claim unhashed',
        { token: tokenWithNonceClaim({ claim: validNonce }), nonce: validNonce },
      ],
    ])('rejects %s', (_name, idToken) => {
      expect(check({ idToken })).toBe(APPLE_NONCE_ERROR.invalid);
    });
  });

  describe('cloud shape', () => {
    const check = ({ nonce }: { nonce: string }) =>
      checkAppleNonce({ idToken: idTokenFor({ nonce }), selfHost: false, authority: AUTHORITY });

    it.each([
      ['a nonce bound to a self-hosted server', `evil.example|${HEX}`],
      ['a nonce bound to its own authority', `${AUTHORITY}|${HEX}`],
      ['uppercase hex', HEX.toUpperCase()],
      ['63 characters', HEX.slice(1)],
      ['65 characters', `${HEX}a`],
      ['a trailing newline', `${HEX}\n`],
      ['non-hex characters', `${HEX.slice(1)}g`],
    ])('rejects %s', (_name, nonce) => {
      expect(check({ nonce })).toBe(APPLE_NONCE_ERROR.invalid);
    });
  });

  describe('self-host shape', () => {
    const check = ({ nonce, authority = AUTHORITY }: { nonce: string; authority?: string }) =>
      checkAppleNonce({ idToken: idTokenFor({ nonce }), selfHost: true, authority });

    it('accepts an authority with a port', () => {
      expect(check({ nonce: `budget.example.com:8443|${HEX}`, authority: 'budget.example.com:8443' })).toBeNull();
    });

    it.each([
      ['plain hex, as the app sends to cloud', HEX],
      ['a foreign authority', `evil.example|${HEX}`],
      ['a look-alike authority', `api-${AUTHORITY}|${HEX}`],
      ['its authority as a suffix of another host', `evil.example.${AUTHORITY}|${HEX}`],
      ['its authority followed by a port', `${AUTHORITY}:8443|${HEX}`],
      ['its authority in another case', `${AUTHORITY.toUpperCase()}|${HEX}`],
      ['an empty authority', `|${HEX}`],
      ['a second separator', `${AUTHORITY}||${HEX}`],
      ['an uppercase tail', `${AUTHORITY}|${HEX.toUpperCase()}`],
      ['a short tail', `${AUTHORITY}|${HEX.slice(1)}`],
      ['a long tail', `${AUTHORITY}|${HEX}a`],
    ])('rejects %s', (_name, nonce) => {
      expect(check({ nonce })).toBe(APPLE_NONCE_ERROR.serverMismatch);
    });

    it('rejects everything when the server has no authority', () => {
      expect(check({ nonce: `|${HEX}`, authority: '' })).toBe(APPLE_NONCE_ERROR.serverMismatch);
    });
  });
});

const isAppScheme = (url: string) => url.startsWith('moneymatter://') || url.startsWith('moneymatter-selfhost://');

describe('stampServerOnAppRedirect', () => {
  const stamp = ({ location, authority = AUTHORITY }: { location: string; authority?: string }) =>
    stampServerOnAppRedirect({ location, authority, isTrustedOrigin: isAppScheme });

  it('names the server on a trusted app callback', () => {
    expect(stamp({ location: 'moneymatter://auth/callback?cookie=abc' })).toBe(
      'moneymatter://auth/callback?cookie=abc&server=moneymatter.app',
    );
  });

  it('stamps a callback that carries no cookie', () => {
    expect(stamp({ location: 'moneymatter-selfhost://auth/callback' })).toBe(
      'moneymatter-selfhost://auth/callback?server=moneymatter.app',
    );
  });

  it('percent-encodes the port separator', () => {
    expect(stamp({ location: 'moneymatter-selfhost://auth/callback', authority: 'budget.example.com:8443' })).toBe(
      'moneymatter-selfhost://auth/callback?server=budget.example.com%3A8443',
    );
  });

  it('replaces every server the caller supplied', () => {
    const stamped = stamp({ location: 'moneymatter://auth/callback?server=evil.example&cookie=abc&server=evil2' });

    expect(new URL(stamped!).searchParams.getAll('server')).toEqual([AUTHORITY]);
    expect(new URL(stamped!).searchParams.get('cookie')).toBe('abc');
  });

  it.each([
    ['an https redirect', 'https://moneymatter.app/auth/callback?server=x'],
    ['an http redirect', 'http://localhost:8100/auth/callback'],
    ['a relative redirect', '/dashboard'],
    ['an untrusted custom scheme (MCP client)', 'cursor://anysphere.cursor-mcp/oauth/callback?code=abc'],
    ['an unparseable location', 'not a url'],
  ])('leaves %s untouched', (_name, location) => {
    expect(stamp({ location })).toBeNull();
  });
});

import { afterEach, describe, expect, it } from '@jest/globals';
import { generateKeyPairSync, verify } from 'node:crypto';

import { createAppleClientSecret, getAppleClientSecretFromEnv } from './apple-client-secret';

const { privateKey, publicKey } = generateKeyPairSync('ec', { namedCurve: 'P-256' });
const pem = privateKey.export({ type: 'pkcs8', format: 'pem' }).toString();

const decode = (part: string) => JSON.parse(Buffer.from(part, 'base64url').toString());

const isSignedByTestKey = ({ secret }: { secret: string }) => {
  const [header, payload, signature] = secret.split('.');
  return verify(
    'sha256',
    Buffer.from(`${header}.${payload}`),
    { key: publicKey, dsaEncoding: 'ieee-p1363' },
    Buffer.from(signature!, 'base64url'),
  );
};

describe('createAppleClientSecret', () => {
  const now = new Date('2026-01-01T00:00:00Z');
  const iat = now.getTime() / 1000;
  const baseArgs = { clientId: 'app.moneymatter.signin', teamId: 'TEAM123456', keyId: 'KEY1234567', now };

  it('produces an ES256 JWT with the claims Apple requires', () => {
    const secret = createAppleClientSecret({ ...baseArgs, privateKey: pem });
    const [header, payload] = secret.split('.');

    expect(decode(header!)).toEqual({ alg: 'ES256', kid: 'KEY1234567' });
    expect(decode(payload!)).toEqual({
      iss: 'TEAM123456',
      iat,
      exp: iat + 15_777_000,
      aud: 'https://appleid.apple.com',
      sub: 'app.moneymatter.signin',
    });
    expect(isSignedByTestKey({ secret })).toBe(true);
  });

  it('accepts a key with escaped newlines from a single-line env var', () => {
    const secret = createAppleClientSecret({ ...baseArgs, privateKey: pem.replace(/\n/g, '\\n') });

    expect(isSignedByTestKey({ secret })).toBe(true);
  });
});

const setAppleEnv = ({ key }: { key: string }) => {
  process.env.APPLE_CLIENT_ID = 'app.moneymatter.signin';
  process.env.APPLE_TEAM_ID = 'TEAM123456';
  process.env.APPLE_KEY_ID = 'KEY1234567';
  process.env.APPLE_PRIVATE_KEY = key;
};

describe('getAppleClientSecretFromEnv', () => {
  const originalEnv = { ...process.env };

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it('signs a secret when every Apple var is set', () => {
    setAppleEnv({ key: pem });

    expect(isSignedByTestKey({ secret: getAppleClientSecretFromEnv()! })).toBe(true);
  });

  it('returns null instead of throwing on an unusable key', () => {
    setAppleEnv({ key: 'not-a-pem-key' });

    expect(getAppleClientSecretFromEnv()).toBeNull();
  });

  it('returns null when only some Apple vars are set', () => {
    setAppleEnv({ key: pem });
    delete process.env.APPLE_KEY_ID;

    expect(getAppleClientSecretFromEnv()).toBeNull();
  });
});

import { describe, expect, it, jest } from '@jest/globals';
import { useSelfHost } from '@tests/helpers/self-host';
import { createHash } from 'node:crypto';

import { nativeAppPlugin } from './native-app-plugin';

jest.mock('@i18n/index', () => ({ t: ({ key }: { key: string }) => key }));
jest.mock('@js/utils/logger', () => ({ logger: { warn: jest.fn() } }));

const AUTHORITY = 'budget.example.com';
const HEX = 'a1b2c3d4e5f60718'.repeat(4);

const idTokenFor = ({ nonce }: { nonce: string }) => ({
  token: ['{"alg":"RS256"}', JSON.stringify({ nonce: createHash('sha256').update(nonce).digest('hex') }), 'sig']
    .map((part) => Buffer.from(part).toString('base64url'))
    .join('.'),
  nonce,
});

type Handler = (ctx: unknown) => Promise<unknown>;

const pluginWith = ({ appleWebFlowEnabled = false }: { appleWebFlowEnabled?: boolean } = {}) =>
  nativeAppPlugin({ authority: AUTHORITY, appleWebFlowEnabled }).hooks;

const runBefore = ({ body, appleWebFlowEnabled }: { body: unknown; appleWebFlowEnabled?: boolean }) =>
  (pluginWith({ appleWebFlowEnabled }).before[0]!.handler as unknown as Handler)({ path: '/sign-in/social', body });

const runAfter = ({ location }: { location: string | null }) => {
  const setHeader = jest.fn();
  const headers = new Headers(location ? { location } : {});
  const ctx = {
    setHeader,
    context: { responseHeaders: headers, isTrustedOrigin: (url: string) => url.startsWith('moneymatter') },
  };
  return (pluginWith().after[0]!.handler as unknown as Handler)(ctx).then(() => setHeader);
};

describe('nativeAppPlugin before-hook', () => {
  const matcher = pluginWith().before[0]!.matcher as (ctx: { path?: string }) => boolean;

  it.each([
    ['/sign-in/social', true],
    ['/link-social', true],
    ['/callback/apple', false],
    [undefined, false],
  ])('matches %s: %s', (path, expected) => {
    expect(matcher({ path })).toBe(expected);
  });

  it.each([
    ['another provider', { provider: 'google', idToken: { token: 'a.b.c' } }],
    ['no body', undefined],
  ])('ignores %s', async (_name, body) => {
    await expect(runBefore({ body })).resolves.toBeUndefined();
  });

  it('answers 404 to the Apple redirect flow without a client secret', async () => {
    await expect(runBefore({ body: { provider: 'apple' } })).rejects.toMatchObject({
      status: 'NOT_FOUND',
      body: { code: 'PROVIDER_NOT_FOUND' },
    });
  });

  it('lets the Apple redirect flow through when it is configured', async () => {
    await expect(runBefore({ body: { provider: 'apple' }, appleWebFlowEnabled: true })).resolves.toBeUndefined();
  });

  it('accepts a valid cloud nonce', async () => {
    await expect(
      runBefore({ body: { provider: 'apple', idToken: idTokenFor({ nonce: HEX }) } }),
    ).resolves.toBeUndefined();
  });

  it('rejects an invalid nonce with its own message', async () => {
    await expect(runBefore({ body: { provider: 'apple', idToken: { token: 'a.b.c' } } })).rejects.toMatchObject({
      status: 'FORBIDDEN',
      body: { code: 'APPLE_NONCE_INVALID', message: 'auth.errors.appleNonceInvalid' },
    });
  });

  describe('on self-host', () => {
    useSelfHost();

    it('rejects a nonce bound to another server with the mismatch message', async () => {
      await expect(
        runBefore({ body: { provider: 'apple', idToken: idTokenFor({ nonce: `evil.example|${HEX}` }) } }),
      ).rejects.toMatchObject({
        status: 'FORBIDDEN',
        body: { code: 'APPLE_NONCE_SERVER_MISMATCH', message: 'auth.errors.appleNonceServerMismatch' },
      });
    });

    it('accepts a nonce bound to its own authority', async () => {
      await expect(
        runBefore({ body: { provider: 'apple', idToken: idTokenFor({ nonce: `${AUTHORITY}|${HEX}` }) } }),
      ).resolves.toBeUndefined();
    });
  });
});

describe('nativeAppPlugin after-hook', () => {
  it('stamps the server on a trusted app redirect', async () => {
    const setHeader = await runAfter({ location: 'moneymatter://auth/callback?cookie=abc' });

    expect(setHeader).toHaveBeenCalledWith('location', `moneymatter://auth/callback?cookie=abc&server=${AUTHORITY}`);
  });

  it.each([
    ['no redirect', null],
    ['a web redirect', 'https://moneymatter.app/dashboard'],
  ])('leaves %s alone', async (_name, location) => {
    expect(await runAfter({ location })).not.toHaveBeenCalled();
  });
});

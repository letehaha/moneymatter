import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals';
import { createHash } from 'node:crypto';
import webpush from 'web-push';

type GetWebPushConfig = typeof import('./config').getWebPushConfig;

const VAPID_VARS = ['VAPID_PUBLIC_KEY', 'VAPID_PRIVATE_KEY', 'VAPID_SUBJECT'] as const;

const generatedKeys = webpush.generateVAPIDKeys();
const otherKeys = webpush.generateVAPIDKeys();

const validEnv: Partial<Record<(typeof VAPID_VARS)[number], string>> = {
  VAPID_PUBLIC_KEY: generatedKeys.publicKey,
  VAPID_PRIVATE_KEY: generatedKeys.privateKey,
  VAPID_SUBJECT: 'mailto:admin@example.com',
};

const b64url = ({ bytes }: { bytes: number }) => Buffer.alloc(bytes, 7).toString('base64url');

const setEnv = ({ env }: { env: Partial<Record<(typeof VAPID_VARS)[number], string>> }) => {
  for (const name of VAPID_VARS) {
    if (env[name] === undefined) delete process.env[name];
    else process.env[name] = env[name];
  }
};

describe('getWebPushConfig', () => {
  let getWebPushConfig: GetWebPushConfig;
  let warnSpy: jest.SpiedFunction<(message: string) => unknown>;
  const original = Object.fromEntries(VAPID_VARS.map((name) => [name, process.env[name]]));

  // The warnings are deduplicated per process in module state, so each test loads fresh modules.
  beforeEach(() => {
    jest.isolateModules(() => {
      const { logger } = require('@js/utils/logger') as typeof import('@js/utils/logger');
      warnSpy = jest.spyOn(logger, 'warn').mockImplementation((() => logger) as never) as never;
      ({ getWebPushConfig } = require('./config') as typeof import('./config'));
    });
    setEnv({ env: validEnv });
  });

  afterEach(() => {
    for (const name of VAPID_VARS) {
      if (original[name] === undefined) delete process.env[name];
      else process.env[name] = original[name];
    }
    jest.restoreAllMocks();
  });

  const loggedMessages = () => warnSpy.mock.calls.map(([message]) => String(message));

  it('returns the config with a 16-hex key id for a valid trio', () => {
    const config = getWebPushConfig();

    expect(config).toStrictEqual({
      publicKey: generatedKeys.publicKey,
      privateKey: generatedKeys.privateKey,
      subject: 'mailto:admin@example.com',
      keyId: createHash('sha256').update(Buffer.from(generatedKeys.publicKey, 'base64url')).digest('hex').slice(0, 16),
    });
    expect(config!.keyId).toMatch(/^[0-9a-f]{16}$/);
    expect(warnSpy).not.toHaveBeenCalled();
  });

  it('accepts an https subject', () => {
    setEnv({ env: { ...validEnv, VAPID_SUBJECT: 'https://money.example.com' } });
    expect(getWebPushConfig()?.subject).toBe('https://money.example.com');
  });

  it('reads process.env on each call', () => {
    expect(getWebPushConfig()).not.toBeNull();
    delete process.env.VAPID_SUBJECT;
    expect(getWebPushConfig()).toBeNull();
    process.env.VAPID_SUBJECT = 'mailto:admin@example.com';
    expect(getWebPushConfig()).not.toBeNull();
  });

  it.each(VAPID_VARS)('is null when %s is unset', (name) => {
    setEnv({ env: { ...validEnv, [name]: undefined } });
    expect(getWebPushConfig()).toBeNull();
  });

  it.each(VAPID_VARS)('is null when %s is empty', (name) => {
    setEnv({ env: { ...validEnv, [name]: '' } });
    expect(getWebPushConfig()).toBeNull();
  });

  it.each(VAPID_VARS)('is null when %s is a your-… placeholder', (name) => {
    setEnv({ env: { ...validEnv, [name]: 'your-vapid-value' } });
    expect(getWebPushConfig()).toBeNull();
  });

  it('is null and silent when nothing is configured', () => {
    setEnv({ env: {} });
    expect(getWebPushConfig()).toBeNull();
    expect(warnSpy).not.toHaveBeenCalled();
  });

  it.each([
    ['a 64-byte public key', { VAPID_PUBLIC_KEY: b64url({ bytes: 64 }) }],
    ['a 65-byte public key that is not an uncompressed point', { VAPID_PUBLIC_KEY: b64url({ bytes: 65 }) }],
    ['a 31-byte private key', { VAPID_PRIVATE_KEY: b64url({ bytes: 31 }) }],
    ['a private key that does not belong to the public key', { VAPID_PRIVATE_KEY: otherKeys.privateKey }],
    [
      'a public key with characters outside base64url',
      { VAPID_PUBLIC_KEY: `${generatedKeys.publicKey.slice(0, 80)}+/=!!!` },
    ],
    ['a mailto subject on localhost', { VAPID_SUBJECT: 'mailto:a@localhost' }],
    ['a mailto subject on a .local host', { VAPID_SUBJECT: 'mailto:a@box.local' }],
    ['an https subject on localhost', { VAPID_SUBJECT: 'https://localhost' }],
    ['an ftp subject', { VAPID_SUBJECT: 'ftp://example.com' }],
    ['a subject that is not a URL', { VAPID_SUBJECT: 'admin@example.com' }],
  ])('is null for %s', (_label, override) => {
    setEnv({ env: { ...validEnv, ...override } });
    expect(getWebPushConfig()).toBeNull();
  });

  describe('warnings', () => {
    it('logs an invalid value once per variable and reason', () => {
      setEnv({ env: { ...validEnv, VAPID_SUBJECT: 'mailto:a@localhost' } });

      getWebPushConfig();
      getWebPushConfig();
      getWebPushConfig();

      expect(warnSpy).toHaveBeenCalledTimes(1);
      expect(loggedMessages()[0]).toContain('VAPID_SUBJECT');
    });

    it('logs a different reason for the same variable separately', () => {
      setEnv({ env: { ...validEnv, VAPID_SUBJECT: 'mailto:a@localhost' } });
      getWebPushConfig();
      setEnv({ env: { ...validEnv, VAPID_SUBJECT: 'ftp://example.com' } });
      getWebPushConfig();

      expect(warnSpy).toHaveBeenCalledTimes(2);
    });

    it('names the missing variables when only part of the trio is set', () => {
      setEnv({ env: { VAPID_PUBLIC_KEY: validEnv.VAPID_PUBLIC_KEY } });

      getWebPushConfig();
      getWebPushConfig();

      const messages = loggedMessages();
      expect(messages).toHaveLength(2);
      expect(messages.join('\n')).toContain('VAPID_PRIVATE_KEY');
      expect(messages.join('\n')).toContain('VAPID_SUBJECT');
    });

    it('never logs a key value for a placeholder private key (isEnvConfigured path)', () => {
      const secret = 'your_private_key_do_not_log_0123456789';
      setEnv({ env: { ...validEnv, VAPID_PRIVATE_KEY: secret } });

      expect(getWebPushConfig()).toBeNull();

      expect(warnSpy).toHaveBeenCalled();
      for (const message of loggedMessages()) expect(message).not.toContain(secret);
    });

    it('never logs a key value for a placeholder public key (isEnvConfigured path)', () => {
      const secret = 'your-public-key-do-not-log-0123456789';
      setEnv({ env: { ...validEnv, VAPID_PUBLIC_KEY: secret } });

      expect(getWebPushConfig()).toBeNull();

      expect(warnSpy).toHaveBeenCalled();
      for (const message of loggedMessages()) expect(message).not.toContain(secret);
    });

    it('never logs a 43-character private key that decodes to the wrong length', () => {
      // A 43-character base64url string decodes to 32 bytes; 42 characters decode to 31.
      const secret = generatedKeys.privateKey.slice(0, 42);
      setEnv({ env: { ...validEnv, VAPID_PRIVATE_KEY: secret } });

      expect(getWebPushConfig()).toBeNull();

      expect(warnSpy).toHaveBeenCalled();
      for (const message of loggedMessages()) {
        expect(message).not.toContain(secret);
        expect(message).not.toContain(secret.slice(0, 20));
        expect(message).toContain('VAPID_PRIVATE_KEY');
      }
    });

    it('never logs a malformed public key or its length', () => {
      const secret = `${generatedKeys.publicKey.slice(0, 60)}+/=!!!`;
      setEnv({ env: { ...validEnv, VAPID_PUBLIC_KEY: secret } });

      expect(getWebPushConfig()).toBeNull();

      expect(warnSpy).toHaveBeenCalled();
      for (const message of loggedMessages()) {
        expect(message).not.toContain(secret);
        expect(message).not.toContain(secret.slice(0, 20));
        expect(message).not.toContain(String(secret.length));
      }
    });

    it('never logs the private key when it does not match the public key', () => {
      setEnv({ env: { ...validEnv, VAPID_PRIVATE_KEY: otherKeys.privateKey } });

      expect(getWebPushConfig()).toBeNull();

      expect(warnSpy).toHaveBeenCalled();
      for (const message of loggedMessages()) {
        expect(message).not.toContain(otherKeys.privateKey);
        expect(message).not.toContain(generatedKeys.publicKey);
      }
    });
  });
});

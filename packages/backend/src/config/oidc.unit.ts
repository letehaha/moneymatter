import { afterEach, describe, expect, it, jest } from '@jest/globals';
import { logger } from '@js/utils/logger';

import { getOidcConfig } from './oidc';

const env = {
  OIDC_ISSUER: 'https://id.example.com',
  OIDC_CLIENT_ID: 'client-id',
  OIDC_CLIENT_SECRET: 'client-secret',
};

const spyOnWarn = () => jest.spyOn(logger, 'warn').mockImplementation(() => logger);

describe('getOidcConfig', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('stays null and silent when nothing is set', () => {
    const warn = spyOnWarn();

    expect(getOidcConfig({ env: {} })).toBeNull();
    expect(warn).not.toHaveBeenCalled();
  });

  it('returns null and names only the missing vars when partially configured', () => {
    const warn = spyOnWarn();

    expect(
      getOidcConfig({ env: { OIDC_ISSUER: env.OIDC_ISSUER, OIDC_CLIENT_SECRET: env.OIDC_CLIENT_SECRET } }),
    ).toBeNull();

    const message = String(warn.mock.calls[0]?.[0]);
    expect(message).toContain('OIDC_CLIENT_ID');
    expect(message).not.toContain('OIDC_ISSUER');
    expect(message).not.toContain(env.OIDC_CLIENT_SECRET);
  });

  it.each([
    'id.example.com',
    'ftp://id.example.com',
    'https://id.example.com/.well-known/openid-configuration',
    'https://id.example.com/.well-known/openid-configuration/',
  ])('returns null and warns for bad issuer %s', (OIDC_ISSUER) => {
    const warn = spyOnWarn();

    expect(getOidcConfig({ env: { ...env, OIDC_ISSUER } })).toBeNull();
    expect(warn).toHaveBeenCalledTimes(1);
  });

  it('strips trailing slashes from the issuer in discoveryUrl', () => {
    expect(getOidcConfig({ env: { ...env, OIDC_ISSUER: 'https://id.example.com/realm//' } })?.discoveryUrl).toBe(
      'https://id.example.com/realm/.well-known/openid-configuration',
    );
  });

  it('trusts the IdP email claim only when OIDC_TRUST_EMAIL is exactly true', () => {
    expect(getOidcConfig({ env })?.trustEmail).toBe(false);
    expect(getOidcConfig({ env: { ...env, OIDC_TRUST_EMAIL: '1' } })?.trustEmail).toBe(false);
    expect(getOidcConfig({ env: { ...env, OIDC_TRUST_EMAIL: 'true' } })?.trustEmail).toBe(true);
  });

  it('defaults a blank provider name to SSO', () => {
    expect(getOidcConfig({ env: { ...env, OIDC_PROVIDER_NAME: '   ' } })?.displayName).toBe('SSO');
    expect(getOidcConfig({ env: { ...env, OIDC_PROVIDER_NAME: 'Pocket ID' } })?.displayName).toBe('Pocket ID');
  });
});

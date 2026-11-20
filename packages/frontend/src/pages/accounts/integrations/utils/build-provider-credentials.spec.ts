import { BANK_PROVIDER_TYPE } from '@bt/shared/types';
import { describe, expect, it } from 'vitest';

import { buildProviderCredentials } from './build-provider-credentials';

describe('buildProviderCredentials', () => {
  it('sends a Monobank token under `apiToken`, matching the connect flow', () => {
    // Regression: the dialog used to send `{ apiKey }` for every provider, which
    // Monobank rejects as "Invalid credentials format" because it expects `apiToken`.
    expect(buildProviderCredentials({ providerType: BANK_PROVIDER_TYPE.MONOBANK, apiKey: 'mono-token' })).toEqual({
      apiToken: 'mono-token',
    });
  });

  it('sends a SimpleFIN token under `setupToken`', () => {
    expect(buildProviderCredentials({ providerType: BANK_PROVIDER_TYPE.SIMPLEFIN, apiKey: 'setup-token' })).toEqual({
      setupToken: 'setup-token',
    });
  });

  it('sends both keys for Walutomat', () => {
    expect(
      buildProviderCredentials({
        providerType: BANK_PROVIDER_TYPE.WALUTOMAT,
        apiKey: 'wal-key',
        privateKey: 'wal-private',
      }),
    ).toEqual({ apiKey: 'wal-key', privateKey: 'wal-private' });
  });

  it('sends the user and app tokens for Akahu', () => {
    expect(buildProviderCredentials({ providerType: BANK_PROVIDER_TYPE.AKAHU, apiKey: 'u', privateKey: 'a' })).toEqual({
      userToken: 'u',
      appToken: 'a',
    });
  });

  it('sends `apiKey` for LunchFlow', () => {
    expect(buildProviderCredentials({ providerType: BANK_PROVIDER_TYPE.LUNCHFLOW, apiKey: 'lf-key' })).toEqual({
      apiKey: 'lf-key',
    });
  });

  it('falls back to `apiKey` when the provider type is unknown', () => {
    expect(buildProviderCredentials({ providerType: undefined, apiKey: 'some-key' })).toEqual({ apiKey: 'some-key' });
  });
});

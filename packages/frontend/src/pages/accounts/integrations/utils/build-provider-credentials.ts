import { BANK_PROVIDER_TYPE } from '@bt/shared/types';

/**
 * Build the credentials payload for the "Update Credentials" reconnect flow.
 *
 * Each provider stores its secret under a different field name, and the backend
 * validates the exact key it expects — so the single API-key input the dialog
 * collects has to be re-keyed per provider before it's sent:
 *   - Monobank stores its token under `apiToken` (same key the connect flow uses).
 *   - SimpleFIN reconnects by claiming a fresh setup token, sent as `setupToken`.
 *   - Walutomat needs an API key plus a private key.
 *   - Akahu needs its User Access Token plus the App ID Token.
 *   - LunchFlow (and any other single-key provider) uses `apiKey`.
 */
export function buildProviderCredentials({
  providerType,
  apiKey,
  privateKey,
}: {
  providerType: BANK_PROVIDER_TYPE | undefined;
  apiKey: string;
  privateKey?: string;
}): Record<string, unknown> {
  switch (providerType) {
    case BANK_PROVIDER_TYPE.MONOBANK:
      return { apiToken: apiKey };
    case BANK_PROVIDER_TYPE.SIMPLEFIN:
      return { setupToken: apiKey };
    case BANK_PROVIDER_TYPE.WALUTOMAT:
      return { apiKey, privateKey };
    case BANK_PROVIDER_TYPE.AKAHU:
      return { userToken: apiKey, appToken: privateKey };
    default:
      return { apiKey };
  }
}

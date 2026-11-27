import { BANK_PROVIDER_TYPE, type PlaidLinkTokenResponse } from '@bt/shared/types';
import { afterEach, beforeEach } from '@jest/globals';
import { PLAID_PUBLIC_TOKEN } from '@tests/mocks/plaid/data';

import { connectProvider } from './bank-data-providers';
import { makeRequest } from './common';

export const PLAID_REDIRECT_URI = 'https://money.test/plaid-callback';
export const PLAID_TEST_ENV = {
  IS_SELF_HOST: 'true',
  PLAID_ENV: 'sandbox',
  PLAID_CLIENT_ID: 'plaid-test-client',
  PLAID_SECRET: 'plaid-test-secret',
  PLAID_REDIRECT_URI,
};

/** Enables Plaid for every test of the calling file and restores the env afterwards. */
export function usePlaidEnv() {
  let savedEnv: Record<string, string | undefined> = {};
  beforeEach(() => {
    savedEnv = Object.fromEntries(Object.keys(PLAID_TEST_ENV).map((key) => [key, process.env[key]]));
    Object.assign(process.env, PLAID_TEST_ENV);
  });
  afterEach(() => {
    for (const [key, value] of Object.entries(savedEnv)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });
}

export function createLinkToken<R extends boolean | undefined = false>({ raw }: { raw?: R } = {}) {
  return makeRequest<PlaidLinkTokenResponse, R>({
    method: 'post',
    url: '/bank-data-providers/plaid/link-token',
    raw,
  });
}

export function pairPlaidUser({ publicToken = PLAID_PUBLIC_TOKEN }: { publicToken?: string } = {}) {
  return connectProvider({ providerType: BANK_PROVIDER_TYPE.PLAID, credentials: { publicToken }, raw: true });
}

export default { createLinkToken, pairPlaidUser, usePlaidEnv };

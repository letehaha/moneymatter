import { BANK_PROVIDER_TYPE, type PlaidLinkTokenResponse } from '@bt/shared/types';
import { PLAID_PUBLIC_TOKEN } from '@tests/mocks/plaid/data';

import { connectProvider } from './bank-data-providers';
import { makeRequest } from './common';

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

export default { createLinkToken, pairPlaidUser };

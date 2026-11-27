import { api } from '@/api/_api';
import type { PlaidLinkTokenResponse } from '@bt/shared/types';

export const createPlaidLinkToken = async ({ signal }: { signal: AbortSignal }): Promise<PlaidLinkTokenResponse> =>
  api.post('/bank-data-providers/plaid/link-token', {}, { signal, silent: true });

export const connectPlaid = async ({
  publicToken,
  providerName,
}: {
  publicToken: string;
  providerName?: string;
}): Promise<{ connectionId: string }> =>
  api.post('/bank-data-providers/plaid/connect', { credentials: { publicToken }, providerName }, { silent: true });

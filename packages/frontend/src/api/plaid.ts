import { api } from '@/api/_api';
import type { PlaidLinkTokenResponse } from '@bt/shared/types';

export const createPlaidLinkToken = async ({ signal }: { signal: AbortSignal }): Promise<PlaidLinkTokenResponse> =>
  api.post('/bank-data-providers/plaid/link-token', {}, { signal, silent: true });

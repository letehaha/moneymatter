import { BulkTransferScanResponse, TRANSACTION_TYPES, TransactionModel } from '@bt/shared/types';
import * as helpers from '@tests/helpers';

import { MakeRequestReturn } from './common';

interface GetTransferRecommendationsParams {
  transactionId?: string;
  transactionType?: TRANSACTION_TYPES;
  originAmount?: number;
  accountId?: string;
}

export function getTransferRecommendations<R extends boolean | undefined = undefined>({
  raw,
  ...params
}: GetTransferRecommendationsParams & { raw?: R }): Promise<MakeRequestReturn<TransactionModel[], R>> {
  return helpers.makeRequest<TransactionModel[], R>({
    method: 'get',
    url: '/transactions/transfer-recommendations',
    payload: params,
    raw,
  });
}

interface BulkScanTransferRecommendationsParams {
  from: string;
  to: string;
  limit?: number;
  offset?: number;
  includeOutOfWallet?: boolean;
}

export function dismissTransferSuggestion<R extends boolean | undefined = undefined>({
  raw,
  ...params
}: {
  expenseTransactionId: string;
  incomeTransactionId: string;
  raw?: R;
}): Promise<MakeRequestReturn<void, R>> {
  return helpers.makeRequest<void, R>({
    method: 'post',
    url: '/transactions/transfer-recommendations/dismiss',
    payload: params,
    raw,
  });
}

export function bulkScanTransferRecommendations<R extends boolean | undefined = undefined>({
  raw,
  ...params
}: BulkScanTransferRecommendationsParams & { raw?: R }): Promise<MakeRequestReturn<BulkTransferScanResponse, R>> {
  return helpers.makeRequest<BulkTransferScanResponse, R>({
    method: 'post',
    url: '/transactions/transfer-recommendations/bulk-scan',
    payload: params,
    raw,
  });
}

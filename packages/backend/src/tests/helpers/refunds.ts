import { TRANSACTION_TYPES, TransactionModel } from '@bt/shared/types';
import type { GetRefundTransactionsParams } from '@services/tx-refunds/get-refunds.service';
import * as helpers from '@tests/helpers';

import { MakeRequestReturn } from './common';

export const createSingleRefund = async (
  payload: { originalTxId: string | null; refundTxId: string; splitId?: string; amount?: number },
  raw = false,
) => {
  const result = await helpers.makeRequest({
    method: 'post',
    url: '/transactions/refund',
    payload,
  });

  return raw ? helpers.extractResponse(result) : result;
};

export const getSingleRefund = async (
  { originalTxId, refundTxId }: { originalTxId: string | null; refundTxId: string },
  raw = false,
) => {
  const result = await helpers.makeRequest({
    method: 'get',
    url: `/transactions/refund?originalTxId=${originalTxId}&refundTxId=${refundTxId}`,
  });

  return raw ? helpers.extractResponse(result) : result;
};

export const getRefundTransactions = async (params?: Omit<GetRefundTransactionsParams, 'userId'>, raw = false) => {
  const queryString = params
    ? Object.entries({ page: 1, limit: 10, ...params })
        .map(([key, value]) => `${key}=${encodeURIComponent(value)}`)
        .join('&')
    : '';

  const result = await helpers.makeRequest({
    method: 'get',
    url: `/transactions/refunds?${queryString}`,
  });

  return raw ? helpers.extractResponse(result) : result;
};

export const deleteRefund = async (
  payload: { originalTxId: string | null; refundTxId: string | null },
  raw = false,
) => {
  const result = await helpers.makeRequest({
    method: 'delete',
    url: '/transactions/refund',
    payload,
  });

  return raw ? helpers.extractResponse(result) : result;
};

interface GetRefundRecommendationsParams {
  transactionId?: string;
  transactionType?: TRANSACTION_TYPES;
  originAmount?: number;
  accountId?: string;
  includeRefundedAmount?: boolean;
  refundRole?: 'refund' | 'original';
  refundPivotFrom?: string;
  refundPivotTo?: string;
}

export function getRefundRecommendations<R extends boolean | undefined = undefined>({
  raw,
  ...params
}: GetRefundRecommendationsParams & { raw?: R }): Promise<MakeRequestReturn<TransactionModel[], R>> {
  return helpers.makeRequest<TransactionModel[], R>({
    method: 'get',
    url: '/transactions/refund-recommendations',
    payload: params,
    raw,
  });
}

interface RefundLinkResponse {
  id: string;
  originalTxId: string | null;
  refundTxId: string;
  splitId: string | null;
  amount: number | null;
  originalTransaction?: TransactionModel;
}

export function getRefundsForTransaction<R extends boolean | undefined = undefined>({
  transactionId,
  raw,
}: {
  transactionId: string;
  raw?: R;
}): Promise<MakeRequestReturn<RefundLinkResponse[], R>> {
  return helpers.makeRequest<RefundLinkResponse[], R>({
    method: 'get',
    url: `/transactions/${transactionId}/refunds`,
    payload: { transactionId },
    raw,
  });
}

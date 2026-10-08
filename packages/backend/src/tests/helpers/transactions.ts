import { PAYMENT_TYPES, TRANSACTION_TRANSFER_NATURE, TRANSACTION_TYPES, type endpointsTypes } from '@bt/shared/types';
import type { RecordId, TransactionLocation } from '@bt/shared/types';
import Transactions from '@models/transactions.model';
import type { TransactionApiResponse } from '@root/serializers/transactions.serializer';
import * as transactionsService from '@services/transactions';
import type { getTransactionsByTransferId as apiGetTransactionsByTransferId } from '@services/transactions/get-by-transfer-id';
import type { getTransactions as apiGetTransactions } from '@services/transactions/get-transactions';
import { startOfDay } from 'date-fns';
import { Response } from 'express';

import { createAccount } from './account';
import { CustomResponse, makeRequest } from './common';

type BuildTxPartialField = 'amount' | 'time' | 'transferNature' | 'paymentType' | 'transactionType';
export const buildTransactionPayload = (
  params: Omit<endpointsTypes.CreateTransactionBody, BuildTxPartialField> &
    Partial<Pick<endpointsTypes.CreateTransactionBody, BuildTxPartialField>>,
): endpointsTypes.CreateTransactionBody => ({
  amount: 1000,
  categoryId: global.DEFAULT_CATEGORY_ID,
  transferNature: TRANSACTION_TRANSFER_NATURE.not_transfer,
  paymentType: PAYMENT_TYPES.creditCard,
  time: startOfDay(new Date()).toISOString(),
  transactionType: TRANSACTION_TYPES.expense,
  ...params,
});

interface CreateTransactionBasePayload {
  payload?: ReturnType<typeof buildTransactionPayload>;
}

export async function createTransaction(): Promise<Response>;
export async function createTransaction({
  raw,
  payload,
}: CreateTransactionBasePayload & { raw?: false }): Promise<Response>;
export async function createTransaction({
  raw,
  payload,
}: CreateTransactionBasePayload & { raw?: true }): Promise<[baseTx: Transactions, oppositeTx?: Transactions]>;
export async function createTransaction({
  raw = false,
  payload = undefined,
}: CreateTransactionBasePayload & { raw?: boolean } = {}) {
  let txPayload: ReturnType<typeof buildTransactionPayload> | undefined = payload;

  if (payload === undefined) {
    const account = await createAccount({ raw: true });
    txPayload = buildTransactionPayload({ accountId: account.id });
  }
  return makeRequest({
    method: 'post',
    url: '/transactions',
    payload: txPayload,
    raw,
  });
}

type CreatePlannedTransactionPayload = Parameters<typeof buildTransactionPayload>[0];

export function createPlannedTransaction({
  payload,
  raw,
}: {
  payload: CreatePlannedTransactionPayload;
  raw?: false;
}): Promise<Response>;
export function createPlannedTransaction({
  payload,
  raw,
}: {
  payload: CreatePlannedTransactionPayload;
  raw?: true;
}): Promise<[baseTx: Transactions, oppositeTx?: Transactions]>;
export function createPlannedTransaction({
  payload,
  raw = false,
}: {
  payload: CreatePlannedTransactionPayload;
  raw?: boolean;
}) {
  return makeRequest({
    method: 'post',
    url: '/transactions',
    payload: buildTransactionPayload({ ...payload, isPlanned: true }),
    raw,
  });
}

interface SplitInput {
  categoryId: string;
  amount: number;
  note?: string | null;
}

interface UpdateTransactionBasePayload {
  id: RecordId;
  payload?: Omit<
    Partial<ReturnType<typeof buildTransactionPayload>>,
    'splits' | 'originalAmount' | 'originalCurrencyCode' | 'externalUrl' | 'externalReference' | 'location'
  > & {
    externalUrl?: string | null;
    externalReference?: string | null;
    location?: TransactionLocation | null;
    destinationAmount?: number;
    destinationAccountId?: string;
    destinationTransactionId?: string;
    refundsTxId?: string | null;
    refundedByTxIds?: string[] | null;
    splits?: SplitInput[] | null;
    originalAmount?: number | null;
    originalCurrencyCode?: string | null;
  };
}

export function updateTransaction({
  raw,
  payload,
  id,
}: UpdateTransactionBasePayload & { raw?: false }): Promise<Response>;
export function updateTransaction({
  raw,
  payload,
  id,
}: UpdateTransactionBasePayload & { raw?: true }): Promise<[baseTx: Transactions, oppositeTx?: Transactions]>;
export function updateTransaction({ raw = false, id, payload = {} }) {
  return makeRequest({
    method: 'put',
    url: `/transactions/${id}`,
    payload,
    raw,
  });
}

export function deleteTransaction({ id }: { id?: string } = {}): Promise<Response> {
  return makeRequest({
    method: 'delete',
    url: `/transactions/${id}`,
  });
}

export function getTransactions<R extends boolean | undefined = undefined>({
  raw,
  ...rest
}: Partial<
  Omit<Parameters<typeof apiGetTransactions>[0], 'userId' | 'noteSearch' | 'from' | 'startDate' | 'endDate'>
> & {
  raw?: R;
  noteSearch?: string; // comma-separated string
  // API query vocabulary (the service uses `from`/`startDate`/`endDate` internally;
  // the HTTP endpoint exposes `offset` + `from`/`to`).
  offset?: number;
  from?: string;
  to?: string;
} = {}) {
  return makeRequest<Awaited<ReturnType<typeof apiGetTransactions>>, R>({
    method: 'get',
    url: '/transactions',
    payload: rest,
    raw,
  });
}

export function getTransactionsByTransferId<R extends boolean | undefined = undefined>({
  raw,
  transferId,
}: {
  raw?: R;
  transferId: string;
}) {
  return makeRequest<Awaited<ReturnType<typeof apiGetTransactionsByTransferId>>, R>({
    method: 'get',
    url: `/transactions/transfer/${transferId}`,
    raw,
  });
}

export function unlinkTransferTransactions({
  transferIds,
  raw,
}: {
  transferIds: string[];
  raw?: false;
}): Promise<Response>;
export function unlinkTransferTransactions({
  raw,
  transferIds,
}: {
  transferIds: string[];
  raw?: true;
}): Promise<Transactions[]>;
export function unlinkTransferTransactions({
  raw = false,
  transferIds = [],
}: {
  transferIds: string[];
  raw?: boolean;
}) {
  return makeRequest({
    method: 'put',
    url: '/transactions/unlink',
    payload: {
      transferIds,
    },
    raw,
  });
}

export function linkTransactions({
  payload,
  raw,
}: {
  payload: endpointsTypes.LinkTransactionsBody;
  raw?: false;
}): Promise<Response>;
export function linkTransactions({
  payload,
  raw,
}: {
  payload: endpointsTypes.LinkTransactionsBody;
  raw?: true;
}): ReturnType<typeof transactionsService.linkTransactions>;
export function linkTransactions({ raw = false, payload }) {
  return makeRequest({
    method: 'put',
    url: '/transactions/link',
    payload,
    raw,
  });
}

// Split helpers
export function deleteSplit({ splitId }: { splitId: string }): Promise<CustomResponse<void>> {
  return makeRequest({
    method: 'delete',
    url: `/transactions/splits/${splitId}`,
  });
}

// Get by IDs helpers
export function getTransactionsByIds<R extends boolean | undefined = undefined>({
  ids,
  raw,
}: {
  ids: string[];
  raw?: R;
}) {
  return makeRequest<TransactionApiResponse[], R>({
    method: 'get',
    url: '/transactions/by-ids',
    payload: { ids: ids.join(',') },
    raw,
  });
}

export function getTransactionById<R extends boolean | undefined = undefined>({
  id,
  includeSplits,
  raw,
}: {
  id: string;
  includeSplits?: boolean;
  raw?: R;
}) {
  return makeRequest<TransactionApiResponse | null, R>({
    method: 'get',
    url: `/transactions/${id}${includeSplits ? '?includeSplits=true' : ''}`,
    raw,
  });
}

// Bulk update helpers
type BulkUpdateTransactionsPayload = endpointsTypes.BulkUpdateTransactionsBody;

interface BulkUpdateResult {
  updatedCount: number;
  updatedIds: string[];
}

export function bulkUpdateTransactions<R extends boolean | undefined = undefined>({
  payload,
  raw,
}: {
  payload: BulkUpdateTransactionsPayload;
  raw?: R;
}) {
  return makeRequest<BulkUpdateResult, R>({
    method: 'put',
    url: '/transactions/bulk',
    payload,
    raw,
  });
}

// Bulk delete helpers
interface BulkDeleteResult {
  deletedCount: number;
  deletedIds: string[];
}

export function bulkDeleteTransactions<R extends boolean | undefined = undefined>({
  payload,
  raw,
}: {
  payload: endpointsTypes.BulkDeleteTransactionsBody;
  raw?: R;
}) {
  return makeRequest<BulkDeleteResult, R>({
    method: 'post',
    url: '/transactions/bulk-delete',
    payload,
    raw,
  });
}

export function getTransactionsSummary<R extends boolean | undefined = undefined>({
  raw,
  ...filters
}: Record<string, unknown> & { raw?: R } = {}) {
  return makeRequest<endpointsTypes.TransactionsSummaryResponse, R>({
    method: 'get',
    url: '/transactions/summary',
    payload: filters,
    raw,
  });
}

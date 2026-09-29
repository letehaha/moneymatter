import type { RecordId } from '@bt/shared/types';
import type { getReconciliationHistory as apiGetHistory } from '@services/transactions/reconciliation/get-history';
import type { mergeTransactions as apiMerge } from '@services/transactions/reconciliation/merge-transactions';
import type { removeTransactions as apiRemove } from '@services/transactions/reconciliation/remove-transactions';
import type { restoreTransactions as apiRestore } from '@services/transactions/reconciliation/restore-transactions';
import type {
  checkStuckPendingWithBank as apiCheckStuckPending,
  getStuckPending as apiGetStuckPending,
  keepAsBooked as apiKeepAsBooked,
} from '@services/transactions/reconciliation/stuck-pending';

import { makeRequest } from './common';

export function reconciliationRemove<R extends boolean | undefined = undefined>({
  transactionIds,
  raw,
}: {
  transactionIds: RecordId[];
  raw?: R;
}) {
  return makeRequest<Awaited<ReturnType<typeof apiRemove>>, R>({
    method: 'post',
    url: '/transactions/reconciliation/remove',
    payload: { transactionIds },
    raw,
  });
}

export function reconciliationMerge<R extends boolean | undefined = undefined>({
  transactionIds,
  survivorId,
  raw,
}: {
  transactionIds: RecordId[];
  survivorId: RecordId;
  raw?: R;
}) {
  return makeRequest<Awaited<ReturnType<typeof apiMerge>>, R>({
    method: 'post',
    url: '/transactions/reconciliation/merge',
    payload: { transactionIds, survivorId },
    raw,
  });
}

export function reconciliationRestore<R extends boolean | undefined = undefined>({
  transactionIds,
  raw,
}: {
  transactionIds: RecordId[];
  raw?: R;
}) {
  return makeRequest<Awaited<ReturnType<typeof apiRestore>>, R>({
    method: 'post',
    url: '/transactions/reconciliation/restore',
    payload: { transactionIds },
    raw,
  });
}

export function getReconciliationHistory<R extends boolean | undefined = undefined>({ raw }: { raw?: R } = {}) {
  return makeRequest<Awaited<ReturnType<typeof apiGetHistory>>, R>({
    method: 'get',
    url: '/transactions/reconciliation/history',
    raw,
  });
}

export function getStuckPending<R extends boolean | undefined = undefined>({ raw }: { raw?: R } = {}) {
  return makeRequest<Awaited<ReturnType<typeof apiGetStuckPending>>, R>({
    method: 'get',
    url: '/transactions/reconciliation/stuck-pending',
    raw,
  });
}

export function checkStuckPending<R extends boolean | undefined = undefined>({
  accountId,
  raw,
}: {
  accountId: RecordId;
  raw?: R;
}) {
  return makeRequest<Awaited<ReturnType<typeof apiCheckStuckPending>>, R>({
    method: 'post',
    url: '/transactions/reconciliation/stuck-pending/check',
    payload: { accountId },
    raw,
  });
}

export function keepAsBooked<R extends boolean | undefined = undefined>({
  transactionIds,
  raw,
}: {
  transactionIds: RecordId[];
  raw?: R;
}) {
  return makeRequest<Awaited<ReturnType<typeof apiKeepAsBooked>>, R>({
    method: 'post',
    url: '/transactions/reconciliation/keep-as-booked',
    payload: { transactionIds },
    raw,
  });
}

import type { DeleteTrashResponse, GetTrashResponse, RecordId, RestoreTrashResponse } from '@bt/shared/types';
import Transactions from '@models/transactions.model';
import { subDays } from 'date-fns';

import { makeRequest } from './common';

export function getTrash<R extends boolean | undefined = undefined>({ raw }: { raw?: R } = {}) {
  return makeRequest<GetTrashResponse, R>({ method: 'get', url: '/transactions/trash', raw });
}

export function restoreTrash<R extends boolean | undefined = undefined>({
  transactionIds,
  raw,
}: {
  transactionIds: RecordId[];
  raw?: R;
}) {
  return makeRequest<RestoreTrashResponse, R>({
    method: 'post',
    url: '/transactions/trash/restore',
    payload: { transactionIds },
    raw,
  });
}

export function deleteTrash<R extends boolean | undefined = undefined>({
  transactionIds,
  raw,
}: {
  transactionIds: RecordId[];
  raw?: R;
}) {
  return makeRequest<DeleteTrashResponse, R>({
    method: 'post',
    url: '/transactions/trash/delete',
    payload: { transactionIds },
    raw,
  });
}

/** Moves a trashed row's `deletedAt` back by `days`, so the purge cron sees it as expired. */
export const backdateTrashedTransaction = async ({ id, days }: { id: RecordId; days: number }) => {
  await Transactions.update({ deletedAt: subDays(new Date(), days) }, { where: { id }, paranoid: false, hooks: false });
};

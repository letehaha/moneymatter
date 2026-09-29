import { ACCOUNT_TYPES, RecordId } from '@bt/shared/types';
import type { CheckStuckPendingResponse, KeepAsBookedResponse } from '@bt/shared/types/endpoints';
import { findOrThrowNotFound } from '@common/utils/find-or-throw-not-found';
import { t } from '@i18n/index';
import { NotFoundError, ValidationError } from '@js/errors';
import Accounts from '@models/accounts.model';
import { findTransactions, updateTransactions } from '@models/transactions-query';
import type Transactions from '@models/transactions.model';
import { serializeTransaction } from '@root/serializers/transactions.serializer';
import { syncTransactionsForAccount } from '@services/bank-data-providers/connection/sync-transactions-for-account';
import { TransactionStatus } from '@services/bank-data-providers/enablebanking/types';
import {
  isPreBookingRow,
  setRawTransactionStatus,
  wherePreBookingStatus,
} from '@services/bank-data-providers/enablebanking/utils/transaction-metadata';
import { withTransaction } from '@services/common/with-transaction';
import { addDays, differenceInCalendarDays, subDays } from 'date-fns';
import { Op } from 'sequelize';

import { rejectIfAny } from './helpers';
import { CANDIDATE_WINDOW_DAYS, matchStuckPending, type StuckPendingMatchRow } from './match-stuck-pending';

const STUCK_AFTER_DAYS = 7;
const BANK_CHECK_MAX_DAYS = 90;

const toMatchRow = ({ tx }: { tx: Transactions }): StuckPendingMatchRow => ({
  id: tx.id,
  accountId: tx.accountId,
  transactionType: tx.transactionType,
  time: tx.time,
  amountCents: tx.amount.toCents(),
  payeeId: tx.payeeId,
  merchantName: typeof tx.externalData?.merchantName === 'string' ? tx.externalData.merchantName : null,
});

export const getStuckPending = async ({ userId }: { userId: number }) => {
  const now = new Date();
  const pending = await findTransactions({
    where: {
      accountType: ACCOUNT_TYPES.enableBanking,
      time: { [Op.lt]: subDays(now, STUCK_AFTER_DAYS) },
      [Op.and]: [wherePreBookingStatus()],
    },
    planned: 'exclude',
    access: { creator: userId },
    balanceAdjustments: 'include',
    completeness: 'all',
    order: [['time', 'ASC']],
  });

  if (!pending.length) return [];

  const pool = (
    await findTransactions({
      where: {
        accountId: { [Op.in]: [...new Set(pending.map((tx) => tx.accountId))] },
        time: { [Op.between]: [pending[0]!.time, addDays(pending.at(-1)!.time, CANDIDATE_WINDOW_DAYS)] },
        refundLinked: false,
      },
      planned: 'exclude',
      transfers: 'exclude',
      access: { creator: userId },
      balanceAdjustments: 'include',
      completeness: 'all',
    })
  ).filter((tx) => !isPreBookingRow({ tx }));

  const matches = matchStuckPending({
    pending: pending.map((tx) => toMatchRow({ tx })),
    pool: pool.map((tx) => toMatchRow({ tx })),
  });
  const poolById = new Map(pool.map((tx) => [tx.id, tx]));

  const bankCheckFrom = subDays(now, BANK_CHECK_MAX_DAYS);
  return pending.map((tx) => {
    const pendingDays = differenceInCalendarDays(now, tx.time);
    const matchId = matches.get(tx.id);
    const candidate = matchId ? poolById.get(matchId) : undefined;

    return {
      transaction: serializeTransaction(tx),
      candidate: candidate ? serializeTransaction(candidate) : null,
      canCheckWithBank: tx.time >= bankCheckFrom,
      pendingDays,
    };
  });
};

export const checkStuckPendingWithBank = async ({
  userId,
  accountId,
}: {
  userId: number;
  accountId: RecordId;
}): Promise<CheckStuckPendingResponse> => {
  const account = await findOrThrowNotFound({
    query: Accounts.findOne({ where: { id: accountId, userId } }),
    message: t({ key: 'accounts.accountNotFound' }),
  });

  if (account.type !== ACCOUNT_TYPES.enableBanking || !account.bankDataProviderConnectionId) {
    throw new ValidationError({ message: t({ key: 'transactions.reconciliation.bankCheckUnsupported' }) });
  }

  const now = new Date();
  const findCheckable = ({ ids }: { ids?: RecordId[] } = {}) =>
    findTransactions({
      where: {
        accountId,
        time: { [Op.lt]: subDays(now, STUCK_AFTER_DAYS), [Op.gte]: subDays(now, BANK_CHECK_MAX_DAYS) },
        [Op.and]: [wherePreBookingStatus()],
        ...(ids && { id: { [Op.in]: ids } }),
      },
      planned: 'exclude',
      access: { creator: userId },
      balanceAdjustments: 'include',
      completeness: 'all',
      order: [['time', 'ASC']],
    });

  const checkable = await findCheckable();
  const oldest = checkable[0];

  const stored = account.externalData?.oldestPendingDate;
  const storedTime = typeof stored === 'string' ? Date.parse(stored) : NaN;
  const widened = oldest && !(storedTime <= oldest.time.getTime()) ? oldest.time.toISOString() : null;
  if (widened) {
    await account.update({ externalData: { ...account.externalData, oldestPendingDate: widened } });
  }

  try {
    await syncTransactionsForAccount({ connectionId: account.bankDataProviderConnectionId, userId, accountId });
  } catch (error) {
    if (widened) {
      await account.reload();
      if (account.externalData?.oldestPendingDate === widened) {
        const { oldestPendingDate: _, ...rest } = account.externalData;
        await account.update({ externalData: stored === undefined ? rest : { ...rest, oldestPendingDate: stored } });
      }
    }
    throw error;
  }

  if (!checkable.length) return { bookedCount: 0, pendingCount: 0 };

  // ponytail: a hold the bank dropped also counts as booked; split it out if the copy needs to tell them apart
  const pendingCount = (await findCheckable({ ids: checkable.map((tx) => tx.id) })).length;
  return { bookedCount: checkable.length - pendingCount, pendingCount };
};

export const keepAsBooked = withTransaction(
  async ({ userId, transactionIds }: { userId: number; transactionIds: RecordId[] }): Promise<KeepAsBookedResponse> => {
    const rows = await findTransactions({
      where: { id: { [Op.in]: transactionIds } },
      planned: 'exclude',
      access: { creator: userId },
      balanceAdjustments: 'include',
      completeness: 'all',
      lock: true,
    });

    if (rows.length !== transactionIds.length) {
      throw new NotFoundError({ message: t({ key: 'transactions.notFound' }) });
    }
    rejectIfAny({ rows: rows.filter((tx) => !isPreBookingRow({ tx })), key: 'transactions.reconciliation.notPending' });

    await updateTransactions({
      values: {
        externalData: setRawTransactionStatus({ status: TransactionStatus.BOOK }),
      },
      where: { id: { [Op.in]: transactionIds } },
      planned: 'exclude',
      access: { creator: userId },
      balanceAdjustments: 'include',
    });

    return { updatedIds: transactionIds };
  },
);

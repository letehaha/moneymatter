import { LINKED_TRANSFER_NATURES } from '@bt/shared/const/transfers';
import { ACCOUNT_TYPES, RecordId } from '@bt/shared/types';
import type { CheckStuckPendingResponse, KeepAsBookedResponse } from '@bt/shared/types/endpoints';
import { findOrThrowNotFound } from '@common/utils/find-or-throw-not-found';
import { t } from '@i18n/index';
import { NotFoundError, ValidationError } from '@js/errors';
import Accounts from '@models/accounts.model';
import { type FindTransactionsOptions, findTransactions, updateTransactions } from '@models/transactions-query';
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

// Transfer- and refund-linked rows are left out: merge and remove reject them.
export const findStuckPending = ({
  access,
  attributes,
  where = {},
}: Pick<FindTransactionsOptions, 'access' | 'attributes' | 'where'>) =>
  findTransactions({
    where: {
      accountType: ACCOUNT_TYPES.enableBanking,
      time: { [Op.lt]: subDays(new Date(), STUCK_AFTER_DAYS) },
      transferId: null,
      transferNature: { [Op.notIn]: [...LINKED_TRANSFER_NATURES] },
      refundLinked: false,
      [Op.and]: [wherePreBookingStatus(), where],
    },
    planned: 'exclude',
    access,
    balanceAdjustments: 'include',
    completeness: 'all',
    order: [['time', 'ASC']],
    attributes,
  });

export const getStuckPending = async ({ userId }: { userId: number }) => {
  const now = new Date();
  const pending = await findStuckPending({ access: { creator: userId } });

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

  const bankCheckFrom = subDays(new Date(), BANK_CHECK_MAX_DAYS);
  const findCheckable = ({ ids }: { ids?: RecordId[] } = {}) =>
    findStuckPending({
      access: { creator: userId },
      where: { accountId, time: { [Op.gte]: bankCheckFrom }, ...(ids && { id: { [Op.in]: ids } }) },
    });

  const checkable = await findCheckable();
  const oldest = checkable[0];

  const stored = account.externalData?.oldestPendingDate;
  const storedTime = typeof stored === 'string' ? Date.parse(stored) : NaN;
  const needsWidening = oldest && (Number.isNaN(storedTime) || storedTime > oldest.time.getTime());
  if (needsWidening) {
    await account.update({ externalData: { ...account.externalData, oldestPendingDate: oldest.time.toISOString() } });
  }

  await syncTransactionsForAccount({ connectionId: account.bankDataProviderConnectionId, userId, accountId });

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

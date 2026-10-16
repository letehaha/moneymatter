import { ACCOUNT_TYPES, type RecordId, TRANSACTION_TYPES } from '@bt/shared/types';
import { toMoneyColumnValue } from '@common/types/money-column';
import { logger } from '@js/utils';
import Accounts from '@models/accounts.model';
import { connection } from '@models/connection';
import { findTransactions } from '@models/transactions-query';
import Transactions from '@models/transactions.model';
import { withTransaction } from '@root/services/common/with-transaction';
import { linkTransactions } from '@services/transactions/transactions-linking/link-transactions';
import { getUserSettings } from '@services/user-settings/get-user-settings';
import { addDays, subDays } from 'date-fns';
import { DatabaseError, Op, QueryTypes } from 'sequelize';

import { getCounterpartyIban, hasSettledStatus } from '../enablebanking/utils/transaction-metadata';
import { TRANSFER_DATE_WINDOW_DAYS, normalizeIban } from './transfer-matching';

/** Walutomat rows must not auto-link here: that provider's own FX/IBAN matchers own them. */
const NEVER_MATCHABLE_ACCOUNT_TYPES: ACCOUNT_TYPES[] = [ACCOUNT_TYPES.walutomat];

/** Seeds are the rows a provider sync just produced, so a manual account can never hold one. */
const SEED_EXCLUDED_ACCOUNT_TYPES: ACCOUNT_TYPES[] = [ACCOUNT_TYPES.system, ...NEVER_MATCHABLE_ACCOUNT_TYPES];

function oppositeType({ type }: { type: TRANSACTION_TYPES }): TRANSACTION_TYPES {
  return type === TRANSACTION_TYPES.expense ? TRANSACTION_TYPES.income : TRANSACTION_TYPES.expense;
}

/**
 * Only settled rows may carry a transferId: on a pending row it blocks the pending-to-booked
 * upgrade and the booked copy lands as a duplicate. Monobank authorization holds are excluded
 * too, their amount still changes on settlement.
 */
export function isLinkableRow({ tx }: { tx: Transactions }): boolean {
  return hasSettledStatus({ tx }) && tx.externalData?.hold !== true;
}

type IbanRelation = 'confirmed' | 'contradicted' | 'neutral';

function ibanRelation({
  a,
  b,
  accountIbanById,
}: {
  a: Transactions;
  b: Transactions;
  accountIbanById: Map<RecordId, string>;
}): IbanRelation {
  let confirmed = false;

  for (const [tx, other] of [
    [a, b],
    [b, a],
  ] as const) {
    const counterpartyIban = getCounterpartyIban({ tx });
    const otherAccountIban = accountIbanById.get(other.accountId);
    if (!counterpartyIban || !otherAccountIban) continue;

    if (normalizeIban({ iban: counterpartyIban }) === otherAccountIban) confirmed = true;
    else return 'contradicted';
  }

  return confirmed ? 'confirmed' : 'neutral';
}

async function findLinkableCandidates({
  tx,
  userId,
  excludedAccountTypes,
}: {
  tx: Transactions;
  userId: number;
  excludedAccountTypes: ACCOUNT_TYPES[];
}): Promise<Transactions[]> {
  const candidates = await findTransactions({
    planned: 'exclude',
    access: { creator: userId },
    transfers: 'exclude',
    balanceAdjustments: 'include',
    completeness: 'all',
    where: {
      accountId: { [Op.ne]: tx.accountId },
      accountType: { [Op.notIn]: excludedAccountTypes },
      transactionType: oppositeType({ type: tx.transactionType }),
      refundLinked: false,
      currencyCode: tx.currencyCode,
      amount: toMoneyColumnValue({ money: tx.amount }),
      time: {
        [Op.between]: [subDays(tx.time, TRANSFER_DATE_WINDOW_DAYS), addDays(tx.time, TRANSFER_DATE_WINDOW_DAYS)],
      },
    },
  });

  return candidates.filter((candidate) => isLinkableRow({ tx: candidate }));
}

async function pickUniqueMatch({
  tx,
  userId,
  accountIbanById,
  exclude,
  candidateExcludedTypes,
}: {
  tx: Transactions;
  userId: number;
  accountIbanById: Map<RecordId, string>;
  exclude: Set<RecordId>;
  candidateExcludedTypes: ACCOUNT_TYPES[];
}): Promise<Transactions | null> {
  const relations = (await findLinkableCandidates({ tx, userId, excludedAccountTypes: candidateExcludedTypes }))
    .filter((c) => !exclude.has(c.id))
    .map((candidate) => ({ candidate, relation: ibanRelation({ a: tx, b: candidate, accountIbanById }) }));

  const confirmed = relations.filter((r) => r.relation === 'confirmed');
  if (confirmed.length > 0) return confirmed.length === 1 ? confirmed[0]!.candidate : null;

  const neutral = relations.filter((r) => r.relation === 'neutral');
  return neutral.length === 1 ? neutral[0]!.candidate : null;
}

const linkTransfersInTransaction = withTransaction(
  async ({ userId, transactionIds }: { userId: number; transactionIds: string[] }): Promise<Set<string>> => {
    const consumed = new Set<RecordId>();

    try {
      // Serialize concurrent syncs of one user: two matchers running at once can claim
      // overlapping pairs and leave a leg holding a transferId with no counterpart. The
      // lock also makes the later run see the earlier one's committed rows.
      await connection.sequelize.query('SELECT pg_advisory_xact_lock(hashtext(:scope), :userId)', {
        replacements: { scope: 'auto-link-transfers', userId },
        type: QueryTypes.SELECT,
      });

      const { matchTransfersWithManualAccounts } = await getUserSettings({ userId });
      const candidateExcludedTypes = matchTransfersWithManualAccounts
        ? NEVER_MATCHABLE_ACCOUNT_TYPES
        : SEED_EXCLUDED_ACCOUNT_TYPES;

      const accounts = await Accounts.findAll({ where: { userId }, attributes: ['id', 'type', 'externalData'] });
      const matchableAccounts = accounts.filter((account) => !candidateExcludedTypes.includes(account.type));
      if (matchableAccounts.length < 2) return consumed;

      const accountIbanById = new Map<RecordId, string>();
      for (const account of accounts) {
        const iban = (account.externalData as Record<string, unknown> | null)?.iban;
        if (typeof iban === 'string' && iban.length > 0) {
          accountIbanById.set(account.id, normalizeIban({ iban }));
        }
      }

      const syncedTxs = await findTransactions({
        planned: 'exclude',
        access: { creator: userId },
        transfers: 'exclude',
        balanceAdjustments: 'include',
        completeness: 'all',
        where: {
          id: { [Op.in]: transactionIds },
          refundLinked: false,
        },
        order: [['time', 'ASC']],
      });

      const linkableTxs = syncedTxs.filter(
        (tx) => !SEED_EXCLUDED_ACCOUNT_TYPES.includes(tx.accountType) && isLinkableRow({ tx }),
      );
      if (linkableTxs.length === 0) return consumed;

      let linkedCount = 0;

      for (const tx of linkableTxs) {
        if (consumed.has(tx.id)) continue;

        const match = await pickUniqueMatch({ tx, userId, accountIbanById, exclude: consumed, candidateExcludedTypes });
        if (!match) continue;

        // The pair must be unique from both sides. One leg can confirm on its single IBAN
        // while several same-amount rows on the other account fit it equally well, so a
        // one-sided check would pick an arbitrary leg.
        const reverseMatch = await pickUniqueMatch({
          tx: match,
          userId,
          accountIbanById,
          exclude: new Set<RecordId>(),
          candidateExcludedTypes,
        });
        if (reverseMatch?.id !== tx.id) continue;

        const [baseTxId, oppositeTxId] =
          tx.transactionType === TRANSACTION_TYPES.expense ? [tx.id, match.id] : [match.id, tx.id];

        try {
          await linkTransactions({ userId, ids: [[baseTxId, oppositeTxId]] });
          consumed.add(tx.id);
          consumed.add(match.id);
          linkedCount++;
        } catch (error) {
          // Rethrow DatabaseError: the failed statement aborted the surrounding transaction,
          // so every later query would fail too. Only validation errors (e.g. a loan-account
          // leg) are safe to skip.
          if (error instanceof DatabaseError) throw error;
          logger.warn(
            `Auto-link skipped pair [${baseTxId}, ${oppositeTxId}]: ${error instanceof Error ? error.message : error}`,
          );
        }
      }

      if (linkedCount > 0) {
        logger.info(`Auto-linked ${linkedCount} transfer(s) for user ${userId}`);
      }

      return consumed;
    } catch (error) {
      if (error instanceof DatabaseError) throw error;
      logger.error({ message: 'Auto-linking transfers failed', error: error as Error });
      return consumed;
    }
  },
);

/**
 * Links pairs among the passed rows that have no rival claimant on either side. Scoped to
 * the passed ids so a pair the user unlinked is not re-linked. Non-database errors are
 * contained: the pairs already linked in that run are kept and returned. A database error
 * propagates and fails the sync — the matcher shares the sync's transaction, which such an
 * error has already aborted. Returns both legs of every linked pair; callers must keep them
 * out of the sync event because transfer legs ignore categories. Matching policy and
 * per-provider behavior: ../docs/auto-link-transfers.md
 */
export async function autoLinkTransfers({
  userId,
  transactionIds,
}: {
  userId: number;
  transactionIds: string[];
}): Promise<Set<string>> {
  if (transactionIds.length === 0) return new Set();

  return linkTransfersInTransaction({ userId, transactionIds });
}

import { API_ERROR_CODES, BANK_PROVIDER_TYPE, type PAYMENT_TYPES, type RecordId } from '@bt/shared/types';
import { t } from '@i18n/index';
import { BadRequestError, NotFoundError } from '@js/errors';
import { logger } from '@js/utils';
import Accounts from '@models/accounts.model';
import BankDataProviderConnections from '@models/bank-data-provider-connections.model';
import { findTransactions, updateTransactions } from '@models/transactions-query';
import type Transactions from '@models/transactions.model';
import { getUserDefaultCategory } from '@models/users.model';
import { withTransaction } from '@root/services/common/with-transaction';

import { filterIbanCompatible } from './utils/candidate-selection';
import { FINGERPRINT_WINDOW_DAYS, MS_PER_DAY, PENDING_UPGRADE_WINDOW_DAYS } from './utils/constants';
import { hasDependentRows } from './utils/has-dependent-rows';
import { type EditMergeSkipReason, hasManualStamp, isSyncPaymentType, planEditMerge } from './utils/plan-edit-merge';
import {
  getCounterpartyIban,
  getEntryReference,
  hasSettledStatus,
  isBookedCanonical,
  isPreBookingRow,
  syncGeneratedNote,
  toEditMergeSide,
} from './utils/transaction-metadata';

type ReconcileSkipReason = EditMergeSkipReason | 'dependent_rows' | 'categorization_conflict';

/** Authorizes the account and runs the Enable Banking duplicate reconciliation on it. */
export const reconcileDuplicatesForAccount = withTransaction(
  async ({ connectionId, userId, accountId }: { connectionId: string; userId: number; accountId: string }) => {
    const connection = await BankDataProviderConnections.findOne({
      where: { id: connectionId, userId },
    });
    if (!connection) {
      throw new NotFoundError({
        message: t({ key: 'errors.connectionNotFound' }),
        code: API_ERROR_CODES.notFound,
      });
    }

    const account = await Accounts.findOne({
      where: { id: accountId, userId, bankDataProviderConnectionId: connectionId },
    });
    if (!account) {
      throw new NotFoundError({
        message: t({ key: 'bankDataProviders.accountNotLinkedToConnection' }),
        code: API_ERROR_CODES.notFound,
      });
    }

    if (connection.providerType !== BANK_PROVIDER_TYPE.ENABLE_BANKING) {
      throw new BadRequestError({
        message: t({ key: 'bankDataProviders.reconciliationOnlyForEnableBanking' }),
      });
    }

    return reconcileDuplicateTransactionsForAccount({ account });
  },
);

/**
 * One-time reconciliation of duplicate pairs that predate the live-sync
 * matcher. Two passes per (amount, currency, type) bucket:
 *
 *   a) booked row + leftover pre-booking row, booked at or after pending and
 *      within PENDING_UPGRADE_WINDOW_DAYS. When the booked row has a
 *      counterparty IBAN, a pending row carrying the same one wins, an
 *      IBAN-less one within IBAN_LESS_FALLBACK_WINDOW_DAYS is the fallback, and
 *      a different IBAN never pairs; when it has none (card purchases) no IBAN
 *      filtering happens. A pending row with an entryReference only pairs with
 *      a booked row that has one too. User edits on the pending copy move to
 *      the survivor.
 *   b) row with entryReference + row without, within ±2 days and sharing a
 *      counterparty IBAN.
 *
 * Pass (b) is the stricter one: it pairs rows on circumstantial IBAN evidence
 * alone, so any scalar divergence aborts the merge, whereas pass (a) has the
 * explicit pre-booking→BOOK signal and can migrate user edits instead. Pass (b) also
 * compares against canonicals as pass (a) left them, so an edit pass (a) just
 * migrated can block a later strict merge.
 *
 * Both passes refuse to delete an orphan with dependent rows. `mergedCount` and
 * `skippedCount` are the row-level outcomes callers and tests assert on;
 * `consideredPairs` and `unresolvedCount` are diagnostics only, and
 * `unresolvedCount` counts rejected pairs, so one row can add several.
 */
async function reconcileDuplicateTransactionsForAccount({
  account,
}: {
  account: Accounts;
}): Promise<{ mergedCount: number; skippedCount: number; consideredPairs: number; unresolvedCount: number }> {
  // A planned row records money that has not moved, so it can never be the duplicate
  // of a bank row — and this pass deletes what it pairs off.
  const allTxs = await findTransactions({
    planned: 'exclude',
    access: 'unscoped-internal',
    balanceAdjustments: 'include',
    completeness: 'all',
    where: { accountId: account.id },
    order: [['time', 'ASC']],
  });

  // Bucket by (amount, currency, transactionType) so we only compare candidates
  // that could plausibly be the same logical tx. The date-window + IBAN gate
  // happen inside each bucket.
  const buckets = new Map<string, Transactions[]>();
  for (const tx of allTxs) {
    const key = `${tx.amount.toCents()}|${tx.currencyCode}|${tx.transactionType}`;
    const list = buckets.get(key) ?? [];
    list.push(tx);
    buckets.set(key, list);
  }

  let mergedCount = 0;
  let skippedCount = 0;
  let consideredPairs = 0;
  let unresolvedCount = 0;
  // The account owner's default category. On a shared account another member's
  // default reads as a deliberate category, which only makes the merge more
  // conservative – it never deletes more.
  const defaultCategoryId = await getUserDefaultCategory({ id: account.userId });
  const now = new Date();
  const logSkip = ({ orphanId, reason }: { orphanId: RecordId; reason: ReconcileSkipReason }) => {
    logger.info(`Reconcile: skipping orphan tx ${orphanId} (account ${account.id}) – ${reason}`);
  };
  // The FK's ON DELETE SET NULL would otherwise turn a reconciliation merge into the deleted row into a "remove".
  const repointMergedRows = ({ fromId, toId }: { fromId: RecordId; toId: RecordId }) =>
    updateTransactions({
      values: { mergedIntoId: toId },
      where: { accountId: account.id, mergedIntoId: fromId },
      paranoid: false,
      planned: 'include',
      access: 'unscoped-internal',
      balanceAdjustments: 'include',
    });
  // Each check is eight queries and the same pending row is offered to every
  // booked row in its bucket; nothing inside this run can change the answer.
  const dependentRowsByTxId = new Map<RecordId, boolean>();
  const hasDependentRowsMemoized = async ({ tx }: { tx: Transactions }): Promise<boolean> => {
    const cached = dependentRowsByTxId.get(tx.id);
    if (cached !== undefined) return cached;
    const result = await hasDependentRows({ tx });
    dependentRowsByTxId.set(tx.id, result);
    return result;
  };

  for (const candidates of buckets.values()) {
    if (candidates.length < 2) continue;

    const pendingRows = candidates.filter((c) => isPreBookingRow({ tx: c }));
    const bookedRows = candidates.filter((c) => isBookedCanonical({ tx: c }));

    // Nearest-first over every plausible pair, so the closest booked/pending
    // couple wins regardless of iteration order. Deletes are irreversible, so
    // only pairs whose direction is provably consistent (booked at or after
    // pending) are accepted; that misses the occasional pair whose pending
    // value_date estimate postdated the booking, which is the cheaper mistake.
    const pairs: { booked: Transactions; pending: Transactions; distance: number }[] = [];
    for (const booked of bookedRows) {
      const bookedHasEntryReference = getEntryReference({ tx: booked }) !== null;
      // Window first: the IBAN gate's IBAN-less fallback depends on which
      // candidates are in play, so an out-of-window match must not suppress it.
      const eligible = pendingRows.filter((pending) => {
        const distance = booked.time.getTime() - pending.time.getTime();
        if (distance < 0 || distance > PENDING_UPGRADE_WINDOW_DAYS * MS_PER_DAY) return false;
        // A referenced pending row can only be re-issued under a fresh
        // reference, so a reference-less booked row is not its copy.
        return bookedHasEntryReference || getEntryReference({ tx: pending }) === null;
      });
      const ibanCompatible = filterIbanCompatible({
        candidates: eligible,
        counterpartyIban: getCounterpartyIban({ tx: booked }),
        date: booked.time,
      });
      unresolvedCount += pendingRows.length - ibanCompatible.length;
      for (const pending of ibanCompatible) {
        pairs.push({ booked, pending, distance: booked.time.getTime() - pending.time.getTime() });
      }
    }
    pairs.sort(
      (a, b) =>
        a.distance - b.distance || a.booked.id.localeCompare(b.booked.id) || a.pending.id.localeCompare(b.pending.id),
    );
    consideredPairs += pairs.length;

    const pairedBooked = new Set<RecordId>();
    const mergedPending = new Set<RecordId>();
    // A skipped pair must leave both sides free for other pairs, but pass (b)
    // still has to keep its hands off anything pass (a) looked at and rejected.
    const skipTouchedPending = new Set<RecordId>();

    for (const { booked, pending } of pairs) {
      if (pairedBooked.has(booked.id) || mergedPending.has(pending.id)) {
        unresolvedCount++;
        continue;
      }

      const plan = planEditMerge({
        orphan: toEditMergeSide({ tx: pending }),
        canonical: toEditMergeSide({ tx: booked }),
        orphanSyncNote: syncGeneratedNote({ tx: pending }),
        canonicalSyncNote: syncGeneratedNote({ tx: booked }),
        defaultCategoryId,
        defaultPaymentType: account.defaultPaymentType,
        now,
      });
      if (plan.action === 'skip') {
        logSkip({ orphanId: pending.id, reason: plan.reason });
        skipTouchedPending.add(pending.id);
        continue;
      }
      if (await hasDependentRowsMemoized({ tx: pending })) {
        logSkip({ orphanId: pending.id, reason: 'dependent_rows' });
        skipTouchedPending.add(pending.id);
        continue;
      }

      const survivorUpdates: typeof plan.valuesToMove & { externalData?: Transactions['externalData'] } = {
        ...plan.valuesToMove,
      };
      const bookedExternalData = booked.externalData as Record<string, unknown> | null;
      // The pending row's hash is the anchor tier 2 needs when the ASPSP re-sends the
      // PDNG payload; without it that payload recreates the duplicate just merged away.
      if (pending.originalId && bookedExternalData?.pendingHash === undefined) {
        survivorUpdates.externalData = { ...bookedExternalData, pendingHash: pending.originalId };
      }
      if (Object.keys(survivorUpdates).length > 0) {
        await booked.update(survivorUpdates);
      }
      await repointMergedRows({ fromId: pending.id, toId: booked.id });
      await pending.destroy({ force: true });
      pairedBooked.add(booked.id);
      mergedPending.add(pending.id);
      mergedCount++;
    }

    for (const pendingId of skipTouchedPending) {
      if (!mergedPending.has(pendingId)) skippedCount++;
    }

    const canonicalRows = candidates.filter(
      (c) => getEntryReference({ tx: c }) !== null && hasSettledStatus({ tx: c }),
    );
    // Pass (a) survivors stay out of pass (b). The case that motivates it: a booked
    // row with no entryReference of its own re-enters as an orphan, and pass (b)
    // would destroy it together with the edits pass (a) migrated onto it.
    const orphanRows = candidates.filter(
      (c) =>
        !mergedPending.has(c.id) &&
        !skipTouchedPending.has(c.id) &&
        !pairedBooked.has(c.id) &&
        getEntryReference({ tx: c }) === null,
    );

    for (const orphan of orphanRows) {
      // IBAN gate: require both rows to share the same counterparty IBAN.
      // Expenses use creditorAccount (money going out to a creditor), income
      // uses debtorAccount. If the orphan has no IBAN (e.g. a manual entry
      // that happens to share amount/currency/type with a bank row), skip –
      // same rule findExistingTransactionForSync applies for live syncs.
      const orphanIban = getCounterpartyIban({ tx: orphan });
      if (!orphanIban) {
        unresolvedCount++;
        continue;
      }

      const canonical = canonicalRows.find(
        (c) =>
          c.id !== orphan.id &&
          Math.abs(c.time.getTime() - orphan.time.getTime()) <= FINGERPRINT_WINDOW_DAYS * MS_PER_DAY &&
          getCounterpartyIban({ tx: c }) === orphanIban,
      );
      if (!canonical) {
        unresolvedCount++;
        continue;
      }

      const blocker = await findOrphanDeletionBlocker({
        orphan,
        canonical,
        defaultPaymentType: account.defaultPaymentType,
      });
      if (blocker) {
        logSkip({ orphanId: orphan.id, reason: blocker });
        skippedCount++;
        continue;
      }

      await repointMergedRows({ fromId: orphan.id, toId: canonical.id });
      await orphan.destroy({ force: true });
      mergedCount++;
    }
  }

  logger.info(
    `Reconcile complete for account ${account.id}: merged=${mergedCount} skipped=${skippedCount} consideredPairs=${consideredPairs} unresolved=${unresolvedCount}`,
  );

  return { mergedCount, skippedCount, consideredPairs, unresolvedCount };
}

/**
 * Conservative gate for reconcile pass (b). Names what would be silently lost
 * by destroying the orphan – dependent rows (transferId, refundLinked, splits,
 * tags, refunds, trackers, subscriptions, group membership) or a user-mutable
 * scalar that diverges from the canonical. Returns null when the orphan is safe
 * to delete.
 *
 * `planEditMerge` is the lenient sibling used by pass (a); pass (b) is
 * deliberately stricter because its pairing evidence is only circumstantial.
 */
async function findOrphanDeletionBlocker({
  orphan,
  canonical,
  defaultPaymentType,
}: {
  orphan: Transactions;
  canonical: Transactions;
  defaultPaymentType: PAYMENT_TYPES | null;
}): Promise<ReconcileSkipReason | null> {
  const orphanNote = orphan.note ?? '';
  const canonicalNote = canonical.note ?? '';
  if (orphanNote !== canonicalNote && orphanNote !== '') return 'note_conflict';
  if (orphan.categoryId !== canonical.categoryId) return 'category_conflict';
  // Same category, but only the orphan proves a human picked it. Deleting it
  // would put the survivor back in the AI-categorization queue.
  if (hasManualStamp({ meta: orphan.categorizationMeta }) && !hasManualStamp({ meta: canonical.categorizationMeta })) {
    return 'categorization_conflict';
  }
  if (
    orphan.paymentType !== canonical.paymentType &&
    !isSyncPaymentType({ paymentType: orphan.paymentType, defaultPaymentType })
  ) {
    return 'payment_type_conflict';
  }
  // payeeLocked marks a Payee the user assigned or cleared by hand.
  if (orphan.payeeLocked && orphan.payeeId !== canonical.payeeId) return 'payee_conflict';

  return (await hasDependentRows({ tx: orphan })) ? 'dependent_rows' : null;
}

import { ACCOUNT_TYPES, type RecordId, TRANSACTION_TYPES } from '@bt/shared/types';
import { toMoneyColumnValue } from '@common/types/money-column';
import { ValidationError } from '@js/errors';
import { logger } from '@js/utils';
import Accounts from '@models/accounts.model';
import { findTransactions } from '@models/transactions-query';
import Transactions from '@models/transactions.model';
import { linkTransactions } from '@services/transactions/transactions-linking/link-transactions';
import { addDays, isWithinInterval, subDays } from 'date-fns';
import { Op, Sequelize } from 'sequelize';

import { isLinkableRow } from '../utils/auto-link-transfers';
import { TRANSFER_DATE_WINDOW_DAYS, normalizeIban } from '../utils/transfer-matching';

/**
 * Extract the counterparty IBAN from a Walutomat transaction's operationDetails.
 *
 * - PAYIN: `sourceAccount` is the sender's IBAN (the external bank account that sent money)
 * - PAYOUT: `destinationAccount` is the receiver's IBAN (the external bank account receiving money)
 */
function extractCounterpartyIban({
  operationType,
  operationDetails,
}: {
  operationType: string;
  operationDetails: Array<{ key: string; value: string }>;
}): string | null {
  if (operationType === 'PAYIN') {
    return operationDetails.find((d) => d.key === 'sourceAccount')?.value ?? null;
  }
  if (operationType === 'PAYOUT') {
    return operationDetails.find((d) => d.key === 'destinationAccount')?.value ?? null;
  }
  return null;
}

/**
 * Another Walutomat leg fitting the counterpart equally well. Without this check two same-amount
 * payouts to one IBAN would both claim the single synced income and an arbitrary one would win.
 */
function hasRivalLeg({
  walutomatTxs,
  tx,
  counterpart,
  consumed,
  ibanToAccountIds,
}: {
  walutomatTxs: Transactions[];
  tx: Transactions;
  counterpart: Transactions;
  consumed: Set<RecordId>;
  ibanToAccountIds: Map<string, RecordId[]>;
}): boolean {
  const counterpartTime = new Date(counterpart.time);

  return walutomatTxs.some((leg) => {
    if (leg.id === tx.id) return false;
    if (consumed.has(leg.id)) return false;
    if (leg.transactionType === counterpart.transactionType) return false;
    if (leg.currencyCode !== counterpart.currencyCode) return false;
    if (leg.amount.toCents() !== counterpart.amount.toCents()) return false;

    const legTime = new Date(leg.time);
    if (
      !isWithinInterval(counterpartTime, {
        start: subDays(legTime, TRANSFER_DATE_WINDOW_DAYS),
        end: addDays(legTime, TRANSFER_DATE_WINDOW_DAYS),
      })
    ) {
      return false;
    }

    const externalData = leg.externalData as {
      operationType: string;
      operationDetails: Array<{ key: string; value: string }>;
    };
    const iban = extractCounterpartyIban({
      operationType: externalData.operationType,
      operationDetails: externalData.operationDetails ?? [],
    });
    if (!iban) return false;

    return (ibanToAccountIds.get(normalizeIban({ iban })) ?? []).includes(counterpart.accountId);
  });
}

/**
 * Auto-link Walutomat PAYIN/PAYOUT transactions to their counterparts in other
 * bank accounts by matching IBAN + exact amount + currency + date window.
 *
 * Both Enable Banking and Monobank store the account's IBAN in
 * Account.externalData.iban. This function queries all user accounts for that
 * field, matching against the IBAN found in Walutomat's operationDetails.
 *
 * Matching criteria (all must be true):
 * - Account IBAN matches Walutomat's sourceAccount/destinationAccount
 * - Exact same amount (to the cent)
 * - Same currency
 * - Date within ±3 days
 * - Opposite transaction type (PAYOUT→income, PAYIN→expense)
 * - Neither transaction is already linked as a transfer
 * - Neither transaction is planned
 *
 * Only links when the pair is unambiguous from both sides, and a transaction already linked
 * earlier in the same run is not offered again.
 */
export async function linkCrossProviderTransfers({ userId }: { userId: number }): Promise<void> {
  // Step 1: Find unlinked Walutomat PAYIN/PAYOUT transactions
  const walutomatTxs = await findTransactions({
    planned: 'exclude',
    access: { creator: userId },
    balanceAdjustments: 'include',
    transfers: 'exclude',
    completeness: 'all',
    where: {
      accountType: ACCOUNT_TYPES.walutomat,
      refundLinked: false,
      [Op.or]: [
        Sequelize.where(Sequelize.literal(`"externalData"->>'operationType'`), 'PAYIN'),
        Sequelize.where(Sequelize.literal(`"externalData"->>'operationType'`), 'PAYOUT'),
      ],
    },
  });

  if (walutomatTxs.length === 0) return;

  // Step 2: Build IBAN → accountId[] index from all user accounts that have an IBAN
  // Both Enable Banking and Monobank store IBANs in externalData.iban
  const accountsWithIban = await Accounts.findAll({
    where: {
      userId,
      [Op.and]: [Sequelize.where(Sequelize.literal(`"externalData"->>'iban'`), { [Op.not]: null })],
    },
  });

  const ibanToAccountIds = new Map<string, RecordId[]>();
  for (const account of accountsWithIban) {
    const externalData = account.externalData as Record<string, unknown> | null;
    const iban = externalData?.iban as string | undefined;
    if (!iban) continue;

    const normalized = normalizeIban({ iban });
    const existing = ibanToAccountIds.get(normalized);
    if (existing) {
      existing.push(account.id);
    } else {
      ibanToAccountIds.set(normalized, [account.id]);
    }
  }

  if (ibanToAccountIds.size === 0) return;

  // Step 3: Match and link each Walutomat transaction
  const consumed = new Set<RecordId>();
  let linkedCount = 0;

  for (const tx of walutomatTxs) {
    if (consumed.has(tx.id)) continue;

    const externalData = tx.externalData as {
      operationType: string;
      operationDetails: Array<{ key: string; value: string }>;
    };

    const counterpartyIban = extractCounterpartyIban({
      operationType: externalData.operationType,
      operationDetails: externalData.operationDetails ?? [],
    });

    if (!counterpartyIban) continue;

    const normalizedIban = normalizeIban({ iban: counterpartyIban });
    const matchingAccountIds = ibanToAccountIds.get(normalizedIban);

    if (!matchingAccountIds || matchingAccountIds.length === 0) continue;

    // Determine the expected opposite transaction type
    // PAYIN = money coming INTO Walutomat → the other account had an EXPENSE
    // PAYOUT = money going OUT of Walutomat → the other account had an INCOME
    const expectedOppositeType =
      externalData.operationType === 'PAYIN' ? TRANSACTION_TYPES.expense : TRANSACTION_TYPES.income;

    const txDate = new Date(tx.time);
    const dateFrom = subDays(txDate, TRANSFER_DATE_WINDOW_DAYS);
    const dateTo = addDays(txDate, TRANSFER_DATE_WINDOW_DAYS);

    // Search for matching transactions in the identified accounts
    const rows = await findTransactions({
      planned: 'exclude',
      access: { creator: userId },
      balanceAdjustments: 'include',
      transfers: 'exclude',
      completeness: 'all',
      where: {
        accountId: { [Op.in]: matchingAccountIds },
        transactionType: expectedOppositeType,
        refundLinked: false,
        currencyCode: tx.currencyCode,
        amount: toMoneyColumnValue({ money: tx.amount }),
        time: { [Op.between]: [dateFrom, dateTo] },
      },
    });

    const candidates = rows.filter((row) => !consumed.has(row.id) && isLinkableRow({ tx: row }));

    // Only auto-link if exactly 1 unambiguous match
    if (candidates.length !== 1) continue;

    const match = candidates[0]!;

    if (hasRivalLeg({ walutomatTxs, tx, counterpart: match, consumed, ibanToAccountIds })) continue;

    // Determine base (expense) and opposite (income)
    const [baseTxId, oppositeTxId] =
      tx.transactionType === TRANSACTION_TYPES.expense ? [tx.id, match.id] : [match.id, tx.id];

    try {
      await linkTransactions({ userId, ids: [[baseTxId, oppositeTxId]] });
      consumed.add(tx.id);
      consumed.add(match.id);
      linkedCount += 1;
    } catch (err) {
      // A rejected pair (planned or split-bearing leg) must not abort the batch; anything else is a broken run.
      if (!(err instanceof ValidationError)) throw err;
      logger.warn(
        `[Walutomat] Failed to auto-link cross-provider pair ${baseTxId} <-> ${oppositeTxId}: ${err.message}`,
      );
    }
  }

  if (linkedCount === 0) return;

  logger.info(`[Walutomat] Auto-linked ${linkedCount} cross-provider transfer(s) for user ${userId}`);
}

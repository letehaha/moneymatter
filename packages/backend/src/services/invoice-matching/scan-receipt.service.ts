import { ACCOUNT_STATUSES, ACCOUNT_TYPES, type ExtractedInvoice, FEATURES, TRANSACTION_TYPES } from '@bt/shared/types';
import { logger } from '@js/utils/logger';
import { trackReceiptScanned } from '@js/utils/posthog';
import Accounts from '@models/accounts.model';
import { getCategories } from '@models/categories.model';
import PayeeAliases from '@models/payee-aliases.model';
import Payees from '@models/payees.model';
import { findTransactions } from '@models/transactions-query';
import type Transactions from '@models/transactions.model';
import { type FeatureAccess, recordFeatureUse } from '@services/entitlements/feature-trial.service';
import { buildHaystack } from '@services/payees/fuzzy-matcher';
import { subDays } from 'date-fns';
import { Op, type WhereOptions, col, fn } from 'sequelize';

import { extractInvoice } from './extract-invoice.service';

const LOOKBACK_DAYS = 90;

async function countByAccount({ userId, where }: { userId: number; where: WhereOptions<Transactions> }) {
  const rows = (await findTransactions({
    planned: 'exclude',
    access: { creator: userId },
    transfers: 'exclude',
    balanceAdjustments: 'exclude',
    completeness: 'all',
    where,
    attributes: ['accountId', [fn('COUNT', col('id')), 'count']],
    group: ['accountId'],
    raw: true,
  })) as unknown as { accountId: string; count: string }[];
  return new Map(rows.map((row) => [row.accountId, Number(row.count)]));
}

/**
 * Ranks the user's active manual accounts: the one most used with the payee first, then
 * the receipt's currency, then the most used lately.
 */
async function suggestReceiptAccount({
  userId,
  invoice,
  payeeId,
}: {
  userId: number;
  invoice: ExtractedInvoice;
  payeeId: string | null;
}): Promise<string | null> {
  const accounts = await Accounts.findAll({
    where: { userId, status: ACCOUNT_STATUSES.active, type: ACCOUNT_TYPES.system },
    attributes: ['id', 'currencyCode'],
  });
  if (!accounts.length) return null;

  const accountId = { [Op.in]: accounts.map((account) => account.id) };
  const [payeeCounts, recentCounts] = await Promise.all([
    payeeId ? countByAccount({ userId, where: { accountId, payeeId } }) : new Map<string, number>(),
    countByAccount({
      userId,
      where: {
        accountId,
        transactionType: invoice.transactionType,
        time: { [Op.gte]: subDays(new Date(), LOOKBACK_DAYS) },
      },
    }),
  ]);

  const ranked = accounts
    .map((account) => ({
      accountId: account.id,
      currencyCode: account.currencyCode,
      payeeCount: payeeCounts.get(account.id) ?? 0,
      recentCount: recentCounts.get(account.id) ?? 0,
    }))
    .toSorted(
      (a, b) =>
        b.payeeCount - a.payeeCount ||
        Number(b.currencyCode === invoice.currencyCode) - Number(a.currencyCode === invoice.currencyCode) ||
        b.recentCount - a.recentCount,
    );

  return ranked[0]?.accountId ?? null;
}

function findByName<T extends { text: string }>({
  entries,
  name,
}: {
  entries: T[];
  name: string | null;
}): T | undefined {
  const wanted = name?.trim().toLowerCase();
  return wanted ? entries.find((entry) => entry.text.trim().toLowerCase() === wanted) : undefined;
}

export interface ReceiptScanResult {
  invoice: ExtractedInvoice;
  /** `HH:mm` as printed, in the receipt's local time. */
  issueTime: string | null;
  /** Always an active manual account, the only kind a manual transaction can be saved to. */
  suggestedAccountId: string | null;
  suggestedPayeeId: string | null;
  suggestedCategoryId: string | null;
}

/** Reads a receipt and suggests how to file it as a manual transaction. Nothing is stored. */
export async function scanReceipt({
  userId,
  bytes,
  transactionType,
  access,
}: {
  userId: number;
  bytes: Buffer;
  transactionType: TRANSACTION_TYPES;
  access: Exclude<FeatureAccess, 'denied'>;
}): Promise<ReceiptScanResult> {
  const [payees, categories] = await Promise.all([
    Payees.findAll({ where: { userId }, include: [{ model: PayeeAliases, as: 'aliases' }] }),
    getCategories({ userId }),
  ]);
  const knownPayees = buildHaystack({ payees });
  const nameById = new Map(categories.map((category) => [category.id, category.name]));
  const knownCategories = categories.map((category) => ({
    categoryId: category.id,
    text: [category.parentId && nameById.get(category.parentId), category.name].filter(Boolean).join(' › '),
  }));

  const onTrial = access === 'trial';
  const { invoice, issueTime, payeeName, categoryName, provider, modelId } = await extractInvoice({
    userId,
    bytes,
    transactionType,
    allowOperatorKey: onTrial,
    knownPayeeNames: knownPayees.map((entry) => entry.text),
    knownCategoryNames: knownCategories.map((entry) => entry.text),
  });

  const suggestedPayeeId = findByName({ entries: knownPayees, name: payeeName })?.payeeId ?? null;
  const payeeDefaultCategoryId = payees.find((payee) => payee.id === suggestedPayeeId)?.defaultCategoryId ?? null;

  const result: ReceiptScanResult = {
    invoice,
    issueTime,
    suggestedAccountId: await suggestReceiptAccount({ userId, invoice, payeeId: suggestedPayeeId }),
    suggestedPayeeId,
    suggestedCategoryId:
      payeeDefaultCategoryId ?? findByName({ entries: knownCategories, name: categoryName })?.categoryId ?? null,
  };
  trackReceiptScanned({
    userId,
    transactionType,
    provider,
    modelId,
    hasAccount: result.suggestedAccountId !== null,
    hasPayee: result.suggestedPayeeId !== null,
    hasCategory: result.suggestedCategoryId !== null,
  });

  if (onTrial) {
    // The AI read is paid for and the result is in hand; losing the counter is cheaper than losing the answer.
    try {
      await recordFeatureUse({ userId, feature: FEATURES.invoice_matching });
    } catch (error) {
      logger.error('[Receipt Scan] Could not record the spent free try', { userId, error });
    }
  }

  return result;
}

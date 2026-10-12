import { ACCOUNT_TYPES, TRANSACTION_TRANSFER_NATURE, TRANSACTION_TYPES } from '@bt/shared/types';
import { logger } from '@js/utils/logger';
import Accounts from '@models/accounts.model';
import { connection } from '@models/index';
import Transactions from '@models/transactions.model';
import { addMinutes, startOfDay, subDays } from 'date-fns';
import { QueryTypes } from 'sequelize';
import { v4 as uuidv4, v7 as uuidv7 } from 'uuid';

import { DEMO_CONFIG, type DemoAccountKey } from './demo-config';
import { getDemoTemplate } from './demo-template-cache.service';
import { setupAccountGroups } from './seed-account-groups.service';
import { setupAutomations } from './seed-automations.service';
import { setupBudgetPlan } from './seed-budget-plan.service';
import {
  createAccounts,
  createBudgets,
  createCategories,
  createTags,
  setupCurrencies,
  setupDashboardSettings,
  setupLoans,
  setupVehicles,
  setupVentures,
} from './seed-demo-data.service';
import { setupInvestments } from './seed-investments.service';
import { seedPayees } from './seed-payees.service';
import { setupSubscriptions } from './seed-subscriptions.service';
import { seedTransactionExtras } from './seed-transaction-extras.service';
import { sumSpendByCategoryKey } from './template/budget-spend';
import { toBaseCurrencyCents } from './template/fx';
import type { DemoTemplateTransaction } from './template/types';

/** How far back demo budgets look: a fixed window, always complete unlike a part-elapsed calendar month. */
const BUDGET_WINDOW_DAYS = 30;

interface TransferReconcilableRow {
  transferId: string | null;
  currencyCode: string;
  amount: number;
  refAmount: number;
}

/**
 * Counts of template references the seeded data couldn't resolve, whether a
 * dropped row or a category fallback to "Other".
 *
 * Every count is zero in a healthy build: the template is deterministic and
 * shared by every signup, so nonzero flags a bug in the generator or seeders,
 * not visitor action.
 */
interface DemoApplyMisses {
  accounts: number;
  categoryFallbacks: number;
  payees: number;
  splits: number;
  refunds: number;
  tagLinks: number;
  groups: number;
}

/**
 * Applies the pre-generated demo template to a user.
 *
 * Inserts rows with hooks disabled, then recomputes balances in raw SQL, since
 * a visitor is waiting on this during signup. The template stores no id,
 * `refAmount`, or `transferId`, so all three get resolved here.
 */
export async function applyDemoTemplate({
  userId,
  referenceDate = new Date(),
}: {
  userId: number;
  /** The demo's "today". Every seeded record dates itself against this. */
  referenceDate?: Date;
}): Promise<void> {
  const startTime = Date.now();
  logger.info(`Applying demo template for user ${userId}...`);

  const template = getDemoTemplate();
  const misses: DemoApplyMisses = {
    accounts: 0,
    categoryFallbacks: 0,
    payees: 0,
    splits: 0,
    refunds: 0,
    tagLinks: 0,
    groups: 0,
  };

  await setupCurrencies({ userId });
  const categoryMap = await createCategories({ userId });
  const tagMap = await createTags({ userId });
  const accounts = await createAccounts({ userId });
  const payeeMap = await seedPayees({ userId, categoryMap });

  // Display names are what came back from the DB; the template speaks keys.
  const keyByAccountName = new Map<string, DemoAccountKey>(
    DEMO_CONFIG.accounts.map((account) => [account.name, account.key]),
  );

  const accountKeyToId: Partial<Record<DemoAccountKey, string>> = {};
  const accountKeyToAccountType: Partial<Record<DemoAccountKey, ACCOUNT_TYPES>> = {};
  const accountKeyToCurrency: Partial<Record<DemoAccountKey, string>> = {};
  for (const account of accounts) {
    const key = keyByAccountName.get(account.name);
    if (!key) {
      misses.accounts += 1;
      continue;
    }

    accountKeyToId[key] = account.id;
    accountKeyToAccountType[key] = account.type;
    accountKeyToCurrency[key] = account.currencyCode;
  }

  const fallbackCategoryId = categoryMap.get('other') || undefined;

  // Rows that take part in a refund pair carry the flag at insert time, which
  // saves a second UPDATE pass over the whole table.
  const refundLinkedRefs = new Set(template.refunds.flatMap((pair) => [pair.originalRef, pair.refundRef]));

  const idByRef = new Map<string, string>();
  const transferIdByKey = new Map<string, string>();

  const resolveTime = (tx: DemoTemplateTransaction): Date => {
    const time = addMinutes(startOfDay(subDays(referenceDate, tx.dayOffset)), tx.minuteOfDay);
    // Otherwise minuteOfDay can push today's row past the moment this runs,
    // dating a transaction in the future.
    return time > referenceDate ? referenceDate : time;
  };

  const rows = template.transactions.map((tx) => {
    const id = uuidv7();
    if (tx.ref) idByRef.set(tx.ref, id);

    let transferId: string | null = null;
    if (tx.transferKey) {
      transferId = transferIdByKey.get(tx.transferKey) ?? uuidv4();
      transferIdByKey.set(tx.transferKey, transferId);
    }

    const currencyCode = accountKeyToCurrency[tx.accountKey] || DEMO_CONFIG.baseCurrency;

    const categoryId = categoryMap.get(tx.categoryKey);
    if (!categoryId) misses.categoryFallbacks += 1;

    let payeeId: string | null = null;
    if (tx.merchantName) {
      payeeId = payeeMap.get(tx.merchantName) ?? null;
      if (!payeeId) misses.payees += 1;
    }

    return {
      id,
      userId,
      amount: tx.amount,
      refAmount: toBaseCurrencyCents({
        amount: tx.amount,
        currencyCode,
        dayOffset: tx.dayOffset,
        spotRate: DEMO_CONFIG.exchangeRates[currencyCode],
      }),
      transactionType: tx.transactionType,
      categoryId: categoryId ?? fallbackCategoryId,
      accountId: accountKeyToId[tx.accountKey],
      payeeId,
      currencyCode,
      refCurrencyCode: DEMO_CONFIG.baseCurrency,
      accountType: accountKeyToAccountType[tx.accountKey] || ACCOUNT_TYPES.system,
      transferNature: tx.transferNature ?? TRANSACTION_TRANSFER_NATURE.not_transfer,
      transferId,
      paymentType: tx.paymentType,
      note: tx.note,
      time: resolveTime(tx),
      commissionRate: 0,
      refCommissionRate: 0,
      cashbackAmount: 0,
      refundLinked: tx.ref ? refundLinkedRefs.has(tx.ref) : false,
    };
  });

  reconcileTransferRefAmounts({ rows });

  logger.info(`Bulk inserting ${rows.length} demo transactions...`);
  await Transactions.bulkCreate(rows, { hooks: false, validate: false });

  const refAmountById = new Map(rows.map((row) => [row.id, row.refAmount]));
  const amountById = new Map(rows.map((row) => [row.id, row.amount]));

  await seedTransactionExtras({
    userId,
    splits: template.splits.flatMap((split) => {
      const transactionId = idByRef.get(split.transactionRef);
      const categoryId = categoryMap.get(split.categoryKey);
      if (!transactionId || !categoryId) {
        misses.splits += 1;
        return [];
      }

      // Splits store both the account-currency and base-currency amounts.
      // Scaling the parent's own refAmount keeps the two consistent with
      // whichever rate applied that day.
      const parentAmount = amountById.get(transactionId) ?? split.amount;
      const parentRefAmount = refAmountById.get(transactionId) ?? split.amount;

      return [
        {
          transactionId,
          categoryId,
          amount: split.amount,
          refAmount: Math.round((split.amount / parentAmount) * parentRefAmount),
          note: split.note,
        },
      ];
    }),
    refunds: template.refunds.flatMap((pair) => {
      const originalTxId = idByRef.get(pair.originalRef);
      const refundTxId = idByRef.get(pair.refundRef);
      if (!originalTxId || !refundTxId) {
        misses.refunds += 1;
        return [];
      }

      return [{ originalTxId, refundTxId }];
    }),
    // Tagged rows rarely carry a `ref`, so this resolves by position: `rows`
    // is built one-for-one from `template.transactions`.
    tagLinks: template.transactions.flatMap((tx, index) => {
      const transactionId = rows[index]?.id;
      if (!tx.tagKeys?.length) return [];
      if (!transactionId) {
        misses.tagLinks += tx.tagKeys.length;
        return [];
      }

      return tx.tagKeys.flatMap((tagKey) => {
        const tagId = tagMap.get(tagKey);
        if (!tagId) {
          misses.tagLinks += 1;
          return [];
        }

        return [{ tagId, transactionId }];
      });
    }),
    groups: template.groups.flatMap((group) => {
      const transactionIds = group.transactionRefs
        .map((ref) => idByRef.get(ref))
        .filter((id): id is string => id !== undefined);

      // The group service refuses anything smaller than two members.
      if (transactionIds.length < 2) {
        misses.groups += 1;
        return [];
      }

      return [{ name: group.name, note: group.note, transactionIds }];
    }),
  });

  reportMisses({ misses });

  // Runs before updateAccountBalances below: its portfolio-funding transactions
  // land on the savings account and must be counted in that recompute.
  const savingsAccountId = accountKeyToId['savings'];
  if (savingsAccountId) {
    await setupInvestments({ userId, referenceDate, savingsAccountId });
  }

  await updateAccountBalances({ userId });
  await rebuildBalancesHistory({ userId });

  await createBudgets({
    userId,
    categoryMap,
    spendByCategoryKey: sumSpendByCategoryKey({
      template,
      windowDays: BUDGET_WINDOW_DAYS,
      currencyByAccountKey: accountKeyToCurrency,
    }),
    windowStart: subDays(referenceDate, BUDGET_WINDOW_DAYS),
    windowEnd: referenceDate,
  });

  // A showcase extra: a failure here costs the visitor the Budget page, not the whole demo.
  await setupBudgetPlan({
    userId,
    accountIds: accounts.map((account) => account.id),
    categoryMap,
    template,
    currencyByAccountKey: accountKeyToCurrency,
    referenceDate,
  }).catch((error: unknown) => {
    logger.error('Demo budget seeding failed', { userId, error: error as Error });
  });

  const mainCheckingAccountId = accountKeyToId['main_checking'];
  if (mainCheckingAccountId) {
    await setupSubscriptions({
      userId,
      accountId: mainCheckingAccountId,
      categoryMap,
      referenceDate,
      payments: template.subscriptionPayments.flatMap((payment) => {
        const transactionId = idByRef.get(payment.transactionRef);
        if (!transactionId) return [];

        return [
          {
            subscriptionName: payment.subscriptionName,
            transactionId,
            dueDate: subDays(referenceDate, payment.dueDayOffset),
          },
        ];
      }),
    });
  }

  await setupDashboardSettings({ userId, categoryMap });
  await setupVehicles({ userId, referenceDate });
  await setupLoans({ userId, referenceDate });
  await setupVentures({ userId, referenceDate });
  const accountGroupIdByName = await setupAccountGroups({ userId });
  await setupAutomations({
    userId,
    referenceDate,
    categoryMap,
    tagMap,
    payeeMap,
    accountKeyToId,
    accountGroupIdByName,
  });

  const duration = Date.now() - startTime;
  logger.info(`Demo template applied for user ${userId} in ${duration}ms (${rows.length} transactions)`);
}

/**
 * Forces both legs of a transfer to the same base-currency value.
 *
 * Each leg converts independently at that day's rate, so a cross-currency pair
 * can otherwise arrive worth more or less than it left. When one leg is already
 * in the base currency, its own amount becomes the transfer's value, matching
 * the real transfer service.
 */
function reconcileTransferRefAmounts({ rows }: { rows: TransferReconcilableRow[] }): void {
  const legsByTransferId = new Map<string, TransferReconcilableRow[]>();

  for (const row of rows) {
    if (!row.transferId) continue;
    const legs = legsByTransferId.get(row.transferId) ?? [];
    legs.push(row);
    legsByTransferId.set(row.transferId, legs);
  }

  for (const legs of legsByTransferId.values()) {
    const baseLeg = legs.find((leg) => leg.currencyCode === DEMO_CONFIG.baseCurrency);
    if (!baseLeg) continue;

    for (const leg of legs) {
      leg.refAmount = baseLeg.amount;
    }
  }
}

/**
 * Reports unresolved template references once, at `error` level.
 *
 * Without it, a demo account missing splits, refunds, tags, or payees reads as
 * complete, and a mistyped category key lands in "Other" unflagged.
 */
function reportMisses({ misses }: { misses: DemoApplyMisses }): void {
  const nonZero = Object.entries(misses).filter(([, count]) => count > 0);
  if (!nonZero.length) return;

  const summary = nonZero.map(([name, count]) => `${name}=${count}`).join(', ');
  logger.error(`Demo template references the seeded data could not resolve: ${summary}`);
}

/**
 * Update account currentBalance and refCurrentBalance based on actual transactions.
 *
 * Reads the `real_transactions` view: a balance is money that has moved, so plans must not
 * count, while balance adjustments and both legs of every transfer must — which is exactly
 * the one filter the view applies.
 */
async function updateAccountBalances({ userId }: { userId: number }): Promise<void> {
  const sequelize = connection.sequelize;

  await sequelize.query(
    `
    UPDATE "Accounts" SET
      "currentBalance" = "initialBalance" + COALESCE((
        SELECT SUM(
          CASE WHEN t."transactionType" = :incomeType THEN t.amount ELSE -t.amount END
        ) FROM real_transactions t WHERE t."accountId" = "Accounts".id
      ), 0),
      "refCurrentBalance" = "refInitialBalance" + COALESCE((
        SELECT SUM(
          CASE WHEN t."transactionType" = :incomeType THEN t."refAmount" ELSE -t."refAmount" END
        ) FROM real_transactions t WHERE t."accountId" = "Accounts".id
      ), 0)
    WHERE "userId" = :userId
    `,
    {
      replacements: { userId, incomeType: TRANSACTION_TYPES.income },
      type: QueryTypes.UPDATE,
    },
  );
}

/**
 * Rebuild the Balances history table for a user's accounts.
 * Deletes initial balance records created by account creation hooks,
 * then rebuilds with running balances including first-of-month entries.
 *
 * Same reasoning as `updateAccountBalances` for reading `real_transactions`.
 */
async function rebuildBalancesHistory({ userId }: { userId: number }): Promise<void> {
  const sequelize = connection.sequelize;

  // Get account IDs for this user
  const accounts = await Accounts.findAll({
    where: { userId },
    attributes: ['id'],
    raw: true,
  });
  const accountIds = accounts.map((a) => a.id);

  if (accountIds.length === 0) return;

  // Delete initial balance records (will be replaced by full rebuild)
  await sequelize.query(`DELETE FROM "Balances" WHERE "accountId" IN (:accountIds)`, {
    replacements: { accountIds },
    type: QueryTypes.DELETE,
  });

  // Rebuild with running balances for accounts that have transactions
  await sequelize.query(
    `
    WITH tx_dates AS (
      SELECT "accountId", DATE("time") as "date"
      FROM real_transactions WHERE "userId" = :userId
      GROUP BY "accountId", DATE("time")
      UNION
      SELECT "accountId", DATE_TRUNC('month', "time")::date as "date"
      FROM real_transactions WHERE "userId" = :userId
      GROUP BY "accountId", DATE_TRUNC('month', "time")
    ),
    daily_deltas AS (
      SELECT
        d."accountId", d."date",
        COALESCE(SUM(
          CASE WHEN t."transactionType" = :incomeType THEN t."refAmount" ELSE -t."refAmount" END
        ), 0) as delta
      FROM tx_dates d
      LEFT JOIN real_transactions t
        ON t."accountId" = d."accountId"
        AND DATE(t."time") = d."date"
        AND t."userId" = :userId
      GROUP BY d."accountId", d."date"
    ),
    running AS (
      SELECT
        dd."accountId", dd."date",
        a."refInitialBalance" + SUM(dd.delta) OVER (
          PARTITION BY dd."accountId" ORDER BY dd."date"
          ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW
        ) as amount
      FROM daily_deltas dd
      JOIN "Accounts" a ON a.id = dd."accountId"
    )
    INSERT INTO "Balances" ("accountId", "date", "amount", "createdAt", "updatedAt")
    SELECT "accountId", "date", amount, NOW(), NOW() FROM running
    `,
    {
      replacements: { userId, incomeType: TRANSACTION_TYPES.income },
      type: QueryTypes.INSERT,
    },
  );

  // Re-insert balance records for accounts with no transactions (e.g. Savings).
  // The rebuild CTE only covers accounts that appear in the Transactions table.
  const accountsWithBalances: { accountId: string }[] = await sequelize.query(
    `SELECT DISTINCT "accountId" FROM "Balances" WHERE "accountId" IN (:accountIds)`,
    { replacements: { accountIds }, type: QueryTypes.SELECT },
  );

  const idsWithBalances = new Set(accountsWithBalances.map((r) => r.accountId));
  const accountsMissingBalances = accountIds.filter((id) => !idsWithBalances.has(id));

  if (accountsMissingBalances.length > 0) {
    await sequelize.query(
      `INSERT INTO "Balances" ("accountId", "date", "amount", "createdAt", "updatedAt")
       SELECT id, CURRENT_DATE, "refInitialBalance", NOW(), NOW()
       FROM "Accounts" WHERE id IN (:ids)`,
      { replacements: { ids: accountsMissingBalances }, type: QueryTypes.INSERT },
    );
  }
}

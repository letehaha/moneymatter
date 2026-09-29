import {
  ACCOUNT_CATEGORIES,
  ACCOUNT_TYPES,
  API_ERROR_CODES,
  type BaseCurrencyBlocker,
  type BaseCurrencyChangeStep,
  FIRE_AMOUNT_KEYS,
  type RecalculateResult,
  RESOURCE_TYPES,
} from '@bt/shared/types';
import { Money } from '@common/types/money';
import { t } from '@i18n/index';
import { ConflictError, ValidationError } from '@js/errors';
import { CacheClient } from '@js/utils/cache';
import { logger } from '@js/utils/logger';
import { captureException } from '@js/utils/sentry';
import Accounts from '@models/accounts.model';
import Balances from '@models/balances.model';
import Holdings from '@models/investments/holdings.model';
import InvestmentTransaction from '@models/investments/investment-transaction.model';
import PortfolioBalances from '@models/investments/portfolio-balances.model';
import PortfolioTransfers from '@models/investments/portfolio-transfers.model';
import Portfolios from '@models/investments/portfolios.model';
import LoanDetails from '@models/loan-details.model';
import ResourceShares from '@models/resource-shares.model';
import { findTransactions } from '@models/transactions-query';
import Transactions from '@models/transactions.model';
import UserSettings from '@models/user-settings.model';
import { getBaseCurrency, updateCurrencies } from '@models/users-currencies.model';
import { isRevaluedAccount, revalueBalanceHistory } from '@services/balances/revalue-balance-history.service';
import { calculateRefAmountFromParams } from '@services/calculate-ref-amount.service';
import { buildDailyPairRateResolver, toDayKey } from '@services/exchange-rates/build-daily-pair-rate-resolver';
import * as userExchangeRateService from '@services/user-exchange-rate';
import { Op, QueryTypes, Transaction as SequelizeTransaction } from 'sequelize';

/**
 * What is covered:
 * 1. Accounts
 * Accounts.refIniaitlBalance
 * Accounts.refCurrentBalance
 * Accounts.refCreditLimit
 * 1b. LoanDetails
 * LoanDetails.refOriginalPrincipal
 * LoanDetails.refMinPayment
 * LoanDetails.refPlannedPayment
 * 2. Transactions
 * Transactions.refAmount
 * Transactions.refCurrencyCode
 * Transactions.refCommissionRate
 * 3. Holdings
 * Holdings.refCostBasis
 * 4. InvestmentTransaction
 * InvestmentTransaction.refAmount
 * InvestmentTransaction.refFees
 * InvestmentTransaction.refPrice
 * 5. PortfolioBalances
 * PortfolioBalances.refAvailableCash
 * PortfolioBalances.refTotalCash
 * 6. PortfolioTransfers
 * PortfolioTransfers.refAmount
 * 7. UserSettings
 * settings.fire amount overrides
 *
 * TODO: Remaining performance optimizations:
 * 1. N+1 Query Problem - Exchange Rate Fetching.
 *    Current problem:
 *    - Individual DB queries for each exchange rate lookup
 *    - Potential external API calls if rates are missing
 *    - Redis cache lookups per transaction
 *    Possible fix:
 *    - Pre-fetch all unique currency pairs and dates before processing
 *    - Build an in-memory cache of exchange rates for the operation
 *    - Batch process records using the pre-loaded rates
 *
 * 2. Sequential Processing Instead of Batching.
 *    Current problem:
 *    - Each record is updated individually in a loop with await
 *    - Results in N separate DB update queries
 *    Possible fix:
 *    - Pre-calculate all values first
 *    - Use bulkUpdate with batching (e.g., 500 records at a time)
 *    - Parallelize independent calculations
 *    Note: Model.update() doesn't work due to Money getter/setter serialization
 *    issues with Sequelize, so this would require raw SQL with CASE expressions.
 *
 * 3. Missing Batch Size Limits.
 *    Current problem:
 *    - Loading ALL records at once with findAll (no limit)
 *    - For users with 100k+ transactions, this could cause memory issues
 *    Possible fix:
 *    - Implement cursor-based pagination or batch processing
 *    - Process records in chunks (e.g., 1000 at a time)
 */

interface ChangeBaseCurrencyParams {
  userId: number;
  newCurrencyCode: string;
}

/** Called before each table sweep so the worker can persist the step on the job
 *  and fan it out over SSE. Awaited so a slow progress write can't let the next
 *  step start reporting before the current one is recorded. */
type BaseCurrencyChangeProgress = (params: { step: BaseCurrencyChangeStep }) => void | Promise<void>;

/**
 * Transaction-free pre-checks that gate a base-currency change: no active
 * share/household (both ends of a share must agree on one base currency, or the
 * recipient's aggregated stats silently mix `refAmount`s under different
 * ref-currency assumptions), a base currency already exists, and the target
 * differs from the current base.
 *
 * Runs at enqueue time — before the lock is taken, so a trivial rejection never
 * holds the 4h lock — and again inside the job, since shares may have changed
 * between enqueue and pickup. Returns the current base so callers skip re-querying.
 */
export async function validateBaseCurrencyChange({ userId, newCurrencyCode }: ChangeBaseCurrencyParams) {
  // Two parallel counts so the response can tell the user precisely which kind
  // of relationship is blocking — household memberships are user-scoped (one
  // revoke covers many accounts), per-resource shares are resource-scoped (each
  // must be revoked individually). The frontend renders multi-step guidance off
  // the `blockers` array. Pending invitations don't lock; they're handled by the
  // accept-time currency-match check, which surfaces a clean error instead.
  const [householdBlockingCount, perResourceBlockingCount] = await Promise.all([
    ResourceShares.count({
      where: {
        [Op.or]: [{ ownerUserId: userId }, { sharedWithUserId: userId }],
        resourceType: RESOURCE_TYPES.household,
        acceptedAt: { [Op.not]: null },
      },
    }),
    ResourceShares.count({
      where: {
        [Op.or]: [{ ownerUserId: userId }, { sharedWithUserId: userId }],
        resourceType: RESOURCE_TYPES.account,
        acceptedAt: { [Op.not]: null },
      },
    }),
  ]);

  if (householdBlockingCount > 0 || perResourceBlockingCount > 0) {
    const blockers: BaseCurrencyBlocker[] = [];
    if (householdBlockingCount > 0) blockers.push({ type: 'household', count: householdBlockingCount });
    if (perResourceBlockingCount > 0) blockers.push({ type: 'share', count: perResourceBlockingCount });

    // Household takes the primary code when both block — revoking household is the
    // higher-impact action, so surface it first; the `blockers` array still tells
    // the user there's a per-resource step waiting after.
    if (householdBlockingCount > 0) {
      throw new ConflictError({
        code: API_ERROR_CODES.baseCurrencyLockedByHousehold,
        message: t({ key: 'currencies.baseCurrencyLockedByHousehold' }),
        details: { blockers },
      });
    }
    throw new ConflictError({
      code: API_ERROR_CODES.baseCurrencyLockedByShares,
      message: t({ key: 'currencies.baseCurrencyLockedByShares' }),
      details: { blockers },
    });
  }

  const oldBaseCurrency = await getBaseCurrency({ userId });

  if (!oldBaseCurrency) {
    throw new ValidationError({
      message: t({ key: 'currencies.noBaseCurrency' }),
    });
  }

  if (oldBaseCurrency.currencyCode === newCurrencyCode) {
    throw new ValidationError({
      message: t({ key: 'currencies.alreadyBaseCurrency' }),
    });
  }

  return { oldBaseCurrency };
}

/**
 * Rewrites every `ref*` amount the user owns into the new base currency inside one
 * atomic DB transaction, flips the `UsersCurrencies` default, and clears the
 * `ref_amount:{userId}:*` cache. Re-runs {@link validateBaseCurrencyChange} first
 * (in-job re-check), then sweeps the eight tables in order, invoking `onProgress`
 * before each so the running job reports its current step.
 *
 * Foreign-currency accounts' balance history is rebuilt after that transaction
 * commits: a rebuild inside it would still read the old base currency.
 *
 * Runs in the base-currency-change worker with the lock already held — it does NOT
 * acquire one itself. Progress reporting is best-effort and must never throw here,
 * or a Redis hiccup would roll back the whole recalculation.
 */
export async function changeBaseCurrencyImpl({
  userId,
  newCurrencyCode,
  onProgress,
}: ChangeBaseCurrencyParams & { onProgress?: BaseCurrencyChangeProgress }): Promise<RecalculateResult> {
  const { oldBaseCurrency } = await validateBaseCurrencyChange({ userId, newCurrencyCode });

  // Start database transaction for atomicity
  const result = await Transactions.sequelize!.transaction(async (dbTransaction: SequelizeTransaction) => {
    logger.info(
      `Starting base currency change for user ${userId} from ${oldBaseCurrency.currencyCode} to ${newCurrencyCode}`,
    );

    await onProgress?.({ step: 'transactions' });
    const transactionsUpdated = await rebuildTransactions({
      userId,
      newCurrencyCode,
      transaction: dbTransaction,
    });

    await onProgress?.({ step: 'accounts' });
    const accountsUpdated = await recalculateAccounts({
      userId,
      newCurrencyCode,
      transaction: dbTransaction,
    });

    // The loan's Account row is handled by recalculateAccounts above, but
    // LoanDetails carries its own ref* copies (refOriginalPrincipal, refMinPayment,
    // refPlannedPayment) that the list-page aggregates read in base currency —
    // recompute them here so a base switch doesn't leave the monthly-obligation
    // total in the old base.
    await onProgress?.({ step: 'loanDetails' });
    const loanDetailsUpdated = await recalculateLoanDetails({
      userId,
      newCurrencyCode,
      transaction: dbTransaction,
    });

    await onProgress?.({ step: 'balances' });
    const { totalBalancesRecalculated: balancesRebuilt, revaluedAccountIds } = await rebuildBalances({
      userId,
      oldCurrencyCode: oldBaseCurrency.currencyCode,
      newCurrencyCode,
      transaction: dbTransaction,
    });

    // Pre-fetch portfolios once for the investment steps. Include soft-deleted ones
    // (paranoid:false) so refAmounts stay consistent if the user later restores a
    // portfolio that was in the trash during a base-currency switch.
    const portfolios = await Portfolios.findAll({
      where: { userId },
      paranoid: false,
      transaction: dbTransaction,
    });
    const portfolioIds = portfolios.map((p) => p.id);

    await onProgress?.({ step: 'investmentTransactions' });
    const investmentTransactionsUpdated = await recalculateInvestmentTransactions({
      userId,
      newCurrencyCode,
      portfolioIds,
      transaction: dbTransaction,
    });

    await onProgress?.({ step: 'portfolioTransfers' });
    const portfolioTransfersUpdated = await recalculatePortfolioTransfers({
      userId,
      newCurrencyCode,
      transaction: dbTransaction,
    });

    await onProgress?.({ step: 'holdings' });
    const holdingsUpdated = await recalculateHoldings({
      userId,
      newCurrencyCode,
      portfolioIds,
      transaction: dbTransaction,
    });

    await onProgress?.({ step: 'portfolioBalances' });
    const portfolioBalancesUpdated = await recalculatePortfolioBalances({
      userId,
      newCurrencyCode,
      portfolioIds,
      transaction: dbTransaction,
    });

    await convertFireSettingsAmounts({
      userId,
      oldCurrencyCode: oldBaseCurrency.currencyCode,
      newCurrencyCode,
      transaction: dbTransaction,
    });

    // Flip the base currency flag onto the new currency.
    await updateCurrencies({
      userId,
      isDefaultCurrency: false,
    });

    await updateCurrencies({
      userId,
      currencyCodes: [newCurrencyCode],
      isDefaultCurrency: true,
    });

    // Cached ref_amount values were computed against the OLD base — drop them.
    await clearUserCache(userId);

    logger.info(`Base currency change completed for user ${userId}`);

    return {
      transactionsUpdated,
      accountsUpdated,
      loanDetailsUpdated,
      balancesRebuilt,
      investmentTransactionsUpdated,
      portfolioTransfersUpdated,
      holdingsUpdated,
      portfolioBalancesUpdated,
      revaluedAccountIds,
    };
  });

  const { revaluedAccountIds, ...counts } = result;
  await revalueForeignAccountHistories({ accountIds: revaluedAccountIds });

  return counts;
}

const localCalculateRefAmount = async ({
  amount,
  useFloorAbs,
  ...exchangeRateParams
}: {
  userId: number;
  date: string | Date;
  baseCode: string;
  quoteCode: string;
  amount: Money;
  useFloorAbs?: boolean;
}) => {
  const { rate } = await userExchangeRateService.getExchangeRate({
    ...exchangeRateParams,
    date: new Date(exchangeRateParams.date),
  });

  return calculateRefAmountFromParams({ amount, rate, useFloorAbs });
};

/**
 * Recalculates all ref-amounts using historical exchange rates based on transaction dates.
 * Updates all ref-related information as well, such as refCurrencyCode
 */
async function rebuildTransactions(params: {
  userId: number;
  newCurrencyCode: string;
  transaction: SequelizeTransaction;
}): Promise<number> {
  const { userId, newCurrencyCode, transaction } = params;

  // Every row the user authored carries a ref stamp in the old base currency, planned
  // and adjustment rows included: a plan that materializes later must already hold the
  // new base currency's amount.
  const transactions = await findTransactions({
    planned: 'include',
    access: { creator: userId },
    balanceAdjustments: 'include',
    completeness: 'all',
    transaction,
    paranoid: false,
  });

  logger.info(`Recalculating ${transactions.length} transactions for user ${userId}`);

  for (const tx of transactions) {
    // Calculate new refAmount using the transaction's original date
    const newRefAmount = await localCalculateRefAmount({
      amount: tx.amount,
      userId,
      baseCode: tx.currencyCode,
      quoteCode: newCurrencyCode,
      date: tx.time,
    });

    // Calculate new refCommissionRate if commission exists
    let newRefCommissionRate: Money = Money.zero();
    if (!tx.commissionRate.isZero()) {
      newRefCommissionRate = await localCalculateRefAmount({
        amount: tx.commissionRate,
        userId,
        baseCode: tx.currencyCode,
        quoteCode: newCurrencyCode,
        date: tx.time,
      });
    }

    // Use instance.save() instead of Model.update() because static update()
    // triggers the getter (which returns Money) during SQL generation, and
    // Sequelize can't serialize Money to an integer for the DB column.
    tx.refAmount = newRefAmount;
    tx.refCommissionRate = newRefCommissionRate;
    tx.refCurrencyCode = newCurrencyCode;
    await tx.save({ transaction, hooks: false });
  }

  return transactions.length;
}

/**
 * Recalculates refInitialBalance, refCurrentBalance, and refCreditLimit for all user accounts.
 * Current balances and credit limits convert at today's rate (spot measures);
 * tx-backed opening balances convert at their ledger-boundary date.
 */
async function recalculateAccounts(params: {
  userId: number;
  newCurrencyCode: string;
  transaction: SequelizeTransaction;
}): Promise<number> {
  const { userId, newCurrencyCode, transaction } = params;

  const accounts = await Accounts.findAll({
    where: { userId },
    transaction,
  });

  logger.info(`Recalculating ${accounts.length} accounts for user ${userId}`);

  // Ledger boundary (earliest tx date) per account, one grouped query. A tx-backed
  // opening balance is the balance immediately BEFORE the earliest transaction, so
  // its ref stamp uses that date's rate. Scoped by `accountId`, NOT by
  // `Transactions.userId`: on a shared account a recipient authors rows under their
  // own userId, so an author filter would pick a later boundary. Must match
  // `restampRefInitialBalance` (also account-scoped), or the next tx write restamps
  // a different value and re-baselines the whole Balances history.
  const accountIds = accounts.map((a) => a.id);
  const boundaryRows = accountIds.length
    ? await Transactions.sequelize!.query<{ accountId: string; earliestTime: Date }>(
        `SELECT "accountId", MIN("time") AS "earliestTime" FROM real_transactions WHERE "accountId" IN (:accountIds) GROUP BY "accountId"`,
        { replacements: { accountIds }, type: QueryTypes.SELECT, transaction },
      )
    : [];
  const boundaryByAccountId = new Map(boundaryRows.map((row) => [row.accountId, new Date(row.earliestTime)]));

  const today = new Date();

  for (const account of accounts) {
    // System non-loan accounts stamp the opening balance at the boundary rate;
    // provider-owned openings (bank), loan anchors, and vehicles keep the
    // today-rate stamp their own flows use.
    const isBoundaryStamped =
      account.type === ACCOUNT_TYPES.system &&
      account.accountCategory !== ACCOUNT_CATEGORIES.loan &&
      account.accountCategory !== ACCOUNT_CATEGORIES.vehicle;
    const initialBalanceDate = isBoundaryStamped ? (boundaryByAccountId.get(account.id) ?? today) : today;

    const newRefInitialBalance = await localCalculateRefAmount({
      amount: account.initialBalance,
      userId,
      baseCode: account.currencyCode,
      quoteCode: newCurrencyCode,
      date: initialBalanceDate,
    });

    // Recalculate credit limit (use today's rate)
    const newRefCreditLimit = await localCalculateRefAmount({
      amount: account.creditLimit,
      userId,
      baseCode: account.currencyCode,
      quoteCode: newCurrencyCode,
      date: today,
    });

    // `refCurrentBalance` is a spot measure for every account type: the native
    // balance at today's rate in the new base currency. Reconstructing it from
    // recalculated tx refAmounts would re-derive a blend of historical rates.
    const newRefCurrentBalance = await localCalculateRefAmount({
      amount: account.currentBalance,
      userId,
      baseCode: account.currencyCode,
      quoteCode: newCurrencyCode,
      date: today,
    });

    account.refInitialBalance = newRefInitialBalance;
    account.refCurrentBalance = newRefCurrentBalance;
    account.refCreditLimit = newRefCreditLimit;
    await account.save({ transaction, hooks: false });
  }

  return accounts.length;
}

/**
 * Recalculates the ref* copies stored on LoanDetails (refOriginalPrincipal,
 * refMinPayment, refPlannedPayment) into the new base currency.
 *
 * Each amount is a loan-currency figure, so it converts from the loan's own
 * Account.currencyCode to the new base at today's rate — matching how create-loan
 * stamps these fields. Nullable payment fields stay null. The nominal (own-currency)
 * columns are left untouched; only the ref* copies move.
 */
async function recalculateLoanDetails(params: {
  userId: number;
  newCurrencyCode: string;
  transaction: SequelizeTransaction;
}): Promise<number> {
  const { userId, newCurrencyCode, transaction } = params;

  const loans = await LoanDetails.findAll({
    where: { userId },
    include: [{ model: Accounts, as: 'account' }],
    transaction,
  });

  logger.info(`Recalculating ${loans.length} loan-detail rows for user ${userId}`);

  const today = new Date();

  for (const loan of loans) {
    const currencyCode = loan.account.currencyCode;

    loan.refOriginalPrincipal = await localCalculateRefAmount({
      amount: loan.originalPrincipal,
      userId,
      baseCode: currencyCode,
      quoteCode: newCurrencyCode,
      date: today,
    });

    if (loan.minPayment !== null) {
      loan.refMinPayment = await localCalculateRefAmount({
        amount: loan.minPayment,
        userId,
        baseCode: currencyCode,
        quoteCode: newCurrencyCode,
        date: today,
      });
    }

    if (loan.plannedPayment !== null) {
      loan.refPlannedPayment = await localCalculateRefAmount({
        amount: loan.plannedPayment,
        userId,
        baseCode: currencyCode,
        quoteCode: newCurrencyCode,
        date: today,
      });
    }

    await loan.save({ transaction, hooks: false });
  }

  return loans.length;
}

const ROWS_PER_UPDATE = 500;

async function writeBalanceAmounts({
  rows,
  transaction,
}: {
  rows: { id: string; amountCents: number }[];
  transaction: SequelizeTransaction;
}): Promise<void> {
  for (let offset = 0; offset < rows.length; offset += ROWS_PER_UPDATE) {
    const chunk = rows.slice(offset, offset + ROWS_PER_UPDATE);
    const replacements: Record<string, unknown> = {};
    const values = chunk.map((row, index) => {
      replacements[`id${index}`] = row.id;
      replacements[`amount${index}`] = row.amountCents;
      return `(:id${index}::uuid, :amount${index}::bigint)`;
    });

    await Transactions.sequelize!.query(
      `UPDATE "Balances" AS b
          SET "amount" = v.amount, "updatedAt" = NOW()
         FROM (VALUES ${values.join(', ')}) AS v(id, amount)
        WHERE b."id" = v.id`,
      { replacements, transaction },
    );
  }
}

/**
 * Re-values every stored `Balances` row into the new base currency.
 *
 * A row is always denominated in the owner's base currency, so an account whose
 * currency will EQUAL the new base converts row by row at each row's own date.
 *
 * An account whose currency DIFFERS from the new base is returned to the caller
 * instead, to be rebuilt with `revalueBalanceHistory` once this transaction commits.
 * Converting its rows one by one would re-derive a blend of historical rates.
 */
async function rebuildBalances(params: {
  userId: number;
  oldCurrencyCode: string;
  newCurrencyCode: string;
  transaction: SequelizeTransaction;
}): Promise<{ totalBalancesRecalculated: number; revaluedAccountIds: string[] }> {
  const { userId, oldCurrencyCode, newCurrencyCode, transaction } = params;

  const accounts = await Accounts.findAll({
    where: { userId },
    transaction,
  });

  logger.info(`Recalculating balances for ${accounts.length} accounts for user ${userId}`);

  const convertedAccounts: Accounts[] = [];
  const revaluedAccountIds: string[] = [];
  let totalBalancesRecalculated = 0;

  for (const account of accounts) {
    if (isRevaluedAccount({ account, baseCurrencyCode: newCurrencyCode })) {
      revaluedAccountIds.push(account.id);
      continue;
    }

    convertedAccounts.push(account);
  }

  if (!convertedAccounts.length) return { totalBalancesRecalculated, revaluedAccountIds };

  const balances: Balances[] = [];
  for (const account of convertedAccounts) {
    balances.push(...(await Balances.findAll({ where: { accountId: account.id }, transaction })));
  }

  const times = balances.map((balance) => +new Date(balance.date));
  if (!times.length) return { totalBalancesRecalculated, revaluedAccountIds };

  // A user's manual rate can't apply to this pair: it only fires when the quote is the
  // user's CURRENT base, and the flip to `newCurrencyCode` happens after this sweep.
  const resolveRate = await buildDailyPairRateResolver({
    baseCode: oldCurrencyCode,
    quoteCode: newCurrencyCode,
    from: new Date(Math.min(...times)),
    to: new Date(Math.max(...times)),
    transaction,
  });

  const updates: { id: string; amountCents: number }[] = [];

  for (const balance of balances) {
    const rate = resolveRate?.(toDayKey(balance.date)) ?? null;
    const newAmount =
      rate === null
        ? await localCalculateRefAmount({
            amount: balance.amount,
            userId,
            baseCode: oldCurrencyCode,
            quoteCode: newCurrencyCode,
            date: balance.date,
          })
        : calculateRefAmountFromParams({ amount: balance.amount, rate });

    updates.push({ id: balance.id, amountCents: newAmount.toCents() });
    totalBalancesRecalculated++;
  }

  await writeBalanceAmounts({ rows: updates, transaction });

  return { totalBalancesRecalculated, revaluedAccountIds };
}

/** One account failing must not abandon the rest: the nightly sweep rebuilds whatever
 *  is left stale. */
async function revalueForeignAccountHistories({ accountIds }: { accountIds: string[] }): Promise<void> {
  for (const accountId of accountIds) {
    try {
      await revalueBalanceHistory({ accountId });
    } catch (error) {
      logger.error(
        {
          message: `Balance history rebuild failed after base currency change for account ${accountId}`,
          error: error as Error,
        },
        { code: 'BASE_CURRENCY_CHANGE_REVALUE_FAILED', accountId },
      );
    }
  }
}

/**
 * Recalculates refAmount, refFees, refPrice for all investment transactions.
 * Uses pre-fetched portfolioIds to avoid redundant portfolio queries.
 */
async function recalculateInvestmentTransactions(params: {
  userId: number;
  newCurrencyCode: string;
  portfolioIds: string[];
  transaction: SequelizeTransaction;
}): Promise<number> {
  const { userId, newCurrencyCode, portfolioIds, transaction } = params;

  if (portfolioIds.length === 0) {
    return 0;
  }

  // Get all investment transactions for user's portfolios
  const investmentTxs = await InvestmentTransaction.findAll({
    where: { portfolioId: portfolioIds },
    transaction,
  });

  logger.info(`Recalculating ${investmentTxs.length} investment transactions for user ${userId}`);

  for (const tx of investmentTxs) {
    // Calculate new refAmount
    const newRefAmount = await localCalculateRefAmount({
      amount: tx.amount,
      userId,
      baseCode: tx.currencyCode,
      quoteCode: newCurrencyCode,
      date: tx.date,
      useFloorAbs: false,
    });

    // Calculate new refFees
    const newRefFees = await localCalculateRefAmount({
      amount: tx.fees,
      userId,
      baseCode: tx.currencyCode,
      quoteCode: newCurrencyCode,
      date: tx.date,
      useFloorAbs: false,
    });

    // Calculate new refPrice
    const newRefPrice = await localCalculateRefAmount({
      amount: tx.price,
      userId,
      baseCode: tx.currencyCode,
      quoteCode: newCurrencyCode,
      date: tx.date,
      useFloorAbs: false,
    });

    tx.refAmount = newRefAmount;
    tx.refFees = newRefFees;
    tx.refPrice = newRefPrice;
    await tx.save({ transaction, hooks: false });
  }

  return investmentTxs.length;
}

/**
 * Recalculates refAmount for all portfolio transfers.
 */
async function recalculatePortfolioTransfers(params: {
  userId: number;
  newCurrencyCode: string;
  transaction: SequelizeTransaction;
}): Promise<number> {
  const { userId, newCurrencyCode, transaction } = params;

  const transfers = await PortfolioTransfers.findAll({
    where: { userId },
    transaction,
  });

  logger.info(`Recalculating ${transfers.length} portfolio transfers for user ${userId}`);

  for (const transfer of transfers) {
    const newRefAmount = await localCalculateRefAmount({
      amount: Money.fromDecimal(transfer.amount),
      userId,
      baseCode: transfer.currencyCode,
      quoteCode: newCurrencyCode,
      date: transfer.date,
    });

    transfer.refAmount = newRefAmount;
    await transfer.save({ transaction, hooks: false });
  }

  return transfers.length;
}

/**
 * Recalculates refCostBasis for all holdings.
 * Uses pre-fetched portfolioIds to avoid redundant portfolio queries.
 */
async function recalculateHoldings(params: {
  userId: number;
  newCurrencyCode: string;
  portfolioIds: string[];
  transaction: SequelizeTransaction;
}): Promise<number> {
  const { userId, newCurrencyCode, portfolioIds, transaction } = params;

  if (portfolioIds.length === 0) {
    return 0;
  }

  const holdings = await Holdings.findAll({
    where: { portfolioId: portfolioIds },
    transaction,
  });

  logger.info(`Recalculating ${holdings.length} holdings for user ${userId}`);

  const today = new Date();

  for (const holding of holdings) {
    // Calculate new refCostBasis (use today's rate - historical cost basis date unknown)
    const newRefCostBasis = await localCalculateRefAmount({
      amount: holding.costBasis,
      userId,
      baseCode: holding.currencyCode,
      quoteCode: newCurrencyCode,
      date: today,
    });

    holding.refCostBasis = newRefCostBasis;
    await holding.save({ transaction, hooks: false });
  }

  return holdings.length;
}

/**
 * Recalculates refAvailableCash and refTotalCash for all portfolio balances.
 * Uses pre-fetched portfolioIds to avoid redundant portfolio queries.
 */
async function recalculatePortfolioBalances(params: {
  userId: number;
  newCurrencyCode: string;
  portfolioIds: string[];
  transaction: SequelizeTransaction;
}): Promise<number> {
  const { userId, newCurrencyCode, portfolioIds, transaction } = params;

  if (portfolioIds.length === 0) {
    return 0;
  }

  const portfolioBalances = await PortfolioBalances.findAll({
    where: { portfolioId: portfolioIds },
    transaction,
  });

  logger.info(`Recalculating ${portfolioBalances.length} portfolio balances for user ${userId}`);

  const today = new Date();

  for (const balance of portfolioBalances) {
    // Calculate new refAvailableCash
    const newRefAvailableCash = await localCalculateRefAmount({
      amount: balance.availableCash,
      userId,
      baseCode: balance.currencyCode,
      quoteCode: newCurrencyCode,
      date: today,
    });

    // Calculate new refTotalCash
    const newRefTotalCash = await localCalculateRefAmount({
      amount: balance.totalCash,
      userId,
      baseCode: balance.currencyCode,
      quoteCode: newCurrencyCode,
      date: today,
    });

    balance.refAvailableCash = newRefAvailableCash;
    balance.refTotalCash = newRefTotalCash;
    await balance.save({ transaction, hooks: false });
  }

  return portfolioBalances.length;
}

async function convertFireSettingsAmounts({
  userId,
  oldCurrencyCode,
  newCurrencyCode,
  transaction,
}: {
  userId: number;
  oldCurrencyCode: string;
  newCurrencyCode: string;
  transaction: SequelizeTransaction;
}): Promise<void> {
  const userSettings = await UserSettings.findOne({ where: { userId }, lock: true, transaction });
  const fire = userSettings?.settings.fire;
  if (!userSettings || !fire || FIRE_AMOUNT_KEYS.every((key) => fire[key] == null)) return;

  const { rate } = await userExchangeRateService.getExchangeRate({
    userId,
    baseCode: oldCurrencyCode,
    quoteCode: newCurrencyCode,
    date: new Date(),
  });
  const converted = { ...fire };
  for (const key of FIRE_AMOUNT_KEYS) {
    const value = fire[key];
    if (value == null) continue;
    converted[key] = calculateRefAmountFromParams({ amount: Money.fromDecimal(value), rate }).toNumber();
  }

  userSettings.settings = { ...userSettings.settings, fire: converted };
  await userSettings.save({ transaction });
}

/**
 * Clears Redis cache entries for ref_amount calculations.
 * After changing base currency, all cached ref_amount values are invalid
 * because they were calculated with the OLD base currency.
 *
 * Uses Redis SCAN to safely iterate and delete all ref_amount keys for this user.
 */
async function clearUserCache(userId: number): Promise<void> {
  logger.info(`Clearing ref_amount cache for user ${userId}`);

  try {
    const cache = new CacheClient({ logPrefix: 'clearUserCache' });

    // Delete all ref_amount cache keys for this user using pattern matching
    // Pattern: ref_amount:${userId}:*
    const pattern = `ref_amount:${userId}:*`;
    await cache.delete(pattern, true); // isPattern=true triggers SCAN-based deletion

    logger.info(`Successfully cleared ref_amount cache for user ${userId}`);
  } catch (error) {
    // Stale ref_amount cache after a base change silently serves old-base values
    // until each key's TTL. Never throws (the recalc already committed), but the
    // failure must be visible, so it goes to Sentry as well as the logs.
    logger.error({ message: `Error clearing cache for user ${userId}`, error: error as Error });
    captureException({ error, context: { scope: 'change-base-currency:clearUserCache', userId } });
  }
}

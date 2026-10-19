/**
 * Commit a reviewed batch of parsed investment transactions to the DB.
 *
 * For each holding row:
 *   1. Ensure the Security exists (create it from the search result remembered at preview time if not).
 *   2. Ensure the Holding for (portfolio, security) exists – create or merge.
 *   3. Insert each child transaction via the canonical
 *      `createInvestmentTransaction` service so cash balance, refAmount, and
 *      holding recalculation all run.
 *
 * Each holding now carries its own asset class (via `resolvedSecurity.assetClass`).
 * The batch may mix stocks and crypto freely – no top-level assetClass.
 *
 * Wrapping the whole thing in one transaction would deadlock against
 * `createInvestmentTransaction`'s own withTransaction usage – and partial
 * imports are a legitimate outcome anyway (one bad row shouldn't bin the rest).
 * Instead we collect per-row errors and return them.
 */
import { INVESTMENT_TRANSACTION_CATEGORY, isTradeSide } from '@bt/shared/types/investments';
import type {
  InvestmentImportExecuteResponse,
  InvestmentImportHolding,
  InvestmentImportWarning,
} from '@bt/shared/types/investments';
import { CustomError } from '@js/errors';
import { logger } from '@js/utils';
import Holdings from '@models/investments/holdings.model';
import Portfolios from '@models/investments/portfolios.model';
import Securities from '@models/investments/securities.model';
import { addUserCurrencies } from '@services/currencies/add-user-currency';
import { upsertSecuritiesFromSearch } from '@services/investments/securities-manage';
import { syncHistoricalPrices } from '@services/investments/securities-price/historical-sync.service';
import { createInvestmentTransaction } from '@services/investments/transactions/create.service';

interface ExecuteImportParams {
  userId: number;
  holdings: InvestmentImportHolding[];
  /** tempIds of transactions the user opted to skip (possible duplicates). */
  skipTempIds: string[];
}

/**
 * Holding setup only throws translated CustomErrors; createInvestmentTransaction still throws English
 * ValidationErrors, so TRANSACTION_FAILED carries no reason.
 */
const userFacingReason = ({ error }: { error: unknown }): { reason?: string } =>
  error instanceof CustomError ? { reason: error.message } : {};

export async function executeInvestmentImport({
  userId,
  holdings,
  skipTempIds,
}: ExecuteImportParams): Promise<InvestmentImportExecuteResponse> {
  const skipSet = new Set(skipTempIds);

  let createdSecurities = 0;
  let createdHoldings = 0;
  let mergedHoldings = 0;
  let createdTransactions = 0;
  let skippedPossibleDuplicates = 0;
  let skippedHoldings = 0;
  let failedTransactions = 0;
  const warnings: InvestmentImportWarning[] = [];

  const newSecurityIds = new Set<string>();

  for (const holding of holdings) {
    // Guard rails – UI is meant to block these but the API contract still has
    // to defend itself. Same for the per-row validation below. Each guard
    // bumps `skippedHoldings` and pushes a warning so the response actually
    // tells the user why N rows didn't land.
    const symbol = holding.parsedSymbol;
    if (!holding.resolvedSecurity) {
      logger.warn(`Skipped "${symbol}": no resolved security.`);
      warnings.push({ code: 'NO_RESOLVED_SECURITY', params: { symbol } });
      skippedHoldings += 1;
      continue;
    }
    if (!holding.currencyCode) {
      logger.warn(`Skipped "${symbol}": no currency selected.`);
      warnings.push({ code: 'NO_CURRENCY', params: { symbol } });
      skippedHoldings += 1;
      continue;
    }

    // Verify the target portfolio belongs to this user. Important – the API
    // shape lets the client pass arbitrary portfolio ids.
    const portfolio = await Portfolios.findOne({
      where: { id: holding.portfolioId, userId },
    });
    if (!portfolio) {
      logger.warn(`Skipped "${symbol}": target portfolio not found.`);
      warnings.push({ code: 'PORTFOLIO_NOT_FOUND', params: { symbol } });
      skippedHoldings += 1;
      continue;
    }

    const resolvedSecurity = holding.resolvedSecurity;
    const { providerName } = resolvedSecurity;

    // Steps 1+2 below all run unguarded queries (`upsertSecuritiesFromSearch`,
    // `addUserCurrencies`, `Holdings.create`) that can throw on FK violations,
    // unique-key collisions from concurrent imports, or provider lookups that
    // hit a transient error. Without this wrapper a single throw would abort
    // the entire batch and leave the user with prior holdings half-committed
    // and a generic 500 – instead we skip just this holding and continue.
    let security: Securities | null = null;
    let preloadedHoldingRef: Holdings | null = null;
    try {
      // 1. Resolve or create Security.
      if (resolvedSecurity.securityId) {
        security = await Securities.findByPk(resolvedSecurity.securityId);
      }
      if (!security) {
        const { securities } = await upsertSecuritiesFromSearch({
          securities: [
            {
              symbol: resolvedSecurity.symbol.toUpperCase(),
              providerSymbol: resolvedSecurity.providerSymbol,
              assetClass: resolvedSecurity.assetClass,
              providerName,
              currencyCode: resolvedSecurity.currencyCode,
            },
          ],
        });
        security = securities[0]!;
        createdSecurities += 1;
        newSecurityIds.add(security.id);
      }

      // 2. Resolve or create Holding for (portfolio, security).
      await addUserCurrencies([{ userId, currencyCode: holding.currencyCode }]);

      // Load with the same includes `createInvestmentTransaction` would –
      // `security` for the crypto/stocks branch and `portfolio` for ownership.
      // Loading once here lets the per-row inner loop skip those queries.
      const holdingIncludes = [
        { model: Portfolios, as: 'portfolio' as const, where: { userId }, required: true },
        { model: Securities, as: 'security' as const, required: true },
      ];

      let loadedHolding = await Holdings.findOne({
        where: { portfolioId: holding.portfolioId, securityId: security.id },
        include: holdingIncludes,
      });
      if (loadedHolding) {
        mergedHoldings += 1;
      } else {
        await Holdings.create({
          portfolioId: holding.portfolioId,
          securityId: security.id,
          currencyCode: holding.currencyCode,
          quantity: '0',
          costBasis: '0',
          refCostBasis: '0',
          value: '0',
          refValue: '0',
        });
        createdHoldings += 1;
        loadedHolding = await Holdings.findOne({
          where: { portfolioId: holding.portfolioId, securityId: security.id },
          include: holdingIncludes,
        });
      }
      // Stash on the local `holding` ref so the per-tx loop below picks it up
      // without restructuring the existing variable scope.
      preloadedHoldingRef = loadedHolding;
    } catch (error) {
      logger.error({
        message: `Failed to set up holding for "${symbol}"`,
        error: error as Error,
      });
      warnings.push({ code: 'HOLDING_SETUP_FAILED', params: { symbol, ...userFacingReason({ error }) } });
      skippedHoldings += 1;
      continue;
    }

    // Defensive – the catch above already `continue`s on failure, but narrow
    // `security` to non-null for the per-transaction loop below.
    if (!security) continue;

    // 3. Insert child transactions one by one through the canonical service
    // – it handles refAmount, recalculation, and cash-balance updates.
    for (const tx of holding.transactions) {
      if (skipSet.has(tx.tempId)) {
        skippedPossibleDuplicates += 1;
        continue;
      }

      // `createInvestmentTransaction` types everything-not-buy as income, which
      // is right for sell/dividend but wrong for fee/tax – reject the rest
      // instead of silently misclassifying them.
      if (!isTradeSide(tx.side) && tx.side !== INVESTMENT_TRANSACTION_CATEGORY.dividend) {
        logger.warn(`Skipped "${symbol}" ${tx.side} on ${tx.date}: this category is not yet supported.`);
        warnings.push({ code: 'UNSUPPORTED_CATEGORY', params: { symbol, side: tx.side, date: tx.date } });
        failedTransactions += 1;
        continue;
      }

      try {
        // `preloadedHoldingRef` skips a portfolio + holding lookup per row.
        await createInvestmentTransaction({
          userId,
          portfolioId: holding.portfolioId,
          securityId: security.id,
          category: tx.side as INVESTMENT_TRANSACTION_CATEGORY,
          date: tx.date,
          quantity: tx.quantity,
          price: tx.price,
          fees: tx.fees,
          name: '',
          preloadedHolding: preloadedHoldingRef ?? undefined,
        });
        createdTransactions += 1;
      } catch (error) {
        // Don't abort the whole batch – surface the failure in the response so
        // the user knows N rows didn't actually land despite the 200.
        logger.error({
          message: `Failed to import transaction (tempId=${tx.tempId}, symbol=${symbol})`,
          error: error as Error,
        });
        warnings.push({
          code: 'TRANSACTION_FAILED',
          params: { symbol, side: tx.side, date: tx.date },
        });
        failedTransactions += 1;
      }
    }
  }

  // Fire historical price sync for any newly-created securities. Fire-and-forget,
  // lock-protected per security inside the service – mirrors createHolding.
  for (const securityId of newSecurityIds) {
    syncHistoricalPrices(securityId).catch((error) => {
      logger.error({
        message: `Background historical price sync failed after import for securityId: ${securityId}`,
        error: error as Error,
      });
    });
  }

  return {
    createdSecurities,
    createdHoldings,
    mergedHoldings,
    createdTransactions,
    skippedPossibleDuplicates,
    skippedHoldings,
    failedTransactions,
    warnings,
  };
}

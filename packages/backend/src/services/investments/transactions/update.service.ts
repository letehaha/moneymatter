import { TRANSACTION_TYPES } from '@bt/shared/types';
import { ASSET_CLASS, INVESTMENT_TRANSACTION_CATEGORY } from '@bt/shared/types/investments';
import { INVESTMENT_DECIMAL_SCALE, Money } from '@common/types/money';
import { findOrThrowNotFound } from '@common/utils/find-or-throw-not-found';
import { t } from '@i18n/index';
import { ValidationError } from '@js/errors';
import Holdings from '@models/investments/holdings.model';
import InvestmentTransaction from '@models/investments/investment-transaction.model';
import Portfolios from '@models/investments/portfolios.model';
import Securities from '@models/investments/securities.model';
import { calculateRefAmount } from '@services/calculate-ref-amount.service';
import { withTransaction } from '@services/common/with-transaction';
import { recalculateHolding } from '@services/investments/holdings/recalculation.service';
import { updatePortfolioBalance } from '@services/investments/portfolios/balances';
import { ensureUserCurrencyConnected } from '@services/sharing/auth/ensure-currency-connected.service';
import { Big } from 'big.js';

import { calculateCashDelta } from './cash-balance-utils';
import { resolveSettlement } from './settlement-utils';

interface UpdateTransactionParams {
  userId: number;
  transactionId: string;
  category?: INVESTMENT_TRANSACTION_CATEGORY;
  date?: string;
  quantity?: string;
  price?: string;
  fees?: string;
  name?: string;
  settlementCurrencyCode?: string;
  settlementAmount?: string;
  settlementFees?: string;
  /**
   * Security→settlement rate the user knows. With settlementAmount it makes
   * the fee come out as the residual; without it the cash is recomputed from
   * this rate instead of the stored one. Mutually exclusive with
   * settlementFees.
   */
  settlementRate?: string;
}

const updateInvestmentTransactionImpl = async (params: UpdateTransactionParams) => {
  const { userId, transactionId, ...updateFields } = params;

  // Find the transaction and verify ownership through portfolio
  const transaction = await findOrThrowNotFound({
    query: InvestmentTransaction.findOne({
      where: { id: transactionId },
      include: [{ model: Portfolios, as: 'portfolio', where: { userId }, required: true }],
    }),
    message: t({ key: 'investments.transactionNotFound' }),
  });

  // Store the portfolioId and securityId for recalculation
  const { portfolioId, securityId } = transaction;

  // Get the holding for validation
  const holding = await findOrThrowNotFound({
    query: Holdings.findOne({
      where: { portfolioId, securityId },
      include: [{ model: Securities, as: 'security', required: true }],
    }),
    message: t({ key: 'investments.holdingNotFound' }),
  });

  // Business rule: Check for sufficient shares when updating to a sell transaction
  const finalCategory = updateFields.category ?? transaction.category;
  const finalQuantity = updateFields.quantity ?? transaction.quantity.toDecimalString(INVESTMENT_DECIMAL_SCALE);

  // Crypto holdings can legitimately go negative (staking/fee/missed-transfer
  // drift); we keep the strict check for stocks only.
  const isCrypto = holding.security?.assetClass === ASSET_CLASS.crypto;
  if (finalCategory === INVESTMENT_TRANSACTION_CATEGORY.sell && !isCrypto) {
    // Calculate what the quantity would be after removing this transaction's effect
    // then check if we have enough for the new quantity
    let adjustedHoldingQuantity = holding.quantity.toBig();

    // If this transaction was originally a buy, we need to subtract its quantity
    // If it was originally a sell, we need to add its quantity back
    if (transaction.category === INVESTMENT_TRANSACTION_CATEGORY.buy) {
      adjustedHoldingQuantity = adjustedHoldingQuantity.minus(transaction.quantity.toBig());
    } else if (transaction.category === INVESTMENT_TRANSACTION_CATEGORY.sell) {
      adjustedHoldingQuantity = adjustedHoldingQuantity.plus(transaction.quantity.toBig());
    }

    const sellQuantity = new Big(finalQuantity);

    if (sellQuantity.gt(adjustedHoldingQuantity)) {
      throw new ValidationError({
        message: t({
          key: 'investments.insufficientSharesToSell',
          variables: {
            adjustedQuantity: adjustedHoldingQuantity.toFixed(),
            sellQuantity: sellQuantity.toFixed(),
          },
        }),
      });
    }
  }

  const finalPrice = updateFields.price ?? transaction.price.toDecimalString(INVESTMENT_DECIMAL_SCALE);
  const finalDate = updateFields.date ?? transaction.date;

  // Re-deriving the settlement leg rounds the stored values; skip it on edits
  // that don't touch money so a rename doesn't nudge the cash balance.
  const monetaryChanged =
    updateFields.quantity !== undefined ||
    updateFields.price !== undefined ||
    updateFields.fees !== undefined ||
    updateFields.date !== undefined ||
    updateFields.category !== undefined ||
    updateFields.settlementCurrencyCode !== undefined ||
    updateFields.settlementAmount !== undefined ||
    updateFields.settlementFees !== undefined ||
    updateFields.settlementRate !== undefined;

  const updateData: Partial<InvestmentTransaction> = {};

  if (updateFields.category !== undefined) {
    updateData.category = updateFields.category;
    updateData.transactionType =
      updateFields.category === INVESTMENT_TRANSACTION_CATEGORY.buy
        ? TRANSACTION_TYPES.expense
        : TRANSACTION_TYPES.income;
  }

  if (updateFields.date !== undefined) {
    updateData.date = new Date(updateFields.date);
  }

  if (updateFields.name !== undefined) {
    updateData.name = updateFields.name;
  }

  if (updateFields.quantity !== undefined) {
    updateData.quantity = Money.fromDecimal(updateFields.quantity);
  }

  if (updateFields.price !== undefined) {
    updateData.price = Money.fromDecimal(updateFields.price);
  }

  let settlement: ReturnType<typeof resolveSettlement> | null = null;

  if (monetaryChanged) {
    const finalSettlementCurrencyCode = updateFields.settlementCurrencyCode ?? transaction.settlementCurrencyCode;
    const isCrossCurrency = finalSettlementCurrencyCode !== holding.currencyCode;

    // In cross-currency mode `fees` (security currency) is a derived output,
    // not user input; the user-facing fee lives in `settlementFees`.
    if (isCrossCurrency && updateFields.fees !== undefined) {
      throw new ValidationError({
        message:
          'This transaction settles in a different currency — update settlementFees (in the settlement currency) instead of fees.',
      });
    }

    settlement = resolveSettlement({
      category: finalCategory,
      quantity: finalQuantity,
      price: finalPrice,
      fees: updateFields.fees ?? transaction.fees.toDecimalString(INVESTMENT_DECIMAL_SCALE),
      holdingCurrencyCode: holding.currencyCode,
      settlementCurrencyCode: finalSettlementCurrencyCode,
      // Don't auto-forward the stored cash amount: a quantity/price edit would
      // re-derive the fee against a stale total and silently shift the balance.
      settlementAmount: updateFields.settlementAmount,
      // Carry the stored fee as the known fee in cross-currency mode, unless
      // the caller sent rate+amount together — then the fee is the derived
      // output and forwarding both would violate the fee-vs-rate exclusivity.
      settlementFees:
        isCrossCurrency && !(updateFields.settlementRate !== undefined && updateFields.settlementAmount !== undefined)
          ? (updateFields.settlementFees ?? transaction.settlementFees.toDecimalString(INVESTMENT_DECIMAL_SCALE))
          : updateFields.settlementFees,
      settlementRate: updateFields.settlementRate,
      // Reuse the broker's stored conversion rate when the user edited
      // quantity/price/fee but didn't re-enter the cash. Only safe when the
      // settlement currency hasn't changed — a switch invalidates the rate
      // (in particular the placeholder `1` on previously same-currency rows).
      fixedRate:
        isCrossCurrency && transaction.settlementCurrencyCode === finalSettlementCurrencyCode
          ? transaction.settlementRate
          : undefined,
    });

    updateData.fees = Money.fromDecimal(settlement.fees);
    updateData.amount = Money.fromDecimal(settlement.amount);
    updateData.settlementCurrencyCode = settlement.settlementCurrencyCode;
    updateData.settlementAmount = Money.fromDecimal(settlement.settlementAmount);
    updateData.settlementFees = Money.fromDecimal(settlement.settlementFees);
    updateData.settlementRate = settlement.settlementRate;
  }

  if (settlement) {
    // ensureUserCurrencyConnected idempotently links the settlement currency
    // so the ref-amount lookups don't fail with `currencyNotConnected`.
    if (settlement.settlementCurrencyCode !== holding.currencyCode) {
      await ensureUserCurrencyConnected({ userId, currencyCode: settlement.settlementCurrencyCode });
    }

    const rate = new Big(settlement.settlementRate);
    const amountInSettlement = new Big(settlement.amount).times(rate).toFixed(10);
    const priceInSettlement = new Big(finalPrice || '0').times(rate).toFixed(10);

    const [refAmount, refPrice, refFees] = await Promise.all([
      calculateRefAmount({
        amount: Money.fromDecimal(amountInSettlement),
        userId,
        definitionOwnerUserId: userId,
        date: finalDate,
        baseCode: settlement.settlementCurrencyCode,
      }),
      calculateRefAmount({
        amount: Money.fromDecimal(priceInSettlement),
        userId,
        definitionOwnerUserId: userId,
        date: finalDate,
        baseCode: settlement.settlementCurrencyCode,
      }),
      calculateRefAmount({
        amount: Money.fromDecimal(settlement.settlementFees),
        userId,
        definitionOwnerUserId: userId,
        date: finalDate,
        baseCode: settlement.settlementCurrencyCode,
      }),
    ]);

    updateData.refAmount = refAmount;
    updateData.refPrice = refPrice;
    updateData.refFees = refFees;
  }

  // Snapshot the pre-update cash impact so it can be reversed below.
  const oldCashDelta = calculateCashDelta({
    category: transaction.category,
    settlementAmount: transaction.settlementAmount.toDecimalString(INVESTMENT_DECIMAL_SCALE),
  });
  const oldSettlementCurrencyCode = transaction.settlementCurrencyCode;

  await transaction.update(updateData);
  await recalculateHolding({ portfolioId, securityId });

  // Reverse the old cash impact, apply the new one. Guarded on `settlement`
  // so name-only edits don't touch balances.
  if (settlement) {
    const newCashDelta = calculateCashDelta({
      category: finalCategory,
      settlementAmount: settlement.settlementAmount,
    });

    const cashImpactChanged =
      oldSettlementCurrencyCode !== settlement.settlementCurrencyCode || oldCashDelta !== newCashDelta;

    if (cashImpactChanged) {
      if (oldCashDelta !== null) {
        const reversedDelta = new Big(oldCashDelta).times(-1).toFixed(10);
        await ensureUserCurrencyConnected({ userId, currencyCode: oldSettlementCurrencyCode });
        await updatePortfolioBalance({
          userId,
          portfolioId,
          currencyCode: oldSettlementCurrencyCode,
          availableCashDelta: reversedDelta,
          totalCashDelta: reversedDelta,
        });
      }
      if (newCashDelta !== null) {
        await ensureUserCurrencyConnected({ userId, currencyCode: settlement.settlementCurrencyCode });
        await updatePortfolioBalance({
          userId,
          portfolioId,
          currencyCode: settlement.settlementCurrencyCode,
          availableCashDelta: newCashDelta,
          totalCashDelta: newCashDelta,
        });
      }
    }
  }

  await transaction.reload();
  return transaction;
};

export const updateInvestmentTransaction = withTransaction(updateInvestmentTransactionImpl);

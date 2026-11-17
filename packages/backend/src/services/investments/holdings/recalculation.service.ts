import { ASSET_CLASS } from '@bt/shared/types/investments';
import { Money } from '@common/types/money';
import { findOrThrowNotFound } from '@common/utils/find-or-throw-not-found';
import { t } from '@i18n/index';
import Holdings from '@models/investments/holdings.model';
import InvestmentTransaction from '@models/investments/investment-transaction.model';
import Securities from '@models/investments/securities.model';
import { withTransaction } from '@services/common/with-transaction';

import { computeHoldingTotals } from './holding-totals';

const recalculateHoldingImpl = async (holdingId: { portfolioId: string; securityId: string }) => {
  const holding = await findOrThrowNotFound({
    query: Holdings.findOne({
      where: holdingId,
      include: [{ model: Securities, as: 'security', required: true }],
    }),
    message: t({ key: 'investments.holdingNotFoundForRecalculation' }),
  });

  // `date` is a TIMESTAMPTZ, so trades replay in their actual chronological
  // time order — a full wash sale (sell the whole position, then rebuy it later
  // the same calendar day) resets the cost basis before the rebuy instead of
  // blending the liquidated lots into it. `createdAt` is the final tiebreaker
  // for trades that share an exact instant (e.g. two same-day imports both
  // stored at UTC noon); without it Postgres could return the rebuy ahead
  // of the sell and inflate AC/Share. Matches the ordering used by the
  // balance-history and annualized-returns replays.
  const transactions = await InvestmentTransaction.findAll({
    where: {
      portfolioId: holding.portfolioId,
      securityId: holding.securityId,
    },
    order: [
      ['date', 'ASC'],
      ['createdAt', 'ASC'],
    ],
  });

  const {
    quantity: totalQuantity,
    costBasis: totalCostBasis,
    refCostBasis: totalRefCostBasis,
  } = computeHoldingTotals({
    transactions: transactions.map((tx) => ({
      category: tx.category,
      quantity: tx.quantity.toBig(),
      amount: tx.amount.toBig(),
      refAmount: tx.refAmount.toBig(),
    })),
  });

  // Crypto holdings may legitimately go negative (staking/fee drift) until the
  // user reconciles via a "mark as zero" adjustment; stocks always cap at zero.
  const allowNegativeQuantity = holding.security?.assetClass === ASSET_CLASS.crypto;
  holding.quantity = Money.fromDecimal(!allowNegativeQuantity && totalQuantity.lt(0) ? '0' : totalQuantity.toFixed(10));
  // costBasis / refCostBasis are already floored at zero by computeHoldingTotals.
  holding.costBasis = Money.fromDecimal(totalCostBasis.toFixed(10));
  holding.refCostBasis = Money.fromDecimal(totalRefCostBasis.toFixed(10));
  await holding.save();

  return holding;
};

export const recalculateHolding = withTransaction(recalculateHoldingImpl);

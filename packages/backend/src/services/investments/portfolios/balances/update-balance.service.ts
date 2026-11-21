import { INVESTMENT_DECIMAL_SCALE, Money } from '@common/types/money';
import { findOrThrowNotFound } from '@common/utils/find-or-throw-not-found';
import { t } from '@i18n/index';
import Currencies from '@models/currencies.model';
import PortfolioBalances from '@models/investments/portfolio-balances.model';
import Portfolios from '@models/investments/portfolios.model';
import { calculateRefAmount } from '@services/calculate-ref-amount.service';
import { withTransaction } from '@services/common/with-transaction';
import { Big } from 'big.js';

interface UpdatePortfolioBalanceParams {
  userId: number;
  portfolioId: string;
  currencyCode: string;
  availableCashDelta?: string; // Amount to add/subtract from available cash
  totalCashDelta?: string; // Amount to add/subtract from total cash
  setAvailableCash?: string; // Set available cash to specific amount
  setTotalCash?: string; // Set total cash to specific amount
}

const updatePortfolioBalanceImpl = async ({
  userId,
  portfolioId,
  currencyCode,
  availableCashDelta,
  totalCashDelta,
  setAvailableCash,
  setTotalCash,
}: UpdatePortfolioBalanceParams) => {
  // Soft-deleted portfolios are accepted: transfer reversals must land on a trashed
  // portfolio so its cash is right after a restore.
  await findOrThrowNotFound({
    query: Portfolios.findOne({
      where: { id: portfolioId, userId },
      paranoid: false,
    }),
    message: t({ key: 'investments.portfolioNotFound' }),
  });

  // Verify currency exists
  const currency = await findOrThrowNotFound({
    query: Currencies.findByPk(currencyCode),
    message: t({ key: 'investments.currencyNotFound' }),
  });

  // Find or create portfolio balance record
  let balance = await PortfolioBalances.findOne({
    where: { portfolioId, currencyCode },
  });

  if (!balance) {
    // Create new balance record with zero values
    balance = await PortfolioBalances.create({
      portfolioId,
      currencyCode,
      availableCash: '0',
      totalCash: '0',
      refAvailableCash: '0',
      refTotalCash: '0',
    });
  }

  // Calculate new values
  let newAvailableCash: string;
  let newTotalCash: string;

  if (setAvailableCash !== undefined) {
    newAvailableCash = setAvailableCash;
  } else if (availableCashDelta !== undefined) {
    newAvailableCash = balance.availableCash.toBig().plus(new Big(availableCashDelta)).toFixed(10);
  } else {
    newAvailableCash = balance.availableCash.toDecimalString(INVESTMENT_DECIMAL_SCALE);
  }

  if (setTotalCash !== undefined) {
    newTotalCash = setTotalCash;
  } else if (totalCashDelta !== undefined) {
    newTotalCash = balance.totalCash.toBig().plus(new Big(totalCashDelta)).toFixed(10);
  } else {
    newTotalCash = balance.totalCash.toDecimalString(INVESTMENT_DECIMAL_SCALE);
  }

  // Calculate reference amounts (converted to user's base currency)
  const refAvailableCash = await calculateRefAmount({
    amount: Money.fromDecimal(newAvailableCash),
    baseCode: currency.code,
    userId,
    definitionOwnerUserId: userId,
    date: new Date(),
  });

  const refTotalCash = await calculateRefAmount({
    amount: Money.fromDecimal(newTotalCash),
    baseCode: currency.code,
    userId,
    definitionOwnerUserId: userId,
    date: new Date(),
  });

  // Update the balance
  await balance.update({
    availableCash: newAvailableCash,
    totalCash: newTotalCash,
    refAvailableCash,
    refTotalCash,
  });

  return balance.reload({
    include: [{ model: Currencies, as: 'currency' }],
  });
};

export const updatePortfolioBalance = withTransaction(updatePortfolioBalanceImpl);

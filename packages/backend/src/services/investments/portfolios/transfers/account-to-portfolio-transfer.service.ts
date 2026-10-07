import { PAYMENT_TYPES, TRANSACTION_TRANSFER_NATURE, TRANSACTION_TYPES } from '@bt/shared/types';
import { Money } from '@common/types/money';
import Currencies from '@models/currencies.model';
import PortfolioTransfers from '@models/investments/portfolio-transfers.model';
import Portfolios from '@models/investments/portfolios.model';
import * as Transactions from '@models/transactions.model';
import { withTransaction } from '@services/common/with-transaction';
import { updatePortfolioBalance } from '@services/investments/portfolios/balances';

import {
  assertAccountNotBankLinked,
  computeRefAmount,
  findAccountOrThrow,
  findCurrencyOrThrow,
  findPortfolioOrThrow,
  getUserBaseCurrencyCode,
  validatePositiveAmount,
} from './transfer-validations';

interface AccountToPortfolioTransferParams {
  userId: number;
  accountId: string;
  portfolioId: string;
  amount: string;
  date: string;
  description?: string | null;
}

const accountToPortfolioTransferImpl = async ({
  userId,
  accountId,
  portfolioId,
  amount,
  date,
  description,
}: AccountToPortfolioTransferParams) => {
  validatePositiveAmount({ amount });

  const account = await findAccountOrThrow({ accountId, userId, role: 'source' });
  assertAccountNotBankLinked({ account });
  const currencyCode = account.currencyCode;

  await findPortfolioOrThrow({ portfolioId, userId, role: 'destination' });
  await findCurrencyOrThrow({ currencyCode });

  const txAmount = Money.fromDecimal(amount);
  const refCurrencyCode = await getUserBaseCurrencyCode({ userId });
  const refAmount = await computeRefAmount({ amount, currencyCode, userId, date, baseCurrencyCode: refCurrencyCode });

  // Create expense Transaction on the account
  const newTx = await Transactions.createTransaction({
    userId,
    amount: txAmount,
    refAmount,
    transactionType: TRANSACTION_TYPES.expense,
    paymentType: PAYMENT_TYPES.bankTransfer,
    accountId,
    accountType: account.type,
    currencyCode,
    refCurrencyCode,
    transferNature: TRANSACTION_TRANSFER_NATURE.transfer_to_portfolio,
    time: new Date(date),
    note: description || undefined,
  });

  // Create PortfolioTransfer record linked to the transaction
  const transfer = await PortfolioTransfers.create({
    userId,
    fromAccountId: accountId,
    toPortfolioId: portfolioId,
    fromPortfolioId: null,
    toAccountId: null,
    amount,
    refAmount,
    currencyCode,
    date,
    description,
    transactionId: newTx!.id,
  });

  // Update portfolio cash balance
  await updatePortfolioBalance({
    userId,
    portfolioId,
    currencyCode,
    availableCashDelta: amount,
    totalCashDelta: amount,
  });

  return transfer.reload({
    include: [
      { model: Portfolios, as: 'toPortfolio' },
      { model: Currencies, as: 'currency' },
    ],
  });
};

export const accountToPortfolioTransfer = withTransaction(accountToPortfolioTransferImpl);

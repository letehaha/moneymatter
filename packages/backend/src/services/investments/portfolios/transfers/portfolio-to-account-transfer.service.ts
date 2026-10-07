import { PAYMENT_TYPES, TRANSACTION_TRANSFER_NATURE, TRANSACTION_TYPES } from '@bt/shared/types';
import { Money } from '@common/types/money';
import { findOrThrowNotFound } from '@common/utils/find-or-throw-not-found';
import { t } from '@i18n/index';
import { ValidationError } from '@js/errors';
import Currencies from '@models/currencies.model';
import PortfolioTransfers from '@models/investments/portfolio-transfers.model';
import Portfolios from '@models/investments/portfolios.model';
import * as Transactions from '@models/transactions.model';
import { withTransaction } from '@services/common/with-transaction';
import { updatePortfolioBalance } from '@services/investments/portfolios/balances';

import {
  assertAccountNotBankLinked,
  computeRefAmount,
  computeRestampForExistingTransaction,
  findAccountOrThrow,
  findCurrencyOrThrow,
  findPortfolioOrThrow,
  getUserBaseCurrencyCode,
  negateAmount,
  validatePositiveAmount,
} from './transfer-validations';

interface PortfolioToAccountTransferParams {
  userId: number;
  portfolioId: string;
  accountId: string;
  amount: string;
  currencyCode: string;
  date: string;
  description?: string | null;
  existingTransactionId?: string;
}

const portfolioToAccountTransferImpl = async ({
  userId,
  portfolioId,
  accountId,
  amount,
  currencyCode,
  date,
  description,
  existingTransactionId,
}: PortfolioToAccountTransferParams) => {
  validatePositiveAmount({ amount });

  await findPortfolioOrThrow({ portfolioId, userId, role: 'source' });
  const account = await findAccountOrThrow({ accountId, userId, role: 'destination' });
  await findCurrencyOrThrow({ currencyCode });

  const refCurrencyCode = await getUserBaseCurrencyCode({ userId });
  const refAmount = await computeRefAmount({ amount, currencyCode, userId, date, baseCurrencyCode: refCurrencyCode });

  let linkedTransactionId: string;

  if (existingTransactionId) {
    const existingTx = await findOrThrowNotFound({
      query: Transactions.getTransactionById({
        id: existingTransactionId,
        userId,
      }),
      message: t({ key: 'transactions.notFound' }),
    });

    if (existingTx.transactionType !== TRANSACTION_TYPES.income) {
      throw new ValidationError({
        message: 'Only income transactions can be linked to portfolio withdrawals.',
      });
    }

    const existingLink = await PortfolioTransfers.findOne({
      where: { transactionId: existingTransactionId },
    });

    if (existingLink) {
      throw new ValidationError({
        message: 'Transaction is already linked to a portfolio transfer.',
      });
    }

    // Re-stamp ref fields: the existing tx may pre-date a base-currency switch, and the
    // @BeforeUpdate validator requires both fields on `transfer_to_portfolio` rows.
    const restamp = await computeRestampForExistingTransaction({ tx: existingTx, userId });

    await Transactions.updateTransactionById({
      id: existingTransactionId,
      userId,
      transferNature: TRANSACTION_TRANSFER_NATURE.transfer_to_portfolio,
      refCurrencyCode: restamp.refCurrencyCode,
      refAmount: restamp.refAmount,
    });

    linkedTransactionId = existingTransactionId;
  } else {
    assertAccountNotBankLinked({ account });

    const txAmount = Money.fromDecimal(amount);
    const txRefAmount = await computeRefAmount({
      amount,
      currencyCode: account.currencyCode,
      userId,
      date,
      baseCurrencyCode: refCurrencyCode,
    });

    const newTx = await Transactions.createTransaction({
      userId,
      amount: txAmount,
      refAmount: txRefAmount,
      transactionType: TRANSACTION_TYPES.income,
      paymentType: PAYMENT_TYPES.bankTransfer,
      accountId,
      accountType: account.type,
      currencyCode: account.currencyCode,
      refCurrencyCode,
      transferNature: TRANSACTION_TRANSFER_NATURE.transfer_to_portfolio,
      time: new Date(date),
      note: description || undefined,
    });

    linkedTransactionId = newTx!.id;
  }

  // Create PortfolioTransfer record linked to the transaction
  const transfer = await PortfolioTransfers.create({
    userId,
    fromPortfolioId: portfolioId,
    toAccountId: accountId,
    fromAccountId: null,
    toPortfolioId: null,
    amount,
    refAmount,
    currencyCode,
    date,
    description,
    transactionId: linkedTransactionId,
  });

  // Update portfolio cash balance (decrease)
  const negated = negateAmount({ amount });
  await updatePortfolioBalance({
    userId,
    portfolioId,
    currencyCode,
    availableCashDelta: negated,
    totalCashDelta: negated,
  });

  return transfer.reload({
    include: [
      { model: Portfolios, as: 'fromPortfolio' },
      { model: Currencies, as: 'currency' },
    ],
  });
};

export const portfolioToAccountTransfer = withTransaction(portfolioToAccountTransferImpl);

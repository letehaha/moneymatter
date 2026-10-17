import { ACCOUNT_CATEGORIES, ACCOUNT_TYPES } from '@bt/shared/types';
import { roundMoneyValues } from '@common/lib/currency-precision';
import { Money } from '@common/types/money';
import { t } from '@i18n/index';
import { ValidationError } from '@js/errors';
import Accounts, { createAccount as createAccountInDb } from '@models/accounts.model';
import LoanDetails from '@models/loan-details.model';
import { calculateRefAmount } from '@services/calculate-ref-amount.service';
import { withTransaction } from '@services/common/with-transaction';
import { utcDayKey } from '@services/loans/anchor-day';
import { ensureUserCurrencyConnected } from '@services/sharing/auth/ensure-currency-connected.service';

import type { CreateLoanBody } from './zod-schemas';

interface CreateLoanParams extends CreateLoanBody {
  userId: number;
}

const createLoanImpl = async (params: CreateLoanParams) => {
  const {
    userId,
    name,
    currencyCode,
    loanType,
    interestRate,
    termMonths = null,
    startDate,
    paymentDayOfMonth = null,
    lenderName = null,
    accountNumber = null,
  } = params;

  await ensureUserCurrencyConnected({ userId, currencyCode });

  // Every amount of the loan is held at the decimals of its currency.
  const {
    initialBalance,
    originalPrincipal,
    minPayment = null,
    plannedPayment = null,
  } = await roundMoneyValues({
    values: {
      initialBalance: params.initialBalance,
      originalPrincipal: params.originalPrincipal,
      minPayment: params.minPayment,
      plannedPayment: params.plannedPayment,
    },
    userId,
    currencyCode,
    mode: 'half-up',
  });

  const now = new Date();

  // Loan balances are stored negative so net-worth aggregation picks them up
  // automatically; the API accepts a positive outstanding amount, flip here.
  const negativeBalance = initialBalance.negate();
  const refNegativeBalance = await calculateRefAmount({
    userId,
    amount: negativeBalance,
    baseCode: currencyCode,
    date: now,
  });

  const refOriginalPrincipal = await calculateRefAmount({
    userId,
    amount: originalPrincipal,
    baseCode: currencyCode,
    date: now,
  });

  const refMinPayment =
    minPayment === null
      ? null
      : await calculateRefAmount({ userId, amount: minPayment, baseCode: currencyCode, date: now });

  const refPlannedPayment =
    plannedPayment === null
      ? null
      : await calculateRefAmount({ userId, amount: plannedPayment, baseCode: currencyCode, date: now });

  const zero = Money.zero();

  const account = await createAccountInDb({
    userId,
    name,
    currencyCode,
    accountCategory: ACCOUNT_CATEGORIES.loan,
    type: ACCOUNT_TYPES.system,
    initialBalance: negativeBalance,
    refInitialBalance: refNegativeBalance,
    creditLimit: zero,
    refCreditLimit: zero,
  });

  if (!account) {
    throw new ValidationError({ message: t({ key: 'loans.createAccountFailed' }) });
  }

  const created = await LoanDetails.create({
    accountId: account.id,
    userId,
    loanType,
    originalPrincipal,
    refOriginalPrincipal,
    interestRate,
    termMonths,
    startDate,
    // Anchor defaults to the creation date — the outstanding balance snapshot is
    // true as-of when the loan was entered into the system. The UTC calendar day
    // is used so the anchor matches how the SQL `DATE("time")` payment filter
    // classifies same-day legs on non-UTC servers.
    balanceAnchorDate: utcDayKey({ date: now }),
    minPayment,
    refMinPayment,
    plannedPayment,
    refPlannedPayment,
    paymentDayOfMonth,
    lenderName,
    accountNumber,
    events: [],
  });

  // Pull the Account association onto the freshly-created instance so the
  // serializer sees both sides without a second findOne round-trip.
  return created.reload({ include: [{ model: Accounts, as: 'account' }] });
};

export const createLoan = withTransaction(createLoanImpl);

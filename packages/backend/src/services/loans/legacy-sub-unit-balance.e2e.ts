import { TRANSACTION_TRANSFER_NATURE, type RecordId } from '@bt/shared/types';
import { describe, expect, it } from '@jest/globals';
import { ERROR_CODES } from '@js/errors';
import { connection } from '@models/index';
import * as helpers from '@tests/helpers';

/**
 * A JPY loan owing 1000 yen whose balance is then set to -1000.50, as a row converted from
 * 100050 cents holds it in a currency without minor units.
 */
const setupLegacyJpyLoan = async () => {
  await helpers.addUserCurrencies({ currencyCodes: ['JPY'], raw: true });
  const sourceAccount = await helpers.createAccount({
    payload: helpers.buildAccountPayload({ currencyCode: 'JPY', initialBalance: 100_000 }),
    raw: true,
  });
  const loan = await helpers.createLoan({
    payload: helpers.buildCreateLoanPayload({ currencyCode: 'JPY', initialBalance: 1000, originalPrincipal: 1000 }),
    raw: true,
  });
  await connection.sequelize.query(
    `UPDATE "Accounts" SET "initialBalance" = -1000.5, "currentBalance" = -1000.5 WHERE "id" = :id`,
    { replacements: { id: loan.id } },
  );

  return { loan, sourceAccount };
};

const payLoan = ({ loanId, sourceAccountId, amount }: { loanId: string; sourceAccountId: RecordId; amount: number }) =>
  helpers.createTransaction({
    payload: {
      ...helpers.buildTransactionPayload({ accountId: sourceAccountId, amount }),
      transferNature: TRANSACTION_TRANSFER_NATURE.transfer_to_loan,
      destinationAmount: amount,
      destinationAccountId: loanId as RecordId,
    },
  });

const paidOffEvents = (loan: Awaited<ReturnType<typeof helpers.getLoanById<true>>>) =>
  loan.loanDetails.events.filter((event) => event.type === 'paid_off');

describe('Loan with a legacy balance finer than its currency', () => {
  it('accepts a payment of the balance rounded half-up, settles the loan and stamps paid_off', async () => {
    const { loan, sourceAccount } = await setupLegacyJpyLoan();

    const payment = await payLoan({ loanId: loan.id, sourceAccountId: sourceAccount.id as RecordId, amount: 1001 });
    expect(payment.statusCode).toBe(200);

    const reloaded = await helpers.getLoanById({ id: loan.id, raw: true });
    expect(reloaded.currentBalance).toBe(0);
    expect(reloaded.projection.isPaidOff).toBe(true);
    expect(paidOffEvents(reloaded)).toHaveLength(1);
  });

  it('refuses a payment above the rounded balance as an overpay', async () => {
    const { loan, sourceAccount } = await setupLegacyJpyLoan();

    const payment = await payLoan({ loanId: loan.id, sourceAccountId: sourceAccount.id as RecordId, amount: 1002 });

    expect(payment.statusCode).toBe(ERROR_CODES.ValidationError);
    expect((await helpers.getLoanById({ id: loan.id, raw: true })).projection.isPaidOff).toBe(false);
  });

  it('keeps one yen owing after a payment of 1000, and settles on the next yen', async () => {
    const { loan, sourceAccount } = await setupLegacyJpyLoan();

    expect(
      (await payLoan({ loanId: loan.id, sourceAccountId: sourceAccount.id as RecordId, amount: 1000 })).statusCode,
    ).toBe(200);
    const owing = await helpers.getLoanById({ id: loan.id, raw: true });
    expect(owing.currentBalance).toBe(-1);
    expect(owing.projection.isPaidOff).toBe(false);
    expect(paidOffEvents(owing)).toEqual([]);

    expect(
      (await payLoan({ loanId: loan.id, sourceAccountId: sourceAccount.id as RecordId, amount: 1 })).statusCode,
    ).toBe(200);
    const settled = await helpers.getLoanById({ id: loan.id, raw: true });
    expect(settled.currentBalance).toBe(0);
    expect(settled.projection.isPaidOff).toBe(true);
    expect(paidOffEvents(settled)).toHaveLength(1);
  });
});

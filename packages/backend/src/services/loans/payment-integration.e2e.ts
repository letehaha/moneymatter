import {
  ACCOUNT_CATEGORIES,
  API_ERROR_CODES,
  TRANSACTION_TRANSFER_NATURE,
  TRANSACTION_TYPES,
  type RecordId,
} from '@bt/shared/types';
import { generateRandomRecordId } from '@common/lib/record-id-helpers';
import { describe, expect, it } from '@jest/globals';
import * as helpers from '@tests/helpers';

/** Reads the error envelope (`code` + `message`) from a failed helper response. */
const extractError = (response: unknown) =>
  (response as helpers.CustomResponse<unknown>).body.response as unknown as {
    code: string;
    message: string;
  };

/**
 * Creates a loan + source account and pays `amount` from source into the loan.
 * Both accounts share the loan's currency (USD, not the test base currency) so the
 * pair is same-currency — amount-only edits can mirror the amount to the income leg 1:1.
 */
const setupLoanPaymentPair = async ({ initialBalance, amount }: { initialBalance: number; amount: number }) => {
  await helpers.addUserCurrencies({ currencyCodes: ['USD'] });
  const loan = await helpers.createLoan({
    payload: helpers.buildCreateLoanPayload({
      initialBalance,
      originalPrincipal: initialBalance,
    }),
    raw: true,
  });
  const sourceAccount = await helpers.createAccount({
    payload: helpers.buildAccountPayload({ currencyCode: 'USD' }),
    raw: true,
  });

  const [base, opposite] = await helpers.createTransaction({
    payload: {
      ...helpers.buildTransactionPayload({
        accountId: sourceAccount.id,
        amount,
      }),
      transferNature: TRANSACTION_TRANSFER_NATURE.transfer_to_loan,
      destinationAmount: amount,
      destinationAccountId: loan.id as RecordId,
    },
    raw: true,
  });

  const expenseLeg = base.accountId === sourceAccount.id ? base : opposite!;

  return { loan, sourceAccount, base, opposite: opposite!, expenseLeg };
};

describe('Loan payment integration', () => {
  describe('POST /transactions with transferNature=transfer_to_loan', () => {
    it('creates a paired transfer, stamps both legs with transfer_to_loan, and reduces the loan balance', async () => {
      const loan = await helpers.createLoan({
        payload: helpers.buildCreateLoanPayload({
          initialBalance: 2_500,
          originalPrincipal: 2_500,
        }),
        raw: true,
      });

      const sourceAccount = await helpers.createAccount({ raw: true });

      const [base, opposite] = await helpers.createTransaction({
        payload: {
          ...helpers.buildTransactionPayload({
            accountId: sourceAccount.id,
            amount: 500,
          }),
          transferNature: TRANSACTION_TRANSFER_NATURE.transfer_to_loan,
          destinationAmount: 500,
          destinationAccountId: loan.id as RecordId,
        },
        raw: true,
      });

      expect(base.transferNature).toBe(TRANSACTION_TRANSFER_NATURE.transfer_to_loan);
      expect(opposite!.transferNature).toBe(TRANSACTION_TRANSFER_NATURE.transfer_to_loan);
      expect(base.transferId).toBeTruthy();
      expect(opposite!.transferId).toBe(base.transferId);

      const loanLeg = base.accountId === loan.id ? base : opposite!;
      const sourceLeg = base.accountId === sourceAccount.id ? base : opposite!;
      expect(loanLeg.accountId).toBe(loan.id);
      expect(loanLeg.transactionType).toBe(TRANSACTION_TYPES.income);
      expect(sourceLeg.accountId).toBe(sourceAccount.id);
      expect(sourceLeg.transactionType).toBe(TRANSACTION_TYPES.expense);

      const reloadedLoan = await helpers.getLoanById({ id: loan.id, raw: true });
      expect(reloadedLoan.currentBalance).toBe(-2_000);
    });

    it('rejects a transfer_to_loan whose destination is not a loan account, or that carries a destinationTransactionId', async () => {
      const [sourceAccount, regularDestination] = await Promise.all([
        helpers.createAccount({ raw: true }),
        helpers.createAccount({ raw: true }),
      ]);

      const response = await helpers.createTransaction({
        payload: {
          ...helpers.buildTransactionPayload({
            accountId: sourceAccount.id,
            amount: 500,
          }),
          transferNature: TRANSACTION_TRANSFER_NATURE.transfer_to_loan,
          destinationAmount: 500,
          destinationAccountId: regularDestination.id,
        },
      });

      expect(response.statusCode).toBe(422);
      const errorBody = extractError(response);
      expect(errorBody.code).toBe(API_ERROR_CODES.validationError);
      expect(errorBody.message).toMatch(/loan account/i);

      const withDestinationTx = await helpers.createTransaction({
        payload: helpers.buildTransactionPayload({
          accountId: sourceAccount.id,
          amount: 500,
          transferNature: TRANSACTION_TRANSFER_NATURE.transfer_to_loan,
          destinationTransactionId: generateRandomRecordId(),
        }),
      });

      expect(withDestinationTx.statusCode).toBe(422);
    });

    it('auto-stamps transfer_to_loan when a common_transfer-labeled transfer targets a loan account', async () => {
      // Loan treatment keys off the destination account's category, not the caller's label —
      // otherwise a common_transfer into a loan would mutate the balance while staying
      // invisible to the loan's payment list, delete guards, and overpay validation.
      const loan = await helpers.createLoan({
        payload: helpers.buildCreateLoanPayload({
          initialBalance: 1_000,
          originalPrincipal: 1_000,
        }),
        raw: true,
      });
      const sourceAccount = await helpers.createAccount({ raw: true });

      const [base, opposite] = await helpers.createTransaction({
        payload: {
          ...helpers.buildTransactionPayload({
            accountId: sourceAccount.id,
            amount: 200,
          }),
          transferNature: TRANSACTION_TRANSFER_NATURE.common_transfer,
          destinationAmount: 200,
          destinationAccountId: loan.id as RecordId,
        },
        raw: true,
      });

      expect(base.transferNature).toBe(TRANSACTION_TRANSFER_NATURE.transfer_to_loan);
      expect(opposite!.transferNature).toBe(TRANSACTION_TRANSFER_NATURE.transfer_to_loan);

      const reloadedLoan = await helpers.getLoanById({ id: loan.id, raw: true });
      expect(reloadedLoan.currentBalance).toBe(-800);
    });

    it('applies the overpay guard to common_transfer-labeled transfers into a loan account', async () => {
      const loan = await helpers.createLoan({
        payload: helpers.buildCreateLoanPayload({
          initialBalance: 1_000,
          originalPrincipal: 1_000,
        }),
        raw: true,
      });
      const sourceAccount = await helpers.createAccount({ raw: true });

      const response = await helpers.createTransaction({
        payload: {
          ...helpers.buildTransactionPayload({
            accountId: sourceAccount.id,
            amount: 2_000,
          }),
          transferNature: TRANSACTION_TRANSFER_NATURE.common_transfer,
          destinationAmount: 2_000,
          destinationAccountId: loan.id as RecordId,
        },
      });

      expect(response.statusCode).toBe(422);
      const errorBody = extractError(response);
      expect(errorBody.code).toBe(API_ERROR_CODES.validationError);
      expect(errorBody.message).toMatch(/overpay|exceed|owed/i);

      const reloadedLoan = await helpers.getLoanById({ id: loan.id, raw: true });
      expect(reloadedLoan.currentBalance).toBe(-1_000);
    });
  });

  describe('PUT /transactions/:id — transfer kind is frozen on existing pairs', () => {
    it('rejects relabeling a common_transfer pair as transfer_to_loan, and re-pointing one onto a loan account', async () => {
      const loan = await helpers.createLoan({
        payload: helpers.buildCreateLoanPayload({
          initialBalance: 1_000,
          originalPrincipal: 1_000,
        }),
        raw: true,
      });
      const [sourceAccount, destinationAccount] = await Promise.all([
        helpers.createAccount({ raw: true }),
        helpers.createAccount({ raw: true }),
      ]);

      const [base] = await helpers.createTransaction({
        payload: {
          ...helpers.buildTransactionPayload({
            accountId: sourceAccount.id,
            amount: 300,
          }),
          transferNature: TRANSACTION_TRANSFER_NATURE.common_transfer,
          destinationAmount: 300,
          destinationAccountId: destinationAccount.id,
        },
        raw: true,
      });

      const relabelResponse = await helpers.updateTransaction({
        id: base.id,
        payload: {
          transferNature: TRANSACTION_TRANSFER_NATURE.transfer_to_loan,
          destinationAccountId: loan.id as RecordId,
          destinationAmount: 300,
        },
      });

      expect(relabelResponse.statusCode).toBe(422);
      const relabelError = extractError(relabelResponse);
      expect(relabelError.code).toBe(API_ERROR_CODES.validationError);
      expect(relabelError.message).toMatch(/transfer kind/i);

      // Nature omitted, so the pair stays common_transfer and the loan destination is still refused.
      const rePointResponse = await helpers.updateTransaction({
        id: base.id,
        payload: { destinationAccountId: loan.id as RecordId, destinationAmount: 300 },
      });

      expect(rePointResponse.statusCode).toBe(422);
      const rePointError = extractError(rePointResponse);
      expect(rePointError.code).toBe(API_ERROR_CODES.validationError);
      expect(rePointError.message).toMatch(/unlink/i);

      const reloadedLoan = await helpers.getLoanById({ id: loan.id, raw: true });
      expect(reloadedLoan.currentBalance).toBe(-1_000);
    });

    it('freezes an existing transfer_to_loan pair against relabeling, re-pointing and unlinking', async () => {
      const { loan, expenseLeg } = await setupLoanPaymentPair({ initialBalance: 2_500, amount: 500 });
      const regularAccount = await helpers.createAccount({ raw: true });

      const relabelResponse = await helpers.updateTransaction({
        id: expenseLeg.id,
        payload: {
          transferNature: TRANSACTION_TRANSFER_NATURE.common_transfer,
          destinationAccountId: regularAccount.id,
          destinationAmount: 500,
        },
      });

      expect(relabelResponse.statusCode).toBe(422);
      const relabelError = extractError(relabelResponse);
      expect(relabelError.code).toBe(API_ERROR_CODES.validationError);
      expect(relabelError.message).toMatch(/transfer kind/i);

      // Nature omitted — pair stays transfer_to_loan, so destination must remain a loan-category account.
      const rePointResponse = await helpers.updateTransaction({
        id: expenseLeg.id,
        payload: {
          destinationAccountId: regularAccount.id,
          destinationAmount: 500,
        },
      });

      expect(rePointResponse.statusCode).toBe(422);
      const rePointError = extractError(rePointResponse);
      expect(rePointError.code).toBe(API_ERROR_CODES.validationError);
      expect(rePointError.message).toMatch(/loan account/i);

      // Unlinking sets the loan-side income leg to not_transfer, leaving a standalone
      // transaction on the loan account — forbidden by the write guard. Deleting the
      // payment (which restores the balance) is the only supported undo.
      const unlinkResponse = await helpers.updateTransaction({
        id: expenseLeg.id,
        payload: { transferNature: TRANSACTION_TRANSFER_NATURE.not_transfer },
      });

      expect(unlinkResponse.statusCode).toBe(422);
      const unlinkError = extractError(unlinkResponse);
      expect(unlinkError.code).toBe(API_ERROR_CODES.validationError);

      const reloadedLoan = await helpers.getLoanById({ id: loan.id, raw: true });
      expect(reloadedLoan.currentBalance).toBe(-2_000);
    });
  });

  describe('Overpayment validation', () => {
    it('rejects POST when destinationAmount exceeds the loan currentOwed', async () => {
      const loan = await helpers.createLoan({
        payload: helpers.buildCreateLoanPayload({
          initialBalance: 1_000,
          originalPrincipal: 1_000,
        }),
        raw: true,
      });
      const sourceAccount = await helpers.createAccount({ raw: true });

      const response = await helpers.createTransaction({
        payload: {
          ...helpers.buildTransactionPayload({
            accountId: sourceAccount.id,
            amount: 2_000,
          }),
          transferNature: TRANSACTION_TRANSFER_NATURE.transfer_to_loan,
          destinationAmount: 2_000,
          destinationAccountId: loan.id as RecordId,
        },
      });

      expect(response.statusCode).toBe(422);
      const errorBody = extractError(response);
      expect(errorBody.code).toBe(API_ERROR_CODES.validationError);
      expect(errorBody.message).toMatch(/overpay|exceed|owed/i);

      const reloadedLoan = await helpers.getLoanById({ id: loan.id, raw: true });
      expect(reloadedLoan.currentBalance).toBe(-1_000);
    });

    it('accepts POST when destinationAmount equals the loan currentOwed (boundary)', async () => {
      const loan = await helpers.createLoan({
        payload: helpers.buildCreateLoanPayload({
          initialBalance: 1_000,
          originalPrincipal: 1_000,
        }),
        raw: true,
      });
      const sourceAccount = await helpers.createAccount({ raw: true });

      const [base, opposite] = await helpers.createTransaction({
        payload: {
          ...helpers.buildTransactionPayload({
            accountId: sourceAccount.id,
            amount: 1_000,
          }),
          transferNature: TRANSACTION_TRANSFER_NATURE.transfer_to_loan,
          destinationAmount: 1_000,
          destinationAccountId: loan.id as RecordId,
        },
        raw: true,
      });

      expect(base.transferNature).toBe(TRANSACTION_TRANSFER_NATURE.transfer_to_loan);
      expect(opposite!.transferNature).toBe(TRANSACTION_TRANSFER_NATURE.transfer_to_loan);

      const reloadedLoan = await helpers.getLoanById({ id: loan.id, raw: true });
      expect(reloadedLoan.currentBalance).toBe(0);
    });

    it('rejects PUT that bumps the loan-leg amount past the remaining owed', async () => {
      // Loan owes $1,000. Pay $300 → -$700 owed. Try to edit that payment to
      // $1,500 → would push balance to +$800. Reject.
      const { loan, expenseLeg } = await setupLoanPaymentPair({ initialBalance: 1_000, amount: 300 });

      const paidLoan = await helpers.getLoanById({ id: loan.id, raw: true });
      expect(paidLoan.currentBalance).toBe(-700);

      const response = await helpers.updateTransaction({
        id: expenseLeg.id,
        payload: {
          destinationAmount: 1_500,
        },
      });

      expect(response.statusCode).toBe(422);
      const errorBody = extractError(response);
      expect(errorBody.code).toBe(API_ERROR_CODES.validationError);
      expect(errorBody.message).toMatch(/overpay|exceed|owed/i);

      const reloadedLoan = await helpers.getLoanById({ id: loan.id, raw: true });
      expect(reloadedLoan.currentBalance).toBe(-700);
    });

    it('accepts PUT that bumps the loan-leg amount up to (but not over) the remaining owed', async () => {
      // Loan owes $1,000. Pay $300 → -$700 owed. Edit to $1,000 — the full
      // payoff boundary (projected balance = 0, exactly at the limit).
      const { loan, expenseLeg } = await setupLoanPaymentPair({ initialBalance: 1_000, amount: 300 });

      const [base, opposite] = await helpers.updateTransaction({
        id: expenseLeg.id,
        payload: { destinationAmount: 1_000 },
        raw: true,
      });

      expect(base.transferNature).toBe(TRANSACTION_TRANSFER_NATURE.transfer_to_loan);
      expect(opposite!.transferNature).toBe(TRANSACTION_TRANSFER_NATURE.transfer_to_loan);

      const reloadedLoan = await helpers.getLoanById({ id: loan.id, raw: true });
      expect(reloadedLoan.currentBalance).toBe(0);
    });

    it('accepts PUT whose loan-leg amount only reaches the payoff before rounding to the loan currency', async () => {
      // Loan owes $1,000. Edit the $300 payment to $1,000.004: stored half-up at 2 decimals it is
      // exactly $1,000.00, a full payoff, so the overpay check must judge the rounded amount.
      const { loan, expenseLeg } = await setupLoanPaymentPair({ initialBalance: 1_000, amount: 300 });

      const [, opposite] = await helpers.updateTransaction({
        id: expenseLeg.id,
        payload: { destinationAmount: 1_000.004 },
        raw: true,
      });

      expect(opposite!.amount).toBe(1_000);

      const reloadedLoan = await helpers.getLoanById({ id: loan.id, raw: true });
      expect(reloadedLoan.currentBalance).toBe(0);
    });

    it('rejects PUT whose loan-leg amount still overpays after rounding to the loan currency', async () => {
      const { loan, expenseLeg } = await setupLoanPaymentPair({ initialBalance: 1_000, amount: 300 });

      const response = await helpers.updateTransaction({
        id: expenseLeg.id,
        payload: { destinationAmount: 1_000.006 },
      });

      expect(response.statusCode).toBe(422);
      expect(extractError(response).message).toMatch(/overpay|exceed|owed/i);

      const reloadedLoan = await helpers.getLoanById({ id: loan.id, raw: true });
      expect(reloadedLoan.currentBalance).toBe(-700);
    });

    it('re-points a payment to another loan and moves the balances accordingly', async () => {
      const { loan, expenseLeg } = await setupLoanPaymentPair({ initialBalance: 1_000, amount: 500 });
      const bigLoan = await helpers.createLoan({
        payload: helpers.buildCreateLoanPayload({
          name: 'Big loan',
          initialBalance: 2_000,
          originalPrincipal: 2_000,
        }),
        raw: true,
      });

      const [base, opposite] = await helpers.updateTransaction({
        id: expenseLeg.id,
        payload: { destinationAccountId: bigLoan.id as RecordId, destinationAmount: 500 },
        raw: true,
      });

      expect(base.transferNature).toBe(TRANSACTION_TRANSFER_NATURE.transfer_to_loan);
      expect(opposite!.accountId).toBe(bigLoan.id);

      // The payment leaves the first loan entirely and lands on the second.
      const reloadedOriginal = await helpers.getLoanById({ id: loan.id, raw: true });
      expect(reloadedOriginal.currentBalance).toBe(-1_000);
      const reloadedBig = await helpers.getLoanById({ id: bigLoan.id, raw: true });
      expect(reloadedBig.currentBalance).toBe(-1_500);
    });

    it('rejects re-pointing a payment to a different loan it would overpay, with or without an explicit amount', async () => {
      // The overpay guard must project against the NEW loan's balance without backing out
      // the old leg (which never touched that loan) — otherwise a $500 payment re-pointed
      // onto a $100 loan would slip through and drive it into credit.
      const { loan, expenseLeg } = await setupLoanPaymentPair({ initialBalance: 1_000, amount: 500 });
      const smallLoan = await helpers.createLoan({
        payload: helpers.buildCreateLoanPayload({
          name: 'Small loan',
          initialBalance: 100,
          originalPrincipal: 100,
        }),
        raw: true,
      });

      const withAmount = await helpers.updateTransaction({
        id: expenseLeg.id,
        payload: { destinationAccountId: smallLoan.id as RecordId, destinationAmount: 500 },
      });

      expect(withAmount.statusCode).toBe(422);
      const withAmountError = extractError(withAmount);
      expect(withAmountError.code).toBe(API_ERROR_CODES.validationError);
      expect(withAmountError.message).toMatch(/overpay|exceed|owed/i);

      // A PATCH that re-points the destination but keeps the amount must still run balance validation.
      const amountOmitted = await helpers.updateTransaction({
        id: expenseLeg.id,
        payload: { destinationAccountId: smallLoan.id as RecordId },
      });

      expect(amountOmitted.statusCode).toBe(422);
      const amountOmittedError = extractError(amountOmitted);
      expect(amountOmittedError.code).toBe(API_ERROR_CODES.validationError);
      expect(amountOmittedError.message).toMatch(/overpay|exceed|owed/i);

      expect((await helpers.getLoanById({ id: loan.id, raw: true })).currentBalance).toBe(-500);
      expect((await helpers.getLoanById({ id: smallLoan.id, raw: true })).currentBalance).toBe(-100);
    });

    it('rejects POST overpay when source account currency differs from the loan currency', async () => {
      // Loan in USD owes $1,000; source account is UAH. Overpay check must compare
      // destinationAmount (loan currency, USD), not the UAH source amount, against the owed balance.
      const loan = await helpers.createLoan({
        payload: helpers.buildCreateLoanPayload({
          initialBalance: 1_000,
          originalPrincipal: 1_000,
          currencyCode: 'USD',
        }),
        raw: true,
      });
      const { account: uahAccount } = await helpers.createAccountWithNewCurrency({ currency: 'UAH' });

      const response = await helpers.createTransaction({
        payload: {
          ...helpers.buildTransactionPayload({
            accountId: uahAccount.id,
            amount: 82_800, // approximately $2,000 worth of UAH
          }),
          transferNature: TRANSACTION_TRANSFER_NATURE.transfer_to_loan,
          destinationAmount: 2_000,
          destinationAccountId: loan.id as RecordId,
        },
      });

      expect(response.statusCode).toBe(422);
      const errorBody = extractError(response);
      expect(errorBody.code).toBe(API_ERROR_CODES.validationError);
      expect(errorBody.message).toMatch(/overpay|exceed|owed/i);

      const reloadedLoan = await helpers.getLoanById({ id: loan.id, raw: true });
      expect(reloadedLoan.currentBalance).toBe(-1_000);
    });

    it('blocks two concurrent POSTs from together overpaying the loan', async () => {
      // Two concurrent $700 payments each individually pass the overpay check (1000 − 700 =
      // 300 owed), but together would push the loan to +$400. Row-level locking on the loan
      // account must serialize them so exactly one succeeds.
      const loan = await helpers.createLoan({
        payload: helpers.buildCreateLoanPayload({
          initialBalance: 1_000,
          originalPrincipal: 1_000,
        }),
        raw: true,
      });
      const [sourceA, sourceB] = await Promise.all([
        helpers.createAccount({ raw: true }),
        helpers.createAccount({ raw: true }),
      ]);

      const buildPayload = (sourceAccountId: RecordId) => ({
        ...helpers.buildTransactionPayload({ accountId: sourceAccountId, amount: 700 }),
        transferNature: TRANSACTION_TRANSFER_NATURE.transfer_to_loan,
        destinationAmount: 700,
        destinationAccountId: loan.id as RecordId,
      });

      const [resA, resB] = await Promise.all([
        helpers.createTransaction({ payload: buildPayload(sourceA.id as RecordId) }),
        helpers.createTransaction({ payload: buildPayload(sourceB.id as RecordId) }),
      ]);

      const statuses = [resA.statusCode, resB.statusCode].toSorted();
      expect(statuses).toEqual([200, 422]);

      const reloadedLoan = await helpers.getLoanById({ id: loan.id, raw: true });
      expect(reloadedLoan.currentBalance).toBe(-300);
    });
  });

  describe('PUT /transactions/:id with amount only on the expense leg', () => {
    it('propagates an amount-only edit to the loan-side income leg and moves the loan balance', async () => {
      // Same-currency pair: the income leg mirrors the expense leg 1:1, so an
      // edit that carries only `amount` must rewrite both legs.
      const { loan, expenseLeg } = await setupLoanPaymentPair({ initialBalance: 1_000, amount: 300 });

      const [updatedBase, updatedOpposite] = await helpers.updateTransaction({
        id: expenseLeg.id,
        payload: { amount: 500 },
        raw: true,
      });

      expect(updatedBase.amount).toBe(500);
      expect(updatedOpposite!.amount).toBe(500);
      expect(updatedOpposite!.transactionType).toBe(TRANSACTION_TYPES.income);

      // Both persisted legs carry the new amount.
      const reloadedExpenseLeg = await helpers.getTransactionById({ id: updatedBase.id, raw: true });
      const reloadedIncomeLeg = await helpers.getTransactionById({ id: updatedOpposite!.id, raw: true });
      expect(reloadedExpenseLeg!.amount).toBe(500);
      expect(reloadedIncomeLeg!.amount).toBe(500);

      const reloadedLoan = await helpers.getLoanById({ id: loan.id, raw: true });
      expect(reloadedLoan.currentBalance).toBe(-500);
    });

    it('rejects an amount-only edit that would overpay the loan', async () => {
      // Loan owes $1,000. Pay $300 → -$700 owed. An amount-only edit to $1,500
      // implies the same income-leg amount, projecting the balance to +$800.
      const { loan, base, opposite, expenseLeg } = await setupLoanPaymentPair({ initialBalance: 1_000, amount: 300 });
      const incomeLeg = base.id === expenseLeg.id ? opposite : base;

      const response = await helpers.updateTransaction({
        id: expenseLeg.id,
        payload: { amount: 1_500 },
      });

      expect(response.statusCode).toBe(422);
      const errorBody = extractError(response);
      expect(errorBody.code).toBe(API_ERROR_CODES.validationError);
      expect(errorBody.message).toMatch(/overpay|exceed|owed/i);

      // Both legs and the loan balance stay untouched.
      const reloadedExpenseLeg = await helpers.getTransactionById({ id: expenseLeg.id, raw: true });
      const reloadedIncomeLeg = await helpers.getTransactionById({ id: incomeLeg.id, raw: true });
      expect(reloadedExpenseLeg!.amount).toBe(300);
      expect(reloadedIncomeLeg!.amount).toBe(300);
      const reloadedLoan = await helpers.getLoanById({ id: loan.id, raw: true });
      expect(reloadedLoan.currentBalance).toBe(-700);
    });
  });

  describe('PUT /transactions/:id targeting the loan-side income leg', () => {
    it('rejects any edit of the loan-side income leg (payments are edited via the expense leg)', async () => {
      // The income leg is system-managed: a direct amount edit would move the
      // loan balance without passing the overpay assertion (the destination
      // fields the source-leg edit path keys on are absent from the payload).
      const { loan, base, opposite, expenseLeg } = await setupLoanPaymentPair({ initialBalance: 1_000, amount: 300 });
      const incomeLeg = base.id === expenseLeg.id ? opposite : base;

      const amountResponse = await helpers.updateTransaction({
        id: incomeLeg.id,
        payload: { amount: 1_500 },
      });

      expect(amountResponse.statusCode).toBe(422);
      expect(extractError(amountResponse).code).toBe(API_ERROR_CODES.validationError);

      // Even a "harmless" note edit is rejected: routing an income-leg edit
      // through the transfer-update machinery would restamp the opposite
      // (cash) leg's transactionType, corrupting the cash account balance.
      const noteResponse = await helpers.updateTransaction({
        id: incomeLeg.id,
        payload: { note: 'edited from the loan side' },
      });

      expect(noteResponse.statusCode).toBe(422);
      expect(extractError(noteResponse).code).toBe(API_ERROR_CODES.validationError);

      const reloadedLoan = await helpers.getLoanById({ id: loan.id, raw: true });
      expect(reloadedLoan.currentBalance).toBe(-700);
    });
  });

  describe('moving the expense leg onto the loan account', () => {
    it('rejects re-pointing the loan-payment expense leg accountId to the loan account itself', async () => {
      // An expense leg on the loan account is a semantically impossible shape:
      // the balance recompute sums only income legs, so the expense would move
      // the account's history while staying invisible to the loan machinery.
      const { loan, sourceAccount, expenseLeg } = await setupLoanPaymentPair({ initialBalance: 1_000, amount: 300 });

      const response = await helpers.updateTransaction({
        id: expenseLeg.id,
        payload: { accountId: loan.id as RecordId },
      });

      expect(response.statusCode).toBe(422);
      const errorBody = extractError(response);
      expect(errorBody.code).toBe(API_ERROR_CODES.validationError);

      // The expense leg stays on the cash account; the loan balance is untouched.
      const reloadedLeg = await helpers.getTransactionById({ id: expenseLeg.id, raw: true });
      expect(reloadedLeg!.accountId).toBe(sourceAccount.id);
      const reloadedLoan = await helpers.getLoanById({ id: loan.id, raw: true });
      expect(reloadedLoan.currentBalance).toBe(-700);
    });
  });

  describe('generic POST /accounts rejects the loan category', () => {
    // Loans own a required 1:1 LoanDetails sidecar and are created only via
    // `/loans`. The generic accounts endpoint must refuse `accountCategory:
    // 'loan'` so a sidecar-less loan account can never come into existence.
    it('rejects creating a loan-category account through the plain accounts endpoint', async () => {
      const response = await helpers.createAccount({
        payload: helpers.buildAccountPayload({ accountCategory: ACCOUNT_CATEGORIES.loan }),
        raw: false,
      });

      expect(response.statusCode).toBe(422);
      const errorBody = extractError(response);
      expect(errorBody.code).toBe(API_ERROR_CODES.validationError);
    });
  });

  describe('DELETE /transactions/:id on a transfer_to_loan pair', () => {
    it('removes both legs and restores the loan balance', async () => {
      const { loan, expenseLeg } = await setupLoanPaymentPair({ initialBalance: 2_500, amount: 500 });

      const paidLoan = await helpers.getLoanById({ id: loan.id, raw: true });
      expect(paidLoan.currentBalance).toBe(-2_000);

      const response = await helpers.deleteTransaction({ id: expenseLeg.id });
      expect(response.statusCode).toBe(200);

      const txsAfterDeletion = await helpers.getTransactions({ raw: true });
      expect(txsAfterDeletion.length).toBe(0);

      const reloadedLoan = await helpers.getLoanById({ id: loan.id, raw: true });
      expect(reloadedLoan.currentBalance).toBe(-2_500);
    });

    it('removes both legs and restores the loan balance when the income (loan-side) leg is deleted', async () => {
      const { loan, base, opposite, expenseLeg } = await setupLoanPaymentPair({ initialBalance: 2_500, amount: 500 });
      const incomeLeg = base.id === expenseLeg.id ? opposite : base;

      const response = await helpers.deleteTransaction({ id: incomeLeg.id });
      expect(response.statusCode).toBe(200);

      const txsAfterDeletion = await helpers.getTransactions({ raw: true });
      expect(txsAfterDeletion.length).toBe(0);

      const reloadedLoan = await helpers.getLoanById({ id: loan.id, raw: true });
      expect(reloadedLoan.currentBalance).toBe(-2_500);
    });
  });

  describe('Loan accounts reject direct writes outside the transfer_to_loan flow', () => {
    it('rejects plain income, plain expense and loan-as-source transfers, but still accepts a real payment', async () => {
      const loan = await helpers.createLoan({
        payload: helpers.buildCreateLoanPayload({
          initialBalance: 1_000,
          originalPrincipal: 1_000,
        }),
        raw: true,
      });
      const cashAccount = await helpers.createAccount({ raw: true });

      // A loan balance may only move through the validated transfer_to_loan flow — a
      // standalone income leg would bump it (toward credit here) with no overpay check
      // and no payment record the loan guards can see.
      const incomeResponse = await helpers.createTransaction({
        payload: helpers.buildTransactionPayload({
          accountId: loan.id as RecordId,
          amount: 500,
          transactionType: TRANSACTION_TYPES.income,
          transferNature: TRANSACTION_TRANSFER_NATURE.not_transfer,
        }),
      });

      expect(incomeResponse.statusCode).toBe(422);
      expect(extractError(incomeResponse).code).toBe(API_ERROR_CODES.validationError);

      // A standalone expense leg drives the loan deeper into debt, skipping the payment flow and its audit trail.
      const expenseResponse = await helpers.createTransaction({
        payload: helpers.buildTransactionPayload({
          accountId: loan.id as RecordId,
          amount: 500,
          transactionType: TRANSACTION_TYPES.expense,
          transferNature: TRANSACTION_TRANSFER_NATURE.not_transfer,
        }),
      });

      expect(expenseResponse.statusCode).toBe(422);
      expect(extractError(expenseResponse).code).toBe(API_ERROR_CODES.validationError);

      // With the loan as source, the expense leg lands on the loan labeled common_transfer —
      // it moves the balance yet stays invisible to delete guards that only recognise transfer_to_loan.
      const loanAsSourceResponse = await helpers.createTransaction({
        payload: {
          ...helpers.buildTransactionPayload({
            accountId: loan.id as RecordId,
            amount: 300,
          }),
          transferNature: TRANSACTION_TRANSFER_NATURE.common_transfer,
          destinationAmount: 300,
          destinationAccountId: cashAccount.id as RecordId,
        },
      });

      expect(loanAsSourceResponse.statusCode).toBe(422);
      expect(extractError(loanAsSourceResponse).code).toBe(API_ERROR_CODES.validationError);

      expect((await helpers.getLoanById({ id: loan.id, raw: true })).currentBalance).toBe(-1_000);

      // The readonly guard must still let the one sanctioned write through — the income leg
      // of a transfer_to_loan payment — and move the balance toward zero.
      await helpers.createTransaction({
        payload: {
          ...helpers.buildTransactionPayload({
            accountId: cashAccount.id as RecordId,
            amount: 400,
          }),
          transferNature: TRANSACTION_TRANSFER_NATURE.transfer_to_loan,
          destinationAmount: 400,
          destinationAccountId: loan.id as RecordId,
        },
        raw: true,
      });

      const reloadedLoan = await helpers.getLoanById({ id: loan.id, raw: true });
      expect(reloadedLoan.currentBalance).toBe(-600);
    });
  });

  describe('rejects an income base for a loan payment', () => {
    it('rejects an income base on create (both labels) and on promotion via update', async () => {
      // A loan payment is an outflow — the base leg must be the expense leaving the user's
      // cash account. An income base would invert both legs, stamping the loan with an
      // expense leg that grows the debt.
      const loan = await helpers.createLoan({
        payload: helpers.buildCreateLoanPayload({ initialBalance: 1_000, originalPrincipal: 1_000 }),
        raw: true,
      });
      const sourceAccount = await helpers.createAccount({ raw: true });

      const labeledResponse = await helpers.createTransaction({
        payload: {
          ...helpers.buildTransactionPayload({
            accountId: sourceAccount.id,
            amount: 300,
            transactionType: TRANSACTION_TYPES.income,
          }),
          transferNature: TRANSACTION_TRANSFER_NATURE.transfer_to_loan,
          destinationAmount: 300,
          destinationAccountId: loan.id as RecordId,
        },
      });

      expect(labeledResponse.statusCode).toBe(422);
      expect(extractError(labeledResponse).code).toBe(API_ERROR_CODES.validationError);

      // A common_transfer into a loan is auto-stamped transfer_to_loan, so the income guard
      // keys off the loan destination, not the label, to catch this bypass.
      const autoStampResponse = await helpers.createTransaction({
        payload: {
          ...helpers.buildTransactionPayload({
            accountId: sourceAccount.id,
            amount: 300,
            transactionType: TRANSACTION_TYPES.income,
          }),
          transferNature: TRANSACTION_TRANSFER_NATURE.common_transfer,
          destinationAmount: 300,
          destinationAccountId: loan.id as RecordId,
        },
      });

      expect(autoStampResponse.statusCode).toBe(422);
      expect(extractError(autoStampResponse).code).toBe(API_ERROR_CODES.validationError);

      const [incomeTx] = await helpers.createTransaction({
        payload: helpers.buildTransactionPayload({
          accountId: sourceAccount.id,
          amount: 300,
          transactionType: TRANSACTION_TYPES.income,
        }),
        raw: true,
      });

      const promoteResponse = await helpers.updateTransaction({
        id: incomeTx.id,
        payload: {
          transferNature: TRANSACTION_TRANSFER_NATURE.transfer_to_loan,
          destinationAmount: 300,
          destinationAccountId: loan.id as RecordId,
        },
      });

      expect(promoteResponse.statusCode).toBe(422);
      expect(extractError(promoteResponse).code).toBe(API_ERROR_CODES.validationError);

      const reloadedLoan = await helpers.getLoanById({ id: loan.id, raw: true });
      expect(reloadedLoan.currentBalance).toBe(-1_000);
    });
  });
});

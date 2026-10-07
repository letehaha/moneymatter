import { TRANSACTION_TRANSFER_NATURE, TRANSACTION_TYPES } from '@bt/shared/types';
import { generateRandomRecordId } from '@common/lib/record-id-helpers';
import { beforeEach, describe, expect, it } from '@jest/globals';
import { ERROR_CODES } from '@js/errors';
import Accounts from '@models/accounts.model';
import Portfolios from '@models/investments/portfolios.model';
import * as helpers from '@tests/helpers';

describe('Portfolio to Account Transfer (POST /investments/portfolios/:id/transfer/to-account)', () => {
  let portfolio: Portfolios;
  let account: Accounts;
  let currencyCode: string;

  beforeEach(async () => {
    portfolio = await helpers.createPortfolio({
      payload: helpers.buildPortfolioPayload({ name: 'Investment Portfolio' }),
      raw: true,
    });

    account = await helpers.createAccount({
      payload: helpers.buildAccountPayload({ name: 'Main Account' }),
      raw: true,
    });

    currencyCode = account.currencyCode;

    // Seed portfolio with some cash so withdrawal makes sense
    await helpers.updatePortfolioBalance({
      portfolioId: portfolio.id,
      currencyCode,
      setAvailableCash: '1000',
      setTotalCash: '1000',
    });
  });

  it('should transfer funds from portfolio to account, create the income transaction and list the transfer', async () => {
    const transfer = await helpers.portfolioToAccountTransfer({
      portfolioId: portfolio.id,
      payload: {
        accountId: account.id,
        amount: '300',
        currencyCode,
        date: '2025-06-15',
        description: 'Withdraw from portfolio',
      },
      raw: true,
    });

    expect(transfer).toMatchObject({
      id: expect.any(String),
      fromPortfolioId: portfolio.id,
      toAccountId: account.id,
      fromAccountId: null,
      toPortfolioId: null,
      amount: expect.toBeNumericEqual('300'),
      refAmount: expect.any(String),
      currencyCode,
      description: 'Withdraw from portfolio',
    });

    // Portfolio balance should decrease
    const [balance] = await helpers.getPortfolioBalance({
      portfolioId: portfolio.id,
      currencyCode,
      raw: true,
    });

    expect(balance!.availableCash).toBeNumericEqual(700);
    expect(balance!.totalCash).toBeNumericEqual(700);

    const transactions = await helpers.getTransactions({
      raw: true,
    });

    expect(transactions.length).toBe(1);

    const tx = transactions[0]!;
    expect(tx.transactionType).toBe(TRANSACTION_TYPES.income);
    expect(tx.transferNature).toBe(TRANSACTION_TRANSFER_NATURE.transfer_to_portfolio);
    expect(tx.amount).toBeNumericEqual(300);
    expect(tx.refCurrencyCode).toBe(global.BASE_CURRENCY.code);
    expect(transfer.transactionId).toBe(tx.id);

    const { data: transfers } = await helpers.listPortfolioTransfers({
      portfolioId: portfolio.id,
      raw: true,
    });

    expect(transfers.length).toBe(1);
    expect(transfers[0]!.id).toBe(transfer.id);
  }, 30000);

  it('should link an existing income transaction instead of creating one, and reject re-linking it', async () => {
    // First create an income transaction manually
    const [incomeTx] = await helpers.createTransaction({
      payload: helpers.buildTransactionPayload({
        accountId: account.id,
        amount: 500,
        transactionType: TRANSACTION_TYPES.income,
      }),
      raw: true,
    });

    // Now create a portfolio→account transfer linking to that transaction
    const transfer = await helpers.portfolioToAccountTransfer({
      portfolioId: portfolio.id,
      payload: {
        accountId: account.id,
        amount: '500',
        currencyCode,
        date: '2025-06-15',
        existingTransactionId: incomeTx!.id,
      },
      raw: true,
    });

    expect(transfer.id).toEqual(expect.any(String));

    // Verify the existing transaction was updated (not a new one created)
    const transactions = await helpers.getTransactions({
      raw: true,
    });

    // Should still be only 1 transaction (the existing one, now linked)
    expect(transactions.length).toBe(1);
    expect(transactions[0]!.id).toBe(incomeTx!.id);
    expect(transactions[0]!.transferNature).toBe(TRANSACTION_TRANSFER_NATURE.transfer_to_portfolio);
    // Linking re-stamps refCurrencyCode to the user's current base currency so
    // downstream aggregations stay correct even when the original tx pre-dates
    // a base-currency switch. The @BeforeUpdate validator also requires it.
    expect(transactions[0]!.refCurrencyCode).toBe(global.BASE_CURRENCY.code);

    // Verify the PortfolioTransfer record points to the existing transaction
    expect(transfer.transactionId).toBe(incomeTx!.id);

    const relinkResponse = await helpers.portfolioToAccountTransfer({
      portfolioId: portfolio.id,
      payload: {
        accountId: account.id,
        amount: '500',
        currencyCode,
        date: '2025-06-20',
        existingTransactionId: incomeTx!.id,
      },
    });

    expect(relinkResponse.statusCode).toBe(ERROR_CODES.ValidationError);
  }, 30000);

  it('should reject a bank-linked destination account when no existing transaction is linked', async () => {
    const { account: bankAccount } = await helpers.lunchflow.mockTransactions();
    const rowsBefore = (await helpers.getTransactions({ accountIds: [bankAccount.id], raw: true })).length;

    const response = await helpers.portfolioToAccountTransfer({
      portfolioId: portfolio.id,
      payload: {
        accountId: bankAccount.id,
        amount: '100',
        currencyCode: bankAccount.currencyCode,
        date: '2025-06-15',
      },
    });

    expect(response.statusCode).toBe(ERROR_CODES.ValidationError);
    expect(await helpers.getTransactions({ accountIds: [bankAccount.id], raw: true })).toHaveLength(rowsBefore);
    expect((await helpers.listPortfolioTransfers({ portfolioId: portfolio.id, raw: true })).data).toEqual([]);
  });

  it('should set refCurrencyCode to base currency when account currency differs from base', async () => {
    const { account: eurAccount } = await helpers.createAccountWithNewCurrency({ currency: 'EUR' });

    // Seed portfolio with EUR cash so the withdrawal has something to draw from
    await helpers.updatePortfolioBalance({
      portfolioId: portfolio.id,
      currencyCode: 'EUR',
      setAvailableCash: '500',
      setTotalCash: '500',
    });

    const transfer = await helpers.portfolioToAccountTransfer({
      portfolioId: portfolio.id,
      payload: {
        accountId: eurAccount.id,
        amount: '200',
        currencyCode: 'EUR',
        date: '2025-06-15',
      },
      raw: true,
    });

    expect(transfer.currencyCode).toBe('EUR');

    // The income Transaction on the destination account must carry the user's
    // base currency in refCurrencyCode (NOT the account/EUR currency). A
    // regression that re-sets refCurrencyCode back to account.currencyCode
    // would silently pass any same-currency test, so this assertion is the
    // load-bearing one.
    const transactions = await helpers.getTransactions({
      accountIds: [eurAccount.id],
      raw: true,
    });
    expect(transactions.length).toBe(1);
    expect(transactions[0]!.currencyCode).toBe('EUR');
    expect(transactions[0]!.refCurrencyCode).toBe(global.BASE_CURRENCY.code);
  });

  it('should allow portfolio balance to go negative (soft tracking)', async () => {
    // Withdraw more than available (1000 in portfolio)
    const transfer = await helpers.portfolioToAccountTransfer({
      portfolioId: portfolio.id,
      payload: {
        accountId: account.id,
        amount: '1500',
        currencyCode,
        date: '2025-06-15',
      },
      raw: true,
    });

    expect(transfer.id).toEqual(expect.any(String));

    const [balance] = await helpers.getPortfolioBalance({
      portfolioId: portfolio.id,
      currencyCode,
      raw: true,
    });

    expect(balance!.availableCash).toBeNumericEqual(-500);
    expect(balance!.totalCash).toBeNumericEqual(-500);
  });

  it('should reject zero amount, unknown portfolio or account, and linking a non-income transaction', async () => {
    const zeroAmount = await helpers.portfolioToAccountTransfer({
      portfolioId: portfolio.id,
      payload: { accountId: account.id, amount: '0', currencyCode, date: '2025-06-15' },
    });
    expect(zeroAmount.statusCode).toBe(ERROR_CODES.ValidationError);

    const unknownPortfolio = await helpers.portfolioToAccountTransfer({
      portfolioId: generateRandomRecordId(),
      payload: { accountId: account.id, amount: '100', currencyCode, date: '2025-06-15' },
    });
    expect(unknownPortfolio.statusCode).toBe(ERROR_CODES.NotFoundError);

    const unknownAccount = await helpers.portfolioToAccountTransfer({
      portfolioId: portfolio.id,
      payload: { accountId: generateRandomRecordId(), amount: '100', currencyCode, date: '2025-06-15' },
    });
    expect(unknownAccount.statusCode).toBe(ERROR_CODES.NotFoundError);

    const [expenseTx] = await helpers.createTransaction({
      payload: helpers.buildTransactionPayload({
        accountId: account.id,
        amount: 500,
        transactionType: TRANSACTION_TYPES.expense,
      }),
      raw: true,
    });

    const nonIncomeLink = await helpers.portfolioToAccountTransfer({
      portfolioId: portfolio.id,
      payload: {
        accountId: account.id,
        amount: '500',
        currencyCode,
        date: '2025-06-15',
        existingTransactionId: expenseTx!.id,
      },
    });
    expect(nonIncomeLink.statusCode).toBe(ERROR_CODES.ValidationError);
  }, 30000);

  it('should not change total wealth when transferring from portfolio to account', async () => {
    // Portfolio starts with 1000 cash (from beforeEach), account starts with 0
    const accountBefore = await helpers.getAccount({ id: account.id, raw: true });
    const [portfolioBalanceBefore] = await helpers.getPortfolioBalance({
      portfolioId: portfolio.id,
      currencyCode,
      raw: true,
    });

    const totalBefore = Number(accountBefore.currentBalance) + Number(portfolioBalanceBefore!.availableCash);

    // Transfer 400 from portfolio to account
    await helpers.portfolioToAccountTransfer({
      portfolioId: portfolio.id,
      payload: {
        accountId: account.id,
        amount: '400',
        currencyCode,
        date: '2025-06-15',
      },
      raw: true,
    });

    // After transfer: portfolio should have 600, account should have +400
    const accountAfter = await helpers.getAccount({ id: account.id, raw: true });
    const [portfolioBalanceAfter] = await helpers.getPortfolioBalance({
      portfolioId: portfolio.id,
      currencyCode,
      raw: true,
    });

    const totalAfter = Number(accountAfter.currentBalance) + Number(portfolioBalanceAfter!.availableCash);

    // Total wealth should remain unchanged (money just changed placement)
    expect(totalAfter).toBeNumericEqual(totalBefore);
  });
});

import { TRANSACTION_TRANSFER_NATURE, TRANSACTION_TYPES } from '@bt/shared/types';
import { faker } from '@faker-js/faker';
import { describe, expect, it } from '@jest/globals';
import { ERROR_CODES } from '@js/errors';
import * as helpers from '@tests/helpers';

describe('link transactions between each other', () => {
  it('link two valid transactions', async () => {
    // Create 2 income and 2 expense to check that multiple updation is possible
    const accountA = await helpers.createAccount({ raw: true });
    const accountB = await helpers.createAccount({ raw: true });

    const [incomeA] = await helpers.createTransaction({
      payload: helpers.buildTransactionPayload({
        accountId: accountA.id,
        transactionType: TRANSACTION_TYPES.income,
      }),
      raw: true,
    });
    const [incomeB] = await helpers.createTransaction({
      payload: helpers.buildTransactionPayload({
        accountId: accountB.id,
        transactionType: TRANSACTION_TYPES.income,
      }),
      raw: true,
    });
    const [expenseA] = await helpers.createTransaction({
      payload: helpers.buildTransactionPayload({
        accountId: accountA.id,
        transactionType: TRANSACTION_TYPES.expense,
      }),
      raw: true,
    });
    const [expenseB] = await helpers.createTransaction({
      payload: helpers.buildTransactionPayload({
        accountId: accountB.id,
        transactionType: TRANSACTION_TYPES.expense,
      }),
      raw: true,
    });

    const linkingResult = await helpers.linkTransactions({
      payload: {
        ids: [
          [incomeA.id, expenseB.id],
          [incomeB.id, expenseA.id],
        ],
      },
      raw: true,
    });

    // Check that linkind response is coorect
    [incomeA, incomeB, expenseA, expenseB].forEach((tx) => {
      const txAfter = linkingResult.flat().find((t) => t.id === tx.id);
      // Expect that only transferNature and transferId were changed
      expect({ ...tx }).toEqual({
        ...txAfter,
        transferNature: expect.toBeAnythingOrNull(),
        transferId: expect.toBeAnythingOrNull(),
        updatedAt: expect.toBeAnythingOrNull(),
      });

      expect(txAfter!.transferNature).toBe(TRANSACTION_TRANSFER_NATURE.common_transfer);
      expect(txAfter!.transferId).toEqual(expect.any(String));
    });

    // Check that transactions fetching also returns correct result
    const txsAfterUpdation = await helpers.getTransactions({ raw: true });
    [incomeA, incomeB, expenseA, expenseB].forEach((tx) => {
      const txAfter = txsAfterUpdation.find((t) => t.id === tx.id);
      // Expect that only transferNature and transferId were changed
      expect(txAfter).toMatchObject({
        ...tx,
        transferNature: expect.toBeAnythingOrNull(),
        transferId: expect.toBeAnythingOrNull(),
        updatedAt: expect.toBeAnythingOrNull(),
      });

      expect(txAfter!.transferNature).toBe(TRANSACTION_TRANSFER_NATURE.common_transfer);
      expect(txAfter!.transferId).toEqual(expect.any(String));
    });

    expect(incomeA.transferId).toBe(expenseB.transferId);
    expect(incomeB.transferId).toBe(expenseA.transferId);
  });

  it('allows linking when transfer_out_wallet is on either side or on both', async () => {
    const accountA = await helpers.createAccount({ raw: true });
    const accountB = await helpers.createAccount({ raw: true });

    const [outOfWalletExpense] = await helpers.createTransaction({
      payload: helpers.buildTransactionPayload({
        accountId: accountA.id,
        amount: 500,
        transactionType: TRANSACTION_TYPES.expense,
        transferNature: TRANSACTION_TRANSFER_NATURE.transfer_out_wallet,
      }),
      raw: true,
    });
    const [regularIncome] = await helpers.createTransaction({
      payload: helpers.buildTransactionPayload({
        accountId: accountB.id,
        amount: 500,
        transactionType: TRANSACTION_TYPES.income,
      }),
      raw: true,
    });

    const [regularExpense] = await helpers.createTransaction({
      payload: helpers.buildTransactionPayload({
        accountId: accountA.id,
        amount: 400,
        transactionType: TRANSACTION_TYPES.expense,
      }),
      raw: true,
    });
    const [outOfWalletIncome] = await helpers.createTransaction({
      payload: helpers.buildTransactionPayload({
        accountId: accountB.id,
        amount: 400,
        transactionType: TRANSACTION_TYPES.income,
        transferNature: TRANSACTION_TRANSFER_NATURE.transfer_out_wallet,
      }),
      raw: true,
    });

    const [bothOutOfWalletExpense] = await helpers.createTransaction({
      payload: helpers.buildTransactionPayload({
        accountId: accountA.id,
        amount: 300,
        transactionType: TRANSACTION_TYPES.expense,
        transferNature: TRANSACTION_TRANSFER_NATURE.transfer_out_wallet,
      }),
      raw: true,
    });
    const [bothOutOfWalletIncome] = await helpers.createTransaction({
      payload: helpers.buildTransactionPayload({
        accountId: accountB.id,
        amount: 300,
        transactionType: TRANSACTION_TYPES.income,
        transferNature: TRANSACTION_TRANSFER_NATURE.transfer_out_wallet,
      }),
      raw: true,
    });

    const linkingResult = await helpers.linkTransactions({
      payload: {
        ids: [
          [outOfWalletExpense.id, regularIncome.id],
          [regularExpense.id, outOfWalletIncome.id],
          [bothOutOfWalletExpense.id, bothOutOfWalletIncome.id],
        ],
      },
      raw: true,
    });

    expect(linkingResult).toHaveLength(3);

    linkingResult.forEach(([linkedExpense, linkedIncome]) => {
      expect(linkedExpense.transferNature).toBe(TRANSACTION_TRANSFER_NATURE.common_transfer);
      expect(linkedIncome.transferNature).toBe(TRANSACTION_TRANSFER_NATURE.common_transfer);
      expect(linkedExpense.transferId).toBe(linkedIncome.transferId);
      expect(linkedExpense.transferId).toEqual(expect.any(String));
    });
  });

  it('allows re-linking after unlinking an out_of_wallet-originated transfer', async () => {
    const accountA = await helpers.createAccount({ raw: true });
    const accountB = await helpers.createAccount({ raw: true });
    const accountC = await helpers.createAccount({ raw: true });

    // Step 1: Create out_of_wallet expense and regular income, then link them
    const [outOfWalletExpense] = await helpers.createTransaction({
      payload: helpers.buildTransactionPayload({
        accountId: accountA.id,
        amount: 200,
        transactionType: TRANSACTION_TYPES.expense,
        transferNature: TRANSACTION_TRANSFER_NATURE.transfer_out_wallet,
      }),
      raw: true,
    });

    const [regularIncome] = await helpers.createTransaction({
      payload: helpers.buildTransactionPayload({
        accountId: accountB.id,
        amount: 200,
        transactionType: TRANSACTION_TYPES.income,
      }),
      raw: true,
    });

    const linkingResult = await helpers.linkTransactions({
      payload: {
        ids: [[outOfWalletExpense.id, regularIncome.id]],
      },
      raw: true,
    });

    const transferId = linkingResult[0]![0].transferId;
    expect(transferId).toEqual(expect.any(String));

    // Step 2: Unlink — both should become not_transfer
    const unlinkedTxs = await helpers.unlinkTransferTransactions({
      transferIds: [transferId],
      raw: true,
    });

    expect(unlinkedTxs).toHaveLength(2);
    unlinkedTxs.forEach((tx) => {
      expect(tx.transferNature).toBe(TRANSACTION_TRANSFER_NATURE.not_transfer);
      expect(tx.transferId).toBeNull();
    });

    // Step 3: Re-link the expense with a different income
    const [newIncome] = await helpers.createTransaction({
      payload: helpers.buildTransactionPayload({
        accountId: accountC.id,
        amount: 200,
        transactionType: TRANSACTION_TYPES.income,
      }),
      raw: true,
    });

    const relinkResult = await helpers.linkTransactions({
      payload: {
        ids: [[outOfWalletExpense.id, newIncome.id]],
      },
      raw: true,
    });

    expect(relinkResult).toHaveLength(1);
    const [relinkedExpense, relinkedIncome] = relinkResult[0]!;
    expect(relinkedExpense.transferNature).toBe(TRANSACTION_TRANSFER_NATURE.common_transfer);
    expect(relinkedIncome.transferNature).toBe(TRANSACTION_TRANSFER_NATURE.common_transfer);
    expect(relinkedExpense.transferId).toBe(relinkedIncome.transferId);
  });

  it('throws an error for same-account, same-type and already-a-transfer pairs', async () => {
    const accountA = await helpers.createAccount({ raw: true });
    const accountB = await helpers.createAccount({ raw: true });
    const accountC = await helpers.createAccount({ raw: true });

    const [expenseA] = await helpers.createTransaction({
      payload: helpers.buildTransactionPayload({
        accountId: accountA.id,
        transactionType: TRANSACTION_TYPES.expense,
      }),
      raw: true,
    });
    const [incomeA] = await helpers.createTransaction({
      payload: helpers.buildTransactionPayload({
        accountId: accountA.id,
        transactionType: TRANSACTION_TYPES.income,
      }),
      raw: true,
    });
    const [expenseB] = await helpers.createTransaction({
      payload: helpers.buildTransactionPayload({
        accountId: accountB.id,
        transactionType: TRANSACTION_TYPES.expense,
      }),
      raw: true,
    });
    const [incomeB] = await helpers.createTransaction({
      payload: helpers.buildTransactionPayload({
        accountId: accountB.id,
        transactionType: TRANSACTION_TYPES.income,
      }),
      raw: true,
    });

    const transferLegs = await helpers.createTransaction({
      payload: helpers.buildTransactionPayload({
        accountId: accountB.id,
        amount: 10,
        transferNature: TRANSACTION_TRANSFER_NATURE.common_transfer,
        destinationAmount: 20,
        destinationAccountId: accountC.id,
      }),
      raw: true,
    });
    const transferExpense = transferLegs.find((t) => t!.transactionType === TRANSACTION_TYPES.expense);
    const transferIncome = transferLegs.find((t) => t!.transactionType === TRANSACTION_TYPES.income);

    const sameAccount = await helpers.linkTransactions({
      payload: { ids: [[expenseA.id, incomeA.id]] },
    });
    expect(sameAccount.statusCode).toBe(ERROR_CODES.ValidationError);

    const sameExpenseType = await helpers.linkTransactions({
      payload: { ids: [[expenseA.id, expenseB.id]] },
    });
    expect(sameExpenseType.statusCode).toBe(ERROR_CODES.ValidationError);

    const sameIncomeType = await helpers.linkTransactions({
      payload: { ids: [[incomeA.id, incomeB.id]] },
    });
    expect(sameIncomeType.statusCode).toBe(ERROR_CODES.ValidationError);

    const alreadyTransferIncome = await helpers.linkTransactions({
      payload: { ids: [[expenseA.id, transferIncome!.id]] },
    });
    expect(alreadyTransferIncome.statusCode).toBe(ERROR_CODES.ValidationError);

    const alreadyTransferExpense = await helpers.linkTransactions({
      payload: { ids: [[incomeA.id, transferExpense!.id]] },
    });
    expect(alreadyTransferExpense.statusCode).toBe(ERROR_CODES.ValidationError);
  });

  it('rejects linking a refund-linked original as a transfer leg', async () => {
    const accountA = await helpers.createAccount({ raw: true });
    const accountB = await helpers.createAccount({ raw: true });

    const [expense] = await helpers.createTransaction({
      payload: helpers.buildTransactionPayload({
        accountId: accountA.id,
        amount: 100,
        transactionType: TRANSACTION_TYPES.expense,
      }),
      raw: true,
    });
    const [refund] = await helpers.createTransaction({
      payload: helpers.buildTransactionPayload({
        accountId: accountA.id,
        amount: 50,
        transactionType: TRANSACTION_TYPES.income,
      }),
      raw: true,
    });
    const [incomeB] = await helpers.createTransaction({
      payload: helpers.buildTransactionPayload({
        accountId: accountB.id,
        transactionType: TRANSACTION_TYPES.income,
      }),
      raw: true,
    });

    await helpers.createSingleRefund({ originalTxId: expense.id, refundTxId: refund.id }, true);

    const res = await helpers.linkTransactions({
      payload: { ids: [[expense.id, incomeB.id]] },
    });
    expect(res.statusCode).toBe(ERROR_CODES.ValidationError);
    expect(helpers.extractResponse(res as unknown as helpers.CustomResponse<helpers.ErrorResponse>).message).toContain(
      'cannot be transfer one',
    );

    const expenseAfter = await helpers.getTransactionById({ id: expense.id, raw: true });
    expect(expenseAfter!.transferNature).toBe(TRANSACTION_TRANSFER_NATURE.not_transfer);
  });

  it('rejects linking when the opposite leg is a refund-linked refund transaction', async () => {
    const accountA = await helpers.createAccount({ raw: true });
    const accountB = await helpers.createAccount({ raw: true });

    const [original] = await helpers.createTransaction({
      payload: helpers.buildTransactionPayload({
        accountId: accountA.id,
        amount: 100,
        transactionType: TRANSACTION_TYPES.expense,
      }),
      raw: true,
    });
    const [refundIncome] = await helpers.createTransaction({
      payload: helpers.buildTransactionPayload({
        accountId: accountA.id,
        amount: 50,
        transactionType: TRANSACTION_TYPES.income,
      }),
      raw: true,
    });
    const [unlinkedExpense] = await helpers.createTransaction({
      payload: helpers.buildTransactionPayload({
        accountId: accountB.id,
        amount: 50,
        transactionType: TRANSACTION_TYPES.expense,
      }),
      raw: true,
    });

    await helpers.createSingleRefund({ originalTxId: original.id, refundTxId: refundIncome.id }, true);

    const res = await helpers.linkTransactions({
      payload: { ids: [[unlinkedExpense.id, refundIncome.id]] },
    });
    expect(res.statusCode).toBe(ERROR_CODES.ValidationError);
    expect(helpers.extractResponse(res as unknown as helpers.CustomResponse<helpers.ErrorResponse>).message).toContain(
      'cannot be a transfer one',
    );

    const [unlinkedExpenseAfter, refundIncomeAfter] = await Promise.all([
      helpers.getTransactionById({ id: unlinkedExpense.id, raw: true }),
      helpers.getTransactionById({ id: refundIncome.id, raw: true }),
    ]);
    expect(unlinkedExpenseAfter!.transferNature).toBe(TRANSACTION_TRANSFER_NATURE.not_transfer);
    expect(refundIncomeAfter!.transferNature).toBe(TRANSACTION_TRANSFER_NATURE.not_transfer);
  });
});

describe('unlink transfer transactions', () => {
  it('unlink system transactions', async () => {
    // Firstly create two transfer transactions
    const accountA = await helpers.createAccount({ raw: true });
    const accountB = await helpers.createAccount({ raw: true });

    await helpers.createTransaction({
      payload: {
        ...helpers.buildTransactionPayload({ accountId: accountA.id }),
        transferNature: TRANSACTION_TRANSFER_NATURE.common_transfer,
        destinationAmount: faker.number.int({ max: 1000 }) * 1000,
        destinationAccountId: accountB.id,
      },
      raw: true,
    });

    await helpers.createTransaction({
      payload: {
        ...helpers.buildTransactionPayload({ accountId: accountA.id }),
        transferNature: TRANSACTION_TRANSFER_NATURE.common_transfer,
        destinationAmount: faker.number.int({ max: 1000 }) * 1000,
        destinationAccountId: accountB.id,
      },
      raw: true,
    });

    // Now unlink them
    const transactions = await helpers.getTransactions({ raw: true });
    const transferIds = transactions.map((item) => item.transferId);

    const updatedTransactions = await helpers.unlinkTransferTransactions({
      transferIds,
      raw: true,
    });

    // Test that now they're unlinked and not transfer anymore
    updatedTransactions.forEach((tx) => {
      const oppositeTx = transactions.find((item) => item.id === tx.id);

      expect(tx).toMatchObject({ transferId: null, transferNature: TRANSACTION_TRANSFER_NATURE.not_transfer });
      expect(oppositeTx).toMatchObject({
        ...tx,
        transferId: expect.toBeAnythingOrNull(),
        transferNature: expect.toBeAnythingOrNull(),
        updatedAt: expect.toBeAnythingOrNull(),
      });
    });
  });

  it('unlink external transactions', async () => {
    // Firstly create external expense + income
    await helpers.monobank.pair();
    const { transactions } = await helpers.monobank.mockTransactions();
    const expenseExternalTx = transactions.find((item) => item.transactionType === TRANSACTION_TYPES.expense);
    const incomeExternalTx = transactions.find((item) => item.transactionType === TRANSACTION_TYPES.income);

    // Now create system expense + income
    const accountA = await helpers.createAccount({ raw: true });
    const accountB = await helpers.createAccount({ raw: true });

    const [expenseSystemTx] = await helpers.createTransaction({
      payload: {
        ...helpers.buildTransactionPayload({ accountId: accountA.id }),
        transactionType: TRANSACTION_TYPES.expense,
      },
      raw: true,
    });

    const [incomeSystemTx] = await helpers.createTransaction({
      payload: {
        ...helpers.buildTransactionPayload({ accountId: accountB.id }),
        transactionType: TRANSACTION_TYPES.income,
      },
      raw: true,
    });

    // Now link 1 external with 1 system for each type
    const [updatedA, updatedB] = await helpers.linkTransactions({
      payload: {
        ids: [
          [expenseExternalTx!.id, incomeSystemTx.id],
          [incomeExternalTx!.id, expenseSystemTx.id],
        ],
      },
      raw: true,
    });

    // Test that after updation only transfer-related fields were changed for each
    // transaction
    expect(expenseExternalTx).toMatchObject({
      ...updatedA![0],
      transferNature: expect.toBeAnythingOrNull(),
      transferId: expect.toBeAnythingOrNull(),
      updatedAt: expect.toBeAnythingOrNull(),
    });
    expect(incomeSystemTx).toEqual({
      ...updatedA![1],
      transferNature: expect.toBeAnythingOrNull(),
      transferId: expect.toBeAnythingOrNull(),
      updatedAt: expect.toBeAnythingOrNull(),
    });
    expect(incomeExternalTx).toMatchObject({
      ...updatedB![0],
      transferNature: expect.toBeAnythingOrNull(),
      updatedAt: expect.toBeAnythingOrNull(),
      transferId: expect.toBeAnythingOrNull(),
    });
    expect(expenseSystemTx).toEqual({
      ...updatedB![1],
      transferNature: expect.toBeAnythingOrNull(),
      transferId: expect.toBeAnythingOrNull(),
      updatedAt: expect.toBeAnythingOrNull(),
    });

    // Now unlink all of them
    const transferIds = [...updatedA!, ...updatedB!].map((t) => t.transferId);

    const result = await helpers.unlinkTransferTransactions({
      transferIds,
      raw: true,
    });

    // After unlinking check that transactions now are COMPLETELY SAME (except updatedAt)
    [expenseExternalTx, incomeExternalTx, expenseSystemTx, incomeSystemTx].forEach((tx) => {
      const unlinked = result.find((t) => t.id === tx!.id);
      expect(unlinked).toBeDefined();
      expect(tx).toMatchObject({
        ...unlinked,
        updatedAt: expect.toBeAnythingOrNull(),
      });
    });
  });
});

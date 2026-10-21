import { TRANSACTION_TRANSFER_NATURE, TRANSACTION_TYPES } from '@bt/shared/types';
import { generateRandomRecordId } from '@common/lib/record-id-helpers';
import { afterEach, describe, expect, it } from '@jest/globals';
import { ERROR_CODES } from '@js/errors';
import * as helpers from '@tests/helpers';
import { startOfDay, subDays } from 'date-fns';

const TODAY = startOfDay(new Date());
const NORMAL_RATE_DAY = subDays(TODAY, 40);
const STRONG_RATE_DAY = subDays(TODAY, 20);
const BACK_TO_NORMAL_DAY = subDays(TODAY, 5);
const SEEDED_DATES = [NORMAL_RATE_DAY, STRONG_RATE_DAY, BACK_TO_NORMAL_DAY];

const PLN_PER_USD_NORMAL = 4;
const PLN_PER_USD_STRONG = 2;

/** One PLN is worth 1 AED on the normal days and 2 AED on `STRONG_RATE_DAY`, so the
 *  same native amount carries a different refAmount depending on the day it sits on. */
const seedDriftingPlnRates = async () => {
  await helpers.seedUsdExchangeRates({
    date: NORMAL_RATE_DAY,
    ratesPerUsd: { AED: helpers.AED_PER_USD, PLN: PLN_PER_USD_NORMAL },
  });
  await helpers.seedUsdExchangeRates({
    date: STRONG_RATE_DAY,
    ratesPerUsd: { AED: helpers.AED_PER_USD, PLN: PLN_PER_USD_STRONG },
  });
  await helpers.seedUsdExchangeRates({
    date: BACK_TO_NORMAL_DAY,
    ratesPerUsd: { AED: helpers.AED_PER_USD, PLN: PLN_PER_USD_NORMAL },
  });
};

const createPlnAccount = () =>
  helpers.createAccount({
    payload: helpers.buildAccountPayload({ currencyCode: 'PLN' }),
    raw: true,
  });

describe('Refund Transactions service', () => {
  describe('createSingleRefund with splitId', () => {
    describe('success cases', () => {
      it('links multiple partial refunds for the same split, and rejects the one that goes over', async () => {
        const account = await helpers.createAccount({ raw: true });
        const categories = await helpers.getCategoriesList();

        // Create transaction with $50 split
        const [expenseTx] = await helpers.createTransaction({
          payload: helpers.buildTransactionPayload({
            accountId: account.id,
            categoryId: categories[0]!.id,
            amount: 10000,
            transactionType: TRANSACTION_TYPES.expense,
            splits: [{ categoryId: categories[1]!.id, amount: 5000 }],
          }),
          raw: true,
        });

        const transactions = await helpers.getTransactions({
          raw: true,
          includeSplits: true,
        });
        const split = transactions![0]!.splits![0]!;

        // First partial refund: $20
        const [refundTx1] = await helpers.createTransaction({
          payload: helpers.buildTransactionPayload({
            accountId: account.id,
            categoryId: categories[1]!.id,
            amount: 2000,
            transactionType: TRANSACTION_TYPES.income,
          }),
          raw: true,
        });

        const result1 = await helpers.createSingleRefund(
          {
            originalTxId: expenseTx.id,
            refundTxId: refundTx1.id,
            splitId: split.id,
          },
          true,
        );
        expect(result1.splitId).toEqual(split.id);

        // Second partial refund: $20 (total $40, still within $50 split)
        const [refundTx2] = await helpers.createTransaction({
          payload: helpers.buildTransactionPayload({
            accountId: account.id,
            categoryId: categories[1]!.id,
            amount: 2000,
            transactionType: TRANSACTION_TYPES.income,
          }),
          raw: true,
        });

        const result2 = await helpers.createSingleRefund(
          {
            originalTxId: expenseTx.id,
            refundTxId: refundTx2.id,
            splitId: split.id,
          },
          true,
        );
        expect(result2.splitId).toEqual(split.id);

        // Third partial refund: $20 would push the total to $60, past the $50 split
        const [refundTx3] = await helpers.createTransaction({
          payload: helpers.buildTransactionPayload({
            accountId: account.id,
            categoryId: categories[1]!.id,
            amount: 2000,
            transactionType: TRANSACTION_TYPES.income,
          }),
          raw: true,
        });

        const result3 = await helpers.createSingleRefund({
          originalTxId: expenseTx.id,
          refundTxId: refundTx3.id,
          splitId: split.id,
        });

        expect(result3.statusCode).toEqual(ERROR_CODES.ValidationError);
        expect(helpers.extractResponse(result3).message).toContain(
          'Total refund amount cannot be greater than the split amount',
        );
      });

      it('allows refunds on both primary and split independently', async () => {
        const account = await helpers.createAccount({ raw: true });
        const categories = await helpers.getCategoriesList();

        // Create transaction with $100: $70 primary + $30 split
        const [expenseTx] = await helpers.createTransaction({
          payload: helpers.buildTransactionPayload({
            accountId: account.id,
            categoryId: categories[0]!.id,
            amount: 10000,
            transactionType: TRANSACTION_TYPES.expense,
            splits: [{ categoryId: categories[1]!.id, amount: 3000 }],
          }),
          raw: true,
        });

        const transactions = await helpers.getTransactions({
          raw: true,
          includeSplits: true,
        });
        const split = transactions![0]!.splits![0]!;

        // Refund $20 on the split
        const [splitRefund] = await helpers.createTransaction({
          payload: helpers.buildTransactionPayload({
            accountId: account.id,
            categoryId: categories[1]!.id,
            amount: 2000,
            transactionType: TRANSACTION_TYPES.income,
          }),
          raw: true,
        });

        const splitResult = await helpers.createSingleRefund(
          {
            originalTxId: expenseTx.id,
            refundTxId: splitRefund.id,
            splitId: split.id,
          },
          true,
        );

        expect(splitResult.originalTxId).toEqual(expenseTx.id);
        expect(splitResult.refundTxId).toEqual(splitRefund.id);
        expect(splitResult.splitId).toEqual(split.id);

        // Refund $50 on the whole transaction (primary amount)
        const [primaryRefund] = await helpers.createTransaction({
          payload: helpers.buildTransactionPayload({
            accountId: account.id,
            categoryId: categories[0]!.id,
            amount: 5000,
            transactionType: TRANSACTION_TYPES.income,
          }),
          raw: true,
        });

        // This should succeed - no splitId means targeting whole tx
        const result = await helpers.createSingleRefund(
          {
            originalTxId: expenseTx.id,
            refundTxId: primaryRefund.id,
          },
          true,
        );

        expect(result.originalTxId).toEqual(expenseTx.id);
        expect(result.splitId).toBeNull();
      });
    });

    describe('failure cases', () => {
      it('fails when refund amount exceeds split amount', async () => {
        const account = await helpers.createAccount({ raw: true });
        const categories = await helpers.getCategoriesList();

        // Create transaction with $30 split
        const [expenseTx] = await helpers.createTransaction({
          payload: helpers.buildTransactionPayload({
            accountId: account.id,
            categoryId: categories[0]!.id,
            amount: 10000,
            transactionType: TRANSACTION_TYPES.expense,
            splits: [{ categoryId: categories[1]!.id, amount: 3000 }],
          }),
          raw: true,
        });

        const transactions = await helpers.getTransactions({
          raw: true,
          includeSplits: true,
        });
        const split = transactions![0]!.splits![0]!;

        // Try to refund $50 on a $30 split
        const [refundTx] = await helpers.createTransaction({
          payload: helpers.buildTransactionPayload({
            accountId: account.id,
            categoryId: categories[1]!.id,
            amount: 5000,
            transactionType: TRANSACTION_TYPES.income,
          }),
          raw: true,
        });

        const result = await helpers.createSingleRefund({
          originalTxId: expenseTx.id,
          refundTxId: refundTx.id,
          splitId: split.id,
        });

        expect(result.statusCode).toEqual(ERROR_CODES.ValidationError);
        expect(helpers.extractResponse(result).message).toContain('cannot be greater than the split amount');
      });

      it('fails when the split does not exist, and when it belongs to a different transaction', async () => {
        const account = await helpers.createAccount({ raw: true });
        const categories = await helpers.getCategoriesList();

        // Create first transaction with a split
        await helpers.createTransaction({
          payload: helpers.buildTransactionPayload({
            accountId: account.id,
            categoryId: categories[0]!.id,
            amount: 10000,
            transactionType: TRANSACTION_TYPES.expense,
            splits: [{ categoryId: categories[1]!.id, amount: 3000 }],
          }),
          raw: true,
        });

        // Create second transaction (no splits)
        const [expenseTx2] = await helpers.createTransaction({
          payload: helpers.buildTransactionPayload({
            accountId: account.id,
            categoryId: categories[0]!.id,
            amount: 5000,
            transactionType: TRANSACTION_TYPES.expense,
          }),
          raw: true,
        });

        // Get split from first transaction
        const transactions = await helpers.getTransactions({
          raw: true,
          includeSplits: true,
        });
        const splitFromTx1 = transactions!.find((t) => t.splits && t.splits.length > 0)!.splits![0]!;

        const [refundTx] = await helpers.createTransaction({
          payload: helpers.buildTransactionPayload({
            accountId: account.id,
            categoryId: categories[1]!.id,
            amount: 2000,
            transactionType: TRANSACTION_TYPES.income,
          }),
          raw: true,
        });

        // Valid UUID format that doesn't exist in the database
        const missingSplitResult = await helpers.createSingleRefund({
          originalTxId: expenseTx2.id,
          refundTxId: refundTx.id,
          splitId: generateRandomRecordId(),
        });

        expect(missingSplitResult.statusCode).toEqual(ERROR_CODES.NotFoundError);
        expect(helpers.extractResponse(missingSplitResult).message).toContain('Split not found');

        // Try to use split from tx1 with tx2 as original
        const foreignSplitResult = await helpers.createSingleRefund({
          originalTxId: expenseTx2.id,
          refundTxId: refundTx.id,
          splitId: splitFromTx1.id,
        });

        expect(foreignSplitResult.statusCode).toEqual(ERROR_CODES.ValidationError);
        expect(helpers.extractResponse(foreignSplitResult).message).toContain(
          'does not belong to the original transaction',
        );
      });

      it('fails when splitId provided without originalTxId', async () => {
        const account = await helpers.createAccount({ raw: true });

        const [refundTx] = await helpers.createTransaction({
          payload: helpers.buildTransactionPayload({
            accountId: account.id,
            amount: 2000,
            transactionType: TRANSACTION_TYPES.income,
          }),
          raw: true,
        });

        // The guard rejects before any split lookup, so the id only has to be well-formed.
        const result = await helpers.createSingleRefund({
          originalTxId: null,
          refundTxId: refundTx.id,
          splitId: generateRandomRecordId(),
        });

        expect(result.statusCode).toEqual(ERROR_CODES.ValidationError);
        expect(helpers.extractResponse(result).message).toContain('splitId can only be provided when originalTxId');
      });
    });

    describe('unlinking and relinking refunds with splits', () => {
      it('successfully relinks refund to different split after unlinking', async () => {
        const account = await helpers.createAccount({ raw: true });
        const categories = await helpers.getCategoriesList();

        const [expenseTx] = await helpers.createTransaction({
          payload: helpers.buildTransactionPayload({
            accountId: account.id,
            categoryId: categories[0]!.id,
            amount: 10000,
            transactionType: TRANSACTION_TYPES.expense,
            splits: [
              { categoryId: categories[1]!.id, amount: 3000 },
              { categoryId: categories[2]!.id, amount: 2000 },
            ],
          }),
          raw: true,
        });

        const transactions = await helpers.getTransactions({
          raw: true,
          includeSplits: true,
        });
        const split1 = transactions![0]!.splits![0]!;
        const split2 = transactions![0]!.splits![1]!;

        const [refundTx] = await helpers.createTransaction({
          payload: helpers.buildTransactionPayload({
            accountId: account.id,
            categoryId: categories[1]!.id,
            amount: 2000,
            transactionType: TRANSACTION_TYPES.income,
          }),
          raw: true,
        });

        // Link to first split
        await helpers.createSingleRefund({
          originalTxId: expenseTx.id,
          refundTxId: refundTx.id,
          splitId: split1.id,
        });

        // Unlink
        await helpers.deleteRefund({
          originalTxId: expenseTx.id,
          refundTxId: refundTx.id,
        });

        // Relink to different split
        const result = await helpers.createSingleRefund(
          {
            originalTxId: expenseTx.id,
            refundTxId: refundTx.id,
            splitId: split2.id,
          },
          true,
        );

        expect(result.originalTxId).toEqual(expenseTx.id);
        expect(result.splitId).toEqual(split2.id);
      });
    });
  });

  describe('createSingleRefund', () => {
    describe('success cases', () => {
      it('successfully creates a refund link between two transactions', async () => {
        const account = await helpers.createAccount({ raw: true });

        const [baseTx] = await helpers.createTransaction({
          payload: helpers.buildTransactionPayload({
            accountId: account.id,
            amount: 100,
            transactionType: TRANSACTION_TYPES.expense,
          }),
          raw: true,
        });

        const [refundTx] = await helpers.createTransaction({
          payload: helpers.buildTransactionPayload({
            accountId: account.id,
            amount: 100,
            transactionType: TRANSACTION_TYPES.income,
          }),
          raw: true,
        });

        const result = await helpers.createSingleRefund(
          {
            originalTxId: baseTx.id,
            refundTxId: refundTx.id,
          },
          true,
        );

        const transactions = await helpers.getTransactions({ raw: true });

        expect(result.originalTxId).toEqual(baseTx.id);
        expect(result.refundTxId).toEqual(refundTx.id);
        expect(transactions.every((tx) => tx.refundLinked)).toBe(true);
      });

      it(`successfully creates a refund link between two transactions with different currencies when:
          – refund amount BIGGER than base tx amount
          - refund refAmount LESS than base tx amount
      `, async () => {
        const account = await helpers.createAccount({ raw: true });
        const currencyB = global.MODELS_CURRENCIES!.find((item) => item.code === 'UAH');
        const accountB = await helpers.createAccount({
          payload: {
            ...helpers.buildAccountPayload(),
            currencyCode: currencyB.code,
          },
          raw: true,
        });

        const [baseTx] = await helpers.createTransaction({
          payload: helpers.buildTransactionPayload({
            accountId: account.id,
            amount: 100,
            transactionType: TRANSACTION_TYPES.expense,
          }),
          raw: true,
        });

        const [refundTx] = await helpers.createTransaction({
          payload: helpers.buildTransactionPayload({
            accountId: accountB.id,
            amount: 200,
            transactionType: TRANSACTION_TYPES.income,
          }),
          raw: true,
        });

        const result = await helpers.createSingleRefund(
          {
            originalTxId: baseTx.id,
            refundTxId: refundTx.id,
          },
          true,
        );

        expect(baseTx.currencyCode !== refundTx.currencyCode).toBe(true);
        expect(refundTx.amount > baseTx.amount).toBe(true);
        expect(baseTx.refAmount! > refundTx.refAmount!).toBe(true);
        expect(result.originalTxId).toEqual(baseTx.id);
        expect(result.refundTxId).toEqual(refundTx.id);
      });

      it('successfully creates a cross-currency refund whose sum exceeds the original refAmount', async () => {
        const account = await helpers.createAccount({ raw: true });
        const currencyB = global.MODELS_CURRENCIES!.find((item) => item.code === 'UAH');
        const accountB = await helpers.createAccount({
          payload: {
            ...helpers.buildAccountPayload(),
            currencyCode: currencyB.code,
          },
          raw: true,
        });

        const [baseTx] = await helpers.createTransaction({
          payload: helpers.buildTransactionPayload({
            accountId: account.id,
            amount: 100,
            transactionType: TRANSACTION_TYPES.expense,
          }),
          raw: true,
        });

        // First partial refund, same currency
        const [refundTx1] = await helpers.createTransaction({
          payload: helpers.buildTransactionPayload({
            accountId: account.id,
            amount: 60,
            transactionType: TRANSACTION_TYPES.income,
          }),
          raw: true,
        });

        await helpers.createSingleRefund({
          originalTxId: baseTx.id,
          refundTxId: refundTx1.id,
        });

        // Second refund in another currency, far past the original once converted
        const [refundTx2] = await helpers.createTransaction({
          payload: helpers.buildTransactionPayload({
            accountId: accountB.id,
            amount: 10000,
            transactionType: TRANSACTION_TYPES.income,
          }),
          raw: true,
        });

        const result = await helpers.createSingleRefund(
          {
            originalTxId: baseTx.id,
            refundTxId: refundTx2.id,
          },
          true,
        );

        expect(baseTx.currencyCode !== refundTx2.currencyCode).toBe(true);
        expect(refundTx2.refAmount! > baseTx.refAmount!).toBe(true);
        expect(result.originalTxId).toEqual(baseTx.id);
        expect(result.refundTxId).toEqual(refundTx2.id);
      });

      it('successfully creates refund tx after unlinking', async () => {
        const account = await helpers.createAccount({ raw: true });

        const [baseTx] = await helpers.createTransaction({
          payload: helpers.buildTransactionPayload({
            accountId: account.id,
            amount: 100,
            transactionType: TRANSACTION_TYPES.expense,
          }),
          raw: true,
        });

        const [refundTx] = await helpers.createTransaction({
          payload: helpers.buildTransactionPayload({
            accountId: account.id,
            amount: 100,
            transactionType: TRANSACTION_TYPES.income,
          }),
          raw: true,
        });

        let creationResponse = await helpers.createSingleRefund(
          {
            originalTxId: baseTx.id,
            refundTxId: refundTx.id,
          },
          true,
        );

        expect(creationResponse.originalTxId).toEqual(baseTx.id);
        expect(creationResponse.refundTxId).toEqual(refundTx.id);

        const unlinkResponse = await helpers.deleteRefund({
          originalTxId: baseTx.id,
          refundTxId: refundTx.id,
        });

        expect(unlinkResponse.statusCode).toBe(200);

        creationResponse = await helpers.createSingleRefund(
          {
            originalTxId: baseTx.id,
            refundTxId: refundTx.id,
          },
          true,
        );

        expect(creationResponse.originalTxId).toEqual(baseTx.id);
        expect(creationResponse.refundTxId).toEqual(refundTx.id);
      });
    });

    describe('failure cases', () => {
      it('fails when trying to refund with the same transaction type', async () => {
        const account = await helpers.createAccount({ raw: true });

        const [baseTx] = await helpers.createTransaction({
          payload: helpers.buildTransactionPayload({
            accountId: account.id,
            amount: 100,
            transactionType: TRANSACTION_TYPES.expense,
          }),
          raw: true,
        });

        const [refundTx] = await helpers.createTransaction({
          payload: helpers.buildTransactionPayload({
            accountId: account.id,
            amount: 100,
            transactionType: TRANSACTION_TYPES.expense,
          }),
          raw: true,
        });

        const result = await helpers.createSingleRefund({
          originalTxId: baseTx.id,
          refundTxId: refundTx.id,
        });

        expect(result.statusCode).toEqual(ERROR_CODES.ValidationError);
        expect(helpers.extractResponse(result).message).toContain('opposite transaction type');
      });

      it('fails when trying to refund a transfer transaction', async () => {
        const account1 = await helpers.createAccount({ raw: true });
        const account2 = await helpers.createAccount({
          payload: helpers.buildAccountPayload({ userId: account1.userId }),
          raw: true,
        });

        // Create a transfer transaction
        const [baseTransferTx] = await helpers.createTransaction({
          payload: {
            ...helpers.buildTransactionPayload({
              accountId: account1.id,
              amount: 10,
              transferNature: TRANSACTION_TRANSFER_NATURE.common_transfer,
              destinationAmount: 10,
              destinationAccountId: account2.id,
            }),
          },
          raw: true,
        });

        // Attempt to create a refund for the transfer
        const [refundTx] = await helpers.createTransaction({
          payload: helpers.buildTransactionPayload({
            accountId: account2.id,
            amount: 10,
            transactionType: TRANSACTION_TYPES.income,
          }),
          raw: true,
        });

        const result = await helpers.createSingleRefund({
          originalTxId: baseTransferTx.id,
          refundTxId: refundTx.id,
        });

        expect(result.statusCode).toEqual(ERROR_CODES.ValidationError);
        expect(helpers.extractResponse(result).message).toContain('transaction cannot be transfer');
      });

      it('fails when trying to refund a refund transaction', async () => {
        const account = await helpers.createAccount({ raw: true });

        // Create an original transaction
        const [originalTx] = await helpers.createTransaction({
          payload: helpers.buildTransactionPayload({
            accountId: account.id,
            amount: 100,
            transactionType: TRANSACTION_TYPES.expense,
          }),
          raw: true,
        });

        // Create a refund transaction
        const [refundTx] = await helpers.createTransaction({
          payload: helpers.buildTransactionPayload({
            accountId: account.id,
            amount: 100,
            transactionType: TRANSACTION_TYPES.income,
          }),
          raw: true,
        });

        // Link the refund to the original transaction
        await helpers.createSingleRefund({
          originalTxId: originalTx.id,
          refundTxId: refundTx.id,
        });

        // Attempt to refund the refund transaction
        const [refundOfRefundTx] = await helpers.createTransaction({
          payload: helpers.buildTransactionPayload({
            accountId: account.id,
            amount: 100,
            transactionType: TRANSACTION_TYPES.expense,
          }),
          raw: true,
        });

        const result = await helpers.createSingleRefund({
          originalTxId: refundTx.id,
          refundTxId: refundOfRefundTx.id,
        });

        expect(result.statusCode).toEqual(ERROR_CODES.ValidationError);
        expect(helpers.extractResponse(result).message).toContain('Cannot refund a "refund" transaction');
      });

      it('fails when trying to link transcation to itself', async () => {
        const account1 = await helpers.createAccount({ raw: true });

        const [baseTx] = await helpers.createTransaction({
          payload: {
            ...helpers.buildTransactionPayload({
              accountId: account1.id,
              amount: 10,
              transactionType: TRANSACTION_TYPES.expense,
            }),
          },
          raw: true,
        });

        const result = await helpers.createSingleRefund({
          originalTxId: baseTx.id,
          refundTxId: baseTx.id,
        });

        expect(result.statusCode).toEqual(ERROR_CODES.ValidationError);
        expect(helpers.extractResponse(result).message).toContain('Attempt to link a single transaction to itself');
      });

      it('fails when trying to use the same refund transaction for multiple original transactions', async () => {
        const account = await helpers.createAccount({ raw: true });

        // Create two original transactions
        const [originalTx1] = await helpers.createTransaction({
          payload: helpers.buildTransactionPayload({
            accountId: account.id,
            amount: 100,
            transactionType: TRANSACTION_TYPES.expense,
          }),
          raw: true,
        });

        const [originalTx2] = await helpers.createTransaction({
          payload: helpers.buildTransactionPayload({
            accountId: account.id,
            amount: 50,
            transactionType: TRANSACTION_TYPES.expense,
          }),
          raw: true,
        });

        // Create a single refund transaction
        const [refundTx] = await helpers.createTransaction({
          payload: helpers.buildTransactionPayload({
            accountId: account.id,
            amount: 50,
            transactionType: TRANSACTION_TYPES.income,
          }),
          raw: true,
        });

        // Link the refund to the first original transaction (should succeed)
        await helpers.createSingleRefund({
          originalTxId: originalTx1.id,
          refundTxId: refundTx.id,
        });

        // Attempt to link the same refund to the second original transaction (should fail)
        const result = await helpers.createSingleRefund({
          originalTxId: originalTx2.id,
          refundTxId: refundTx.id,
        });

        expect(result.statusCode).toEqual(ERROR_CODES.ValidationError);
        expect(helpers.extractResponse(result).message).toContain('"refundTxId" already marked as a refund');
      });
    });

    describe('nullish originalTxId cases', () => {
      describe('success cases', () => {
        it('successfully creates multiple refund transactions without original transactions', async () => {
          const account = await helpers.createAccount({ raw: true });

          const [refundTx1] = await helpers.createTransaction({
            payload: helpers.buildTransactionPayload({
              accountId: account.id,
              amount: 50,
              transactionType: TRANSACTION_TYPES.income,
            }),
            raw: true,
          });

          const [refundTx2] = await helpers.createTransaction({
            payload: helpers.buildTransactionPayload({
              accountId: account.id,
              amount: 75,
              transactionType: TRANSACTION_TYPES.income,
            }),
            raw: true,
          });

          const result1 = await helpers.createSingleRefund(
            {
              originalTxId: null,
              refundTxId: refundTx1.id,
            },
            true,
          );

          const result2 = await helpers.createSingleRefund(
            {
              originalTxId: null,
              refundTxId: refundTx2.id,
            },
            true,
          );

          expect(result1.originalTxId).toBeNull();
          expect(result1.refundTxId).toEqual(refundTx1.id);
          expect(result2.originalTxId).toBeNull();
          expect(result2.refundTxId).toEqual(refundTx2.id);
        });
      });

      describe('failure cases', () => {
        it('fails when trying to create a refund transaction with null originalTxId and transfer nature', async () => {
          const account1 = await helpers.createAccount({ raw: true });
          const account2 = await helpers.createAccount({
            payload: helpers.buildAccountPayload({ userId: account1.userId }),
            raw: true,
          });

          const [transferTx] = await helpers.createTransaction({
            payload: {
              ...helpers.buildTransactionPayload({
                accountId: account1.id,
                amount: 100,
                transferNature: TRANSACTION_TRANSFER_NATURE.common_transfer,
                destinationAmount: 100,
                destinationAccountId: account2.id,
              }),
            },
            raw: true,
          });

          const result = await helpers.createSingleRefund({
            originalTxId: null,
            refundTxId: transferTx.id,
          });

          expect(result.statusCode).toEqual(ERROR_CODES.ValidationError);
          expect(helpers.extractResponse(result).message).toContain('Refund transaction cannot be a transfer one');
        });

        it('fails when trying to create a duplicate refund transaction with null originalTxId', async () => {
          const account = await helpers.createAccount({ raw: true });

          const [refundTx] = await helpers.createTransaction({
            payload: helpers.buildTransactionPayload({
              accountId: account.id,
              amount: 100,
              transactionType: TRANSACTION_TYPES.income,
            }),
            raw: true,
          });

          // First creation should succeed
          await helpers.createSingleRefund({
            originalTxId: null,
            refundTxId: refundTx.id,
          });

          // Second creation should fail
          const result = await helpers.createSingleRefund({
            originalTxId: null,
            refundTxId: refundTx.id,
          });

          expect(result.statusCode).toEqual(ERROR_CODES.ValidationError);
          expect(helpers.extractResponse(result).message).toContain('"refundTxId" already marked as a refund');
        });
      });
    });
  });

  describe('createSingleRefund amount cap across currencies', () => {
    afterEach(async () => {
      await helpers.clearExchangeRatesForDates({ dates: SEEDED_DATES });
    });

    describe('success cases', () => {
      it('links a same-currency refund of the full original amount when the rate drifted between the two dates', async () => {
        await seedDriftingPlnRates();
        const account = await createPlnAccount();

        const [baseTx] = await helpers.createTransaction({
          payload: helpers.buildTransactionPayload({
            accountId: account.id,
            amount: 5000,
            transactionType: TRANSACTION_TYPES.expense,
            time: NORMAL_RATE_DAY.toISOString(),
          }),
          raw: true,
        });

        const [refundTx] = await helpers.createTransaction({
          payload: helpers.buildTransactionPayload({
            accountId: account.id,
            amount: 5000,
            transactionType: TRANSACTION_TYPES.income,
            time: STRONG_RATE_DAY.toISOString(),
          }),
          raw: true,
        });

        const result = await helpers.createSingleRefund(
          {
            originalTxId: baseTx.id,
            refundTxId: refundTx.id,
          },
          true,
        );

        expect(baseTx.currencyCode).toEqual(refundTx.currencyCode);
        expect(baseTx.amount).toEqual(refundTx.amount);
        expect(refundTx.refAmount! > baseTx.refAmount!).toBe(true);
        expect(result.originalTxId).toEqual(baseTx.id);
        expect(result.refundTxId).toEqual(refundTx.id);
      });

      it('links multiple same-currency refunds summing to the original amount, and rejects the one that goes over', async () => {
        await seedDriftingPlnRates();
        const account = await createPlnAccount();

        const [baseTx] = await helpers.createTransaction({
          payload: helpers.buildTransactionPayload({
            accountId: account.id,
            amount: 5000,
            transactionType: TRANSACTION_TYPES.expense,
            time: NORMAL_RATE_DAY.toISOString(),
          }),
          raw: true,
        });

        const [refundTx1] = await helpers.createTransaction({
          payload: helpers.buildTransactionPayload({
            accountId: account.id,
            amount: 2500,
            transactionType: TRANSACTION_TYPES.income,
            time: STRONG_RATE_DAY.toISOString(),
          }),
          raw: true,
        });

        const result1 = await helpers.createSingleRefund(
          {
            originalTxId: baseTx.id,
            refundTxId: refundTx1.id,
          },
          true,
        );

        expect(result1.refundTxId).toEqual(refundTx1.id);

        const [refundTx2] = await helpers.createTransaction({
          payload: helpers.buildTransactionPayload({
            accountId: account.id,
            amount: 2500,
            transactionType: TRANSACTION_TYPES.income,
            time: STRONG_RATE_DAY.toISOString(),
          }),
          raw: true,
        });

        const result2 = await helpers.createSingleRefund(
          {
            originalTxId: baseTx.id,
            refundTxId: refundTx2.id,
          },
          true,
        );

        expect(result2.refundTxId).toEqual(refundTx2.id);

        const [refundTx3] = await helpers.createTransaction({
          payload: helpers.buildTransactionPayload({
            accountId: account.id,
            amount: 100,
            transactionType: TRANSACTION_TYPES.income,
            time: STRONG_RATE_DAY.toISOString(),
          }),
          raw: true,
        });

        const result3 = await helpers.createSingleRefund({
          originalTxId: baseTx.id,
          refundTxId: refundTx3.id,
        });

        expect(result3.statusCode).toEqual(ERROR_CODES.ValidationError);
        expect(helpers.extractResponse(result3).message).toContain('cannot be greater than');
      });

      it('links a same-currency refund of the full split amount when the rate drifted between the two dates', async () => {
        await seedDriftingPlnRates();
        const account = await createPlnAccount();
        const categories = await helpers.getCategoriesList();

        const [expenseTx] = await helpers.createTransaction({
          payload: helpers.buildTransactionPayload({
            accountId: account.id,
            categoryId: categories[0]!.id,
            amount: 5000,
            transactionType: TRANSACTION_TYPES.expense,
            time: NORMAL_RATE_DAY.toISOString(),
            splits: [{ categoryId: categories[1]!.id, amount: 3000 }],
          }),
          raw: true,
        });

        const transactions = await helpers.getTransactions({
          raw: true,
          includeSplits: true,
        });
        const split = transactions![0]!.splits![0]!;

        const [refundTx] = await helpers.createTransaction({
          payload: helpers.buildTransactionPayload({
            accountId: account.id,
            categoryId: categories[1]!.id,
            amount: 3000,
            transactionType: TRANSACTION_TYPES.income,
            time: STRONG_RATE_DAY.toISOString(),
          }),
          raw: true,
        });

        const result = await helpers.createSingleRefund(
          {
            originalTxId: expenseTx.id,
            refundTxId: refundTx.id,
            splitId: split.id,
          },
          true,
        );

        expect(refundTx.refAmount! > split.refAmount!).toBe(true);
        expect(result.originalTxId).toEqual(expenseTx.id);
        expect(result.splitId).toEqual(split.id);
      });
    });

    describe('failure cases', () => {
      it('rejects a same-currency refund over the original amount even when its refAmount is smaller', async () => {
        await seedDriftingPlnRates();
        const account = await createPlnAccount();

        const [baseTx] = await helpers.createTransaction({
          payload: helpers.buildTransactionPayload({
            accountId: account.id,
            amount: 5000,
            transactionType: TRANSACTION_TYPES.expense,
            time: STRONG_RATE_DAY.toISOString(),
          }),
          raw: true,
        });

        const [refundTx] = await helpers.createTransaction({
          payload: helpers.buildTransactionPayload({
            accountId: account.id,
            amount: 6000,
            transactionType: TRANSACTION_TYPES.income,
            time: BACK_TO_NORMAL_DAY.toISOString(),
          }),
          raw: true,
        });

        const result = await helpers.createSingleRefund({
          originalTxId: baseTx.id,
          refundTxId: refundTx.id,
        });

        expect(refundTx.amount > baseTx.amount).toBe(true);
        expect(refundTx.refAmount! < baseTx.refAmount!).toBe(true);
        expect(result.statusCode).toEqual(ERROR_CODES.ValidationError);
        expect(helpers.extractResponse(result).message).toContain('cannot be greater than');
      });
    });
  });
});

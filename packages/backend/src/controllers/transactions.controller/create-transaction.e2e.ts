import {
  CATEGORIZATION_MODE,
  CATEGORIZATION_SOURCE,
  type RecordId,
  TRANSACTION_TRANSFER_NATURE,
  TRANSACTION_TYPES,
} from '@bt/shared/types';
import { generateRandomRecordId } from '@common/lib/record-id-helpers';
import { describe, expect, it } from '@jest/globals';
import { ERROR_CODES } from '@js/errors';
import * as helpers from '@tests/helpers';

describe('Create transaction controller', () => {
  it('rejects invalid payloads (no data, negative amount, time before year 2000)', async () => {
    const account = await helpers.createAccount({ raw: true });

    const noPayload = await helpers.createTransaction({
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      payload: null as any,
      raw: false,
    });
    expect(noPayload.statusCode).toEqual(ERROR_CODES.ValidationError);

    const negativeAmount = await helpers.createTransaction({
      payload: helpers.buildTransactionPayload({
        accountId: account.id,
        amount: -100,
      }),
      raw: false,
    });
    expect(negativeAmount.statusCode).toEqual(ERROR_CODES.ValidationError);

    const timeBefore2000 = await helpers.createTransaction({
      payload: helpers.buildTransactionPayload({
        accountId: account.id,
        time: '0026-08-22T00:00:00.000Z',
      }),
      raw: false,
    });
    expect(timeBefore2000.statusCode).toEqual(ERROR_CODES.ValidationError);
  });

  it('accepts time exactly at 2000-01-01', async () => {
    const account = await helpers.createAccount({ raw: true });

    const [transaction] = await helpers.createTransaction({
      payload: helpers.buildTransactionPayload({
        accountId: account.id,
        time: '2000-01-01T00:00:00.000Z',
      }),
      raw: true,
    });

    expect(new Date(transaction.time).toISOString()).toBe('2000-01-01T00:00:00.000Z');
  });

  // A register entry that never moved money is a real transaction: Microsoft
  // Money's voided cheques import at zero, and they have to stay editable.
  it('accepts a zero amount', async () => {
    const account = await helpers.createAccount({ raw: true });

    const [transaction] = await helpers.createTransaction({
      payload: helpers.buildTransactionPayload({
        accountId: account.id,
        amount: 0,
      }),
      raw: true,
    });

    expect(Number(transaction.amount)).toBe(0);
    expect(Number(transaction.refAmount)).toBe(0);

    const account_ = await helpers.getAccount({ id: account.id, raw: true });
    expect(Number(account_.currentBalance)).toBe(0);
  });

  it('should successfully create a transaction base currency', async () => {
    const account = await helpers.createAccount({ raw: true });
    const txPayload = helpers.buildTransactionPayload({
      accountId: account.id,
    });
    const [baseTx] = await helpers.createTransaction({
      payload: txPayload,
      raw: true,
    });

    const transactions = await helpers.getTransactions({ raw: true });

    expect(baseTx.currencyCode).toBe(global.BASE_CURRENCY.code);
    expect(baseTx.currencyCode).toBe(global.BASE_CURRENCY.code);
    expect(baseTx.amount).toBe(txPayload.amount);
    expect(baseTx.refAmount).toBe(txPayload.amount);
    expect(baseTx.transactionType).toBe(txPayload.transactionType);
    expect(baseTx.transferNature).toBe(TRANSACTION_TRANSFER_NATURE.not_transfer);
    expect(baseTx).toStrictEqual(transactions![0]);
  });
  it('accepts transaction amounts above the legacy 32-bit INTEGER ceiling', async () => {
    // Regression: SequelizeDatabaseError "value … is out of range for type integer".
    // 25_000_000 decimal → 2_500_000_000 cents, above the old 2_147_483_647 cap.
    // Common for low-denomination currencies (IDR, VND).
    const LARGE_AMOUNT = 25_000_000;
    const LARGE_COMMISSION = 50_000;

    const account = await helpers.createAccount({ raw: true });

    const txPayload = helpers.buildTransactionPayload({
      accountId: account.id,
      amount: LARGE_AMOUNT,
      commissionRate: LARGE_COMMISSION,
    });
    const [baseTx] = await helpers.createTransaction({
      payload: txPayload,
      raw: true,
    });

    expect(baseTx.amount).toBe(LARGE_AMOUNT);
    expect(baseTx.refAmount).toBe(LARGE_AMOUNT);
    expect(baseTx.commissionRate).toBe(LARGE_COMMISSION);
    expect(baseTx.refCommissionRate).toBe(LARGE_COMMISSION);

    const accountAfter = await helpers.getAccount({ id: account.id, raw: true });
    // default account starts at 0 balance; expense subtracts LARGE_AMOUNT
    expect(accountAfter.currentBalance).toBe(-LARGE_AMOUNT);
  });
  it('should successfully create a transaction for account with currency different from base one', async () => {
    // Create account with non-default currency
    const currency = global.MODELS_CURRENCIES!.find((item) => item.code === 'UAH');
    await helpers.addUserCurrencies({ currencyCodes: ['UAH'] });

    const account = await helpers.createAccount({
      payload: {
        ...helpers.buildAccountPayload(),
        currencyCode: currency.code,
      },
      raw: true,
    });

    const txPayload = helpers.buildTransactionPayload({
      accountId: account.id,
    });
    const [baseTx] = await helpers.createTransaction({
      payload: txPayload,
      raw: true,
    });

    const transactions = await helpers.getTransactions({ raw: true });
    const currencyRate = (await helpers.getCurrenciesRates()).find((c) => c.baseCode === currency.code);

    expect(baseTx.currencyCode).toBe(currency.code);
    expect(baseTx.currencyCode).toBe(currency.code);
    expect(baseTx.amount).toBe(txPayload.amount);
    expect(baseTx.refAmount).toEqualRefValue(txPayload.amount * currencyRate!.rate);
    expect(baseTx.transactionType).toBe(txPayload.transactionType);
    expect(baseTx.transferNature).toBe(TRANSACTION_TRANSFER_NATURE.not_transfer);
    expect(baseTx).toStrictEqual(transactions![0]);
  });
  it('should successfully create a transfer transaction between accounts with same currency', async () => {
    const accountA = await helpers.createAccount({ raw: true });
    const accountB = await helpers.createAccount({ raw: true });

    const defaultTxPayload = helpers.buildTransactionPayload({
      accountId: accountA.id,
    });
    const txPayload = {
      ...defaultTxPayload,
      transferNature: TRANSACTION_TRANSFER_NATURE.common_transfer,
      destinationAmount: defaultTxPayload.amount,
      destinationAccountId: accountB.id,
    };
    const [baseTx, oppositeTx] = await helpers.createTransaction({
      payload: txPayload,
      raw: true,
    });

    const transactions = await helpers.getTransactions({ raw: true });

    expect(baseTx.currencyCode).toBe(global.BASE_CURRENCY.code);
    expect(baseTx.currencyCode).toBe(global.BASE_CURRENCY.code);

    expect(baseTx.amount).toBe(txPayload.amount);
    expect(oppositeTx!.amount).toBe(txPayload.amount);

    expect(baseTx.accountId).toBe(accountA.id);
    expect(oppositeTx!.accountId).toBe(accountB.id);

    expect(baseTx.refAmount).toBe(txPayload.amount);
    expect(oppositeTx!.refAmount).toBe(txPayload.amount);

    expect(baseTx.transferNature).toBe(TRANSACTION_TRANSFER_NATURE.common_transfer);
    expect(oppositeTx!.transferNature).toBe(TRANSACTION_TRANSFER_NATURE.common_transfer);

    // Make sure `transferId` is the same for both transactions
    expect(baseTx.transferId).toBe(baseTx.transferId);
    expect(oppositeTx!.transferId).toBe(baseTx.transferId);

    expect(baseTx.transactionType).toBe(txPayload.transactionType);
    expect(oppositeTx!.transactionType).toBe(
      txPayload.transactionType === TRANSACTION_TYPES.expense ? TRANSACTION_TYPES.income : TRANSACTION_TYPES.expense,
    );

    expect(transactions).toContainEqual(baseTx);
    expect(transactions).toContainEqual(oppositeTx);
  });
  it('rejects a transfer whose destination is a bank-linked account and creates neither leg', async () => {
    const { account: bankAccount } = await helpers.lunchflow.mockTransactions();
    const manualAccount = await helpers.createAccount({ raw: true });
    const listIds = async ({ accountId }: { accountId: RecordId }) =>
      (await helpers.getTransactions({ accountIds: [accountId], raw: true })).map((tx) => tx.id).toSorted();
    const bankIdsBefore = await listIds({ accountId: bankAccount.id });

    const response = await helpers.createTransaction({
      payload: {
        ...helpers.buildTransactionPayload({ accountId: manualAccount.id, amount: 10 }),
        transferNature: TRANSACTION_TRANSFER_NATURE.common_transfer,
        destinationAccountId: bankAccount.id,
        destinationAmount: 10,
      },
    });

    expect(response.statusCode).toBe(ERROR_CODES.ValidationError);
    expect(await listIds({ accountId: bankAccount.id })).toEqual(bankIdsBefore);
    expect(await listIds({ accountId: manualAccount.id })).toEqual([]);
  });

  it('should successfully create a transfer transaction between account with base and non-base currency', async () => {
    const accountA = await helpers.createAccount({ raw: true });

    const currencyB = global.MODELS_CURRENCIES!.find((item) => item.code === 'UAH');
    await helpers.addUserCurrencies({ currencyCodes: ['UAH'] });

    const accountB = await helpers.createAccount({
      payload: {
        ...helpers.buildAccountPayload(),
        currencyCode: currencyB.code,
      },
      raw: true,
    });

    const DESTINATION_AMOUNT = 5600;
    const txPayload = {
      ...helpers.buildTransactionPayload({ accountId: accountA.id }),
      transferNature: TRANSACTION_TRANSFER_NATURE.common_transfer,
      destinationAmount: DESTINATION_AMOUNT,
      destinationAccountId: accountB.id,
    };
    const [baseTx, oppositeTx] = await helpers.createTransaction({
      payload: txPayload,
      raw: true,
    });

    const transactions = await helpers.getTransactions({ raw: true });

    expect(baseTx.currencyCode).toBe(global.BASE_CURRENCY.code);
    expect(baseTx.currencyCode).toBe(global.BASE_CURRENCY.code);

    expect(oppositeTx!.currencyCode).toBe(currencyB.code);
    expect(oppositeTx!.currencyCode).toBe(currencyB.code);

    expect(baseTx.amount).toBe(txPayload.amount);
    expect(oppositeTx!.amount).toBe(DESTINATION_AMOUNT);

    expect(baseTx.accountId).toBe(accountA.id);
    expect(oppositeTx!.accountId).toBe(accountB.id);

    // if `from` is base account, then `refAmount` stays the same
    expect(baseTx.refAmount).toBe(baseTx.amount);
    expect(oppositeTx!.refAmount).toBe(baseTx.amount);

    expect(baseTx.transferNature).toBe(TRANSACTION_TRANSFER_NATURE.common_transfer);
    expect(oppositeTx!.transferNature).toBe(TRANSACTION_TRANSFER_NATURE.common_transfer);

    // Make sure `transferId` is the same for both transactions
    expect(baseTx.transferId).toBe(baseTx.transferId);
    expect(oppositeTx!.transferId).toBe(baseTx.transferId);

    expect(baseTx.transactionType).toBe(txPayload.transactionType);
    expect(oppositeTx!.transactionType).toBe(
      txPayload.transactionType === TRANSACTION_TYPES.expense ? TRANSACTION_TYPES.income : TRANSACTION_TYPES.expense,
    );

    [baseTx, oppositeTx].forEach((tx) => {
      expect(transactions).toContainEqual(tx);
    });
  });
  it('should successfully create a transfer transaction between accounts with both non-base currencies', async () => {
    const currencyA = global.MODELS_CURRENCIES!.find((item) => item.code === 'EUR');
    await helpers.addUserCurrencies({ currencyCodes: [currencyA.code] });
    const accountA = await helpers.createAccount({
      payload: {
        ...helpers.buildAccountPayload(),
        currencyCode: currencyA.code,
      },
      raw: true,
    });

    const currencyB = global.MODELS_CURRENCIES!.find((item) => item.code === 'UAH');
    await helpers.addUserCurrencies({ currencyCodes: [currencyB.code] });
    const accountB = await helpers.createAccount({
      payload: {
        ...helpers.buildAccountPayload(),
        currencyCode: currencyB.code,
      },
      raw: true,
    });

    const currencyRate = (await helpers.getCurrenciesRates()).find((c) => c.baseCode === currencyA.code);
    const oppositeCurrencyRate = (await helpers.getCurrenciesRates()).find((c) => c.baseCode === currencyB.code);

    const DESTINATION_AMOUNT = 25000;
    const txPayload = {
      ...helpers.buildTransactionPayload({ accountId: accountA.id }),
      transferNature: TRANSACTION_TRANSFER_NATURE.common_transfer,
      destinationAmount: DESTINATION_AMOUNT,
      destinationAccountId: accountB.id,
    };
    const [baseTx, oppositeTx] = await helpers.createTransaction({
      payload: txPayload,
      raw: true,
    });

    const transactions = await helpers.getTransactions({ raw: true });

    expect(baseTx.currencyCode).toBe(currencyA.code);
    expect(baseTx.currencyCode).toBe(currencyA.code);

    expect(oppositeTx!.currencyCode).toBe(currencyB.code);
    expect(oppositeTx!.currencyCode).toBe(currencyB.code);

    expect(baseTx.amount).toBe(txPayload.amount);
    expect(oppositeTx!.amount).toBe(DESTINATION_AMOUNT);

    expect(baseTx.accountId).toBe(accountA.id);
    expect(oppositeTx!.accountId).toBe(accountB.id);

    // Secondary (`to`) transfer tx always same `refAmount` as the general (`from`) tx to keep it consistent
    expect(baseTx.refAmount).toEqualRefValue(Number(baseTx.amount) * currencyRate!.rate);
    expect(oppositeTx!.refAmount).toEqualRefValue(Number(oppositeTx!.amount) * oppositeCurrencyRate!.rate);

    expect(baseTx.transferNature).toBe(TRANSACTION_TRANSFER_NATURE.common_transfer);
    expect(oppositeTx!.transferNature).toBe(TRANSACTION_TRANSFER_NATURE.common_transfer);

    // Make sure `transferId` is the same for both transactions
    expect(baseTx.transferId).toBe(baseTx.transferId);
    expect(oppositeTx!.transferId).toBe(baseTx.transferId);

    expect(baseTx.transactionType).toBe(txPayload.transactionType);
    expect(oppositeTx!.transactionType).toBe(
      txPayload.transactionType === TRANSACTION_TYPES.expense ? TRANSACTION_TYPES.income : TRANSACTION_TYPES.expense,
    );

    [baseTx, oppositeTx].forEach((tx) => {
      expect(transactions).toContainEqual(tx);
    });
  });
  describe('create transfer via linking', () => {
    it('link with system transaction', async () => {
      const accountA = await helpers.createAccount({ raw: true });
      const accountB = await helpers.createAccount({ raw: true });
      const expectedValues = {
        destinationTransaction: {
          transactionType: TRANSACTION_TYPES.income,
          accountId: accountA.id,
        },
        baseTransaction: {
          amount: 100,
          accountId: accountB.id,
        },
      };
      const txPayload = helpers.buildTransactionPayload({
        ...expectedValues.destinationTransaction,
      });
      const [destinationTx] = await helpers.createTransaction({
        payload: txPayload,
        raw: true,
      });

      const transferTxPayload = helpers.buildTransactionPayload({
        accountId: expectedValues.baseTransaction.accountId,
        amount: expectedValues.baseTransaction.amount,
        transferNature: TRANSACTION_TRANSFER_NATURE.common_transfer,
        destinationTransactionId: destinationTx.id,
      });

      const [baseTx, oppositeTx] = await helpers.createTransaction({
        payload: transferTxPayload,
        raw: true,
      });

      const transactions = await helpers.getTransactions({ raw: true });

      expect(transactions?.length).toBe(2);
      expect(baseTx.transferId).toBe(oppositeTx!.transferId);
      expect(oppositeTx!.amount).toBe(destinationTx.amount);
      expect(baseTx.amount).toBe(expectedValues.baseTransaction.amount);
      expect(baseTx.transactionType).toBe(TRANSACTION_TYPES.expense);
      expect(oppositeTx!.transactionType).toBe(expectedValues.destinationTransaction.transactionType);
    });
    it.each([[TRANSACTION_TYPES.expense], [TRANSACTION_TYPES.income]])(
      'link with external %s transaction',
      async (txType) => {
        await helpers.monobank.pair();
        const { transactions } = await helpers.monobank.mockTransactions();
        const externalTransaction = transactions.find((item) => item.transactionType === txType);
        const accountA = await helpers.createAccount({ raw: true });
        const expectedValues = {
          accountId: accountA.id,
          amount: 50,
          transactionType: txType === TRANSACTION_TYPES.expense ? TRANSACTION_TYPES.income : TRANSACTION_TYPES.expense,
        };
        const transferTxPayload = helpers.buildTransactionPayload({
          ...expectedValues,
          transferNature: TRANSACTION_TRANSFER_NATURE.common_transfer,
          destinationTransactionId: externalTransaction!.id,
        });

        const [baseTx, oppositeTx] = await helpers.createTransaction({
          payload: transferTxPayload,
          raw: true,
        });

        expect(baseTx.transferId).toBe(oppositeTx!.transferId);
        expect(oppositeTx!.amount).toBe(externalTransaction!.amount);
        expect(baseTx.amount).toBe(expectedValues.amount);
      },
    );
    it('rejects linking to a tx with the same transactionType, from the same account, or already a transfer', async () => {
      const accountA = await helpers.createAccount({ raw: true });
      const accountB = await helpers.createAccount({ raw: true });
      const accountC = await helpers.createAccount({ raw: true });

      const [destinationTx] = await helpers.createTransaction({
        payload: helpers.buildTransactionPayload({
          transactionType: TRANSACTION_TYPES.income,
          accountId: accountA.id,
        }),
        raw: true,
      });

      const defaultTxPayload = helpers.buildTransactionPayload({
        accountId: accountA.id,
      });
      const [, transferOppositeTx] = await helpers.createTransaction({
        payload: {
          ...defaultTxPayload,
          transferNature: TRANSACTION_TRANSFER_NATURE.common_transfer,
          destinationAmount: defaultTxPayload.amount,
          destinationAccountId: accountB.id,
        },
        raw: true,
      });

      const sameType = await helpers.createTransaction({
        payload: helpers.buildTransactionPayload({
          accountId: accountB.id,
          transactionType: TRANSACTION_TYPES.income,
          transferNature: TRANSACTION_TRANSFER_NATURE.common_transfer,
          destinationTransactionId: destinationTx.id,
        }),
      });
      expect(sameType.statusCode).toBe(ERROR_CODES.ValidationError);

      const sameAccount = await helpers.createTransaction({
        payload: helpers.buildTransactionPayload({
          accountId: accountA.id,
          transactionType: TRANSACTION_TYPES.expense,
          transferNature: TRANSACTION_TRANSFER_NATURE.common_transfer,
          destinationTransactionId: destinationTx.id,
        }),
      });
      expect(sameAccount.statusCode).toBe(ERROR_CODES.ValidationError);

      const alreadyTransfer = await helpers.createTransaction({
        payload: helpers.buildTransactionPayload({
          accountId: accountC.id,
          transactionType: TRANSACTION_TYPES.expense,
          transferNature: TRANSACTION_TRANSFER_NATURE.common_transfer,
          destinationTransactionId: transferOppositeTx!.id,
        }),
      });
      expect(alreadyTransfer.statusCode).toBe(ERROR_CODES.ValidationError);
    });
  });
  describe('Create refund transaction', () => {
    it('should successfully create a refund transaction', async () => {
      const account = await helpers.createAccount({ raw: true });
      const originalTxPayload = helpers.buildTransactionPayload({
        accountId: account.id,
        transactionType: TRANSACTION_TYPES.expense,
      });
      const [originalTx] = await helpers.createTransaction({
        payload: originalTxPayload,
        raw: true,
      });

      const refundTxPayload = {
        ...helpers.buildTransactionPayload({
          accountId: account.id,
          transactionType: TRANSACTION_TYPES.income,
        }),
        refundForTxId: originalTx.id,
      };
      const [refundTx] = await helpers.createTransaction({
        payload: refundTxPayload,
        raw: true,
      });

      const refundResponse = await helpers.getSingleRefund({
        originalTxId: originalTx.id,
        refundTxId: refundTx.id,
      });

      expect(refundTx.amount).toBe(refundTxPayload.amount);
      expect(refundTx.transactionType).toBe(TRANSACTION_TYPES.income);
      // Check that refund was successfully created
      expect(refundResponse.statusCode).toBe(200);
    });

    it('rejects a refund for a non-existent tx, for a transfer, or carrying a transferNature', async () => {
      const accountA = await helpers.createAccount({ raw: true });
      const accountB = await helpers.createAccount({ raw: true });

      const [originalTx] = await helpers.createTransaction({
        payload: helpers.buildTransactionPayload({
          accountId: accountA.id,
          transactionType: TRANSACTION_TYPES.expense,
        }),
        raw: true,
      });

      const [transferTx] = await helpers.createTransaction({
        payload: {
          ...helpers.buildTransactionPayload({
            accountId: accountA.id,
            transactionType: TRANSACTION_TYPES.expense,
          }),
          transferNature: TRANSACTION_TRANSFER_NATURE.common_transfer,
          destinationAmount: 100,
          destinationAccountId: accountB.id,
        },
        raw: true,
      });

      const refundTxPayload = helpers.buildTransactionPayload({
        accountId: accountA.id,
        transactionType: TRANSACTION_TYPES.income,
      });

      const nonExistentOriginal = await helpers.createTransaction({
        payload: { ...refundTxPayload, refundForTxId: generateRandomRecordId() },
      });
      expect(nonExistentOriginal.statusCode).toBe(ERROR_CODES.NotFoundError);

      const transferOriginal = await helpers.createTransaction({
        payload: { ...refundTxPayload, refundForTxId: transferTx.id },
      });
      expect(transferOriginal.statusCode).toBe(ERROR_CODES.ValidationError);

      const refundWithTransferNature = await helpers.createTransaction({
        payload: {
          ...refundTxPayload,
          refundForTxId: originalTx.id,
          transferNature: TRANSACTION_TRANSFER_NATURE.common_transfer,
        },
      });
      expect(refundWithTransferNature.statusCode).toBe(ERROR_CODES.ValidationError);
    });
  });

  describe('Payee linking', () => {
    it('stores the caller-supplied payeeId and payeeLocked on the transaction', async () => {
      const account = await helpers.createAccount({ raw: true });
      const payee = await helpers.createPayee({
        payload: helpers.buildPayeePayload({ name: 'Linked Co' }),
        raw: true,
      });

      const [unlockedTx] = await helpers.createTransaction({
        payload: {
          ...helpers.buildTransactionPayload({ accountId: account.id }),
          payeeId: payee.id,
        },
        raw: true,
      });

      expect(unlockedTx.payeeId).toBe(payee.id);
      // Without explicit payeeLocked, the row defaults to unlocked even when a
      // payee is attached — locking is a separate, intentional gesture (manual
      // override).
      expect(unlockedTx.payeeLocked).toBe(false);

      const [lockedTx] = await helpers.createTransaction({
        payload: {
          ...helpers.buildTransactionPayload({ accountId: account.id }),
          payeeId: payee.id,
          payeeLocked: true,
        },
        raw: true,
      });

      expect(lockedTx.payeeId).toBe(payee.id);
      expect(lockedTx.payeeLocked).toBe(true);
    });

    it('applies the payee defaultCategoryId according to the payee categorizationMode', async () => {
      // Every row passes a categoryId different from the payee's default, so the
      // payee_rule pass is observable: it may only overwrite the caller's category
      // when the row carries no higher-precedence categorizationMeta source.
      const account = await helpers.createAccount({ raw: true });
      const otherCategory = await helpers.addCustomCategory({
        raw: true,
        name: `Other Cat ${Date.now()}`,
        color: '#ffffff',
      });

      const cases: {
        payeeName: string;
        defaultCategoryId?: string;
        categorizationMode?: CATEGORIZATION_MODE;
        expectedCategoryId: string;
        expectedMeta?: CATEGORIZATION_SOURCE | null;
      }[] = [
        {
          payeeName: 'CatRule Co',
          defaultCategoryId: global.DEFAULT_CATEGORY_ID,
          expectedCategoryId: global.DEFAULT_CATEGORY_ID,
        },
        {
          payeeName: 'EnforceMode Co',
          defaultCategoryId: global.DEFAULT_CATEGORY_ID,
          categorizationMode: CATEGORIZATION_MODE.enforce,
          expectedCategoryId: global.DEFAULT_CATEGORY_ID,
          // The stamped source is what makes AI skip the row.
          expectedMeta: CATEGORIZATION_SOURCE.payeeRule,
        },
        {
          payeeName: 'HintMode Co',
          defaultCategoryId: global.DEFAULT_CATEGORY_ID,
          categorizationMode: CATEGORIZATION_MODE.hint,
          expectedCategoryId: global.DEFAULT_CATEGORY_ID,
          // `hint` is the "Amazon iPhone vs Garden tool" case — the Payee provides a
          // reasonable starting category, but the null meta lets AI still override it.
          expectedMeta: null,
        },
        {
          payeeName: 'OffMode Co',
          defaultCategoryId: global.DEFAULT_CATEGORY_ID,
          categorizationMode: CATEGORIZATION_MODE.off,
          expectedCategoryId: otherCategory.id,
          expectedMeta: null,
        },
        {
          payeeName: 'NoDefault Co',
          expectedCategoryId: otherCategory.id,
        },
      ];

      for (const testCase of cases) {
        const payee = await helpers.createPayee({
          payload: helpers.buildPayeePayload({
            name: testCase.payeeName,
            defaultCategoryId: testCase.defaultCategoryId,
            categorizationMode: testCase.categorizationMode,
          }),
          raw: true,
        });

        const [tx] = await helpers.createTransaction({
          payload: {
            ...helpers.buildTransactionPayload({
              accountId: account.id,
              categoryId: otherCategory.id,
            }),
            payeeId: payee.id,
          },
          raw: true,
        });

        // The payee stays linked in every mode — only the categorization side varies.
        expect(tx.payeeId).toBe(payee.id);
        expect(tx.categoryId).toBe(testCase.expectedCategoryId);

        if (testCase.expectedMeta === null) {
          expect(tx.categorizationMeta).toBeNull();
        } else if (testCase.expectedMeta) {
          expect(tx.categorizationMeta?.source).toBe(testCase.expectedMeta);
        }
      }
    }, 20000);

    it('rejects a foreign-user payeeId with 404 (cross-user injection guard)', async () => {
      // The DB FK on `Transactions.payeeId` only references `Payees(id)`, not
      // `(id, userId)`. Without the service-layer guard, any caller could
      // stamp a foreign user's Payee onto their own row. Verify the guard
      // throws NotFoundError instead of silently linking.
      const secondUser = await helpers.signUpSecondUser();
      let foreignPayeeId: RecordId | null = null;
      await helpers.asUser({
        cookies: secondUser.cookies,
        fn: async () => {
          await helpers.setBaseCurrencyForActiveUser({ currencyCode: global.BASE_CURRENCY.code });
          const payee = await helpers.createPayee({
            payload: helpers.buildPayeePayload({ name: `Foreign Co ${Date.now()}` }),
            raw: true,
          });
          foreignPayeeId = payee.id;
        },
      });

      const account = await helpers.createAccount({ raw: true });
      const result = await helpers.createTransaction({
        payload: {
          ...helpers.buildTransactionPayload({ accountId: account.id }),
          payeeId: foreignPayeeId!,
        },
        raw: false,
      });

      expect(result.statusCode).toBe(ERROR_CODES.NotFoundError);
    });
  });
});

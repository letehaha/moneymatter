import { type RecordId, TRANSACTION_TRANSFER_NATURE, TRANSACTION_TYPES, type TransactionModel } from '@bt/shared/types';
import { describe, expect, it } from '@jest/globals';
import { ERROR_CODES } from '@js/errors';
import * as helpers from '@tests/helpers';

const createTx = async ({
  amount,
  transactionType,
  accountId,
}: {
  amount: number;
  transactionType: TRANSACTION_TYPES;
  accountId?: RecordId;
}) => {
  const account = accountId ? { id: accountId } : await helpers.createAccount({ raw: true });
  const [tx] = await helpers.createTransaction({
    payload: helpers.buildTransactionPayload({ accountId: account.id, amount, transactionType }),
    raw: true,
  });
  return tx;
};

const errorMessage = ({ response }: { response: unknown }) =>
  (response as helpers.CustomResponse<{ message?: string }>).body.response?.message;

const linkAmounts = async ({ transactionId }: { transactionId: string }) =>
  (await helpers.getRefundsForTransaction({ transactionId, raw: true }))
    .map((link) => link.amount)
    .sort((a, b) => (a ?? 0) - (b ?? 0));

const getTx = async ({ id }: { id: string }) => (await helpers.getTransactionById({ id, raw: true }))!;

const listTransactions = async (params: { includeRefundedAmount?: boolean }) =>
  (await helpers.getTransactions({ raw: true, ...params })) as unknown as TransactionModel[];

const createUahIncome = async ({ amount }: { amount: number }) => {
  const uahAccount = await helpers.createAccount({
    payload: { ...helpers.buildAccountPayload(), currencyCode: 'UAH' },
    raw: true,
  });
  return createTx({ amount, transactionType: TRANSACTION_TYPES.income, accountId: uahAccount.id });
};

const createPurchaseWithSplit = async ({ amount, splitAmount }: { amount: number; splitAmount: number }) => {
  const account = await helpers.createAccount({ raw: true });
  const [primaryCategory, splitCategory] = await helpers.getCategoriesList();
  const [purchase] = await helpers.createTransaction({
    payload: helpers.buildTransactionPayload({
      accountId: account.id,
      categoryId: primaryCategory!.id,
      amount,
      transactionType: TRANSACTION_TYPES.expense,
      splits: [{ categoryId: splitCategory!.id, amount: splitAmount }],
    }),
    raw: true,
  });
  const split = (await helpers.getTransactions({ raw: true }))!.find((tx) => tx.id === purchase.id)!.splits![0]!;
  return { account, purchase, split };
};

const setupSplitRefund = async () => {
  const income = await createTx({ amount: 50, transactionType: TRANSACTION_TYPES.income });
  const purchaseA = await createTx({ amount: 30, transactionType: TRANSACTION_TYPES.expense });
  const purchaseB = await createTx({ amount: 20, transactionType: TRANSACTION_TYPES.expense });
  return { income, purchaseA, purchaseB };
};

describe('Partial refund links', () => {
  describe('POST /transactions/refund with amount', () => {
    it('splits one refund across two purchases and returns each share', async () => {
      const { income, purchaseA, purchaseB } = await setupSplitRefund();

      const first = await helpers.createSingleRefund(
        { originalTxId: purchaseA.id, refundTxId: income.id, amount: 30 },
        true,
      );
      const second = await helpers.createSingleRefund(
        { originalTxId: purchaseB.id, refundTxId: income.id, amount: 20 },
        true,
      );

      expect(first.amount).toBe(30);
      expect(second.amount).toBe(20);
      expect(await linkAmounts({ transactionId: income.id })).toEqual([20, 30]);
      expect((await getTx({ id: income.id })).refundLinked).toBe(true);
      expect((await getTx({ id: purchaseA.id })).refundLinked).toBe(true);
      expect((await getTx({ id: purchaseB.id })).refundLinked).toBe(true);
    });

    it('rejects shares that add up to more than the refund transaction', async () => {
      const { income, purchaseA, purchaseB } = await setupSplitRefund();

      await helpers.createSingleRefund({ originalTxId: purchaseA.id, refundTxId: income.id, amount: 30 }, true);
      const response = await helpers.createSingleRefund({
        originalTxId: purchaseB.id,
        refundTxId: income.id,
        amount: 30,
      });

      expect(response.statusCode).toBe(ERROR_CODES.ValidationError);
      expect(errorMessage({ response })).toContain('cannot be greater than the refund transaction amount');
      expect(await linkAmounts({ transactionId: income.id })).toEqual([30]);
    });

    it('stores a share equal to the whole refund as a whole-refund link', async () => {
      const income = await createTx({ amount: 50, transactionType: TRANSACTION_TYPES.income });
      const purchase = await createTx({ amount: 60, transactionType: TRANSACTION_TYPES.expense });

      const link = await helpers.createSingleRefund(
        { originalTxId: purchase.id, refundTxId: income.id, amount: 50 },
        true,
      );

      expect(link.amount).toBeNull();
      expect(await linkAmounts({ transactionId: income.id })).toEqual([null]);
    });

    it('rejects a zero share', async () => {
      const { income, purchaseA } = await setupSplitRefund();

      const response = await helpers.createSingleRefund({
        originalTxId: purchaseA.id,
        refundTxId: income.id,
        amount: 0,
      });

      expect(response.statusCode).toBe(ERROR_CODES.ValidationError);
    });

    it('rejects a share that rounds to zero cents', async () => {
      const { income, purchaseA } = await setupSplitRefund();

      const response = await helpers.createSingleRefund({
        originalTxId: purchaseA.id,
        refundTxId: income.id,
        amount: 0.004,
      });

      expect(response.statusCode).toBe(ERROR_CODES.ValidationError);
      expect(await linkAmounts({ transactionId: income.id })).toEqual([]);
    });

    it('rejects any second link next to a link to a purchase outside the app, in either order', async () => {
      const { income, purchaseA } = await setupSplitRefund();

      const outside = await helpers.createSingleRefund({ originalTxId: null, refundTxId: income.id });
      expect(outside.statusCode).toBe(200);

      const afterOutside = await helpers.createSingleRefund({
        originalTxId: purchaseA.id,
        refundTxId: income.id,
        amount: 10,
      });

      expect(afterOutside.statusCode).toBe(ERROR_CODES.ValidationError);
      expect(errorMessage({ response: afterOutside })).toContain('purchase outside the app');

      const other = await setupSplitRefund();

      await helpers.createSingleRefund(
        { originalTxId: other.purchaseA.id, refundTxId: other.income.id, amount: 10 },
        true,
      );
      const outsideAfterShare = await helpers.createSingleRefund({ originalTxId: null, refundTxId: other.income.id });

      expect(outsideAfterShare.statusCode).toBe(ERROR_CODES.ValidationError);
      expect(errorMessage({ response: outsideAfterShare })).toContain('purchase outside the app');
      expect(await linkAmounts({ transactionId: other.income.id })).toEqual([10]);
    });

    it('caps a same-currency share by the purchase, but not a cross-currency one', async () => {
      const { income, purchaseA } = await setupSplitRefund();

      const sameCurrency = await helpers.createSingleRefund({
        originalTxId: purchaseA.id,
        refundTxId: income.id,
        amount: 40,
      });

      expect(sameCurrency.statusCode).toBe(ERROR_CODES.ValidationError);
      expect(errorMessage({ response: sameCurrency })).toContain(
        'cannot be greater than the original transaction amount',
      );

      const uahAccount = await helpers.createAccount({
        payload: { ...helpers.buildAccountPayload(), currencyCode: 'UAH' },
        raw: true,
      });
      const uahIncome = await createTx({
        amount: 50,
        transactionType: TRANSACTION_TYPES.income,
        accountId: uahAccount.id,
      });

      expect(uahIncome.currencyCode).not.toBe(purchaseA.currencyCode);

      const crossCurrency = await helpers.createSingleRefund(
        { originalTxId: purchaseA.id, refundTxId: uahIncome.id, amount: 40 },
        true,
      );
      expect(crossCurrency.amount).toBe(40);
    });

    it('rejects any second link next to a whole-refund link, in either order', async () => {
      const { income, purchaseB } = await setupSplitRefund();
      const bigPurchase = await createTx({ amount: 60, transactionType: TRANSACTION_TYPES.expense });

      const whole = await helpers.createSingleRefund({ originalTxId: bigPurchase.id, refundTxId: income.id });
      expect(whole.statusCode).toBe(200);

      const afterWhole = await helpers.createSingleRefund({
        originalTxId: purchaseB.id,
        refundTxId: income.id,
        amount: 10,
      });

      expect(afterWhole.statusCode).toBe(ERROR_CODES.ValidationError);
      expect(errorMessage({ response: afterWhole })).toContain(
        'A whole-refund link cannot be combined with partial links',
      );
      expect(await linkAmounts({ transactionId: income.id })).toEqual([null]);

      const other = await setupSplitRefund();

      await helpers.createSingleRefund(
        { originalTxId: other.purchaseA.id, refundTxId: other.income.id, amount: 10 },
        true,
      );
      const wholeAfterShare = await helpers.createSingleRefund({
        originalTxId: other.purchaseB.id,
        refundTxId: other.income.id,
      });

      expect(wholeAfterShare.statusCode).toBe(ERROR_CODES.ValidationError);
      expect(errorMessage({ response: wholeAfterShare })).toContain(
        'A whole-refund link cannot be combined with partial links',
      );
      expect(await linkAmounts({ transactionId: other.income.id })).toEqual([10]);
    });

    it('rejects a share on a link to a purchase outside the app', async () => {
      const income = await createTx({ amount: 50, transactionType: TRANSACTION_TYPES.income });

      const response = await helpers.createSingleRefund({ originalTxId: null, refundTxId: income.id, amount: 10 });

      expect(response.statusCode).toBe(ERROR_CODES.ValidationError);
      expect(errorMessage({ response })).toContain('outside the app cannot have a partial amount');
      expect(await linkAmounts({ transactionId: income.id })).toEqual([]);
    });

    it('lets only one of two concurrent shares through when together they exceed the refund', async () => {
      const income = await createTx({ amount: 50, transactionType: TRANSACTION_TYPES.income });
      const purchaseA = await createTx({ amount: 100, transactionType: TRANSACTION_TYPES.expense });
      const purchaseB = await createTx({ amount: 100, transactionType: TRANSACTION_TYPES.expense });

      const responses = await Promise.all(
        [purchaseA, purchaseB].map((purchase) =>
          helpers.createSingleRefund({ originalTxId: purchase.id, refundTxId: income.id, amount: 30 }),
        ),
      );

      expect(responses.map((response) => response.statusCode).toSorted((a, b) => a - b)).toEqual([
        200,
        ERROR_CODES.ValidationError,
      ]);
      expect(await linkAmounts({ transactionId: income.id })).toEqual([30]);
    });

    it('rejects a second link to the same purchase when the first targets the primary and the second a split', async () => {
      const { account, purchase, split } = await createPurchaseWithSplit({ amount: 100, splitAmount: 40 });
      const income = await createTx({ amount: 50, transactionType: TRANSACTION_TYPES.income, accountId: account.id });

      await helpers.createSingleRefund({ originalTxId: purchase.id, refundTxId: income.id, amount: 10 }, true);
      const response = await helpers.createSingleRefund({
        originalTxId: purchase.id,
        refundTxId: income.id,
        splitId: split.id,
        amount: 10,
      });

      expect(response.statusCode).toBe(ERROR_CODES.ValidationError);
      expect(errorMessage({ response })).toContain('This refund is already linked to that transaction');
      const links = await helpers.getRefundsForTransaction({ transactionId: income.id, raw: true });
      expect(links).toHaveLength(1);
      expect(links[0]).toMatchObject({ originalTxId: purchase.id, splitId: null, amount: 10 });
    });

    it('rejects a second link to the same purchase when the links target different splits', async () => {
      const account = await helpers.createAccount({ raw: true });
      const [primaryCategory, splitCategoryA, splitCategoryB] = await helpers.getCategoriesList();
      const [purchase] = await helpers.createTransaction({
        payload: helpers.buildTransactionPayload({
          accountId: account.id,
          categoryId: primaryCategory!.id,
          amount: 100,
          transactionType: TRANSACTION_TYPES.expense,
          splits: [
            { categoryId: splitCategoryA!.id, amount: 30 },
            { categoryId: splitCategoryB!.id, amount: 20 },
          ],
        }),
        raw: true,
      });
      const [splitA, splitB] = (await helpers.getTransactions({ raw: true }))!.find(
        (tx) => tx.id === purchase.id,
      )!.splits!;
      const income = await createTx({ amount: 50, transactionType: TRANSACTION_TYPES.income, accountId: account.id });

      await helpers.createSingleRefund(
        { originalTxId: purchase.id, refundTxId: income.id, splitId: splitA!.id, amount: 10 },
        true,
      );
      const response = await helpers.createSingleRefund({
        originalTxId: purchase.id,
        refundTxId: income.id,
        splitId: splitB!.id,
        amount: 10,
      });

      expect(response.statusCode).toBe(ERROR_CODES.ValidationError);
      expect(errorMessage({ response })).toContain('This refund is already linked to that transaction');
      const links = await helpers.getRefundsForTransaction({ transactionId: income.id, raw: true });
      expect(links).toHaveLength(1);
      expect(links[0]).toMatchObject({ originalTxId: purchase.id, splitId: splitA!.id, amount: 10 });
    });
  });

  describe('PUT /transactions/:id with refundsTargets', () => {
    it('creates one link per target, and removes them all on null', async () => {
      const { income, purchaseA, purchaseB } = await setupSplitRefund();

      const created = await helpers.updateTransaction({
        id: income.id,
        payload: {
          refundsTargets: [
            { txId: purchaseA.id, amount: 30 },
            { txId: purchaseB.id, amount: 20 },
          ],
        },
      });

      expect(created.statusCode).toBe(200);
      expect(await linkAmounts({ transactionId: income.id })).toEqual([20, 30]);
      expect((await getTx({ id: income.id })).refundLinked).toBe(true);

      const removed = await helpers.updateTransaction({
        id: income.id,
        payload: { refundsTargets: null },
      });

      expect(removed.statusCode).toBe(200);
      expect(await linkAmounts({ transactionId: income.id })).toEqual([]);
      for (const id of [income.id, purchaseA.id, purchaseB.id]) {
        expect((await getTx({ id })).refundLinked).toBe(false);
      }
    });

    it('rejects refundsTargets combined with refundsTxId, and several targets without amounts', async () => {
      const income = await createTx({ amount: 50, transactionType: TRANSACTION_TYPES.income });
      const purchaseA = await createTx({ amount: 50, transactionType: TRANSACTION_TYPES.expense });
      const purchaseB = await createTx({ amount: 50, transactionType: TRANSACTION_TYPES.expense });

      const combined = await helpers.updateTransaction({
        id: income.id,
        payload: { refundsTxId: purchaseA.id, refundsTargets: [{ txId: purchaseB.id, amount: 20 }] },
      });
      const missingAmount = await helpers.updateTransaction({
        id: income.id,
        payload: { refundsTargets: [{ txId: purchaseA.id }, { txId: purchaseB.id, amount: 20 }] },
      });

      expect(combined.statusCode).toBe(ERROR_CODES.ValidationError);
      expect(missingAmount.statusCode).toBe(ERROR_CODES.ValidationError);
      expect(errorMessage({ response: missingAmount })).toContain(
        'A whole-refund link cannot be combined with partial links',
      );
      expect(await linkAmounts({ transactionId: income.id })).toEqual([]);
    });

    it('replaces the shares of the same targets', async () => {
      const income = await createTx({ amount: 50, transactionType: TRANSACTION_TYPES.income });
      const purchaseA = await createTx({ amount: 50, transactionType: TRANSACTION_TYPES.expense });
      const purchaseB = await createTx({ amount: 50, transactionType: TRANSACTION_TYPES.expense });

      const first = await helpers.updateTransaction({
        id: income.id,
        payload: {
          refundsTargets: [
            { txId: purchaseA.id, amount: 30 },
            { txId: purchaseB.id, amount: 20 },
          ],
        },
      });
      const second = await helpers.updateTransaction({
        id: income.id,
        payload: {
          refundsTargets: [
            { txId: purchaseA.id, amount: 25 },
            { txId: purchaseB.id, amount: 25 },
          ],
        },
      });

      expect(first.statusCode).toBe(200);
      expect(second.statusCode).toBe(200);
      expect(await linkAmounts({ transactionId: income.id })).toEqual([25, 25]);
    });

    it('links a target to a split and caps its share by the split amount', async () => {
      const { account, purchase, split } = await createPurchaseWithSplit({ amount: 100, splitAmount: 40 });
      const income = await createTx({ amount: 50, transactionType: TRANSACTION_TYPES.income, accountId: account.id });

      const accepted = await helpers.updateTransaction({
        id: income.id,
        payload: { refundsTargets: [{ txId: purchase.id, splitId: split.id, amount: 30 }] },
      });

      expect(accepted.statusCode).toBe(200);
      const links = await helpers.getRefundsForTransaction({ transactionId: income.id, raw: true });
      expect(links).toHaveLength(1);
      expect(links[0]).toMatchObject({ originalTxId: purchase.id, splitId: split.id, amount: 30 });

      const overSplit = await helpers.updateTransaction({
        id: income.id,
        payload: { refundsTargets: [{ txId: purchase.id, splitId: split.id, amount: 45 }] },
      });

      expect(overSplit.statusCode).toBe(ERROR_CODES.ValidationError);
      expect(errorMessage({ response: overSplit })).toContain('cannot be greater than the split amount');
      expect(await linkAmounts({ transactionId: income.id })).toEqual([30]);
    });

    it('rejects a share that rounds to zero cents and a repeated target', async () => {
      const { income, purchaseA, purchaseB } = await setupSplitRefund();

      const subCent = await helpers.updateTransaction({
        id: income.id,
        payload: { refundsTargets: [{ txId: purchaseA.id, amount: 0.004 }] },
      });
      const repeated = await helpers.updateTransaction({
        id: income.id,
        payload: {
          refundsTargets: [
            { txId: purchaseA.id, amount: 10 },
            { txId: purchaseA.id, amount: 10 },
            { txId: purchaseB.id, amount: 10 },
          ],
        },
      });

      expect(subCent.statusCode).toBe(ERROR_CODES.ValidationError);
      expect(repeated.statusCode).toBe(ERROR_CODES.ValidationError);
      expect(errorMessage({ response: repeated })).toContain('Each transaction can appear only once');
      expect(await linkAmounts({ transactionId: income.id })).toEqual([]);
    });

    it('keeps the existing links when one target goes over', async () => {
      const { income, purchaseA, purchaseB } = await setupSplitRefund();
      const bigPurchase = await createTx({ amount: 60, transactionType: TRANSACTION_TYPES.expense });

      const whole = await helpers.createSingleRefund({ originalTxId: bigPurchase.id, refundTxId: income.id });
      expect(whole.statusCode).toBe(200);

      const response = await helpers.updateTransaction({
        id: income.id,
        payload: {
          refundsTargets: [
            { txId: purchaseA.id, amount: 30 },
            { txId: purchaseB.id, amount: 25 },
          ],
        },
      });

      expect(response.statusCode).toBe(ERROR_CODES.ValidationError);
      expect(await linkAmounts({ transactionId: income.id })).toEqual([null]);
    });
  });

  describe('PUT /transactions/:id with refundsTxId', () => {
    it('links the refund to the given split', async () => {
      const { account, purchase, split } = await createPurchaseWithSplit({ amount: 100, splitAmount: 40 });
      const income = await createTx({ amount: 30, transactionType: TRANSACTION_TYPES.income, accountId: account.id });

      const response = await helpers.updateTransaction({
        id: income.id,
        payload: { refundsTxId: purchase.id, refundsSplitId: split.id },
      });

      expect(response.statusCode).toBe(200);
      const links = await helpers.getRefundsForTransaction({ transactionId: income.id, raw: true });
      expect(links).toHaveLength(1);
      expect(links[0]).toMatchObject({ originalTxId: purchase.id, splitId: split.id, amount: null });
    });
  });

  describe('PUT /transactions/:id with refundedByTxIds', () => {
    it('rejects a repeated refund', async () => {
      const income = await createTx({ amount: 50, transactionType: TRANSACTION_TYPES.income });
      const purchase = await createTx({ amount: 100, transactionType: TRANSACTION_TYPES.expense });

      const response = await helpers.updateTransaction({
        id: purchase.id,
        payload: { refundedByTxIds: [income.id, { txId: income.id, amount: 10 }] },
      });

      expect(response.statusCode).toBe(ERROR_CODES.ValidationError);
      expect(errorMessage({ response })).toContain('Each transaction can appear only once');
      expect(await linkAmounts({ transactionId: purchase.id })).toEqual([]);
    });

    it('keeps the share of a refund that stays linked', async () => {
      const income = await createTx({ amount: 50, transactionType: TRANSACTION_TYPES.income });
      const otherIncome = await createTx({ amount: 20, transactionType: TRANSACTION_TYPES.income });
      const purchase = await createTx({ amount: 100, transactionType: TRANSACTION_TYPES.expense });

      await helpers.createSingleRefund({ originalTxId: purchase.id, refundTxId: income.id, amount: 30 }, true);

      const response = await helpers.updateTransaction({
        id: purchase.id,
        payload: { refundedByTxIds: [income.id, otherIncome.id] },
      });

      expect(response.statusCode).toBe(200);
      const links = await helpers.getRefundsForTransaction({ transactionId: purchase.id, raw: true });
      expect(links.find((link) => link.refundTxId === income.id)!.amount).toBe(30);
      expect(links.find((link) => link.refundTxId === otherIncome.id)!.amount).toBeNull();
    });

    it('drops unlisted refunds and keeps the share and split of a listed one', async () => {
      const { account, purchase, split } = await createPurchaseWithSplit({ amount: 100, splitAmount: 40 });
      const shareRefund = await createTx({
        amount: 50,
        transactionType: TRANSACTION_TYPES.income,
        accountId: account.id,
      });
      const wholeRefund = await createTx({
        amount: 20,
        transactionType: TRANSACTION_TYPES.income,
        accountId: account.id,
      });

      await helpers.createSingleRefund(
        { originalTxId: purchase.id, refundTxId: shareRefund.id, splitId: split.id, amount: 30 },
        true,
      );
      await helpers.createSingleRefund({ originalTxId: purchase.id, refundTxId: wholeRefund.id }, true);

      const response = await helpers.updateTransaction({
        id: purchase.id,
        payload: { refundedByTxIds: [shareRefund.id] },
      });

      expect(response.statusCode).toBe(200);
      const links = await helpers.getRefundsForTransaction({ transactionId: purchase.id, raw: true });
      expect(links).toHaveLength(1);
      expect(links[0]).toMatchObject({ refundTxId: shareRefund.id, splitId: split.id, amount: 30 });
      expect((await getTx({ id: wholeRefund.id })).refundLinked).toBe(false);
      expect((await getTx({ id: purchase.id })).refundLinked).toBe(true);
    });

    it('re-checks the listed refunds against the updated transaction type', async () => {
      const income = await createTx({ amount: 50, transactionType: TRANSACTION_TYPES.income });
      const purchase = await createTx({ amount: 100, transactionType: TRANSACTION_TYPES.expense });

      await helpers.createSingleRefund({ originalTxId: purchase.id, refundTxId: income.id, amount: 30 }, true);

      const response = await helpers.updateTransaction({
        id: purchase.id,
        payload: { transactionType: TRANSACTION_TYPES.income, refundedByTxIds: [income.id] },
      });

      expect(response.statusCode).toBe(ERROR_CODES.ValidationError);
      expect(errorMessage({ response })).toContain('opposite transaction type');
      expect((await getTx({ id: purchase.id })).transactionType).toBe(TRANSACTION_TYPES.expense);
      expect(await linkAmounts({ transactionId: purchase.id })).toEqual([30]);
    });
  });

  describe('editing a linked transaction', () => {
    it('rejects shrinking the refund below its shares, and a purchase below its share', async () => {
      const { income, purchaseA, purchaseB } = await setupSplitRefund();

      await helpers.createSingleRefund({ originalTxId: purchaseA.id, refundTxId: income.id, amount: 30 }, true);
      await helpers.createSingleRefund({ originalTxId: purchaseB.id, refundTxId: income.id, amount: 20 }, true);

      const shrinkRefund = await helpers.updateTransaction({ id: income.id, payload: { amount: 40 } });

      expect(shrinkRefund.statusCode).toBe(ERROR_CODES.ValidationError);
      expect((await getTx({ id: income.id })).amount).toBe(50);

      const shrinkPurchase = await helpers.updateTransaction({ id: purchaseA.id, payload: { amount: 20 } });

      expect(shrinkPurchase.statusCode).toBe(ERROR_CODES.ValidationError);
      expect((await getTx({ id: purchaseA.id })).amount).toBe(30);

      const growRefund = await helpers.updateTransaction({ id: income.id, payload: { amount: 60 } });

      expect(growRefund.statusCode).toBe(200);
      expect(await linkAmounts({ transactionId: income.id })).toEqual([20, 30]);
    });

    it('rejects shrinking a split below the shares linked to it', async () => {
      const { account, purchase, split } = await createPurchaseWithSplit({ amount: 100, splitAmount: 40 });
      const income = await createTx({ amount: 50, transactionType: TRANSACTION_TYPES.income, accountId: account.id });

      await helpers.createSingleRefund(
        { originalTxId: purchase.id, refundTxId: income.id, splitId: split.id, amount: 30 },
        true,
      );

      const response = await helpers.updateTransaction({
        id: purchase.id,
        payload: { splits: [{ categoryId: split.categoryId, amount: 20 }] },
      });

      expect(response.statusCode).toBe(ERROR_CODES.ValidationError);
      expect(errorMessage({ response })).toContain('cannot be greater than the split amount');
      const splits = (await helpers.getTransactions({ raw: true }))!.find((tx) => tx.id === purchase.id)!.splits!;
      expect(splits.map((item) => item.amount)).toEqual([40]);
    });

    it('rejects changing a linked refund to the type of its original', async () => {
      const income = await createTx({ amount: 50, transactionType: TRANSACTION_TYPES.income });
      const purchase = await createTx({ amount: 100, transactionType: TRANSACTION_TYPES.expense });

      await helpers.createSingleRefund({ originalTxId: purchase.id, refundTxId: income.id, amount: 30 }, true);

      const response = await helpers.updateTransaction({
        id: income.id,
        payload: { transactionType: TRANSACTION_TYPES.expense },
      });

      expect(response.statusCode).toBe(ERROR_CODES.ValidationError);
      expect(errorMessage({ response })).toContain('opposite transaction type');
      expect((await getTx({ id: income.id })).transactionType).toBe(TRANSACTION_TYPES.income);
    });

    it('re-checks a cross-currency link when the refund moves to the purchase currency', async () => {
      const purchase = await createTx({ amount: 30, transactionType: TRANSACTION_TYPES.expense });
      const uahAccount = await helpers.createAccount({
        payload: { ...helpers.buildAccountPayload(), currencyCode: 'UAH' },
        raw: true,
      });
      const sameCurrencyAccount = await helpers.createAccount({ raw: true });
      const income = await createTx({
        amount: 50,
        transactionType: TRANSACTION_TYPES.income,
        accountId: uahAccount.id,
      });

      expect(sameCurrencyAccount.currencyCode).toBe(purchase.currencyCode);
      expect(income.currencyCode).not.toBe(purchase.currencyCode);

      const linked = await helpers.createSingleRefund({ originalTxId: purchase.id, refundTxId: income.id });
      expect(linked.statusCode).toBe(200);

      const response = await helpers.updateTransaction({
        id: income.id,
        payload: { accountId: sameCurrencyAccount.id },
      });

      expect(response.statusCode).toBe(ERROR_CODES.ValidationError);
      expect(errorMessage({ response })).toContain(
        'Total refund amount cannot be greater than the original transaction amount',
      );
      expect((await getTx({ id: income.id })).accountId).toBe(uahAccount.id);
      expect(await linkAmounts({ transactionId: income.id })).toEqual([null]);
    });

    it('rejects turning a linked original into a transfer', async () => {
      const income = await createTx({ amount: 50, transactionType: TRANSACTION_TYPES.income });
      const purchase = await createTx({ amount: 100, transactionType: TRANSACTION_TYPES.expense });
      const destination = await helpers.createAccount({ raw: true });

      await helpers.createSingleRefund({ originalTxId: purchase.id, refundTxId: income.id, amount: 30 }, true);

      const response = await helpers.updateTransaction({
        id: purchase.id,
        payload: {
          transferNature: TRANSACTION_TRANSFER_NATURE.common_transfer,
          destinationAmount: 100,
          destinationAccountId: destination.id,
        },
      });

      expect(response.statusCode).toBe(ERROR_CODES.ValidationError);
      expect(errorMessage({ response })).toContain('cannot be transfer one');
      expect((await getTx({ id: purchase.id })).transferNature).toBe(TRANSACTION_TRANSFER_NATURE.not_transfer);
      expect(await linkAmounts({ transactionId: purchase.id })).toEqual([30]);
    });
  });

  describe('PUT /transactions/:id with refundedByTxIds amounts', () => {
    it('stores the amount given for a refund', async () => {
      const income = await createTx({ amount: 50, transactionType: TRANSACTION_TYPES.income });
      const purchase = await createTx({ amount: 100, transactionType: TRANSACTION_TYPES.expense });

      const response = await helpers.updateTransaction({
        id: purchase.id,
        payload: { refundedByTxIds: [{ txId: income.id, amount: 30 }] },
      });

      expect(response.statusCode).toBe(200);
      expect(await linkAmounts({ transactionId: purchase.id })).toEqual([30]);
      expect((await getTx({ id: purchase.id })).refundLinked).toBe(true);
    });

    it('accepts bare ids next to objects', async () => {
      const income = await createTx({ amount: 50, transactionType: TRANSACTION_TYPES.income });
      const otherIncome = await createTx({ amount: 20, transactionType: TRANSACTION_TYPES.income });
      const purchase = await createTx({ amount: 100, transactionType: TRANSACTION_TYPES.expense });

      const response = await helpers.updateTransaction({
        id: purchase.id,
        payload: { refundedByTxIds: [otherIncome.id, { txId: income.id, amount: 10 }] },
      });

      expect(response.statusCode).toBe(200);
      const links = await helpers.getRefundsForTransaction({ transactionId: purchase.id, raw: true });
      expect(links.find((link) => link.refundTxId === otherIncome.id)!.amount).toBeNull();
      expect(links.find((link) => link.refundTxId === income.id)!.amount).toBe(10);
    });

    it('rejects an amount larger than a same-currency purchase', async () => {
      const income = await createTx({ amount: 50, transactionType: TRANSACTION_TYPES.income });
      const purchase = await createTx({ amount: 30, transactionType: TRANSACTION_TYPES.expense });

      const response = await helpers.updateTransaction({
        id: purchase.id,
        payload: { refundedByTxIds: [{ txId: income.id, amount: 40 }] },
      });

      expect(response.statusCode).toBe(ERROR_CODES.ValidationError);
      expect(errorMessage({ response })).toContain('cannot be greater than the original transaction amount');
      expect(await linkAmounts({ transactionId: purchase.id })).toEqual([]);
    });

    it('keeps the previous share of a refund split across purchases when re-listed without an amount', async () => {
      const { income, purchaseA, purchaseB } = await setupSplitRefund();

      await helpers.createSingleRefund({ originalTxId: purchaseA.id, refundTxId: income.id, amount: 30 }, true);
      await helpers.createSingleRefund({ originalTxId: purchaseB.id, refundTxId: income.id, amount: 20 }, true);

      const response = await helpers.updateTransaction({
        id: purchaseA.id,
        payload: { refundedByTxIds: [{ txId: income.id }] },
      });

      expect(response.statusCode).toBe(200);
      expect(await linkAmounts({ transactionId: income.id })).toEqual([20, 30]);
    });

    it('links the whole refund for a null amount', async () => {
      const income = await createTx({ amount: 50, transactionType: TRANSACTION_TYPES.income });
      const purchase = await createTx({ amount: 100, transactionType: TRANSACTION_TYPES.expense });

      await helpers.createSingleRefund({ originalTxId: purchase.id, refundTxId: income.id, amount: 30 }, true);

      const response = await helpers.updateTransaction({
        id: purchase.id,
        payload: { refundedByTxIds: [{ txId: income.id, amount: null }] },
      });

      expect(response.statusCode).toBe(200);
      expect(await linkAmounts({ transactionId: purchase.id })).toEqual([null]);
    });

    it('rejects a null amount when the whole refund exceeds the purchase', async () => {
      const income = await createTx({ amount: 50, transactionType: TRANSACTION_TYPES.income });
      const purchase = await createTx({ amount: 40, transactionType: TRANSACTION_TYPES.expense });

      await helpers.createSingleRefund({ originalTxId: purchase.id, refundTxId: income.id, amount: 30 }, true);

      const response = await helpers.updateTransaction({
        id: purchase.id,
        payload: { refundedByTxIds: [{ txId: income.id, amount: null }] },
      });

      expect(response.statusCode).toBe(ERROR_CODES.ValidationError);
      expect(errorMessage({ response })).toContain('cannot be greater than the original transaction amount');
      expect(await linkAmounts({ transactionId: purchase.id })).toEqual([30]);
    });
  });

  describe('POST /transactions with refundForAmount', () => {
    it('links the given share of the new refund', async () => {
      const purchase = await createTx({ amount: 100, transactionType: TRANSACTION_TYPES.expense });
      const account = await helpers.createAccount({ raw: true });

      const response = await helpers.createTransaction({
        payload: helpers.buildTransactionPayload({
          accountId: account.id,
          amount: 50,
          transactionType: TRANSACTION_TYPES.income,
          refundForTxId: purchase.id,
          refundForAmount: 30,
        }),
      });

      expect(response.statusCode).toBe(200);
      expect(await linkAmounts({ transactionId: purchase.id })).toEqual([30]);
    });

    it('rejects refundForAmount without refundForTxId', async () => {
      const account = await helpers.createAccount({ raw: true });

      const response = await helpers.createTransaction({
        payload: helpers.buildTransactionPayload({
          accountId: account.id,
          amount: 50,
          transactionType: TRANSACTION_TYPES.income,
          refundForAmount: 30,
        }),
      });

      expect(response.statusCode).toBe(ERROR_CODES.ValidationError);
    });

    it('rejects a refundForAmount that rounds to zero cents and creates no transaction', async () => {
      const purchase = await createTx({ amount: 100, transactionType: TRANSACTION_TYPES.expense });
      const account = await helpers.createAccount({ raw: true });

      const response = await helpers.createTransaction({
        payload: helpers.buildTransactionPayload({
          accountId: account.id,
          amount: 50,
          transactionType: TRANSACTION_TYPES.income,
          refundForTxId: purchase.id,
          refundForAmount: 0.004,
        }),
      });

      expect(response.statusCode).toBe(ERROR_CODES.ValidationError);
      expect((await listTransactions({})).filter((tx) => tx.accountId === account.id)).toEqual([]);
      expect(await linkAmounts({ transactionId: purchase.id })).toEqual([]);
    });

    it('rejects a whole refund larger than a same-currency purchase', async () => {
      const purchase = await createTx({ amount: 30, transactionType: TRANSACTION_TYPES.expense });
      const account = await helpers.createAccount({ raw: true });

      const response = await helpers.createTransaction({
        payload: helpers.buildTransactionPayload({
          accountId: account.id,
          amount: 50,
          transactionType: TRANSACTION_TYPES.income,
          refundForTxId: purchase.id,
        }),
      });

      expect(response.statusCode).toBe(ERROR_CODES.ValidationError);
      expect(errorMessage({ response })).toContain('cannot be greater than the original transaction amount');
      expect(await linkAmounts({ transactionId: purchase.id })).toEqual([]);
    });
  });

  describe('GET /transactions with includeRefundedAmount', () => {
    it('sums the whole and partial same-currency refunds linked to a purchase', async () => {
      const purchase = await createTx({ amount: 100, transactionType: TRANSACTION_TYPES.expense });
      const untouched = await createTx({ amount: 100, transactionType: TRANSACTION_TYPES.expense });
      const wholeRefund = await createTx({ amount: 60, transactionType: TRANSACTION_TYPES.income });
      const shareRefund = await createTx({ amount: 50, transactionType: TRANSACTION_TYPES.income });

      await helpers.createSingleRefund({ originalTxId: purchase.id, refundTxId: wholeRefund.id }, true);
      await helpers.createSingleRefund({ originalTxId: purchase.id, refundTxId: shareRefund.id, amount: 15 }, true);

      const transactions = await listTransactions({ includeRefundedAmount: true });

      expect(transactions.find((tx) => tx.id === purchase.id)!.refundedAmount).toBe(75);
      expect(transactions.find((tx) => tx.id === untouched.id)!.refundedAmount).toBe(0);
    });

    it('leaves out refunds in another currency', async () => {
      const purchase = await createTx({ amount: 100, transactionType: TRANSACTION_TYPES.expense });
      const sameCurrencyRefund = await createTx({ amount: 50, transactionType: TRANSACTION_TYPES.income });
      const uahRefund = await createUahIncome({ amount: 50 });

      await helpers.createSingleRefund(
        { originalTxId: purchase.id, refundTxId: sameCurrencyRefund.id, amount: 20 },
        true,
      );
      await helpers.createSingleRefund({ originalTxId: purchase.id, refundTxId: uahRefund.id, amount: 40 }, true);

      const transactions = await listTransactions({ includeRefundedAmount: true });

      expect(transactions.find((tx) => tx.id === purchase.id)!.refundedAmount).toBe(20);
    });

    it('reports split-level amounts and the total on the transaction', async () => {
      const { account, purchase, split } = await createPurchaseWithSplit({ amount: 100, splitAmount: 40 });
      const splitRefund = await createTx({
        amount: 50,
        transactionType: TRANSACTION_TYPES.income,
        accountId: account.id,
      });
      const txRefund = await createTx({ amount: 50, transactionType: TRANSACTION_TYPES.income, accountId: account.id });

      await helpers.createSingleRefund(
        { originalTxId: purchase.id, refundTxId: splitRefund.id, splitId: split.id, amount: 30 },
        true,
      );
      await helpers.createSingleRefund({ originalTxId: purchase.id, refundTxId: txRefund.id, amount: 10 }, true);

      const withSplits = (await listTransactions({ includeRefundedAmount: true })).find((tx) => tx.id === purchase.id)!;

      expect(withSplits.refundedAmount).toBe(40);
      expect(withSplits.splits!.find((item) => item.id === split.id)!.refundedAmount).toBe(30);
    });

    it('omits the field without the flag', async () => {
      const purchase = await createTx({ amount: 100, transactionType: TRANSACTION_TYPES.expense });
      const income = await createTx({ amount: 50, transactionType: TRANSACTION_TYPES.income });

      await helpers.createSingleRefund({ originalTxId: purchase.id, refundTxId: income.id, amount: 30 }, true);

      const tx = (await listTransactions({})).find((item) => item.id === purchase.id)!;

      expect(tx).not.toHaveProperty('refundedAmount');
    });

    it('returns refunded amounts on refund recommendations', async () => {
      const account = await helpers.createAccount({ raw: true });
      const purchase = await createTx({
        amount: 100,
        transactionType: TRANSACTION_TYPES.expense,
        accountId: account.id,
      });
      const income = await createTx({ amount: 50, transactionType: TRANSACTION_TYPES.income });

      await helpers.createSingleRefund({ originalTxId: purchase.id, refundTxId: income.id, amount: 30 }, true);

      const recommendations = await helpers.getRefundRecommendations({
        transactionType: TRANSACTION_TYPES.income,
        originAmount: 100,
        accountId: account.id,
        includeRefundedAmount: true,
        raw: true,
      });

      expect(recommendations.find((tx) => tx.id === purchase.id)!.refundedAmount).toBe(30);
    });
  });

  describe('GET /transactions/:id/refunds refundedAmount', () => {
    it('returns the total refunded amount on the original transaction', async () => {
      const account = await helpers.createAccount({ raw: true });
      const purchase = await createTx({
        amount: 100,
        transactionType: TRANSACTION_TYPES.expense,
        accountId: account.id,
      });
      const refundA = await createTx({ amount: 60, transactionType: TRANSACTION_TYPES.income, accountId: account.id });
      const refundB = await createTx({ amount: 50, transactionType: TRANSACTION_TYPES.income, accountId: account.id });

      await helpers.createSingleRefund({ originalTxId: purchase.id, refundTxId: refundA.id }, true);
      await helpers.createSingleRefund({ originalTxId: purchase.id, refundTxId: refundB.id, amount: 15 }, true);

      const [link] = await helpers.getRefundsForTransaction({ transactionId: refundA.id, raw: true });

      expect(link!.originalTransaction!.refundedAmount).toBe(75);
    });

    it('returns split-level refunded amounts on the original transaction splits', async () => {
      const { account, purchase, split } = await createPurchaseWithSplit({ amount: 100, splitAmount: 40 });
      const refund = await createTx({ amount: 50, transactionType: TRANSACTION_TYPES.income, accountId: account.id });

      await helpers.createSingleRefund(
        { originalTxId: purchase.id, refundTxId: refund.id, splitId: split.id, amount: 30 },
        true,
      );

      const [link] = await helpers.getRefundsForTransaction({ transactionId: refund.id, raw: true });

      expect(link!.originalTransaction!.refundedAmount).toBe(30);
      expect(link!.originalTransaction!.splits!.find((item) => item.id === split.id)!.refundedAmount).toBe(30);
    });
  });
});

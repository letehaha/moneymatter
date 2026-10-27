import {
  type PaymentLegInput,
  type RecordId,
  RESOURCE_TYPES,
  SHARE_PERMISSIONS,
  TRANSACTION_TRANSFER_NATURE,
  TRANSACTION_TYPES,
} from '@bt/shared/types';
import { describe, expect, it } from '@jest/globals';
import { ERROR_CODES } from '@js/errors';
import type Accounts from '@models/accounts.model';
import * as helpers from '@tests/helpers';
import { randomUUID } from 'crypto';

const balanceOf = async ({ id }: { id: string }) =>
  Number((await helpers.getAccount({ id, raw: true })).currentBalance);

const createManualAccounts = async ({ count }: { count: number }) => {
  const accounts: Accounts[] = [];
  for (let i = 0; i < count; i++) {
    accounts.push(
      await helpers.createAccount({ payload: helpers.buildAccountPayload({ initialBalance: 1000 }), raw: true }),
    );
  }
  return accounts;
};

const createPayment = async ({
  mainAccountId,
  legs,
  amount = 70,
  transactionType = TRANSACTION_TYPES.expense,
}: {
  mainAccountId: RecordId;
  legs: PaymentLegInput[];
  amount?: number;
  transactionType?: TRANSACTION_TYPES;
}) => {
  const [main] = await helpers.createTransaction({
    payload: helpers.buildTransactionPayload({
      accountId: mainAccountId,
      amount,
      transactionType,
      note: 'Esselunga',
      paymentLegs: legs,
    }),
    raw: true,
  });
  return main;
};

const legsOf = async ({ accountId }: { accountId: string }) =>
  (await helpers.getTransactions({ accountIds: [accountId], raw: true }))!.filter((tx) => tx.paymentParentId);

describe('Multi-account payments', () => {
  it('creates a main row plus a linked row, each moving its own account', async () => {
    const [card, voucher] = await createManualAccounts({ count: 2 });
    const tag = await helpers.createTag({ payload: { name: 'food', color: '#000000' }, raw: true });

    const [main] = await helpers.createTransaction({
      payload: helpers.buildTransactionPayload({
        accountId: card!.id,
        amount: 70,
        note: 'Esselunga',
        tagIds: [tag.id],
        paymentLegs: [{ accountId: voucher!.id, amount: 30 }],
      }),
      raw: true,
    });

    expect(await balanceOf({ id: card!.id })).toBe(930);
    expect(await balanceOf({ id: voucher!.id })).toBe(970);

    const list = (await helpers.getTransactions({ raw: true }))!;
    expect(list).toHaveLength(1);
    expect(list[0]!.id).toBe(main.id);
    expect(list[0]!.paymentTotal).toBe(100);
    expect(list[0]!.paymentParts).toEqual([
      {
        transactionId: main.id,
        accountId: card!.id,
        amount: 70,
        currencyCode: card!.currencyCode,
        paymentAmount: 70,
        isLinked: false,
      },
      expect.objectContaining({ accountId: voucher!.id, amount: 30, paymentAmount: 30, isLinked: false }),
    ]);

    const voucherRows = (await helpers.getTransactions({ accountIds: [voucher!.id], includeTags: true, raw: true }))!;
    expect(voucherRows).toHaveLength(1);
    const leg = voucherRows[0]!;
    expect(leg).toMatchObject({
      paymentParentId: main.id,
      amount: 30,
      categoryId: main.categoryId,
      note: 'Esselunga',
      transactionType: TRANSACTION_TYPES.expense,
    });
    expect(leg.paymentTotal).toBeUndefined();
    expect(leg.paymentParts).toHaveLength(2);
    expect(leg.tags!.map((item) => item.id)).toEqual([tag.id]);

    const detail = (await helpers.getTransactionById({ id: leg.id, raw: true }))!;
    expect(detail.paymentParentId).toBe(main.id);
    expect(detail.paymentParts).toHaveLength(2);
  });

  it('leaves rows outside payments untouched', async () => {
    const [account] = await createManualAccounts({ count: 1 });
    await helpers.createTransaction({
      payload: helpers.buildTransactionPayload({ accountId: account!.id }),
      raw: true,
    });

    const [tx] = (await helpers.getTransactions({ raw: true }))!;
    expect(tx!.paymentParentId).toBeNull();
    expect(tx!.paymentParts).toBeUndefined();
    expect(tx!.paymentTotal).toBeUndefined();
  });

  it('splits an income across accounts', async () => {
    const [checking, savings] = await createManualAccounts({ count: 2 });

    await createPayment({
      mainAccountId: checking!.id,
      amount: 4000,
      transactionType: TRANSACTION_TYPES.income,
      legs: [{ accountId: savings!.id, amount: 1000 }],
    });

    expect(await balanceOf({ id: checking!.id })).toBe(5000);
    expect(await balanceOf({ id: savings!.id })).toBe(2000);
  });

  it('copies main-row edits to the linked rows and replaces them by account', async () => {
    const [card, voucher, cash] = await createManualAccounts({ count: 3 });
    const main = await createPayment({ mainAccountId: card!.id, legs: [{ accountId: voucher!.id, amount: 30 }] });
    const category = await helpers.addCustomCategory({ name: 'Groceries', color: '#00ff00', raw: true });

    await helpers.updateTransaction({
      id: main.id,
      payload: { note: 'Weekly shop', categoryId: category.id },
      raw: true,
    });
    expect((await legsOf({ accountId: voucher!.id }))[0]).toMatchObject({
      note: 'Weekly shop',
      categoryId: category.id,
    });
    expect(await balanceOf({ id: card!.id })).toBe(930);
    expect(await balanceOf({ id: voucher!.id })).toBe(970);

    await helpers.updateTransaction({
      id: main.id,
      payload: {
        paymentLegs: [
          { accountId: voucher!.id, amount: 25 },
          { accountId: cash!.id, amount: 5 },
        ],
      },
      raw: true,
    });
    expect(await balanceOf({ id: voucher!.id })).toBe(975);
    expect(await balanceOf({ id: cash!.id })).toBe(995);
    expect((await helpers.getTransactions({ raw: true }))![0]!.paymentTotal).toBe(100);

    await helpers.updateTransaction({ id: main.id, payload: { paymentLegs: null }, raw: true });
    expect(await balanceOf({ id: voucher!.id })).toBe(1000);
    expect(await balanceOf({ id: cash!.id })).toBe(1000);
    const [single] = (await helpers.getTransactions({ raw: true }))!;
    expect(single!.paymentParts).toBeUndefined();
  });

  it('rejects editing a linked row directly', async () => {
    const [card, voucher] = await createManualAccounts({ count: 2 });
    await createPayment({ mainAccountId: card!.id, legs: [{ accountId: voucher!.id, amount: 30 }] });
    const [leg] = await legsOf({ accountId: voucher!.id });

    const response = await helpers.updateTransaction({ id: leg!.id, payload: { note: 'nope' } });
    expect(response.statusCode).toBe(ERROR_CODES.ValidationError);
  });

  it('deletes the linked rows with the main row', async () => {
    const [card, voucher] = await createManualAccounts({ count: 2 });
    const main = await createPayment({ mainAccountId: card!.id, legs: [{ accountId: voucher!.id, amount: 30 }] });

    await helpers.deleteTransaction({ id: main.id });

    expect(await balanceOf({ id: card!.id })).toBe(1000);
    expect(await balanceOf({ id: voucher!.id })).toBe(1000);
    expect(await helpers.getTransactions({ accountIds: [voucher!.id], raw: true })).toHaveLength(0);
  });

  it('bulk-deletes a main row selected together with its linked row', async () => {
    const [card, voucher] = await createManualAccounts({ count: 2 });
    const main = await createPayment({ mainAccountId: card!.id, legs: [{ accountId: voucher!.id, amount: 30 }] });
    const [leg] = await legsOf({ accountId: voucher!.id });

    const result = await helpers.bulkDeleteTransactions({ payload: { transactionIds: [leg!.id, main.id] }, raw: true });
    expect(result.deletedIds.toSorted()).toEqual([leg!.id, main.id].toSorted());
    expect(await balanceOf({ id: card!.id })).toBe(1000);
    expect(await balanceOf({ id: voucher!.id })).toBe(1000);
    expect(await helpers.getTransactions({ accountIds: [card!.id, voucher!.id], raw: true })).toHaveLength(0);
  });

  it('rejects deleting a created row on its own, directly or in bulk', async () => {
    const [card, voucher] = await createManualAccounts({ count: 2 });
    await createPayment({ mainAccountId: card!.id, legs: [{ accountId: voucher!.id, amount: 30 }] });
    const [leg] = await legsOf({ accountId: voucher!.id });

    expect((await helpers.deleteTransaction({ id: leg!.id })).statusCode).toBe(ERROR_CODES.ValidationError);
    const bulk = await helpers.bulkDeleteTransactions({ payload: { transactionIds: [leg!.id] } });
    expect(bulk.statusCode).toBe(ERROR_CODES.ValidationError);

    expect(await legsOf({ accountId: voucher!.id })).toHaveLength(1);
    expect(await balanceOf({ id: voucher!.id })).toBe(970);
  });

  it('bulk-updates through the main row, also when only the linked row is selected', async () => {
    const [card, voucher] = await createManualAccounts({ count: 2 });
    const main = await createPayment({ mainAccountId: card!.id, legs: [{ accountId: voucher!.id, amount: 30 }] });
    const [leg] = await legsOf({ accountId: voucher!.id });
    const groceries = await helpers.addCustomCategory({ name: 'Groceries', color: '#00ff00', raw: true });
    const dining = await helpers.addCustomCategory({ name: 'Dining', color: '#ff0000', raw: true });

    await helpers.bulkUpdateTransactions({
      payload: { transactionIds: [main.id], categoryId: groceries.id },
      raw: true,
    });
    expect((await legsOf({ accountId: voucher!.id }))[0]!.categoryId).toBe(groceries.id);

    await helpers.bulkUpdateTransactions({ payload: { transactionIds: [leg!.id], categoryId: dining.id }, raw: true });
    expect((await helpers.getTransactionById({ id: main.id, raw: true }))!.categoryId).toBe(dining.id);
    expect((await legsOf({ accountId: voucher!.id }))[0]!.categoryId).toBe(dining.id);
    expect(await balanceOf({ id: voucher!.id })).toBe(970);
  });

  it('rejects invalid linked accounts and combinations', async () => {
    const [card, voucher] = await createManualAccounts({ count: 2 });
    await helpers.addUserCurrencyByCode({ code: 'EUR', raw: true });
    const eurAccount = await helpers.createAccount({
      payload: helpers.buildAccountPayload({ currencyCode: 'EUR' }),
      raw: true,
    });

    const attempts = [
      { paymentLegs: [{ accountId: card!.id, amount: 30 }] },
      { paymentLegs: [{ accountId: eurAccount.id, amount: 30 }] },
      {
        paymentLegs: [{ accountId: voucher!.id, amount: 30 }],
        transferNature: TRANSACTION_TRANSFER_NATURE.common_transfer,
        destinationAccountId: eurAccount.id,
        destinationAmount: 70,
      },
    ];

    for (const attempt of attempts) {
      const response = await helpers.createTransaction({
        payload: helpers.buildTransactionPayload({ accountId: card!.id, amount: 70, ...attempt }),
        raw: false,
      });
      expect(response.statusCode).toBe(ERROR_CODES.ValidationError);
    }

    expect(await balanceOf({ id: card!.id })).toBe(1000);
    expect(await balanceOf({ id: voucher!.id })).toBe(1000);
  });

  it('rejects a linked account owned by another user, leaving both balances untouched', async () => {
    const [card] = await createManualAccounts({ count: 1 });
    const other = await helpers.provisionSecondUserWithBaseCurrency();
    const foreign = await helpers.asUser({
      cookies: other.cookies,
      fn: () => helpers.createAccount({ payload: helpers.buildAccountPayload({ initialBalance: 1000 }), raw: true }),
    });

    const response = await helpers.createTransaction({
      payload: helpers.buildTransactionPayload({
        accountId: card!.id,
        amount: 70,
        paymentLegs: [{ accountId: foreign.id, amount: 30 }],
      }),
      raw: false,
    });
    expect(response.statusCode).toBe(ERROR_CODES.ValidationError);

    expect(await balanceOf({ id: card!.id })).toBe(1000);
    expect(await helpers.asUser({ cookies: other.cookies, fn: () => balanceOf({ id: foreign.id }) })).toBe(1000);
  });

  it('adds a manual account to a bank-synced row, but never a bank account as a linked row', async () => {
    await helpers.monobank.pair();
    const { account: bankAccount } = await helpers.monobank.mockTransactions();
    const [synced] = (await helpers.getTransactions({ accountIds: [bankAccount.id], raw: true }))!;
    const voucher = await helpers.createAccount({
      payload: helpers.buildAccountPayload({ currencyCode: bankAccount.currencyCode, initialBalance: 1000 }),
      raw: true,
    });

    await helpers.updateTransaction({
      id: synced!.id,
      payload: { paymentLegs: [{ accountId: voucher.id, amount: 30 }] },
      raw: true,
    });
    expect(await balanceOf({ id: voucher.id })).toBe(
      synced!.transactionType === TRANSACTION_TYPES.expense ? 970 : 1030,
    );

    const manualMain = await helpers.createAccount({
      payload: helpers.buildAccountPayload({ currencyCode: bankAccount.currencyCode }),
      raw: true,
    });
    const response = await helpers.createTransaction({
      payload: helpers.buildTransactionPayload({
        accountId: manualMain.id,
        amount: 70,
        paymentLegs: [{ accountId: bankAccount.id, amount: 30 }],
      }),
      raw: false,
    });
    expect(response.statusCode).toBe(ERROR_CODES.ValidationError);
  });
});

const createRow = async ({
  accountId,
  ...params
}: { accountId: RecordId } & Partial<Parameters<typeof helpers.buildTransactionPayload>[0]>) => {
  const [row] = await helpers.createTransaction({
    payload: helpers.buildTransactionPayload({ accountId, amount: 30, note: 'Coffee', ...params }),
    raw: true,
  });
  return row;
};

const rowOf = async ({ accountId, id }: { accountId: RecordId; id: RecordId }) =>
  (await helpers.getTransactions({ accountIds: [accountId], includeTags: true, raw: true }))!.find(
    (tx) => tx.id === id,
  )!;

const setupLinkedPayment = async () => {
  const [card, cash, voucher] = await createManualAccounts({ count: 3 });
  const ownCategory = await helpers.addCustomCategory({ name: 'Cafe', color: '#00ff00', raw: true });
  const sharedCategory = await helpers.addCustomCategory({ name: 'Groceries', color: '#ff0000', raw: true });
  const ownPayee = await helpers.createPayee({ payload: { name: 'Corner cafe' }, raw: true });
  const sharedPayee = await helpers.createPayee({ payload: { name: 'Esselunga' }, raw: true });
  const ownTag = await helpers.createTag({ payload: { name: 'coffee', color: '#000000' }, raw: true });
  const sharedTag = await helpers.createTag({ payload: { name: 'food', color: '#000000' }, raw: true });

  const standalone = await createRow({
    accountId: cash!.id,
    categoryId: ownCategory.id,
    payeeId: ownPayee.id,
    tagIds: [ownTag.id],
    time: new Date('2026-01-05T10:00:00.000Z').toISOString(),
  });
  const [main] = await helpers.createTransaction({
    payload: helpers.buildTransactionPayload({
      accountId: card!.id,
      amount: 70,
      note: 'Esselunga',
      categoryId: sharedCategory.id,
      payeeId: sharedPayee.id,
      tagIds: [sharedTag.id],
      paymentLegs: [{ transactionId: standalone.id }, { accountId: voucher!.id, amount: 20 }],
    }),
    raw: true,
  });

  return { card: card!, cash: cash!, voucher: voucher!, standalone, main, ownCategory, ownPayee, ownTag, sharedTag };
};

describe('Multi-account payments v2', () => {
  it('creates a leg in another currency, moving each account in its own currency', async () => {
    const [card] = await createManualAccounts({ count: 1 });
    await helpers.addUserCurrencyByCode({ code: 'EUR', raw: true });
    const eurAccount = await helpers.createAccount({
      payload: helpers.buildAccountPayload({ currencyCode: 'EUR', initialBalance: 1000 }),
      raw: true,
    });

    const missing = await helpers.createTransaction({
      payload: helpers.buildTransactionPayload({
        accountId: card!.id,
        amount: 70,
        paymentLegs: [{ accountId: eurAccount.id, amount: 25 }],
      }),
      raw: false,
    });
    expect(missing.statusCode).toBe(ERROR_CODES.ValidationError);

    await createPayment({
      mainAccountId: card!.id,
      legs: [{ accountId: eurAccount.id, amount: 25, paymentAmount: 30 }],
    });

    expect(await balanceOf({ id: card!.id })).toBe(930);
    expect(await balanceOf({ id: eurAccount.id })).toBe(975);

    const [main] = (await helpers.getTransactions({ raw: true }))!;
    expect(main!.paymentTotal).toBe(100);
    expect(main!.paymentParts![1]).toMatchObject({
      accountId: eurAccount.id,
      amount: 25,
      currencyCode: 'EUR',
      paymentAmount: 30,
      isLinked: false,
    });
    const [leg] = await legsOf({ accountId: eurAccount.id });
    expect(leg!.currencyCode).toBe('EUR');
  });

  it('allows two created legs on the same account', async () => {
    const [card, voucher] = await createManualAccounts({ count: 2 });
    await createPayment({
      mainAccountId: card!.id,
      legs: [
        { accountId: voucher!.id, amount: 10 },
        { accountId: voucher!.id, amount: 20 },
      ],
    });

    expect(await balanceOf({ id: voucher!.id })).toBe(970);
    expect(await legsOf({ accountId: voucher!.id })).toHaveLength(2);
    expect((await helpers.getTransactions({ raw: true }))![0]!.paymentTotal).toBe(100);
  });

  it('links an existing transaction, copying only the shared details to it', async () => {
    const { cash, standalone, main, sharedTag } = await setupLinkedPayment();

    const linked = await rowOf({ accountId: cash.id, id: standalone.id });
    expect(linked).toMatchObject({
      paymentParentId: main.id,
      categoryId: main.categoryId,
      payeeId: main.payeeId,
      note: 'Esselunga',
      amount: 30,
      accountId: cash.id,
      time: standalone.time,
    });
    expect(linked.tags!.map((tag) => tag.id)).toEqual([sharedTag.id]);
    expect(linked.paymentParts!.find((part) => part.transactionId === standalone.id)!.isLinked).toBe(true);
    expect(await balanceOf({ id: cash.id })).toBe(970);
    expect((await helpers.getTransactions({ raw: true }))![0]!.paymentTotal).toBe(120);

    await helpers.updateTransaction({ id: main.id, payload: { note: 'Weekly shop' }, raw: true });
    const afterEdit = await rowOf({ accountId: cash.id, id: standalone.id });
    expect(afterEdit.note).toBe('Weekly shop');
    expect(afterEdit.time).toEqual(standalone.time);
  });

  it('unlinks a transaction left out of the legs, restoring its own details', async () => {
    const { cash, voucher, standalone, main, ownCategory, ownPayee, ownTag } = await setupLinkedPayment();
    const [createdLeg] = await legsOf({ accountId: voucher.id });

    await helpers.updateTransaction({
      id: main.id,
      payload: { paymentLegs: [{ transactionId: createdLeg!.id }] },
      raw: true,
    });

    const restored = await rowOf({ accountId: cash.id, id: standalone.id });
    expect(restored).toMatchObject({
      paymentParentId: null,
      categoryId: ownCategory.id,
      payeeId: ownPayee.id,
      note: 'Coffee',
    });
    expect(restored.tags!.map((tag) => tag.id)).toEqual([ownTag.id]);
    expect(restored.paymentParts).toBeUndefined();
    expect(await balanceOf({ id: cash.id })).toBe(970);
  });

  it('unlinks to no payee when the original payee was deleted meanwhile', async () => {
    const { cash, standalone, main, ownCategory, ownPayee, ownTag } = await setupLinkedPayment();
    await helpers.deletePayee({ id: ownPayee.id, raw: true });

    await helpers.updateTransaction({ id: main.id, payload: { paymentLegs: null }, raw: true });

    const restored = await rowOf({ accountId: cash.id, id: standalone.id });
    expect(restored).toMatchObject({ payeeId: null, categoryId: ownCategory.id, note: 'Coffee' });
    expect(restored.tags!.map((tag) => tag.id)).toEqual([ownTag.id]);
  });

  it('deletes the created legs with the main row and unlinks the linked ones', async () => {
    const { card, cash, voucher, standalone, main, ownCategory } = await setupLinkedPayment();

    await helpers.deleteTransaction({ id: main.id });

    expect(await legsOf({ accountId: voucher.id })).toHaveLength(0);
    expect(await balanceOf({ id: voucher.id })).toBe(1000);
    expect(await balanceOf({ id: card.id })).toBe(1000);
    const survivor = await rowOf({ accountId: cash.id, id: standalone.id });
    expect(survivor).toMatchObject({ paymentParentId: null, categoryId: ownCategory.id, note: 'Coffee' });
    expect(await balanceOf({ id: cash.id })).toBe(970);
  });

  it('rejects changing the amount of a linked transaction', async () => {
    const { cash, standalone, main } = await setupLinkedPayment();

    const response = await helpers.updateTransaction({
      id: main.id,
      payload: { paymentLegs: [{ transactionId: standalone.id, amount: 99 }] },
    });
    expect(response.statusCode).toBe(ERROR_CODES.ValidationError);
    expect((await rowOf({ accountId: cash.id, id: standalone.id })).amount).toBe(30);
  });

  it('rejects linking transfers, rows of another payment, other types, split rows and foreign rows', async () => {
    const [card, cash, savings, voucher] = await createManualAccounts({ count: 4 });
    const splitCategory = await helpers.addCustomCategory({ name: 'Split', color: '#0000ff', raw: true });

    const [transferLeg] = await helpers.createTransaction({
      payload: helpers.buildTransactionPayload({
        accountId: cash!.id,
        amount: 30,
        transferNature: TRANSACTION_TRANSFER_NATURE.common_transfer,
        destinationAccountId: savings!.id,
        destinationAmount: 30,
      }),
      raw: true,
    });
    const inOtherPayment = await createRow({ accountId: cash!.id });
    await createPayment({ mainAccountId: voucher!.id, legs: [{ transactionId: inOtherPayment.id }] });
    const income = await createRow({ accountId: cash!.id, transactionType: TRANSACTION_TYPES.income });
    const split = await createRow({ accountId: cash!.id, splits: [{ categoryId: splitCategory.id, amount: 10 }] });
    const other = await helpers.provisionSecondUserWithBaseCurrency();
    const foreign = await helpers.asUser({
      cookies: other.cookies,
      fn: async () => {
        const account = await helpers.createAccount({ raw: true });
        const category = await helpers.addCustomCategory({ name: 'Foreign', color: '#123456', raw: true });
        return createRow({ accountId: account.id, categoryId: category.id });
      },
    });

    for (const target of [transferLeg, inOtherPayment, income, split, foreign]) {
      const response = await helpers.createTransaction({
        payload: helpers.buildTransactionPayload({
          accountId: card!.id,
          amount: 70,
          paymentLegs: [{ transactionId: target!.id }],
        }),
        raw: false,
      });
      expect(response.statusCode).toBe(ERROR_CODES.ValidationError);
    }
    expect(await balanceOf({ id: card!.id })).toBe(1000);
  });

  it('keeps re-copying to a linked bank row without re-checking its account', async () => {
    await helpers.monobank.pair();
    const { account: bankAccount } = await helpers.monobank.mockTransactions();
    const [synced] = (await helpers.getTransactions({ accountIds: [bankAccount.id], raw: true }))!;
    const card = await helpers.createAccount({
      payload: helpers.buildAccountPayload({ currencyCode: bankAccount.currencyCode, initialBalance: 1000 }),
      raw: true,
    });

    const main = await createPayment({
      mainAccountId: card.id,
      transactionType: synced!.transactionType,
      legs: [{ transactionId: synced!.id }],
    });

    const response = await helpers.updateTransaction({ id: main.id, payload: { note: 'Shared note' } });
    expect(response.statusCode).toBe(200);
    expect((await rowOf({ accountId: bankAccount.id, id: synced!.id })).note).toBe('Shared note');
  });
});

describe('Multi-account payments: guards and cleanup', () => {
  it("rejects a share recipient dropping the owner's legs", async () => {
    const [card, voucher] = await createManualAccounts({ count: 2 });
    const main = await createPayment({ mainAccountId: card!.id, legs: [{ accountId: voucher!.id, amount: 30 }] });
    const recipient = await helpers.provisionSecondUserWithBaseCurrency();
    const invitation = await helpers.createShareInvitation({
      inviteeEmail: recipient.email,
      resourceType: RESOURCE_TYPES.account,
      resourceId: card!.id,
      permission: SHARE_PERMISSIONS.write,
      raw: true,
    });
    await helpers.asUser({
      cookies: recipient.cookies,
      fn: () => helpers.acceptShareInvitation({ token: invitation.token, raw: true }),
    });

    const response = await helpers.asUser({
      cookies: recipient.cookies,
      fn: () => helpers.updateTransaction({ id: main.id, payload: { paymentLegs: null } }),
    });
    expect(response.statusCode).toBe(ERROR_CODES.ValidationError);

    expect(await legsOf({ accountId: voucher!.id })).toHaveLength(1);
    expect(await balanceOf({ id: voucher!.id })).toBe(970);
  });

  it("turns the payment's other rows standalone when the main row's account is deleted", async () => {
    const { card, cash, voucher, standalone, ownCategory, ownPayee } = await setupLinkedPayment();

    await helpers.deleteAccount({ id: card.id, raw: true });

    const [created] = (await helpers.getTransactions({ accountIds: [voucher.id], raw: true }))!;
    expect(created).toMatchObject({ paymentParentId: null, amount: 20, payeeLocked: false });
    expect(created!.paymentParts).toBeUndefined();
    expect(await balanceOf({ id: voucher.id })).toBe(980);

    const restored = await rowOf({ accountId: cash.id, id: standalone.id });
    expect(restored).toMatchObject({
      paymentParentId: null,
      categoryId: ownCategory.id,
      payeeId: ownPayee.id,
      note: 'Coffee',
    });
    expect(await balanceOf({ id: cash.id })).toBe(970);
  });

  it('flips the created rows with a main type change, but rejects it with a linked row', async () => {
    const [card, voucher] = await createManualAccounts({ count: 2 });
    const main = await createPayment({ mainAccountId: card!.id, legs: [{ accountId: voucher!.id, amount: 30 }] });

    await helpers.updateTransaction({
      id: main.id,
      payload: { transactionType: TRANSACTION_TYPES.income },
      raw: true,
    });
    expect(await balanceOf({ id: card!.id })).toBe(1070);
    expect(await balanceOf({ id: voucher!.id })).toBe(1030);

    const linked = await setupLinkedPayment();
    const response = await helpers.updateTransaction({
      id: linked.main.id,
      payload: { transactionType: TRANSACTION_TYPES.income },
    });
    expect(response.statusCode).toBe(ERROR_CODES.ValidationError);
    expect((await helpers.getTransactionById({ id: linked.main.id, raw: true }))!.transactionType).toBe(
      TRANSACTION_TYPES.expense,
    );
    expect(await balanceOf({ id: linked.card.id })).toBe(930);
    expect(await balanceOf({ id: linked.cash.id })).toBe(970);
    expect(await balanceOf({ id: linked.voucher.id })).toBe(980);
  });

  it('rolls back the whole leg update when one leg is invalid', async () => {
    const [card, voucher, cash] = await createManualAccounts({ count: 3 });
    const main = await createPayment({ mainAccountId: card!.id, legs: [{ accountId: voucher!.id, amount: 30 }] });

    const response = await helpers.updateTransaction({
      id: main.id,
      payload: { paymentLegs: [{ accountId: cash!.id, amount: 10 }, { transactionId: randomUUID() as RecordId }] },
    });
    expect(response.statusCode).toBe(ERROR_CODES.ValidationError);

    expect(await legsOf({ accountId: voucher!.id })).toHaveLength(1);
    expect(await balanceOf({ id: voucher!.id })).toBe(970);
    expect(await balanceOf({ id: cash!.id })).toBe(1000);
  });

  it('requires the payment amounts again when the main row moves to another currency', async () => {
    const [card, voucher] = await createManualAccounts({ count: 2 });
    const main = await createPayment({ mainAccountId: card!.id, legs: [{ accountId: voucher!.id, amount: 30 }] });
    const [leg] = await legsOf({ accountId: voucher!.id });
    await helpers.addUserCurrencyByCode({ code: 'EUR', raw: true });
    const eurAccount = await helpers.createAccount({
      payload: helpers.buildAccountPayload({ currencyCode: 'EUR', initialBalance: 1000 }),
      raw: true,
    });

    const response = await helpers.updateTransaction({ id: main.id, payload: { accountId: eurAccount.id } });
    expect(response.statusCode).toBe(ERROR_CODES.ValidationError);
    expect((await helpers.getTransactionById({ id: main.id, raw: true }))!.accountId).toBe(card!.id);

    const resent = await helpers.updateTransaction({
      id: main.id,
      payload: { accountId: eurAccount.id, paymentLegs: [{ transactionId: leg!.id, paymentAmount: 25 }] },
    });
    expect(resent.statusCode).toBe(200);
    expect((await helpers.getTransactionById({ id: main.id, raw: true }))!.accountId).toBe(eurAccount.id);
    const [moved] = (await helpers.getTransactions({ raw: true }))!;
    expect(moved!.paymentParts!.find((part) => part.transactionId === leg!.id)!.paymentAmount).toBe(25);
  });

  it('bulk-deletes a main row selected together with its linked row', async () => {
    const { card, cash, voucher, standalone, main } = await setupLinkedPayment();

    const result = await helpers.bulkDeleteTransactions({
      payload: { transactionIds: [standalone.id, main.id] },
      raw: true,
    });
    expect(result.deletedIds.toSorted()).toEqual([standalone.id, main.id].toSorted());
    expect(await balanceOf({ id: card.id })).toBe(1000);
    expect(await balanceOf({ id: cash.id })).toBe(1000);
    expect(await balanceOf({ id: voucher.id })).toBe(1000);
  });

  it('deletes a linked row on its own, shrinking the payment', async () => {
    const { cash, voucher, standalone } = await setupLinkedPayment();

    expect((await helpers.deleteTransaction({ id: standalone.id })).statusCode).toBe(200);
    expect(await balanceOf({ id: cash.id })).toBe(1000);
    expect((await helpers.getTransactions({ raw: true }))![0]!.paymentTotal).toBe(90);

    const [createdLeg] = await legsOf({ accountId: voucher.id });
    expect((await helpers.deleteTransaction({ id: createdLeg!.id })).statusCode).toBe(ERROR_CODES.ValidationError);
  });

  it('edits a created leg in place by its id', async () => {
    const [card, voucher] = await createManualAccounts({ count: 2 });
    const main = await createPayment({ mainAccountId: card!.id, legs: [{ accountId: voucher!.id, amount: 30 }] });
    const [leg] = await legsOf({ accountId: voucher!.id });

    await helpers.updateTransaction({
      id: main.id,
      payload: { paymentLegs: [{ transactionId: leg!.id, amount: 40 }] },
      raw: true,
    });

    const legs = await legsOf({ accountId: voucher!.id });
    expect(legs).toHaveLength(1);
    expect(legs[0]).toMatchObject({ id: leg!.id, amount: 40 });
    expect(await balanceOf({ id: voucher!.id })).toBe(960);
    expect((await helpers.getTransactions({ raw: true }))![0]!.paymentTotal).toBe(110);
  });

  it('edits the share of a cross-currency leg, and requires it again with a new amount', async () => {
    const [card] = await createManualAccounts({ count: 1 });
    await helpers.addUserCurrencyByCode({ code: 'EUR', raw: true });
    const eurAccount = await helpers.createAccount({
      payload: helpers.buildAccountPayload({ currencyCode: 'EUR', initialBalance: 1000 }),
      raw: true,
    });
    const main = await createPayment({
      mainAccountId: card!.id,
      legs: [{ accountId: eurAccount.id, amount: 25, paymentAmount: 30 }],
    });
    const [leg] = await legsOf({ accountId: eurAccount.id });

    await helpers.updateTransaction({
      id: main.id,
      payload: { paymentLegs: [{ transactionId: leg!.id, paymentAmount: 35 }] },
      raw: true,
    });
    expect((await helpers.getTransactions({ raw: true }))![0]!.paymentTotal).toBe(105);
    expect(await balanceOf({ id: eurAccount.id })).toBe(975);

    const stale = await helpers.updateTransaction({
      id: main.id,
      payload: { paymentLegs: [{ transactionId: leg!.id, amount: 20 }] },
    });
    expect(stale.statusCode).toBe(ERROR_CODES.ValidationError);
    expect((await legsOf({ accountId: eurAccount.id }))[0]).toMatchObject({ id: leg!.id, amount: 25 });
    expect(await balanceOf({ id: eurAccount.id })).toBe(975);
    expect((await helpers.getTransactions({ raw: true }))![0]!.paymentTotal).toBe(105);
  });

  it("rejects moving the main row onto a leg's account", async () => {
    const [card, voucher] = await createManualAccounts({ count: 2 });
    const main = await createPayment({ mainAccountId: card!.id, legs: [{ accountId: voucher!.id, amount: 30 }] });

    const response = await helpers.updateTransaction({ id: main.id, payload: { accountId: voucher!.id } });
    expect(response.statusCode).toBe(ERROR_CODES.ValidationError);

    expect((await helpers.getTransactionById({ id: main.id, raw: true }))!.accountId).toBe(card!.id);
    expect(await balanceOf({ id: card!.id })).toBe(930);
    expect(await balanceOf({ id: voucher!.id })).toBe(970);
  });

  it("rejects linking a row that sits on the main row's account", async () => {
    const [card] = await createManualAccounts({ count: 1 });
    const sameAccountRow = await createRow({ accountId: card!.id });

    const response = await helpers.createTransaction({
      payload: helpers.buildTransactionPayload({
        accountId: card!.id,
        amount: 70,
        paymentLegs: [{ transactionId: sameAccountRow!.id }],
      }),
      raw: false,
    });
    expect(response.statusCode).toBe(ERROR_CODES.ValidationError);

    expect(await balanceOf({ id: card!.id })).toBe(970);
    expect((await rowOf({ accountId: card!.id, id: sameAccountRow!.id })).paymentParentId).toBeNull();
  });

  it('moves a created leg with the main row time, leaving a linked row its own time', async () => {
    const { cash, voucher, standalone, main } = await setupLinkedPayment();
    const time = new Date('2026-02-10T12:00:00.000Z').toISOString();

    await helpers.updateTransaction({ id: main.id, payload: { time }, raw: true });

    const [created] = await legsOf({ accountId: voucher.id });
    expect(new Date(created!.time).toISOString()).toBe(time);
    expect((await rowOf({ accountId: cash.id, id: standalone.id })).time).toEqual(standalone.time);
  });

  it('lands tags added through the tags endpoint on the main row and every leg', async () => {
    const { card, cash, voucher, standalone, main } = await setupLinkedPayment();
    const [created] = await legsOf({ accountId: voucher.id });
    const viaMain = await helpers.createTag({ payload: { name: 'via-main', color: '#000000' }, raw: true });
    const viaLeg = await helpers.createTag({ payload: { name: 'via-leg', color: '#000000' }, raw: true });

    await helpers.addTransactionsToTag({ tagId: viaMain.id, transactionIds: [main.id], raw: true });
    await helpers.addTransactionsToTag({ tagId: viaLeg.id, transactionIds: [created!.id], raw: true });

    for (const row of [
      { accountId: card.id, id: main.id },
      { accountId: voucher.id, id: created!.id },
      { accountId: cash.id, id: standalone.id },
    ]) {
      const tagIds = (await rowOf(row)).tags!.map((tag) => tag.id);
      expect(tagIds).toEqual(expect.arrayContaining([viaMain.id, viaLeg.id]));
    }
  });

  it('rejects linking a main row as a transfer, leaving balances untouched', async () => {
    const [card, voucher, cash] = await createManualAccounts({ count: 3 });
    const main = await createPayment({ mainAccountId: card!.id, legs: [{ accountId: voucher!.id, amount: 30 }] });
    const income = await createRow({ accountId: cash!.id, amount: 70, transactionType: TRANSACTION_TYPES.income });

    const response = await helpers.linkTransactions({ payload: { ids: [[main.id, income!.id]] } });
    expect(response.statusCode).toBe(ERROR_CODES.ValidationError);

    expect((await helpers.getTransactionById({ id: main.id, raw: true }))!.transferNature).toBe(
      TRANSACTION_TRANSFER_NATURE.not_transfer,
    );
    expect(await balanceOf({ id: card!.id })).toBe(930);
    expect(await balanceOf({ id: voucher!.id })).toBe(970);
    expect(await balanceOf({ id: cash!.id })).toBe(1070);
  });

  it('rejects refund-linking a main row', async () => {
    const [card, voucher] = await createManualAccounts({ count: 2 });
    const main = await createPayment({ mainAccountId: card!.id, legs: [{ accountId: voucher!.id, amount: 30 }] });
    const refund = await createRow({ accountId: card!.id, transactionType: TRANSACTION_TYPES.income });

    const response = await helpers.createSingleRefund({ originalTxId: main.id, refundTxId: refund!.id });
    expect((response as { statusCode: number }).statusCode).toBe(ERROR_CODES.ValidationError);
  });
});

import {
  CATEGORIZATION_MODE,
  CATEGORIZATION_SOURCE,
  type RecordId,
  TRANSACTION_TRANSFER_NATURE,
} from '@bt/shared/types';
import { describe, expect, it } from '@jest/globals';
import { app } from '@root/app';
import { API_PREFIX } from '@root/config';
import * as helpers from '@tests/helpers';
import { startOfDay, subDays } from 'date-fns';
import request from 'supertest';

const CANDIDATES_URL = `${API_PREFIX}/user/ai/categorization/candidates`;
const HISTORY_URL = `${API_PREFIX}/user/ai/categorization/history`;
const STATUS_URL = `${API_PREFIX}/user/ai/categorization/status`;
const TRIGGER_URL = `${API_PREFIX}/user/ai/categorization/trigger`;

/**
 * Newest first: index 0 is today, each following row is a day older, so the default
 * `time DESC` order of the endpoint is the same as the creation order here.
 */
async function seedTransactions({
  count,
  categoryId,
  accountId,
  payeeId,
}: {
  count: number;
  categoryId: RecordId;
  accountId: RecordId;
  payeeId?: RecordId;
}): Promise<string[]> {
  const today = startOfDay(new Date());
  const ids: string[] = [];

  for (let index = 0; index < count; index++) {
    const [transaction] = await helpers.createTransaction({
      payload: helpers.buildTransactionPayload({
        accountId,
        categoryId,
        payeeId,
        amount: 100 + index,
        note: `Coffee shop ${index}`,
        time: subDays(today, index).toISOString(),
      }),
      raw: true,
    });
    ids.push(transaction.id);
  }

  return ids;
}

/**
 * Both legs keep the passed category, so the pair sits in the default category with no
 * categorization stamp — a candidate row in every respect but the transfer nature.
 */
async function seedTransfer({
  categoryId,
  sourceAccountId,
  destinationAccountId,
}: {
  categoryId: RecordId;
  sourceAccountId: RecordId;
  destinationAccountId: RecordId;
}): Promise<string[]> {
  const [baseLeg, oppositeLeg] = await helpers.createTransaction({
    payload: {
      ...helpers.buildTransactionPayload({ accountId: sourceAccountId, categoryId, amount: 500 }),
      transferNature: TRANSACTION_TRANSFER_NATURE.common_transfer,
      destinationAmount: 500,
      destinationAccountId,
    },
    raw: true,
  });

  return [baseLeg.id, oppositeLeg!.id];
}

async function seedOutOfWalletTransfer({
  categoryId,
  accountId,
}: {
  categoryId: RecordId;
  accountId: RecordId;
}): Promise<string> {
  const [transaction] = await helpers.createTransaction({
    payload: {
      ...helpers.buildTransactionPayload({ accountId, categoryId, amount: 700 }),
      transferNature: TRANSACTION_TRANSFER_NATURE.transfer_out_wallet,
    },
    raw: true,
  });

  return transaction.id;
}

const getPage = async (payload?: { limit?: number; offset?: number }) => {
  const response = await helpers.getAiCategorizationCandidates({ payload });
  expect(response.statusCode).toBe(200);
  return response.body.response;
};

const getCandidates = async (payload?: { limit?: number; offset?: number }) => (await getPage(payload)).items;

const getCount = async () => (await getPage({ limit: 1 })).totalCount;

describe('GET /user/ai/categorization/candidates', () => {
  it('returns 401 for unauthenticated requests to every ai-categorization endpoint', async () => {
    const responses = await Promise.all([
      request(app).get(CANDIDATES_URL),
      request(app).get(HISTORY_URL),
      request(app).get(STATUS_URL),
      request(app).post(TRIGGER_URL),
    ]);

    for (const response of responses) {
      expect(response.statusCode).toBe(401);
    }
  });

  it('returns an empty list and a zero total when nothing is waiting for categorization', async () => {
    expect(await getPage()).toEqual({ items: [], totalCount: 0 });
  });

  it('returns only the transactions still sitting in the default category with no categorization stamp', async () => {
    const user = await helpers.getUserInfo({ raw: true });
    const defaultCategoryId = user.defaultCategoryId as RecordId;
    const customCategory = await helpers.addCustomCategory({ name: 'Groceries', color: '#FF0000', raw: true });
    const account = await helpers.createAccount({ raw: true });

    const candidateIds = await seedTransactions({ count: 3, categoryId: defaultCategoryId, accountId: account.id });
    await seedTransactions({ count: 2, categoryId: customCategory.id as RecordId, accountId: account.id });

    // An `enforce` Payee pointing at the default category stamps `categorizationMeta`
    // while leaving the row in the default category — the only case that isolates the
    // "already categorized" half of the criteria.
    const payee = await helpers.createPayee({
      payload: {
        name: 'Enforced Merchant',
        defaultCategoryId,
        categorizationMode: CATEGORIZATION_MODE.enforce,
      },
      raw: true,
    });
    const stampedIds = await seedTransactions({
      count: 1,
      categoryId: defaultCategoryId,
      accountId: account.id,
      payeeId: payee.id,
    });

    const candidates = await getCandidates();

    expect(candidates.map((tx) => tx.id).sort()).toEqual([...candidateIds].sort());
    expect(candidates.every((tx) => tx.categoryId === defaultCategoryId)).toBe(true);
    expect(candidates.every((tx) => tx.categorizationMeta === null)).toBe(true);
    expect(await getCount()).toBe(candidateIds.length);

    const stamped = await helpers.getTransactionById({ id: stampedIds[0]!, raw: true });
    expect(stamped?.categoryId).toBe(defaultCategoryId);
    expect(stamped?.categorizationMeta?.source).toBe(CATEGORIZATION_SOURCE.payeeRule);
  });

  it('returns tags, splits with their category and groups on each candidate', async () => {
    const user = await helpers.getUserInfo({ raw: true });
    const defaultCategoryId = user.defaultCategoryId as RecordId;
    const splitCategory = await helpers.addCustomCategory({ name: 'Groceries', color: '#FF0000', raw: true });
    const account = await helpers.createAccount({ raw: true });
    const tag = await helpers.createTag({ payload: helpers.buildTagPayload({ name: 'Trip' }), raw: true });
    const [tx] = await helpers.createTransaction({
      payload: {
        ...helpers.buildTransactionPayload({
          accountId: account.id,
          categoryId: defaultCategoryId,
          amount: 100,
          splits: [{ categoryId: splitCategory.id, amount: 40 }],
        }),
        tagIds: [tag.id],
      },
      raw: true,
    });
    const [siblingId] = await seedTransactions({ count: 1, categoryId: defaultCategoryId, accountId: account.id });
    const group = await helpers.createTransactionGroup({
      payload: helpers.buildTransactionGroupPayload({ transactionIds: [tx.id, siblingId!] }),
      raw: true,
    });

    const row = (await getCandidates()).find((candidate) => candidate.id === tx.id)!;

    expect(row.tags!.map((t) => t.id)).toEqual([tag.id]);
    expect(row.splits).toHaveLength(1);
    expect(row.splits![0]!.category!.id).toBe(splitCategory.id);
    expect(row.transactionGroups!.map((g) => ({ id: g.id, transactionCount: g.transactionCount }))).toEqual([
      { id: group.id, transactionCount: 2 },
    ]);
  });

  it('slices the same ordered list across limit and offset, reporting the total only on the first page', async () => {
    const user = await helpers.getUserInfo({ raw: true });
    const account = await helpers.createAccount({ raw: true });
    const seededIds = await seedTransactions({
      count: 5,
      categoryId: user.defaultCategoryId as RecordId,
      accountId: account.id,
    });

    const all = await getCandidates({ limit: 100 });
    expect(all.map((tx) => tx.id)).toEqual(seededIds);

    const firstPage = await getPage({ limit: 2, offset: 0 });
    const secondPage = await getPage({ limit: 2, offset: 2 });
    const thirdPage = await getPage({ limit: 2, offset: 4 });

    expect(firstPage.items.map((tx) => tx.id)).toEqual(seededIds.slice(0, 2));
    expect(firstPage.totalCount).toBe(5);

    expect(secondPage.items.map((tx) => tx.id)).toEqual(seededIds.slice(2, 4));
    expect(secondPage.totalCount).toBeNull();

    expect(thirdPage.items.map((tx) => tx.id)).toEqual(seededIds.slice(4));

    const paged = [...firstPage.items, ...secondPage.items, ...thirdPage.items].map((tx) => tx.id);
    expect(new Set(paged).size).toBe(seededIds.length);
  });

  it('counts candidates across every account the user owns', async () => {
    const user = await helpers.getUserInfo({ raw: true });
    const defaultCategoryId = user.defaultCategoryId as RecordId;
    const customCategory = await helpers.addCustomCategory({ name: 'Groceries', color: '#FF0000', raw: true });

    const firstAccount = await helpers.createAccount({ raw: true });
    const secondAccount = await helpers.createAccount({ raw: true });

    await seedTransactions({ count: 2, categoryId: defaultCategoryId, accountId: firstAccount.id });
    await seedTransactions({ count: 3, categoryId: defaultCategoryId, accountId: secondAccount.id });
    await seedTransactions({ count: 4, categoryId: customCategory.id as RecordId, accountId: firstAccount.id });

    expect(await getCount()).toBe(5);
  });

  it('never lists or counts transfers, even when they sit in the default category', async () => {
    const user = await helpers.getUserInfo({ raw: true });
    const defaultCategoryId = user.defaultCategoryId as RecordId;
    const sourceAccount = await helpers.createAccount({ raw: true });
    const destinationAccount = await helpers.createAccount({ raw: true });

    const plainIds = await seedTransactions({
      count: 2,
      categoryId: defaultCategoryId,
      accountId: sourceAccount.id,
    });
    const transferIds = await seedTransfer({
      categoryId: defaultCategoryId,
      sourceAccountId: sourceAccount.id,
      destinationAccountId: destinationAccount.id,
    });
    const outOfWalletId = await seedOutOfWalletTransfer({
      categoryId: defaultCategoryId,
      accountId: sourceAccount.id,
    });

    const excludedIds = [...transferIds, outOfWalletId];
    const excluded = await helpers.getTransactionsByIds({ ids: excludedIds, raw: true });
    expect(excluded).toHaveLength(excludedIds.length);
    expect(excluded.every((tx) => tx.categoryId === defaultCategoryId)).toBe(true);
    expect(excluded.every((tx) => tx.categorizationMeta === null)).toBe(true);

    const candidates = await getCandidates({ limit: 100 });

    expect(candidates.map((tx) => tx.id).sort()).toEqual([...plainIds].sort());
    expect(await getCount()).toBe(plainIds.length);
  });

  it('rejects a limit above the allowed maximum', async () => {
    const response = await helpers.getAiCategorizationCandidates({ payload: { limit: 500 } });

    expect(response.statusCode).toBe(422);
  });
});

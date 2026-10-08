import { CATEGORIZATION_SOURCE, RESOURCE_TYPES, SHARE_PERMISSIONS, type RecordId } from '@bt/shared/types';
import { generateRandomRecordId } from '@common/lib/record-id-helpers';
import { afterEach, beforeEach, describe, expect, it } from '@jest/globals';
import { ERROR_CODES } from '@js/errors';
import * as helpers from '@tests/helpers';
import { VALID_GEMINI_API_KEY, createGeminiMock } from '@tests/mocks/gemini/mock-api';

async function createTag(name: string) {
  return helpers.createTag({ payload: helpers.buildTagPayload({ name }), raw: true });
}

describe('Category default tags', () => {
  it('sets default tags on create and returns them in the list', async () => {
    const [tagA, tagB] = await Promise.all([createTag('Tag A'), createTag('Tag B')]);

    const created = await helpers.addCustomCategory({
      name: 'Groceries',
      color: '#FF0000',
      defaultTagIds: [tagA.id, tagB.id],
      raw: true,
    });
    expect(created.defaultTagIds).toEqual(expect.arrayContaining([tagA.id, tagB.id]));
    expect(created.defaultTagIds).toHaveLength(2);

    const list = await helpers.getCategoriesList();
    const listed = list.find((category) => category.id === created.id);
    expect(listed!.defaultTagIds).toEqual(expect.arrayContaining([tagA.id, tagB.id]));
    expect(listed!.defaultTagIds).toHaveLength(2);
    expect(list.filter((category) => category.id !== created.id).every((c) => c.defaultTagIds.length === 0)).toBe(true);
  });

  it('replaces and clears default tags on edit', async () => {
    const [tagA, tagB] = await Promise.all([createTag('Tag A'), createTag('Tag B')]);
    const created = await helpers.addCustomCategory({
      name: 'Bills',
      color: '#FF0000',
      defaultTagIds: [tagA.id],
      raw: true,
    });

    const [replaced] = await helpers.editCustomCategory({
      categoryId: created.id,
      defaultTagIds: [tagB.id],
      raw: true,
    });
    expect(replaced!.defaultTagIds).toEqual([tagB.id]);

    const [renamed] = await helpers.editCustomCategory({ categoryId: created.id, name: 'Utilities', raw: true });
    expect(renamed!.name).toBe('Utilities');
    expect(renamed!.defaultTagIds).toEqual([tagB.id]);

    const [cleared] = await helpers.editCustomCategory({ categoryId: created.id, defaultTagIds: [], raw: true });
    expect(cleared!.defaultTagIds).toEqual([]);
  });

  it('rejects tags the user does not own', async () => {
    const createRes = await helpers.addCustomCategory({
      name: 'Bills',
      color: '#FF0000',
      defaultTagIds: [generateRandomRecordId()],
      raw: false,
    });
    expect(createRes.statusCode).toBe(ERROR_CODES.ValidationError);

    const created = await helpers.addCustomCategory({ name: 'Bills', color: '#FF0000', raw: true });
    const editRes = await helpers.editCustomCategory({
      categoryId: created.id,
      defaultTagIds: [generateRandomRecordId()],
      raw: false,
    });
    expect(editRes.statusCode).toBe(ERROR_CODES.ValidationError);
  });

  it("rejects another user's tag on create and edit", async () => {
    const other = await helpers.signUpSecondUser();
    const foreignTag = await helpers.asUser({ cookies: other.cookies, fn: () => createTag('Foreign') });

    const createRes = await helpers.addCustomCategory({
      name: 'Bills',
      color: '#FF0000',
      defaultTagIds: [foreignTag.id],
      raw: false,
    });
    expect(createRes.statusCode).toBe(ERROR_CODES.ValidationError);

    const created = await helpers.addCustomCategory({ name: 'Bills', color: '#FF0000', raw: true });
    const editRes = await helpers.editCustomCategory({
      categoryId: created.id,
      defaultTagIds: [foreignTag.id],
      raw: false,
    });
    expect(editRes.statusCode).toBe(ERROR_CODES.ValidationError);
  });

  it('answers NotFound to a tags-only edit of an unknown category', async () => {
    const res = await helpers.editCustomCategory({
      categoryId: generateRandomRecordId(),
      defaultTagIds: [],
      raw: false,
    });
    expect(res.statusCode).toBe(ERROR_CODES.NotFoundError);
  });

  it("answers NotFound to edits of another user's category and leaves it unchanged", async () => {
    const ownTag = await createTag('Own');
    const other = await helpers.signUpSecondUser();
    const foreign = await helpers.asUser({
      cookies: other.cookies,
      fn: () => helpers.addCustomCategory({ name: 'Foreign', color: '#FF0000', raw: true }),
    });

    const renameRes = await helpers.editCustomCategory({ categoryId: foreign.id, name: 'Hijacked', raw: false });
    expect(renameRes.statusCode).toBe(ERROR_CODES.NotFoundError);
    const tagsRes = await helpers.editCustomCategory({
      categoryId: foreign.id,
      defaultTagIds: [ownTag.id],
      raw: false,
    });
    expect(tagsRes.statusCode).toBe(ERROR_CODES.NotFoundError);

    const list = await helpers.asUser({ cookies: other.cookies, fn: () => helpers.getCategoriesList() });
    const listed = list.find((category) => category.id === foreign.id);
    expect(listed!.name).toBe('Foreign');
    expect(listed!.defaultTagIds).toEqual([]);
  });

  it('stores duplicate tag ids once', async () => {
    const [tagA, tagB] = await Promise.all([createTag('Tag A'), createTag('Tag B')]);

    const created = await helpers.addCustomCategory({
      name: 'Bills',
      color: '#FF0000',
      defaultTagIds: [tagA.id, tagA.id],
      raw: true,
    });
    expect(created.defaultTagIds).toEqual([tagA.id]);

    const [edited] = await helpers.editCustomCategory({
      categoryId: created.id,
      defaultTagIds: [tagB.id, tagB.id],
      raw: true,
    });
    expect(edited!.defaultTagIds).toEqual([tagB.id]);

    const listed = (await helpers.getCategoriesList()).find((category) => category.id === created.id);
    expect(listed!.defaultTagIds).toEqual([tagB.id]);
  });

  it("hides the owner's default tags from a share recipient", async () => {
    const tag = await createTag('Owner tag');
    const category = await helpers.addCustomCategory({
      name: 'Owner category',
      color: '#FF0000',
      defaultTagIds: [tag.id],
      raw: true,
    });
    const account = await helpers.createAccount({ raw: true });
    const recipient = await helpers.provisionSecondUserWithBaseCurrency();
    const invitation = await helpers.createShareInvitation({
      inviteeEmail: recipient.email,
      resourceType: RESOURCE_TYPES.account,
      resourceId: account.id,
      permission: SHARE_PERMISSIONS.read,
      raw: true,
    });

    const [byAccount, accessible] = await helpers.asUser({
      cookies: recipient.cookies,
      fn: async () => {
        await helpers.acceptShareInvitation({ token: invitation.token, raw: true });
        return [
          await helpers.getCategoriesList({ accountId: account.id }),
          await helpers.getCategoriesList({ includeAccessible: true }),
        ];
      },
    });

    for (const list of [byAccount, accessible]) {
      const shared = list.find((item) => item.id === category.id);
      expect(shared).toBeDefined();
      expect(shared!.defaultTagIds).toEqual([]);
    }
  });

  it('drops a deleted tag from the category defaults', async () => {
    const [tagA, tagB] = await Promise.all([createTag('Tag A'), createTag('Tag B')]);
    const created = await helpers.addCustomCategory({
      name: 'Bills',
      color: '#FF0000',
      defaultTagIds: [tagA.id, tagB.id],
      raw: true,
    });

    await helpers.deleteTag({ id: tagA.id, raw: true });

    const listed = (await helpers.getCategoriesList()).find((category) => category.id === created.id);
    expect(listed!.defaultTagIds).toEqual([tagB.id]);
  });

  it('stores the AI-apply flag on create and edit', async () => {
    const created = await helpers.addCustomCategory({
      name: 'Bills',
      color: '#FF0000',
      applyDefaultTagsOnAiCategorization: true,
      raw: true,
    });
    expect(created.applyDefaultTagsOnAiCategorization).toBe(true);

    const [edited] = await helpers.editCustomCategory({
      categoryId: created.id,
      applyDefaultTagsOnAiCategorization: false,
      raw: true,
    });
    expect(edited!.applyDefaultTagsOnAiCategorization).toBe(false);

    const listed = (await helpers.getCategoriesList()).find((category) => category.id === created.id);
    expect(listed!.applyDefaultTagsOnAiCategorization).toBe(false);
  });

  describe('apply on AI categorization', () => {
    const TEST_TIMEOUT_MS = 60_000;
    let originalGeminiApiKey: string | undefined;

    beforeEach(() => {
      originalGeminiApiKey = process.env.GEMINI_API_KEY;
      process.env.GEMINI_API_KEY = VALID_GEMINI_API_KEY;
    });

    afterEach(() => {
      if (originalGeminiApiKey === undefined) {
        delete process.env.GEMINI_API_KEY;
      } else {
        process.env.GEMINI_API_KEY = originalGeminiApiKey;
      }
    });

    // The AI answers with the category's ordinal in the user's list; the list endpoint runs the
    // same unordered query as the categorization run, so the index here matches the alias there.
    const categoryOrdinal = async ({ categoryId }: { categoryId: string }) => {
      const list = await helpers.getCategoriesList();
      return list.findIndex((category) => category.id === categoryId) + 1;
    };

    const seedCandidate = async ({ tagIds = [] }: { tagIds?: string[] } = {}) => {
      const [user, account] = await Promise.all([
        helpers.getUserInfo({ raw: true }),
        helpers.createAccount({ raw: true }),
      ]);
      const [transaction] = await helpers.createTransaction({
        payload: helpers.buildTransactionPayload({
          accountId: account.id,
          categoryId: user.defaultCategoryId as RecordId,
          note: 'Coffee shop',
          tagIds,
        }),
        raw: true,
      });
      return transaction;
    };

    const runCategorization = async () => {
      const response = await helpers.triggerAiCategorization();
      expect(response.statusCode).toBe(200);
      await helpers.waitForCategorizationStatus({
        predicate: (status) => status.status === 'idle',
        timeoutMs: 15_000,
      });
    };

    const tagsOf = async ({ transactionId }: { transactionId: string }) => {
      const list = await helpers.getTransactions({ includeTags: true, raw: true });
      return list.find((item) => item.id === transactionId)?.tags?.map((tag) => tag.id) ?? [];
    };

    it(
      'adds the default tags when the flag is on, keeping existing tags',
      async () => {
        const [autoTag, manualTag] = await Promise.all([createTag('Auto'), createTag('Manual')]);
        const category = await helpers.addCustomCategory({
          name: 'Coffee',
          color: '#FF0000',
          defaultTagIds: [autoTag.id],
          applyDefaultTagsOnAiCategorization: true,
          raw: true,
        });
        const transaction = await seedCandidate({ tagIds: [manualTag.id] });
        global.mswMockServer.use(
          createGeminiMock({ categorizations: { 1: await categoryOrdinal({ categoryId: category.id }) } }),
        );

        await runCategorization();

        const [row] = await helpers.getTransactionsByIds({ ids: [transaction.id], raw: true });
        expect(row!.categoryId).toBe(category.id);
        expect(row!.categorizationMeta?.source).toBe(CATEGORIZATION_SOURCE.ai);
        expect((await tagsOf({ transactionId: transaction.id })).sort()).toEqual([autoTag.id, manualTag.id].sort());
      },
      TEST_TIMEOUT_MS,
    );

    it(
      'tags only the rows whose category opted in',
      async () => {
        const [optedInTag, optedOutTag] = await Promise.all([createTag('Opted in'), createTag('Opted out')]);
        const optedIn = await helpers.addCustomCategory({
          name: 'Coffee',
          color: '#FF0000',
          defaultTagIds: [optedInTag.id],
          applyDefaultTagsOnAiCategorization: true,
          raw: true,
        });
        const optedOut = await helpers.addCustomCategory({
          name: 'Tea',
          color: '#00FF00',
          defaultTagIds: [optedOutTag.id],
          raw: true,
        });
        const first = await seedCandidate();
        const second = await seedCandidate();
        global.mswMockServer.use(
          createGeminiMock({
            categorizations: {
              1: await categoryOrdinal({ categoryId: optedIn.id }),
              2: await categoryOrdinal({ categoryId: optedOut.id }),
            },
          }),
        );

        await runCategorization();

        const rows = await helpers.getTransactionsByIds({ ids: [first.id, second.id], raw: true });
        expect(rows.map((row) => row.categoryId).toSorted()).toEqual([optedIn.id, optedOut.id].toSorted());
        for (const row of rows) {
          expect(await tagsOf({ transactionId: row.id })).toEqual(row.categoryId === optedIn.id ? [optedInTag.id] : []);
        }
      },
      TEST_TIMEOUT_MS,
    );

    it(
      'leaves tags alone when the flag is off',
      async () => {
        const autoTag = await createTag('Auto');
        const category = await helpers.addCustomCategory({
          name: 'Coffee',
          color: '#FF0000',
          defaultTagIds: [autoTag.id],
          raw: true,
        });
        const transaction = await seedCandidate();
        global.mswMockServer.use(
          createGeminiMock({ categorizations: { 1: await categoryOrdinal({ categoryId: category.id }) } }),
        );

        await runCategorization();

        const [row] = await helpers.getTransactionsByIds({ ids: [transaction.id], raw: true });
        expect(row!.categoryId).toBe(category.id);
        expect(await tagsOf({ transactionId: transaction.id })).toEqual([]);
      },
      TEST_TIMEOUT_MS,
    );
  });
});

import { TRANSACTION_TYPES } from '@bt/shared/types';
import { describe, expect, it } from '@jest/globals';
import * as helpers from '@tests/helpers';

describe('Tracker lines on category delete', () => {
  it('repoints a line to the replacement category and keeps crediting its spend', async () => {
    const account = await helpers.createAccount({ raw: true });
    const food = await helpers.addCustomCategory({ name: 'Food', color: '#AABBCC', raw: true });
    const groceries = await helpers.addCustomCategory({ name: 'Groceries', color: '#AABBCC', raw: true });
    const [tx] = await helpers.createTransaction({
      payload: helpers.buildTransactionPayload({
        accountId: account.id,
        amount: 80,
        categoryId: food.id,
        transactionType: TRANSACTION_TYPES.expense,
      }),
      raw: true,
    });
    const tracker = await helpers.createTracker({ name: 'lines-category-replace', raw: true });
    await helpers.addTransactionsToTracker({ id: tracker.id, payload: { transactionIds: [tx!.id] }, raw: true });
    const line = await helpers.createTrackerLine({
      trackerId: tracker.id,
      payload: { name: 'Food', categoryIds: [food.id] },
      raw: true,
    });

    const res = await helpers.deleteCustomCategory({
      categoryId: food.id,
      replaceWithCategoryId: groceries.id,
      raw: false,
    });
    expect(res.statusCode).toBe(200);

    const details = (await helpers.getTrackerById({ id: tracker.id, raw: true }))!;
    expect(details.lines).toHaveLength(1);
    expect(details.lines![0]!.categories.map((category) => category.id)).toEqual([groceries.id]);

    const stats = (await helpers.getTrackerStats({ id: tracker.id, raw: true }))!;
    expect(stats.lines).toEqual([{ lineId: line.id, spent: 80 }]);
    expect(stats.otherSpent).toBe(0);
  });

  it('deletes a line left without categories and leaves other lines untouched', async () => {
    const doomed = await helpers.addCustomCategory({ name: 'Doomed', color: '#AABBCC', raw: true });
    const kept = await helpers.addCustomCategory({ name: 'Kept', color: '#AABBCC', raw: true });
    const tracker = await helpers.createTracker({ name: 'lines-category-drop', raw: true });
    await helpers.createTrackerLine({
      trackerId: tracker.id,
      payload: { name: 'Doomed only', categoryIds: [doomed.id] },
      raw: true,
    });
    const mixedLine = await helpers.createTrackerLine({
      trackerId: tracker.id,
      payload: { name: 'Mixed', categoryIds: [doomed.id, kept.id] },
      raw: true,
    });
    const keptLine = await helpers.createTrackerLine({
      trackerId: tracker.id,
      payload: { name: 'Kept only', categoryIds: [kept.id] },
      raw: true,
    });

    const res = await helpers.deleteCustomCategory({ categoryId: doomed.id, raw: false });
    expect(res.statusCode).toBe(200);

    const details = (await helpers.getTrackerById({ id: tracker.id, raw: true }))!;
    expect(details.lines!.map((line) => line.id)).toEqual([mixedLine.id, keptLine.id]);
    for (const line of details.lines!) {
      expect(line.categories.map((category) => category.id)).toEqual([kept.id]);
    }
  });

  it("moves a tracker's rule category to the replacement along with its line", async () => {
    const [food, rent, groceries] = await Promise.all(
      ['Food', 'Rent', 'Groceries'].map((name) => helpers.addCustomCategory({ name, color: '#AABBCC', raw: true })),
    );
    const tracker = await helpers.createTracker({
      name: 'category-tracker-replace',
      rulesEnabled: true,
      categoryIds: [food!.id, rent!.id],
      raw: true,
    });
    await helpers.createTrackerLine({
      trackerId: tracker.id,
      payload: { name: 'Food', categoryIds: [food!.id] },
      raw: true,
    });

    const res = await helpers.deleteCustomCategory({
      categoryId: food!.id,
      replaceWithCategoryId: groceries!.id,
      raw: false,
    });
    expect(res.statusCode).toBe(200);

    const details = (await helpers.getTrackerById({ id: tracker.id, raw: true }))!;
    const trackerCategoryIds = details.categories!.map((category) => category.id);
    expect(trackerCategoryIds.toSorted()).toEqual([rent!.id, groceries!.id].toSorted());
    expect(details.lines![0]!.categories.map((category) => category.id)).toEqual([groceries!.id]);
  });

  it('collapses a line holding both the deleted and the replacement category into one', async () => {
    const food = await helpers.addCustomCategory({ name: 'Food', color: '#AABBCC', raw: true });
    const groceries = await helpers.addCustomCategory({ name: 'Groceries', color: '#AABBCC', raw: true });
    const tracker = await helpers.createTracker({ name: 'lines-category-dedupe', raw: true });
    await helpers.createTrackerLine({
      trackerId: tracker.id,
      payload: { name: 'Food', categoryIds: [food.id, groceries.id] },
      raw: true,
    });

    const res = await helpers.deleteCustomCategory({
      categoryId: food.id,
      replaceWithCategoryId: groceries.id,
      raw: false,
    });
    expect(res.statusCode).toBe(200);

    const details = (await helpers.getTrackerById({ id: tracker.id, raw: true }))!;
    expect(details.lines![0]!.categories.map((category) => category.id)).toEqual([groceries.id]);
  });
});

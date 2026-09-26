import { type CategoryModel, type RecordId, TRANSACTION_TYPES } from '@bt/shared/types';
import { generateRandomRecordId } from '@common/lib/record-id-helpers';
import { describe, expect, it } from '@jest/globals';
import { ERROR_CODES } from '@js/errors';
import * as helpers from '@tests/helpers';

const TEMPLATE = [
  { parentKey: 'housing', key: 'rent', group: 'Bills' },
  { parentKey: 'housing', key: 'energy-utilities', group: 'Bills' },
  { parentKey: 'communication', key: 'phone-cell-phone', group: 'Bills' },
  { parentKey: 'food', key: 'groceries', group: 'Everyday' },
  { parentKey: 'food', key: 'restaurant', group: 'Everyday' },
  { parentKey: null, key: 'transportation', group: 'Everyday' },
  { parentKey: 'life', key: 'health-care-doctor', group: 'Life' },
  { parentKey: 'shopping', key: 'free-time', group: 'Life' },
];

const findCategory = ({
  categories,
  parentKey,
  key,
}: {
  categories: CategoryModel[];
  parentKey: string | null;
  key: string;
}): CategoryModel =>
  categories.find(
    (category) =>
      category.key === key &&
      (parentKey === null
        ? category.parentId === null
        : categories.find((parent) => parent.id === category.parentId)?.key === parentKey),
  )!;

const createTx = ({
  accountId,
  categoryId,
  amount,
  monthsAgo,
  transactionType = TRANSACTION_TYPES.expense,
}: {
  accountId: RecordId;
  categoryId: RecordId;
  amount: number;
  monthsAgo: number;
  transactionType?: TRANSACTION_TYPES;
}) =>
  helpers.createTransaction({
    payload: helpers.buildTransactionPayload({
      accountId,
      categoryId,
      amount,
      transactionType,
      time: `${helpers.budgetPeriodStart({ monthsAgo }).slice(0, 8)}10T12:00:00.000Z`,
    }),
    raw: true,
  });

const currentView = async ({ planId }: { planId: string }) => {
  const periods = await helpers.listBudgetPlanPeriods({ planId, raw: true });
  return helpers.getBudgetPlanPeriodView({
    planId,
    periodId: periods.find((period) => period.isCurrent)!.id,
    raw: true,
  });
};

/** Spend in the last 3 full months: rent 1000, groceries 900, restaurant 150, a key-less category 25. */
const seedHistory = async () => {
  const categories = await helpers.getCategoriesList();
  const [attached, detached, hobby] = await Promise.all([
    helpers.createAccount({ raw: true }),
    helpers.createAccount({ raw: true }),
    helpers.addCustomCategory({ name: 'Hobby stuff', color: '#123456', raw: true }),
  ]);
  const rent = findCategory({ categories, parentKey: 'housing', key: 'rent' });
  const groceries = findCategory({ categories, parentKey: 'food', key: 'groceries' });
  const restaurant = findCategory({ categories, parentKey: 'food', key: 'restaurant' });
  const wage = findCategory({ categories, parentKey: 'income', key: 'wage-invoices' });
  const fuel = findCategory({ categories, parentKey: 'vehicle', key: 'fuel' });

  const txs = [
    { accountId: attached.id, categoryId: rent.id, amount: 1000, monthsAgo: 1 },
    { accountId: attached.id, categoryId: groceries.id, amount: 300, monthsAgo: 1 },
    { accountId: attached.id, categoryId: groceries.id, amount: 300, monthsAgo: 2 },
    { accountId: attached.id, categoryId: groceries.id, amount: 300, monthsAgo: 3 },
    { accountId: attached.id, categoryId: restaurant.id, amount: 100, monthsAgo: 1 },
    { accountId: attached.id, categoryId: restaurant.id, amount: 50, monthsAgo: 3 },
    { accountId: attached.id, categoryId: hobby.id, amount: 25, monthsAgo: 2 },
    // Outside the window, on an account the plan doesn't hold, or income: none of these count.
    { accountId: attached.id, categoryId: fuel.id, amount: 700, monthsAgo: 4 },
    { accountId: detached.id, categoryId: groceries.id, amount: 5000, monthsAgo: 1 },
    {
      accountId: attached.id,
      categoryId: wage.id,
      amount: 5000,
      monthsAgo: 1,
      transactionType: TRANSACTION_TYPES.income,
    },
  ];
  for (const tx of txs) await createTx(tx);

  return { attached, rent, groceries, restaurant, hobby };
};

describe('Suggested budget lines', () => {
  describe('POST /budget-plans with withSuggestedLines', () => {
    it('adds the grouped starter template without amounts when there is no history', async () => {
      const categories = await helpers.getCategoriesList();

      const { plan, lines } = await helpers.createBudgetPlan({ payload: { withSuggestedLines: true }, raw: true });
      expect(lines).toHaveLength(8);

      const view = await currentView({ planId: plan.id });
      expect(view.groups.map((group) => group.name)).toEqual(['Bills', 'Everyday', 'Life']);

      const groupNames = new Map<string | null, string>(view.groups.map((group) => [group.id, group.name]));
      const actual = view.lines.map((line) => ({
        name: line.name,
        categoryIds: line.categoryIds,
        group: groupNames.get(line.groupId),
      }));
      const expected = TEMPLATE.map(({ parentKey, key, group }) => {
        const category = findCategory({ categories, parentKey, key });
        return { name: category.name, categoryIds: [category.id], group };
      });
      expect(actual).toHaveLength(expected.length);
      expect(actual).toEqual(expect.arrayContaining(expected));

      for (const line of view.lines) {
        expect(line).toMatchObject({ assigned: 0, assignedSource: 'none' });
      }
    });

    it('skips a deleted template category', async () => {
      const rent = findCategory({ categories: await helpers.getCategoriesList(), parentKey: 'housing', key: 'rent' });
      await helpers.deleteCustomCategory({ categoryId: rent.id });

      const { lines } = await helpers.createBudgetPlan({ payload: { withSuggestedLines: true }, raw: true });

      expect(lines).toHaveLength(7);
      expect(lines.flatMap((line) => line.categoryIds)).not.toContain(rent.id);
    });

    it('builds lines from spending history, ordered by spend, with the rounded-up monthly average', async () => {
      const { attached, rent, groceries, restaurant, hobby } = await seedHistory();

      const { plan, lines } = await helpers.createBudgetPlan({
        payload: { accountIds: [attached.id], withSuggestedLines: true },
        raw: true,
      });
      expect(lines).toHaveLength(4);

      const view = await currentView({ planId: plan.id });
      expect(view.groups.map((group) => group.name)).toEqual(['Bills', 'Everyday']);
      const [bills, everyday] = view.groups;
      const lineOf = ({ categoryId }: { categoryId: string }) =>
        view.lines.find((line) => line.categoryIds.includes(categoryId))!;

      expect(lineOf({ categoryId: rent.id })).toMatchObject({
        name: rent.name,
        groupId: bills!.id,
        assigned: 340,
        assignedSource: 'baseline',
      });
      expect(lineOf({ categoryId: groceries.id })).toMatchObject({
        name: groceries.name,
        groupId: everyday!.id,
        assigned: 300,
        assignedSource: 'baseline',
      });
      expect(lineOf({ categoryId: restaurant.id })).toMatchObject({
        name: restaurant.name,
        groupId: everyday!.id,
        assigned: 50,
        assignedSource: 'baseline',
      });
      expect(lineOf({ categoryId: hobby.id })).toMatchObject({
        name: 'Hobby stuff',
        groupId: null,
        assigned: 10,
        assignedSource: 'baseline',
      });
      expect(lineOf({ categoryId: groceries.id }).sortOrder).toBeLessThan(
        lineOf({ categoryId: restaurant.id }).sortOrder,
      );
    });

    it('converts the monthly average to a weekly plan', async () => {
      const { attached, rent, groceries, restaurant, hobby } = await seedHistory();

      const { plan } = await helpers.createBudgetPlan({
        payload: {
          accountIds: [attached.id],
          cadence: 'days',
          intervalN: 7,
          anchorDate: '2020-01-06',
          withSuggestedLines: true,
        },
        raw: true,
      });

      const view = await currentView({ planId: plan.id });
      const assignedOf = ({ categoryId }: { categoryId: string }) =>
        view.lines.find((line) => line.categoryIds.includes(categoryId))!.assigned;

      expect(assignedOf({ categoryId: rent.id })).toBe(80);
      expect(assignedOf({ categoryId: groceries.id })).toBe(70);
      expect(assignedOf({ categoryId: restaurant.id })).toBe(20);
      expect(assignedOf({ categoryId: hobby.id })).toBe(10);
    });

    it('bases a parent category line on its whole subtree', async () => {
      const categories = await helpers.getCategoriesList();
      const food = findCategory({ categories, parentKey: null, key: 'food' });
      const groceries = findCategory({ categories, parentKey: 'food', key: 'groceries' });
      const account = await helpers.createAccount({ raw: true });
      for (const tx of [
        { categoryId: food.id, amount: 500, monthsAgo: 1 },
        { categoryId: food.id, amount: 400, monthsAgo: 2 },
        { categoryId: groceries.id, amount: 301, monthsAgo: 3 },
      ]) {
        await createTx({ accountId: account.id, ...tx });
      }

      const { plan, lines } = await helpers.createBudgetPlan({
        payload: { accountIds: [account.id], withSuggestedLines: true },
        raw: true,
      });
      expect(lines).toHaveLength(1);

      const view = await currentView({ planId: plan.id });
      expect(view.lines).toHaveLength(1);
      expect(view.lines[0]).toMatchObject({
        name: food.name,
        categoryIds: [food.id],
        assigned: 410,
        assignedSource: 'baseline',
      });
    });

    it('adds no lines without the flag', async () => {
      const { attached } = await seedHistory();

      const { lines } = await helpers.createBudgetPlan({ payload: { accountIds: [attached.id] }, raw: true });

      expect(lines).toEqual([]);
    });
  });

  describe('POST /budget-plans/:planId/suggested-lines', () => {
    it('fills an empty plan, then has nothing left to add', async () => {
      const { plan } = await helpers.createBudgetPlan({ raw: true });

      expect(await helpers.addSuggestedBudgetLines({ planId: plan.id, raw: true })).toEqual({ created: 8 });
      expect(await helpers.addSuggestedBudgetLines({ planId: plan.id, raw: true })).toEqual({ created: 0 });
      expect((await helpers.getBudgetPlan({ planId: plan.id, raw: true })).lines).toHaveLength(8);
    });

    it('skips categories an existing line owns directly, through a parent, or through a child', async () => {
      const categories = await helpers.getCategoriesList();
      const food = findCategory({ categories, parentKey: null, key: 'food' });
      const rent = findCategory({ categories, parentKey: 'housing', key: 'rent' });
      const taxi = findCategory({ categories, parentKey: 'transportation', key: 'taxi' });
      const { plan } = await helpers.createBudgetPlan({ raw: true });
      for (const category of [food, rent, taxi]) {
        await helpers.createBudgetPlanLine({
          planId: plan.id,
          payload: { name: category.name, categoryIds: [category.id] },
          raw: true,
        });
      }

      expect(await helpers.addSuggestedBudgetLines({ planId: plan.id, raw: true })).toEqual({ created: 4 });

      const { lines } = await helpers.getBudgetPlan({ planId: plan.id, raw: true });
      const expected = ['energy-utilities', 'phone-cell-phone', 'health-care-doctor', 'free-time'].map(
        (key) => TEMPLATE.find((entry) => entry.key === key)!,
      );
      expect(lines.flatMap((line) => line.categoryIds).toSorted()).toEqual(
        [
          food.id,
          rent.id,
          taxi.id,
          ...expected.map(({ parentKey, key }) => findCategory({ categories, parentKey, key }).id),
        ].toSorted(),
      );
    });

    it('names groups in the request locale', async () => {
      const { plan } = await helpers.createBudgetPlan({ raw: true });

      await helpers.addSuggestedBudgetLines({ planId: plan.id, headers: { 'Accept-Language': 'uk' }, raw: true });

      const view = await currentView({ planId: plan.id });
      expect(view.groups.map((group) => group.name)).toEqual(["Обов'язкові платежі", 'Щоденні витрати', 'Життя']);
    });

    it('404s on an unknown plan and on a foreign plan', async () => {
      const { plan } = await helpers.createBudgetPlan({ raw: true });
      const other = await helpers.provisionSecondUserWithBaseCurrency();

      expect((await helpers.addSuggestedBudgetLines({ planId: generateRandomRecordId() })).statusCode).toBe(
        ERROR_CODES.NotFoundError,
      );
      const foreign = await helpers.asUser({
        cookies: other.cookies,
        fn: () => helpers.addSuggestedBudgetLines({ planId: plan.id }),
      });
      expect(foreign.statusCode).toBe(ERROR_CODES.NotFoundError);
      expect((await helpers.getBudgetPlan({ planId: plan.id, raw: true })).lines).toEqual([]);
    });
  });
});

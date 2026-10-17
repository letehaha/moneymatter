import {
  type CategoryModel,
  EARLY_ADOPTER_BUDGET_TRIAL_DAYS,
  PLANS,
  type RecordId,
  TRANSACTION_TYPES,
} from '@bt/shared/types';
import { generateRandomRecordId } from '@common/lib/record-id-helpers';
import { describe, expect, it } from '@jest/globals';
import { ERROR_CODES } from '@js/errors';
import * as helpers from '@tests/helpers';
import { enableServerModel, useSelfHostWithoutServerAiKeys } from '@tests/helpers/ai-test-env';
import { ANTHROPIC_API_URL } from '@tests/mocks/anthropic/mock-api';
import { GEMINI_API_URL, createGeminiMock } from '@tests/mocks/gemini/mock-api';
import { HttpResponse, http } from 'msw';

import { MS_PER_DAY } from './periods/period-enumerator';

const SOME_ID = generateRandomRecordId();

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

const MANY_CATEGORIES = [
  { parentKey: 'housing', key: 'rent' },
  { parentKey: 'housing', key: 'energy-utilities' },
  { parentKey: 'communication', key: 'phone-cell-phone' },
  { parentKey: 'food', key: 'groceries' },
  { parentKey: 'food', key: 'restaurant' },
  { parentKey: 'life', key: 'health-care-doctor' },
  { parentKey: 'life', key: 'hobbies' },
  { parentKey: 'shopping', key: 'free-time' },
  { parentKey: 'shopping', key: 'kids' },
  { parentKey: 'vehicle', key: 'fuel' },
];

/** One expense last month on each of ten categories: more than the default line caps hold. */
const seedManyCategories = async () => {
  const all = await helpers.getCategoriesList();
  const account = await helpers.createAccount({ raw: true });
  const categories = MANY_CATEGORIES.map((entry) => findCategory({ categories: all, ...entry }));
  for (const category of categories) {
    await createTx({ accountId: account.id, categoryId: category.id, amount: 100, monthsAgo: 1 });
  }
  return { account, categories };
};

interface LayoutByName {
  groups: { name: string; lines: { name: string; categories: string[] }[] }[];
}

/**
 * Answers with the layout, swapping each category name for the `c<n>` alias the prompt gave it;
 * an unknown name is sent as is. Returns the category paths each request listed, and
 * collects each request's system prompt into `systemPrompts`.
 */
const mockLayout = ({ layout, systemPrompts = [] }: { layout: LayoutByName; systemPrompts?: string[] }) => {
  const requests: string[][] = [];
  global.mswMockServer.use(
    http.post(GEMINI_API_URL, async ({ request }) => {
      const body = (await request.json()) as {
        contents: { parts: { text: string }[] }[];
        systemInstruction?: { parts: { text: string }[] };
      };
      systemPrompts.push((body.systemInstruction?.parts ?? []).map((part) => part.text).join('\n'));
      const rows = body.contents
        .flatMap((content) => content.parts)
        .flatMap((part) => part.text.split('\n'))
        .flatMap((row) => {
          const [alias, path] = row.split(' | ');
          return alias && path ? [{ alias, path }] : [];
        });
      requests.push(rows.map(({ path }) => path));
      const aliasByName = new Map(rows.map(({ alias, path }) => [path.split(' › ').at(-1)!, alias]));
      const groups = layout.groups.map((group) => ({
        name: group.name,
        lines: group.lines.map((line) => ({
          name: line.name,
          categoryIds: line.categories.map((name) => aliasByName.get(name) ?? name),
        })),
      }));

      return HttpResponse.json({
        candidates: [
          { content: { parts: [{ text: JSON.stringify({ groups }) }], role: 'model' }, finishReason: 'STOP' },
        ],
        usageMetadata: { promptTokenCount: 100, candidatesTokenCount: 50, totalTokenCount: 150 },
      });
    }),
  );
  return requests;
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

    it('402s without the budget feature', async () => {
      const { plan } = await helpers.createBudgetPlan({ raw: true });
      await helpers.setUserBilling({
        plan: PLANS.early_adopter,
        trialEndsAt: null,
        firstBudgetPlanAt: new Date(Date.now() - (EARLY_ADOPTER_BUDGET_TRIAL_DAYS + 1) * MS_PER_DAY),
      });

      expect((await helpers.addSuggestedBudgetLines({ planId: plan.id })).statusCode).toBe(ERROR_CODES.PaymentRequired);
    });
  });

  describe('GET /budget-plans/suggestion-context', () => {
    it('ranks the top-level categories with spending by monthly average', async () => {
      const { attached, rent, groceries, hobby } = await seedHistory();

      const context = await helpers.getBudgetSuggestionContext({ accountIds: attached.id, raw: true });

      expect(context).toEqual({
        hasHistory: true,
        categories: [
          { id: groceries.parentId, monthlyAvg: 350 },
          { id: rent.parentId, monthlyAvg: 333.33 },
          { id: hobby.id, monthlyAvg: 8.33 },
        ],
      });
    });

    it('offers the starter choices when the accounts have no spending', async () => {
      const categories = await helpers.getCategoriesList();
      const account = await helpers.createAccount({ raw: true });

      const context = await helpers.getBudgetSuggestionContext({ accountIds: account.id, raw: true });

      expect(context).toEqual({
        hasHistory: false,
        categories: [
          { parentKey: 'shopping', key: 'kids' },
          { parentKey: 'life', key: 'active-sport-fitness' },
          { parentKey: 'life', key: 'holiday-trips-hotels' },
          { parentKey: 'life', key: 'hobbies' },
          { parentKey: 'shopping', key: 'gifts-joy' },
          { parentKey: 'life', key: 'education-development' },
        ].map((entry) => ({ id: findCategory({ categories, ...entry }).id, monthlyAvg: null })),
      });
    });

    it("sees no history on another user's account", async () => {
      const { attached } = await seedHistory();
      const other = await helpers.provisionSecondUserWithBaseCurrency();

      const context = await helpers.asUser({
        cookies: other.cookies,
        fn: () => helpers.getBudgetSuggestionContext({ accountIds: attached.id, raw: true }),
      });

      expect(context.hasHistory).toBe(false);
    });

    it('offers the starter choices without any account', async () => {
      const context = await helpers.getBudgetSuggestionContext({ raw: true });

      expect(context.hasHistory).toBe(false);
      expect(context.categories).toHaveLength(6);
    });

    it('422s on a malformed account id', async () => {
      expect((await helpers.getBudgetSuggestionContext({ accountIds: 'nope' })).statusCode).toBe(
        ERROR_CODES.ValidationError,
      );
    });
  });

  describe('with setup answers', () => {
    useSelfHostWithoutServerAiKeys();

    it('tells the model the answers and builds a starter budget without history or amounts', async () => {
      enableServerModel();
      const categories = await helpers.getCategoriesList();
      const rent = findCategory({ categories, parentKey: 'housing', key: 'rent' });
      const pets = findCategory({ categories, parentKey: 'shopping', key: 'pets-animals' });
      const hobbies = findCategory({ categories, parentKey: 'life', key: 'hobbies' });
      const systemPrompts: string[] = [];
      mockLayout({
        systemPrompts,
        layout: {
          groups: [
            { name: 'Home', lines: [{ name: 'Rent', categories: [rent.name] }] },
            {
              name: 'Life',
              lines: [
                { name: 'Pets', categories: [pets.name] },
                { name: 'Hobbies', categories: [hobbies.name] },
              ],
            },
          ],
        },
      });

      const { plan, lines } = await helpers.createBudgetPlan({
        payload: {
          withSuggestedLines: true,
          suggestionAnswers: {
            detail: 'compact',
            housing: 'rent',
            transport: 'transit',
            pets: 'dog',
            eatsOut: 'rarely',
            subscriptions: 'none',
            focusCategoryIds: [hobbies.id],
          },
        },
        raw: true,
      });

      expect(lines.map((line) => line.name)).toEqual(['Rent', 'Pets', 'Hobbies']);
      const view = await currentView({ planId: plan.id });
      for (const line of view.lines) expect(line).toMatchObject({ assigned: 0, assignedSource: 'none' });

      const [prompt] = systemPrompts;
      expect(prompt).toContain('There is no spending history');
      expect(prompt).toContain('Aim for 6 to 8 lines');
      expect(prompt).toContain('Rents their home.');
      expect(prompt).toContain('Has a dog.');
      expect(prompt).toContain('Has no paid subscriptions.');
      expect(prompt).toContain('The user also spends on these; give each its own line:');
      expect(prompt).toContain(`› ${hobbies.name}.`);
    });

    it('builds on the spending, not the lifestyle answers, when there is history', async () => {
      enableServerModel();
      const { attached, rent, groceries } = await seedHistory();
      const pets = findCategory({
        categories: await helpers.getCategoriesList(),
        parentKey: 'shopping',
        key: 'pets-animals',
      });
      const systemPrompts: string[] = [];
      mockLayout({
        systemPrompts,
        layout: {
          groups: [
            { name: 'Home', lines: [{ name: 'Rent', categories: [rent.name] }] },
            {
              name: 'Everyday',
              lines: [
                { name: 'Groceries', categories: [groceries.name] },
                { name: 'Pets', categories: [pets.name] },
              ],
            },
          ],
        },
      });

      const { plan } = await helpers.createBudgetPlan({ payload: { accountIds: [attached.id] }, raw: true });
      const result = await helpers.addSuggestedBudgetLines({
        planId: plan.id,
        payload: { detail: 'balanced', pets: 'dog', focusCategoryIds: [groceries.parentId] },
        raw: true,
      });

      expect(result).toEqual({ created: 2 });
      const view = await currentView({ planId: plan.id });
      expect(view.lines.map((line) => line.name)).toEqual(['Rent', 'Groceries']);
      expect(systemPrompts[0]).toContain('The user wants to watch these closely');
      expect(systemPrompts[0]).toContain('Aim for 10 to 12 lines');
      expect(systemPrompts[0]).not.toContain('About the user');
    });

    it('caps the model at the detail level', async () => {
      enableServerModel();
      const { account, categories } = await seedManyCategories();
      mockLayout({
        layout: {
          groups: [{ name: 'All', lines: categories.map(({ name }) => ({ name, categories: [name] })) }],
        },
      });

      const { lines } = await helpers.createBudgetPlan({
        payload: { accountIds: [account.id], withSuggestedLines: true, suggestionAnswers: { detail: 'compact' } },
        raw: true,
      });

      expect(lines).toHaveLength(8);
    });

    it('raises the rule-based cap to the detail level when no model is available', async () => {
      const { account, categories } = await seedManyCategories();

      const { lines } = await helpers.createBudgetPlan({
        payload: { accountIds: [account.id], withSuggestedLines: true, suggestionAnswers: { detail: 'balanced' } },
        raw: true,
      });

      expect(lines).toHaveLength(categories.length);
    });

    it('falls back to the starter template and says the answers were ignored when no model is available', async () => {
      const created = await helpers.createBudgetPlan({
        payload: { withSuggestedLines: true, suggestionAnswers: { housing: 'rent', pets: 'other' } },
        raw: true,
      });

      expect(created.lines).toHaveLength(8);
      expect(created.suggestionAnswersIgnored).toBe(true);
    });

    it('skips the model when the detail level is the only answer and there is no history', async () => {
      enableServerModel();
      const requests = mockLayout({ layout: { groups: [] } });

      const created = await helpers.createBudgetPlan({
        payload: { withSuggestedLines: true, suggestionAnswers: { detail: 'detailed', focusCategoryIds: [] } },
        raw: true,
      });

      expect(requests).toHaveLength(0);
      expect(created.lines).toHaveLength(8);
      expect(created.suggestionAnswersIgnored).toBeUndefined();
    });

    it.each([
      { name: 'an unknown answer', payload: { housing: 'castle' } },
      { name: 'an unknown key', payload: { mood: 'fine' } },
      { name: 'a repeated focus category', payload: { focusCategoryIds: [SOME_ID, SOME_ID] } },
      { name: 'a malformed focus category', payload: { focusCategoryIds: ['nope'] } },
    ])('422s on $name', async ({ payload }) => {
      const { plan } = await helpers.createBudgetPlan({ raw: true });

      expect((await helpers.addSuggestedBudgetLines({ planId: plan.id, payload })).statusCode).toBe(
        ERROR_CODES.ValidationError,
      );
      const created = await helpers.createBudgetPlan({
        payload: { withSuggestedLines: true, suggestionAnswers: payload as never },
      });
      expect(created.statusCode).toBe(ERROR_CODES.ValidationError);
    });
  });

  describe('with the AI organiser', () => {
    useSelfHostWithoutServerAiKeys();

    it('creates the groups and lines the model returns, with engine amounts and the junk dropped', async () => {
      enableServerModel();
      const { attached, rent, groceries, restaurant, hobby } = await seedHistory();
      const fuel = findCategory({ categories: await helpers.getCategoriesList(), parentKey: 'vehicle', key: 'fuel' });
      mockLayout({
        layout: {
          groups: [
            { name: 'Home', lines: [{ name: 'Rent & bills', categories: [rent.name] }] },
            {
              name: 'Everyday',
              lines: [
                { name: 'Food', categories: [groceries.name, restaurant.name] },
                { name: 'Hobbies', categories: [hobby.name, fuel.name, 'c999'] },
                { name: 'Car', categories: [fuel.name] },
              ],
            },
          ],
        },
      });

      const { plan, lines } = await helpers.createBudgetPlan({
        payload: { accountIds: [attached.id], withSuggestedLines: true },
        raw: true,
      });
      expect(lines).toHaveLength(3);

      const view = await currentView({ planId: plan.id });
      expect(view.groups.map((group) => group.name)).toEqual(['Home', 'Everyday']);
      const [home, everyday] = view.groups;
      const lineNamed = ({ name }: { name: string }) => view.lines.find((line) => line.name === name)!;

      expect(lineNamed({ name: 'Rent & bills' })).toMatchObject({
        groupId: home!.id,
        categoryIds: [rent.id],
        assigned: 340,
        assignedSource: 'baseline',
      });
      expect(lineNamed({ name: 'Food' })).toMatchObject({ groupId: everyday!.id, assigned: 350 });
      expect(lineNamed({ name: 'Food' }).categoryIds).toEqual(expect.arrayContaining([groceries.id, restaurant.id]));
      expect(lineNamed({ name: 'Hobbies' })).toMatchObject({ groupId: everyday!.id, assigned: 10 });
      expect(lineNamed({ name: 'Hobbies' }).categoryIds).toEqual(expect.arrayContaining([hobby.id, fuel.id]));
      expect(view.lines.find((line) => line.name === 'Car')).toBeUndefined();
    });

    it('falls back to the spending-ranked lines when the model fails', async () => {
      enableServerModel();
      const { attached } = await seedHistory();
      global.mswMockServer.use(createGeminiMock({ shouldFail: true, expectedModel: 'gemini-3.8-flash' }));

      const { plan, lines } = await helpers.createBudgetPlan({
        payload: { accountIds: [attached.id], withSuggestedLines: true },
        raw: true,
      });

      expect(lines).toHaveLength(4);
      const view = await currentView({ planId: plan.id });
      expect(view.groups.map((group) => group.name)).toEqual(['Bills', 'Everyday']);
    });

    it('leaves the starter template alone when there is no history', async () => {
      enableServerModel();
      const requests = mockLayout({ layout: { groups: [{ name: 'Should not be used', lines: [] }] } });

      const { plan, lines } = await helpers.createBudgetPlan({ payload: { withSuggestedLines: true }, raw: true });

      expect(requests).toHaveLength(0);
      expect(lines).toHaveLength(8);
      const view = await currentView({ planId: plan.id });
      expect(view.groups.map((group) => group.name)).toEqual(['Bills', 'Everyday', 'Life']);
    });

    it('falls back to the spending-ranked lines when nothing in the answer survives', async () => {
      enableServerModel();
      const { attached } = await seedHistory();
      mockLayout({ layout: { groups: [{ name: 'Ghost', lines: [{ name: 'Nothing', categories: ['c999'] }] }] } });

      const { plan, lines } = await helpers.createBudgetPlan({
        payload: { accountIds: [attached.id], withSuggestedLines: true },
        raw: true,
      });

      expect(lines).toHaveLength(4);
      const view = await currentView({ planId: plan.id });
      expect(view.groups.map((group) => group.name)).toEqual(['Bills', 'Everyday']);
    });

    it('skips the model when existing lines already own every category with spending', async () => {
      enableServerModel();
      const { attached, rent, hobby } = await seedHistory();
      const food = findCategory({ categories: await helpers.getCategoriesList(), parentKey: null, key: 'food' });
      const { plan } = await helpers.createBudgetPlan({ payload: { accountIds: [attached.id] }, raw: true });
      for (const category of [rent, food, hobby]) {
        await helpers.createBudgetPlanLine({
          planId: plan.id,
          payload: { name: category.name, categoryIds: [category.id] },
          raw: true,
        });
      }
      const requests = mockLayout({ layout: { groups: [] } });

      expect(await helpers.addSuggestedBudgetLines({ planId: plan.id, raw: true })).toEqual({ created: 0 });
      expect(requests).toHaveLength(0);
    });

    it('leaves categories an existing line owns, and their ancestors, out of the prompt', async () => {
      enableServerModel();
      const { attached, rent, groceries, restaurant } = await seedHistory();
      const food = findCategory({ categories: await helpers.getCategoriesList(), parentKey: null, key: 'food' });
      const { plan } = await helpers.createBudgetPlan({ payload: { accountIds: [attached.id] }, raw: true });
      await helpers.createBudgetPlanLine({
        planId: plan.id,
        payload: { name: groceries.name, categoryIds: [groceries.id] },
        raw: true,
      });
      const requests = mockLayout({
        layout: {
          groups: [
            { name: 'Home', lines: [{ name: 'Rent', categories: [rent.name] }] },
            { name: 'Everyday', lines: [{ name: 'Food', categories: [groceries.name, restaurant.name] }] },
          ],
        },
      });

      expect(await helpers.addSuggestedBudgetLines({ planId: plan.id, raw: true })).toEqual({ created: 2 });

      const paths = requests[0]!;
      expect(paths.some((path) => path.endsWith(groceries.name))).toBe(false);
      expect(paths).not.toContain(food.name);
      expect(paths.some((path) => path.endsWith(restaurant.name))).toBe(true);

      const { lines } = await helpers.getBudgetPlan({ planId: plan.id, raw: true });
      expect(lines.filter((line) => line.categoryIds.includes(groceries.id))).toHaveLength(1);
      expect(lines.find((line) => line.name === 'Food')!.categoryIds).toEqual([restaurant.id]);
    });

    it('keeps a parent-only line whose spend sits on a child, with the subtree baseline', async () => {
      enableServerModel();
      const categories = await helpers.getCategoriesList();
      const food = findCategory({ categories, parentKey: null, key: 'food' });
      const groceries = findCategory({ categories, parentKey: 'food', key: 'groceries' });
      const account = await helpers.createAccount({ raw: true });
      for (const monthsAgo of [1, 2, 3]) {
        await createTx({ accountId: account.id, categoryId: groceries.id, amount: 300, monthsAgo });
      }
      mockLayout({ layout: { groups: [{ name: 'Everyday', lines: [{ name: 'Food', categories: [food.name] }] }] } });

      const { plan, lines } = await helpers.createBudgetPlan({
        payload: { accountIds: [account.id], withSuggestedLines: true },
        raw: true,
      });

      expect(lines).toHaveLength(1);
      const view = await currentView({ planId: plan.id });
      expect(view.lines[0]).toMatchObject({
        name: 'Food',
        categoryIds: [food.id],
        assigned: 300,
        assignedSource: 'baseline',
      });
    });

    it('falls through to the fallback model when the primary one fails', async () => {
      enableServerModel();
      process.env.ANTHROPIC_API_KEY = 'server-side-anthropic-key';
      const { attached, rent } = await seedHistory();
      let primaryCalls = 0;
      global.mswMockServer.use(
        http.post(ANTHROPIC_API_URL, () => {
          primaryCalls += 1;
          return HttpResponse.json(
            { type: 'error', error: { type: 'invalid_request_error', message: 'Bad request' } },
            { status: 400 },
          );
        }),
      );
      const requests = mockLayout({
        layout: { groups: [{ name: 'Home', lines: [{ name: 'Rent', categories: [rent.name] }] }] },
      });

      const { lines } = await helpers.createBudgetPlan({
        payload: { accountIds: [attached.id], withSuggestedLines: true },
        raw: true,
      });

      expect(primaryCalls).toBe(1);
      expect(requests).toHaveLength(1);
      expect(lines.map((line) => line.name)).toEqual(['Rent']);
    });

    it('skips every model once the AI allowance is used up', async () => {
      enableServerModel();
      process.env.ANTHROPIC_API_KEY = 'server-side-anthropic-key';
      process.env.AI_MONTHLY_CAP_USD_TRIAL = '0';
      const { attached, rent } = await seedHistory();
      let primaryCalls = 0;
      global.mswMockServer.use(
        http.post(ANTHROPIC_API_URL, () => {
          primaryCalls += 1;
          return HttpResponse.json({}, { status: 500 });
        }),
      );
      const requests = mockLayout({
        layout: { groups: [{ name: 'Home', lines: [{ name: 'Rent', categories: [rent.name] }] }] },
      });

      const { plan, lines } = await helpers.createBudgetPlan({
        payload: { accountIds: [attached.id], withSuggestedLines: true },
        raw: true,
      });

      expect(primaryCalls).toBe(0);
      expect(requests).toHaveLength(0);
      expect(lines).toHaveLength(4);
      const view = await currentView({ planId: plan.id });
      expect(view.groups.map((group) => group.name)).toEqual(['Bills', 'Everyday']);
    });

    it('counts the AI layout toward the AI allowance', async () => {
      enableServerModel();
      process.env.AI_MONTHLY_CAP_USD_TRIAL = '0.001';
      const { attached, rent } = await seedHistory();
      mockLayout({ layout: { groups: [{ name: 'Home', lines: [{ name: 'Rent', categories: [rent.name] }] }] } });

      await helpers.createBudgetPlan({
        payload: { accountIds: [attached.id], withSuggestedLines: true },
        raw: true,
      });

      const { aiAllowance } = await helpers.getAiFeaturesStatus({ raw: true });
      expect(aiAllowance?.usedPercent).toBeGreaterThan(0);
    });
  });
});

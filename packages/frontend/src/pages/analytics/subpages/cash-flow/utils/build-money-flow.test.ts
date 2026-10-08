import {
  CATEGORY_TYPES,
  type CategoryModel,
  type GetSpendingsByCategoriesByTypeReturnType,
  type GetInvestmentContributionsResponse,
} from '@bt/shared/types';
import { describe, expect, it } from 'vitest';

import { CASH_NODE_ID, DEFICIT_NODE_ID, OTHER_NODE_ID, buildMoneyFlow } from './build-money-flow';

const category = ({ id, parentId = null, name = id }: { id: string; parentId?: string | null; name?: string }) =>
  ({
    id,
    parentId,
    name,
    color: `#${id}`,
    icon: null,
    key: null,
    type: CATEGORY_TYPES.custom,
    userId: 1,
  }) as unknown as CategoryModel;

const categories = [
  category({ id: 'income', name: 'Income' }),
  category({ id: 'salary', parentId: 'income', name: 'Salary' }),
  category({ id: 'bonus', parentId: 'salary', name: 'Bonus' }),
  category({ id: 'gifts', parentId: 'income', name: 'Gifts' }),
  category({ id: 'food', name: 'Food' }),
  category({ id: 'groceries', parentId: 'food', name: 'Groceries' }),
  category({ id: 'housing', name: 'Housing' }),
];

const entry = ({ income = 0, expense = 0 }: { income?: number; expense?: number }) => ({
  name: '',
  color: '',
  income,
  expense,
});

const asResponse = (d: Record<string, ReturnType<typeof entry>>) =>
  d as unknown as GetSpendingsByCategoriesByTypeReturnType;

const data = asResponse({
  salary: entry({ income: 1000 }),
  bonus: entry({ income: 200 }),
  gifts: entry({ income: 100 }),
  groceries: entry({ expense: 300 }),
  housing: entry({ expense: 500 }),
});

const sumValues = ({ nodes }: { nodes: { value: number }[] }) => nodes.reduce((sum, n) => sum + n.value, 0);

const contributions = ({ amounts }: { amounts: Record<string, number> }): GetInvestmentContributionsResponse => ({
  portfolios: Object.keys(amounts).map((id) => ({ portfolioId: id, name: `Portfolio ${id}` })),
  buckets: [
    {
      periodStart: '2026-05-01',
      periodEnd: '2026-05-31',
      total: Object.values(amounts).reduce((a, b) => a + b, 0),
      savingsNet: 0,
      byPortfolio: Object.entries(amounts).map(([portfolioId, amount]) => ({ portfolioId, amount })),
    },
  ],
});

describe('buildMoneyFlow', () => {
  it('splits savings into portfolios plus the cash remainder', () => {
    const flow = buildMoneyFlow({
      data,
      categories,
      contributions: contributions({ amounts: { a: 300, b: 100, withdrawn: -50 } }),
      sourceLevel: 1,
      expenseLevel: 1,
      topN: 10,
    });

    expect(flow).toMatchObject({ net: 500, savings: 500, deficit: 0 });
    expect(flow.savingsNodes.map((n) => [n.id, n.value, n.share])).toEqual([
      ['a', 300, 0.6],
      ['b', 100, 0.2],
      [CASH_NODE_ID, 100, 0.2],
    ]);
  });

  it('covers investing beyond net savings with a deficit', () => {
    const flow = buildMoneyFlow({
      data,
      categories,
      contributions: contributions({ amounts: { a: 800 } }),
      sourceLevel: 1,
      expenseLevel: 1,
      topN: 10,
    });

    expect(flow).toMatchObject({ net: 500, savings: 800, deficit: 300 });
    expect(flow.savingsNodes).toEqual([{ id: 'a', name: 'Portfolio a', value: 800, share: 1 }]);
  });

  it('reports an overspent period as a deficit source with zero savings', () => {
    const flow = buildMoneyFlow({
      data: asResponse({ salary: entry({ income: 100 }), housing: entry({ expense: 250 }) }),
      categories,
      sourceLevel: 1,
      expenseLevel: 1,
      topN: 10,
    });

    expect(flow).toMatchObject({ net: -150, savings: 0, deficit: 150, savingsNodes: [] });
    expect(flow.sources.map((n) => [n.id, n.value, n.share])).toEqual([
      ['income', 100, 0.4],
      [DEFICIT_NODE_ID, 150, 0.6],
    ]);
  });

  it('keeps all savings as cash without contributions', () => {
    const flow = buildMoneyFlow({ data, categories, sourceLevel: 1, expenseLevel: 1, topN: 10 });

    expect(flow).toMatchObject({ savings: 500, deficit: 0 });
    expect(flow.savingsNodes).toEqual([{ id: CASH_NODE_ID, name: '', value: 500, share: 1 }]);
  });

  it('counts venture deals as savings destinations next to portfolios', () => {
    const flow = buildMoneyFlow({
      data,
      categories,
      contributions: contributions({ amounts: { a: 100 } }),
      ventures: [{ dealId: 'deal', name: 'Seed round', amount: 700 }],
      sourceLevel: 1,
      expenseLevel: 1,
      topN: 10,
    });

    expect(flow).toMatchObject({ net: 500, savings: 800, deficit: 300 });
    expect(flow.savingsNodes.map((n) => [n.id, n.name, n.value])).toEqual([
      ['deal', 'Seed round', 700],
      ['a', 'Portfolio a', 100],
    ]);
  });

  it('moves savings-category spend from expenses into a savings destination', () => {
    const flow = buildMoneyFlow({
      data: asResponse({
        ...data,
        emergency: entry({ expense: 200, income: 50 }),
        deposits: entry({ expense: 100 }),
      }),
      categories: [
        ...categories,
        category({ id: 'savings', name: 'Savings' }),
        category({ id: 'emergency', parentId: 'savings', name: 'Emergency fund' }),
        category({ id: 'deposits', parentId: 'savings', name: 'Deposits' }),
      ],
      contributions: contributions({ amounts: { a: 100 } }),
      sourceLevel: 1,
      expenseLevel: 1,
      topN: 10,
      // The settings picker stores the parent together with its subtree.
      savingsCategoryIds: ['savings', 'emergency', 'deposits'],
    });

    expect(flow).toMatchObject({ income: 1300, expenses: 800, net: 500, savings: 500, deficit: 0 });
    expect(flow.expenseNodes.map((n) => n.id)).toEqual(['housing', 'food']);
    expect(flow.savingsNodes.map((n) => [n.id, n.name, n.value])).toEqual([
      ['savings', 'Savings', 250],
      ['a', 'Portfolio a', 100],
      [CASH_NODE_ID, '', 150],
    ]);
  });

  it('keeps a savings subcategory out of its expense parent and funds it from a deficit', () => {
    const flow = buildMoneyFlow({
      data: asResponse({ ...data, deposit: entry({ expense: 900 }) }),
      categories: [...categories, category({ id: 'deposit', parentId: 'housing', name: 'Deposit' })],
      sourceLevel: 1,
      expenseLevel: 1,
      topN: 10,
      savingsCategoryIds: ['deposit'],
    });

    expect(flow).toMatchObject({ income: 1300, expenses: 800, savings: 900, deficit: 400 });
    expect(flow.expenseNodes.map((n) => [n.id, n.value])).toEqual([
      ['housing', 500],
      ['food', 300],
    ]);
    expect(flow.sources.map((n) => [n.id, n.value])).toEqual([
      ['income', 1300],
      [DEFICIT_NODE_ID, 400],
    ]);
    expect(flow.savingsNodes).toEqual([{ id: 'deposit', name: 'Deposit', color: '#deposit', value: 900, share: 1 }]);
  });

  it('rolls both sides up to the requested level', () => {
    const flow = buildMoneyFlow({ data, categories, sourceLevel: 1, expenseLevel: 1, topN: 10 });

    expect(flow.sources).toEqual([expect.objectContaining({ id: 'income', value: 1300, share: 1 })]);
    expect(flow.expenseNodes.map((n) => [n.id, n.value])).toEqual([
      ['housing', 500],
      ['food', 300],
    ]);
    expect(flow).toMatchObject({ income: 1300, expenses: 800, net: 500 });
  });

  it('keeps categories shallower than the level and attaches the parent name', () => {
    const flow = buildMoneyFlow({ data, categories, sourceLevel: 3, expenseLevel: 2, topN: 10 });

    expect(flow.sources.map((n) => [n.id, n.value, n.parentName])).toEqual([
      ['salary', 1000, 'Income'],
      ['bonus', 200, 'Salary'],
      ['gifts', 100, 'Income'],
    ]);
    expect(flow.expenseNodes.map((n) => n.id)).toEqual(['housing', 'groceries']);
  });

  it('groups level-2 expense nodes under their root category', () => {
    const flow = buildMoneyFlow({
      data: asResponse({
        salary: entry({ income: 10000 }),
        food: entry({ expense: 100 }),
        groceries: entry({ expense: 300 }),
        housing: entry({ expense: 500 }),
        ...Object.fromEntries(Array.from({ length: 8 }, (_, i) => [`sub${i}`, entry({ expense: 1000 - i })])),
      }),
      categories: [
        ...categories,
        category({ id: 'shopping', name: 'Shopping' }),
        ...Array.from({ length: 8 }, (_, i) => category({ id: `sub${i}`, parentId: 'shopping' })),
      ],
      sourceLevel: 1,
      expenseLevel: 2,
      topN: 10,
    });

    expect(flow.expenseGroups.map((g) => [g.id, g.value, g.leaves.map((l) => l.id)])).toEqual([
      ['shopping', 7972, ['sub0', 'sub1', 'sub2', 'sub3', 'sub4', 'sub5', OTHER_NODE_ID]],
      ['housing', 500, ['housing']],
      ['food', 400, ['groceries', 'food']],
    ]);
    expect(flow.expenseNodes).toEqual(flow.expenseGroups.flatMap((g) => g.leaves));
    for (const group of flow.expenseGroups) expect(sumValues({ nodes: group.leaves })).toBe(group.value);
    expect(flow.expenseNodes.reduce((sum, n) => sum + n.share, 0)).toBeCloseTo(1);
    expect(flow.expenseNodes.find((n) => n.id === OTHER_NODE_ID)).toMatchObject({
      value: 1987,
      parentName: 'Shopping',
    });
    expect(flow.expenseNodes.find((n) => n.id === 'groceries')!.share).toBeCloseTo(300 / 8872);
    expect(flow.expenses).toBe(8872);
  });

  it('keeps the folded roots as a single childful leaf of the "other" group', () => {
    const flow = buildMoneyFlow({
      data: asResponse({ ...data, fun: entry({ expense: 200 }) }),
      categories: [...categories, category({ id: 'fun', name: 'Fun' })],
      sourceLevel: 1,
      expenseLevel: 2,
      topN: 1,
    });

    expect(flow.expenseGroups.map((g) => g.id)).toEqual(['housing', OTHER_NODE_ID]);
    const other = flow.expenseGroups.at(-1)!;
    expect(other.leaves).toHaveLength(1);
    expect(other.leaves[0]!.children!.map((n) => n.id)).toEqual(['food', 'fun']);
    expect(other.leaves[0]!.parentName).toBeUndefined();
    expect(flow.expenseNodes).toEqual(flow.expenseGroups.flatMap((g) => g.leaves));
    expect(flow.expenses).toBe(1000);
  });

  it('leaves expense groups empty at level 1', () => {
    const flow = buildMoneyFlow({ data, categories, sourceLevel: 1, expenseLevel: 1, topN: 10 });

    expect(flow.expenseGroups).toEqual([]);
  });

  it('moves tax-category spend out of expenses and keeps a tax refund as income', () => {
    const flow = buildMoneyFlow({
      data: asResponse({
        ...data,
        incomeTax: entry({ expense: 200, income: 40 }),
        propertyTax: entry({ expense: 100 }),
      }),
      categories: [
        ...categories,
        category({ id: 'taxes', parentId: 'housing', name: 'Taxes' }),
        category({ id: 'incomeTax', parentId: 'taxes', name: 'Income tax' }),
        category({ id: 'propertyTax', parentId: 'taxes', name: 'Property tax' }),
        category({ id: 'fines', name: 'Fines' }),
      ],
      sourceLevel: 1,
      expenseLevel: 1,
      topN: 10,
      taxCategoryIds: ['taxes', 'incomeTax', 'propertyTax', 'fines'],
    });

    expect(flow).toMatchObject({ income: 1340, expenses: 800, taxes: 300, net: 240, savings: 240, deficit: 0 });
    expect(flow.taxNodes).toEqual([{ id: 'taxes', name: 'Taxes', color: '#taxes', value: 300, share: 1 }]);
    expect(flow.expenseNodes.map((n) => [n.id, n.value])).toEqual([
      ['housing', 500],
      ['food', 300],
    ]);
    expect(flow.sources.map((n) => [n.id, n.value])).toEqual([
      ['income', 1300],
      ['housing', 40],
    ]);
  });

  it('keeps tax spend out of level-2 expense groups', () => {
    const flow = buildMoneyFlow({
      data: asResponse({ ...data, propertyTax: entry({ expense: 100 }), fines: entry({ expense: 50 }) }),
      categories: [
        ...categories,
        category({ id: 'propertyTax', parentId: 'housing', name: 'Property tax' }),
        category({ id: 'fines', name: 'Fines' }),
      ],
      sourceLevel: 1,
      expenseLevel: 2,
      topN: 10,
      taxCategoryIds: ['propertyTax', 'fines'],
    });

    expect(flow).toMatchObject({ expenses: 800, taxes: 150 });
    expect(flow.expenseGroups.map((g) => [g.id, g.leaves.map((l) => l.id)])).toEqual([
      ['housing', ['housing']],
      ['food', ['groceries']],
    ]);
    for (const group of flow.expenseGroups) expect(sumValues({ nodes: group.leaves })).toBe(group.value);
  });

  it('counts a category that is both savings and tax as savings only', () => {
    const flow = buildMoneyFlow({
      data: asResponse({ ...data, deposit: entry({ expense: 900 }) }),
      categories: [...categories, category({ id: 'deposit', parentId: 'housing', name: 'Deposit' })],
      sourceLevel: 1,
      expenseLevel: 1,
      topN: 10,
      savingsCategoryIds: ['deposit'],
      taxCategoryIds: ['deposit'],
    });

    expect(flow).toMatchObject({ taxes: 0, taxNodes: [] });
    expect(flow.savingsNodes).toEqual([{ id: 'deposit', name: 'Deposit', color: '#deposit', value: 900, share: 1 }]);
  });

  it('lists independent tax roots largest first with their share of taxes', () => {
    const flow = buildMoneyFlow({
      data: asResponse({ ...data, fines: entry({ expense: 100 }), vat: entry({ expense: 300 }) }),
      categories: [...categories, category({ id: 'fines', name: 'Fines' }), category({ id: 'vat', name: 'VAT' })],
      sourceLevel: 1,
      expenseLevel: 1,
      topN: 10,
      taxCategoryIds: ['fines', 'vat'],
    });

    expect(flow.taxes).toBe(400);
    expect(flow.taxNodes.map((n) => [n.id, n.value, n.share])).toEqual([
      ['vat', 300, 0.75],
      ['fines', 100, 0.25],
    ]);
  });

  it('funds taxes beyond income from a deficit', () => {
    const flow = buildMoneyFlow({
      data: asResponse({ salary: entry({ income: 100 }), housing: entry({ expense: 250 }) }),
      categories,
      sourceLevel: 1,
      expenseLevel: 1,
      topN: 10,
      taxCategoryIds: ['housing'],
    });

    expect(flow).toMatchObject({ expenses: 0, taxes: 250, net: -150, savings: 0, deficit: 150, expenseNodes: [] });
  });

  it('folds everything beyond topN into an "other" node', () => {
    const flow = buildMoneyFlow({ data, categories, sourceLevel: 3, expenseLevel: 1, topN: 1 });

    expect(flow.sources.map((n) => [n.id, n.value])).toEqual([
      ['salary', 1000],
      [OTHER_NODE_ID, 300],
    ]);
    expect(flow.sources[1]!.children!.map((n) => n.id)).toEqual(['bonus', 'gifts']);
    expect(flow.income).toBe(1300);
  });

  it('keeps a single leftover node instead of wrapping it in "other"', () => {
    const flow = buildMoneyFlow({ data, categories, sourceLevel: 2, expenseLevel: 1, topN: 1 });

    expect(flow.sources.map((n) => n.id)).toEqual(['salary', 'gifts']);
  });

  it('sums portfolio contributions across buckets', () => {
    const multiBucket = contributions({ amounts: { a: 100 } });
    multiBucket.buckets.push({ ...multiBucket.buckets[0]!, byPortfolio: [{ portfolioId: 'a', amount: 150 }] });
    const flow = buildMoneyFlow({
      data,
      categories,
      contributions: multiBucket,
      sourceLevel: 1,
      expenseLevel: 1,
      topN: 10,
    });

    expect(flow.savingsNodes.map((n) => [n.id, n.value])).toEqual([
      ['a', 250],
      [CASH_NODE_ID, 250],
    ]);
  });

  it('folds nodes below 1% of the total into "other" even within topN', () => {
    const flow = buildMoneyFlow({
      data: asResponse({
        salary: { name: 'Salary', color: '#0f0', income: 10000, expense: 0 },
        refund: { name: 'Refund', color: '#00f', income: 60, expense: 0 },
        gifts: { name: 'Gifts', color: '#f0f', income: 30, expense: 0 },
      }),
      categories: [],
      sourceLevel: 1,
      expenseLevel: 1,
      topN: 10,
    });

    expect(flow.sources.map((n) => [n.id, n.value])).toEqual([
      ['salary', 10000],
      [OTHER_NODE_ID, 90],
    ]);
    expect(flow.sources[1]!.children!.map((n) => n.id)).toEqual(['refund', 'gifts']);
  });

  it('drops non-positive amounts and unknown categories fall back to the response name', () => {
    const flow = buildMoneyFlow({
      data: asResponse({
        refund: { name: 'Refund', color: '#f00', income: 0, expense: -50 },
        ghost: { name: 'Ghost', color: '#0f0', income: 10, expense: 0 },
      }),
      categories,
      sourceLevel: 1,
      expenseLevel: 1,
      topN: 10,
    });

    expect(flow.expenseNodes).toEqual([]);
    expect(flow.sources).toEqual([expect.objectContaining({ id: 'ghost', name: 'Ghost', color: '#0f0', value: 10 })]);
    expect(flow.net).toBe(10);
  });
});

import type { CategoryModel, RecordId, endpointsTypes } from '@bt/shared/types';

export const OTHER_NODE_ID = 'other';
export const CASH_NODE_ID = 'cash';
export const DEFICIT_NODE_ID = 'deficit';

export interface MoneyFlowNode {
  id: string;
  name: string;
  color?: string;
  parentName?: string;
  value: number;
  /** Fraction of the node's own branch total (income, expenses, taxes or savings), not of its parent group. */
  share: number;
  /** Nodes folded into an "other" node, largest first. */
  children?: MoneyFlowNode[];
}

export interface MoneyFlowGroup extends MoneyFlowNode {
  /** The slice of `expenseNodes` this root category feeds: never empty, values sum to the group's `value`. */
  leaves: MoneyFlowNode[];
}

/** Nodes below this share of the total are folded into "other" even when they fit within topN. */
const MIN_SHARE = 0.01;
/** Subcategories shown per root category before the rest folds into that root's "other". */
const MAX_LEAVES_PER_GROUP = 6;

export interface MoneyFlow {
  income: number;
  expenses: number;
  /** Income left after expenses and taxes. */
  net: number;
  /** Spend on tax categories, kept out of `expenses`. */
  taxes: number;
  /** Outflow of the Savings node: net savings, or the invested + saved-to-category amount when larger. */
  savings: number;
  /** Shortfall covered from outside the period's income (overspend or investing from reserves). */
  deficit: number;
  /** Income sources plus, when the period needed more than it earned, a deficit node. */
  sources: MoneyFlowNode[];
  expenseNodes: MoneyFlowNode[];
  /** Root categories feeding `expenseNodes` when expenses show more than one level; empty otherwise. */
  expenseGroups: MoneyFlowGroup[];
  taxNodes: MoneyFlowNode[];
  savingsNodes: MoneyFlowNode[];
}

/** Category ids from the root down to `id` itself. */
const ancestorChain = ({ id, categoriesById }: { id: string; categoriesById: Record<string, CategoryModel> }) => {
  const chain: string[] = [];
  let current: CategoryModel | undefined = categoriesById[id];
  while (current && chain.length < 32) {
    chain.unshift(current.id);
    current = current.parentId ? categoriesById[current.parentId] : undefined;
  }
  return chain;
};

const resolveAncestorAtLevel = ({
  id,
  level,
  categoriesById,
}: {
  id: string;
  level: number;
  categoriesById: Record<string, CategoryModel>;
}): string => {
  const chain = ancestorChain({ id, categoriesById });
  if (chain.length === 0) return id;
  return chain[Math.min(level, chain.length) - 1]!;
};

const rollUp = ({
  data,
  pick,
  level,
  topN,
  shareOf,
  categoriesById,
}: {
  data: endpointsTypes.GetSpendingsByCategoriesByTypeReturnType;
  pick: (entry: endpointsTypes.SpendingStructureByType) => number;
  level: number;
  topN: number;
  /** Denominator for `share`; defaults to the sum of the rolled-up nodes. */
  shareOf?: number;
  categoriesById: Record<string, CategoryModel>;
}): MoneyFlowNode[] => {
  const totals = new Map<string, number>();
  for (const [id, entry] of Object.entries(data)) {
    const amount = pick(entry);
    if (amount <= 0) continue;
    const targetId = resolveAncestorAtLevel({ id, level, categoriesById });
    totals.set(targetId, (totals.get(targetId) ?? 0) + amount);
  }

  const total = shareOf ?? [...totals.values()].reduce((sum, v) => sum + v, 0);
  if (total === 0) return [];

  const nodes = [...totals.entries()]
    .map(([id, value]): MoneyFlowNode => {
      const category = categoriesById[id];
      const parent = category?.parentId ? categoriesById[category.parentId] : undefined;
      return {
        id,
        name: category?.name ?? data[id as RecordId]?.name ?? id,
        color: category?.color ?? data[id as RecordId]?.color,
        parentName: parent?.name,
        value,
        share: value / total,
      };
    })
    .sort((a, b) => b.value - a.value);

  const kept = nodes.slice(0, topN).filter((n) => n.share >= MIN_SHARE);
  if (nodes.length - kept.length <= 1) return nodes;

  const rest = nodes.slice(kept.length);
  const restValue = rest.reduce((sum, n) => sum + n.value, 0);
  return [...kept, { id: OTHER_NODE_ID, name: '', value: restValue, share: restValue / total, children: rest }];
};

const groupExpenses = ({
  data,
  roots,
  level,
  total,
  categoriesById,
}: {
  data: endpointsTypes.GetSpendingsByCategoriesByTypeReturnType;
  roots: MoneyFlowNode[];
  level: number;
  total: number;
  categoriesById: Record<string, CategoryModel>;
}): MoneyFlowGroup[] =>
  roots.map((root) => {
    if (root.id === OTHER_NODE_ID) return { ...root, leaves: [root] };
    const own = Object.fromEntries(
      Object.entries(data).filter(([id]) => resolveAncestorAtLevel({ id, level: 1, categoriesById }) === root.id),
    ) as endpointsTypes.GetSpendingsByCategoriesByTypeReturnType;
    const leaves = rollUp({
      data: own,
      pick: (e) => e.expense,
      level,
      topN: MAX_LEAVES_PER_GROUP,
      shareOf: total,
      categoriesById,
    }).map((leaf) => (leaf.id === OTHER_NODE_ID ? { ...leaf, parentName: root.name } : leaf));
    return { ...root, leaves };
  });

// Withdrawals (negative nets) are ignored: only money that left the period's cash counts.
const investedByDestination = ({
  contributions,
  ventures,
}: {
  contributions?: endpointsTypes.GetInvestmentContributionsResponse;
  ventures?: endpointsTypes.GetVentureContributionsResponse;
}) => {
  const totals = new Map<string, number>();
  for (const bucket of contributions?.buckets ?? []) {
    for (const slice of bucket.byPortfolio) {
      totals.set(slice.portfolioId, (totals.get(slice.portfolioId) ?? 0) + slice.amount);
    }
  }
  return [
    ...(contributions?.portfolios ?? []).map((p) => ({
      id: p.portfolioId,
      name: p.name,
      value: totals.get(p.portfolioId) ?? 0,
    })),
    ...(ventures ?? []).map((v) => ({ id: v.dealId, name: v.name, value: v.amount })),
  ].filter((n) => n.value > 0);
};

export const buildMoneyFlow = ({
  data,
  categories,
  contributions,
  ventures,
  sourceLevel,
  expenseLevel,
  topN,
  savingsCategoryIds,
  taxCategoryIds,
}: {
  data: endpointsTypes.GetSpendingsByCategoriesByTypeReturnType;
  categories: CategoryModel[];
  contributions?: endpointsTypes.GetInvestmentContributionsResponse;
  ventures?: endpointsTypes.GetVentureContributionsResponse;
  sourceLevel: number;
  expenseLevel: number;
  topN: number;
  /** Categories whose spend is a savings destination rather than an expense (subcategories inherit). */
  savingsCategoryIds?: string[];
  /**
   * Categories whose spend is a tax rather than an expense (subcategories inherit).
   * A category also covered by `savingsCategoryIds` counts as savings.
   */
  taxCategoryIds?: string[];
}): MoneyFlow => {
  const categoriesById = Object.fromEntries(categories.map((c) => [c.id, c]));
  const savingsIds = new Set(savingsCategoryIds);
  const taxIds = new Set(taxCategoryIds);

  // A savings category is neither income nor spend: its legs net into one savings destination,
  // grouped under the topmost selected ancestor because the picker selects whole subtrees.
  const spend: endpointsTypes.GetSpendingsByCategoriesByTypeReturnType = {};
  const savedByCategory = new Map<string, number>();
  // Only the expense side of a tax category leaves `spend`: a tax refund stays an income source.
  const taxByCategory = new Map<string, number>();
  for (const [id, entry] of Object.entries(data)) {
    const chain = ancestorChain({ id, categoriesById });
    const savingsTarget = chain.find((ancestorId) => savingsIds.has(ancestorId));
    if (savingsTarget) {
      const saved = entry.expense - entry.income;
      if (saved > 0) savedByCategory.set(savingsTarget, (savedByCategory.get(savingsTarget) ?? 0) + saved);
      continue;
    }
    const taxTarget = chain.find((ancestorId) => taxIds.has(ancestorId));
    if (taxTarget && entry.expense > 0) {
      taxByCategory.set(taxTarget, (taxByCategory.get(taxTarget) ?? 0) + entry.expense);
      spend[id as RecordId] = { ...entry, expense: 0 };
      continue;
    }
    spend[id as RecordId] = entry;
  }

  const sources = rollUp({ data: spend, pick: (e) => e.income, level: sourceLevel, topN, categoriesById });
  const expenseRoots = rollUp({ data: spend, pick: (e) => e.expense, level: 1, topN, categoriesById });

  const income = sources.reduce((sum, n) => sum + n.value, 0);
  const expenses = expenseRoots.reduce((sum, n) => sum + n.value, 0);
  const expenseGroups =
    expenseLevel > 1
      ? groupExpenses({ data: spend, roots: expenseRoots, level: expenseLevel, total: expenses, categoriesById })
      : [];
  const expenseNodes = expenseLevel > 1 ? expenseGroups.flatMap((group) => group.leaves) : expenseRoots;

  const taxes = [...taxByCategory.values()].reduce((sum, v) => sum + v, 0);
  const taxNodes: MoneyFlowNode[] = [...taxByCategory.entries()]
    .map(([id, value]) => ({
      id,
      name: categoriesById[id]?.name ?? id,
      color: categoriesById[id]?.color,
      value,
      share: value / taxes,
    }))
    .sort((a, b) => b.value - a.value);
  const net = income - expenses - taxes;

  const destinations = [
    ...investedByDestination({ contributions, ventures }),
    ...[...savedByCategory.entries()].map(([id, value]) => ({
      id,
      name: categoriesById[id]?.name ?? id,
      color: categoriesById[id]?.color,
      value,
    })),
  ].sort((a, b) => b.value - a.value);
  const destinationsTotal = destinations.reduce((sum, n) => sum + n.value, 0);
  const savings = Math.max(net, destinationsTotal, 0);
  const deficit = Math.max(0, expenses + taxes + savings - income);
  if (deficit > 0) {
    sources.push({ id: DEFICIT_NODE_ID, name: '', value: deficit, share: 0 });
    for (const node of sources) node.share = node.value / (income + deficit);
  }

  const savingsNodes: MoneyFlowNode[] = destinations.map((n) => ({ ...n, share: n.value / savings }));
  const cash = savings - destinationsTotal;
  if (cash > 0) {
    savingsNodes.push({ id: CASH_NODE_ID, name: '', value: cash, share: cash / savings });
  }

  return {
    income,
    expenses,
    net,
    taxes,
    savings,
    deficit,
    sources,
    expenseNodes,
    expenseGroups,
    taxNodes,
    savingsNodes,
  };
};

export const formatShare = (share: number) => `${Math.round(share * 100)}%`;

export const pctOfIncome = ({
  value,
  income,
  t,
}: {
  value: number;
  income: number;
  t: (key: string, named: Record<string, unknown>) => string;
}) => (income > 0 ? t('analytics.cashFlow.composition.pctOfIncome', { pct: formatShare(value / income) }) : '');

const SYNTHETIC_LABEL_KEYS: Record<string, string> = {
  [OTHER_NODE_ID]: 'analytics.cashFlow.composition.other',
  [CASH_NODE_ID]: 'analytics.cashFlow.composition.keptAsCash',
  [DEFICIT_NODE_ID]: 'analytics.cashFlow.composition.deficit',
};

export const nodeLabel = ({ node, t }: { node: MoneyFlowNode; t: (key: string) => string }) => {
  const key = SYNTHETIC_LABEL_KEYS[node.id];
  return key ? t(key) : node.name;
};

export const nodeColor = ({
  node,
  colors,
  fallback,
}: {
  node: MoneyFlowNode;
  colors: { text: string; warningText: string };
  fallback: string;
}) => {
  if (node.id === DEFICIT_NODE_ID) return colors.warningText;
  if (node.id in SYNTHETIC_LABEL_KEYS) return colors.text;
  return node.color ?? fallback;
};

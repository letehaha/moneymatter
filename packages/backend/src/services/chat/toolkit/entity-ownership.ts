import type { ChatEntityKind, ChatEntityRef } from '@bt/shared/types';
import Accounts from '@models/accounts.model';
import BankDataProviderConnections from '@models/bank-data-provider-connections.model';
import BudgetPlans from '@models/budget-plans.model';
import Categories from '@models/categories.model';
import ImportBatches from '@models/import-batches.model';
import Holdings from '@models/investments/holdings.model';
import Portfolios from '@models/investments/portfolios.model';
import Securities from '@models/investments/securities.model';
import Notifications from '@models/notifications.model';
import Payees from '@models/payees.model';
import Subscriptions from '@models/subscriptions.model';
import Tags from '@models/tags.model';
import Trackers from '@models/trackers.model';
import TransactionAutomations from '@models/transaction-automations.model';
import TransactionGroups from '@models/transaction-groups.model';
import Transactions from '@models/transactions.model';
import Vehicles from '@models/vehicles.model';
import VentureDeals from '@models/venture/venture-deals.model';
import VenturePlatforms from '@models/venture/venture-platforms.model';
import type { Model, ModelStatic } from 'sequelize';

/**
 * The kinds a table cell can link to. Each has a `userId` column, so ownership is one query. A kind
 * outside this list cannot be checked and is refused, so no link is ever drawn on trust.
 */
const OWNED_MODELS: Partial<Record<ChatEntityKind, ModelStatic<Model>>> = {
  transaction: Transactions,
  account: Accounts,
  category: Categories,
  tag: Tags,
  payee: Payees,
  tracker: Trackers,
  subscription: Subscriptions,
  vehicle: Vehicles,
  portfolio: Portfolios,
  // A loan is the account that carries the loan details, and its page is addressed by the account id.
  loan: Accounts,
  budgetPlan: BudgetPlans,
  transactionGroup: TransactionGroups,
  transactionAutomation: TransactionAutomations,
  venturePlatform: VenturePlatforms,
  ventureDeal: VentureDeals,
  bankConnection: BankDataProviderConnections,
  notification: Notifications,
  importBatch: ImportBatches,
};

/** The kinds whose public id is not the `id` column. */
const ID_COLUMNS: Partial<Record<ChatEntityKind, string>> = {
  importBatch: 'batchId',
};

type LabelRow = Record<string, unknown>;

/** What to read besides `id` to name a kind, and how to turn the row into a display name. */
const LABEL_SOURCES: Partial<Record<ChatEntityKind, { attributes: string[]; label: (row: LabelRow) => string }>> = {
  account: { attributes: ['name'], label: (row) => String(row.name) },
  category: { attributes: ['name'], label: (row) => String(row.name) },
  tag: { attributes: ['name'], label: (row) => String(row.name) },
  payee: { attributes: ['name'], label: (row) => String(row.name) },
  tracker: { attributes: ['name'], label: (row) => String(row.name) },
  subscription: { attributes: ['name'], label: (row) => String(row.name) },
  portfolio: { attributes: ['name'], label: (row) => String(row.name) },
  loan: { attributes: ['name'], label: (row) => String(row.name) },
  budgetPlan: { attributes: ['name'], label: (row) => String(row.name) },
  transactionGroup: { attributes: ['name'], label: (row) => String(row.name) },
  transactionAutomation: { attributes: ['name'], label: (row) => String(row.name) },
  venturePlatform: { attributes: ['name'], label: (row) => String(row.name) },
  ventureDeal: { attributes: ['name'], label: (row) => String(row.name) },
  bankConnection: { attributes: ['providerName'], label: (row) => String(row.providerName) },
  notification: { attributes: ['title'], label: (row) => String(row.title) },
  vehicle: {
    attributes: ['year', 'make', 'model'],
    label: (row) => `${row.year} ${row.make} ${row.model}`,
  },
};

/** The securities the user holds in any of their portfolios, by id, with a name to show. */
async function ownedHoldingSecurities({
  userId,
  securityIds,
}: {
  userId: number;
  securityIds: string[];
}): Promise<Map<string, string>> {
  const portfolios = await Portfolios.findAll({ where: { userId }, attributes: ['id'], raw: true });
  if (portfolios.length === 0) return new Map();

  const holdings = (await Holdings.findAll({
    where: { portfolioId: portfolios.map(({ id }) => id), securityId: securityIds },
    attributes: ['securityId'],
    raw: true,
  })) as unknown as Array<{ securityId: string }>;
  const heldIds = [...new Set(holdings.map(({ securityId }) => securityId))];
  if (heldIds.length === 0) return new Map();

  const securities = (await Securities.findAll({
    where: { id: heldIds },
    attributes: ['id', 'name', 'symbol'],
    raw: true,
  })) as unknown as Array<{ id: string; name: string | null; symbol: string | null }>;

  return new Map(securities.map((security) => [security.id, (security.symbol ?? security.name ?? '').trim()]));
}

export const entityKey = ({ kind, id }: ChatEntityRef): string => `${kind}:${id}`;

/**
 * Checks the refs against the user's rows with one query per kind. `foreign` lists the refs that do
 * not name a row of this user (or whose kind cannot be checked); `labels` maps `entityKey` to the
 * display name of every owned row whose kind has one.
 */
export async function lookupEntities({ userId, refs }: { userId: number; refs: ChatEntityRef[] }): Promise<{
  foreign: ChatEntityRef[];
  labels: Map<string, string>;
}> {
  const idsByKind = new Map<ChatEntityKind, Set<string>>();
  for (const { kind, id } of refs) idsByKind.set(kind, (idsByKind.get(kind) ?? new Set()).add(id));

  const foreign: ChatEntityRef[] = [];
  const labels = new Map<string, string>();

  for (const [kind, ids] of idsByKind) {
    if (kind === 'holding') {
      // A holding is a security in one of the user's portfolios; the page names it by the security id.
      const held = await ownedHoldingSecurities({ userId, securityIds: [...ids] });
      foreign.push(...[...ids].filter((id) => !held.has(id)).map((id) => ({ kind, id })));
      for (const [id, label] of held) if (label) labels.set(entityKey({ kind, id }), label);
      continue;
    }

    const model = OWNED_MODELS[kind];
    if (!model) {
      foreign.push(...[...ids].map((id) => ({ kind, id })));
      continue;
    }

    const source = LABEL_SOURCES[kind];
    const idColumn = ID_COLUMNS[kind];
    const owned = (await model.findAll({
      where: { userId, [idColumn ?? 'id']: [...ids] },
      attributes: [idColumn ? [idColumn, 'id'] : 'id', ...(source?.attributes ?? [])],
      raw: true,
    })) as unknown as LabelRow[];
    const ownedIds = new Set<string>();

    for (const row of owned) {
      const id = String(row.id);
      ownedIds.add(id);

      const label = source?.label(row).trim();
      if (label) labels.set(entityKey({ kind, id }), label);
    }

    foreign.push(...[...ids].filter((id) => !ownedIds.has(id)).map((id) => ({ kind, id })));
  }

  return { foreign, labels };
}

/** The refs that do not name a row of this user, or whose kind cannot be checked. */
export async function findForeignEntities({
  userId,
  refs,
}: {
  userId: number;
  refs: ChatEntityRef[];
}): Promise<ChatEntityRef[]> {
  return (await lookupEntities({ userId, refs })).foreign;
}

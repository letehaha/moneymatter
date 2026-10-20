import { chatEntityRefKey, type ChatEntityKind, TRANSACTION_TYPES } from '@bt/shared/types';
import AccountGroups from '@models/accounts-groups/account-groups.model';
import Accounts from '@models/accounts.model';
import BudgetLineGroups from '@models/budget-line-groups.model';
import BudgetLines from '@models/budget-lines.model';
import BudgetPlans from '@models/budget-plans.model';
import ImportBatches from '@models/import-batches.model';
import Portfolios from '@models/investments/portfolios.model';
import LoanDetails from '@models/loan-details.model';
import Payees from '@models/payees.model';
import Subscriptions from '@models/subscriptions.model';
import Trackers from '@models/trackers.model';
import TransactionAutomations from '@models/transaction-automations.model';
import TransactionGroups from '@models/transaction-groups.model';
import TransactionTemplates from '@models/transaction-templates.model';
import { findTransactions } from '@models/transactions-query';
import type Transactions from '@models/transactions.model';
import Vehicles from '@models/vehicles.model';
import VentureDeals from '@models/venture/venture-deals.model';
import VentureEvents from '@models/venture/venture-events.model';
import VenturePlatforms from '@models/venture/venture-platforms.model';
import { Op, type Model, type ModelStatic, type WhereOptions } from 'sequelize';

import type { ResolvedToolPolicy } from '../policies/rules';
import { SAMPLE_ROW_LIMIT, TRANSACTION_SAMPLE_ATTRIBUTES } from './previews/preview-helpers';

/**
 * The kinds the frontend names from lists it already holds (accounts, categories, tags, payees,
 * currencies). Every other kind has no list there, so a card would show only its kind
 * ("Subscription", "Transaction") unless the server names the record.
 */
const NAMED_BY_THE_APP = new Set<ChatEntityKind>([
  'account',
  'category',
  'tag',
  'payee',
  'userCurrency',
  'customCurrency',
]);

/** Ids named per argument; a card with more lists the first ones, the rest stay unnamed. */
const LABELED_IDS_PER_FIELD = SAMPLE_ROW_LIMIT;

type Row = Record<string, unknown>;

interface NamedModel {
  model: ModelStatic<Model>;
  attributes: string[];
  label: (row: Row) => string;
}

const byName = ({ model }: { model: ModelStatic<Model> }): NamedModel => ({
  model,
  attributes: ['name'],
  label: (row) => String(row.name),
});

/** Kinds read by their id and the `userId` column. */
const OWNED_BY_USER: Partial<Record<ChatEntityKind, NamedModel>> = {
  subscription: byName({ model: Subscriptions }),
  tracker: byName({ model: Trackers }),
  budgetPlan: byName({ model: BudgetPlans }),
  accountGroup: byName({ model: AccountGroups }),
  transactionGroup: byName({ model: TransactionGroups }),
  transactionAutomation: byName({ model: TransactionAutomations }),
  transactionTemplate: byName({ model: TransactionTemplates }),
  venturePlatform: byName({ model: VenturePlatforms }),
  ventureDeal: byName({ model: VentureDeals }),
  portfolio: byName({ model: Portfolios }),
  vehicle: {
    model: Vehicles,
    attributes: ['year', 'make', 'model'],
    label: (row) => `${row.year} ${row.make} ${row.model}`,
  },
  ventureEvent: {
    model: VentureEvents,
    attributes: ['type', 'eventDate'],
    label: (row) => `${row.type} ${row.eventDate}`,
  },
};

/** The `name` of the rows with these ids; the caller has already limited the ids to rows it may show. */
const namesOf = async ({ model, ids }: { model: ModelStatic<Model>; ids: string[] }): Promise<Map<string, string>> => {
  const rows = (await model.findAll({
    where: { id: ids },
    attributes: ['id', 'name'],
    raw: true,
  })) as unknown as Array<{
    id: string;
    name: string;
  }>;
  return new Map(rows.map((row) => [row.id, row.name]));
};

const isoDay = ({ time }: { time: Date | string }) => new Date(time).toISOString().slice(0, 10);

/** `2026-10-05 · -9.99 USD · Netflix · Main card`: what tells one transaction from another in a line. */
const transactionLabel = ({
  row,
  accountName,
  payeeName,
}: {
  row: Transactions;
  accountName: string | undefined;
  payeeName: string | undefined;
}): string => {
  const sign = row.transactionType === TRANSACTION_TYPES.expense ? '-' : '+';
  const note = row.note?.trim();
  return [
    isoDay({ time: row.time }),
    `${sign}${row.amount.abs().toNumber()} ${row.currencyCode}`,
    payeeName ?? (note ? note.slice(0, 60) : undefined),
    accountName,
  ]
    .filter((part): part is string => Boolean(part))
    .join(' · ');
};

async function labelTransactions({
  userId,
  ids,
  labels,
}: {
  userId: number;
  ids: string[];
  labels: Map<string, string>;
}) {
  // Access follows the account, as the services' own reads do, so a shared account's rows are named too.
  const rows = await findTransactions({
    planned: 'include',
    access: { accessibleTo: userId },
    balanceAdjustments: 'include',
    completeness: 'all',
    attributes: TRANSACTION_SAMPLE_ATTRIBUTES,
    where: { id: ids },
  });
  if (rows.length === 0) return;

  const accountIds = [...new Set(rows.map((row) => row.accountId))];
  const payeeIds = [...new Set(rows.flatMap((row) => (row.payeeId ? [row.payeeId] : [])))];
  const [accountNames, payeeNames] = await Promise.all([
    namesOf({ model: Accounts, ids: accountIds }),
    payeeIds.length > 0 ? namesOf({ model: Payees, ids: payeeIds }) : new Map<string, string>(),
  ]);

  for (const row of rows) {
    labels.set(
      chatEntityRefKey({ kind: 'transaction', id: row.id }),
      transactionLabel({
        row,
        accountName: accountNames.get(row.accountId),
        payeeName: row.payeeId ? payeeNames.get(row.payeeId) : undefined,
      }),
    );
  }
}

async function labelBudgetPlanParts({
  userId,
  kind,
  ids,
  labels,
}: {
  userId: number;
  kind: 'budgetPlanLine' | 'budgetPlanGroup';
  ids: string[];
  labels: Map<string, string>;
}) {
  const model = (kind === 'budgetPlanLine' ? BudgetLines : BudgetLineGroups) as ModelStatic<Model>;
  const rows = (await model.findAll({
    where: { id: ids },
    attributes: ['id', 'name', 'planId'],
    raw: true,
  })) as unknown as Array<{
    id: string;
    name: string;
    planId: string;
  }>;
  if (rows.length === 0) return;

  // A line or group is named only when its plan is the user's.
  const plans = await BudgetPlans.findAll({
    where: { id: [...new Set(rows.map((row) => row.planId))], userId },
    attributes: ['id'],
  });
  const ownedPlans = new Set<string>(plans.map((plan) => plan.id));
  for (const row of rows) {
    if (ownedPlans.has(row.planId) && row.name.trim())
      labels.set(chatEntityRefKey({ kind, id: row.id }), row.name.trim());
  }
}

/** An import batch is named by what it came from and when; a card holds its `batchId`, not the row id. */
async function labelImportBatches({
  userId,
  ids,
  labels,
}: {
  userId: number;
  ids: string[];
  labels: Map<string, string>;
}) {
  const batches = await ImportBatches.findAll({
    where: { batchId: ids, userId },
    attributes: ['batchId', 'source', 'importedAt'],
  });
  for (const batch of batches) {
    labels.set(
      chatEntityRefKey({ kind: 'importBatch', id: batch.batchId }),
      `${batch.source} · ${isoDay({ time: batch.importedAt })}`,
    );
  }
}

/** A loan is its account, so it is named like one. */
async function labelLoans({ userId, ids, labels }: { userId: number; ids: string[]; labels: Map<string, string> }) {
  const loans = await LoanDetails.findAll({ where: { accountId: ids, userId }, attributes: ['accountId'], raw: true });
  if (loans.length === 0) return;

  const names = await namesOf({ model: Accounts, ids: loans.map((loan) => loan.accountId) });
  for (const [id, name] of names) labels.set(chatEntityRefKey({ kind: 'loan', id }), name);
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** The ids among a value: a proposal ref names no row yet, and a model may write a name where an id belongs. */
const idsOf = ({ value }: { value: unknown }): string[] =>
  (Array.isArray(value) ? value : [value]).filter(
    (item): item is string => typeof item === 'string' && UUID.test(item),
  );

/**
 * Names the records a card's arguments point at when the frontend has no list to name them from:
 * the subscription a link call names, the transactions it links, the plan a line belongs to. Read
 * from the user's own rows only, so a record that is not theirs stays unnamed, and the card falls
 * back to its kind. At most ten records per argument are named.
 */
export async function resolveCardLabels({
  userId,
  policy,
  args,
}: {
  userId: number;
  policy: Pick<ResolvedToolPolicy, 'entityFields'>;
  args: Record<string, unknown>;
}): Promise<Record<string, string>> {
  const idsByKind = new Map<ChatEntityKind, Set<string>>();
  for (const [field, kind] of Object.entries(policy.entityFields)) {
    if (NAMED_BY_THE_APP.has(kind) || !(field in args)) continue;

    const ids = idsOf({ value: args[field] }).slice(0, LABELED_IDS_PER_FIELD);
    if (ids.length === 0) continue;

    const known = idsByKind.get(kind) ?? new Set<string>();
    for (const id of ids) known.add(id);
    idsByKind.set(kind, known);
  }

  const labels = new Map<string, string>();
  for (const [kind, set] of idsByKind) {
    const ids = [...set];
    if (kind === 'transaction') await labelTransactions({ userId, ids, labels });
    else if (kind === 'budgetPlanLine' || kind === 'budgetPlanGroup')
      await labelBudgetPlanParts({ userId, kind, ids, labels });
    else if (kind === 'importBatch') await labelImportBatches({ userId, ids, labels });
    else if (kind === 'loan') await labelLoans({ userId, ids, labels });
    else {
      const source = OWNED_BY_USER[kind];
      if (!source) continue;

      const where: WhereOptions = { id: { [Op.in]: ids }, userId };
      const rows = (await source.model.findAll({
        where,
        attributes: ['id', ...source.attributes],
        raw: true,
      })) as unknown as Row[];
      for (const row of rows) {
        const label = source.label(row).trim();
        if (label) labels.set(chatEntityRefKey({ kind, id: String(row.id) }), label);
      }
    }
  }

  return Object.fromEntries(labels);
}

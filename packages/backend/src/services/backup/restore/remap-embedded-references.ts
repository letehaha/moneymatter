import {
  type AutomationAction,
  type AutomationConditionField,
  type AutomationConditions,
  type FireSettings,
  getPortfolioIdFromIndicatorId,
  isPortfolioIndicatorId,
  makePortfolioIndicatorId,
  type RecordId,
} from '@bt/shared/types';
import AccountGroup from '@models/accounts-groups/account-groups.model';
import Accounts from '@models/accounts.model';
import BankDataProviderConnections from '@models/bank-data-provider-connections.model';
import Budgets from '@models/budget.model';
import Categories from '@models/categories.model';
import PortfolioTransfers from '@models/investments/portfolio-transfers.model';
import Portfolios from '@models/investments/portfolios.model';
import Notifications from '@models/notifications.model';
import Payees from '@models/payees.model';
import SubscriptionCandidates from '@models/subscription-candidates.model';
import Subscriptions from '@models/subscriptions.model';
import Tags from '@models/tags.model';
import TransactionAutomations from '@models/transaction-automations.model';
import Transactions from '@models/transactions.model';
import VentureEventLinks from '@models/venture/venture-event-links.model';
import { Model, type ModelStatic, type Transaction } from 'sequelize';

import type { BackupFileName } from '../registry';
import type { ParsedArchive } from './load-archive';

type AnyModel = ModelStatic<Model>;

/** Per-table backup id → final id map, keyed by DB table name. */
type InsertedIds = Map<string, Map<string, string>>;

/**
 * Replace an embedded id with the id it was restored under, or leave it as-is
 * when the map has no entry (a foreign id, or a self-host id that maps to
 * itself). Embedded ids are soft metadata, so an unmapped one is never dropped.
 */
function remapId({
  insertedIds,
  targetTable,
  oldId,
}: {
  insertedIds: InsertedIds;
  targetTable: string;
  oldId: string;
}): string {
  return insertedIds.get(targetTable)?.get(oldId) ?? oldId;
}

/** Remap each string element of an id array in place, leaving non-strings and
 *  unmapped ids untouched. Used for both JSONB arrays and Postgres UUID arrays. */
function remapIdArrayInPlace({
  arr,
  targetTable,
  insertedIds,
}: {
  arr: unknown;
  targetTable: string;
  insertedIds: InsertedIds;
}): void {
  if (!Array.isArray(arr)) return;
  for (let i = 0; i < arr.length; i += 1) {
    if (typeof arr[i] === 'string') arr[i] = remapId({ insertedIds, targetTable, oldId: arr[i] });
  }
}

/**
 * Rewrite one embedded-id column for a site table. Iterates the table's archive
 * rows, finds each row's restored final id, deep-clones its original blob, lets
 * `mutate` remap the embedded ids in place, and issues one UPDATE per row whose
 * blob actually changed. A row missing from the own map wasn't inserted
 * (dropped/forged) and is skipped; an unchanged blob issues no UPDATE, so a
 * self-host restore where every id maps to itself stays a no-op.
 */
async function rewriteColumn({
  model,
  fileName,
  column,
  archive,
  insertedIds,
  transaction,
  mutate,
}: {
  model: AnyModel;
  fileName: BackupFileName;
  column: string;
  archive: ParsedArchive;
  insertedIds: InsertedIds;
  transaction: Transaction;
  mutate: (params: { draft: unknown }) => void;
}): Promise<void> {
  const rows = archive.data.get(fileName);
  if (!rows || rows.length === 0) return;
  const ownMap = insertedIds.get(String(model.getTableName()));
  if (!ownMap) return;

  for (const row of rows) {
    const finalId = ownMap.get(String(row.id));
    if (finalId === undefined) continue;

    const original = row[column];
    if (original == null) continue;

    const originalJson = JSON.stringify(original);
    const draft = JSON.parse(originalJson);
    mutate({ draft });
    if (JSON.stringify(draft) === originalJson) continue;

    await model.update({ [column]: draft }, { where: { id: finalId }, transaction });
  }
}

/**
 * Post-insert pass that rewrites owned ids embedded in JSONB / array columns,
 * which the scalar FK remap in the tiered insert loop never touches. Runs after
 * the whole loop so every owned table's id map is complete, inside the restore
 * transaction. See `restore-tables.ts` for the map's shape.
 */
export async function remapEmbeddedReferences({
  archive,
  insertedIds,
  transaction,
}: {
  archive: ParsedArchive;
  insertedIds: InsertedIds;
  transaction: Transaction;
}): Promise<void> {
  // DB table names read live so they can't drift from the models.
  const tables = {
    transactions: String(Transactions.getTableName()),
    subscriptions: String(Subscriptions.getTableName()),
    payees: String(Payees.getTableName()),
    accounts: String(Accounts.getTableName()),
    budgets: String(Budgets.getTableName()),
    tags: String(Tags.getTableName()),
    categories: String(Categories.getTableName()),
    accountGroups: String(AccountGroup.getTableName()),
    bankConnections: String(BankDataProviderConnections.getTableName()),
    transactionAutomations: String(TransactionAutomations.getTableName()),
  };

  // Shared by the two link tables that snapshot a transaction's pre-link state.
  // Only categoryId/accountId are owned ids; transferId is a shared token — leave it.
  const mutateOriginalTransactionState = ({ draft }: { draft: unknown }): void => {
    if (typeof draft !== 'object' || draft === null) return;
    const state = (draft as { originalTransactionState?: unknown }).originalTransactionState;
    if (typeof state !== 'object' || state === null) return;
    const s = state as Record<string, unknown>;
    if (typeof s.categoryId === 'string')
      s.categoryId = remapId({ insertedIds, targetTable: tables.categories, oldId: s.categoryId });
    if (typeof s.accountId === 'string')
      s.accountId = remapId({ insertedIds, targetTable: tables.accounts, oldId: s.accountId });
  };

  // 1. SubscriptionCandidates.sampleTransactionIds[] → Transactions.
  await rewriteColumn({
    model: SubscriptionCandidates,
    fileName: 'subscription-candidates',
    column: 'sampleTransactionIds',
    archive,
    insertedIds,
    transaction,
    mutate: ({ draft }) => remapIdArrayInPlace({ arr: draft, targetTable: tables.transactions, insertedIds }),
  });

  // 2. Transactions.categorizationMeta → subscriptionId (Subscriptions), payeeId (Payees).
  await rewriteColumn({
    model: Transactions,
    fileName: 'transactions',
    column: 'categorizationMeta',
    archive,
    insertedIds,
    transaction,
    mutate: ({ draft }) => {
      if (typeof draft !== 'object' || draft === null) return;
      const meta = draft as Record<string, unknown>;
      if (typeof meta.subscriptionId === 'string')
        meta.subscriptionId = remapId({ insertedIds, targetTable: tables.subscriptions, oldId: meta.subscriptionId });
      if (typeof meta.payeeId === 'string')
        meta.payeeId = remapId({ insertedIds, targetTable: tables.payees, oldId: meta.payeeId });
      if (typeof meta.ruleId === 'string')
        meta.ruleId = remapId({ insertedIds, targetTable: tables.transactionAutomations, oldId: meta.ruleId });
    },
  });

  // 3. Subscriptions.matchingRules → rules[] with field 'accountId', value → Accounts.
  await rewriteColumn({
    model: Subscriptions,
    fileName: 'subscriptions',
    column: 'matchingRules',
    archive,
    insertedIds,
    transaction,
    mutate: ({ draft }) => {
      if (typeof draft !== 'object' || draft === null) return;
      const rules = (draft as { rules?: unknown }).rules;
      if (!Array.isArray(rules)) return;
      for (const rule of rules) {
        if (rule && rule.field === 'accountId' && typeof rule.value === 'string')
          rule.value = remapId({ insertedIds, targetTable: tables.accounts, oldId: rule.value });
      }
    },
  });

  // 4. TransactionAutomations.conditions → account / accountGroup / bankConnection / payee id lists.
  const conditionTargetTables: Record<AutomationConditionField, string | null> = {
    account: tables.accounts,
    accountGroup: tables.accountGroups,
    bankConnection: tables.bankConnections,
    payee: tables.payees,
    note: null,
    merchant: null,
    amount: null,
    transactionType: null,
    dayOfMonth: null,
  };
  await rewriteColumn({
    model: TransactionAutomations,
    fileName: 'transaction-automations',
    column: 'conditions',
    archive,
    insertedIds,
    transaction,
    mutate: ({ draft }) => {
      if (typeof draft !== 'object' || draft === null) return;
      const { items } = draft as AutomationConditions;
      if (!Array.isArray(items)) return;
      for (const item of items) {
        const targetTable = conditionTargetTables[item.field];
        if (targetTable) remapIdArrayInPlace({ arr: item.value, targetTable, insertedIds });
      }
    },
  });

  // 5. TransactionAutomations.actions → set_category.categoryId, add_tags.tagIds[], set_payee.payeeId.
  await rewriteColumn({
    model: TransactionAutomations,
    fileName: 'transaction-automations',
    column: 'actions',
    archive,
    insertedIds,
    transaction,
    mutate: ({ draft }) => {
      if (!Array.isArray(draft)) return;
      for (const action of draft as AutomationAction[]) {
        if (action.type === 'set_category' && typeof action.categoryId === 'string')
          action.categoryId = remapId({
            insertedIds,
            targetTable: tables.categories,
            oldId: action.categoryId,
          }) as RecordId;
        if (action.type === 'add_tags')
          remapIdArrayInPlace({ arr: action.tagIds, targetTable: tables.tags, insertedIds });
        if (action.type === 'set_payee' && typeof action.payeeId === 'string')
          action.payeeId = remapId({ insertedIds, targetTable: tables.payees, oldId: action.payeeId }) as RecordId;
      }
    },
  });

  // 6. Notifications.payload → budgetId (Budgets), tagId (Tags), transactionIds[] (Transactions).
  //    Share payloads' invitationId/shareId/resourceId reference cross-user data
  //    that isn't restored, so they're left verbatim.
  await rewriteColumn({
    model: Notifications,
    fileName: 'notifications',
    column: 'payload',
    archive,
    insertedIds,
    transaction,
    mutate: ({ draft }) => {
      if (typeof draft !== 'object' || draft === null) return;
      const p = draft as Record<string, unknown>;
      if (typeof p.budgetId === 'string')
        p.budgetId = remapId({ insertedIds, targetTable: tables.budgets, oldId: p.budgetId });
      if (typeof p.tagId === 'string') p.tagId = remapId({ insertedIds, targetTable: tables.tags, oldId: p.tagId });
      remapIdArrayInPlace({ arr: p.transactionIds, targetTable: tables.transactions, insertedIds });
    },
  });

  // 7. PortfolioTransfers.metaData.originalTransactionState → categoryId, accountId.
  await rewriteColumn({
    model: PortfolioTransfers,
    fileName: 'portfolio-transfers',
    column: 'metaData',
    archive,
    insertedIds,
    transaction,
    mutate: mutateOriginalTransactionState,
  });

  // 8. VentureEventLinks.metaData.originalTransactionState → categoryId, accountId.
  await rewriteColumn({
    model: VentureEventLinks,
    fileName: 'venture-event-links',
    column: 'metaData',
    archive,
    insertedIds,
    transaction,
    mutate: mutateOriginalTransactionState,
  });
}

/**
 * Remap the owned-id arrays embedded in each saved Pivot view's config on the
 * already-parsed settings object, before it's written. Mutates in place. Only
 * accountIds/categoryIds/payeeIds carry owned ids; dashboard widget configs are
 * an open-ended record and are intentionally left untouched.
 */
export function remapSavedPivotViewIds({ views, insertedIds }: { views: unknown; insertedIds: InsertedIds }): void {
  if (!Array.isArray(views)) return;
  const accounts = String(Accounts.getTableName());
  const categories = String(Categories.getTableName());
  const payees = String(Payees.getTableName());

  for (const view of views) {
    const config = view?.config;
    if (typeof config !== 'object' || config === null) continue;
    remapIdArrayInPlace({ arr: config.accountIds, targetTable: accounts, insertedIds });
    remapIdArrayInPlace({ arr: config.categoryIds, targetTable: categories, insertedIds });
    remapIdArrayInPlace({ arr: config.payeeIds, targetTable: payees, insertedIds });
  }
}

/** Remap FIRE category ids and the `portfolio:<id>` return indicator in place. Every restored
 *  row is in `insertedIds`, so an unmapped id is dangling: it's dropped, and the indicator falls
 *  back to its default. */
export function remapFireSettingsIds({
  fire,
  insertedIds,
}: {
  fire: FireSettings | undefined;
  insertedIds: InsertedIds;
}): void {
  if (!fire) return;
  const categories = insertedIds.get(String(Categories.getTableName()));
  const portfolios = insertedIds.get(String(Portfolios.getTableName()));

  if (fire.spendingExcludedCategoryIds) {
    fire.spendingExcludedCategoryIds = fire.spendingExcludedCategoryIds.flatMap((id) => categories?.get(id) ?? []);
  }
  if (fire.returnIndicatorId && isPortfolioIndicatorId({ id: fire.returnIndicatorId })) {
    const portfolioId = portfolios?.get(getPortfolioIdFromIndicatorId({ id: fire.returnIndicatorId }));
    if (portfolioId) fire.returnIndicatorId = makePortfolioIndicatorId({ portfolioId });
    else delete fire.returnIndicatorId;
  }
}

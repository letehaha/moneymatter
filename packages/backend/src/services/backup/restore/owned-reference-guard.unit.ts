import { describe, expect, it } from '@jest/globals';

import { BACKUP_TABLES } from '../registry';
import { buildGuardedReferenceMap } from './owned-reference-guard';

/**
 * The user-owned foreign-key columns every restore must validate, transcribed
 * from the live DB's information_schema (user-owned targets only — userId /
 * ownerUserId / currencyCode / securityId / mccId are intentionally excluded).
 * Includes the self-ref parents (categories.parentId, account-groups
 * .parentGroupId, transactions.mergedIntoId). This is the source of truth: the derived map must match it
 * exactly, so a future FK to a user-owned table that the guard misses fails here.
 */
const EXPECTED_GUARDED_COLUMNS: Record<string, string[]> = {
  'account-groupings': ['accountId', 'groupId'],
  'account-groups': ['bankDataProviderConnectionId', 'parentGroupId'],
  accounts: ['bankDataProviderConnectionId'],
  balances: ['accountId'],
  'budget-categories': ['budgetId', 'categoryId'],
  'budget-transactions': ['budgetId', 'transactionId'],
  categories: ['parentId'],
  holdings: ['portfolioId'],
  'investment-transactions': ['portfolioId'],
  'loan-details': ['accountId'],
  'payee-aliases': ['payeeId'],
  'payee-tags': ['payeeId', 'tagId'],
  payees: ['defaultCategoryId'],
  'portfolio-balances': ['portfolioId'],
  'portfolio-transfers': ['fromAccountId', 'toAccountId', 'fromPortfolioId', 'toPortfolioId', 'transactionId'],
  'refund-transactions': ['originalTxId', 'refundTxId', 'splitId'],
  'subscription-candidates': ['accountId', 'subscriptionId'],
  'subscription-period-notifications': ['periodId'],
  'subscription-periods': ['subscriptionId', 'transactionId'],
  'subscription-tags': ['subscriptionId', 'tagId'],
  'subscription-transactions': ['subscriptionId', 'transactionId'],
  subscriptions: ['accountId', 'categoryId', 'payeeId'],
  'tag-reminders': ['tagId'],
  'transaction-group-items': ['groupId', 'transactionId'],
  'transaction-splits': ['categoryId', 'transactionId'],
  'transaction-tags': ['tagId', 'transactionId'],
  'transaction-template-tags': ['tagId', 'templateId'],
  'transaction-templates': ['accountId', 'categoryId', 'payeeId'],
  transactions: ['accountId', 'categoryId', 'mergedIntoId', 'payeeId'],
  'transfer-suggestion-dismissals': ['expenseTransactionId', 'incomeTransactionId'],
  'user-merchant-category-codes': ['categoryId'],
  vehicles: ['accountId'],
  'venture-deals': ['platformId'],
  'venture-event-links': ['transactionId', 'ventureEventId'],
  'venture-events': ['dealId'],
};

// `@models/index` builds the Sequelize instance so `getAttributes()` is populated.
// Dummy connection params make construction succeed without touching a database.
async function loadModels() {
  process.env.APPLICATION_DB_DIALECT ??= 'postgres';
  process.env.APPLICATION_DB_HOST ??= 'localhost';
  process.env.APPLICATION_DB_PORT ??= '5432';
  process.env.APPLICATION_DB_USERNAME ??= 'postgres';
  process.env.APPLICATION_DB_PASSWORD ??= 'postgres';
  process.env.APPLICATION_DB_DATABASE ??= 'owned_reference_guard_check';
  await import('@models/index');
}

describe('owned-reference guard drift', () => {
  it('guards exactly the user-owned foreign-key columns from the authoritative list', async () => {
    await loadModels();

    const map = buildGuardedReferenceMap();

    const derived: Record<string, string[]> = {};
    for (const [fileName, fks] of map) {
      if (fks.length === 0) continue;
      derived[fileName] = fks.map((fk) => fk.attrName).toSorted();
    }

    const expected: Record<string, string[]> = {};
    for (const [fileName, cols] of Object.entries(EXPECTED_GUARDED_COLUMNS)) {
      expected[fileName] = cols.toSorted();
    }

    expect(derived).toEqual(expected);
  });

  it("inserts each guarded FK's target table before the table that references it", async () => {
    await loadModels();

    const map = buildGuardedReferenceMap();

    const defIndexByFileName = new Map<string, number>();
    const insertIndexByTable = new Map<string, number>();
    BACKUP_TABLES.forEach((def, index) => {
      defIndexByFileName.set(def.fileName, index);
      if (def.restoreMode === 'insert') insertIndexByTable.set(String(def.model.getTableName()), index);
    });

    for (const [fileName, fks] of map) {
      const referencerIndex = defIndexByFileName.get(fileName)!;
      const referencerDef = BACKUP_TABLES.find((d) => d.fileName === fileName)!;
      const ownTable = String(referencerDef.model.getTableName());

      for (const fk of fks) {
        // Self-ref parents are repointed by the two-pass insert once the table's
        // own rows exist, so they have no earlier-target ordering requirement.
        if (fk.targetTable === ownTable) continue;

        const targetIndex = insertIndexByTable.get(fk.targetTable);
        expect(targetIndex).toBeDefined();
        expect(targetIndex! < referencerIndex).toBe(true);
      }
    }
  });
});

import type { RecordId } from '@bt/shared/types';
import Accounts from '@models/accounts.model';
import Budgets from '@models/budget.model';
import ImportBatches from '@models/import-batches.model';
import Portfolios from '@models/investments/portfolios.model';
import Payees from '@models/payees.model';
import SubscriptionPeriods from '@models/subscription-periods.model';
import Subscriptions from '@models/subscriptions.model';
import TransactionGroups from '@models/transaction-groups.model';
import TransactionTemplates from '@models/transaction-templates.model';
import Transactions from '@models/transactions.model';
import VentureEvents from '@models/venture/venture-events.model';
import { Model, Op, type ModelStatic } from 'sequelize';

import type { BackupParentScope } from './registry';

async function idsWhere({
  model,
  where,
}: {
  model: ModelStatic<Model>;
  where: Record<string, unknown>;
}): Promise<RecordId[]> {
  const rows = (await model.findAll({ where, attributes: ['id'], raw: true, paranoid: false })) as unknown as {
    id: RecordId;
  }[];
  return rows.map((r) => r.id);
}

/**
 * Resolves and memoizes the set of parent-record ids a user owns, so an export
 * dumps each parent only once even when several child tables scope off it
 * (e.g. Holdings, InvestmentTransactions, and PortfolioBalances all filter on
 * the user's portfolio ids). `paranoid: false` everywhere: soft-deleted
 * parents' children must travel with the backup too.
 */
export function createScopeResolver({ userId }: { userId: number }) {
  const cache = new Map<BackupParentScope, Promise<RecordId[]>>();

  const loaders: Record<BackupParentScope, () => Promise<RecordId[]>> = {
    accounts: () => idsWhere({ model: Accounts, where: { userId } }),
    payees: () => idsWhere({ model: Payees, where: { userId } }),
    portfolios: () => idsWhere({ model: Portfolios, where: { userId } }),
    transactions: () => idsWhere({ model: Transactions, where: { userId } }),
    transactionGroups: () => idsWhere({ model: TransactionGroups, where: { userId } }),
    transactionTemplates: () => idsWhere({ model: TransactionTemplates, where: { userId } }),
    budgets: () => idsWhere({ model: Budgets, where: { userId } }),
    subscriptions: () => idsWhere({ model: Subscriptions, where: { userId } }),
    ventureEvents: () => idsWhere({ model: VentureEvents, where: { userId } }),
    subscriptionPeriods: async () => {
      const subscriptionIds = await getScope({ scope: 'subscriptions' });
      if (subscriptionIds.length === 0) return [];
      return idsWhere({ model: SubscriptionPeriods, where: { subscriptionId: { [Op.in]: subscriptionIds } } });
    },
    importBatches: () => idsWhere({ model: ImportBatches, where: { userId } }),
  };

  function getScope({ scope }: { scope: BackupParentScope }): Promise<RecordId[]> {
    let cached = cache.get(scope);
    if (!cached) {
      cached = loaders[scope]();
      cache.set(scope, cached);
    }
    return cached;
  }

  return { getScope };
}

export type ScopeResolver = ReturnType<typeof createScopeResolver>;

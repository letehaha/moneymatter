import { RecordId } from '@bt/shared/types';
import { moneyToApiDecimalOrNull } from '@common/types/money';
import Accounts from '@models/accounts.model';
import Categories from '@models/categories.model';
import SubscriptionTransactions from '@models/subscription-transactions.model';
import Subscriptions from '@models/subscriptions.model';
import { Op } from 'sequelize';

import type { SubscriptionRow } from '../types';
import { resolveRelationName } from './utils';

export async function transformSubscriptions({ userId }: { userId: number }): Promise<SubscriptionRow[]> {
  const subscriptions = await Subscriptions.findAll({ where: { userId }, order: [['name', 'ASC']] });
  if (subscriptions.length === 0) return [];

  const subscriptionIds = subscriptions.map((s) => s.id);
  const accountIds = [...new Set(subscriptions.map((s) => s.accountId).filter((id): id is RecordId => Boolean(id)))];
  const categoryIds = [...new Set(subscriptions.map((s) => s.categoryId).filter((id): id is RecordId => Boolean(id)))];

  // Guard FK lookups with `userId` so a stray cross-user reference in the
  // accountId/categoryId column can't leak another user's name into this
  // export. The subscription row itself is already scoped above.
  const [accounts, categories, links] = await Promise.all([
    accountIds.length
      ? Accounts.findAll({ where: { userId, id: { [Op.in]: accountIds } }, attributes: ['id', 'name'] })
      : Promise.resolve([] as Accounts[]),
    categoryIds.length
      ? Categories.findAll({ where: { userId, id: { [Op.in]: categoryIds } }, attributes: ['id', 'name'] })
      : Promise.resolve([] as Categories[]),
    SubscriptionTransactions.findAll({ where: { subscriptionId: { [Op.in]: subscriptionIds } } }),
  ]);

  const accountNameById = new Map(accounts.map((a) => [String(a.id), a.name]));
  const categoryNameById = new Map(categories.map((c) => [String(c.id), c.name]));
  const linkedCountById = new Map<string, number>();
  for (const link of links) {
    linkedCountById.set(link.subscriptionId, (linkedCountById.get(link.subscriptionId) ?? 0) + 1);
  }

  return subscriptions.map((sub): SubscriptionRow => {
    return {
      name: sub.name,
      amount: moneyToApiDecimalOrNull(sub.expectedAmount),
      currency: sub.expectedCurrencyCode ?? '',
      frequency: sub.frequency,
      startDate: sub.startDate ?? '',
      endDate: sub.endDate ?? '',
      category: sub.categoryId
        ? resolveRelationName({
            id: String(sub.categoryId),
            nameById: categoryNameById,
            relation: 'category',
            context: `subscription ${sub.id}`,
          })
        : '',
      account: sub.accountId
        ? resolveRelationName({
            id: String(sub.accountId),
            nameById: accountNameById,
            relation: 'account',
            context: `subscription ${sub.id}`,
          })
        : '',
      active: sub.isActive,
      transactionType: sub.transactionType,
      linkedTransactionsCount: linkedCountById.get(sub.id) ?? 0,
    };
  });
}

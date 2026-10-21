import { Money, moneyToApiDecimalOrNull } from '@common/types/money';
import { logger } from '@js/utils';
import Categories from '@models/categories.model';
import TrackerCategories from '@models/tracker-categories.model';
import TrackerTransactions from '@models/tracker-transactions.model';
import Trackers from '@models/trackers.model';
import { findTransactions } from '@models/transactions-query';
import Transactions from '@models/transactions.model';
import { getBaseCurrency } from '@models/users-currencies.model';
import { Op } from 'sequelize';

import type { TrackerRow } from '../types';
import { toDateOnly } from './utils';

export async function transformTrackers({ userId }: { userId: number }): Promise<TrackerRow[]> {
  // Don't catch baseCurrency errors: trackers are denominated against the
  // user's base currency, so a partial export emitting empty Currency cells
  // would silently lie about every tracker row.
  const [trackers, baseCurrency] = await Promise.all([
    Trackers.findAll({ where: { userId }, order: [['name', 'ASC']] }),
    getBaseCurrency({ userId }),
  ]);

  if (trackers.length === 0) return [];

  const trackerIds = trackers.map((b) => b.id);
  const baseCurrencyCode = baseCurrency?.currencyCode ?? '';

  const [trackerCategoriesLinks, trackerTransactionLinks] = await Promise.all([
    TrackerCategories.findAll({ where: { trackerId: { [Op.in]: trackerIds } } }),
    TrackerTransactions.findAll({ where: { trackerId: { [Op.in]: trackerIds } } }),
  ]);

  const categoryIds = [...new Set(trackerCategoriesLinks.map((l) => l.categoryId))];
  const transactionIds = [...new Set(trackerTransactionLinks.map((l) => l.transactionId))];

  // `userId` clauses defend against link tables that point at cross-user
  // categories/transactions – the tracker itself is user-scoped, but a
  // stray FK in the link table would otherwise leak another user's data.
  const [categories, transactions] = await Promise.all([
    categoryIds.length
      ? Categories.findAll({ where: { userId, id: { [Op.in]: categoryIds } }, attributes: ['id', 'name'] })
      : Promise.resolve([] as Categories[]),
    transactionIds.length
      ? // Export mirrors what the tracker screen shows, and a tracker counts every row
        // linked to it — so a linked plan is exported and summed like any other.
        findTransactions({
          where: { id: { [Op.in]: transactionIds } },
          planned: 'include',
          access: { creator: userId },
          balanceAdjustments: 'include',
          completeness: 'all',
        })
      : Promise.resolve([] as Transactions[]),
  ]);

  const categoryNameById = new Map(categories.map((c) => [c.id, c.name]));
  const txByTrackerId = new Map<string, Transactions[]>();
  const txById = new Map(transactions.map((t) => [t.id, t]));
  for (const link of trackerTransactionLinks) {
    const tx = txById.get(link.transactionId);
    if (!tx) {
      logger.warn(
        `Data export: tracker ${link.trackerId} links to missing transaction ${link.transactionId}; spent total will be understated.`,
      );
      continue;
    }
    const list = txByTrackerId.get(link.trackerId) ?? [];
    list.push(tx);
    txByTrackerId.set(link.trackerId, list);
  }

  const categoriesByTrackerId = new Map<string, string[]>();
  for (const link of trackerCategoriesLinks) {
    const list = categoriesByTrackerId.get(link.trackerId) ?? [];
    const name = categoryNameById.get(link.categoryId);
    if (!name) {
      logger.warn(
        `Data export: tracker ${link.trackerId} links to missing category ${link.categoryId}; emitting unresolved sentinel.`,
      );
      list.push(`(unresolved category)`);
    } else {
      list.push(name);
    }
    categoriesByTrackerId.set(link.trackerId, list);
  }

  return trackers.map((tracker): TrackerRow => {
    const linked = txByTrackerId.get(tracker.id) ?? [];
    // Rows with no base-currency amount (custom currency, no rate yet) are left out of the total.
    const spentAmount = Money.sum(linked.flatMap((t) => (t.refAmount ? [t.refAmount.abs()] : [])));
    return {
      name: tracker.name,
      status: tracker.status,
      periodStart: tracker.startDate ? toDateOnly({ value: tracker.startDate }) : '',
      periodEnd: tracker.endDate ? toDateOnly({ value: tracker.endDate }) : '',
      limitAmount: moneyToApiDecimalOrNull(tracker.limitAmount),
      currency: baseCurrencyCode,
      categories: (categoriesByTrackerId.get(tracker.id) ?? []).toSorted(),
      spentAmount: spentAmount.toNumber(),
    };
  });
}

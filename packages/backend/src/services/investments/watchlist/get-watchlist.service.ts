import {
  WATCHLIST_ALERT_TYPES,
  type RecordId,
  type WatchlistAlertModel,
  type WatchlistItemModel,
  type WatchlistModel,
  type WatchlistSectionModel,
} from '@bt/shared/types';
import { INVESTMENT_DECIMAL_SCALE } from '@common/types/money';
import Holdings from '@models/investments/holdings.model';
import Securities from '@models/investments/securities.model';
import WatchlistAlerts from '@models/investments/watchlist-alerts.model';
import WatchlistItems from '@models/investments/watchlist-items.model';
import WatchlistSections from '@models/investments/watchlist-sections.model';
import { getPortfolio } from '@services/investments/portfolios/get.service';
import { Op, type Order } from 'sequelize';

import { alertThreshold, dailyChangePercent } from './alert-condition';
import { get52WeekRanges, getDailyCloses } from './daily-closes';

export const DISPLAY_ORDER: Order = [
  ['sortOrder', 'ASC'],
  ['id', 'ASC'],
];

export const serializeThreshold = ({ alert }: { alert: WatchlistAlerts }) => {
  const threshold = alertThreshold({ alert });
  return threshold.type === WATCHLIST_ALERT_TYPES.dailyMove
    ? threshold
    : { ...threshold, price: threshold.price.toDecimalString(INVESTMENT_DECIMAL_SCALE) };
};

export const serializeAlert = ({ alert }: { alert: WatchlistAlerts }): WatchlistAlertModel => ({
  id: alert.id,
  ...serializeThreshold({ alert }),
  frequency: alert.frequency,
  notifyInApp: alert.notifyInApp,
  notifyEmail: alert.notifyEmail,
  isActive: alert.isActive,
  lastTriggeredAt: alert.lastTriggeredAt?.toISOString() ?? null,
});

/** Items in the order given, each with its security, prices, holding state and alerts. */
export const buildItems = async ({
  portfolioId,
  items,
}: {
  portfolioId: RecordId;
  items: WatchlistItems[];
}): Promise<WatchlistItemModel[]> => {
  if (!items.length) return [];

  const securityIds = items.map((item) => item.securityId);
  const [securities, closes, ranges, held, alerts] = await Promise.all([
    Securities.findAll({ where: { id: { [Op.in]: securityIds } } }),
    getDailyCloses({ securityIds }),
    get52WeekRanges({ securityIds }),
    Holdings.findAll({
      where: { portfolioId, securityId: { [Op.in]: securityIds }, quantity: { [Op.gt]: 0 } },
      attributes: ['securityId'],
    }),
    WatchlistAlerts.findAll({
      where: { itemId: { [Op.in]: items.map((item) => item.id) } },
      order: [['createdAt', 'ASC']],
    }),
  ]);
  const securitiesById = new Map(securities.map((security) => [security.id, security]));
  const heldIds = new Set(held.map((holding) => holding.securityId));
  const alertsByItem = Map.groupBy(alerts, (alert) => alert.itemId);

  return items.map((item) => {
    const security = securitiesById.get(item.securityId)!;
    const close = closes.get(item.securityId);
    const range = ranges.get(item.securityId);
    return {
      id: item.id,
      sectionId: item.sectionId,
      note: item.note,
      targetPrice: item.targetPrice?.toDecimalString(INVESTMENT_DECIMAL_SCALE) ?? null,
      security: {
        id: security.id,
        symbol: security.symbol,
        name: security.name,
        currencyCode: security.currencyCode,
        assetClass: security.assetClass,
        logoUrl: security.logoUrl,
      },
      lastClose: close?.last.price ?? null,
      lastCloseDate: close?.last.day ?? null,
      previousClose: close?.previous?.price ?? null,
      changePercent: close ? dailyChangePercent({ closes: close }) : null,
      low52w: range?.low ?? null,
      high52w: range?.high ?? null,
      isHeld: heldIds.has(item.securityId),
      alerts: (alertsByItem.get(item.id) ?? []).map((alert) => serializeAlert({ alert })),
    };
  });
};

export const getWatchlist = async ({
  userId,
  portfolioId,
}: {
  userId: number;
  portfolioId: RecordId;
}): Promise<WatchlistModel> => {
  const portfolio = await getPortfolio({ userId, portfolioId });
  const [sections, items] = await Promise.all([
    WatchlistSections.findAll({ where: { portfolioId: portfolio.id }, order: DISPLAY_ORDER }),
    WatchlistItems.findAll({ where: { portfolioId: portfolio.id }, order: DISPLAY_ORDER }),
  ]);
  const built = await buildItems({ portfolioId: portfolio.id, items });

  return {
    ungroupedItems: built.filter((item) => item.sectionId === null),
    sections: sections.map(
      (section): WatchlistSectionModel => ({
        id: section.id,
        name: section.name,
        items: built.filter((item) => item.sectionId === section.id),
      }),
    ),
  };
};

import { ASSET_CLASS, SECURITY_PROVIDER, type SetWatchlistLayoutBody } from '@bt/shared/types';
import type { SecuritySearchResult } from '@bt/shared/types/investments';
import Securities from '@models/investments/securities.model';
import SecurityPricing from '@models/investments/security-pricing.model';
import { startOfDayUtc } from '@services/investments/securities-price/pricing-anchor';
import type * as alertsService from '@services/investments/watchlist/alerts.service';
import type { getWatchlist as _getWatchlist } from '@services/investments/watchlist/get-watchlist.service';
import type * as itemsService from '@services/investments/watchlist/items.service';
import type * as sectionsService from '@services/investments/watchlist/sections.service';
import { subDays } from 'date-fns';

import { makeRequest } from '../common';

/** UTC midnight `days` before today. */
export const utcDaysAgo = ({ days }: { days: number }) => subDays(startOfDayUtc(new Date()), days);

export const createTestSecurity = ({ symbol, crypto = false }: { symbol: string; crypto?: boolean }) =>
  Securities.create({
    symbol,
    providerSymbol: symbol,
    currencyCode: 'USD',
    providerName: crypto ? SECURITY_PROVIDER.coingecko : SECURITY_PROVIDER.fmp,
    assetClass: crypto ? ASSET_CLASS.crypto : ASSET_CLASS.stocks,
    name: `${symbol} Inc.`,
  });

type DailyPrice = { days: number; price: string };

/** Upserts one close per day, stored at that day's UTC midnight. */
export const addDailyPrices = ({ securityId, prices }: { securityId: string; prices: DailyPrice[] }) =>
  SecurityPricing.bulkCreate(
    prices.map(({ days, price }) => ({
      securityId,
      date: utcDaysAgo({ days }),
      priceClose: price,
      source: SECURITY_PROVIDER.fmp,
    })),
    { updateOnDuplicate: ['priceClose'] },
  );

/** Replaces every stored price of the security with these closes. */
export const setDailyPrices = async ({ securityId, prices }: { securityId: string; prices: DailyPrice[] }) => {
  await SecurityPricing.destroy({ where: { securityId } });
  await addDailyPrices({ securityId, prices });
};

type Result<F extends (...args: never[]) => unknown> = Awaited<ReturnType<F>>;

const base = ({ portfolioId }: { portfolioId: string }) => `/investments/portfolios/${portfolioId}/watchlist`;

export function getWatchlist<R extends boolean | undefined = false>({
  portfolioId,
  raw,
}: {
  portfolioId: string;
  raw?: R;
}) {
  return makeRequest<Result<typeof _getWatchlist>, R>({ method: 'get', url: base({ portfolioId }), raw });
}

export function createWatchlistSection<R extends boolean | undefined = false>({
  portfolioId,
  name,
  raw,
}: {
  portfolioId: string;
  name: string;
  raw?: R;
}) {
  return makeRequest<Result<typeof sectionsService.createSection>, R>({
    method: 'post',
    url: `${base({ portfolioId })}/sections`,
    payload: { name },
    raw,
  });
}

export function updateWatchlistSection<R extends boolean | undefined = false>({
  portfolioId,
  sectionId,
  name,
  raw,
}: {
  portfolioId: string;
  sectionId: string;
  name: string;
  raw?: R;
}) {
  return makeRequest<Result<typeof sectionsService.updateSection>, R>({
    method: 'patch',
    url: `${base({ portfolioId })}/sections/${sectionId}`,
    payload: { name },
    raw,
  });
}

export function deleteWatchlistSection({ portfolioId, sectionId }: { portfolioId: string; sectionId: string }) {
  return makeRequest({ method: 'delete', url: `${base({ portfolioId })}/sections/${sectionId}` });
}

export function setWatchlistLayout({ portfolioId, payload }: { portfolioId: string; payload: SetWatchlistLayoutBody }) {
  return makeRequest({ method: 'put', url: `${base({ portfolioId })}/layout`, payload });
}

export function createWatchlistItem<R extends boolean | undefined = false>({
  portfolioId,
  payload,
  raw,
}: {
  portfolioId: string;
  payload: ({ securityId: string } | { searchResult: SecuritySearchResult }) & {
    sectionId?: string | null;
    note?: string | null;
    targetPrice?: string | null;
  };
  raw?: R;
}) {
  return makeRequest<Result<typeof itemsService.createItem>, R>({
    method: 'post',
    url: `${base({ portfolioId })}/items`,
    payload,
    raw,
  });
}

export function updateWatchlistItem<R extends boolean | undefined = false>({
  portfolioId,
  itemId,
  payload,
  raw,
}: {
  portfolioId: string;
  itemId: string;
  payload: { sectionId?: string | null; note?: string | null; targetPrice?: string | null };
  raw?: R;
}) {
  return makeRequest<Result<typeof itemsService.updateItem>, R>({
    method: 'patch',
    url: `${base({ portfolioId })}/items/${itemId}`,
    payload,
    raw,
  });
}

export function deleteWatchlistItem({ portfolioId, itemId }: { portfolioId: string; itemId: string }) {
  return makeRequest({ method: 'delete', url: `${base({ portfolioId })}/items/${itemId}` });
}

export function createWatchlistAlert<R extends boolean | undefined = false>({
  portfolioId,
  itemId,
  payload,
  raw,
}: {
  portfolioId: string;
  itemId: string;
  payload: Record<string, unknown>;
  raw?: R;
}) {
  return makeRequest<Result<typeof alertsService.createAlert>, R>({
    method: 'post',
    url: `${base({ portfolioId })}/items/${itemId}/alerts`,
    payload,
    raw,
  });
}

export function updateWatchlistAlert<R extends boolean | undefined = false>({
  portfolioId,
  itemId,
  alertId,
  payload,
  raw,
}: {
  portfolioId: string;
  itemId: string;
  alertId: string;
  payload: Record<string, unknown>;
  raw?: R;
}) {
  return makeRequest<Result<typeof alertsService.updateAlert>, R>({
    method: 'patch',
    url: `${base({ portfolioId })}/items/${itemId}/alerts/${alertId}`,
    payload,
    raw,
  });
}

export function deleteWatchlistAlert({
  portfolioId,
  itemId,
  alertId,
}: {
  portfolioId: string;
  itemId: string;
  alertId: string;
}) {
  return makeRequest({ method: 'delete', url: `${base({ portfolioId })}/items/${itemId}/alerts/${alertId}` });
}

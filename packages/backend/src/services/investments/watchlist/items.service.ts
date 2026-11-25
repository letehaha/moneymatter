import { type RecordId, WATCHLIST_LIMITS, type WatchlistItemFields } from '@bt/shared/types';
import type { SecuritySearchResult } from '@bt/shared/types/investments';
import { Money } from '@common/types/money';
import { findOrThrowNotFound } from '@common/utils/find-or-throw-not-found';
import { t } from '@i18n/index';
import { ConflictError, ValidationError } from '@js/errors';
import { logger } from '@js/utils';
import Securities from '@models/investments/securities.model';
import WatchlistItems from '@models/investments/watchlist-items.model';
import { withTransaction } from '@services/common/with-transaction';
import { getPortfolio } from '@services/investments/portfolios/get.service';
import { syncHistoricalPrices } from '@services/investments/securities-price/historical-sync.service';
import { addSecurityFromSearch } from '@services/investments/securities/add-from-search.service';
import { UniqueConstraintError } from 'sequelize';

import { buildItems } from './get-watchlist.service';
import { endOfSectionSortOrder, findSection } from './sections.service';

interface PortfolioParams {
  userId: number;
  portfolioId: RecordId;
}

export const findItem = ({ portfolioId, itemId }: { portfolioId: RecordId; itemId: RecordId }) =>
  findOrThrowNotFound({
    query: WatchlistItems.findOne({ where: { id: itemId, portfolioId } }),
    message: t({ key: 'investments.watchlist.itemNotFound' }),
  });

/** The portfolio is already the user's. */
const createItemImpl = async ({
  portfolioId,
  securityId,
  sectionId = null,
  note = null,
  targetPrice = null,
}: { portfolioId: RecordId; securityId: RecordId } & WatchlistItemFields) => {
  await findOrThrowNotFound({
    query: Securities.findByPk(securityId),
    message: t({ key: 'investments.securityNotFound' }),
  });
  if (sectionId) await findSection({ portfolioId, sectionId });

  if (await WatchlistItems.findOne({ where: { portfolioId, securityId } })) {
    throw new ConflictError({ message: t({ key: 'investments.watchlist.securityAlreadyWatched' }) });
  }

  return WatchlistItems.create({
    portfolioId,
    securityId,
    sectionId,
    note,
    targetPrice,
    sortOrder: await endOfSectionSortOrder({ portfolioId, sectionId }),
  });
};

const buildItem = async ({ item }: { item: WatchlistItems }) =>
  (await buildItems({ portfolioId: item.portfolioId, items: [item] }))[0]!;

type CreateItemParams = PortfolioParams &
  Omit<Parameters<typeof createItemImpl>[0], 'portfolioId' | 'securityId'> &
  ({ securityId: RecordId } | { searchResult: SecuritySearchResult });

const assertItemCapacity = async ({ portfolioId }: { portfolioId: RecordId }) => {
  if ((await WatchlistItems.count({ where: { portfolioId } })) >= WATCHLIST_LIMITS.maxItems) {
    throw new ValidationError({
      message: t({ key: 'investments.watchlist.tooManyItems', variables: { max: WATCHLIST_LIMITS.maxItems } }),
    });
  }
};

export const createItem = async ({ userId, ...params }: CreateItemParams) => {
  const portfolio = await getPortfolio({ userId, portfolioId: params.portfolioId });
  await assertItemCapacity({ portfolioId: portfolio.id });

  const securityId =
    'searchResult' in params
      ? (await addSecurityFromSearch({ searchResult: params.searchResult })).security.id
      : params.securityId;
  const item = await withTransaction(createItemImpl)({
    portfolioId: portfolio.id,
    securityId,
    sectionId: params.sectionId,
    note: params.note,
    targetPrice: params.targetPrice,
  }).catch((error: unknown) => {
    if (error instanceof UniqueConstraintError) {
      throw new ConflictError({ message: t({ key: 'investments.watchlist.securityAlreadyWatched' }) });
    }
    throw error;
  });

  syncHistoricalPrices(item.securityId).catch((error) => {
    logger.error(
      { message: 'Background historical price sync failed for a watchlist item', error: error as Error },
      { code: 'WATCHLIST_ITEM_PRICE_SYNC_FAILED', securityId: item.securityId },
    );
  });

  return buildItem({ item });
};

/** `undefined` leaves a field untouched, `null` clears it. A new section puts the item last in it. */
const updateItemImpl = async ({
  userId,
  portfolioId,
  itemId,
  sectionId,
  note,
  targetPrice,
}: PortfolioParams & { itemId: RecordId } & WatchlistItemFields) => {
  const portfolio = await getPortfolio({ userId, portfolioId });
  const item = await findItem({ portfolioId: portfolio.id, itemId });

  if (sectionId !== undefined && sectionId !== item.sectionId) {
    if (sectionId) await findSection({ portfolioId: portfolio.id, sectionId });
    item.sectionId = sectionId;
    item.sortOrder = await endOfSectionSortOrder({ portfolioId: portfolio.id, sectionId });
  }
  if (note !== undefined) item.note = note;
  if (targetPrice !== undefined) item.targetPrice = targetPrice === null ? null : Money.fromDecimal(targetPrice);
  await item.save();

  return item;
};

export const updateItem = async (params: Parameters<typeof updateItemImpl>[0]) =>
  buildItem({ item: await withTransaction(updateItemImpl)(params) });

export const deleteItem = withTransaction(
  async ({ userId, portfolioId, itemId }: PortfolioParams & { itemId: RecordId }): Promise<void> => {
    const portfolio = await getPortfolio({ userId, portfolioId });
    const item = await findItem({ portfolioId: portfolio.id, itemId });
    await item.destroy();
  },
);

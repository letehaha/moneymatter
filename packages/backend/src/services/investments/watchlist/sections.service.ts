import { type RecordId, type SetWatchlistLayoutBody, WATCHLIST_LIMITS } from '@bt/shared/types';
import { findOrThrowNotFound } from '@common/utils/find-or-throw-not-found';
import { t } from '@i18n/index';
import { ValidationError } from '@js/errors';
import WatchlistItems from '@models/investments/watchlist-items.model';
import WatchlistSections from '@models/investments/watchlist-sections.model';
import { withTransaction } from '@services/common/with-transaction';
import { getPortfolio } from '@services/investments/portfolios/get.service';

import { DISPLAY_ORDER } from './get-watchlist.service';

interface PortfolioParams {
  userId: number;
  portfolioId: RecordId;
}

const toSection = ({ section }: { section: WatchlistSections }) => ({ id: section.id, name: section.name });

export const findSection = ({ portfolioId, sectionId }: { portfolioId: RecordId; sectionId: RecordId }) =>
  findOrThrowNotFound({
    query: WatchlistSections.findOne({ where: { id: sectionId, portfolioId } }),
    message: t({ key: 'investments.watchlist.sectionNotFound' }),
  });

const nextSortOrder = ({ max }: { max: number | null }) => (max ?? -1) + 1;

/** The `sortOrder` that puts an item last in `sectionId`, or last among the ungrouped items when it is null. */
export const endOfSectionSortOrder = async ({
  portfolioId,
  sectionId,
}: {
  portfolioId: RecordId;
  sectionId: RecordId | null;
}): Promise<number> =>
  nextSortOrder({
    max: await WatchlistItems.max<number | null, WatchlistItems>('sortOrder', { where: { portfolioId, sectionId } }),
  });

const createSectionImpl = async ({ userId, portfolioId, name }: PortfolioParams & { name: string }) => {
  const portfolio = await getPortfolio({ userId, portfolioId });
  if ((await WatchlistSections.count({ where: { portfolioId: portfolio.id } })) >= WATCHLIST_LIMITS.maxSections) {
    throw new ValidationError({
      message: t({ key: 'investments.watchlist.tooManySections', variables: { max: WATCHLIST_LIMITS.maxSections } }),
    });
  }
  const sortOrder = nextSortOrder({
    max: await WatchlistSections.max<number | null, WatchlistSections>('sortOrder', {
      where: { portfolioId: portfolio.id },
    }),
  });
  const section = await WatchlistSections.create({ portfolioId: portfolio.id, name, sortOrder });
  return toSection({ section });
};

const updateSectionImpl = async ({
  userId,
  portfolioId,
  sectionId,
  name,
}: PortfolioParams & { sectionId: RecordId; name: string }) => {
  const portfolio = await getPortfolio({ userId, portfolioId });
  const section = await findSection({ portfolioId: portfolio.id, sectionId });
  await section.update({ name });
  return toSection({ section });
};

/** Its items move to the end of the ungrouped list. */
const deleteSectionImpl = async ({ userId, portfolioId, sectionId }: PortfolioParams & { sectionId: RecordId }) => {
  const portfolio = await getPortfolio({ userId, portfolioId });
  const section = await findSection({ portfolioId: portfolio.id, sectionId });

  const items = await WatchlistItems.findAll({ where: { sectionId: section.id }, order: DISPLAY_ORDER });
  const start = await endOfSectionSortOrder({ portfolioId: portfolio.id, sectionId: null });
  for (const [index, item] of items.entries()) {
    await item.update({ sectionId: null, sortOrder: start + index });
  }

  await section.destroy();
};

/** Every section of the portfolio must be listed once; items at most once, and unlisted ones keep their placement. */
const setLayoutImpl = async ({
  userId,
  portfolioId,
  sections,
  ungroupedItemIds,
}: PortfolioParams & SetWatchlistLayoutBody): Promise<void> => {
  const portfolio = await getPortfolio({ userId, portfolioId });
  const [portfolioSections, portfolioItems] = await Promise.all([
    WatchlistSections.findAll({ where: { portfolioId: portfolio.id } }),
    WatchlistItems.findAll({ where: { portfolioId: portfolio.id } }),
  ]);
  const sectionsById = new Map(portfolioSections.map((section) => [section.id, section]));
  const itemsById = new Map(portfolioItems.map((item) => [item.id, item]));

  const sectionIds = sections.map((section) => section.id);
  const placements = [
    ...sections.flatMap((section) =>
      section.itemIds.map((itemId, index) => ({ itemId, sectionId: section.id as RecordId | null, index })),
    ),
    ...ungroupedItemIds.map((itemId, index) => ({ itemId, sectionId: null, index })),
  ];
  const itemIds = placements.map((placement) => placement.itemId);

  const valid =
    sectionIds.length === sectionsById.size &&
    new Set(sectionIds).size === sectionIds.length &&
    sectionIds.every((id) => sectionsById.has(id)) &&
    new Set(itemIds).size === itemIds.length &&
    itemIds.every((id) => itemsById.has(id));
  if (!valid) throw new ValidationError({ message: t({ key: 'investments.watchlist.layoutInvalid' }) });

  for (const [index, id] of sectionIds.entries()) {
    const section = sectionsById.get(id)!;
    if (section.sortOrder !== index) await section.update({ sortOrder: index });
  }

  for (const { itemId, sectionId, index } of placements) {
    const item = itemsById.get(itemId)!;
    if (item.sectionId !== sectionId || item.sortOrder !== index) await item.update({ sectionId, sortOrder: index });
  }
};

export const createSection = withTransaction(createSectionImpl);
export const updateSection = withTransaction(updateSectionImpl);
export const deleteSection = withTransaction(deleteSectionImpl);
export const setLayout = withTransaction(setLayoutImpl);

import {
  WATCHLIST_LIMITS,
  type RecordId,
  type SetWatchlistLayoutBody,
  type WatchlistItemModel,
  type WatchlistModel,
} from '@bt/shared/types';

export interface WatchlistLayoutState {
  ungrouped: WatchlistItemModel[];
  sections: { id: RecordId; name: string; items: WatchlistItemModel[] }[];
}

export const layoutStateFrom = ({ watchlist }: { watchlist: WatchlistModel }): WatchlistLayoutState => ({
  ungrouped: [...watchlist.ungroupedItems],
  sections: watchlist.sections.map(({ id, name, items }) => ({ id, name, items: [...items] })),
});

export const buildLayoutPayload = ({ state }: { state: WatchlistLayoutState }): SetWatchlistLayoutBody => ({
  sections: state.sections.map(({ id, items }) => ({ id, itemIds: items.map((item) => item.id) })),
  ungroupedItemIds: state.ungrouped.map((item) => item.id),
});

export const NO_SECTION = '';

const toNumber = ({ value }: { value: string | null }): number | null => {
  if (value === null) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
};

/** How far the close has to fall to reach the buy-below price, in percent of the close. At or below 0 it is in the buy zone. */
export const distanceToTargetPercent = ({ item }: { item: Pick<WatchlistItemModel, 'lastClose' | 'targetPrice'> }) => {
  const close = toNumber({ value: item.lastClose });
  const target = toNumber({ value: item.targetPrice });
  if (!close || target === null) return null;
  return ((close - target) / close) * 100;
};

/** Where the last close sits in its 52-week range, 0–100. */
export const rangePositionPercent = ({
  item,
}: {
  item: Pick<WatchlistItemModel, 'lastClose' | 'low52w' | 'high52w'>;
}) => {
  const close = toNumber({ value: item.lastClose });
  const low = toNumber({ value: item.low52w });
  const high = toNumber({ value: item.high52w });
  if (close === null || low === null || high === null) return null;
  if (high <= low) return 50;
  return Math.min(100, Math.max(0, ((close - low) / (high - low)) * 100));
};

/** A plain decimal string for the API: `String(1e-7)` would give exponent notation. */
export const toDecimalString = ({ value }: { value: number }) =>
  value.toLocaleString('en-US', { useGrouping: false, maximumFractionDigits: 10 });

const toPriceNumber = ({ value }: { value: string | number }) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 && parsed < WATCHLIST_LIMITS.priceBelow ? parsed : null;
};

/** Filled in with something other than a price the API accepts; an empty field is valid and clears the price. */
export const isPriceInputInvalid = ({ value }: { value: string | number | null }) =>
  value !== null && value !== '' && toPriceNumber({ value }) === null;

/** A price field's value as an API decimal; null when empty or invalid. */
export const priceInputToDecimal = ({ value }: { value: string | number | null }) => {
  if (value === null || value === '') return null;
  const parsed = toPriceNumber({ value });
  return parsed === null ? null : toDecimalString({ value: parsed });
};

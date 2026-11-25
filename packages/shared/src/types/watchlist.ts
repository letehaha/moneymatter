import type { ASSET_CLASS } from './investments/enums';
import type { RecordId } from './record-id';

export const WATCHLIST_ALERT_TYPES = {
  closeAbove: 'close_above',
  closeBelow: 'close_below',
  /** The close moved at least `percent` from the previous close, in either direction. */
  dailyMove: 'daily_move',
} as const;
export type WatchlistAlertType = (typeof WATCHLIST_ALERT_TYPES)[keyof typeof WATCHLIST_ALERT_TYPES];

export const WATCHLIST_ALERT_FREQUENCIES = {
  /** Turns itself off after it fires. */
  once: 'once',
  /** Re-arms once the condition stops holding. */
  everyTime: 'every_time',
} as const;
export type WatchlistAlertFrequency = (typeof WATCHLIST_ALERT_FREQUENCIES)[keyof typeof WATCHLIST_ALERT_FREQUENCIES];

export const WATCHLIST_LIMITS = {
  sectionNameMaxLength: 100,
  noteMaxLength: 1000,
  movePercent: { min: 0.1, max: 100 },
  /** Exclusive: prices are stored as DECIMAL(20,10). */
  priceBelow: 1e10,
  maxItems: 200,
  maxSections: 30,
  maxAlertsPerItem: 10,
} as const;

export type WatchlistPriceAlertType = typeof WATCHLIST_ALERT_TYPES.closeAbove | typeof WATCHLIST_ALERT_TYPES.closeBelow;

/** A price alert carries `price`, in the security's currency; a daily move carries `percent`, in percent points (5 = 5%). */
export type WatchlistAlertThreshold<Price = string> =
  | { type: WatchlistPriceAlertType; price: Price; percent: null }
  | { type: typeof WATCHLIST_ALERT_TYPES.dailyMove; percent: number; price: null };

export type WatchlistAlertModel = WatchlistAlertThreshold & {
  id: RecordId;
  frequency: WatchlistAlertFrequency;
  notifyInApp: boolean;
  notifyEmail: boolean;
  isActive: boolean;
  /** ISO timestamp. */
  lastTriggeredAt: string | null;
};

export interface WatchlistSecurityModel {
  id: RecordId;
  symbol: string | null;
  name: string | null;
  currencyCode: string;
  assetClass: ASSET_CLASS;
  logoUrl: string | null;
}

/** Prices are decimal strings in the security's currency, taken from daily closes of completed UTC days. */
export interface WatchlistItemModel {
  id: RecordId;
  sectionId: RecordId | null;
  note: string | null;
  /** "Buy below" price. */
  targetPrice: string | null;
  security: WatchlistSecurityModel;
  lastClose: string | null;
  /** YYYY-MM-DD */
  lastCloseDate: string | null;
  /** The close of the day before `lastCloseDate`. */
  previousClose: string | null;
  /** Change from `previousClose` to `lastClose` in percent points (5 = 5%); null without a previous close. */
  changePercent: number | null;
  /** Null under 52 weeks of price history. */
  low52w: string | null;
  high52w: string | null;
  /** The portfolio holds a non-zero quantity of the security. */
  isHeld: boolean;
  alerts: WatchlistAlertModel[];
}

export interface WatchlistSectionModel {
  id: RecordId;
  name: string;
  items: WatchlistItemModel[];
}

/** `GET /investments/portfolios/:id/watchlist`: ungrouped items come first in the UI; everything is in display order. */
export interface WatchlistModel {
  ungroupedItems: WatchlistItemModel[];
  sections: WatchlistSectionModel[];
}

/** `PUT /investments/portfolios/:id/watchlist/layout`: every section once; items at most once, unlisted ones keep their place. */
export interface SetWatchlistLayoutBody {
  sections: { id: RecordId; itemIds: RecordId[] }[];
  ungroupedItemIds: RecordId[];
}

export interface WatchlistItemFields {
  sectionId?: RecordId | null;
  note?: string | null;
  /** Decimal string; null clears it. */
  targetPrice?: string | null;
}

export interface WatchlistAlertChannels {
  frequency?: WatchlistAlertFrequency;
  notifyInApp?: boolean;
  notifyEmail?: boolean;
}

/** `price` is a decimal string; `percent` is in percent points (5 = 5%). */
export type CreateWatchlistAlertBody = (
  | { type: WatchlistPriceAlertType; price: string }
  | { type: typeof WATCHLIST_ALERT_TYPES.dailyMove; percent: number }
) &
  WatchlistAlertChannels;

/** Only the threshold of the alert's own type is accepted. */
export type UpdateWatchlistAlertBody = {
  price?: string;
  percent?: number;
  isActive?: boolean;
} & WatchlistAlertChannels;

/** `percent` and `changePercent` are in percent points (5 = 5%); `changePercent` is rounded to 2 dp. */
export type WatchlistAlertNotificationPayload = {
  portfolioId: RecordId;
  portfolioName: string;
  itemId: RecordId;
  alertId: RecordId;
  securityId: RecordId;
  /** The symbol, else the name. */
  symbol: string | null;
  currencyCode: string;
  close: string;
  previousClose: string | null;
  /** YYYY-MM-DD */
  closeDate: string;
} & (
  | { type: WatchlistPriceAlertType; price: string; percent: null; changePercent: number | null }
  | { type: typeof WATCHLIST_ALERT_TYPES.dailyMove; percent: number; price: null; changePercent: number }
);

import type { PivotGranularity, PivotMeasure, PivotRowDimension } from './stats/reports';

// Transaction form fields the user can opt into showing, persisted in the user-settings JSONB.
export const TRANSACTION_OPTIONAL_FIELDS = ['externalUrl', 'externalReference', 'location', 'originalAmount'] as const;
export type TransactionOptionalField = (typeof TRANSACTION_OPTIONAL_FIELDS)[number];

// Max length of a saved Pivot view's user-facing name. Shared by the backend Zod
// schema and the client-side input cap so both reject the same overflow rather
// than the client letting the user type a name the server will 400 on.
export const SAVED_PIVOT_VIEW_NAME_MAX_LENGTH = 120;

// A saved Pivot Report "view": the full configuration a user pinned so they can reopen the same
// cross-tab later. Persisted in the user-settings JSONB (no dedicated table); the backend Zod
// schema (`ZodSavedPivotViewConfigSchema`) is asserted to infer exactly this shape, so both
// ends share one contract.
export interface SavedPivotViewConfig {
  rowDimension: PivotRowDimension;
  granularity: PivotGranularity;
  measure: PivotMeasure;
  // Explicit period range as `yyyy-MM-dd` strings.
  from: string;
  to: string;
  accountIds?: string[];
  categoryIds?: string[];
  payeeIds?: string[];
  heatmap: boolean;
  showDelta: boolean;
}

export interface SavedPivotView {
  id: string;
  name: string;
  config: SavedPivotViewConfig;
}

// Per-section visibility for the sidebar's Accounts panel (Bank Accounts is always shown and
// intentionally absent). Persisted in the user-settings JSONB; the backend Zod schema
// (`ZodSidebarSectionsSchema`) is asserted to infer exactly this shape, so both ends share
// one contract and cannot drift.
export interface SidebarSectionsConfig {
  portfolios: boolean;
  ventures: boolean;
  vehicles: boolean;
  loans: boolean;
}

// How fiat amounts render their currency: `symbol` disambiguates (CA$, A$, SGD), `narrowSymbol`
// is what locals use (Rp, ₴, zł) but collapses every dollar to `$`. Persisted in the
// user-settings JSONB; the backend Zod enum is built straight off this tuple.
export const CURRENCY_DISPLAY_PREFERENCES = ['symbol', 'narrowSymbol'] as const;
export type CurrencyDisplayPreference = (typeof CURRENCY_DISPLAY_PREFERENCES)[number];

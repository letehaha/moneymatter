import { api } from '@/api/_api';
import type { SupportedLocale } from '@bt/shared/i18n/locales';
import type {
  CategoryMappingPreset,
  FireSettings,
  PAYMENT_TYPES,
  TransactionOptionalField,
  endpointsTypes,
} from '@bt/shared/types';

export interface DashboardWidgetConfig {
  widgetId: string;
  colSpan: number;
  rowSpan?: number;
  config?: Record<string, unknown>;
}

/**
 * Per-section visibility for the sidebar's Accounts panel. Re-exported from the shared contract
 * so it stays in lockstep with the backend Zod schema (`ZodSidebarSectionsSchema`), which is
 * compile-time asserted against it (`SidebarSectionsSchemaIsInSync`).
 */
export type SidebarSectionsConfig = endpointsTypes.SidebarSectionsConfig;

export type TransactionsView = 'list' | 'table';

interface TransactionsTableSettings {
  /** Ordered list of column ids the user wants visible. */
  visibleColumns: string[];
  /** Full column order (visible + hidden) used by the column-config UI. */
  columnOrder: string[];
  /** Preferred transactions view on narrow screens: compact list or the full table. */
  mobileView?: TransactionsView;
  /** Preferred transactions view on wide screens: compact list or the full table. */
  desktopView?: TransactionsView;
  /**
   * Optional filters the user added to the transactions filter bar (besides the
   * always-visible ones). Unknown ids are dropped client-side on read.
   */
  extraFilters?: string[];
  /** Shades non-editable cells on every row instead of only the hovered one. */
  alwaysShowLockedCells?: boolean;
}

interface TransactionsListSettings {
  /**
   * When true, the pinned "Upcoming" section (overdue + due within 3 days) is
   * hidden from the list view. Defaults to false (section visible).
   */
  hideUpcoming?: boolean;
}

interface TransactionFormSettings {
  /** Optional form fields the user turned on. A field holding a value is shown regardless. */
  optionalFields?: TransactionOptionalField[];
  /** Whether the transaction form may load map tiles and address search from OpenStreetMap. */
  mapPicker?: boolean;
  /** Payment type preselected on new transactions. Credit card when unset. */
  defaultPaymentType?: PAYMENT_TYPES;
}

interface InvestmentTransactionsTableSettings {
  /** Ordered list of column ids the user wants visible. */
  visibleColumns: string[];
  /** Full column order (visible + hidden) used by the column-config UI. */
  columnOrder: string[];
}

export interface UiSettings {
  transactionsTable?: TransactionsTableSettings;
  transactionsList?: TransactionsListSettings;
  transactionForm?: TransactionFormSettings;
  investmentTransactionsTable?: InvestmentTransactionsTableSettings;
}

export interface SubscriptionsSettings {
  /** Seeds the auto-record toggle on the create-subscription form; the form
   *  still lets the user override it per subscription. */
  defaultAutoRecord?: boolean;
}

/**
 * A saved Pivot Report view — the full configuration a user pinned so they can reload the same
 * cross-tab later. The shape is the shared contract the backend Zod schema
 * (`ZodSavedPivotViewConfigSchema`) is asserted against, so the two ends can't drift.
 */
export type SavedPivotViewConfig = endpointsTypes.SavedPivotViewConfig;
export type SavedPivotView = endpointsTypes.SavedPivotView;

export interface UserSettingsSchema {
  locale?: SupportedLocale;
  dashboard?: {
    widgets: DashboardWidgetConfig[];
  };
  /** Data-import preferences shared by the CSV and Budget Bakers Wallet wizards. */
  import?: {
    /**
     * Seeds the "update account balances from imported transactions" checkbox
     * on the import wizards' resolve steps. Each import execute writes the
     * chosen value back, so the next import remembers it. Off when unset.
     */
    recalculateAccountBalance?: boolean;
    /**
     * Category mappings remembered from finished imports, keyed by a fingerprint of the
     * source layout. One preset per fingerprint, newest first.
     */
    categoryMappingPresets?: CategoryMappingPreset[];
  };
  includeCreditLimitInStats?: boolean;
  /**
   * Let bank-sync transfer auto-linking pair a synced transaction with a
   * manually-created one. Off when unset.
   */
  matchTransfersWithManualAccounts?: boolean;
  /** Store bank transactions before they are booked. Off when unset. */
  importPendingBankTransactions?: boolean;
  sidebarSections?: SidebarSectionsConfig;
  payeeExtractionUsesDescription?: boolean;
  /** Transactions sharing a raw merchant name before a Payee is auto-created. Defaults to 2. */
  payeePromotionThreshold?: 1 | 2 | 3;
  ui?: UiSettings;
  subscriptions?: SubscriptionsSettings;
  savedPivotViews?: SavedPivotView[];
  /** Header "Support" (donation) button visibility. Defaults to visible when unset. */
  showSupportButton?: boolean;
  /**
   * Hide zero-balance accounts (and account groups emptied by that hiding) from the sidebar
   * Accounts panel. Defaults to visible/off when unset.
   */
  hideZeroBalances?: boolean;
  accounts?: {
    /** Account preselected in the account pickers. `null` means the user explicitly cleared it. */
    defaultAccountId?: string | null;
    showArchivedInDropdowns?: boolean;
  };
  /**
   * Categories whose spending counts as savings in the cash-flow analytics instead of as an
   * expense. Subcategories inherit from their parent. Empty or unset leaves cash flow unchanged.
   */
  savingsCategoryIds?: string[];
  currencyDisplay?: endpointsTypes.CurrencyDisplayPreference;
  fire?: FireSettings;
}

export const getUserSettings = async (): Promise<UserSettingsSchema> => {
  const result = await api.get('/user/settings');

  return result;
};

export const updateUserSettings = async (settings: UserSettingsSchema): Promise<UserSettingsSchema> => {
  const result = await api.put('/user/settings', settings);

  return result;
};

/** Arrays stay non-partial: the backend merge replaces them wholesale, so a
 * patched array must always be the full desired list. `NonNullable` keeps the
 * recursion working for optional properties – their `undefined` part would
 * otherwise fail the `extends object` check and leave the field required-deep. */
type DeepPartial<T> = {
  [K in keyof T]?: NonNullable<T[K]> extends (infer U)[]
    ? U[]
    : NonNullable<T[K]> extends object
      ? DeepPartial<NonNullable<T[K]>>
      : T[K];
};

type UserSettingsPatch = DeepPartial<UserSettingsSchema>;

/**
 * Partial settings update: only the keys present in `patch` change, the server
 * deep-merges the rest from its stored value and returns the merged settings.
 * Use this instead of `updateUserSettings` for slice updates — sending the
 * whole object built from a possibly-stale cache loses concurrent writes from
 * other tabs or in-flight mutations.
 */
export const patchUserSettings = async (patch: UserSettingsPatch): Promise<UserSettingsSchema> => {
  const result = await api.patch('/user/settings', patch);

  return result;
};

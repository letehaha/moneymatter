import { SUPPORTED_LOCALES } from '@bt/shared/i18n/locales';
import {
  AIConnectionInfo,
  AI_CUSTOM_INSTRUCTIONS_MAX_LENGTH,
  AI_FEATURE,
  AI_PROVIDER,
  FIRE_LIMITS,
  FIRE_MAX_EXCLUDED_CATEGORIES,
  FIRE_TARGET_TYPES,
  MAX_AI_CONNECTIONS,
  MAX_CATEGORY_MAPPING_PRESETS,
  NOTIFICATION_TYPES,
  PAYMENT_TYPES,
  RecordId,
  TRANSACTION_OPTIONAL_FIELDS,
  endpointsTypes,
} from '@bt/shared/types';
import type { CategoryMappingPreset, Equals, Expect, FireSettings, MutuallyAssignable } from '@bt/shared/types';
import { dateRange, withDateOrder } from '@common/lib/zod/custom-types';
import { IdColumn } from '@common/types/id-column';
import {
  baseUrlField,
  modelField,
  nameField,
} from '@controllers/user-settings/ai-connections/connection-field-schemas';
import { Table, Column, Model, ForeignKey, DataType, BelongsTo, Index } from 'sequelize-typescript';
import { z } from 'zod';

import Users from './users.model';

/** `connectionId: null` is an explicit pick of the included server model. */
const ZodAiFeatureConfigSchema = z.object({
  feature: z.nativeEnum(AI_FEATURE),
  connectionId: z.string().nullable(),
});

// Field constraints are shared with the create/update routes so a restored row can't be
// shaped differently from a created one.
const ZodAiConnectionSchema = z
  .object({
    id: z.string(),
    provider: z.nativeEnum(AI_PROVIDER),
    name: nameField,
    baseUrl: baseUrlField.optional(),
    keyEncrypted: z.string().optional(),
    model: modelField,
    createdAt: z.string().datetime(),
    status: z.enum(['valid', 'invalid']),
    lastValidatedAt: z.string().datetime(),
    lastError: z.string().optional(),
    invalidatedAt: z.string().datetime().optional(),
  })
  .superRefine((connection, ctx) => {
    // Native providers always dial their official API, so a stored base URL would be dead weight.
    if ((connection.provider === AI_PROVIDER.custom) !== Boolean(connection.baseUrl)) {
      ctx.addIssue({
        code: 'custom',
        path: ['baseUrl'],
        message: 'baseUrl must be set exactly when provider is custom',
      });
    }
  });

export type StoredConnection = z.infer<typeof ZodAiConnectionSchema>;

const ZodAiSettingsSchema = z.object({
  featureConfigs: z.array(ZodAiFeatureConfigSchema).optional(),
  customInstructions: z.string().max(AI_CUSTOM_INSTRUCTIONS_MAX_LENGTH).optional(),
  /** List order is priority: the first dialable connection answers unconfigured features. */
  connections: z.array(ZodAiConnectionSchema).max(MAX_AI_CONNECTIONS).optional(),
});

const ZodNotificationPreferencesSchema = z.object({
  enabled: z.boolean().default(true),
  types: z.object({
    [NOTIFICATION_TYPES.budgetAlert]: z.boolean().default(true),
    [NOTIFICATION_TYPES.system]: z.boolean().default(true),
    [NOTIFICATION_TYPES.changelog]: z.boolean().default(true),
  }),
});

// Onboarding state schema for Quick Start feature
const ZodOnboardingStateSchema = z.object({
  completedTasks: z.array(z.string()).default([]),
  isDismissed: z.boolean().default(false),
  dismissedAt: z.string().datetime().nullable().default(null),
});

// Schema for partial updates - no defaults so only provided fields are included
export const ZodOnboardingStateUpdateSchema = z.object({
  completedTasks: z.array(z.string()).optional(),
  isDismissed: z.boolean().optional(),
  dismissedAt: z.string().datetime().nullable().optional(),
});

export type OnboardingStateSchema = z.infer<typeof ZodOnboardingStateSchema>;

export const DEFAULT_ONBOARDING_STATE: OnboardingStateSchema = {
  completedTasks: [],
  isDismissed: false,
  dismissedAt: null,
};

// Spike detection config keys that can appear in balance-trend widget config
const ZodSpikeConfigSchema = z.object({
  spikesEnabled: z.boolean().optional(),
  spikePercentThreshold: z.number().min(1).max(50).optional(),
  spikeAbsoluteThreshold: z.number().min(1).max(10000).optional(),
  spikeMaxCount: z.number().int().min(1).max(20).optional(),
});

const ZodDashboardWidgetSchema = z
  .object({
    widgetId: z.string(),
    colSpan: z.number().int().min(1).max(3).default(1),
    rowSpan: z.number().int().min(1).max(2).default(1),
    config: z.record(z.string(), z.unknown()).optional(),
  })
  .superRefine((widget, ctx) => {
    if (!widget.config) return;

    // Only balance-trend uses spike keys, but the schema is widget-agnostic, so
    // validate them on any widget that carries them and ignore unknown keys.
    const spikeKeys = Object.keys(ZodSpikeConfigSchema.shape);
    const hasSpikeKeys = spikeKeys.some((key) => key in widget.config!);

    if (hasSpikeKeys) {
      const result = ZodSpikeConfigSchema.safeParse(widget.config);
      if (!result.success) {
        for (const issue of result.error.issues) {
          ctx.addIssue({ ...issue, path: ['config', ...issue.path] });
        }
      }
    }
  });

const ZodDashboardSettingsSchema = z.object({
  widgets: z.array(ZodDashboardWidgetSchema).default([]),
});

// Per-section visibility for the sidebar's Accounts panel. The "Bank Accounts"
// section is always visible and intentionally not configurable here.
const ZodSidebarSectionsSchema = z.object({
  portfolios: z.boolean().default(true),
  ventures: z.boolean().default(true),
  vehicles: z.boolean().default(true),
  loans: z.boolean().default(true),
});

// Column ids are plain strings (not an enum) on purpose: the column set is a
// frontend concern and may grow without a backend deploy. Unknown ids are
// dropped client-side on read, so stale entries are harmless.
const ZodTransactionsTableSettingsSchema = z.object({
  visibleColumns: z.array(z.string()).default([]),
  columnOrder: z.array(z.string()).default([]),
  mobileView: z.enum(['list', 'table']).optional(),
  desktopView: z.enum(['list', 'table']).optional(),
  /** Filters added on top of the always-visible ones. Plain strings, like column ids. */
  extraFilters: z.array(z.string()).optional(),
  /** Shades non-editable cells on every row instead of only the hovered one. */
  alwaysShowLockedCells: z.boolean().optional(),
});

const ZodInvestmentTransactionsTableSettingsSchema = z.object({
  visibleColumns: z.array(z.string()).default([]),
  columnOrder: z.array(z.string()).default([]),
});

// List-view-only preferences for /records (the table view has its own schema).
const ZodTransactionsListSettingsSchema = z.object({
  /** Hides the pinned "Upcoming" section (overdue + due within 3 days). Defaults to false. */
  hideUpcoming: z.boolean().optional(),
});

// Transaction-form-only preferences.
const ZodTransactionFormSettingsSchema = z.object({
  /** Optional form fields the user turned on. A field holding a value is shown regardless. */
  optionalFields: z.array(z.enum(TRANSACTION_OPTIONAL_FIELDS)).optional(),
  /** Whether the transaction form may load map tiles and address search from OpenStreetMap. */
  mapPicker: z.boolean().optional(),
  /** Payment type preselected on new transactions. Credit card when unset. */
  defaultPaymentType: z.enum(PAYMENT_TYPES).optional(),
});

// UI-state preferences (table layouts, view modes). Functional settings keep
// their own top-level keys; this namespace is only for presentation state.
const ZodUiSettingsSchema = z.object({
  transactionsTable: ZodTransactionsTableSettingsSchema.optional(),
  transactionsList: ZodTransactionsListSettingsSchema.optional(),
  transactionForm: ZodTransactionFormSettingsSchema.optional(),
  investmentTransactionsTable: ZodInvestmentTransactionsTableSettingsSchema.optional(),
});

// Subscription-related defaults. `defaultAutoRecord` only seeds the auto-record toggle on
// the create-subscription form; the user can still override it per subscription.
const ZodSubscriptionsSettingsSchema = z.object({
  defaultAutoRecord: z.boolean().optional(),
});

// A category mapping remembered from a finished import, keyed by a fingerprint of the source
// layout. Untrusted client input, so the per-value union is validated in full.
const ZodCategoryMappingPresetSchema = z.object({
  fingerprint: z.string().min(1).max(128),
  name: z.string().trim().min(1).max(64).optional(),
  categoryMapping: z.record(
    z.string(),
    z.union([
      z.object({ action: z.literal('create-new') }),
      z.object({ action: z.literal('link-existing'), categoryId: z.string().min(1) }),
    ]),
  ),
  updatedAt: z.string(),
});

// Data-import defaults. `recalculateAccountBalance` only seeds the "update account balances
// from imported transactions" checkbox; the execute request's `recalculateBalance` is what
// actually applies.
const ZodImportSettingsSchema = z.object({
  recalculateAccountBalance: z.boolean().optional(),
  categoryMappingPresets: z.array(ZodCategoryMappingPresetSchema).max(MAX_CATEGORY_MAPPING_PRESETS).optional(),
});

// Account-picker defaults. `defaultAccountId` pre-selects account pickers, null means cleared.
// `showArchivedInDropdowns` also offers archived accounts in those pickers, off by default.
const ZodAccountsSettingsSchema = z.object({
  // Plain z.uuid(), not recordId(): the branded RecordId output breaks the
  // DeepPartial-based SettingsPatchSchemaIsInSync assertion below.
  defaultAccountId: z.uuid().nullable().optional(),
  showArchivedInDropdowns: z.boolean().optional(),
});

// A saved Pivot Report "view", persisted in the settings JSONB with no dedicated table.
// Reuses `dateRange()` + `withDateOrder()` so a saved view can't hold a range the live
// report would 400 on.
const ZodSavedPivotViewConfigSchema = withDateOrder(
  z.object({
    // Enum members come from the shared pivot tuples so a persisted view can never accept a
    // dimension/granularity the report itself rejects.
    rowDimension: z.enum(endpointsTypes.PIVOT_ROW_DIMENSIONS),
    granularity: z.enum(endpointsTypes.PIVOT_GRANULARITIES),
    measure: z.enum(endpointsTypes.PIVOT_MEASURES),
    ...dateRange({ required: true }),
    accountIds: z.array(z.string()).optional(),
    categoryIds: z.array(z.string()).optional(),
    payeeIds: z.array(z.string()).optional(),
    heatmap: z.boolean().default(false),
    showDelta: z.boolean().default(true),
  }),
);

const ZodSavedPivotViewSchema = z.object({
  id: z.string(),
  name: z.string().min(1).max(endpointsTypes.SAVED_PIVOT_VIEW_NAME_MAX_LENGTH),
  config: ZodSavedPivotViewConfigSchema,
});

const fireRange = ({ key }: { key: keyof typeof FIRE_LIMITS }) =>
  z.number().min(FIRE_LIMITS[key].min).max(FIRE_LIMITS[key].max);

// No `.default()` anywhere: the PATCH deep merge would write defaults over stored values.
const ZodFireSettingsSchema = z.object({
  annualSpendingOverride: z.number().min(0).nullable().optional(),
  monthlyContributionOverride: z.number().nullable().optional(),
  spendingExcludedCategoryIds: z.array(z.uuid()).max(FIRE_MAX_EXCLUDED_CATEGORIES).optional(),
  includeVentures: z.boolean().optional(),
  includeVehicles: z.boolean().optional(),
  includeLoans: z.boolean().optional(),
  returnIndicatorId: z.string().max(64).optional(),
  customReturnPct: fireRange({ key: 'customReturnPct' }).nullable().optional(),
  inflationPct: fireRange({ key: 'inflationPct' }).optional(),
  withdrawalRatePct: fireRange({ key: 'withdrawalRatePct' }).optional(),
  leanMultiplier: fireRange({ key: 'leanMultiplier' }).optional(),
  fatMultiplier: fireRange({ key: 'fatMultiplier' }).optional(),
  baristaMonthlyIncome: z.number().min(0).nullable().optional(),
  birthYear: fireRange({ key: 'birthYear' }).int().nullable().optional(),
  coastTargetAge: fireRange({ key: 'coastTargetAge' }).int().optional(),
  targetType: z.enum(FIRE_TARGET_TYPES).optional(),
});

export const ZodSettingsSchema = z.object({
  locale: z.enum(SUPPORTED_LOCALES).default(SUPPORTED_LOCALES.ENGLISH),
  ai: ZodAiSettingsSchema.optional(),
  notifications: ZodNotificationPreferencesSchema.optional(),
  onboarding: ZodOnboardingStateSchema.optional(),
  dashboard: ZodDashboardSettingsSchema.optional(),
  includeCreditLimitInStats: z.boolean().optional(),
  sidebarSections: ZodSidebarSectionsSchema.optional(),
  ui: ZodUiSettingsSchema.optional(),
  subscriptions: ZodSubscriptionsSettingsSchema.optional(),
  import: ZodImportSettingsSchema.optional(),
  accounts: ZodAccountsSettingsSchema.optional(),
  savedPivotViews: z.array(ZodSavedPivotViewSchema).optional(),
  // When true, Payee extraction falls back to the transaction description/note when the
  // provider's merchant field is empty. Off by default because Monobank's `counterName` is
  // empty for most card purchases, so it has to be an opt-in.
  payeeExtractionUsesDescription: z.boolean().optional(),
  // How many transactions must share a raw merchant name before a Payee is auto-created from it.
  // Banks that embed reference numbers in the counterparty string would otherwise spawn one Payee
  // per row at 1, so 2 is the default.
  payeePromotionThreshold: z.number().int().min(1).max(3).optional(),
  // Header "Support" (donation) button. Visible when unset; users opt out in Appearance settings.
  showSupportButton: z.boolean().optional(),
  // When true, the sidebar Accounts panel hides accounts whose display balance is
  // zero, and hides any account group left with no non-zero account. Off by default.
  hideZeroBalances: z.boolean().optional(),
  // When true, manual (`system`) accounts are offered as candidates to the bank-sync transfer
  // matcher. Opt-in because linking turns a manually recorded row into a transfer leg, and
  // transfer legs carry no category, so the row disappears from category stats.
  matchTransfersWithManualAccounts: z.boolean().optional(),
  // When true, Enable Banking sync stores PDNG/HOLD payloads before the bank books them.
  // Off by default: pending payloads often lack the merchant and final text.
  importPendingBankTransactions: z.boolean().optional(),
  // Categories whose legs leave the cash-flow report entirely, so money moved into them counts as
  // savings rather than spend. Descendants are expanded server-side. Plain z.uuid(), not
  // recordId(): the branded RecordId output breaks the SettingsPatchSchemaIsInSync assertion below.
  savingsCategoryIds: z.array(z.uuid()).optional(),
  currencyDisplay: z.enum(endpointsTypes.CURRENCY_DISPLAY_PREFERENCES).optional(),
  fire: ZodFireSettingsSchema.optional(),
});

export type SettingsSchema = z.infer<typeof ZodSettingsSchema>;

export type StoredAiSettings = NonNullable<SettingsSchema['ai']>;

/**
 * Partial settings update (PATCH): every field optional and no defaults. Zod's `.partial()`
 * still injects defaults for absent keys, and the deep merge would then clobber stored arrays
 * with empty ones. Arrays stay non-partial because the merge replaces them wholesale.
 */
export const ZodSettingsPatchSchema = z.object({
  locale: z.enum(SUPPORTED_LOCALES).optional(),
  ai: z
    .object({
      customInstructions: z.string().max(AI_CUSTOM_INSTRUCTIONS_MAX_LENGTH).optional(),
    })
    .optional(),
  notifications: z
    .object({
      enabled: z.boolean().optional(),
      types: z
        .object({
          [NOTIFICATION_TYPES.budgetAlert]: z.boolean().optional(),
          [NOTIFICATION_TYPES.system]: z.boolean().optional(),
          [NOTIFICATION_TYPES.changelog]: z.boolean().optional(),
        })
        .optional(),
    })
    .optional(),
  dashboard: z
    .object({
      widgets: z.array(ZodDashboardWidgetSchema).optional(),
    })
    .optional(),
  includeCreditLimitInStats: z.boolean().optional(),
  sidebarSections: z
    .object({
      portfolios: z.boolean().optional(),
      ventures: z.boolean().optional(),
      vehicles: z.boolean().optional(),
      loans: z.boolean().optional(),
    })
    .optional(),
  ui: z
    .object({
      transactionsTable: z
        .object({
          visibleColumns: z.array(z.string()).optional(),
          columnOrder: z.array(z.string()).optional(),
          mobileView: z.enum(['list', 'table']).optional(),
          desktopView: z.enum(['list', 'table']).optional(),
          extraFilters: z.array(z.string()).optional(),
          alwaysShowLockedCells: z.boolean().optional(),
        })
        .optional(),
      transactionsList: z
        .object({
          hideUpcoming: z.boolean().optional(),
        })
        .optional(),
      transactionForm: z
        .object({
          optionalFields: z.array(z.enum(TRANSACTION_OPTIONAL_FIELDS)).optional(),
          mapPicker: z.boolean().optional(),
          defaultPaymentType: z.enum(PAYMENT_TYPES).optional(),
        })
        .optional(),
      investmentTransactionsTable: z
        .object({
          visibleColumns: z.array(z.string()).optional(),
          columnOrder: z.array(z.string()).optional(),
        })
        .optional(),
    })
    .optional(),
  subscriptions: z
    .object({
      defaultAutoRecord: z.boolean().optional(),
    })
    .optional(),
  import: z
    .object({
      recalculateAccountBalance: z.boolean().optional(),
      // Same element schema as `ZodSettingsSchema`, so the two can't drift.
      categoryMappingPresets: z.array(ZodCategoryMappingPresetSchema).max(MAX_CATEGORY_MAPPING_PRESETS).optional(),
    })
    .optional(),
  accounts: ZodAccountsSettingsSchema.optional(),
  // Same element schema as `ZodSettingsSchema`, defaults and all, so the two can't drift.
  savedPivotViews: z.array(ZodSavedPivotViewSchema).optional(),
  payeeExtractionUsesDescription: z.boolean().optional(),
  payeePromotionThreshold: z.number().int().min(1).max(3).optional(),
  showSupportButton: z.boolean().optional(),
  hideZeroBalances: z.boolean().optional(),
  matchTransfersWithManualAccounts: z.boolean().optional(),
  importPendingBankTransactions: z.boolean().optional(),
  savingsCategoryIds: z.array(z.uuid()).optional(),
  currencyDisplay: z.enum(endpointsTypes.CURRENCY_DISPLAY_PREFERENCES).optional(),
  fire: ZodFireSettingsSchema.optional(),
});

export type SettingsPatchSchema = z.infer<typeof ZodSettingsPatchSchema>;

/** `NonNullable` keeps the recursion working for optional properties. */
type DeepPartial<T> = {
  [K in keyof T]?: NonNullable<T[K]> extends (infer U)[]
    ? U[]
    : NonNullable<T[K]> extends object
      ? DeepPartial<NonNullable<T[K]>>
      : T[K];
};

type PatchableSettings = Omit<SettingsSchema, 'onboarding' | 'ai'> & {
  ai?: Omit<NonNullable<SettingsSchema['ai']>, 'connections' | 'featureConfigs'>;
};

/**
 * Compile-time drift guard: `ZodSettingsPatchSchema` must infer exactly the deep-partial of
 * `PatchableSettings`, so a new settings field can't be silently stripped from patches.
 *
 * @public exported only so the assertion isn't flagged as unused.
 */
export type SettingsPatchSchemaIsInSync = Expect<Equals<SettingsPatchSchema, DeepPartial<PatchableSettings>>>;

/** @public exported only so the assertion isn't flagged as unused. */
export type FireSettingsSchemaIsInSync = Expect<Equals<z.infer<typeof ZodFireSettingsSchema>, FireSettings>>;

/**
 * Compile-time drift guard: the persisted saved-pivot-view schema must infer exactly the shared
 * `SavedPivotView` contract the frontend also builds against.
 *
 * @public exported only so the assertion isn't flagged as unused.
 */
export type SavedPivotViewSchemaIsInSync = Expect<
  Equals<z.infer<typeof ZodSavedPivotViewSchema>, endpointsTypes.SavedPivotView>
>;

/**
 * Compile-time drift guard: the persisted category preset must infer exactly the shared
 * `CategoryMappingPreset` contract the frontend also builds against.
 *
 * @public exported only so the assertion isn't flagged as unused.
 */
export type CategoryMappingPresetSchemaIsInSync = Expect<
  Equals<z.infer<typeof ZodCategoryMappingPresetSchema>, CategoryMappingPreset>
>;

/**
 * Compile-time drift guard: the sidebar-sections schema must infer exactly the shared
 * `SidebarSectionsConfig` contract the frontend also reads.
 *
 * @public exported only so the assertion isn't flagged as unused.
 */
export type SidebarSectionsSchemaIsInSync = Expect<
  Equals<z.infer<typeof ZodSidebarSectionsSchema>, endpointsTypes.SidebarSectionsConfig>
>;

/**
 * Compile-time drift guard: a stored connection and the `AIConnectionInfo` the API returns
 * declare the same fields apart from how the key is represented. `provider` is checked
 * separately because Zod infers the enum member union, which `Equals` rejects.
 *
 * @public exported only so the assertion isn't flagged as unused.
 */
export type AiConnectionSchemaIsInSync = Expect<
  Equals<Omit<StoredConnection, 'keyEncrypted' | 'provider'>, Omit<AIConnectionInfo, 'hasApiKey' | 'provider'>>
>;

/** @public exported only so the assertion isn't flagged as unused. */
export type AiConnectionProviderIsInSync = Expect<
  MutuallyAssignable<StoredConnection['provider'], AIConnectionInfo['provider']>
>;

export const DEFAULT_SETTINGS: SettingsSchema = {
  locale: SUPPORTED_LOCALES.ENGLISH,
  includeCreditLimitInStats: false,
};

@Table({
  tableName: 'UserSettings',
  freezeTableName: true,
  timestamps: true,
})
export default class UserSettings extends Model {
  @Column(IdColumn())
  declare id: RecordId;

  @ForeignKey(() => Users)
  // One settings row per user; without it concurrent first-writes could insert
  // duplicate rows and silently lose settings.
  @Index({ name: 'user_settings_user_id_unique', unique: true })
  @Column({
    allowNull: false,
    type: DataType.INTEGER,
  })
  userId!: number;

  @BelongsTo(() => Users)
  user!: Users;

  @Column({
    type: DataType.JSONB,
    allowNull: false,
    defaultValue: DEFAULT_SETTINGS,
  })
  settings!: SettingsSchema;

  @Column({
    allowNull: false,
    type: DataType.DATE,
    defaultValue: DataType.NOW,
  })
  declare createdAt: Date;

  @Column({
    allowNull: false,
    type: DataType.DATE,
    defaultValue: DataType.NOW,
  })
  declare updatedAt: Date;
}

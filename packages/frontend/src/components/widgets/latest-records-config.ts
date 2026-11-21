import type { DashboardWidgetConfig } from '@/api/user-settings';
import type { TagsIndicatorVariant } from '@/components/common/tags-indicator.vue';
import { TRANSACTION_TRANSFER_NATURE } from '@bt/shared/types';

interface LatestRecordsExclusions {
  excludeTransfers: boolean;
  excludeOutOfWallet: boolean;
  /** Narrower than `excludeOutOfWallet`: hides only balance-adjustment rows, not every out-of-wallet transfer. */
  excludeBalanceAdjustments: boolean;
}

/** Out-of-wallet transfers are hidden unless the user opts back in. */
export const readLatestRecordsExclusions = ({
  widgetConfig,
}: {
  widgetConfig: DashboardWidgetConfig | null | undefined;
}): LatestRecordsExclusions => {
  const config = widgetConfig?.config;

  return {
    excludeTransfers: config?.excludeTransfers === true,
    excludeOutOfWallet: config?.excludeOutOfWallet !== false,
    excludeBalanceAdjustments: config?.excludeBalanceAdjustments === true,
  };
};

/**
 * The transactions endpoint has no exclude-list for transfer natures: `transferNatures`
 * is an include-list that supersedes `transferFilter`, so exclusions are expressed as
 * "every nature but these". `undefined` means no narrowing at all.
 */
export const buildLatestRecordsTransferNatures = ({
  excludeTransfers,
  excludeOutOfWallet,
}: LatestRecordsExclusions): TRANSACTION_TRANSFER_NATURE[] | undefined => {
  const excluded: TRANSACTION_TRANSFER_NATURE[] = [];

  if (excludeTransfers) excluded.push(TRANSACTION_TRANSFER_NATURE.common_transfer);
  if (excludeOutOfWallet) excluded.push(TRANSACTION_TRANSFER_NATURE.transfer_out_wallet);

  if (!excluded.length) return undefined;

  return Object.values(TRANSACTION_TRANSFER_NATURE).filter((nature) => !excluded.includes(nature));
};

/** Older configs store the flag as the string `'false'`, so both forms read as off. */
export const readLatestRecordsIncludeScheduled = ({
  widgetConfig,
}: {
  widgetConfig: DashboardWidgetConfig | null | undefined;
}): boolean => {
  const value = widgetConfig?.config?.includeScheduled;
  return value !== false && value !== 'false';
};

/** Chips stay the default; only an explicit `rails` opts in. */
export const readLatestRecordsTagsVariant = ({
  widgetConfig,
}: {
  widgetConfig: DashboardWidgetConfig | null | undefined;
}): TagsIndicatorVariant => (widgetConfig?.config?.tagsVariant === 'rails' ? 'rails' : 'chips');

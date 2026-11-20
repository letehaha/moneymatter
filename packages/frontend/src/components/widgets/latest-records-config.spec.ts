import { TRANSACTION_TRANSFER_NATURE } from '@bt/shared/types';
import { describe, expect, it } from 'vitest';

import {
  buildLatestRecordsTransferNatures,
  readLatestRecordsExclusions,
  readLatestRecordsIncludeScheduled,
  readLatestRecordsTagsVariant,
} from './latest-records-config';

const widgetConfig = (config?: Record<string, unknown>) => ({ widgetId: 'latest-records', colSpan: 1, config });

describe('readLatestRecordsExclusions', () => {
  it('hides out-of-wallet and keeps transfers when nothing is stored', () => {
    expect(readLatestRecordsExclusions({ widgetConfig: widgetConfig() })).toEqual({
      excludeTransfers: false,
      excludeOutOfWallet: true,
      excludeBalanceAdjustments: false,
    });
  });

  it('falls back to defaults without an injected widget config', () => {
    expect(readLatestRecordsExclusions({ widgetConfig: null })).toEqual({
      excludeTransfers: false,
      excludeOutOfWallet: true,
      excludeBalanceAdjustments: false,
    });
  });

  it('reads stored values', () => {
    expect(
      readLatestRecordsExclusions({
        widgetConfig: widgetConfig({
          excludeTransfers: true,
          excludeOutOfWallet: false,
          excludeBalanceAdjustments: true,
        }),
      }),
    ).toEqual({ excludeTransfers: true, excludeOutOfWallet: false, excludeBalanceAdjustments: true });
  });
});

describe('readLatestRecordsIncludeScheduled', () => {
  it('shows scheduled rows unless stored as boolean or legacy string false', () => {
    expect(readLatestRecordsIncludeScheduled({ widgetConfig: widgetConfig() })).toBe(true);
    expect(readLatestRecordsIncludeScheduled({ widgetConfig: widgetConfig({ includeScheduled: 'true' }) })).toBe(true);
    expect(readLatestRecordsIncludeScheduled({ widgetConfig: widgetConfig({ includeScheduled: false }) })).toBe(false);
    expect(readLatestRecordsIncludeScheduled({ widgetConfig: widgetConfig({ includeScheduled: 'false' }) })).toBe(
      false,
    );
  });
});

describe('buildLatestRecordsTransferNatures', () => {
  it('returns undefined when nothing is excluded', () => {
    expect(
      buildLatestRecordsTransferNatures({
        excludeTransfers: false,
        excludeOutOfWallet: false,
        excludeBalanceAdjustments: false,
      }),
    ).toBeUndefined();
  });

  it('keeps plain transactions and every nature but the excluded one', () => {
    const natures = buildLatestRecordsTransferNatures({
      excludeTransfers: false,
      excludeOutOfWallet: true,
      excludeBalanceAdjustments: false,
    });

    expect(natures).toContain(TRANSACTION_TRANSFER_NATURE.not_transfer);
    expect(natures).toContain(TRANSACTION_TRANSFER_NATURE.common_transfer);
    expect(natures).not.toContain(TRANSACTION_TRANSFER_NATURE.transfer_out_wallet);
  });

  it('drops both natures when both exclusions are on', () => {
    const natures = buildLatestRecordsTransferNatures({
      excludeTransfers: true,
      excludeOutOfWallet: true,
      excludeBalanceAdjustments: false,
    });

    expect(natures).not.toContain(TRANSACTION_TRANSFER_NATURE.common_transfer);
    expect(natures).not.toContain(TRANSACTION_TRANSFER_NATURE.transfer_out_wallet);
    expect(natures).toContain(TRANSACTION_TRANSFER_NATURE.not_transfer);
    expect(natures).toContain(TRANSACTION_TRANSFER_NATURE.transfer_to_loan);
  });
});

describe('readLatestRecordsTagsVariant', () => {
  it('defaults to chips when nothing is stored or the config is missing', () => {
    expect(readLatestRecordsTagsVariant({ widgetConfig: widgetConfig() })).toBe('chips');
    expect(readLatestRecordsTagsVariant({ widgetConfig: null })).toBe('chips');
  });

  it('reads rails', () => {
    expect(readLatestRecordsTagsVariant({ widgetConfig: widgetConfig({ tagsVariant: 'rails' }) })).toBe('rails');
  });

  it('falls back to chips for unknown values', () => {
    expect(readLatestRecordsTagsVariant({ widgetConfig: widgetConfig({ tagsVariant: 'dots' }) })).toBe('chips');
  });
});

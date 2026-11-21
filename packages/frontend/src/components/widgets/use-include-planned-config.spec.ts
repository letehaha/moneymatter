import { describe, expect, it } from 'vitest';

import { readIncludePlanned, readWidgetConfigFlag } from './use-include-planned-config';

describe('readIncludePlanned', () => {
  it('defaults to true without a config', () => {
    expect(readIncludePlanned({ config: undefined })).toBe(true);
  });

  it('defaults to true when the key is absent', () => {
    expect(readIncludePlanned({ config: { someOtherSetting: 1 } })).toBe(true);
  });

  it('returns false when the key is false', () => {
    expect(readIncludePlanned({ config: { includePlanned: false } })).toBe(false);
  });

  it('returns true when the key is true', () => {
    expect(readIncludePlanned({ config: { includePlanned: true } })).toBe(true);
  });
});

describe('readWidgetConfigFlag', () => {
  it('falls back to the default when the key is absent', () => {
    expect(readWidgetConfigFlag({ config: undefined, key: 'showReached', defaultValue: false })).toBe(false);
    expect(readWidgetConfigFlag({ config: {}, key: 'showTrend', defaultValue: true })).toBe(true);
  });

  it('returns the stored boolean over the default', () => {
    expect(readWidgetConfigFlag({ config: { showReached: true }, key: 'showReached', defaultValue: false })).toBe(true);
    expect(readWidgetConfigFlag({ config: { showTrend: false }, key: 'showTrend', defaultValue: true })).toBe(false);
  });
});

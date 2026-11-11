import plannedEn from '@/i18n/locales/chunks/en/pages/planned.json';
import { SUBSCRIPTION_FREQUENCIES, SUBSCRIPTION_INTERVAL_UNITS, SUBSCRIPTION_TYPES } from '@bt/shared/types';
import { describe, expect, it } from 'vitest';
import { type ComposerTranslation, createI18n } from 'vue-i18n';

import {
  ALL_TYPES_FILTER,
  DEFAULT_SUBSCRIPTION_SORT,
  SUBSCRIPTION_SORT_KEYS,
  formatFrequency,
  getPercentOfIncomeColorClass,
  isIntervalCountValid,
  isSubscriptionSortKey,
} from './utils';

describe('isSubscriptionSortKey', () => {
  it('accepts every known sort key', () => {
    for (const key of Object.values(SUBSCRIPTION_SORT_KEYS)) {
      expect(isSubscriptionSortKey(key)).toBe(true);
    }
  });

  it('rejects unknown strings', () => {
    expect(isSubscriptionSortKey('createdAt')).toBe(false);
    expect(isSubscriptionSortKey('')).toBe(false);
    expect(isSubscriptionSortKey('DueDate')).toBe(false);
  });

  it('rejects non-string values', () => {
    expect(isSubscriptionSortKey(null)).toBe(false);
    expect(isSubscriptionSortKey(undefined)).toBe(false);
    expect(isSubscriptionSortKey(0)).toBe(false);
    expect(isSubscriptionSortKey({})).toBe(false);
  });
});

describe('DEFAULT_SUBSCRIPTION_SORT', () => {
  it('is a valid sort key', () => {
    expect(isSubscriptionSortKey(DEFAULT_SUBSCRIPTION_SORT)).toBe(true);
  });
});

describe('getPercentOfIncomeColorClass', () => {
  it('is muted when the percent is unknown', () => {
    expect(getPercentOfIncomeColorClass({ percent: null })).toBe('text-muted-foreground');
    expect(getPercentOfIncomeColorClass({ percent: undefined })).toBe('text-muted-foreground');
  });

  it('escalates through income, warning and expense colors as the share grows', () => {
    expect(getPercentOfIncomeColorClass({ percent: 19 })).toBe('text-app-income-color');
    expect(getPercentOfIncomeColorClass({ percent: 20 })).toBe('text-warning-text');
    expect(getPercentOfIncomeColorClass({ percent: 40 })).toBe('text-app-expense-color');
  });

  it('defaults to the all-types thresholds when no type is given', () => {
    expect(getPercentOfIncomeColorClass({ percent: 25 })).toBe(
      getPercentOfIncomeColorClass({ percent: 25, type: ALL_TYPES_FILTER }),
    );
  });

  it('alarms much earlier for subscriptions than for bills', () => {
    expect(getPercentOfIncomeColorClass({ percent: 10, type: SUBSCRIPTION_TYPES.subscription })).toBe(
      'text-app-expense-color',
    );
    expect(getPercentOfIncomeColorClass({ percent: 10, type: SUBSCRIPTION_TYPES.bill })).toBe('text-app-income-color');
    expect(getPercentOfIncomeColorClass({ percent: 30, type: SUBSCRIPTION_TYPES.bill })).toBe('text-warning-text');
    expect(getPercentOfIncomeColorClass({ percent: 50, type: SUBSCRIPTION_TYPES.bill })).toBe('text-app-expense-color');
  });
});

describe('formatFrequency', () => {
  // The real en copy, typed loosely like the app's global `t`.
  const t = createI18n({ legacy: false, locale: 'en', messages: { en: plannedEn } }).global
    .t as unknown as ComposerTranslation;
  const custom = SUBSCRIPTION_FREQUENCIES.custom;

  it('labels a preset by its name', () => {
    expect(formatFrequency({ frequency: SUBSCRIPTION_FREQUENCIES.monthly, t })).toBe('Monthly');
  });

  it.each([
    [SUBSCRIPTION_INTERVAL_UNITS.day, 30, 'Every 30 days'],
    [SUBSCRIPTION_INTERVAL_UNITS.day, 1, 'Every day'],
    [SUBSCRIPTION_INTERVAL_UNITS.week, 3, 'Every 3 weeks'],
    [SUBSCRIPTION_INTERVAL_UNITS.month, 2, 'Every 2 months'],
    [SUBSCRIPTION_INTERVAL_UNITS.year, 2, 'Every 2 years'],
  ])('labels a custom %s×%i as "%s"', (intervalUnit, intervalCount, expected) => {
    expect(formatFrequency({ frequency: custom, intervalUnit, intervalCount, t })).toBe(expected);
  });

  it('labels a custom frequency without a step as Custom', () => {
    expect(formatFrequency({ frequency: custom, t })).toBe('Custom');
  });
});

describe('isIntervalCountValid', () => {
  const { day, week, month, year } = SUBSCRIPTION_INTERVAL_UNITS;

  it('accepts whole counts within the unit limit', () => {
    expect(isIntervalCountValid({ unit: day, count: 1 })).toBe(true);
    expect(isIntervalCountValid({ unit: day, count: 366 })).toBe(true);
    expect(isIntervalCountValid({ unit: week, count: 104 })).toBe(true);
    expect(isIntervalCountValid({ unit: month, count: 120 })).toBe(true);
    expect(isIntervalCountValid({ unit: year, count: 10 })).toBe(true);
  });

  it('rejects an empty, fractional, zero or too large count', () => {
    expect(isIntervalCountValid({ unit: day, count: null })).toBe(false);
    expect(isIntervalCountValid({ unit: day, count: 1.5 })).toBe(false);
    expect(isIntervalCountValid({ unit: day, count: 0 })).toBe(false);
    expect(isIntervalCountValid({ unit: day, count: 367 })).toBe(false);
    expect(isIntervalCountValid({ unit: week, count: 105 })).toBe(false);
    expect(isIntervalCountValid({ unit: month, count: 121 })).toBe(false);
    expect(isIntervalCountValid({ unit: year, count: 11 })).toBe(false);
  });
});

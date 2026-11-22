import type { CurrencyRateHistoryItem } from '@bt/shared/types';
import { enUS } from 'date-fns/locale';
import { describe, expect, it, vi } from 'vitest';

vi.mock('@/composable/use-date-locale', () => ({ getDateFnsLocale: () => enUS }));

import {
  dayBefore,
  formatDay,
  formatDayRange,
  formatRateDays,
  previewRateRemoval,
  previewRateWrite,
} from './rate-timeline';

const rate = ({ day, value = 1 }: { day: string; value?: number }): CurrencyRateHistoryItem => ({
  quoteCode: 'USD',
  rate: value,
  effectiveDate: day,
  source: 'manual',
  writtenAt: `${day}T10:00:00.000Z`,
  isInForce: false,
});

/** Latest first, as the API returns them. */
const rates = ({ days }: { days: string[] }) => days.map((day, index) => rate({ day, value: index + 1 }));

const TODAY = '2026-11-22';

describe('dayBefore', () => {
  it('crosses month, year and leap-day boundaries', () => {
    expect(dayBefore({ day: '2026-12-01' })).toBe('2026-11-30');
    expect(dayBefore({ day: '2027-01-01' })).toBe('2026-12-31');
    expect(dayBefore({ day: '2024-03-01' })).toBe('2024-02-29');
  });
});

describe('formatRateDays', () => {
  const t = ((key: string, params: { from: string }) => `${key}:${params.from}`) as never;

  it('shows a closed span as a day range', () => {
    expect(formatRateDays({ from: '2026-11-14', to: '2026-11-21', t })).toBe('Nov 14 – Nov 21, 2026');
  });

  it('shows an open span as running from its day until now', () => {
    expect(formatRateDays({ from: '2026-11-14', to: null, t })).toBe('settings.currencies.dialog.row.now:Nov 14, 2026');
  });
});

describe('previewRateWrite', () => {
  const list = rates({ days: ['2026-11-20', '2026-11-14', '2026-11-01'] });

  it('is unknown when the history failed to load', () => {
    expect(previewRateWrite({ day: TODAY, today: TODAY, rates: [], hasOlder: false, isLoadFailed: true })).toEqual({
      kind: 'unknown',
    });
  });

  describe('the day already has a rate', () => {
    it('replaces the newest rate onward', () => {
      expect(
        previewRateWrite({ day: '2026-11-20', today: TODAY, rates: list, hasOlder: false, isLoadFailed: false }),
      ).toEqual({
        kind: 'replace',
        existing: list[0],
        recalculated: { from: '2026-11-20', to: null },
      });
    });

    it('replaces a middle rate until the day before the next one', () => {
      expect(
        previewRateWrite({ day: '2026-11-14', today: TODAY, rates: list, hasOlder: false, isLoadFailed: false }),
      ).toEqual({
        kind: 'replace',
        existing: list[1],
        recalculated: { from: '2026-11-14', to: '2026-11-19' },
      });
    });

    it('reaches every earlier day when replacing the earliest rate', () => {
      expect(
        previewRateWrite({ day: '2026-11-01', today: TODAY, rates: list, hasOlder: false, isLoadFailed: false }),
      ).toEqual({
        kind: 'replace',
        existing: list[2],
        recalculated: { from: null, to: '2026-11-13' },
      });
    });

    it('starts at the day when replacing the earliest loaded rate and older pages exist', () => {
      expect(
        previewRateWrite({ day: '2026-11-01', today: TODAY, rates: list, hasOlder: true, isLoadFailed: false }),
      ).toEqual({
        kind: 'replace',
        existing: list[2],
        recalculated: { from: '2026-11-01', to: '2026-11-13' },
      });
    });

    it("replaces today's rate even though a new day would change nothing", () => {
      const withToday = rates({ days: [TODAY, '2026-11-01'] });
      expect(
        previewRateWrite({ day: TODAY, today: TODAY, rates: withToday, hasOlder: false, isLoadFailed: false }),
      ).toEqual({
        kind: 'replace',
        existing: withToday[0],
        recalculated: { from: TODAY, to: null },
      });
    });

    it('replaces the only rate on every day', () => {
      const single = rates({ days: [TODAY] });
      expect(
        previewRateWrite({ day: TODAY, today: TODAY, rates: single, hasOlder: false, isLoadFailed: false }),
      ).toEqual({
        kind: 'replace',
        existing: single[0],
        recalculated: { from: null, to: null },
      });
    });

    it('replaces a one-day rate between daily rates', () => {
      const daily = rates({ days: ['2026-11-21', '2026-11-20', '2026-11-19'] });
      expect(
        previewRateWrite({ day: '2026-11-20', today: TODAY, rates: daily, hasOlder: true, isLoadFailed: false }),
      ).toEqual({
        kind: 'replace',
        existing: daily[1],
        recalculated: { from: '2026-11-20', to: '2026-11-20' },
      });
    });
  });

  describe('today or later, with an earlier rate', () => {
    it('changes nothing for today', () => {
      expect(previewRateWrite({ day: TODAY, today: TODAY, rates: list, hasOlder: false, isLoadFailed: false })).toEqual(
        {
          kind: 'noChange',
        },
      );
    });

    it('changes nothing for a future day', () => {
      expect(
        previewRateWrite({ day: '2026-12-01', today: TODAY, rates: list, hasOlder: false, isLoadFailed: false }),
      ).toEqual({
        kind: 'noChange',
      });
    });

    it('changes nothing even when older pages are not loaded', () => {
      expect(previewRateWrite({ day: TODAY, today: TODAY, rates: list, hasOlder: true, isLoadFailed: false })).toEqual({
        kind: 'noChange',
      });
    });

    it('changes nothing for today when the earlier rate has a later future rate after it', () => {
      const withFuture = rates({ days: ['2026-12-01', '2026-11-01'] });
      expect(
        previewRateWrite({ day: TODAY, today: TODAY, rates: withFuture, hasOlder: false, isLoadFailed: false }),
      ).toEqual({
        kind: 'noChange',
      });
    });
  });

  describe('a past day with no rate', () => {
    it('recalculates from the day onward when it is after the newest rate', () => {
      expect(
        previewRateWrite({ day: '2026-11-21', today: TODAY, rates: list, hasOlder: false, isLoadFailed: false }),
      ).toEqual({
        kind: 'recalculates',
        recalculated: { from: '2026-11-21', to: null },
      });
    });

    it('recalculates until the day before the next rate', () => {
      expect(
        previewRateWrite({ day: '2026-11-10', today: TODAY, rates: list, hasOlder: false, isLoadFailed: false }),
      ).toEqual({
        kind: 'recalculates',
        recalculated: { from: '2026-11-10', to: '2026-11-13' },
      });
    });

    it('recalculates one day when the next rate starts the day after', () => {
      expect(
        previewRateWrite({ day: '2026-11-13', today: TODAY, rates: list, hasOlder: false, isLoadFailed: false }),
      ).toEqual({
        kind: 'recalculates',
        recalculated: { from: '2026-11-13', to: '2026-11-13' },
      });
    });

    it('crosses a year boundary', () => {
      const yearly = rates({ days: ['2027-01-03', '2026-06-01'] });
      expect(
        previewRateWrite({
          day: '2026-12-28',
          today: '2027-02-01',
          rates: yearly,
          hasOlder: false,
          isLoadFailed: false,
        }),
      ).toEqual({
        kind: 'recalculates',
        recalculated: { from: '2026-12-28', to: '2027-01-02' },
      });
    });

    it('uses the day itself when the earlier rate is on the page and more pages exist', () => {
      expect(
        previewRateWrite({ day: '2026-11-10', today: TODAY, rates: list, hasOlder: true, isLoadFailed: false }),
      ).toEqual({
        kind: 'recalculates',
        recalculated: { from: '2026-11-10', to: '2026-11-13' },
      });
    });
  });

  describe('no earlier rate', () => {
    it('recalculates every earlier day too', () => {
      expect(
        previewRateWrite({ day: '2026-10-15', today: TODAY, rates: list, hasOlder: false, isLoadFailed: false }),
      ).toEqual({
        kind: 'recalculates',
        recalculated: { from: null, to: '2026-10-31' },
      });
    });

    it('recalculates every earlier day for today when the only rate is in the future', () => {
      const future = rates({ days: ['2026-12-01'] });
      expect(
        previewRateWrite({ day: TODAY, today: TODAY, rates: future, hasOlder: false, isLoadFailed: false }),
      ).toEqual({
        kind: 'recalculates',
        recalculated: { from: null, to: '2026-11-30' },
      });
    });

    it('recalculates everything when no rates exist', () => {
      expect(previewRateWrite({ day: TODAY, today: TODAY, rates: [], hasOlder: false, isLoadFailed: false })).toEqual({
        kind: 'recalculates',
        recalculated: { from: null, to: null },
      });
    });
  });

  describe('older than every loaded rate while more pages exist', () => {
    it('is unknown for a past day', () => {
      expect(
        previewRateWrite({ day: '2026-10-15', today: TODAY, rates: list, hasOlder: true, isLoadFailed: false }),
      ).toEqual({
        kind: 'unknown',
      });
    });

    it('is unknown for today when every loaded rate is in the future', () => {
      const future = rates({ days: ['2026-12-01'] });
      expect(
        previewRateWrite({ day: TODAY, today: TODAY, rates: future, hasOlder: true, isLoadFailed: false }),
      ).toEqual({
        kind: 'unknown',
      });
    });

    it('is unknown when nothing is loaded yet', () => {
      expect(previewRateWrite({ day: TODAY, today: TODAY, rates: [], hasOlder: true, isLoadFailed: false })).toEqual({
        kind: 'unknown',
      });
    });

    it('still replaces a loaded rate on the earliest loaded day', () => {
      expect(
        previewRateWrite({ day: '2026-11-01', today: TODAY, rates: list, hasOlder: true, isLoadFailed: false }).kind,
      ).toBe('replace');
    });
  });
});

describe('previewRateRemoval', () => {
  const list = rates({ days: ['2026-11-20', '2026-11-14', '2026-11-01'] });

  it('is unknown with no known days when the history failed to load', () => {
    expect(
      previewRateRemoval({ rate: list[0]!, rates: [], hasOlder: false, totalCount: null, isLoadFailed: true }),
    ).toEqual({ kind: 'unknown', affected: null });
  });

  describe('the last rate', () => {
    it('when the total count is one', () => {
      expect(
        previewRateRemoval({ rate: list[0]!, rates: [list[0]!], hasOlder: false, isLoadFailed: false, totalCount: 1 }),
      ).toEqual({
        kind: 'lastRate',
      });
    });

    it('when the total count is one even if the page says otherwise', () => {
      expect(
        previewRateRemoval({ rate: list[0]!, rates: list, hasOlder: true, isLoadFailed: false, totalCount: 1 }),
      ).toEqual({
        kind: 'lastRate',
      });
    });

    it('when one rate is loaded, nothing older exists and the count is unknown', () => {
      expect(
        previewRateRemoval({
          rate: list[0]!,
          rates: [list[0]!],
          hasOlder: false,
          isLoadFailed: false,
          totalCount: null,
        }),
      ).toEqual({
        kind: 'lastRate',
      });
    });

    it('not when one rate is loaded but older pages exist', () => {
      expect(
        previewRateRemoval({
          rate: list[0]!,
          rates: [list[0]!],
          hasOlder: true,
          isLoadFailed: false,
          totalCount: null,
        }),
      ).toEqual({
        kind: 'unknown',
        affected: { from: '2026-11-20', to: null },
      });
    });
  });

  describe('taken over by the older neighbour', () => {
    it('removing the newest rate hands its days onward to the one before', () => {
      expect(
        previewRateRemoval({ rate: list[0]!, rates: list, hasOlder: false, isLoadFailed: false, totalCount: 3 }),
      ).toEqual({
        kind: 'takenOverBy',
        rate: list[1],
        affected: { from: '2026-11-20', to: null },
      });
    });

    it('removing a middle rate hands its range to the one before', () => {
      expect(
        previewRateRemoval({ rate: list[1]!, rates: list, hasOlder: false, isLoadFailed: false, totalCount: 3 }),
      ).toEqual({
        kind: 'takenOverBy',
        rate: list[2],
        affected: { from: '2026-11-14', to: '2026-11-19' },
      });
    });

    it('works with a count of null and older pages', () => {
      expect(
        previewRateRemoval({ rate: list[1]!, rates: list, hasOlder: true, isLoadFailed: false, totalCount: null }),
      ).toEqual({
        kind: 'takenOverBy',
        rate: list[2],
        affected: { from: '2026-11-14', to: '2026-11-19' },
      });
    });

    it('a one-day rate between daily rates', () => {
      const daily = rates({ days: ['2026-11-21', '2026-11-20', '2026-11-19'] });
      expect(
        previewRateRemoval({ rate: daily[1]!, rates: daily, hasOlder: true, isLoadFailed: false, totalCount: null }),
      ).toEqual({
        kind: 'takenOverBy',
        rate: daily[2],
        affected: { from: '2026-11-20', to: '2026-11-20' },
      });
    });

    it('matches the rate by its day, not by object identity', () => {
      expect(
        previewRateRemoval({
          rate: rate({ day: '2026-11-14' }),
          rates: list,
          hasOlder: false,
          isLoadFailed: false,
          totalCount: 3,
        }),
      ).toEqual({
        kind: 'takenOverBy',
        rate: list[2],
        affected: { from: '2026-11-14', to: '2026-11-19' },
      });
    });
  });

  describe('removing the earliest rate', () => {
    it('hands its days and every earlier day to the next newer rate', () => {
      expect(
        previewRateRemoval({ rate: list[2]!, rates: list, hasOlder: false, isLoadFailed: false, totalCount: 3 }),
      ).toEqual({
        kind: 'takenOverBy',
        rate: list[1],
        affected: { from: null, to: '2026-11-13' },
      });
    });

    it('of two, hands everything to the newer one', () => {
      const two = rates({ days: ['2026-11-20', '2026-11-01'] });
      expect(
        previewRateRemoval({ rate: two[1]!, rates: two, hasOlder: false, isLoadFailed: false, totalCount: null }),
      ).toEqual({
        kind: 'takenOverBy',
        rate: two[0],
        affected: { from: null, to: '2026-11-19' },
      });
    });

    it('is unknown when it is only the earliest loaded rate', () => {
      expect(
        previewRateRemoval({ rate: list[2]!, rates: list, hasOlder: true, isLoadFailed: false, totalCount: 40 }),
      ).toEqual({
        kind: 'unknown',
        affected: { from: '2026-11-01', to: '2026-11-13' },
      });
    });
  });
});

describe('formatDay', () => {
  it('formats a medium date', () => {
    expect(formatDay({ day: '2026-11-14' })).toBe('Nov 14, 2026');
    expect(formatDay({ day: '2027-01-03' })).toBe('Jan 3, 2027');
  });

  it('keeps the calendar day whatever the time zone', () => {
    expect(formatDay({ day: '2026-01-01' })).toBe('Jan 1, 2026');
    expect(formatDay({ day: '2026-12-31' })).toBe('Dec 31, 2026');
  });
});

describe('formatDayRange', () => {
  it('shows a one-day range as one date', () => {
    expect(formatDayRange({ from: '2026-11-14', to: '2026-11-14' })).toBe('Nov 14, 2026');
  });

  it('shows the year once within a year', () => {
    expect(formatDayRange({ from: '2026-11-14', to: '2026-11-21' })).toBe('Nov 14 – Nov 21, 2026');
  });

  it('shows both months across a month boundary', () => {
    expect(formatDayRange({ from: '2026-10-28', to: '2026-11-03' })).toBe('Oct 28 – Nov 3, 2026');
  });

  it('shows both years across a year boundary', () => {
    expect(formatDayRange({ from: '2026-12-28', to: '2027-01-03' })).toBe('Dec 28, 2026 – Jan 3, 2027');
  });

  it('shows both years across several years', () => {
    expect(formatDayRange({ from: '2024-02-29', to: '2026-11-13' })).toBe('Feb 29, 2024 – Nov 13, 2026');
  });

  it('shows consecutive days as a range', () => {
    expect(formatDayRange({ from: '2026-11-20', to: '2026-11-21' })).toBe('Nov 20 – Nov 21, 2026');
  });
});

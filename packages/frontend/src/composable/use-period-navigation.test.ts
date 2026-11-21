import { ref } from 'vue';

import {
  type Period,
  getNextPeriod,
  getPayPeriod,
  getPrevPeriod,
  isFullMonthPeriod,
  usePeriodNavigation,
} from './use-period-navigation';

const date = (year: number, month: number, day: number) => new Date(year, month - 1, day);

const expectDateEqual = (actual: Date, expected: Date) => {
  expect(actual.getFullYear()).toBe(expected.getFullYear());
  expect(actual.getMonth()).toBe(expected.getMonth());
  expect(actual.getDate()).toBe(expected.getDate());
};

describe('isFullMonthPeriod', () => {
  it('returns true for a single full month', () => {
    expect(isFullMonthPeriod({ period: { from: date(2025, 1, 1), to: date(2025, 1, 31) } })).toBe(true);
    expect(isFullMonthPeriod({ period: { from: date(2025, 2, 1), to: date(2025, 2, 28) } })).toBe(true);
    expect(isFullMonthPeriod({ period: { from: date(2024, 2, 1), to: date(2024, 2, 29) } })).toBe(true); // leap year
  });

  it('returns true for multiple full months', () => {
    expect(isFullMonthPeriod({ period: { from: date(2025, 1, 1), to: date(2025, 3, 31) } })).toBe(true);
    expect(isFullMonthPeriod({ period: { from: date(2025, 1, 1), to: date(2025, 12, 31) } })).toBe(true);
  });

  it('returns false when from is not the first day of month', () => {
    expect(isFullMonthPeriod({ period: { from: date(2025, 1, 2), to: date(2025, 1, 31) } })).toBe(false);
  });

  it('returns false when to is not the last day of month', () => {
    expect(isFullMonthPeriod({ period: { from: date(2025, 1, 1), to: date(2025, 1, 30) } })).toBe(false);
  });

  it('returns false for arbitrary ranges', () => {
    expect(isFullMonthPeriod({ period: { from: date(2025, 1, 5), to: date(2025, 1, 20) } })).toBe(false);
  });
});

describe('getPrevPeriod', () => {
  describe('full month periods', () => {
    it('navigates from Feb to Jan', () => {
      const result = getPrevPeriod({ period: { from: date(2025, 2, 1), to: date(2025, 2, 28) } });
      expectDateEqual(result.from, date(2025, 1, 1));
      expectDateEqual(result.to, date(2025, 1, 31));
    });

    it('navigates from Jan to Dec (year boundary)', () => {
      const result = getPrevPeriod({ period: { from: date(2025, 1, 1), to: date(2025, 1, 31) } });
      expectDateEqual(result.from, date(2024, 12, 1));
      expectDateEqual(result.to, date(2024, 12, 31));
    });

    it('navigates from Mar (31d) to Feb (28d)', () => {
      const result = getPrevPeriod({ period: { from: date(2025, 3, 1), to: date(2025, 3, 31) } });
      expectDateEqual(result.from, date(2025, 2, 1));
      expectDateEqual(result.to, date(2025, 2, 28));
    });

    it('navigates from Mar to Feb in a leap year', () => {
      const result = getPrevPeriod({ period: { from: date(2024, 3, 1), to: date(2024, 3, 31) } });
      expectDateEqual(result.from, date(2024, 2, 1));
      expectDateEqual(result.to, date(2024, 2, 29));
    });

    it('navigates multi-month period (3 months back)', () => {
      // Jan-Mar → prev 3 months = Oct-Dec previous year
      const result = getPrevPeriod({ period: { from: date(2025, 1, 1), to: date(2025, 3, 31) } });
      expectDateEqual(result.from, date(2024, 10, 1));
      expectDateEqual(result.to, date(2024, 12, 31));
    });

    it('navigates full year period back by 12 months', () => {
      const result = getPrevPeriod({ period: { from: date(2025, 1, 1), to: date(2025, 12, 31) } });
      expectDateEqual(result.from, date(2024, 1, 1));
      expectDateEqual(result.to, date(2024, 12, 31));
    });
  });

  describe('custom day-based periods', () => {
    it('shifts a 10-day range back by 10 days', () => {
      const result = getPrevPeriod({ period: { from: date(2025, 1, 11), to: date(2025, 1, 20) } });
      expect(result.from).toEqual(date(2025, 1, 1));
      expect(result.to).toEqual(date(2025, 1, 10));
    });

    it('shifts across month boundary', () => {
      const result = getPrevPeriod({ period: { from: date(2025, 2, 1), to: date(2025, 2, 10) } });
      // 10 days, so prev = Jan 22 - Jan 31
      expect(result.from).toEqual(date(2025, 1, 22));
      expect(result.to).toEqual(date(2025, 1, 31));
    });
  });
});

describe('getNextPeriod', () => {
  describe('full month periods', () => {
    it('navigates from Jan to Feb', () => {
      const result = getNextPeriod({ period: { from: date(2025, 1, 1), to: date(2025, 1, 31) } });
      expectDateEqual(result.from, date(2025, 2, 1));
      expectDateEqual(result.to, date(2025, 2, 28));
    });

    it('navigates from Dec to Jan (year boundary)', () => {
      const result = getNextPeriod({ period: { from: date(2024, 12, 1), to: date(2024, 12, 31) } });
      expectDateEqual(result.from, date(2025, 1, 1));
      expectDateEqual(result.to, date(2025, 1, 31));
    });

    it('navigates from Feb (28d) to Mar (31d)', () => {
      const result = getNextPeriod({ period: { from: date(2025, 2, 1), to: date(2025, 2, 28) } });
      expectDateEqual(result.from, date(2025, 3, 1));
      expectDateEqual(result.to, date(2025, 3, 31));
    });

    it('navigates from Feb to Mar in a leap year', () => {
      const result = getNextPeriod({ period: { from: date(2024, 2, 1), to: date(2024, 2, 29) } });
      expectDateEqual(result.from, date(2024, 3, 1));
      expectDateEqual(result.to, date(2024, 3, 31));
    });

    it('navigates multi-month period (3 months forward)', () => {
      // Oct-Dec → next 3 months = Jan-Mar next year
      const result = getNextPeriod({ period: { from: date(2024, 10, 1), to: date(2024, 12, 31) } });
      expectDateEqual(result.from, date(2025, 1, 1));
      expectDateEqual(result.to, date(2025, 3, 31));
    });
  });

  describe('custom day-based periods', () => {
    it('shifts a 10-day range forward by 10 days', () => {
      const result = getNextPeriod({ period: { from: date(2025, 1, 1), to: date(2025, 1, 10) } });
      expect(result.from).toEqual(date(2025, 1, 11));
      expect(result.to).toEqual(date(2025, 1, 20));
    });

    it('shifts across month boundary', () => {
      const result = getNextPeriod({ period: { from: date(2025, 1, 25), to: date(2025, 1, 31) } });
      // 7 days, next = Feb 1 - Feb 7
      expect(result.from).toEqual(date(2025, 2, 1));
      expect(result.to).toEqual(date(2025, 2, 7));
    });
  });
});

describe('usePeriodNavigation', () => {
  it('returns reactive computed values', () => {
    const period = ref<Period>({ from: date(2025, 2, 1), to: date(2025, 2, 28) });
    const { isFullMonth, durationDays, prevPeriod, nextPeriod } = usePeriodNavigation({ period });

    expect(isFullMonth.value).toBe(true);
    expect(durationDays.value).toBe(28);
    expectDateEqual(prevPeriod.value.from, date(2025, 1, 1));
    expectDateEqual(prevPeriod.value.to, date(2025, 1, 31));
    expectDateEqual(nextPeriod.value.from, date(2025, 3, 1));
    expectDateEqual(nextPeriod.value.to, date(2025, 3, 31));
  });

  it('reacts to period changes', () => {
    const period = ref<Period>({ from: date(2025, 1, 1), to: date(2025, 1, 31) });
    const { prevPeriod, nextPeriod } = usePeriodNavigation({ period });

    expectDateEqual(nextPeriod.value.from, date(2025, 2, 1));

    // Update the period to February
    period.value = { from: date(2025, 2, 1), to: date(2025, 2, 28) };

    expectDateEqual(prevPeriod.value.from, date(2025, 1, 1));
    expectDateEqual(nextPeriod.value.from, date(2025, 3, 1));
  });

  it('works with a non-full-month period', () => {
    const period = ref<Period>({ from: date(2025, 1, 5), to: date(2025, 1, 14) });
    const { isFullMonth, durationDays } = usePeriodNavigation({ period });

    expect(isFullMonth.value).toBe(false);
    expect(durationDays.value).toBe(10);
  });
});

describe('payday', () => {
  const payday = 25;

  it('getPayPeriod returns the period containing the date', () => {
    const before = getPayPeriod({ date: date(2025, 3, 10), payday });
    expectDateEqual(before.from, date(2025, 2, 25));
    expectDateEqual(before.to, date(2025, 3, 24));

    const onPayday = getPayPeriod({ date: date(2025, 3, 25), payday });
    expectDateEqual(onPayday.from, date(2025, 3, 25));
    expectDateEqual(onPayday.to, date(2025, 4, 24));

    const calendar = getPayPeriod({ date: date(2024, 2, 10) });
    expectDateEqual(calendar.from, date(2024, 2, 1));
    expectDateEqual(calendar.to, date(2024, 2, 29));
  });

  it('getPayPeriod handles month-end dates', () => {
    const period = getPayPeriod({ date: date(2025, 3, 31), payday });
    expectDateEqual(period.from, date(2025, 3, 25));
    expectDateEqual(period.to, date(2025, 4, 24));
  });

  it('navigates whole pay periods across year boundaries', () => {
    const period = getPayPeriod({ date: date(2025, 1, 5), payday });
    expect(isFullMonthPeriod({ period, payday })).toBe(true);
    expect(isFullMonthPeriod({ period })).toBe(false);

    const prev = getPrevPeriod({ period, payday });
    expectDateEqual(prev.from, date(2024, 11, 25));
    expectDateEqual(prev.to, date(2024, 12, 24));

    const next = getNextPeriod({ period, payday });
    expectDateEqual(next.from, date(2025, 1, 25));
    expectDateEqual(next.to, date(2025, 2, 24));
  });

  it('keeps the span when navigating multi-period ranges', () => {
    const period = { from: date(2025, 1, 25), to: date(2025, 4, 24) };
    const prev = getPrevPeriod({ period, payday });
    expectDateEqual(prev.from, date(2024, 10, 25));
    expectDateEqual(prev.to, date(2025, 1, 24));

    const next = getNextPeriod({ period, payday });
    expectDateEqual(next.from, date(2025, 4, 25));
    expectDateEqual(next.to, date(2025, 7, 24));
  });

  it('still steps calendar-aligned ranges by whole months', () => {
    const year = { from: date(2025, 1, 1), to: date(2025, 12, 31) };
    const prevYear = getPrevPeriod({ period: year, payday });
    expectDateEqual(prevYear.from, date(2024, 1, 1));
    expectDateEqual(prevYear.to, date(2024, 12, 31));

    const nextMonth = getNextPeriod({ period: { from: date(2025, 2, 1), to: date(2025, 2, 28) }, payday });
    expectDateEqual(nextMonth.from, date(2025, 3, 1));
    expectDateEqual(nextMonth.to, date(2025, 3, 31));
  });
});

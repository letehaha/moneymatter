import {
  addDays,
  addMonths,
  differenceInCalendarMonths,
  differenceInDays,
  endOfDay,
  getDate,
  setDate,
  startOfDay,
  subDays,
  subMonths,
} from 'date-fns';
import { type MaybeRefOrGetter, computed, toValue } from 'vue';

export interface Period {
  from: Date;
  to: Date;
}

/** The pay period containing `date`, running from `payday` to the day before the next `payday`. */
export const getPayPeriod = ({ date, payday = 1 }: { date: Date; payday?: number }): Period => {
  const from = startOfDay(setDate(getDate(date) >= payday ? date : subMonths(date, 1), payday));
  return { from, to: endOfDay(subDays(addMonths(from, 1), 1)) };
};

const getMonthCount = ({ period }: { period: Period }): number =>
  differenceInCalendarMonths(addDays(period.to, 1), period.from);

export const isFullMonthPeriod = ({ period, payday = 1 }: { period: Period; payday?: number }): boolean =>
  getDate(period.from) === payday && getDate(addDays(period.to, 1)) === payday;

// Calendar-aligned ranges (year presets, months picked by hand) keep stepping by whole months under any payday.
export const isMonthAligned = ({ period, payday }: { period: Period; payday: number }): boolean =>
  isFullMonthPeriod({ period, payday }) || isFullMonthPeriod({ period });

export const getPrevPeriod = ({ period, payday = 1 }: { period: Period; payday?: number }): Period => {
  if (isMonthAligned({ period, payday })) {
    return {
      from: startOfDay(subMonths(period.from, getMonthCount({ period }))),
      to: endOfDay(subDays(period.from, 1)),
    };
  }

  const durationDays = differenceInDays(period.to, period.from) + 1;
  return {
    from: subDays(period.from, durationDays),
    to: subDays(period.from, 1),
  };
};

export const getNextPeriod = ({ period, payday = 1 }: { period: Period; payday?: number }): Period => {
  if (isMonthAligned({ period, payday })) {
    const from = startOfDay(addDays(period.to, 1));
    return {
      from,
      to: endOfDay(subDays(addMonths(from, getMonthCount({ period })), 1)),
    };
  }

  const durationDays = differenceInDays(period.to, period.from) + 1;
  return {
    from: addDays(period.to, 1),
    to: addDays(period.to, durationDays),
  };
};

export const usePeriodNavigation = ({
  period,
  payday = 1,
}: {
  period: MaybeRefOrGetter<Period>;
  payday?: MaybeRefOrGetter<number>;
}) => {
  const isFullMonth = computed(() => isFullMonthPeriod({ period: toValue(period), payday: toValue(payday) }));

  const durationDays = computed(() => {
    const p = toValue(period);
    return differenceInDays(p.to, p.from) + 1;
  });

  const prevPeriod = computed(() => getPrevPeriod({ period: toValue(period), payday: toValue(payday) }));
  const nextPeriod = computed(() => getNextPeriod({ period: toValue(period), payday: toValue(payday) }));

  return {
    isFullMonth,
    durationDays,
    prevPeriod,
    nextPeriod,
  };
};

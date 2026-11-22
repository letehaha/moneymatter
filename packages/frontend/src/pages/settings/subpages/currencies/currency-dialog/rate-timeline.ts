import { getDateFnsLocale } from '@/composable/use-date-locale';
import type { CurrencyRateHistoryItem } from '@bt/shared/types';
import { format, parseISO, subDays } from 'date-fns';
import type { useI18n } from 'vue-i18n';

/** Inclusive day range. `from: null` means "and every earlier day"; `to: null` means "onward". */
export interface DayRange {
  from: string | null;
  to: string | null;
}

export const dayBefore = ({ day }: { day: string }): string => format(subDays(parseISO(day), 1), 'yyyy-MM-dd');

type Dated = Pick<CurrencyRateHistoryItem, 'effectiveDate'>;

/** Rates are latest first, so the closest newer one is the last that is still newer. */
const findNewer = <T extends Dated>({ rates, day }: { rates: T[]; day: string }): T | undefined =>
  rates.findLast((rate) => rate.effectiveDate > day);

const findOlder = <T extends Dated>({ rates, day }: { rates: T[]; day: string }): T | undefined =>
  rates.find((rate) => rate.effectiveDate < day);

const untilNewer = ({ rates, day }: { rates: Dated[]; day: string }): string | null => {
  const newer = findNewer({ rates, day });
  return newer ? dayBefore({ day: newer.effectiveDate }) : null;
};

export type RateWritePreview =
  | { kind: 'replace'; existing: CurrencyRateHistoryItem; recalculated: DayRange }
  | { kind: 'recalculates'; recalculated: DayRange }
  | { kind: 'noChange' }
  | { kind: 'unknown' };

/**
 * What writing a rate on `day` does to saved transactions. `day` is the day the API writes, so the
 * caller passes `today` (the UTC day) when the picked day is the local today.
 */
export const previewRateWrite = ({
  day,
  today,
  rates,
  hasOlder,
  isLoadFailed,
}: {
  day: string;
  today: string;
  rates: CurrencyRateHistoryItem[];
  hasOlder: boolean;
  isLoadFailed: boolean;
}): RateWritePreview => {
  if (isLoadFailed) return { kind: 'unknown' };

  const existing = rates.find((rate) => rate.effectiveDate === day);
  const older = findOlder({ rates, day });

  // Older pages can hold a rate on this very day, or the one before it.
  if (!existing && !older && hasOlder) return { kind: 'unknown' };
  if (!existing && older && day >= today) return { kind: 'noChange' };

  const recalculated: DayRange = {
    from: !older && !hasOlder ? null : day,
    to: untilNewer({ rates, day }),
  };

  return existing ? { kind: 'replace', existing, recalculated } : { kind: 'recalculates', recalculated };
};

/** `affected: null` when the history failed to load, so the removed rate's days are unknown. */
type RemovalPreview =
  | { kind: 'lastRate' }
  | { kind: 'takenOverBy'; rate: CurrencyRateHistoryItem; affected: DayRange }
  | { kind: 'unknown'; affected: DayRange | null };

export const previewRateRemoval = ({
  rate,
  rates,
  hasOlder,
  totalCount,
  isLoadFailed,
}: {
  rate: CurrencyRateHistoryItem;
  rates: CurrencyRateHistoryItem[];
  hasOlder: boolean;
  totalCount: number | null;
  isLoadFailed: boolean;
}): RemovalPreview => {
  if (isLoadFailed) return { kind: 'unknown', affected: null };
  if (totalCount === 1 || (rates.length === 1 && !hasOlder)) return { kind: 'lastRate' };

  const day = rate.effectiveDate;
  const to = untilNewer({ rates, day });
  const older = findOlder({ rates, day });

  if (older) return { kind: 'takenOverBy', rate: older, affected: { from: day, to } };
  if (hasOlder) return { kind: 'unknown', affected: { from: day, to } };

  const newer = findNewer({ rates, day });
  if (!newer) return { kind: 'lastRate' };

  return { kind: 'takenOverBy', rate: newer, affected: { from: null, to } };
};

// date-fns has no year-less medium pattern, so both formats come from Intl to spell months alike.
const formatWith = ({ day, options }: { day: string; options: Intl.DateTimeFormatOptions }): string =>
  new Intl.DateTimeFormat(getDateFnsLocale().code, options).format(parseISO(day));

/** "Nov 14, 2026" */
export const formatDay = ({ day }: { day: string }): string =>
  formatWith({ day, options: { year: 'numeric', month: 'short', day: 'numeric' } });

/** "Nov 14 – Nov 21, 2026", "Dec 28, 2026 – Jan 3, 2027"; a one-day range is one date. */
export const formatDayRange = ({ from, to }: { from: string; to: string }): string => {
  if (from === to) return formatDay({ day: from });

  const start =
    from.slice(0, 4) === to.slice(0, 4)
      ? formatWith({ day: from, options: { month: 'short', day: 'numeric' } })
      : formatDay({ day: from });

  return `${start} – ${formatDay({ day: to })}`;
};

/** The days a rate starting on `from` is used for: "Nov 14 – Nov 21, 2026", or "Nov 14, 2026 – now" when `to` is null. */
export const formatRateDays = ({
  from,
  to,
  t,
}: {
  from: string;
  to: string | null;
  t: ReturnType<typeof useI18n>['t'];
}) => (to ? formatDayRange({ from, to }) : t('settings.currencies.dialog.row.now', { from: formatDay({ day: from }) }));

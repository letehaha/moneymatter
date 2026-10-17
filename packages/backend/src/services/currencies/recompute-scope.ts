/**
 * What a change to a custom currency's rates reaches: which currencies, on which days, and whether
 * rows that already hold a base-currency amount are valued again. Everything here is pure, so the
 * selection rules are tested without a database.
 */

/**
 * - `recompute`: the effective rate of days that already had one changed (a correction, a removed
 *   rate, a backfill of earlier days, a new source), so every row on those days is valued again.
 * - `fill`: a rate was added for a new day. A row valued earlier keeps its amount, and only a row
 *   that was waiting for a rate (`refAmountMissing`) gets one.
 */
export type RecomputeMode = 'recompute' | 'fill';

/** Days `from` (inclusive) to `to` (exclusive) as UTC `YYYY-MM-DD`; `null` leaves that side open. */
export interface RateInterval {
  from: string | null;
  to: string | null;
  mode: RecomputeMode;
}

/** A custom currency and the days whose rate changed. */
export interface CustomRateChange extends RateInterval {
  currencyCode: string;
}

/** Intervals per custom currency code. */
export type RecomputeScope = Map<string, RateInterval[]>;

/**
 * `dependent` is valued through `source`: it is pegged to it, or its stored rate quotes it. When
 * the source's rate changes on a day, the dependent's value changes on that day too.
 */
export interface DependencyEdge {
  dependent: string;
  source: string;
}

const intervalKey = ({ from, to, mode }: RateInterval): string => `${mode}|${from ?? ''}|${to ?? ''}`;

const addInterval = ({ scope, code, interval }: { scope: RecomputeScope; code: string; interval: RateInterval }) => {
  const known = scope.get(code) ?? [];
  if (known.some((item) => intervalKey(item) === intervalKey(interval))) return false;

  scope.set(code, [...known, interval]);

  return true;
};

export const buildScope = ({ changes }: { changes: CustomRateChange[] }): RecomputeScope => {
  const scope: RecomputeScope = new Map();

  for (const { currencyCode, ...interval } of changes) {
    addInterval({ scope, code: currencyCode, interval });
  }

  return scope;
};

/**
 * Follows the dependencies from the changed currencies until nothing new is reached, so a currency
 * pegged to (or quoted through) a changed one is valued again too, however many steps away. A
 * dependent inherits the intervals of what it depends on: on a day its source did not move, neither
 * did it. A cycle of dependencies ends because an interval is added once per currency.
 */
export const expandScope = ({ scope, edges }: { scope: RecomputeScope; edges: DependencyEdge[] }): RecomputeScope => {
  const expanded: RecomputeScope = new Map([...scope].map(([code, intervals]) => [code, [...intervals]]));

  let grew = true;
  while (grew) {
    grew = false;

    for (const { dependent, source } of edges) {
      for (const interval of expanded.get(source) ?? []) {
        if (addInterval({ scope: expanded, code: dependent, interval })) grew = true;
      }
    }
  }

  return expanded;
};

const startOfDay = ({ day }: { day: string }): Date => new Date(`${day}T00:00:00.000Z`);

export interface RowSelector {
  from: Date | null;
  to: Date | null;
  /** Only rows still waiting for a base-currency amount. */
  onlyMissing: boolean;
}

/** One selector per interval: the rows to value again on those days. */
export const buildRowSelectors = ({ intervals }: { intervals: RateInterval[] }): RowSelector[] =>
  intervals.map(({ from, to, mode }) => ({
    from: from ? startOfDay({ day: from }) : null,
    to: to ? startOfDay({ day: to }) : null,
    onlyMissing: mode === 'fill',
  }));

/** Whether a row falls under one of the selectors. */
export const matchesRowSelectors = ({
  selectors,
  row,
}: {
  selectors: RowSelector[];
  row: { time: Date; refAmountMissing: boolean };
}): boolean =>
  selectors.some(
    (selector) =>
      (!selector.from || row.time >= selector.from) &&
      (!selector.to || row.time < selector.to) &&
      (!selector.onlyMissing || row.refAmountMissing),
  );

/**
 * The widest span the selectors cover, to narrow the database read before the precise check: `null`
 * on a side leaves it open, and `onlyMissing` holds when every selector asks for unpriced rows only.
 */
export const selectorEnvelope = ({ selectors }: { selectors: RowSelector[] }): RowSelector => ({
  from: selectors.some((selector) => !selector.from)
    ? null
    : new Date(Math.min(...selectors.map((selector) => selector.from!.getTime()))),
  to: selectors.some((selector) => !selector.to)
    ? null
    : new Date(Math.max(...selectors.map((selector) => selector.to!.getTime()))),
  onlyMissing: selectors.every((selector) => selector.onlyMissing),
});

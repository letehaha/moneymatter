/**
 * What a change to a currency's rates reaches: which custom currencies, on which days. Everything
 * here is pure, so the selection rules are tested without a database.
 */

/** Days `from` (inclusive) to `to` (exclusive) as UTC `YYYY-MM-DD`; `null` leaves that side open. */
export interface RateInterval {
  from: string | null;
  to: string | null;
}

/** A currency and the days whose rate changed. */
export interface CustomRateChange extends RateInterval {
  currencyCode: string;
}

/** Intervals per currency code. */
type RecomputeScope = Map<string, RateInterval[]>;

/**
 * `dependent` (a custom currency) is valued through `source` (an ISO currency): it is pegged to it,
 * or its stored rate quotes it. When the source's rate changes on a day, the dependent's value
 * changes on that day too.
 */
export interface DependencyEdge {
  dependent: string;
  source: string;
}

const intervalKey = ({ from, to }: RateInterval): string => `${from ?? ''}|${to ?? ''}`;

const addInterval = ({ scope, code, interval }: { scope: RecomputeScope; code: string; interval: RateInterval }) => {
  const known = scope.get(code) ?? [];
  if (known.some((item) => intervalKey(item) === intervalKey(interval))) return;

  scope.set(code, [...known, interval]);
};

export const buildScope = ({ changes }: { changes: CustomRateChange[] }): RecomputeScope => {
  const scope: RecomputeScope = new Map();

  for (const { currencyCode, from, to } of changes) {
    addInterval({ scope, code: currencyCode, interval: { from, to } });
  }

  return scope;
};

/**
 * Adds the custom currencies valued through a changed ISO currency, with its intervals: on a day
 * the source did not move, neither did its dependent. Sources are ISO, so one step reaches them all.
 */
export const expandScope = ({ scope, edges }: { scope: RecomputeScope; edges: DependencyEdge[] }): RecomputeScope => {
  const expanded: RecomputeScope = new Map([...scope].map(([code, intervals]) => [code, [...intervals]]));

  for (const { dependent, source } of edges) {
    for (const interval of scope.get(source) ?? []) addInterval({ scope: expanded, code: dependent, interval });
  }

  return expanded;
};

const startOfDay = ({ day }: { day: string }): Date => new Date(`${day}T00:00:00.000Z`);

interface RowSelector {
  from: Date | null;
  to: Date | null;
}

/** One selector per interval: the rows to value again on those days. */
export const buildRowSelectors = ({ intervals }: { intervals: RateInterval[] }): RowSelector[] =>
  intervals.map(({ from, to }) => ({
    from: from ? startOfDay({ day: from }) : null,
    to: to ? startOfDay({ day: to }) : null,
  }));

/** Whether a row falls under one of the selectors. */
export const matchesRowSelectors = ({ selectors, row }: { selectors: RowSelector[]; row: { time: Date } }): boolean =>
  selectors.some(
    (selector) => (!selector.from || row.time >= selector.from) && (!selector.to || row.time < selector.to),
  );

/** The widest span the selectors cover, to narrow the database read before the precise check. */
export const selectorEnvelope = ({ selectors }: { selectors: RowSelector[] }): RowSelector => ({
  from: selectors.some((selector) => !selector.from)
    ? null
    : new Date(Math.min(...selectors.map((selector) => selector.from!.getTime()))),
  to: selectors.some((selector) => !selector.to)
    ? null
    : new Date(Math.max(...selectors.map((selector) => selector.to!.getTime()))),
});

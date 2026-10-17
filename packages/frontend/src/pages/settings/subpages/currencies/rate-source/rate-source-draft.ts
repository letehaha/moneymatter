import {
  type CoingeckoRateSourceConfig,
  DEFAULT_RATE_SOURCE_QUOTE_CURRENCY,
  type HttpRateSourceConfig,
  type PegRateSourceConfig,
  type RateSourceTestFailure,
  type TestCurrencyRateSourceBody,
  type UpdateCurrencyRateSourceBody,
  type UserCurrencyModel,
} from '@bt/shared/types';
import { isEqual } from 'lodash-es';

/** Sources a custom currency can be priced by. `provider` is the market feed of ISO currencies only. */
export const EDITABLE_RATE_SOURCES = ['manual', 'peg', 'coingecko', 'http'] as const;
export type EditableRateSource = (typeof EDITABLE_RATE_SOURCES)[number];

/** The API takes at most this many request headers on an HTTP source. */
export const MAX_HTTP_HEADERS = 10;

/** Placeholders an HTTP source URL may hold; the API fills them in per request. */
export const HTTP_URL_PLACEHOLDERS = ['{date}', '{code}', '{quote}'] as const;

/**
 * What to do with the headers already saved on an HTTP source. Saved values are never returned, so
 * `keep` leaves them alone, `replace` sends the rows below as the new set and `clear` removes them.
 */
export type HttpHeadersMode = 'keep' | 'replace' | 'clear';

export interface HttpHeaderRow {
  id: number;
  name: string;
  value: string;
}

export interface RateSourceDraft {
  source: EditableRateSource;
  peg: { pegCurrency: string | null; factor: string };
  coingecko: { coinId: string; coinLabel: string; quoteCurrency: string };
  http: {
    urlTemplate: string;
    jsonPath: string;
    quoteCurrency: string;
    headersMode: HttpHeadersMode;
    headers: HttpHeaderRow[];
  };
}

/** Validation messages as i18n keys, per field; a field without an entry is valid. */
export interface RateSourceDraftErrors {
  pegCurrency?: string;
  factor?: string;
  coinId?: string;
  urlTemplate?: string;
  jsonPath?: string;
  headers?: string;
}

type SavedSource = Pick<UserCurrencyModel, 'rateSource' | 'rateSourceConfig'>;

const isPegConfig = (config: SavedSource['rateSourceConfig']): config is PegRateSourceConfig =>
  Boolean(config && 'pegCurrency' in config);
const isCoingeckoConfig = (config: SavedSource['rateSourceConfig']): config is CoingeckoRateSourceConfig =>
  Boolean(config && 'coinId' in config);
const isHttpConfig = (config: SavedSource['rateSourceConfig']): config is HttpRateSourceConfig =>
  Boolean(config && 'urlTemplate' in config);

/** Names of the headers saved on the currency's HTTP source; their values are never available. */
export const getSavedHeaderNames = ({ saved }: { saved: SavedSource }): string[] =>
  saved.rateSource === 'http' && isHttpConfig(saved.rateSourceConfig) ? saved.rateSourceConfig.headerNames : [];

let headerRowSequence = 0;

export const createHeaderRow = (): HttpHeaderRow => ({ id: ++headerRowSequence, name: '', value: '' });

/** The editor's starting point: the saved source with its config, or blank fields for the others. */
export const buildDraft = ({ saved }: { saved: SavedSource }): RateSourceDraft => {
  const { rateSourceConfig } = saved;
  const peg = isPegConfig(rateSourceConfig) ? rateSourceConfig : null;
  const coingecko = isCoingeckoConfig(rateSourceConfig) ? rateSourceConfig : null;
  const http = isHttpConfig(rateSourceConfig) ? rateSourceConfig : null;

  return {
    // A custom currency has no market feed, so an unset source reads as the manual one.
    source: (EDITABLE_RATE_SOURCES as readonly string[]).includes(saved.rateSource)
      ? (saved.rateSource as EditableRateSource)
      : 'manual',
    peg: { pegCurrency: peg?.pegCurrency ?? null, factor: String(peg?.factor ?? 1) },
    coingecko: {
      coinId: coingecko?.coinId ?? '',
      coinLabel: coingecko?.coinId ?? '',
      quoteCurrency: coingecko?.quoteCurrency ?? DEFAULT_RATE_SOURCE_QUOTE_CURRENCY,
    },
    http: {
      urlTemplate: http?.urlTemplate ?? '',
      jsonPath: http?.jsonPath ?? '',
      quoteCurrency: http?.quoteCurrency ?? DEFAULT_RATE_SOURCE_QUOTE_CURRENCY,
      headersMode: getSavedHeaderNames({ saved }).length ? 'keep' : 'replace',
      headers: [],
    },
  };
};

/**
 * The `headers` field of an HTTP request body: omitted keeps the saved headers, `{}` removes them,
 * an object replaces them. Rows left entirely blank are ignored.
 */
const buildHeadersField = ({ http }: { http: RateSourceDraft['http'] }): { headers?: Record<string, string> } => {
  if (http.headersMode === 'keep') return {};
  if (http.headersMode === 'clear') return { headers: {} };

  return {
    headers: Object.fromEntries(
      http.headers.filter((row) => row.name.trim() || row.value).map((row) => [row.name.trim(), row.value]),
    ),
  };
};

export const buildRateSourceBody = ({ draft }: { draft: RateSourceDraft }): UpdateCurrencyRateSourceBody => {
  switch (draft.source) {
    case 'manual':
      return { rateSource: 'manual' };
    case 'peg':
      return {
        rateSource: 'peg',
        config: { pegCurrency: draft.peg.pegCurrency ?? '', factor: Number(draft.peg.factor) },
      };
    case 'coingecko':
      return {
        rateSource: 'coingecko',
        config: { coinId: draft.coingecko.coinId, quoteCurrency: draft.coingecko.quoteCurrency },
      };
    case 'http':
      return {
        rateSource: 'http',
        config: {
          urlTemplate: draft.http.urlTemplate.trim(),
          jsonPath: draft.http.jsonPath.trim(),
          quoteCurrency: draft.http.quoteCurrency,
          ...buildHeadersField({ http: draft.http }),
        },
      };
  }
};

/** The body of the preview request: the HTTP settings as typed, today's date. */
export const buildTestBody = ({ draft }: { draft: RateSourceDraft }): TestCurrencyRateSourceBody => {
  const body = buildRateSourceBody({ draft: { ...draft, source: 'http' } });
  if (body.rateSource !== 'http') throw new Error('Expected an http rate source body');

  return { rateSource: 'http', config: body.config };
};

/** Whether the draft would change what is saved, so Save stays disabled for an untouched editor. */
export const isDraftChanged = ({ draft, saved }: { draft: RateSourceDraft; saved: SavedSource }): boolean =>
  !isEqual(buildRateSourceBody({ draft }), buildRateSourceBody({ draft: buildDraft({ saved }) }));

const POSITIVE_NUMBER_PATTERN = /^\d*\.?\d+(e[+-]?\d+)?$/i;

export const isPositiveNumberText = ({ value }: { value: string }): boolean => {
  const text = value.trim();

  return POSITIVE_NUMBER_PATTERN.test(text) && Number.isFinite(Number(text)) && Number(text) > 0;
};

const URL_TEMPLATE_PATTERN = /^https?:\/\/\S+$/i;
const PLACEHOLDER_PATTERN = /\{([^{}]*)\}/g;

/** Whether the template is an http(s) URL whose only placeholders are {date}, {code} and {quote}. */
export const isValidUrlTemplate = ({ value }: { value: string }): boolean => {
  const text = value.trim();
  if (!URL_TEMPLATE_PATTERN.test(text)) return false;

  const known = new Set(HTTP_URL_PLACEHOLDERS.map((placeholder) => placeholder.slice(1, -1)));
  const names = [...text.matchAll(PLACEHOLDER_PATTERN)].map((match) => match[1]!);
  const withoutPlaceholders = text.replace(PLACEHOLDER_PATTERN, '');

  return names.every((name) => known.has(name)) && !/[{}]/.test(withoutPlaceholders);
};

/**
 * Checks the fields the chosen source needs. The API validates again (the JSON path and the header
 * names in particular), and its message is shown if it refuses what passes here.
 */
export const validateDraft = ({ draft }: { draft: RateSourceDraft }): RateSourceDraftErrors => {
  const errors: RateSourceDraftErrors = {};

  if (draft.source === 'peg') {
    if (!draft.peg.pegCurrency) errors.pegCurrency = 'settings.currencies.rateSource.errors.pegCurrencyRequired';
    if (!isPositiveNumberText({ value: draft.peg.factor }))
      errors.factor = 'settings.currencies.rateSource.errors.factorInvalid';
  }

  if (draft.source === 'coingecko' && !draft.coingecko.coinId) {
    errors.coinId = 'settings.currencies.rateSource.errors.coinRequired';
  }

  if (draft.source === 'http') {
    if (!draft.http.urlTemplate.trim()) errors.urlTemplate = 'settings.currencies.rateSource.errors.urlRequired';
    else if (!isValidUrlTemplate({ value: draft.http.urlTemplate }))
      errors.urlTemplate = 'settings.currencies.rateSource.errors.urlInvalid';

    if (!draft.http.jsonPath.trim()) errors.jsonPath = 'settings.currencies.rateSource.errors.pathRequired';

    if (draft.http.headersMode === 'replace') {
      const rows = draft.http.headers.filter((row) => row.name.trim() || row.value);
      if (rows.some((row) => !row.name.trim()))
        errors.headers = 'settings.currencies.rateSource.errors.headerNameRequired';
      else if (new Set(rows.map((row) => row.name.trim().toLowerCase())).size !== rows.length)
        errors.headers = 'settings.currencies.rateSource.errors.headerNameDuplicate';
    }
  }

  return errors;
};

/** i18n key of the headline for a failed preview. */
export const getTestFailureKey = ({ reason }: { reason: RateSourceTestFailure }): string =>
  `settings.currencies.rateSource.http.failures.${reason}`;

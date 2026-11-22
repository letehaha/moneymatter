import {
  type CoingeckoRateSourceConfig,
  type CurrencyRateSource,
  DEFAULT_RATE_SOURCE_QUOTE_CURRENCY,
  HTTP_URL_TEMPLATE_PLACEHOLDER_NAMES,
  type HttpRateSourceConfig,
  type HttpRateSourceInput,
  type HttpUrlTemplatePlaceholderName,
  type PegRateSourceConfig,
  type RateSourceTestFailure,
  type UpdateCurrencyRateSourceBody,
  type UserCurrencyModel,
} from '@bt/shared/types';
import { isEqual } from 'lodash-es';

/** Placeholders an HTTP source URL may hold as written in a template, by name; the API fills them in per request. */
export const HTTP_URL_PLACEHOLDERS = Object.fromEntries(
  HTTP_URL_TEMPLATE_PLACEHOLDER_NAMES.map((name) => [name, `{${name}}`]),
) as Record<HttpUrlTemplatePlaceholderName, string>;

/**
 * What to do with the headers already saved on an HTTP source. Saved values are never returned, so
 * `keep` leaves them alone and `replace` sends the rows as the new set; no rows removes them.
 */
export type HttpHeadersMode = 'keep' | 'replace';

export interface HttpHeaderRow {
  id: number;
  name: string;
  value: string;
}

export interface RateSourceDraft {
  source: CurrencyRateSource;
  peg: { pegCurrency: string | null; factor: string };
  /** `logoUrl` is the logo of the coin picked in this editor; `null` while none was, which keeps the saved one. */
  coingecko: { coinId: string; coinLabel: string; quoteCurrency: string; logoUrl: string | null };
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

export type SavedRateSource = Pick<UserCurrencyModel, 'rateSource' | 'rateSourceConfig'>;

export const isPegConfig = (config: SavedRateSource['rateSourceConfig']): config is PegRateSourceConfig =>
  Boolean(config && 'pegCurrency' in config);
export const isCoingeckoConfig = (config: SavedRateSource['rateSourceConfig']): config is CoingeckoRateSourceConfig =>
  Boolean(config && 'coinId' in config);
export const isHttpConfig = (config: SavedRateSource['rateSourceConfig']): config is HttpRateSourceConfig =>
  Boolean(config && 'urlTemplate' in config);

/** Names of the headers saved on the currency's HTTP source; their values are never available. */
export const getSavedHeaderNames = ({ saved }: { saved: SavedRateSource }): string[] =>
  saved.rateSource === 'http' && isHttpConfig(saved.rateSourceConfig) ? saved.rateSourceConfig.headerNames : [];

let headerRowSequence = 0;

export const createHeaderRow = (): HttpHeaderRow => ({ id: ++headerRowSequence, name: '', value: '' });

/** The editor's starting point: the saved source with its config, or blank fields for the others. */
export const buildDraft = ({ saved }: { saved: SavedRateSource }): RateSourceDraft => {
  const { rateSourceConfig } = saved;
  const peg = isPegConfig(rateSourceConfig) ? rateSourceConfig : null;
  const coingecko = isCoingeckoConfig(rateSourceConfig) ? rateSourceConfig : null;
  const http = isHttpConfig(rateSourceConfig) ? rateSourceConfig : null;

  return {
    source: saved.rateSource,
    peg: { pegCurrency: peg?.pegCurrency ?? null, factor: String(peg?.factor ?? 1) },
    coingecko: {
      coinId: coingecko?.coinId ?? '',
      coinLabel: coingecko?.coinId ?? '',
      quoteCurrency: coingecko?.quoteCurrency ?? DEFAULT_RATE_SOURCE_QUOTE_CURRENCY,
      logoUrl: null,
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

/** Header rows with a name or a value; rows left entirely blank are ignored. */
export const getFilledHeaderRows = ({ http }: { http: RateSourceDraft['http'] }): HttpHeaderRow[] =>
  http.headers.filter((row) => row.name.trim() || row.value);

/** The `headers` field of an HTTP request body: omitted keeps the saved headers, an object replaces them. */
const buildHeadersField = ({ http }: { http: RateSourceDraft['http'] }): { headers?: Record<string, string> } =>
  http.headersMode === 'keep'
    ? {}
    : { headers: Object.fromEntries(getFilledHeaderRows({ http }).map((row) => [row.name.trim(), row.value])) };

/** The HTTP settings as the API takes them, in a save and in a preview alike. */
export const buildHttpConfig = ({ http }: { http: RateSourceDraft['http'] }): HttpRateSourceInput => ({
  urlTemplate: http.urlTemplate.trim(),
  jsonPath: http.jsonPath.trim(),
  quoteCurrency: http.quoteCurrency,
  ...buildHeadersField({ http }),
});

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
        ...(draft.coingecko.logoUrl ? { logoUrl: draft.coingecko.logoUrl } : {}),
      };
    case 'http':
      return { rateSource: 'http', config: buildHttpConfig({ http: draft.http }) };
  }
};

/** Whether the draft would change what is saved, so Save stays disabled for an untouched editor. */
export const isDraftChanged = ({ draft, saved }: { draft: RateSourceDraft; saved: SavedRateSource }): boolean =>
  !isEqual(buildRateSourceBody({ draft }), buildRateSourceBody({ draft: buildDraft({ saved }) }));

const POSITIVE_NUMBER_PATTERN = /^\d*\.?\d+(e[+-]?\d+)?$/i;

export const isPositiveNumberText = ({ value }: { value: string }): boolean => {
  const text = value.trim();

  return POSITIVE_NUMBER_PATTERN.test(text) && Number.isFinite(Number(text)) && Number(text) > 0;
};

const URL_TEMPLATE_PATTERN = /^https?:\/\/\S+$/i;
const PLACEHOLDER_PATTERN = /\{([^{}]*)\}/g;
// Any fixed day: the API fills {date} with one too when it compares origins.
const ORIGIN_SAMPLE_DATE = '2026-01-01';

const getRequestOrigin = ({
  urlTemplate,
  code,
  quoteCurrency,
}: {
  urlTemplate: string;
  code: string;
  quoteCurrency: string;
}): string | null => {
  const values: Record<string, string> = { date: ORIGIN_SAMPLE_DATE, code, quote: quoteCurrency };
  const url = urlTemplate.trim().replace(PLACEHOLDER_PATTERN, (_match, name: string) => values[name] ?? '');

  return URL.canParse(url) ? new URL(url).origin : null;
};

/**
 * Whether the draft keeps saved headers the API will not send: it sends them only to the origin of
 * the saved URL, so a draft pointing elsewhere must replace them.
 */
export const isHeadersOriginChanged = ({
  http,
  saved,
  code,
}: {
  http: RateSourceDraft['http'];
  saved: SavedRateSource;
  code: string;
}): boolean => {
  const config = saved.rateSourceConfig;
  if (saved.rateSource !== 'http' || !isHttpConfig(config) || !config.headerNames.length) return false;

  const savedOrigin = getRequestOrigin({ urlTemplate: config.urlTemplate, code, quoteCurrency: config.quoteCurrency });
  const draftOrigin = getRequestOrigin({ urlTemplate: http.urlTemplate, code, quoteCurrency: http.quoteCurrency });

  return savedOrigin === null || savedOrigin !== draftOrigin;
};

/** Whether the template is an http(s) URL whose only placeholders are {date}, {code} and {quote}. */
export const isValidUrlTemplate = ({ value }: { value: string }): boolean => {
  const text = value.trim();
  if (!URL_TEMPLATE_PATTERN.test(text)) return false;

  const known = new Set<string>(HTTP_URL_TEMPLATE_PLACEHOLDER_NAMES);
  const names = [...text.matchAll(PLACEHOLDER_PATTERN)].map((match) => match[1]!);
  const withoutPlaceholders = text.replace(PLACEHOLDER_PATTERN, '');

  return names.every((name) => known.has(name)) && !/[{}]/.test(withoutPlaceholders);
};

/**
 * Checks the fields the chosen source needs. The API validates again (the JSON path and the header
 * names in particular), and its message is shown if it refuses what passes here.
 */
export const validateDraft = ({
  draft,
  saved,
  code,
}: {
  draft: RateSourceDraft;
  saved: SavedRateSource;
  code: string;
}): RateSourceDraftErrors => {
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

    if (draft.http.headersMode === 'keep') {
      if (isHeadersOriginChanged({ http: draft.http, saved, code }))
        errors.headers = 'settings.currencies.rateSource.http.headersOriginChanged';
    } else {
      const rows = getFilledHeaderRows({ http: draft.http });
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

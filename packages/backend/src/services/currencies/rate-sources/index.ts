import { DEFAULT_RATE_SOURCE_QUOTE_CURRENCY } from '@bt/shared/types';
import { currencyCode } from '@common/lib/zod/custom-types';
import { z } from 'zod';

/** Placeholders an HTTP source URL template may hold, and a sample value for each. */
export const HTTP_URL_TEMPLATE_PLACEHOLDERS = {
  date: '2026-01-01',
  code: 'BTC',
  quote: 'USD',
} as const;

export const HTTP_URL_TEMPLATE_MAX_LENGTH = 2048;
export const HTTP_HEADERS_MAX_COUNT = 10;
const HTTP_HEADER_NAME_MAX_LENGTH = 64;
const HTTP_HEADER_VALUE_MAX_LENGTH = 2048;

/** Headers the HTTP layer sets itself or that would change how the connection behaves. */
const FORBIDDEN_HTTP_HEADER_NAMES = new Set([
  'host',
  'content-length',
  'connection',
  'keep-alive',
  'transfer-encoding',
  'te',
  'trailer',
  'upgrade',
  'proxy-authorization',
  'proxy-connection',
  'cookie',
  'set-cookie',
]);

/** RFC 9110 token characters. */
const HTTP_HEADER_NAME_PATTERN = /^[A-Za-z0-9!#$%&'*+.^_`|~-]+$/;
/** Printable ASCII: no control characters, so a value cannot smuggle a second header line. */
const HTTP_HEADER_VALUE_PATTERN = /^[\x20-\x7E]*$/;
const JSON_PATH_MAX_LENGTH = 256;
const COIN_ID_MAX_LENGTH = 128;

/**
 * Where the price sits in a JSON response: dot-separated keys and array positions, such as
 * `data.rates[0].price`, `data.rates.0.price` or `$.bitcoin.usd`. A leading `$` is optional.
 */
export const JSON_PATH_PATTERN = /^\$?(?:\.?[A-Za-z0-9_-]+|\[\d+\])+$/;

/** CoinGecko coin ids are lowercase words joined by dashes, such as `bitcoin` or `usd-coin`. */
const COIN_ID_PATTERN = /^[a-z0-9][a-z0-9._-]*$/;

/**
 * Fills the placeholders of a URL template. `null` when the template holds a placeholder it does
 * not know, or a stray brace.
 */
export const fillUrlTemplate = ({
  template,
  values,
}: {
  template: string;
  values: Record<keyof typeof HTTP_URL_TEMPLATE_PLACEHOLDERS, string>;
}): string | null => {
  let known = true;
  const filled = template.replace(/\{([^{}]*)\}/g, (_match, name: string) => {
    if (!Object.hasOwn(values, name)) known = false;
    return values[name as keyof typeof values] ?? '';
  });

  return known && !/[{}]/.test(filled) ? filled : null;
};

/** Whether the template becomes an absolute http(s) URL without credentials once it is filled. */
const isValidUrlTemplate = (template: string): boolean => {
  const filled = fillUrlTemplate({ template, values: HTTP_URL_TEMPLATE_PLACEHOLDERS });
  if (filled === null) return false;

  try {
    const url = new URL(filled);

    return (url.protocol === 'https:' || url.protocol === 'http:') && !url.username && !url.password;
  } catch {
    return false;
  }
};

/**
 * Synced sources store their rates in a fixed ISO currency of the config, whatever the user's base:
 * a base change then needs no re-fetch, because the resolver crosses from the stored quote.
 */
const quoteCurrencySchema = currencyCode().default(DEFAULT_RATE_SOURCE_QUOTE_CURRENCY);

export const pegRateSourceConfigSchema = z.strictObject({
  pegCurrency: currencyCode(),
  factor: z.number().positive().finite(),
});

export const coingeckoRateSourceConfigSchema = z.strictObject({
  coinId: z.string().trim().max(COIN_ID_MAX_LENGTH).regex(COIN_ID_PATTERN, 'Invalid CoinGecko coin id'),
  quoteCurrency: quoteCurrencySchema,
});

/** Request headers an HTTP source sends: name to value, at most {@link HTTP_HEADERS_MAX_COUNT}. */
export const httpHeadersSchema = z
  .record(
    z
      .string()
      .max(HTTP_HEADER_NAME_MAX_LENGTH)
      .regex(HTTP_HEADER_NAME_PATTERN, 'Invalid header name')
      .refine((name) => !FORBIDDEN_HTTP_HEADER_NAMES.has(name.toLowerCase()), 'This header cannot be set'),
    z.string().max(HTTP_HEADER_VALUE_MAX_LENGTH).regex(HTTP_HEADER_VALUE_PATTERN, 'Invalid header value'),
  )
  .refine((headers) => Object.keys(headers).length <= HTTP_HEADERS_MAX_COUNT, {
    message: `At most ${HTTP_HEADERS_MAX_COUNT} headers`,
  })
  .refine(
    (headers) => new Set(Object.keys(headers).map((name) => name.toLowerCase())).size === Object.keys(headers).length,
    { message: 'Header names must be unique regardless of case' },
  );

const httpSourceFields = {
  urlTemplate: z
    .string()
    .trim()
    .max(HTTP_URL_TEMPLATE_MAX_LENGTH)
    .refine(
      isValidUrlTemplate,
      'Must be an http(s) URL without credentials; the only placeholders are {date}, {code} and {quote}',
    ),
  jsonPath: z
    .string()
    .trim()
    .max(JSON_PATH_MAX_LENGTH)
    .regex(JSON_PATH_PATTERN, 'Invalid JSON path, expected something like data.rates[0].price'),
  quoteCurrency: quoteCurrencySchema,
};

/**
 * An HTTP source as the editor sends it. `headers` omitted keeps the headers already saved on the
 * currency's `http` source, `{}` removes them.
 */
export const httpRateSourceConfigSchema = z.strictObject({
  ...httpSourceFields,
  headers: httpHeadersSchema.optional(),
});

/** An HTTP source as it is saved and returned: the header values are not part of it, only their names. */
export const storedHttpRateSourceConfigSchema = z.strictObject({
  ...httpSourceFields,
  headerNames: z.array(z.string()).max(HTTP_HEADERS_MAX_COUNT).default([]),
});

/** The request body of `PUT /user/currencies/:code/rate-source`, one shape per source. */
export const updateRateSourceBodySchema = z.discriminatedUnion('rateSource', [
  z.strictObject({ rateSource: z.literal('provider') }),
  z.strictObject({ rateSource: z.literal('manual') }),
  z.strictObject({ rateSource: z.literal('peg'), config: pegRateSourceConfigSchema }),
  z.strictObject({ rateSource: z.literal('coingecko'), config: coingeckoRateSourceConfigSchema }),
  z.strictObject({ rateSource: z.literal('http'), config: httpRateSourceConfigSchema }),
]);

/** The body of `POST /user/currencies/:code/rate-source/test`. */
export const testRateSourceBodySchema = z.strictObject({
  rateSource: z.literal('http'),
  config: httpRateSourceConfigSchema,
  date: z.iso.date().optional(),
});

export type ValidatedRateSourceBody = z.infer<typeof updateRateSourceBodySchema>;

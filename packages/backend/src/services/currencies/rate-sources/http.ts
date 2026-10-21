import type { RateSourceTestFailure } from '@bt/shared/types';
import { createGuardedFetch, isGuardBypassed } from '@common/utils/url-guard';
import { t } from '@i18n/index';
import { ValidationError } from '@js/errors';

import { fillUrlTemplate } from './index';

const HTTP_SOURCE_TIMEOUT_MS = 5_000;
const HTTP_SOURCE_MAX_RESPONSE_BYTES = 256 * 1024;

/** A rate that could not be fetched from an HTTP source; `reason` tells the preview what went wrong. */
export class HttpRateSourceError extends Error {
  readonly reason: RateSourceTestFailure;

  constructor({ reason, message }: { reason: RateSourceTestFailure; message: string }) {
    super(message);
    this.name = 'HttpRateSourceError';
    this.reason = reason;
  }
}

/** The request URL of a template for one currency and day (`day` is `YYYY-MM-DD`). */
export const buildHttpRateUrl = ({
  urlTemplate,
  code,
  quoteCurrency,
  day,
}: {
  urlTemplate: string;
  code: string;
  quoteCurrency: string;
  day: string;
}): string => {
  const url = fillUrlTemplate({ template: urlTemplate, values: { date: day, code, quote: quoteCurrency } });
  if (url === null) throw new HttpRateSourceError({ reason: 'blocked', message: 'The URL template is not valid' });

  return url;
};

const PATH_TOKEN = /\.?([A-Za-z0-9_-]+)|\[(\d+)\]/g;

/**
 * Walks `path` (dot-separated keys and array positions, an optional leading `$`) through the parsed
 * JSON. Only own properties are followed, so `constructor` or `__proto__` never resolve. `undefined`
 * when the path leads nowhere.
 */
export const readJsonPath = ({ json, path }: { json: unknown; path: string }): unknown => {
  let current: unknown = json;

  for (const match of path.replace(/^\$/, '').matchAll(PATH_TOKEN)) {
    const key = match[1] ?? match[2]!;

    if (typeof current !== 'object' || current === null || !Object.hasOwn(current, key)) return undefined;
    // An array has the position of its items, not its own `length`.
    if (Array.isArray(current) && !/^\d+$/.test(key)) return undefined;

    current = (current as Record<string, unknown>)[key];
  }

  return current;
};

const DECIMAL_STRING = /^\s*\d+(?:\.\d+)?(?:[eE][+-]?\d+)?\s*$/;

/** A positive finite rate out of a JSON number or a plain decimal string; `null` for anything else. */
export const toRate = ({ value }: { value: unknown }): number | null => {
  const rate =
    typeof value === 'number' ? value : typeof value === 'string' && DECIMAL_STRING.test(value) ? Number(value) : NaN;

  return Number.isFinite(rate) && rate > 0 ? rate : null;
};

/** The rate at `path` of a parsed response. */
export const extractRate = ({ json, path }: { json: unknown; path: string }): number => {
  const value = readJsonPath({ json, path });

  if (value === undefined) {
    throw new HttpRateSourceError({ reason: 'path_not_found', message: `Nothing at "${path}" in the response` });
  }

  const rate = toRate({ value });
  if (rate === null) {
    throw new HttpRateSourceError({
      reason: 'not_a_number',
      message: `The value at "${path}" is not a positive number`,
    });
  }

  return rate;
};

/**
 * Lets go of the rest of a body without waiting for the transport to confirm: a cancel that is
 * awaited can stall behind a server that keeps the connection open, and the answer is known already.
 */
const discard = (stream: { cancel: () => Promise<void> } | null | undefined): void => {
  stream?.cancel().catch(() => undefined);
};

/** The body as text, or `too_large` as soon as it passes `maxBytes`. */
const readBodyWithLimit = async ({ response, maxBytes }: { response: Response; maxBytes: number }): Promise<string> => {
  const tooLarge = () =>
    new HttpRateSourceError({ reason: 'too_large', message: `The response is larger than ${maxBytes / 1024} KB` });

  const declared = Number(response.headers.get('content-length'));
  if (Number.isFinite(declared) && declared > maxBytes) {
    discard(response.body);
    throw tooLarge();
  }

  if (!response.body) return '';

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let received = 0;

  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;

    received += value.byteLength;
    if (received > maxBytes) {
      discard(reader);
      throw tooLarge();
    }

    chunks.push(value);
  }

  return Buffer.concat(chunks).toString('utf8');
};

// Duck-typed: the abort reason is a DOMException, which is not always an `Error` of this realm.
const isAbort = (error: unknown): boolean => {
  const name = (error as { name?: unknown } | null)?.name;

  return name === 'TimeoutError' || name === 'AbortError';
};

/**
 * GETs a JSON document from a user-supplied URL.
 *
 * - The request goes through `createGuardedFetch`, so on a cloud instance it can reach public hosts
 *   only; with the guard on, the URL must also be https. A self-hosted instance (guard off) may
 *   use http and LAN addresses.
 * - A redirect is never followed, with or without the guard: the headers are the user's secrets and
 *   belong to the URL they saved.
 * - The call ends after `timeoutMs` and the body after `maxBytes`.
 * - The returned errors never carry the URL or the headers, which may hold an API key.
 */
export const fetchJson = async ({
  url,
  headers = {},
  timeoutMs = HTTP_SOURCE_TIMEOUT_MS,
  maxBytes = HTTP_SOURCE_MAX_RESPONSE_BYTES,
  fetchImpl = createGuardedFetch(),
}: {
  url: string;
  headers?: Record<string, string>;
  timeoutMs?: number;
  maxBytes?: number;
  fetchImpl?: typeof globalThis.fetch;
}): Promise<unknown> => {
  if (!isGuardBypassed() && new URL(url).protocol !== 'https:') {
    throw new HttpRateSourceError({
      reason: 'https_required',
      message: t({ key: 'currencies.rateSourceHttpsRequired' }),
    });
  }

  let response: Response;
  try {
    response = await fetchImpl(url, {
      method: 'GET',
      headers: { Accept: 'application/json', ...headers },
      redirect: 'error',
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (error) {
    if (error instanceof ValidationError) {
      throw new HttpRateSourceError({ reason: 'blocked', message: error.message });
    }

    if (isAbort(error)) {
      throw new HttpRateSourceError({
        reason: 'timeout',
        message: `The server did not answer within ${timeoutMs / 1000} seconds`,
      });
    }

    const cause = (error as { cause?: { code?: unknown } }).cause?.code;
    throw new HttpRateSourceError({
      reason: 'network',
      message: typeof cause === 'string' ? `The request failed (${cause})` : 'The request failed',
    });
  }

  if (!response.ok) {
    discard(response.body);
    throw new HttpRateSourceError({ reason: 'http_status', message: `The server answered ${response.status}` });
  }

  let text: string;
  try {
    text = await readBodyWithLimit({ response, maxBytes });
  } catch (error) {
    if (error instanceof HttpRateSourceError) throw error;
    if (isAbort(error)) {
      throw new HttpRateSourceError({
        reason: 'timeout',
        message: `The server did not finish answering within ${timeoutMs / 1000} seconds`,
      });
    }

    throw new HttpRateSourceError({ reason: 'network', message: 'The response could not be read' });
  }

  try {
    return JSON.parse(text);
  } catch {
    throw new HttpRateSourceError({ reason: 'not_json', message: 'The response is not JSON' });
  }
};

/** Today's rate of one currency from an HTTP source: builds the URL, fetches it and reads the price. */
export const fetchHttpRate = async ({
  urlTemplate,
  jsonPath,
  quoteCurrency,
  code,
  day,
  headers,
  fetchImpl,
}: {
  urlTemplate: string;
  jsonPath: string;
  quoteCurrency: string;
  code: string;
  day: string;
  headers?: Record<string, string>;
  fetchImpl?: typeof globalThis.fetch;
}): Promise<number> => {
  const url = buildHttpRateUrl({ urlTemplate, code, quoteCurrency, day });
  const json = await fetchJson({ url, headers, fetchImpl });

  return extractRate({ json, path: jsonPath });
};

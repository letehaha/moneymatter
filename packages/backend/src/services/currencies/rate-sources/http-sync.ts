import { logger } from '@js/utils';
import { toEffectiveDate } from '@models/user-exchange-rates.model';
import UsersCurrencies from '@models/users-currencies.model';

import { buildHttpRateUrl, fetchHttpRate, HttpRateSourceError } from './http';
import { decryptHttpHeaders } from './http-headers';
import { storedHttpRateSourceConfigSchema } from './index';
import { type FetchedWith, storeSyncedRates } from './store-synced-rates';

const SOURCE = 'http';

export interface HttpSyncResult {
  /** HTTP calls made: identical requests of several users are made once. */
  requests: number;
  /** Users' currencies that got a new or changed rate. */
  currenciesUpdated: number;
  ratesWritten: number;
  failures: number;
}

interface Target {
  userId: number;
  currencyCode: string;
  rateSourceConfig: unknown;
  rateSourceHeadersEncrypted: string | null;
}

type ReadTarget =
  | { ok: true; urlTemplate: string; jsonPath: string; quoteCurrency: string; headers: Record<string, string> }
  | { ok: false; why: string };

const readTarget = ({ target }: { target: Target }): ReadTarget => {
  const config = storedHttpRateSourceConfigSchema.safeParse(target.rateSourceConfig);
  if (!config.success) return { ok: false, why: 'unreadable config' };

  const headers = decryptHttpHeaders({ encrypted: target.rateSourceHeadersEncrypted });
  if (headers === null) return { ok: false, why: 'unreadable headers' };

  const { urlTemplate, jsonPath, quoteCurrency } = config.data;

  return { ok: true, urlTemplate, jsonPath, quoteCurrency, headers };
};

/** The saved settings the target's request was made with, which the stored rates must still match. */
const fetchedWith = ({ target }: { target: Target }): FetchedWith => ({
  rateSourceConfig: target.rateSourceConfig,
  rateSourceHeadersEncrypted: target.rateSourceHeadersEncrypted,
});

const loadTargets = ({ userId, currencyCode }: { userId?: number; currencyCode?: string } = {}): Promise<Target[]> =>
  UsersCurrencies.unscoped().findAll({
    where: {
      rateSource: SOURCE,
      ...(userId === undefined ? {} : { userId }),
      ...(currencyCode ? { currencyCode } : {}),
    },
    attributes: ['userId', 'currencyCode', 'rateSourceConfig', 'rateSourceHeadersEncrypted'],
    order: [
      ['userId', 'ASC'],
      ['currencyCode', 'ASC'],
    ],
    raw: true,
  });

/** Error logging that carries no URL and no header, which may hold an API key. */
const logFailure = ({
  target,
  error,
  code,
}: {
  target: Pick<Target, 'userId' | 'currencyCode'>;
  error: unknown;
  code: string;
}) => {
  const reason = error instanceof HttpRateSourceError ? `${error.reason}: ${error.message}` : 'unexpected error';

  logger.error(
    {
      message: `HTTP rate source of ${target.currencyCode} of user ${target.userId} failed (${reason}), the last rate stays in force`,
      error: error as Error,
    },
    { code },
  );
};

/**
 * Fetches today's rate of one user's HTTP-sourced currency and stores it. Runs after the source is
 * saved; the save has committed by then, so a failure is logged and the currency stays on its source
 * (the daily sync tries again).
 */
export const fetchHttpRateAfterSave = async ({
  userId,
  currencyCode,
}: {
  userId: number;
  currencyCode: string;
}): Promise<{ status: 'done'; ratesWritten: number } | { status: 'skipped' | 'failed' }> => {
  const [target] = await loadTargets({ userId, currencyCode });
  if (!target) return { status: 'skipped' };

  const read = readTarget({ target });
  if (!read.ok) {
    logger.warn(`Skipping the HTTP rate source of ${currencyCode} of user ${userId}: ${read.why}`);

    return { status: 'skipped' };
  }

  try {
    const day = toEffectiveDate({ date: new Date() });
    const rate = await fetchHttpRate({ ...read, code: currencyCode, day });
    const ratesWritten = await storeSyncedRates({
      userId,
      currencyCode,
      quoteCurrency: read.quoteCurrency,
      rates: [{ day, rate }],
      kind: 'daily',
      source: SOURCE,
      fetchedWith: fetchedWith({ target }),
    });

    return { status: 'done', ratesWritten };
  } catch (error) {
    logFailure({ target: { userId, currencyCode }, error, code: 'HTTP_RATE_SOURCE_FETCH_FAILED' });

    return { status: 'failed' };
  }
};

/**
 * Daily sync of every user's HTTP-sourced currencies: each gets today's rate in its own quote
 * currency.
 *
 * - Requests that are identical (same URL, same headers) are made once for all users that share them.
 * - A failed call is logged and leaves the last rate in force; the run goes on with the others.
 * - A rate the user set by hand for today is not replaced.
 */
export const syncHttpRates = async (): Promise<HttpSyncResult> => {
  const result: HttpSyncResult = { requests: 0, currenciesUpdated: 0, ratesWritten: 0, failures: 0 };
  const targets = await loadTargets();
  if (!targets.length) return result;

  const day = toEffectiveDate({ date: new Date() });
  const inFlight = new Map<string, Promise<number>>();

  for (const target of targets) {
    const read = readTarget({ target });
    if (!read.ok) {
      logger.warn(`Skipping the HTTP rate source of ${target.currencyCode} of user ${target.userId}: ${read.why}`);
      result.failures += 1;
      continue;
    }

    try {
      const url = buildHttpRateUrl({
        urlTemplate: read.urlTemplate,
        code: target.currencyCode,
        quoteCurrency: read.quoteCurrency,
        day,
      });
      const key = JSON.stringify([url, read.jsonPath, Object.entries(read.headers).toSorted()]);

      let request = inFlight.get(key);
      if (!request) {
        result.requests += 1;
        request = fetchHttpRate({ ...read, code: target.currencyCode, day });
        inFlight.set(key, request);
      }

      const rate = await request;
      const written = await storeSyncedRates({
        userId: target.userId,
        currencyCode: target.currencyCode,
        quoteCurrency: read.quoteCurrency,
        rates: [{ day, rate }],
        kind: 'daily',
        source: SOURCE,
        fetchedWith: fetchedWith({ target }),
      });

      result.ratesWritten += written;
      if (written) result.currenciesUpdated += 1;
    } catch (error) {
      result.failures += 1;
      logFailure({ target, error, code: 'HTTP_RATE_SYNC_FAILED' });
    }
  }

  return result;
};

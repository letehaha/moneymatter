import { logger } from '@js/utils';
import { toEffectiveDate } from '@models/user-exchange-rates.model';
import UsersCurrencies from '@models/users-currencies.model';

import { fetchHttpRate, HttpRateSourceError } from './http';
import { decryptHttpHeaders } from './http-headers';
import { storedHttpRateSourceConfigSchema } from './index';
import { type FetchedWith, storeSyncedRates } from './store-synced-rates';

const SOURCE = 'http';

interface HttpSyncResult {
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

const loadTargets = (): Promise<Target[]> =>
  UsersCurrencies.unscoped().findAll({
    where: { rateSource: SOURCE },
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
 * Daily sync of every user's HTTP-sourced currencies: each gets today's rate in its own quote
 * currency.
 *
 * - A failed call is logged and leaves the last rate in force; the run goes on with the others.
 * - A rate the user set by hand for today is not replaced.
 */
export const syncHttpRates = async (): Promise<HttpSyncResult> => {
  const result: HttpSyncResult = { currenciesUpdated: 0, ratesWritten: 0, failures: 0 };
  const targets = await loadTargets();
  if (!targets.length) return result;

  const day = toEffectiveDate({ date: new Date() });

  for (const target of targets) {
    const read = readTarget({ target });
    if (!read.ok) {
      logger.warn(`Skipping the HTTP rate source of ${target.currencyCode} of user ${target.userId}: ${read.why}`);
      result.failures += 1;
      continue;
    }

    try {
      const rate = await fetchHttpRate({ ...read, code: target.currencyCode, day });
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

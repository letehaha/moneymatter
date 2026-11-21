import {
  type CurrencyRateSourceResponse,
  type CurrencyRateSourceSetting,
  ISO_CURRENCY_RATE_SOURCES,
} from '@bt/shared/types';
import { isGuardBypassed } from '@common/utils/url-guard';
import { t } from '@i18n/index';
import { ConflictError, NotFoundError, ValidationError } from '@js/errors';
import { logger } from '@js/utils';
import { connection } from '@models/connection';
import Currencies from '@models/currencies.model';
import UserExchangeRates from '@models/user-exchange-rates.model';
import UsersCurrencies from '@models/users-currencies.model';
import { applyLogoWrite } from '@services/brand-logos';
import { withTransaction } from '@services/common/with-transaction';
import { requireCoinGeckoKey } from '@services/investments/data-providers/clients/coingecko-client';
import { revalueAccountsInCurrencies } from '@services/user-exchange-rate/revalue-accounts-in-currencies';
import { isDeepStrictEqual } from 'node:util';

import { recomputeCustomRefAmounts } from '../recompute-custom-ref-amounts.service';
import { decryptHttpHeaders, encryptHttpHeaders } from './http-headers';
import { httpHistoryFingerprint } from './http-history-fingerprint';
import { fillUrlTemplate, HTTP_URL_TEMPLATE_PLACEHOLDERS, type ValidatedRateSourceBody } from './index';
import { storeSyncedRates, type SyncedDailyRate } from './store-synced-rates';

type HeldCurrency = UsersCurrencies & { currency: Currencies };
type HttpBody = Extract<ValidatedRateSourceBody, { rateSource: 'http' }>;

const isIsoRateSource = (rateSource: string): boolean =>
  (ISO_CURRENCY_RATE_SOURCES as readonly string[]).includes(rateSource);

/**
 * The settings to save and the encrypted headers that go with them. Only an `http` source holds
 * headers; `headers` are the ones that source will send.
 */
const toSetting = ({
  body,
  headers,
}: {
  body: ValidatedRateSourceBody;
  headers: Record<string, string>;
}): { setting: CurrencyRateSourceSetting; encryptedHeaders: string | null } => {
  switch (body.rateSource) {
    case 'provider':
    case 'manual':
      return { setting: { rateSource: body.rateSource, rateSourceConfig: null }, encryptedHeaders: null };
    case 'peg':
      return { setting: { rateSource: 'peg', rateSourceConfig: body.config }, encryptedHeaders: null };
    case 'coingecko':
      return { setting: { rateSource: 'coingecko', rateSourceConfig: body.config }, encryptedHeaders: null };
    case 'http': {
      const { urlTemplate, jsonPath, quoteCurrency } = body.config;

      return {
        setting: {
          rateSource: 'http',
          rateSourceConfig: { urlTemplate, jsonPath, quoteCurrency, headerNames: Object.keys(headers) },
        },
        encryptedHeaders: encryptHttpHeaders({ headers }),
      };
    }
  }
};

/** The user's `UsersCurrencies` row of a code, with the encrypted headers a rate source may hold. */
export const findHeldCurrency = async ({ userId, code }: { userId: number; code: string }): Promise<HeldCurrency> => {
  const held = (await UsersCurrencies.unscoped().findOne({
    where: { userId, currencyCode: code },
    include: [{ model: Currencies, as: 'currency', required: true }],
  })) as HeldCurrency | null;

  if (!held) {
    throw new NotFoundError({ message: t({ key: 'currencies.rateSourceCurrencyNotHeld', variables: { code } }) });
  }

  return held;
};

/**
 * What an HTTP source may be set on: a custom currency, at an https URL unless the instance stands
 * the outbound guard down (a self-hosted instance may use http). The schema keeps the quote ISO.
 */
export const assertHttpSourceAllowed = ({
  code,
  held,
  config,
}: {
  code: string;
  held: HeldCurrency;
  config: HttpBody['config'];
}): void => {
  if (!held.currency.isCustom) {
    throw new ValidationError({ message: t({ key: 'currencies.rateSourceIsoNotAllowed', variables: { code } }) });
  }

  const sampleUrl = fillUrlTemplate({ template: config.urlTemplate, values: HTTP_URL_TEMPLATE_PLACEHOLDERS });
  if (!isGuardBypassed() && sampleUrl !== null && new URL(sampleUrl).protocol !== 'https:') {
    throw new ValidationError({ message: t({ key: 'currencies.rateSourceHttpsRequired' }) });
  }
};

/** Scheme, host and port the template sends a currency's requests to; `null` when it is not a URL. */
const requestOrigin = ({
  urlTemplate,
  code,
  quoteCurrency,
}: {
  urlTemplate: string;
  code: string;
  quoteCurrency: string;
}): string | null => {
  const url = fillUrlTemplate({
    template: urlTemplate,
    values: { date: HTTP_URL_TEMPLATE_PLACEHOLDERS.date, code, quote: quoteCurrency },
  });

  return url !== null && URL.canParse(url) ? new URL(url).origin : null;
};

/**
 * The headers an `http` body asks for: the ones it sends, else the ones already saved on an `http`
 * source (the editor never sees saved values, so leaving them out keeps them). Saved headers go only
 * to the origin they were saved for, so a body naming another one gets none. `null` when the saved
 * ones cannot be decrypted, which only a new set of headers repairs.
 */
export const resolveHttpHeaders = ({
  body,
  held,
}: {
  body: HttpBody;
  held: Pick<UsersCurrencies, 'currencyCode' | 'rateSource' | 'rateSourceConfig' | 'rateSourceHeadersEncrypted'>;
}): Record<string, string> | null => {
  if (body.config.headers) return body.config.headers;

  const saved = held.rateSourceConfig;
  if (held.rateSource !== 'http' || !saved || !('urlTemplate' in saved)) return {};

  const code = held.currencyCode;
  const savedOrigin = requestOrigin({ urlTemplate: saved.urlTemplate, code, quoteCurrency: saved.quoteCurrency });
  const bodyOrigin = requestOrigin({
    urlTemplate: body.config.urlTemplate,
    code,
    quoteCurrency: body.config.quoteCurrency,
  });
  if (savedOrigin === null || savedOrigin !== bodyOrigin) return {};

  return decryptHttpHeaders({ encrypted: held.rateSourceHeadersEncrypted });
};

/**
 * The fingerprint of the `http` config that wrote the `http` rates stored for a currency: the one
 * recorded when that config was saved, else (a source saved before it was recorded) the one of the
 * config in force, which wrote them.
 */
const recordedHttpFingerprint = ({ held }: { held: HeldCurrency }): string | null => {
  if (held.rateSourceHttpFingerprint) return held.rateSourceHttpFingerprint;

  const config = held.rateSourceConfig;
  if (held.rateSource !== 'http' || !config || !('urlTemplate' in config)) return null;

  return httpHistoryFingerprint(config);
};

/** A validated source change, read from the currency as it stood before anything is written. */
export interface PreparedRateSourceChange {
  held: HeldCurrency;
  setting: CurrencyRateSourceSetting;
  encryptedHeaders: string | null;
  /** The headers an `http` source sends; empty for every other source. */
  headers: Record<string, string>;
  changed: boolean;
  recordedFingerprint: string | null;
  httpFingerprint: string | null;
  liveRateUpdate: boolean;
}

/** Checks a source change against the user's currency and works out what saving it would write. */
export const prepareRateSourceChange = async ({
  userId,
  code,
  body,
}: {
  userId: number;
  code: string;
  body: ValidatedRateSourceBody;
}): Promise<PreparedRateSourceChange> => {
  const held = await findHeldCurrency({ userId, code });

  // An ISO currency is priced by the market feed or by the user's own rates. The other sources
  // price what no feed covers, and a custom currency has no feed to fall back on.
  if (!held.currency.isCustom && !isIsoRateSource(body.rateSource)) {
    throw new ValidationError({ message: t({ key: 'currencies.rateSourceIsoNotAllowed', variables: { code } }) });
  }

  if (held.currency.isCustom && body.rateSource === 'provider') {
    throw new ValidationError({ message: t({ key: 'currencies.rateSourceCustomNoProvider', variables: { code } }) });
  }

  // A synced source can only run on an instance that has the provider's key.
  if (body.rateSource === 'coingecko') requireCoinGeckoKey();

  let headers: Record<string, string> = {};
  if (body.rateSource === 'http') {
    assertHttpSourceAllowed({ code, held, config: body.config });

    const resolved = resolveHttpHeaders({ body, held });
    if (resolved === null) {
      throw new ValidationError({ message: t({ key: 'currencies.rateSourceHeadersUnreadable', variables: { code } }) });
    }
    headers = resolved;
  }

  const { setting, encryptedHeaders } = toSetting({ body, headers });
  const savedHeaders = decryptHttpHeaders({ encrypted: held.rateSourceHeadersEncrypted }) ?? {};
  const sameHeaders = isDeepStrictEqual(headers, savedHeaders);
  const configChanged =
    held.rateSource !== setting.rateSource || !isDeepStrictEqual(held.rateSourceConfig, setting.rateSourceConfig);
  const changed = configChanged || (setting.rateSource === 'http' && !sameHeaders);

  const recordedFingerprint = recordedHttpFingerprint({ held });
  const httpFingerprint =
    setting.rateSource === 'http' ? httpHistoryFingerprint(setting.rateSourceConfig) : recordedFingerprint;

  // The live-rate flag is what the rate lookup reads for an ISO currency: it follows the source.
  const liveRateUpdate = !held.currency.isCustom ? setting.rateSource === 'provider' : held.liveRateUpdate;

  return { held, setting, encryptedHeaders, headers, changed, recordedFingerprint, httpFingerprint, liveRateUpdate };
};

/** The coin logo's write, or a write the logo rules refuse, which leaves the logo as it is. */
const coinLogoPatch = async ({ held, logoImage }: { held: HeldCurrency; logoImage: string | null }) => {
  try {
    return await applyLogoWrite({ write: { logoImage }, stored: held });
  } catch (error) {
    if (!(error instanceof ValidationError)) throw error;

    logger.warn(`The CoinGecko coin logo of ${held.currencyCode} was refused, the logo stays as it was`);

    return {};
  }
};

const applyRateSourceChangeImpl = async ({
  userId,
  code,
  prepared,
  firstRates,
  logoImage,
}: {
  userId: number;
  code: string;
  prepared: PreparedRateSourceChange;
  /** What a synced source fetched for its first save; `null` when the source did not change or is not synced. */
  firstRates: SyncedDailyRate[] | null;
  /** The coin logo to store as a data URL, `null` to clear the logo image, `undefined` to keep the logo. */
  logoImage: string | null | undefined;
}): Promise<CurrencyRateSourceResponse> => {
  const { held, setting, encryptedHeaders, changed, recordedFingerprint, httpFingerprint, liveRateUpdate } = prepared;
  const liveRateChanged = liveRateUpdate !== held.liveRateUpdate;

  // The lock every rate removal takes, so a removal cannot drop the last rate this source change counts on.
  await connection.sequelize.query(`SELECT pg_advisory_xact_lock(hashtext('user-exchange-rates'), :userId)`, {
    replacements: { userId },
  });

  // The change was worked out, and its rates fetched, from the row as it stood before: another save
  // that committed since would make it wrong.
  const current = await UsersCurrencies.unscoped().findOne({
    where: { userId, currencyCode: code },
    attributes: ['rateSource', 'rateSourceConfig', 'rateSourceHeadersEncrypted', 'rateSourceHttpFingerprint'],
    lock: true,
    raw: true,
  });
  if (
    !current ||
    current.rateSource !== held.rateSource ||
    !isDeepStrictEqual(current.rateSourceConfig, held.rateSourceConfig) ||
    current.rateSourceHeadersEncrypted !== held.rateSourceHeadersEncrypted ||
    current.rateSourceHttpFingerprint !== held.rateSourceHttpFingerprint
  ) {
    throw new ConflictError({ message: t({ key: 'currencies.rateSourceChangedMeanwhile', variables: { code } }) });
  }

  await held.update({
    ...setting,
    rateSourceHeadersEncrypted: encryptedHeaders,
    rateSourceHttpFingerprint: httpFingerprint,
    liveRateUpdate,
  });

  // Rates a synced source stored before would mix into its new history: the ones fetched for another
  // coin, and the ones left from an earlier stint on CoinGecko, whose settings are not known any
  // more (the first fetch backfills what it drops). An `http` source cannot fetch a past day again,
  // so its rates go only when the new config returns other ones: the saved fingerprint tells
  // (headers and the values of credential query parameters are not part of it). The rates of a
  // source the user switches away from stay while another source runs, as the history of that currency.
  if (changed && setting.rateSource === 'coingecko') {
    await UserExchangeRates.destroy({ where: { userId, baseCode: code, source: 'coingecko' } });
  }
  if (changed && setting.rateSource === 'http' && recordedFingerprint !== httpFingerprint) {
    await UserExchangeRates.destroy({ where: { userId, baseCode: code, source: 'http' } });
  }

  if (firstRates && (setting.rateSource === 'coingecko' || setting.rateSource === 'http')) {
    await storeSyncedRates({
      userId,
      currencyCode: code,
      quoteCurrency: setting.rateSourceConfig.quoteCurrency,
      rates: firstRates,
      // The source was just saved, so its rates take over the days whatever priced them before.
      kind: 'backfill',
      source: setting.rateSource,
      fetchedWith: {
        rateSourceConfig: setting.rateSourceConfig,
        ...(setting.rateSource === 'http' && { rateSourceHeadersEncrypted: encryptedHeaders }),
      },
    });
  }

  // A custom currency always has a rate; every source but a peg values it from its stored rates.
  if (
    held.currency.isCustom &&
    setting.rateSource !== 'peg' &&
    (await UserExchangeRates.count({ where: { userId, baseCode: code } })) === 0
  ) {
    throw new ValidationError({ message: t({ key: 'currencies.rateSourceLeavesNoRate', variables: { code } }) });
  }

  if (logoImage !== undefined) await held.update(await coinLogoPatch({ held, logoImage }));

  // The source decides which rates price the currency, so what was valued under the old one is
  // valued again. An ISO currency keeps the base amounts it was saved with.
  if (changed && held.currency.isCustom) {
    await recomputeCustomRefAmounts({
      userId,
      changes: [{ currencyCode: code, from: null, to: null }],
    });
  }

  // The flag picks between a flat manual rate and per-day market rates for every stored balance row
  // of an ISO currency, so its history is rebuilt. It also decides whether the custom currencies
  // pegged to or quoted in that currency are worth its manual rate or the market's, so what they
  // were valued with is valued again.
  if (liveRateChanged) {
    await recomputeCustomRefAmounts({
      userId,
      changes: [{ currencyCode: code, from: null, to: null }],
    });
    await revalueAccountsInCurrencies({ userId, pairs: [{ baseCode: code, quoteCode: code }] });
  }

  return { currencyCode: code, ...setting };
};

/**
 * Saves a prepared source change with the rates its first fetch brought, and values the custom
 * currency's saved rows again when the source changed.
 */
export const applyRateSourceChange = withTransaction(applyRateSourceChangeImpl);

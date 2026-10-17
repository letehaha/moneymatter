import {
  type CurrencyRateSourceResponse,
  type CurrencyRateSourceSetting,
  ISO_CURRENCY_RATE_SOURCES,
} from '@bt/shared/types';
import { isGuardBypassed } from '@common/utils/url-guard';
import { t } from '@i18n/index';
import { NotFoundError, ValidationError } from '@js/errors';
import Currencies from '@models/currencies.model';
import UserExchangeRates from '@models/user-exchange-rates.model';
import UsersCurrencies from '@models/users-currencies.model';
import { withTransaction } from '@services/common/with-transaction';
import { requireCoinGeckoKey } from '@services/investments/data-providers/clients/coingecko-client';
import omit from 'lodash/omit';
import { isDeepStrictEqual } from 'node:util';

import { assertCurrencyCodesVisible } from '../assert-currency-codes-visible';
import { recomputeCustomRefAmounts } from '../recompute-custom-ref-amounts.service';
import { decryptHttpHeaders, encryptHttpHeaders } from './http-headers';
import { fillUrlTemplate, HTTP_URL_TEMPLATE_PLACEHOLDERS, type ValidatedRateSourceBody } from './index';

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
 * What an HTTP source may be set on: a custom currency, quoting an ISO currency, at an https URL
 * unless the instance stands the outbound guard down (a self-hosted instance may use http).
 */
export const assertHttpSourceAllowed = async ({
  userId,
  code,
  held,
  config,
}: {
  userId: number;
  code: string;
  held: HeldCurrency;
  config: HttpBody['config'];
}): Promise<void> => {
  if (!held.currency.isCustom) {
    throw new ValidationError({ message: t({ key: 'currencies.rateSourceIsoNotAllowed', variables: { code } }) });
  }

  await assertCurrencyCodesVisible({ userId, codes: [config.quoteCurrency], isoOnly: true });

  const sampleUrl = fillUrlTemplate({ template: config.urlTemplate, values: HTTP_URL_TEMPLATE_PLACEHOLDERS });
  if (!isGuardBypassed() && sampleUrl !== null && new URL(sampleUrl).protocol !== 'https:') {
    throw new ValidationError({ message: t({ key: 'currencies.rateSourceHttpsRequired' }) });
  }
};

/**
 * The headers an `http` body asks for: the ones it sends, else the ones already saved on an `http`
 * source (the editor never sees saved values, so leaving them out keeps them). `null` when the saved
 * ones cannot be decrypted, which only a new set of headers repairs.
 */
export const resolveHttpHeaders = ({
  body,
  held,
}: {
  body: HttpBody;
  held: Pick<UsersCurrencies, 'rateSource' | 'rateSourceHeadersEncrypted'>;
}): Record<string, string> | null => {
  if (body.config.headers) return body.config.headers;

  return held.rateSource === 'http' ? decryptHttpHeaders({ encrypted: held.rateSourceHeadersEncrypted }) : {};
};

/** Whether a changed config of a synced source asks for different rates than the one it replaces. */
const returnsOtherRates = ({
  previousConfig,
  setting,
}: {
  previousConfig: UsersCurrencies['rateSourceConfig'];
  setting: CurrencyRateSourceSetting;
}): boolean => {
  if (setting.rateSource === 'coingecko') return true;
  if (setting.rateSource !== 'http') return false;

  if (!previousConfig || !('urlTemplate' in previousConfig)) return true;

  return !isDeepStrictEqual(omit(previousConfig, 'headerNames'), omit(setting.rateSourceConfig, 'headerNames'));
};

const setCurrencyRateSourceImpl = async ({
  userId,
  code,
  body,
}: {
  userId: number;
  code: string;
  body: ValidatedRateSourceBody;
}): Promise<{ response: CurrencyRateSourceResponse; changed: boolean }> => {
  const held = await findHeldCurrency({ userId, code });

  // An ISO currency is priced by the market feed or by the user's own rates. The other sources
  // price what no feed covers, and a custom currency has no feed to fall back on.
  if (!held.currency.isCustom && !isIsoRateSource(body.rateSource)) {
    throw new ValidationError({ message: t({ key: 'currencies.rateSourceIsoNotAllowed', variables: { code } }) });
  }

  if (held.currency.isCustom && body.rateSource === 'provider') {
    throw new ValidationError({ message: t({ key: 'currencies.rateSourceCustomNoProvider', variables: { code } }) });
  }

  if (body.rateSource === 'peg') {
    if (body.config.pegCurrency === code) {
      throw new ValidationError({ message: t({ key: 'currencies.rateSourcePegSelf', variables: { code } }) });
    }

    await assertCurrencyCodesVisible({ userId, codes: [body.config.pegCurrency] });
  }

  // Synced sources quote in an ISO currency, so a stored rate never depends on another custom rate.
  if (body.rateSource === 'coingecko' || body.rateSource === 'http') {
    await assertCurrencyCodesVisible({ userId, codes: [body.config.quoteCurrency], isoOnly: true });
  }

  // A synced source can only run on an instance that has the provider's key.
  if (body.rateSource === 'coingecko') requireCoinGeckoKey();

  let headers: Record<string, string> = {};
  if (body.rateSource === 'http') {
    await assertHttpSourceAllowed({ userId, code, held, config: body.config });

    const resolved = resolveHttpHeaders({ body, held });
    if (resolved === null) {
      throw new ValidationError({ message: t({ key: 'currencies.rateSourceHeadersUnreadable', variables: { code } }) });
    }
    headers = resolved;
  }

  const { setting, encryptedHeaders } = toSetting({ body, headers });
  const sameHeaders = isDeepStrictEqual(
    headers,
    decryptHttpHeaders({ encrypted: held.rateSourceHeadersEncrypted }) ?? {},
  );
  const configChanged =
    held.rateSource !== setting.rateSource || !isDeepStrictEqual(held.rateSourceConfig, setting.rateSourceConfig);
  const changed = configChanged || (setting.rateSource === 'http' && !sameHeaders);
  const previousSource = held.rateSource;
  const previousConfig = held.rateSourceConfig;
  await held.update({ ...setting, rateSourceHeadersEncrypted: encryptedHeaders });

  // Rates fetched for another coin, URL or quote would mix into the new one's history, so they go.
  // New headers alone fetch the same rates. The rates of a source the user switches away from stay,
  // as the history of that currency.
  if (changed && previousSource === setting.rateSource && returnsOtherRates({ previousConfig, setting })) {
    await UserExchangeRates.destroy({ where: { userId, baseCode: code, source: setting.rateSource } });
  }

  // The rates of every day come from the new source now, so what was valued under the old one is
  // valued again. An ISO currency keeps the base amounts it was saved with.
  if (changed && held.currency.isCustom) {
    await recomputeCustomRefAmounts({
      userId,
      changes: [{ currencyCode: code, from: null, to: null, mode: 'recompute' }],
    });
  }

  return { response: { currencyCode: code, ...setting }, changed };
};

/**
 * Saves where the user's rates for a currency come from, and the settings of that source. A custom
 * currency whose source changed has its saved rows valued again; fetching a synced source's rates
 * is that source's own work, which the caller starts once this has committed (`changed` says
 * whether the saved source differs from the one before).
 */
export const setCurrencyRateSource = withTransaction(setCurrencyRateSourceImpl);

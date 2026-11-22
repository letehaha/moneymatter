import type { UserCurrencyModel } from '@bt/shared/types';
import type { useI18n } from 'vue-i18n';

import { isCoingeckoConfig, isHttpConfig, isPegConfig } from '../rate-source/rate-source-draft';

type Translate = ReturnType<typeof useI18n>['t'];

/** The ISO currency a pegged currency follows; empty for any other source. */
export const getPegTarget = ({
  currency,
}: {
  currency: Pick<UserCurrencyModel, 'rateSource' | 'rateSourceConfig'>;
}): string =>
  currency.rateSource === 'peg' && isPegConfig(currency.rateSourceConfig) ? currency.rateSourceConfig.pegCurrency : '';

/** The host of an HTTP source; the template itself when placeholders make it unparsable. */
export const getUrlHost = ({ urlTemplate }: { urlTemplate: string }): string => {
  try {
    return new URL(urlTemplate).host || urlTemplate;
  } catch {
    return urlTemplate;
  }
};

/** Where a custom currency's rate comes from, as the overview shows it. */
export const describeRateSource = ({
  currency,
  t,
}: {
  currency: Pick<UserCurrencyModel, 'currencyCode' | 'rateSource' | 'rateSourceConfig'>;
  t: Translate;
}): { value: string; detail: string | null } => {
  const base = 'settings.currencies.dialog.source';
  const synced = t(`${base}.syncedDetail`);

  const config = currency.rateSourceConfig;

  switch (currency.rateSource) {
    case 'manual':
      return { value: t(`${base}.manual`), detail: null };
    case 'peg': {
      const peg = isPegConfig(config) ? config : null;
      const target = peg?.pegCurrency ?? '';
      return {
        value: t(`${base}.peg`, { code: target }),
        detail: t(`${base}.pegDetail`, { code: currency.currencyCode, factor: peg?.factor ?? 1, target }),
      };
    }
    case 'coingecko':
      return {
        value: t(`${base}.coingecko`, { coin: isCoingeckoConfig(config) ? config.coinId : '' }),
        detail: synced,
      };
    case 'http':
      return {
        value: t(`${base}.http`, { host: getUrlHost({ urlTemplate: isHttpConfig(config) ? config.urlTemplate : '' }) }),
        detail: synced,
      };
    default: {
      const unknownSource: never = currency.rateSource;
      return { value: String(unknownSource), detail: null };
    }
  }
};

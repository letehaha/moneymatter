import UserExchangeRates from '@models/user-exchange-rates.model';
import UsersCurrencies from '@models/users-currencies.model';

import { findCustomCurrencyCodes } from './custom-currency-codes';
import { pegRateSourceConfigSchema } from './rate-sources';
import type { DependencyEdge } from './recompute-scope';

/**
 * The user's custom currencies that are valued through another currency: one pegged to it, or one
 * whose stored rate quotes it. The source may be an ISO currency (a custom currency pegged to EUR
 * moves with the EUR rate). A peg whose saved config cannot be read leads nowhere.
 */
export const loadDependencyEdges = async ({ userId }: { userId: number }): Promise<DependencyEdge[]> => {
  const pegged = await UsersCurrencies.findAll({
    where: { userId, rateSource: 'peg' },
    attributes: ['currencyCode', 'rateSourceConfig'],
    raw: true,
  });
  const pegEdges = pegged.flatMap(({ currencyCode, rateSourceConfig }): DependencyEdge[] => {
    const config = pegRateSourceConfigSchema.safeParse(rateSourceConfig);

    return config.success ? [{ dependent: currencyCode, source: config.data.pegCurrency }] : [];
  });

  const quoted = await UserExchangeRates.findAll({
    where: { userId },
    attributes: ['baseCode', 'quoteCode'],
    group: ['baseCode', 'quoteCode'],
    raw: true,
  });
  const customBases = await findCustomCurrencyCodes({ codes: quoted.map((row) => row.baseCode) });
  const quoteEdges = quoted
    .filter((row) => customBases.has(row.baseCode))
    .map((row): DependencyEdge => ({ dependent: row.baseCode, source: row.quoteCode }));

  return [...pegEdges, ...quoteEdges];
};

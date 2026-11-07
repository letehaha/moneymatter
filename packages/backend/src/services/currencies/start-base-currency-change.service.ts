import { t } from '@i18n/index';
import { ValidationError } from '@js/errors';
import { exchangeRateProviderRegistry } from '@services/exchange-rates/providers';

import { enqueueBaseCurrencyChange } from './base-currency-change-queue';

/**
 * Starts the background change of a user's base currency and returns its job.
 *
 * Historical-rate coverage is checked before the enqueue, so an unsupported currency never takes
 * the lock or spins up a job that would only fail on its first conversion. The remaining
 * validation (share blockers, same currency) and the enqueue-time lock live in
 * `enqueueBaseCurrencyChange`.
 */
export async function startBaseCurrencyChange({
  userId,
  newCurrencyCode,
}: {
  userId: number;
  newCurrencyCode: string;
}): Promise<{ jobId: string; state: 'queued' }> {
  if (!exchangeRateProviderRegistry.isCurrencySupportedForHistoricalData(newCurrencyCode)) {
    const supportedCurrencies = exchangeRateProviderRegistry.getSupportedCurrenciesForHistoricalData();
    throw new ValidationError({
      message: t({
        key: 'currencies.notSupportedForBaseCurrency',
        variables: { currency: newCurrencyCode, supportedCurrencies: supportedCurrencies.join(', ') },
      }),
    });
  }

  return enqueueBaseCurrencyChange({ userId, newCurrencyCode });
}

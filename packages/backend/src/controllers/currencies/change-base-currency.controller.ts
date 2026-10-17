import { isoCurrencyCode } from '@common/lib/zod/custom-types';
import { createController } from '@controllers/helpers/controller-factory';
import { t } from '@i18n/index';
import { ValidationError } from '@js/errors';
import { enqueueBaseCurrencyChange } from '@services/currencies/base-currency-change-queue';
import { exchangeRateProviderRegistry } from '@services/exchange-rates/providers';
import { z } from 'zod';

const schema = z.object({
  body: z.object({
    newCurrencyCode: isoCurrencyCode(),
  }),
});

export default createController(schema, async ({ user, body }) => {
  // Historical-rate coverage is checked before enqueue so an unsupported currency
  // never takes the lock or spins up a job that would only fail on first conversion.
  if (!exchangeRateProviderRegistry.isCurrencySupportedForHistoricalData(body.newCurrencyCode)) {
    const supportedCurrencies = exchangeRateProviderRegistry.getSupportedCurrenciesForHistoricalData();
    throw new ValidationError({
      message: t({
        key: 'currencies.notSupportedForBaseCurrency',
        variables: { currency: body.newCurrencyCode, supportedCurrencies: supportedCurrencies.join(', ') },
      }),
    });
  }

  // The recalculation runs as a background job. Remaining validation (share
  // blockers, same-currency) and the enqueue-time lock live in the queue service;
  // share-blocker rejections still surface synchronously here.
  const { jobId, state } = await enqueueBaseCurrencyChange({
    userId: user.id,
    newCurrencyCode: body.newCurrencyCode,
  });

  return {
    data: { jobId, state },
    statusCode: 202,
  };
});

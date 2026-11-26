import type { SecuritySearchResult } from '@bt/shared/types';
import { ValidationError } from '@js/errors';
import ExchangeRates from '@models/exchange-rates.model';
import SecurityPricing from '@models/investments/security-pricing.model';
import { exchangeRateProviderRegistry } from '@services/exchange-rates/providers';
import { format, startOfDay } from 'date-fns';
import { Op } from 'sequelize';

import { addSecurityFromSearch } from '../securities/add-from-search.service';

interface bulkUploadSecurityPrices {
  searchResult: SecuritySearchResult;
  prices: {
    price: number;
    date: string;
    currency: string;
  }[];
  autoFilter?: boolean;
  override?: boolean;
}

// Fallback date if no providers are registered (should not happen in practice)
const FALLBACK_MIN_DATE = new Date('1999-01-04');

function getMinAllowedDate(): Date {
  return exchangeRateProviderRegistry.getEarliestHistoricalDate() ?? FALLBACK_MIN_DATE;
}

export const bulkUploadSecurityPrices = async (params: bulkUploadSecurityPrices) => {
  const { searchResult, prices, autoFilter = false, override = false } = params;

  // Get or create the security from search result (skip price fetch - we're uploading them manually)
  const { security } = await addSecurityFromSearch({ searchResult, skipPriceFetch: true });
  const securityId = security.id;

  // Validate all prices match security's currency
  const invalidCurrency = prices.find((p) => p.currency !== security.currencyCode);
  if (invalidCurrency) {
    throw new ValidationError({
      message: `All prices must be in security's currency (${security.currencyCode}). Found ${invalidCurrency.currency}.`,
    });
  }

  // Get available exchange rate date range
  const minAllowedDate = getMinAllowedDate();
  const oldestRate = await ExchangeRates.findOne({
    where: {
      [Op.or]: [{ baseCode: security.currencyCode }, { quoteCode: security.currencyCode }],
      date: {
        [Op.gte]: minAllowedDate,
      },
    },
    order: [['date', 'ASC']],
    attributes: ['date'],
    raw: true,
  });

  const newestRate = await ExchangeRates.findOne({
    where: {
      [Op.or]: [{ baseCode: security.currencyCode }, { quoteCode: security.currencyCode }],
    },
    order: [['date', 'DESC']],
    attributes: ['date'],
    raw: true,
  });

  if (!oldestRate || !newestRate) {
    throw new ValidationError({
      message: `No exchange rates found for currency ${security.currencyCode}. Cannot upload prices for this security.`,
    });
  }

  const oldestAllowedDate = startOfDay(Math.max(minAllowedDate.getTime(), oldestRate.date.getTime()));
  const newestAllowedDate = startOfDay(newestRate.date);

  // Filter or validate dates
  let filteredPrices = prices;
  let filteredCount = 0;

  if (autoFilter) {
    // Auto-filter dates outside range
    filteredPrices = prices.filter((p) => {
      const priceDate = startOfDay(new Date(p.date));
      const isValid = priceDate >= oldestAllowedDate && priceDate <= newestAllowedDate;
      if (!isValid) filteredCount++;
      return isValid;
    });
  } else {
    // Validate all dates are within range
    const invalidDate = prices.find((p) => {
      const priceDate = startOfDay(new Date(p.date));
      return priceDate < oldestAllowedDate || priceDate > newestAllowedDate;
    });

    if (invalidDate) {
      throw new ValidationError({
        message: `Date ${invalidDate.date} is outside available exchange rate range (${oldestRate.date.toISOString().split('T')[0]} to ${newestRate.date.toISOString().split('T')[0]})`,
      });
    }
  }

  if (filteredPrices.length === 0) {
    throw new ValidationError({
      message: 'No valid prices to upload after filtering',
    });
  }

  // Prepare data for bulk insert
  const pricingData = filteredPrices.map((p) => ({
    securityId,
    date: new Date(p.date),
    priceClose: p.price.toString(),
    source: 'manual-upload',
  }));

  // Insert/upsert
  let insertedCount = 0;
  let duplicatesCount = 0;

  if (override) {
    // Upsert mode - update existing records
    for (const data of pricingData) {
      // No need to wrap in transaction, it's alright to keep what was upserted
      // if anything else fails.
      // TODO: consider some "ignore on conflict" or "override on conflict" based
      // on "override" flag
      const [, created] = await SecurityPricing.upsert(data);
      if (created) {
        insertedCount++;
      } else {
        duplicatesCount++;
      }
    }
  } else {
    // Ignore duplicates mode
    const existingPrices = await SecurityPricing.findAll({
      where: {
        securityId,
        date: {
          [Op.in]: pricingData.map((p) => p.date),
        },
      },
      attributes: ['date'],
      raw: true,
    });

    const existingDatesSet = new Set(existingPrices.map((p) => format(new Date(p.date), 'yyyy-MM-dd')));

    const newPrices = pricingData.filter((p) => {
      const dateStr = format(new Date(p.date), 'yyyy-MM-dd');
      const isDuplicate = existingDatesSet.has(dateStr);
      if (isDuplicate) duplicatesCount++;
      return !isDuplicate;
    });

    if (newPrices.length > 0) {
      await SecurityPricing.bulkCreate(newPrices);
      insertedCount = newPrices.length;
    }
  }

  // Get new oldest/newest dates for this security
  const oldestPrice = await SecurityPricing.findOne({
    where: { securityId },
    order: [['date', 'ASC']],
    attributes: ['date'],
    raw: true,
  });

  const newestPrice = await SecurityPricing.findOne({
    where: { securityId },
    order: [['date', 'DESC']],
    attributes: ['date'],
    raw: true,
  });

  return {
    newOldestDate: oldestPrice?.date || null,
    newNewestDate: newestPrice?.date || null,
    summary: {
      inserted: insertedCount,
      duplicates: duplicatesCount,
      filtered: filteredCount,
    },
  };
};

/**
 * @jest-environment <rootDir>/src/services/budget-plans/periods/new-york-timezone-environment.ts
 */
import { describe, expect, it, jest } from '@jest/globals';

jest.mock('@models/exchange-rates.model', () => ({ __esModule: true, default: { findOne: jest.fn() } }));
jest.mock('@models/investments/security-pricing.model', () => ({
  __esModule: true,
  default: { findAll: jest.fn(), findOne: jest.fn(), bulkCreate: jest.fn() },
}));
jest.mock('@services/exchange-rates/providers', () => ({
  __esModule: true,
  exchangeRateProviderRegistry: { getEarliestHistoricalDate: () => new Date('1999-01-04') },
}));
jest.mock('../securities/add-from-search.service', () => ({ __esModule: true, addSecurityFromSearch: jest.fn() }));

/* eslint-disable import/first */
import ExchangeRates from '@models/exchange-rates.model';
import SecurityPricing from '@models/investments/security-pricing.model';

import { addSecurityFromSearch } from '../securities/add-from-search.service';
import { bulkUploadSecurityPrices } from './bulk-upload-prices.service';
/* eslint-enable import/first */

describe('bulkUploadSecurityPrices under America/New_York', () => {
  it('stores each price at UTC midnight of its calendar day', async () => {
    jest.mocked(addSecurityFromSearch).mockResolvedValue({ security: { id: 's1', currencyCode: 'USD' } } as never);
    jest
      .mocked(ExchangeRates.findOne)
      .mockResolvedValueOnce({ date: new Date('2020-01-01') } as never)
      .mockResolvedValueOnce({ date: new Date('2026-06-01') } as never);
    jest.mocked(SecurityPricing.findAll).mockResolvedValue([] as never);
    jest.mocked(SecurityPricing.findOne).mockResolvedValue(null as never);

    await bulkUploadSecurityPrices({
      searchResult: {} as never,
      prices: [{ price: 10, date: '2026-03-10', currency: 'USD' }],
    });

    const [rows] = jest.mocked(SecurityPricing.bulkCreate).mock.calls[0]! as unknown as [{ date: Date }[]];
    expect(rows.map((r) => r.date.toISOString())).toEqual(['2026-03-10T00:00:00.000Z']);
  });
});

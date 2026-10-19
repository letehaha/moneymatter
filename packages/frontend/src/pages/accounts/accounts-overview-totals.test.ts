import { describe, expect, it } from 'vitest';

import { computeAccountsOverview } from './accounts-overview-totals';

const makeAccount = (partial: {
  currentBalance?: number;
  refCurrentBalance?: number;
  creditLimit?: number;
  refCreditLimit?: number;
  currencyCode?: string;
}) => ({
  currentBalance: 0,
  refCurrentBalance: 0,
  creditLimit: 0,
  refCreditLimit: 0,
  currencyCode: 'USD',
  ...partial,
});

describe('computeAccountsOverview', () => {
  it('returns all zeros and non-approximate for empty inputs', () => {
    const result = computeAccountsOverview({
      moneyAccounts: [],
      vehicleAccounts: [],
      propertyAccounts: [],
      baseCurrencyCode: 'USD',
      includeCreditLimit: false,
    });

    expect(result).toEqual({ total: 0, assets: 0, liabilities: 0, vehicles: 0, properties: 0, isApprox: false });
  });

  it('splits money accounts into assets and liabilities and nets them into the total', () => {
    const result = computeAccountsOverview({
      moneyAccounts: [
        makeAccount({ refCurrentBalance: 300, currencyCode: 'USD' }),
        makeAccount({ refCurrentBalance: -120, currencyCode: 'USD' }),
      ],
      vehicleAccounts: [],
      propertyAccounts: [],
      baseCurrencyCode: 'USD',
      includeCreditLimit: false,
    });

    expect(result.assets).toBe(300);
    expect(result.liabilities).toBe(-120);
    expect(result.total).toBe(180);
    expect(result.isApprox).toBe(false);
  });

  it('flags approximate when any money account is in a non-base currency', () => {
    const result = computeAccountsOverview({
      moneyAccounts: [
        makeAccount({ refCurrentBalance: 100, currencyCode: 'USD' }),
        makeAccount({ refCurrentBalance: 40, currencyCode: 'EUR' }),
      ],
      vehicleAccounts: [],
      propertyAccounts: [],
      baseCurrencyCode: 'USD',
      includeCreditLimit: false,
    });

    expect(result.isApprox).toBe(true);
  });

  it('flags approximate when a vehicle account is in a non-base currency', () => {
    const result = computeAccountsOverview({
      moneyAccounts: [makeAccount({ refCurrentBalance: 100, currencyCode: 'USD' })],
      vehicleAccounts: [makeAccount({ refCurrentBalance: 5000, currencyCode: 'EUR' })],
      propertyAccounts: [],
      baseCurrencyCode: 'USD',
      includeCreditLimit: false,
    });

    expect(result.isApprox).toBe(true);
  });

  it('never flags approximate when the base currency is unknown', () => {
    const result = computeAccountsOverview({
      moneyAccounts: [makeAccount({ refCurrentBalance: 5, currencyCode: 'EUR' })],
      vehicleAccounts: [makeAccount({ refCurrentBalance: 5, currencyCode: 'PLN' })],
      propertyAccounts: [],
      baseCurrencyCode: undefined,
      includeCreditLimit: false,
    });

    expect(result.isApprox).toBe(false);
  });

  it('sums vehicles separately and keeps them out of total, assets and liabilities', () => {
    const result = computeAccountsOverview({
      moneyAccounts: [makeAccount({ refCurrentBalance: 200, currencyCode: 'USD' })],
      vehicleAccounts: [
        makeAccount({ refCurrentBalance: 15000, currencyCode: 'USD' }),
        makeAccount({ refCurrentBalance: 8000, currencyCode: 'USD' }),
      ],
      propertyAccounts: [],
      baseCurrencyCode: 'USD',
      includeCreditLimit: false,
    });

    expect(result.vehicles).toBe(23000);
    expect(result.assets).toBe(200);
    expect(result.liabilities).toBe(0);
    expect(result.total).toBe(200);
  });

  it('sums properties separately and keeps them out of total, assets and liabilities', () => {
    const result = computeAccountsOverview({
      moneyAccounts: [makeAccount({ refCurrentBalance: 200, currencyCode: 'USD' })],
      vehicleAccounts: [],
      propertyAccounts: [
        makeAccount({ refCurrentBalance: 385000, currencyCode: 'USD' }),
        makeAccount({ refCurrentBalance: 210000, currencyCode: 'USD' }),
      ],
      baseCurrencyCode: 'USD',
      includeCreditLimit: false,
    });

    expect(result.properties).toBe(595000);
    expect(result.vehicles).toBe(0);
    expect(result.assets).toBe(200);
    expect(result.liabilities).toBe(0);
    expect(result.total).toBe(200);
  });

  it('flags approximate when a property account is in a non-base currency', () => {
    const result = computeAccountsOverview({
      moneyAccounts: [makeAccount({ refCurrentBalance: 100, currencyCode: 'USD' })],
      vehicleAccounts: [],
      propertyAccounts: [makeAccount({ refCurrentBalance: 400000, currencyCode: 'EUR' })],
      baseCurrencyCode: 'USD',
      includeCreditLimit: false,
    });

    expect(result.isApprox).toBe(true);
  });

  it('leaves the credit limit out of the balances unless the setting is enabled', () => {
    const account = makeAccount({ currentBalance: 200, refCurrentBalance: 200, creditLimit: 500, currencyCode: 'USD' });

    const result = computeAccountsOverview({
      moneyAccounts: [account],
      vehicleAccounts: [],
      propertyAccounts: [],
      baseCurrencyCode: 'USD',
      includeCreditLimit: false,
    });

    expect(result.assets).toBe(200);
    expect(result.liabilities).toBe(0);
    expect(result.total).toBe(200);
  });

  it('threads the credit-limit setting through so a limited account can flip into a liability', () => {
    const account = makeAccount({
      currentBalance: 200,
      refCurrentBalance: 400,
      creditLimit: 500,
      refCreditLimit: 1000,
      currencyCode: 'EUR',
    });

    const result = computeAccountsOverview({
      moneyAccounts: [account],
      vehicleAccounts: [],
      propertyAccounts: [],
      baseCurrencyCode: 'USD',
      includeCreditLimit: true,
    });

    expect(result.assets).toBe(0);
    expect(result.liabilities).toBe(-600);
    expect(result.total).toBe(-600);
    expect(result.isApprox).toBe(true);
  });
});

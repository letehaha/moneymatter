import { ACCOUNT_CATEGORIES, type Cents, asCents } from '@bt/shared/types';
import { describe, expect, it } from '@jest/globals';

import { type AccountSignSplit, assembleNetWorthPoint } from './assemble-point';

const split = (owed: number, surplus: number): AccountSignSplit => ({
  owedCents: asCents(owed),
  surplusCents: asCents(surplus),
});

const NO_SPLIT = split(0, 0);

const assemble = (overrides: Partial<Parameters<typeof assembleNetWorthPoint>[0]> = {}) =>
  assembleNetWorthPoint({
    date: '2026-01-31',
    assetAccounts: NO_SPLIT,
    creditCard: NO_SPLIT,
    overdraft: NO_SPLIT,
    loanCents: asCents(0),
    portfolioCents: asCents(0),
    vehicleCents: asCents(0),
    propertyCents: asCents(0),
    ventureCents: asCents(0),
    ...overrides,
  });

describe('assembleNetWorthPoint', () => {
  it('folds a positive deposit account into cash and leaves liabilities empty', () => {
    const point = assemble({ assetAccounts: split(0, 1000) });

    expect(point.assets.cash).toBe(1000);
    expect(point.assetsTotal).toBe(1000);
    expect(point.liabilitiesTotal).toBe(0);
    expect(point.netWorth).toBe(1000);
  });

  it('classifies an overdrawn deposit account as an overdraft liability, keeping cash non-negative', () => {
    // One deposit account holds +1000, another is overdrawn -300 on the same day.
    const point = assemble({ assetAccounts: split(-300, 1000) });

    expect(point.assets.cash).toBe(1000);
    expect(point.liabilities[ACCOUNT_CATEGORIES.overdraft]).toBe(-300);
    expect(point.liabilitiesTotal).toBe(-300);
    expect(point.netWorth).toBe(700);
  });

  it('folds an overdrawn deposit account and an owing overdraft account into one overdraft total', () => {
    const point = assemble({ assetAccounts: split(-150, 0), overdraft: split(-250, 0) });

    expect(point.assets.cash).toBe(0);
    expect(point.liabilities[ACCOUNT_CATEGORIES.overdraft]).toBe(-400);
    expect(point.liabilitiesTotal).toBe(-400);
    expect(point.netWorth).toBe(-400);
  });

  it('folds a positive-balance card or overdraft into cash, not into its liability kind', () => {
    const point = assemble({ creditCard: split(0, 400), overdraft: split(0, 100) });

    expect(point.assets.cash).toBe(500);
    expect(point.liabilities[ACCOUNT_CATEGORIES.creditCard]).toBe(0);
    expect(point.liabilities[ACCOUNT_CATEGORIES.overdraft]).toBe(0);
    expect(point.liabilitiesTotal).toBe(0);
  });

  it('splits one card with both an owing and an own-funds account across cash and the liability', () => {
    const point = assemble({ creditCard: split(-500, 700) });

    expect(point.assets.cash).toBe(700);
    expect(point.liabilities[ACCOUNT_CATEGORIES.creditCard]).toBe(-500);
    expect(point.netWorth).toBe(200);
  });

  it('carries a loan at its whole signed value, and an overpaid loan reads positive', () => {
    const owing = assemble({ loanCents: asCents(-1000) });
    expect(owing.liabilities[ACCOUNT_CATEGORIES.loan]).toBe(-1000);
    expect(owing.liabilitiesTotal).toBe(-1000);

    const overpaid = assemble({ loanCents: asCents(250) });
    expect(overpaid.liabilities[ACCOUNT_CATEGORIES.loan]).toBe(250);
    expect(overpaid.liabilitiesTotal).toBe(250);
    expect(overpaid.netWorth).toBe(250);
  });

  it('sums every asset kind into assetsTotal and net worth', () => {
    const point = assemble({
      assetAccounts: split(0, 100),
      portfolioCents: asCents(200),
      vehicleCents: asCents(300),
      propertyCents: asCents(500),
      ventureCents: asCents(400),
    });

    expect(point.assets).toEqual({
      cash: 100,
      investments: 200,
      vehicles: 300,
      properties: 500,
      ventures: 400,
    });
    expect(point.assetsTotal).toBe(1500);
    expect(point.netWorth).toBe(1500);
  });

  it('nets assets against liabilities in net worth', () => {
    const point = assemble({
      assetAccounts: split(0, 5000),
      portfolioCents: asCents(3000),
      creditCard: split(-800, 0),
      loanCents: asCents(-1200),
    });

    expect(point.assetsTotal).toBe(8000);
    expect(point.liabilitiesTotal).toBe(-2000);
    expect(point.netWorth).toBe(6000);
  });
});

// Type-only guard: assembleNetWorthPoint returns Cents-typed money everywhere.
const _cents: Cents = assembleNetWorthPoint({
  date: '2026-01-31',
  assetAccounts: NO_SPLIT,
  creditCard: NO_SPLIT,
  overdraft: NO_SPLIT,
  loanCents: asCents(0),
  portfolioCents: asCents(0),
  vehicleCents: asCents(0),
  propertyCents: asCents(0),
  ventureCents: asCents(0),
}).netWorth;
void _cents;

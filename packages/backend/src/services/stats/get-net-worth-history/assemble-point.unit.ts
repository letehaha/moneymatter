import { ACCOUNT_CATEGORIES, type MinorUnits, asMinorUnits } from '@bt/shared/types';
import { describe, expect, it } from '@jest/globals';

import { type AccountSignSplit, assembleNetWorthPoint } from './assemble-point';

const split = (owed: number, surplus: number): AccountSignSplit => ({
  owedMinor: asMinorUnits(owed),
  surplusMinor: asMinorUnits(surplus),
});

const NO_SPLIT = split(0, 0);

const assemble = (overrides: Partial<Parameters<typeof assembleNetWorthPoint>[0]> = {}) =>
  assembleNetWorthPoint({
    date: '2026-01-31',
    assetAccounts: NO_SPLIT,
    creditCard: NO_SPLIT,
    overdraft: NO_SPLIT,
    loanMinor: asMinorUnits(0),
    portfolioMinor: asMinorUnits(0),
    vehicleMinor: asMinorUnits(0),
    ventureMinor: asMinorUnits(0),
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
    const owing = assemble({ loanMinor: asMinorUnits(-1000) });
    expect(owing.liabilities[ACCOUNT_CATEGORIES.loan]).toBe(-1000);
    expect(owing.liabilitiesTotal).toBe(-1000);

    const overpaid = assemble({ loanMinor: asMinorUnits(250) });
    expect(overpaid.liabilities[ACCOUNT_CATEGORIES.loan]).toBe(250);
    expect(overpaid.liabilitiesTotal).toBe(250);
    expect(overpaid.netWorth).toBe(250);
  });

  it('sums every asset kind into assetsTotal and net worth', () => {
    const point = assemble({
      assetAccounts: split(0, 100),
      portfolioMinor: asMinorUnits(200),
      vehicleMinor: asMinorUnits(300),
      ventureMinor: asMinorUnits(400),
    });

    expect(point.assets).toEqual({ cash: 100, investments: 200, vehicles: 300, ventures: 400 });
    expect(point.assetsTotal).toBe(1000);
    expect(point.netWorth).toBe(1000);
  });

  it('nets assets against liabilities in net worth', () => {
    const point = assemble({
      assetAccounts: split(0, 5000),
      portfolioMinor: asMinorUnits(3000),
      creditCard: split(-800, 0),
      loanMinor: asMinorUnits(-1200),
    });

    expect(point.assetsTotal).toBe(8000);
    expect(point.liabilitiesTotal).toBe(-2000);
    expect(point.netWorth).toBe(6000);
  });

  it('sums 3-decimal minor units exactly', () => {
    // 0.778 held, 1.234 owed on an overdrawn account, 0.001 on a card: 3-decimal minor units.
    const point = assemble({ assetAccounts: split(-1234, 778), creditCard: split(0, 1) });

    expect(point.assets.cash).toBe(779);
    expect(point.liabilitiesTotal).toBe(-1234);
    expect(point.netWorth).toBe(-455);
  });
});

// Type-only guard: assembleNetWorthPoint returns MinorUnits-typed money everywhere.
const _minor: MinorUnits = assembleNetWorthPoint({
  date: '2026-01-31',
  assetAccounts: NO_SPLIT,
  creditCard: NO_SPLIT,
  overdraft: NO_SPLIT,
  loanMinor: asMinorUnits(0),
  portfolioMinor: asMinorUnits(0),
  vehicleMinor: asMinorUnits(0),
  ventureMinor: asMinorUnits(0),
}).netWorth;
void _minor;

import { describe, expect, it } from 'vitest';

import { computeAccountDisplayBalances, computeCreditUsed } from './account-balance';

describe('computeCreditUsed', () => {
  const manual = { balanceIncludesCreditLimit: false };

  it('derives used from limit minus balance for an available-credit balance, tie-break on', () => {
    expect(computeCreditUsed({ ...manual, balance: 4000, creditLimit: 5000, zeroBalanceMeansFullyDrawn: true })).toBe(
      1000,
    );
  });

  it('derives used from limit minus balance for an available-credit balance, tie-break off', () => {
    expect(computeCreditUsed({ ...manual, balance: 700, creditLimit: 1000, zeroBalanceMeansFullyDrawn: false })).toBe(
      300,
    );
  });

  it('treats a negative balance as direct debt, tie-break off', () => {
    expect(
      computeCreditUsed({ ...manual, balance: -275, creditLimit: 150_000, zeroBalanceMeansFullyDrawn: false }),
    ).toBe(275);
  });

  it('treats a negative balance as direct debt, tie-break on', () => {
    expect(computeCreditUsed({ ...manual, balance: -300, creditLimit: 1000, zeroBalanceMeansFullyDrawn: true })).toBe(
      300,
    );
  });

  it('reads a zero balance as an untouched card when the tie-break is off', () => {
    expect(computeCreditUsed({ ...manual, balance: 0, creditLimit: 150_000, zeroBalanceMeansFullyDrawn: false })).toBe(
      0,
    );
  });

  it('reads a zero balance as a fully drawn card when the tie-break is on', () => {
    expect(computeCreditUsed({ ...manual, balance: 0, creditLimit: 5000, zeroBalanceMeansFullyDrawn: true })).toBe(
      5000,
    );
  });

  it('clamps to zero when own money sits on top of the limit', () => {
    expect(computeCreditUsed({ ...manual, balance: 6000, creditLimit: 5000, zeroBalanceMeansFullyDrawn: true })).toBe(
      0,
    );
  });

  it('reads a zero balance as fully drawn when the balance embeds the credit limit', () => {
    expect(
      computeCreditUsed({
        balance: 0,
        creditLimit: 1000,
        balanceIncludesCreditLimit: true,
        zeroBalanceMeansFullyDrawn: false,
      }),
    ).toBe(1000);
  });
});

describe('computeAccountDisplayBalances', () => {
  const account = { currentBalance: 200, refCurrentBalance: 400, creditLimit: 500, refCreditLimit: 1000 };

  it('returns the raw balances when the credit-limit setting is off', () => {
    expect(computeAccountDisplayBalances({ ...account, includeCreditLimit: false })).toEqual({
      hasCreditLimitAdjustment: false,
      displayBalance: 200,
      displayRefBalance: 400,
    });
  });

  it('does not adjust an account without a credit limit even when the setting is on', () => {
    expect(
      computeAccountDisplayBalances({ ...account, creditLimit: 0, refCreditLimit: 0, includeCreditLimit: true }),
    ).toEqual({ hasCreditLimitAdjustment: false, displayBalance: 200, displayRefBalance: 400 });
  });

  it('subtracts the native limit from the native balance and the ref limit from the ref balance', () => {
    expect(computeAccountDisplayBalances({ ...account, includeCreditLimit: true })).toEqual({
      hasCreditLimitAdjustment: true,
      displayBalance: -300,
      displayRefBalance: -600,
    });
  });

  it('shows a fully drawn card (zero native balance) as minus the limit in both currencies', () => {
    expect(
      computeAccountDisplayBalances({ ...account, currentBalance: 0, refCurrentBalance: 0, includeCreditLimit: true }),
    ).toEqual({ hasCreditLimitAdjustment: true, displayBalance: -500, displayRefBalance: -1000 });
  });
  it('counts a base-currency balance that has no rate yet as nothing, in both modes', () => {
    const unvalued = { ...account, refCurrentBalance: null, refCreditLimit: null };

    expect(computeAccountDisplayBalances({ ...unvalued, includeCreditLimit: false })).toEqual({
      hasCreditLimitAdjustment: false,
      displayBalance: 200,
      displayRefBalance: 0,
    });
    expect(computeAccountDisplayBalances({ ...unvalued, includeCreditLimit: true })).toEqual({
      hasCreditLimitAdjustment: true,
      displayBalance: -300,
      displayRefBalance: 0,
    });
  });
});

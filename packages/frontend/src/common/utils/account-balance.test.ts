import { describe, expect, it } from 'vitest';

import { computeAccountDisplayBalances, computeCreditUsed } from './account-balance';

describe('computeCreditUsed', () => {
  const manual = { balanceIncludesCreditLimit: false };

  it('derives used from limit minus balance for an available-credit balance', () => {
    expect(computeCreditUsed({ ...manual, balance: 4000, creditLimit: 5000, balanceIsAvailableCredit: true })).toBe(
      1000,
    );
  });

  it('reads a positive debt-style balance as an overpayment with nothing drawn', () => {
    expect(
      computeCreditUsed({ ...manual, balance: 100, creditLimit: 10_000_000, balanceIsAvailableCredit: false }),
    ).toBe(0);
  });

  it('treats a negative debt-style balance as direct debt', () => {
    expect(computeCreditUsed({ ...manual, balance: -275, creditLimit: 150_000, balanceIsAvailableCredit: false })).toBe(
      275,
    );
  });

  it('treats a negative available-credit balance as direct debt', () => {
    expect(computeCreditUsed({ ...manual, balance: -300, creditLimit: 1000, balanceIsAvailableCredit: true })).toBe(
      300,
    );
  });

  it('reads a zero debt-style balance as an untouched card', () => {
    expect(computeCreditUsed({ ...manual, balance: 0, creditLimit: 150_000, balanceIsAvailableCredit: false })).toBe(0);
  });

  it('reads a zero available-credit balance as a fully drawn card', () => {
    expect(computeCreditUsed({ ...manual, balance: 0, creditLimit: 5000, balanceIsAvailableCredit: true })).toBe(5000);
  });

  it('clamps to zero when own money sits on top of the limit', () => {
    expect(computeCreditUsed({ ...manual, balance: 6000, creditLimit: 5000, balanceIsAvailableCredit: true })).toBe(0);
  });

  it('reads a zero balance as fully drawn when the balance embeds the credit limit', () => {
    expect(
      computeCreditUsed({
        balance: 0,
        creditLimit: 1000,
        balanceIncludesCreditLimit: true,
        balanceIsAvailableCredit: false,
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
});

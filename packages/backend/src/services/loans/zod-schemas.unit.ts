import { LOAN_TYPE } from '@bt/shared/types';
import { Money } from '@common/types/money';
import { describe, expect, it } from '@jest/globals';
import { z } from 'zod';

import { createLoanBodyFields, createLoanBodySchema, updateLoanBodyFields, updateLoanBodySchema } from './zod-schemas';

const VALID_CREATE = {
  name: ' Car loan ',
  currencyCode: 'USD',
  initialBalance: 15_000.55,
  loanType: LOAN_TYPE.auto,
  originalPrincipal: 20_000,
  interestRate: 4.5,
  startDate: '2024-01-15',
};

describe('createLoanBodySchema', () => {
  it('is built from the exported fields, which carry plain numbers for the amounts', () => {
    const fields = z.object(createLoanBodyFields);

    expect(fields.safeParse(VALID_CREATE).success).toBe(true);
    expect(fields.parse(VALID_CREATE).initialBalance).toBe(15_000.55);
  });

  it('turns the amounts into Money and trims the name', () => {
    const body = createLoanBodySchema.parse({ ...VALID_CREATE, minPayment: 250.25, plannedPayment: null });

    expect(body.name).toBe('Car loan');
    expect(body.initialBalance).toBeInstanceOf(Money);
    expect(body.initialBalance.toNumber()).toBe(15_000.55);
    expect(body.originalPrincipal.toNumber()).toBe(20_000);
    expect(body.minPayment).toBeInstanceOf(Money);
    expect(body.minPayment?.toNumber()).toBe(250.25);
    expect(body.plannedPayment).toBeNull();
  });

  it('leaves an omitted optional amount undefined', () => {
    const body = createLoanBodySchema.parse(VALID_CREATE);

    expect(body.minPayment).toBeUndefined();
    expect(body.plannedPayment).toBeUndefined();
  });

  it('accepts a zero outstanding balance and rejects negative amounts and a zero principal', () => {
    expect(createLoanBodySchema.safeParse({ ...VALID_CREATE, initialBalance: 0 }).success).toBe(true);
    expect(createLoanBodySchema.safeParse({ ...VALID_CREATE, minPayment: 0 }).success).toBe(true);

    for (const patch of [
      { initialBalance: -1 },
      { minPayment: -1 },
      { plannedPayment: -1 },
      { originalPrincipal: 0 },
      { originalPrincipal: -5 },
    ]) {
      expect([patch, createLoanBodySchema.safeParse({ ...VALID_CREATE, ...patch }).success]).toEqual([patch, false]);
    }
  });
});

describe('updateLoanBodySchema', () => {
  it('is built from the exported fields', () => {
    const fields = z.object(updateLoanBodyFields);

    expect(fields.safeParse({}).success).toBe(true);
    expect(fields.parse({ currentBalance: 10 }).currentBalance).toBe(10);
  });

  it('turns the amounts into Money and keeps null as a clear', () => {
    const body = updateLoanBodySchema.parse({ currentBalance: 150_000.25, plannedPayment: null, minPayment: 0 });

    expect(body.currentBalance).toBeInstanceOf(Money);
    expect(body.currentBalance?.toNumber()).toBe(150_000.25);
    expect(body.plannedPayment).toBeNull();
    expect(body.minPayment).toBeInstanceOf(Money);
    expect(body.minPayment?.isZero()).toBe(true);
  });

  it('refuses an empty patch and an as-of date without a balance', () => {
    expect(updateLoanBodySchema.safeParse({}).success).toBe(false);
    expect(updateLoanBodySchema.safeParse({ currentBalanceAsOf: '2024-01-01' }).success).toBe(false);
    expect(updateLoanBodySchema.safeParse({ currentBalance: 1, currentBalanceAsOf: '2024-01-01' }).success).toBe(true);
  });

  it('rejects negative amounts', () => {
    for (const patch of [{ currentBalance: -1 }, { minPayment: -1 }, { plannedPayment: -1 }]) {
      expect([patch, updateLoanBodySchema.safeParse(patch).success]).toEqual([patch, false]);
    }
  });
});

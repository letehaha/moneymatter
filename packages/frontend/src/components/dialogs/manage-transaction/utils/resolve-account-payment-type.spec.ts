import { VERBOSE_PAYMENT_TYPES } from '@/common/const';
import { PAYMENT_TYPES } from '@bt/shared/types';
import { describe, expect, it } from 'vitest';

import { resolveAccountPaymentType } from './resolve-account-payment-type';

const byValue = (value: PAYMENT_TYPES) => VERBOSE_PAYMENT_TYPES.find((item) => item.value === value)!;
const fallback = byValue(PAYMENT_TYPES.creditCard);

describe('resolveAccountPaymentType', () => {
  it('prefers the account default over the fallback', () => {
    expect(
      resolveAccountPaymentType({
        account: { defaultPaymentType: PAYMENT_TYPES.cash },
        fallback,
      }),
    ).toBe(byValue(PAYMENT_TYPES.cash));
  });

  it('falls back when the account has no default', () => {
    expect(
      resolveAccountPaymentType({
        account: { defaultPaymentType: null },
        fallback,
      }),
    ).toBe(fallback);
  });

  it('falls back when there is no account or it lacks the field', () => {
    expect(resolveAccountPaymentType({ account: null, fallback })).toBe(fallback);
    expect(resolveAccountPaymentType({ account: {} as never, fallback })).toBe(fallback);
  });
});

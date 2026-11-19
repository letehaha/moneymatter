import { describe, expect, it, jest } from '@jest/globals';

jest.mock('@i18n/index', () => ({
  __esModule: true,
  t: ({ key, variables }: { key: string; variables?: Record<string, unknown> }) =>
    variables ? `${key} ${JSON.stringify(variables)}` : key,
}));

/* eslint-disable import/first */
import { ACCOUNT_TYPES } from '@bt/shared/types';
import { Money } from '@common/types/money';

import {
  assertPreSeamManualRow,
  assertRowDeletableOnAccount,
  isBeforeSeam,
  manualRowOnBankAccountMessage,
} from './seam';
/* eslint-enable import/first */

const SEAM_ACCOUNT = {
  type: ACCOUNT_TYPES.lunchflow,
  seamBalance: Money.fromCents(120_000),
  externalData: {
    bankConnection: {
      linkedAt: '2026-11-10T15:30:00.000Z',
      linkingStrategy: 'forward-only' as const,
      balanceReconciliation: { systemBalance: 0, externalBalance: 0, difference: 0, adjustmentTransactionId: null },
    },
  },
};
const manualRow = ({ time }: { time: string }) => ({ accountType: ACCOUNT_TYPES.system, time });

describe('assertPreSeamManualRow', () => {
  it('accepts a manual row before the link day that stays before it', () => {
    expect(() =>
      assertPreSeamManualRow({
        account: SEAM_ACCOUNT,
        transaction: manualRow({ time: '2026-11-09T23:59:59.999Z' }),
        nextTime: '2026-11-01T00:00:00.000Z',
      }),
    ).not.toThrow();
  });

  it('names the link day for a manual row dated on or after it', () => {
    expect(() =>
      assertPreSeamManualRow({ account: SEAM_ACCOUNT, transaction: manualRow({ time: '2026-11-10T00:00:00.000Z' }) }),
    ).toThrow('transactions.manualRowOnOrAfterLinkDay {"date":"2026-11-10"}');
  });

  it('refuses moving a pre-seam row onto the link day', () => {
    expect(() =>
      assertPreSeamManualRow({
        account: SEAM_ACCOUNT,
        transaction: manualRow({ time: '2026-11-01T00:00:00.000Z' }),
        nextTime: '2026-11-10T00:00:00.000Z',
      }),
    ).toThrow('transactions.preSeamTimeOnOrAfterLinkDay {"date":"2026-11-10"}');
  });

  it('keeps the generic message for a bank row and for an account without a seam', () => {
    expect(() =>
      assertPreSeamManualRow({
        account: SEAM_ACCOUNT,
        transaction: { accountType: ACCOUNT_TYPES.lunchflow, time: '2026-11-01T00:00:00.000Z' },
      }),
    ).toThrow('transactions.editReadonlyFields');
    expect(() =>
      assertPreSeamManualRow({
        account: { ...SEAM_ACCOUNT, seamBalance: null },
        transaction: manualRow({ time: '2026-11-01T00:00:00.000Z' }),
      }),
    ).toThrow('transactions.editReadonlyFields');
  });

  it('keeps the link-day limit for an opposite leg and names the other leg only for a bank row', () => {
    const refuse =
      ({ transaction }: { transaction: { accountType: ACCOUNT_TYPES; time: string } }) =>
      () =>
        assertPreSeamManualRow({
          account: SEAM_ACCOUNT,
          transaction,
          nextTime: '2026-11-12T00:00:00.000Z',
          isOppositeLeg: true,
        });

    expect(refuse({ transaction: manualRow({ time: '2026-11-10T00:00:00.000Z' }) })).toThrow(
      'transactions.manualRowOnOrAfterLinkDay {"date":"2026-11-10"}',
    );
    expect(refuse({ transaction: manualRow({ time: '2026-11-01T00:00:00.000Z' }) })).toThrow(
      'transactions.preSeamTimeOnOrAfterLinkDay {"date":"2026-11-10"}',
    );
    expect(refuse({ transaction: { accountType: ACCOUNT_TYPES.lunchflow, time: '2026-11-01T00:00:00.000Z' } })).toThrow(
      'transactions.oppositeLegOnBankAccount',
    );
  });
});

describe('assertRowDeletableOnAccount', () => {
  it('lets only a manual row dated before the link day go', () => {
    expect(() =>
      assertRowDeletableOnAccount({
        account: SEAM_ACCOUNT,
        transaction: manualRow({ time: '2026-11-09T23:59:59.999Z' }),
      }),
    ).not.toThrow();
    expect(() =>
      assertRowDeletableOnAccount({
        account: SEAM_ACCOUNT,
        transaction: manualRow({ time: '2026-11-10T00:00:00.000Z' }),
      }),
    ).toThrow('transactions.manualRowOnOrAfterLinkDay {"date":"2026-11-10"}');
  });

  it('refuses a bank row and any row on a bank account without a seam, and opens a manual account', () => {
    expect(() =>
      assertRowDeletableOnAccount({
        account: SEAM_ACCOUNT,
        transaction: { accountType: ACCOUNT_TYPES.lunchflow, time: '2026-11-01T00:00:00.000Z' },
      }),
    ).toThrow('transactions.cannotDeleteExternal');
    expect(() =>
      assertRowDeletableOnAccount({
        account: { ...SEAM_ACCOUNT, seamBalance: null },
        transaction: manualRow({ time: '2026-11-01T00:00:00.000Z' }),
      }),
    ).toThrow('transactions.cannotDeleteExternal');
    expect(() =>
      assertRowDeletableOnAccount({
        account: { type: ACCOUNT_TYPES.system, externalData: null, seamBalance: null },
        transaction: manualRow({ time: '2026-11-12T00:00:00.000Z' }),
      }),
    ).not.toThrow();
  });
});

describe('isBeforeSeam', () => {
  it('compares against UTC midnight of the link day, for Date and string times', () => {
    expect(isBeforeSeam({ account: SEAM_ACCOUNT, time: '2026-11-09T23:59:59.999Z' })).toBe(true);
    expect(isBeforeSeam({ account: SEAM_ACCOUNT, time: new Date('2026-11-10T00:00:00.000Z') })).toBe(false);
    expect(isBeforeSeam({ account: { ...SEAM_ACCOUNT, seamBalance: null }, time: '2026-11-01T00:00:00.000Z' })).toBe(
      false,
    );
  });
});

describe('manualRowOnBankAccountMessage', () => {
  it('names the link day only for a seam account and a time from the seam on', () => {
    expect(manualRowOnBankAccountMessage({ account: SEAM_ACCOUNT, time: '2026-11-10T00:00:00.000Z' })).toBe(
      'transactions.manualRowOnOrAfterLinkDayCreate {"date":"2026-11-10"}',
    );
    expect(manualRowOnBankAccountMessage({ account: SEAM_ACCOUNT, time: '2026-11-01T00:00:00.000Z' })).toBe(
      'transactions.manualOnConnectedAccount',
    );
    expect(
      manualRowOnBankAccountMessage({
        account: { ...SEAM_ACCOUNT, seamBalance: null },
        time: '2026-11-12T00:00:00.000Z',
      }),
    ).toBe('transactions.manualOnConnectedAccount');
  });
});

import { describe, expect, it, jest } from '@jest/globals';

jest.mock('@i18n/index', () => ({
  __esModule: true,
  t: ({ key, variables }: { key: string; variables?: Record<string, unknown> }) =>
    variables ? `${key} ${JSON.stringify(variables)}` : key,
}));

/* eslint-disable import/first */
import { ACCOUNT_TYPES } from '@bt/shared/types';
import { Money } from '@common/types/money';

import { assertPreSeamManualRow, assertRowDeletableOnAccount } from './seam';
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
    ).toThrow('transactions.preSeamTimeOnOrAfterLinkDay');
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

  it('says the other leg is on a bank-linked account for every refusal of an opposite leg', () => {
    for (const time of ['2026-11-10T00:00:00.000Z', '2026-11-01T00:00:00.000Z']) {
      expect(() =>
        assertPreSeamManualRow({
          account: SEAM_ACCOUNT,
          transaction: manualRow({ time }),
          nextTime: '2026-11-12T00:00:00.000Z',
          isOppositeLeg: true,
        }),
      ).toThrow('transactions.oppositeLegOnBankAccount');
    }
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

import { ACCOUNT_TYPES } from '@bt/shared/types';
import { Money } from '@common/types/money';
import { beforeEach, describe, expect, it, jest } from '@jest/globals';

jest.mock('@i18n/index', () => ({
  __esModule: true,
  t: ({ key, variables }: { key: string; variables?: Record<string, unknown> }) =>
    variables ? `${key} ${JSON.stringify(variables)}` : key,
}));
jest.mock('@models/accounts.model', () => ({ __esModule: true, default: { findByPk: jest.fn() } }));
jest.mock('@models/connection', () => ({
  __esModule: true,
  connection: { sequelize: { transaction: (fn: () => Promise<unknown>) => fn() } },
  namespace: { get: () => undefined },
}));
jest.mock('@models/users-currencies.model', () => ({ __esModule: true, default: {}, getBaseCurrency: jest.fn() }));
jest.mock('@services/accounts/lock-account-row', () => ({ __esModule: true, lockAccountRow: jest.fn() }));
jest.mock('@services/accounts/restamp-ref-initial-balance', () => ({
  __esModule: true,
  measureRefInitialBalanceAtBoundary: jest.fn(),
  restampRefInitialBalance: jest.fn(),
}));
jest.mock('@services/exchange-rates/build-daily-pair-rate-resolver', () => ({
  __esModule: true,
  buildDailyPairRateResolver: jest.fn(),
  MS_PER_DAY: 86_400_000,
  toDayKey: (date: Date) => date.toISOString().slice(0, 10),
}));
jest.mock('@services/user-exchange-rate/get-exchange-rate.service', () => ({
  __esModule: true,
  resolveCustomRate: jest.fn(),
}));
jest.mock('@services/user-exchange-rate/resolve-custom-pair-rate', () => ({
  __esModule: true,
  loadCustomCurrencyDailyQuote: jest.fn(),
}));
jest.mock('@services/currencies/custom-currency-codes', () => ({
  __esModule: true,
  includesCustomCurrencyCode: async () => false,
}));
jest.mock('@js/utils', () => ({
  __esModule: true,
  logger: { error: jest.fn(), info: jest.fn(), warn: jest.fn(), debug: jest.fn() },
}));

/* eslint-disable import/first */
import Accounts from '@models/accounts.model';

import { runWithBalanceRevalueBatch, schedulePreSeamRebuild } from './revalue-balance-history.service';
/* eslint-enable import/first */

const SEAM_ACCOUNT = {
  type: ACCOUNT_TYPES.lunchflow,
  seamBalance: Money.fromDecimal(1200),
  externalData: {
    bankConnection: {
      linkedAt: '2026-11-10T15:30:00.000Z',
      linkingStrategy: 'forward-only' as const,
      balanceReconciliation: { systemBalance: 0, externalBalance: 0, difference: 0, adjustmentTransactionId: null },
    },
  },
};
const ACCOUNT_ID = 'account-1';

// The batch scope defers the rebuild, so a pre-seam time needs no DB.
const schedule = (params: Omit<Parameters<typeof schedulePreSeamRebuild>[0], 'accountId'>) =>
  runWithBalanceRevalueBatch(() => schedulePreSeamRebuild({ accountId: ACCOUNT_ID, ...params })).catch(
    (error: Error) => error,
  );

describe('schedulePreSeamRebuild', () => {
  beforeEach(() => {
    jest.mocked(Accounts.findByPk).mockResolvedValue(SEAM_ACCOUNT as never);
  });

  it('refuses a manual row entering the ledger on or after the link day, naming the day', async () => {
    const result = await schedule({ times: [new Date('2026-11-10T00:00:00.000Z')], mode: 'enter-ledger' });
    expect(result).toBeInstanceOf(Error);
    expect((result as Error).message).toBe('transactions.manualRowOnOrAfterLinkDayCreate {"date":"2026-11-10"}');
  });

  it('lets a row before the link day through, and keeps a seam-day row seam-owned on edit', async () => {
    expect(await schedule({ times: [new Date('2026-11-09T23:59:59.999Z')], mode: 'enter-ledger' })).toBe(true);
    expect(await schedule({ times: [new Date('2026-11-10T00:00:00.000Z')] })).toBe(true);
  });

  it('refuses a manual edit crossing the seam, but lets a bank row cross it', async () => {
    const times = [new Date('2026-11-09T12:00:00.000Z'), new Date('2026-11-10T12:00:00.000Z')];
    expect(await schedule({ times })).toBeInstanceOf(Error);
    expect(await schedule({ times, mode: 'bank-row' })).toBe(true);
  });

  it('does not throw on empty times', async () => {
    expect(await schedule({ times: [], mode: 'enter-ledger' })).toBe(true);
  });

  it('returns false on an account without a seam', async () => {
    jest.mocked(Accounts.findByPk).mockResolvedValue({ ...SEAM_ACCOUNT, seamBalance: null } as never);
    expect(await schedule({ times: [new Date('2026-11-12T00:00:00.000Z')], mode: 'enter-ledger' })).toBe(false);
  });
});

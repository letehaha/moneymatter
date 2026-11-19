import { ACCOUNT_TYPES, type AccountModel, AccountOptionValue } from '@bt/shared/types';
import { describe, expect, it, vi } from 'vitest';
import type { ComposerTranslation } from 'vue-i18n';

import { getBankSeamSkippedMessage, getCsvSeamTargets, getLinkedAccounts } from './bank-seam-targets';

const SEAM = new Date(2026, 10, 5).toISOString();
const makeAccount = (overrides: Partial<AccountModel>) => overrides as AccountModel;

const manual = makeAccount({ id: 'manual' as AccountModel['id'], type: ACCOUNT_TYPES.system, bankSeamAt: null });
const seam = makeAccount({ id: 'seam' as AccountModel['id'], type: ACCOUNT_TYPES.monobank, bankSeamAt: SEAM });
const seam2 = makeAccount({ id: 'seam2' as AccountModel['id'], type: ACCOUNT_TYPES.enableBanking, bankSeamAt: SEAM });
const bank = makeAccount({ id: 'bank' as AccountModel['id'], type: ACCOUNT_TYPES.monobank, bankSeamAt: null });
const accountsRecord = { manual, seam, seam2, bank };

describe('getLinkedAccounts', () => {
  it('resolves link-existing targets and leaves created or skipped sources undefined', () => {
    expect(
      getLinkedAccounts({
        accountMapping: {
          A: { action: 'link-existing', accountId: 'seam' },
          B: { action: 'link-existing', accountId: undefined },
          C: { action: 'create-new' },
          D: { action: 'skip' },
        },
        accountsRecord,
      }),
    ).toEqual([seam, undefined, undefined, undefined]);
  });
});

describe('getBankSeamSkippedMessage', () => {
  const t = vi.fn((key: string) => key) as unknown as ComposerTranslation;

  it('names the seam day when a single seam account is targeted', () => {
    getBankSeamSkippedMessage({ count: 2, accounts: [seam, seam, manual, undefined], t });

    expect(t).toHaveBeenLastCalledWith('importShared.bankSeamSkipped', { count: 2, date: '05 Nov 2026' }, 2);
  });

  it('leaves the date out when several seam accounts are targeted', () => {
    getBankSeamSkippedMessage({ count: 1, accounts: [seam, seam2], t });

    expect(t).toHaveBeenLastCalledWith('importShared.bankSeamSkippedNoDate', { count: 1 }, 1);
  });

  it('leaves the date out when no target is a known seam account', () => {
    getBankSeamSkippedMessage({ count: 1, accounts: [null], t });

    expect(t).toHaveBeenLastCalledWith('importShared.bankSeamSkippedNoDate', { count: 1 }, 1);
  });
});

describe('getCsvSeamTargets', () => {
  it('treats a single existing seam account as an all-seam import', () => {
    expect(
      getCsvSeamTargets({
        account: { option: AccountOptionValue.existingAccount, accountId: 'seam' },
        accountMapping: {},
        accountsRecord,
      }),
    ).toEqual({ seamAccounts: [seam], isEveryTargetSeam: true });
  });

  it('treats a single existing manual account as no seam target', () => {
    expect(
      getCsvSeamTargets({
        account: { option: AccountOptionValue.existingAccount, accountId: 'manual' },
        accountMapping: {},
        accountsRecord,
      }),
    ).toEqual({ seamAccounts: [], isEveryTargetSeam: false });
  });

  it('reports mixed targets when a source maps to a manual account or a new one', () => {
    const account = { option: AccountOptionValue.dataSourceColumn, columnName: 'Account' } as const;

    expect(
      getCsvSeamTargets({
        account,
        accountMapping: {
          A: { action: 'link-existing', accountId: 'seam' },
          B: { action: 'link-existing', accountId: 'manual' },
        },
        accountsRecord,
      }),
    ).toEqual({ seamAccounts: [seam], isEveryTargetSeam: false });

    expect(
      getCsvSeamTargets({
        account,
        accountMapping: {
          A: { action: 'link-existing', accountId: 'seam' },
          B: { action: 'create-new', currentBalance: null },
        },
        accountsRecord,
      }).isEveryTargetSeam,
    ).toBe(false);
  });

  it('ignores skipped sources and dedupes seam accounts', () => {
    expect(
      getCsvSeamTargets({
        account: { option: AccountOptionValue.dataSourceColumn, columnName: 'Account' },
        accountMapping: {
          A: { action: 'link-existing', accountId: 'seam' },
          B: { action: 'link-existing', accountId: 'seam' },
          C: { action: 'link-existing', accountId: 'seam2' },
          D: { action: 'skip' },
        },
        accountsRecord,
      }),
    ).toEqual({ seamAccounts: [seam, seam2], isEveryTargetSeam: true });
  });

  it('has no targets before the account mapping is filled', () => {
    expect(getCsvSeamTargets({ account: null, accountMapping: {}, accountsRecord })).toEqual({
      seamAccounts: [],
      isEveryTargetSeam: false,
    });
  });
});

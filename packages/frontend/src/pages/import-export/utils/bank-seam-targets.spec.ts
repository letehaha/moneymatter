import { ACCOUNT_TYPES, type AccountModel, AccountOptionValue } from '@bt/shared/types';
import { describe, expect, it } from 'vitest';

import { getCsvSeamTargets, getCsvTargetableAccounts } from './bank-seam-targets';

const SEAM = '2026-11-05T00:00:00.000Z';
const makeAccount = (overrides: Partial<AccountModel>) => overrides as AccountModel;

const manual = makeAccount({ id: 'manual' as AccountModel['id'], type: ACCOUNT_TYPES.system, bankSeamAt: null });
const seam = makeAccount({ id: 'seam' as AccountModel['id'], type: ACCOUNT_TYPES.monobank, bankSeamAt: SEAM });
const seam2 = makeAccount({ id: 'seam2' as AccountModel['id'], type: ACCOUNT_TYPES.enableBanking, bankSeamAt: SEAM });
const bank = makeAccount({ id: 'bank' as AccountModel['id'], type: ACCOUNT_TYPES.monobank, bankSeamAt: null });
const accountsRecord = { manual, seam, seam2, bank };

describe('getCsvTargetableAccounts', () => {
  it('appends bank-linked accounts with a seam and leaves other bank accounts out', () => {
    expect(getCsvTargetableAccounts({ importLinkableAccounts: [manual], accounts: [manual, seam, bank] })).toEqual([
      manual,
      seam,
    ]);
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

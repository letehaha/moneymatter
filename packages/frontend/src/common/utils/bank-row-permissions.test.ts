import { OUT_OF_WALLET_ACCOUNT_MOCK } from '@/common/const';
import { ACCOUNT_TYPES } from '@bt/shared/types';
import { describe, expect, it } from 'vitest';

import {
  formatBankSeamDay,
  getBankRowPermissions,
  getBankSeamCutoff,
  isBankAccount,
  isBankLockedLeg,
  isOnBankAccount,
} from './bank-row-permissions';

const SEAM = '2026-11-01T00:00:00.000Z';
const BEFORE_SEAM = new Date(new Date(SEAM).getTime() - 1);
const AT_SEAM = new Date(SEAM);

const linkedAccount = { type: ACCOUNT_TYPES.monobank, bankSeamAt: SEAM };
const manualRow = ({ time }: { time: Date }) => ({ accountType: ACCOUNT_TYPES.system, time });
const bankRow = ({ time }: { time: Date }) => ({ accountType: ACCOUNT_TYPES.monobank, time });

const LOCKED = { canEditLockedFields: false, canDelete: false };
const OPEN = { canEditLockedFields: true, canDelete: true };

describe('getBankRowPermissions', () => {
  it('unlocks everything on a manual row dated before the seam', () => {
    expect(getBankRowPermissions({ transaction: manualRow({ time: BEFORE_SEAM }), account: linkedAccount })).toEqual(
      OPEN,
    );
  });

  it('locks a manual row dated exactly at the seam, delete included', () => {
    expect(getBankRowPermissions({ transaction: manualRow({ time: AT_SEAM }), account: linkedAccount })).toEqual(
      LOCKED,
    );
  });

  it('locks a bank-delivered row on either side of the seam', () => {
    expect(getBankRowPermissions({ transaction: bankRow({ time: BEFORE_SEAM }), account: linkedAccount })).toEqual(
      LOCKED,
    );
    expect(getBankRowPermissions({ transaction: bankRow({ time: AT_SEAM }), account: linkedAccount })).toEqual(LOCKED);
  });

  it('keeps a bank account without a seam fully locked, even for a manual row', () => {
    const account = { type: ACCOUNT_TYPES.monobank, bankSeamAt: null };
    expect(getBankRowPermissions({ transaction: manualRow({ time: BEFORE_SEAM }), account })).toEqual(LOCKED);
  });

  it('leaves a manual account fully open', () => {
    const account = { type: ACCOUNT_TYPES.system, bankSeamAt: null };
    expect(getBankRowPermissions({ transaction: manualRow({ time: AT_SEAM }), account })).toEqual(OPEN);
  });

  it('falls back to the row accountType when the account is unknown', () => {
    expect(getBankRowPermissions({ transaction: manualRow({ time: AT_SEAM }), account: undefined })).toEqual(OPEN);
    expect(getBankRowPermissions({ transaction: bankRow({ time: BEFORE_SEAM }), account: undefined })).toEqual(LOCKED);
  });

  it('locks a row whose account is unknown and whose accountType is missing', () => {
    const transaction = { accountType: undefined as unknown as ACCOUNT_TYPES, time: BEFORE_SEAM };
    expect(getBankRowPermissions({ transaction, account: undefined })).toEqual(LOCKED);
    expect(
      getBankRowPermissions({ transaction: { ...transaction, accountType: '' as ACCOUNT_TYPES }, account: undefined }),
    ).toEqual(LOCKED);
  });

  it('opens a planned row on a bank account, even when the account is unknown', () => {
    const transaction = { ...manualRow({ time: AT_SEAM }), isPlanned: true };
    expect(getBankRowPermissions({ transaction, account: { type: ACCOUNT_TYPES.monobank, bankSeamAt: null } })).toEqual(
      OPEN,
    );
    expect(getBankRowPermissions({ transaction, account: undefined })).toEqual(OPEN);
  });

  it('accepts an ISO string time', () => {
    const transaction = { accountType: ACCOUNT_TYPES.system, time: BEFORE_SEAM.toISOString() as unknown as Date };
    expect(getBankRowPermissions({ transaction, account: linkedAccount }).canEditLockedFields).toBe(true);
  });
});

describe('getBankSeamCutoff', () => {
  const manualAccount = { type: ACCOUNT_TYPES.system, bankSeamAt: null };

  it('cuts a pre-seam manual row off at the seam', () => {
    expect(
      getBankSeamCutoff({ legs: [{ transaction: manualRow({ time: BEFORE_SEAM }), account: linkedAccount }] }),
    ).toEqual(AT_SEAM);
  });

  it('leaves a manual row at the seam uncapped', () => {
    expect(
      getBankSeamCutoff({ legs: [{ transaction: manualRow({ time: AT_SEAM }), account: linkedAccount }] }),
    ).toBeUndefined();
  });

  it('leaves a bank-delivered row uncapped', () => {
    expect(
      getBankSeamCutoff({ legs: [{ transaction: bankRow({ time: BEFORE_SEAM }), account: linkedAccount }] }),
    ).toBeUndefined();
  });

  it('leaves a manual account uncapped', () => {
    expect(
      getBankSeamCutoff({ legs: [{ transaction: manualRow({ time: BEFORE_SEAM }), account: manualAccount }] }),
    ).toBeUndefined();
  });

  it('caps a transfer with one pre-seam manual leg and one manual-account leg', () => {
    expect(
      getBankSeamCutoff({
        legs: [
          { transaction: manualRow({ time: BEFORE_SEAM }), account: manualAccount },
          { transaction: manualRow({ time: BEFORE_SEAM }), account: linkedAccount },
        ],
      }),
    ).toEqual(AT_SEAM);
  });

  it('cuts a transfer between two seam accounts off at the earlier seam', () => {
    const laterSeamAccount = { type: ACCOUNT_TYPES.enableBanking, bankSeamAt: '2026-11-10T00:00:00.000Z' };
    expect(
      getBankSeamCutoff({
        legs: [
          { transaction: manualRow({ time: BEFORE_SEAM }), account: laterSeamAccount },
          { transaction: manualRow({ time: BEFORE_SEAM }), account: linkedAccount },
        ],
      }),
    ).toEqual(AT_SEAM);
  });

  it('leaves the date uncapped when the other leg is bank-locked', () => {
    expect(
      getBankSeamCutoff({
        legs: [
          { transaction: bankRow({ time: BEFORE_SEAM }), account: { type: ACCOUNT_TYPES.monobank, bankSeamAt: null } },
          { transaction: manualRow({ time: BEFORE_SEAM }), account: linkedAccount },
        ],
      }),
    ).toBeUndefined();
  });

  it('leaves a planned leg uncapped', () => {
    const transaction = { ...manualRow({ time: BEFORE_SEAM }), isPlanned: true };
    expect(getBankSeamCutoff({ legs: [{ transaction, account: linkedAccount }] })).toBeUndefined();
  });

  it('ignores a missing leg', () => {
    expect(getBankSeamCutoff({ legs: [{ transaction: undefined, account: linkedAccount }] })).toBeUndefined();
  });
});

describe('isBankLockedLeg', () => {
  it('locks a bank row and a manual row at the seam, not a pre-seam manual row', () => {
    expect(isBankLockedLeg({ transaction: bankRow({ time: BEFORE_SEAM }), account: linkedAccount })).toBe(true);
    expect(isBankLockedLeg({ transaction: manualRow({ time: AT_SEAM }), account: linkedAccount })).toBe(true);
    expect(isBankLockedLeg({ transaction: manualRow({ time: BEFORE_SEAM }), account: linkedAccount })).toBe(false);
  });

  it('falls back to the row accountType when the account is unknown, and leaves a missing leg unlocked', () => {
    expect(isBankLockedLeg({ transaction: manualRow({ time: AT_SEAM }), account: undefined })).toBe(false);
    expect(isBankLockedLeg({ transaction: bankRow({ time: BEFORE_SEAM }), account: undefined })).toBe(true);
    expect(isBankLockedLeg({ transaction: undefined, account: linkedAccount })).toBe(false);
  });
});

describe('isBankAccount', () => {
  it('tells bank accounts from manual ones and from an account without a type', () => {
    expect(isBankAccount({ account: { type: ACCOUNT_TYPES.monobank } })).toBe(true);
    expect(isBankAccount({ account: { type: ACCOUNT_TYPES.system } })).toBe(false);
    expect(isBankAccount({ account: {} as { type: ACCOUNT_TYPES } })).toBe(false);
    expect(isBankAccount({ account: OUT_OF_WALLET_ACCOUNT_MOCK })).toBe(false);
  });
});

describe('isOnBankAccount', () => {
  it('trusts a known account over the row accountType', () => {
    expect(isOnBankAccount({ transaction: bankRow({ time: AT_SEAM }), account: { type: ACCOUNT_TYPES.system } })).toBe(
      false,
    );
    expect(isOnBankAccount({ transaction: manualRow({ time: AT_SEAM }), account: linkedAccount })).toBe(true);
  });

  it('treats an unknown account as manual only when the row says system', () => {
    expect(isOnBankAccount({ transaction: manualRow({ time: AT_SEAM }), account: undefined })).toBe(false);
    expect(isOnBankAccount({ transaction: bankRow({ time: AT_SEAM }), account: undefined })).toBe(true);
    expect(isOnBankAccount({ transaction: { accountType: '' as ACCOUNT_TYPES }, account: undefined })).toBe(true);
  });
});

describe('formatBankSeamDay', () => {
  it('names only the day when the seam falls on local midnight', () => {
    expect(formatBankSeamDay({ seamAt: new Date(2026, 10, 1) })).toBe('01 Nov 2026');
  });

  it('adds the local time when the seam falls inside a local day', () => {
    expect(formatBankSeamDay({ seamAt: new Date(2026, 9, 31, 19, 0) })).toBe('31 Oct 2026, 19:00');
  });
});

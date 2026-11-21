import type { AccountGroups } from '@/common/types/models';
import { computeAccountDisplayBalances } from '@/common/utils/account-balance';
import { AccountModel } from '@bt/shared/types';

import { collectGroupAccounts } from './account-totals';

/** The balance fields the zero check reads — kept minimal so any account-like shape satisfies it. */
interface ZeroBalanceAccount {
  currentBalance: number;
  refCurrentBalance: number;
  creditLimit: number;
  refCreditLimit: number;
}

/**
 * An account reads as zero when its credit-limit-adjusted display balance — the same number
 * shown on the sidebar row — is exactly 0. Run through the shared adjustment so a credit
 * account sitting at its limit (a real, non-zero display balance) is never mistaken for empty.
 */
export const isZeroBalanceAccount = ({
  account,
  includeCreditLimit,
}: {
  account: ZeroBalanceAccount;
  includeCreditLimit: boolean;
}): boolean =>
  computeAccountDisplayBalances({
    currentBalance: account.currentBalance,
    refCurrentBalance: account.refCurrentBalance,
    creditLimit: account.creditLimit,
    refCreditLimit: account.refCreditLimit,
    includeCreditLimit,
  }).displayBalance === 0;

/**
 * Whether a group still has something to show once zero-balance accounts are hidden: true when
 * at least one account anywhere in its subtree (own accounts plus every descendant group) is
 * non-zero. A group that is all zeros is dropped entirely — folder header included.
 */
export const groupHasVisibleAccount = ({
  group,
  includeCreditLimit,
}: {
  group: AccountGroups;
  includeCreditLimit: boolean;
}): boolean =>
  collectGroupAccounts({ group }).some(
    (account: AccountModel) => !isZeroBalanceAccount({ account, includeCreditLimit }),
  );

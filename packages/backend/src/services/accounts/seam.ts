import { ACCOUNT_TYPES, type AccountExternalData } from '@bt/shared/types';
import type { Money } from '@common/types/money';
import { t } from '@i18n/index';
import { ValidationError } from '@js/errors';
import type Accounts from '@models/accounts.model';

export interface SeamAccount {
  type: ACCOUNT_TYPES;
  externalData: AccountExternalData | null;
  seamBalance: Money | null;
}

export const SEAM_ACCOUNT_ATTRIBUTES = [
  'type',
  'externalData',
  'seamBalance',
] as const satisfies readonly (keyof Accounts)[];

/** UTC midnight of the day the account was linked forward-only to a bank feed. */
export const getLinkDayStart = ({ externalData }: Pick<SeamAccount, 'externalData'>): Date | null => {
  const bankConnection = externalData?.bankConnection;
  if (!bankConnection?.linkedAt || bankConnection.linkingStrategy !== 'forward-only') return null;

  const linkedAt = new Date(bankConnection.linkedAt);
  if (Number.isNaN(linkedAt.getTime())) return null;

  return new Date(Date.UTC(linkedAt.getUTCFullYear(), linkedAt.getUTCMonth(), linkedAt.getUTCDate()));
};

/**
 * Rows dated before `seamStart` are the user's own history; the bank owns the rest.
 * Null until the seam balance is stored, which keeps the account fully locked.
 */
export const getSeam = ({ account }: { account: SeamAccount }): { seamStart: Date; seamBalance: Money } | null => {
  if (account.type === ACCOUNT_TYPES.system || account.seamBalance == null) return null;
  const seamStart = getLinkDayStart({ externalData: account.externalData });
  return seamStart ? { seamStart, seamBalance: account.seamBalance } : null;
};

export const getSeamStart = ({ account }: { account: SeamAccount }): Date | null =>
  getSeam({ account })?.seamStart ?? null;

export const isManualRowOnSeamAccount = ({
  account,
  transaction,
}: {
  account: SeamAccount;
  transaction: { accountType: ACCOUNT_TYPES };
}): boolean => !!getSeamStart({ account }) && transaction.accountType === ACCOUNT_TYPES.system;

export const isPreSeamManualRow = ({
  account,
  transaction,
}: {
  account: SeamAccount;
  transaction: { accountType: ACCOUNT_TYPES; time: Date | string };
}): boolean => {
  const seamStart = getSeamStart({ account });
  return !!seamStart && transaction.accountType === ACCOUNT_TYPES.system && new Date(transaction.time) < seamStart;
};

/** A row from the seam on counts in the bank-owned balance, so removing it would break `current = initial + Σ rows`. */
export const isRowDeletableOnAccount = ({
  account,
  transaction,
}: {
  account: SeamAccount;
  transaction: { accountType: ACCOUNT_TYPES; time: Date | string };
}): boolean => account.type === ACCOUNT_TYPES.system || isPreSeamManualRow({ account, transaction });

export const assertRowDeletableOnAccount = ({
  account,
  transaction,
}: {
  account: SeamAccount;
  transaction: { accountType: ACCOUNT_TYPES; time: Date | string };
}): void => {
  if (isRowDeletableOnAccount({ account, transaction })) return;

  const seamStart = isManualRowOnSeamAccount({ account, transaction }) ? getSeamStart({ account }) : null;
  throw new ValidationError({
    message: seamStart
      ? t({
          key: 'transactions.manualRowOnOrAfterLinkDay',
          variables: { date: seamStart.toISOString().slice(0, 10) },
        })
      : t({ key: 'transactions.cannotDeleteExternal' }),
  });
};

/**
 * Throws unless `transaction` is a manual row dated before the seam, the only row a
 * bank-linked account lets the user change. A new `nextTime` must stay before it.
 */
export const assertPreSeamManualRow = ({
  account,
  transaction,
  nextTime,
  isOppositeLeg = false,
}: {
  account: SeamAccount;
  transaction: { accountType: ACCOUNT_TYPES; time: Date | string };
  nextTime?: Date | string;
  isOppositeLeg?: boolean;
}): void => {
  const seamStart = getSeamStart({ account });
  let message: string | undefined;
  if (!seamStart || transaction.accountType !== ACCOUNT_TYPES.system) {
    message = t({ key: 'transactions.editReadonlyFields' });
  } else if (!(new Date(transaction.time) < seamStart)) {
    message = t({
      key: 'transactions.manualRowOnOrAfterLinkDay',
      variables: { date: seamStart.toISOString().slice(0, 10) },
    });
  } else if (nextTime !== undefined && !(new Date(nextTime) < seamStart)) {
    message = t({ key: 'transactions.preSeamTimeOnOrAfterLinkDay' });
  }
  if (!message) return;

  throw new ValidationError({ message: isOppositeLeg ? t({ key: 'transactions.oppositeLegOnBankAccount' }) : message });
};

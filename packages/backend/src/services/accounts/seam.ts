import { ACCOUNT_TYPES } from '@bt/shared/types';
import type { Money } from '@common/types/money';
import { t } from '@i18n/index';
import { ValidationError } from '@js/errors';
import type Accounts from '@models/accounts.model';

export const SEAM_ACCOUNT_ATTRIBUTES = [
  'type',
  'externalData',
  'seamBalance',
] as const satisfies readonly (keyof Accounts)[];

export type SeamAccount = Pick<Accounts, (typeof SEAM_ACCOUNT_ATTRIBUTES)[number]>;

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

export const isBeforeSeamStart = ({ seamStart, time }: { seamStart: Date; time: Date | string }): boolean =>
  new Date(time) < seamStart;

export const isBeforeSeam = ({ account, time }: { account: SeamAccount; time: Date | string }): boolean => {
  const seamStart = getSeamStart({ account });
  return !!seamStart && isBeforeSeamStart({ seamStart, time });
};

const linkDay = ({ seamStart }: { seamStart: Date }) => ({ date: seamStart.toISOString().slice(0, 10) });

/** `isNewRow` for a row entering the account (create, restore, planned flip, move), not an edit or delete. */
export const manualRowOnOrAfterLinkDayMessage = ({
  seamStart,
  isNewRow = false,
}: {
  seamStart: Date;
  isNewRow?: boolean;
}): string =>
  t({
    key: isNewRow ? 'transactions.manualRowOnOrAfterLinkDayCreate' : 'transactions.manualRowOnOrAfterLinkDay',
    variables: linkDay({ seamStart }),
  });

export const preSeamTimeOnOrAfterLinkDayMessage = ({ seamStart }: { seamStart: Date }): string =>
  t({ key: 'transactions.preSeamTimeOnOrAfterLinkDay', variables: linkDay({ seamStart }) });

/** Why a real manual row can't land on a bank account at `time`. */
export const manualRowOnBankAccountMessage = ({
  account,
  time,
}: {
  account: SeamAccount;
  time: Date | string;
}): string => {
  const seamStart = getSeamStart({ account });
  return seamStart && !isBeforeSeam({ account, time })
    ? manualRowOnOrAfterLinkDayMessage({ seamStart, isNewRow: true })
    : t({ key: 'transactions.manualOnConnectedAccount' });
};

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
}): boolean => transaction.accountType === ACCOUNT_TYPES.system && isBeforeSeam({ account, time: transaction.time });

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
      ? manualRowOnOrAfterLinkDayMessage({ seamStart })
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
    message = t({ key: isOppositeLeg ? 'transactions.oppositeLegOnBankAccount' : 'transactions.editReadonlyFields' });
  } else if (!isBeforeSeam({ account, time: transaction.time })) {
    message = manualRowOnOrAfterLinkDayMessage({ seamStart });
  } else if (nextTime !== undefined && !isBeforeSeam({ account, time: nextTime })) {
    message = preSeamTimeOnOrAfterLinkDayMessage({ seamStart });
  }
  if (message) throw new ValidationError({ message });
};

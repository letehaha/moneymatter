import { ACCOUNT_TYPES } from '@bt/shared/types';
import { removeUndefinedKeys } from '@js/helpers';
import Accounts from '@models/accounts.model';
import { namespace } from '@models/connection';

/**
 * Reads an account row under a row lock inside the ambient CLS transaction so a
 * read-modify-write of its balance serializes against concurrent writers.
 *
 * `noKey` picks FOR NO KEY UPDATE. Use it from paths that run after a row
 * referencing the account was inserted in the same request: that insert already
 * holds FOR KEY SHARE on the account through its foreign key, and FOR UPDATE
 * conflicts with it, so two concurrent inserts would deadlock each other.
 */
export const lockAccountRow = async ({
  accountId,
  userId,
  noKey = false,
}: {
  accountId: string;
  userId?: number;
  noKey?: boolean;
}): Promise<Accounts | null> => {
  const sequelizeTx = namespace.get('transaction');
  return Accounts.findOne({
    where: removeUndefinedKeys({ id: accountId, userId }),
    transaction: sequelizeTx,
    lock: noKey ? sequelizeTx?.LOCK.NO_KEY_UPDATE : sequelizeTx?.LOCK.UPDATE,
  });
};

/** Bank-linked, and when given, still to this connection and external account. */
export const isLinkedToBank = ({
  account,
  connectionId,
  externalId,
}: {
  account: Pick<Accounts, 'type' | 'bankDataProviderConnectionId' | 'externalId'> | null;
  connectionId?: string;
  externalId?: string | null;
}): boolean =>
  !!account &&
  account.type !== ACCOUNT_TYPES.system &&
  !!account.bankDataProviderConnectionId &&
  (connectionId === undefined || account.bankDataProviderConnectionId === connectionId) &&
  (externalId == null || account.externalId === externalId);

/**
 * Locks the account for a sync's write phase and returns it only while it is still linked to
 * the syncing connection. Unlink takes the same row lock, so a sync that sees the link here
 * commits its rows before the unlink retypes them, and one that doesn't writes nothing.
 */
export const lockLinkedBankAccount = async ({
  accountId,
  connectionId,
  externalId,
}: {
  accountId: string;
  connectionId: string;
  externalId?: string | null;
}): Promise<Accounts | null> => {
  const account = await lockAccountRow({ accountId, noKey: true });
  return isLinkedToBank({ account, connectionId, externalId }) ? account : null;
};

import { hasAccountWriteAccess } from '@/composable/use-account-access';
import { type AccountModel, TRANSACTION_TRANSFER_NATURE } from '@bt/shared/types';

import type { TransferDestinationType } from '../composables/transfer-form';
import { isConnectedAccount, isOutOfWalletAccount } from '../helpers';
import { FORM_TYPES, type UI_FORM_STRUCT } from '../types';

const includesAccount = ({ accounts, account }: { accounts: Pick<AccountModel, 'id'>[]; account: AccountModel }) =>
  accounts.some((item) => item.id === account.id);

// A copy must be one the user could create by hand in the Add form: its accounts come from the
// same pickers it offers, and the backend needs write access to a transfer destination.
export const canDuplicateTransaction = ({
  transferNature,
  form,
  transferDestinationType,
  hasLockedLeg,
  hasOppositeTransaction,
  sourceAccounts,
  plannedAccounts,
  destinationAccounts,
}: {
  transferNature: TRANSACTION_TRANSFER_NATURE | undefined;
  form: Pick<UI_FORM_STRUCT, 'type' | 'account' | 'toAccount' | 'isPlanned'>;
  transferDestinationType: TransferDestinationType;
  /** A leg is bank-connected or linked to an existing transaction. */
  hasLockedLeg: boolean;
  hasOppositeTransaction: boolean;
  sourceAccounts: Pick<AccountModel, 'id'>[];
  plannedAccounts: Pick<AccountModel, 'id'>[];
  destinationAccounts: Pick<AccountModel, 'id'>[];
}): boolean => {
  const { account, toAccount } = form;
  if (!account) return false;
  const isTransferForm = form.type === FORM_TYPES.transfer;

  if (transferNature === TRANSACTION_TRANSFER_NATURE.not_transfer) {
    if (isTransferForm) return false;
    const isPlanned = form.isPlanned || isConnectedAccount({ account });
    return includesAccount({ accounts: isPlanned ? plannedAccounts : sourceAccounts, account });
  }

  const isOutOfWalletTransfer = transferNature === TRANSACTION_TRANSFER_NATURE.transfer_out_wallet;
  if (transferNature !== TRANSACTION_TRANSFER_NATURE.common_transfer && !isOutOfWalletTransfer) return false;
  if (!isTransferForm || transferDestinationType !== 'account' || hasLockedLeg) return false;
  if (!isOutOfWalletTransfer && !hasOppositeTransaction) return false;
  if (!toAccount) return false;

  const isSourceOutOfWallet = !!isOutOfWalletAccount(account);
  const isDestinationOutOfWallet = !!isOutOfWalletAccount(toAccount);
  if (isSourceOutOfWallet && isDestinationOutOfWallet) return false;

  const isSourceAllowed = isSourceOutOfWallet || includesAccount({ accounts: sourceAccounts, account });
  const isDestinationAllowed =
    isDestinationOutOfWallet ||
    (includesAccount({ accounts: destinationAccounts, account: toAccount }) &&
      hasAccountWriteAccess({ account: toAccount }));
  return isSourceAllowed && isDestinationAllowed;
};

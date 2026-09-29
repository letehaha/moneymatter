import { TRANSACTION_TRANSFER_NATURE } from '../types/enums';

const IS_LINKED_NATURE = {
  [TRANSACTION_TRANSFER_NATURE.not_transfer]: false,
  [TRANSACTION_TRANSFER_NATURE.common_transfer]: true,
  [TRANSACTION_TRANSFER_NATURE.transfer_out_wallet]: false,
  [TRANSACTION_TRANSFER_NATURE.transfer_to_portfolio]: true,
  [TRANSACTION_TRANSFER_NATURE.transfer_to_venture]: true,
  [TRANSACTION_TRANSFER_NATURE.transfer_to_loan]: true,
} satisfies Record<TRANSACTION_TRANSFER_NATURE, boolean>;

/** Natures of a transaction already linked as a transfer; `transfer_out_wallet` can still be re-linked. */
export const LINKED_TRANSFER_NATURES: readonly TRANSACTION_TRANSFER_NATURE[] = (
  Object.keys(IS_LINKED_NATURE) as TRANSACTION_TRANSFER_NATURE[]
).filter((nature) => IS_LINKED_NATURE[nature]);

export const isLinkedTransfer = ({
  tx,
}: {
  tx: { transferId: string | null; transferNature: TRANSACTION_TRANSFER_NATURE };
}) => tx.transferId != null || LINKED_TRANSFER_NATURES.includes(tx.transferNature);

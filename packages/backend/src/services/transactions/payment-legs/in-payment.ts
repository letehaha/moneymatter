import { t } from '@i18n/index';
import { ValidationError } from '@js/errors';
import type { PaymentLinkSnapshot, TransactionsAttributes } from '@models/transactions.model';
import { Op } from 'sequelize';

import { findPaymentRows } from './find-payment-rows';

type LinkState = Pick<TransactionsAttributes, 'paymentParentId' | 'paymentLinkSnapshot'>;

/**
 * An existing row the user linked into a payment, as opposed to one the payment created.
 * Positional because a type predicate can't narrow a destructured param.
 */
export const isLinkedLeg = <T extends LinkState>(
  tx: T,
): tx is T & { paymentParentId: string; paymentLinkSnapshot: PaymentLinkSnapshot } =>
  Boolean(tx.paymentParentId && tx.paymentLinkSnapshot);

/** The ids among `transactionIds` that are a payment's extra row or a main row holding any. */
export const findIdsInPayments = async ({ transactionIds }: { transactionIds: string[] }) => {
  if (!transactionIds.length) return [];
  const rows = await findPaymentRows({
    where: {
      [Op.or]: [
        { id: { [Op.in]: transactionIds }, paymentParentId: { [Op.ne]: null } },
        { paymentParentId: { [Op.in]: transactionIds } },
      ],
    },
    attributes: ['id', 'paymentParentId'],
  });
  const inPayment = new Set<string>(rows.flatMap((row) => [row.id, row.paymentParentId!]));
  return transactionIds.filter((id) => inPayment.has(id));
};

/** `transactionIds` with each leg swapped for its main row, deduped: writes to shared fields land on the main. */
export const redirectLegsToMains = async ({ transactionIds }: { transactionIds: string[] }) => {
  if (!transactionIds.length) return [];
  const legs = await findPaymentRows({
    where: { id: { [Op.in]: transactionIds }, paymentParentId: { [Op.ne]: null } },
    attributes: ['id', 'paymentParentId'],
  });
  const mainIdByLegId = new Map<string, string>(legs.map((leg) => [leg.id, leg.paymentParentId!]));
  return [...new Set(transactionIds.map((id) => mainIdByLegId.get(id) ?? id))];
};

export const assertNotInPayment = async ({ transactionIds }: { transactionIds: string[] }) => {
  if ((await findIdsInPayments({ transactionIds })).length) {
    throw new ValidationError({ message: t({ key: 'transactions.inPaymentNotAllowed' }) });
  }
};

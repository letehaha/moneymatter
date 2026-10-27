import type { TransactionPaymentPart } from '@bt/shared/types';
import { Money } from '@common/types/money';
import { logger } from '@js/utils/logger';
import { Op } from 'sequelize';

import { findPaymentRows } from './find-payment-rows';
import { isLinkedLeg } from './in-payment';

export type PaymentPart = Omit<TransactionPaymentPart, 'amount' | 'paymentAmount'> & {
  amount: Money;
  paymentAmount: Money;
};

/**
 * Adds `paymentParts` (main first) to every row of a multi-account payment, keeping only the
 * row itself and the parts on `accessibleAccountIds`. With `collapsed` the caller hides the
 * legs, so each main row also gets `paymentTotal` of its kept parts.
 */
export const attachPaymentParts = async <T extends { id: string; paymentParentId?: string | null }>({
  transactions,
  collapsed,
  accessibleAccountIds,
}: {
  transactions: T[];
  collapsed: boolean;
  accessibleAccountIds: string[];
}): Promise<(T & { paymentParts?: PaymentPart[]; paymentTotal?: Money })[]> => {
  if (!transactions.length) return transactions;

  const mainIds = [...new Set(transactions.map((tx) => tx.paymentParentId ?? tx.id))];
  // Unscoped, so parts on accounts the caller can't access are filtered out below.
  const legs = await findPaymentRows({
    where: { paymentParentId: { [Op.in]: mainIds } },
    attributes: [
      'id',
      'accountId',
      'amount',
      'currencyCode',
      'paymentAmount',
      'paymentLinkSnapshot',
      'paymentParentId',
    ],
    order: [['createdAt', 'ASC']],
  });
  if (!legs.length) return transactions;

  const mains = await findPaymentRows({
    where: { id: { [Op.in]: [...new Set(legs.map((leg) => leg.paymentParentId!))] } },
    attributes: ['id', 'accountId', 'amount', 'currencyCode'],
  });

  const partsByMainId = new Map<string, PaymentPart[]>(
    mains.map((main) => [
      main.id,
      [
        {
          transactionId: main.id,
          accountId: main.accountId,
          amount: main.amount,
          currencyCode: main.currencyCode,
          paymentAmount: main.amount,
          isLinked: false,
        },
      ],
    ]),
  );
  for (const leg of legs) {
    const parts = partsByMainId.get(leg.paymentParentId!);
    if (!parts) {
      logger.warn('[payment-legs] leg points at a missing main row', { legId: leg.id, mainId: leg.paymentParentId });
      continue;
    }
    parts.push({
      transactionId: leg.id,
      accountId: leg.accountId,
      amount: leg.amount,
      currencyCode: leg.currencyCode,
      paymentAmount: leg.paymentAmount ?? leg.amount,
      isLinked: isLinkedLeg(leg),
    });
  }

  const accessible = new Set(accessibleAccountIds);
  return transactions.map((tx) => {
    const parts = partsByMainId
      .get(tx.paymentParentId ?? tx.id)
      ?.filter((part) => part.transactionId === tx.id || accessible.has(part.accountId));
    if (!parts || parts.length < 2) return tx;

    const isMain = !tx.paymentParentId;
    return Object.assign(tx, {
      paymentParts: parts,
      ...(collapsed && isMain && { paymentTotal: Money.sum(parts.map((part) => part.paymentAmount)) }),
    });
  });
};

import Categories from '@models/categories.model';
import Payees from '@models/payees.model';
import Tags from '@models/tags.model';
import { findTransactions } from '@models/transactions-query';
import * as Transactions from '@models/transactions.model';
import { getUserDefaultCategory } from '@models/users.model';
import { Op, WhereOptions } from 'sequelize';

import { findPaymentRows } from './find-payment-rows';
import { isLinkedLeg } from './in-payment';

export const pickLinkFields = ({ row }: { row: Transactions.PaymentLinkFields }) =>
  Object.fromEntries(
    Transactions.PAYMENT_LINK_FIELDS.map((field) => [field, row[field]]),
  ) as Transactions.PaymentLinkFields;

/** Turns a linked row back into a standalone one, restoring the snapshot values that still resolve. */
export const unlinkPaymentLeg = async ({
  leg,
}: {
  leg: Transactions.default & { paymentLinkSnapshot: Transactions.PaymentLinkSnapshot };
}) => {
  const snapshot = leg.paymentLinkSnapshot;
  const userId = leg.userId;

  const [category, payee, tags] = await Promise.all([
    snapshot.categoryId ? Categories.findOne({ where: { id: snapshot.categoryId, userId }, attributes: ['id'] }) : null,
    snapshot.payeeId ? Payees.findOne({ where: { id: snapshot.payeeId, userId }, attributes: ['id'] }) : null,
    snapshot.tagIds.length
      ? Tags.findAll({ where: { id: { [Op.in]: snapshot.tagIds }, userId }, attributes: ['id'] })
      : [],
  ]);

  const updated = await Transactions.updateTransactionById({
    id: leg.id,
    userId,
    ...pickLinkFields({ row: snapshot }),
    // Never keep the main's category: on a shared account it can belong to another user.
    categoryId: category?.id ?? (await getUserDefaultCategory({ id: userId })),
    payeeId: payee?.id ?? null,
    paymentParentId: null,
    paymentAmount: null,
    paymentLinkSnapshot: null,
  });
  await updated.$set(
    'tags',
    tags.map((tag) => tag.id),
  );
};

export const unlinkPaymentLegs = async ({ where }: { where: WhereOptions<Transactions.default> }) => {
  const legs = await findPaymentRows({
    where: { ...where, paymentParentId: { [Op.ne]: null }, paymentLinkSnapshot: { [Op.ne]: null } },
  });
  for (const leg of legs.filter(isLinkedLeg)) await unlinkPaymentLeg({ leg });
};

/**
 * Run before rows on `accountIds` are removed. The other rows of a payment whose main row sits
 * there become standalone: linked ones get their own details back, created ones stay as they are.
 */
export const unlinkPaymentLegsOfAccounts = async ({ userId, accountIds }: { userId: number; accountIds: string[] }) => {
  // Every row of a payment sits on an account owned by its main row's owner.
  const legs = await findTransactions({
    planned: 'include',
    access: { accountOwner: userId },
    balanceAdjustments: 'include',
    completeness: 'all',
    where: { paymentParentId: { [Op.ne]: null } },
  });
  if (!legs.length) return;

  const mains = await findPaymentRows({
    where: {
      id: { [Op.in]: [...new Set(legs.map((leg) => leg.paymentParentId!))] },
      accountId: { [Op.in]: accountIds },
    },
    attributes: ['id'],
  });
  const mainIds = new Set(mains.map((main) => main.id));

  for (const leg of legs) {
    if (!mainIds.has(leg.paymentParentId!)) continue;
    if (isLinkedLeg(leg)) await unlinkPaymentLeg({ leg });
    else {
      await Transactions.updateTransactionById({
        id: leg.id,
        userId: leg.userId,
        paymentParentId: null,
        paymentAmount: null,
        payeeLocked: false,
      });
    }
  }
};

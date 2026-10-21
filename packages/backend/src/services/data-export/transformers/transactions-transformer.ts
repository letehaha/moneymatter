import { RecordId, TRANSACTION_TRANSFER_NATURE, TRANSACTION_TYPES } from '@bt/shared/types';
import { logger } from '@js/utils';
import Accounts from '@models/accounts.model';
import Categories from '@models/categories.model';
import Payees from '@models/payees.model';
import RefundTransactions from '@models/refund-transactions.model';
import SubscriptionTransactions from '@models/subscription-transactions.model';
import Subscriptions from '@models/subscriptions.model';
import Tags from '@models/tags.model';
import TransactionSplits from '@models/transaction-splits.model';
import TransactionTags from '@models/transaction-tags.model';
import { findTransactions } from '@models/transactions-query';
import Transactions from '@models/transactions.model';
import { Op } from 'sequelize';

import type { ExportDateRange, TransactionRow } from '../types';
import { buildAccountIdsClause, buildDateRangeClause, resolveRelationName } from './utils';

interface CategoryView {
  id: string;
  name: string;
  parentName: string | null;
}

function deriveExportType({ tx }: { tx: Transactions }): 'income' | 'expense' | 'transfer_in' | 'transfer_out' {
  const isTransfer = tx.transferNature === TRANSACTION_TRANSFER_NATURE.common_transfer;
  if (isTransfer) {
    return tx.transactionType === TRANSACTION_TYPES.income ? 'transfer_in' : 'transfer_out';
  }
  return tx.transactionType === TRANSACTION_TYPES.income ? 'income' : 'expense';
}

function fmtAmount({ value }: { value: number }): string {
  return value.toFixed(2);
}

/**
 * Compact, deterministic identifier for cross-referencing transactions in the
 * export (refund pairs, transfer pairs). We deliberately avoid leaking raw UUIDs
 * – the export is human-readable, and a row like
 * `"2025-12-04 Chase Checking -45.20 USD"` tells the reader exactly which other
 * row to find without a lookup table.
 */
function describeTransaction({ tx, accountName }: { tx: Transactions; accountName: string }): string {
  const date = tx.time instanceof Date ? tx.time.toISOString().slice(0, 10) : String(tx.time).slice(0, 10);
  const amount = fmtAmount({ value: tx.amount.toNumber() });
  const signed = tx.transactionType === TRANSACTION_TYPES.income ? amount : `-${amount}`;
  return `${date} ${accountName} ${signed} ${tx.currencyCode}`;
}

export async function transformTransactions({
  userId,
  dateRange,
  accountIds: accountIdsFilter,
}: {
  userId: number;
  dateRange?: ExportDateRange;
  accountIds?: RecordId[];
}): Promise<TransactionRow[]> {
  // An export is the user's own copy of their data: everything they can see in the app
  // ships, plans included (the row carries an `isPlanned` column so they stay readable
  // as plans), balance adjustments included.
  const transactions = await findTransactions({
    where: {
      ...buildDateRangeClause({ field: 'time', dateRange }),
      ...buildAccountIdsClause({ field: 'accountId', accountIds: accountIdsFilter }),
    },
    planned: 'include',
    access: { creator: userId },
    balanceAdjustments: 'include',
    completeness: 'all',
    order: [['time', 'ASC']],
  });
  if (transactions.length === 0) return [];

  const txIds = transactions.map((t) => t.id);
  const accountIds = [...new Set(transactions.map((t) => t.accountId).filter((id): id is RecordId => Boolean(id)))];
  const categoryIds = [...new Set(transactions.map((t) => t.categoryId).filter((id): id is RecordId => Boolean(id)))];
  const payeeIds = [...new Set(transactions.map((t) => t.payeeId).filter((id): id is RecordId => Boolean(id)))];

  const [accounts, categories, payees, splits, tagLinks, allTags, refundLinks, subLinks] = await Promise.all([
    // Scope the account lookup to the current user so a stray cross-user
    // accountId (legacy data, future cross-account share, malformed row)
    // cannot leak another user's account name into the export's Account
    // column. Every other transformer in this module follows the same shape.
    accountIds.length
      ? Accounts.findAll({ where: { userId, id: { [Op.in]: accountIds } }, attributes: ['id', 'name'] })
      : Promise.resolve([] as Accounts[]),
    Categories.findAll({ where: { userId }, attributes: ['id', 'name', 'parentId'] }),
    payeeIds.length
      ? Payees.findAll({ where: { userId, id: { [Op.in]: payeeIds } }, attributes: ['id', 'name'] })
      : Promise.resolve([] as Payees[]),
    TransactionSplits.findAll({ where: { transactionId: { [Op.in]: txIds } } }),
    TransactionTags.findAll({ where: { transactionId: { [Op.in]: txIds } } }),
    Tags.findAll({ where: { userId }, attributes: ['id', 'name'] }),
    RefundTransactions.findAll({ where: { userId } }),
    SubscriptionTransactions.findAll({ where: { transactionId: { [Op.in]: txIds } } }),
  ]);

  const accountNameById = new Map(accounts.map((a) => [String(a.id), a.name]));
  const payeeNameById = new Map(payees.map((p) => [String(p.id), p.name]));
  const tagNameById = new Map(allTags.map((t) => [t.id, t.name]));

  const categoryViewById = new Map<string, CategoryView>();
  for (const cat of categories) {
    categoryViewById.set(cat.id, { id: cat.id, name: cat.name, parentName: null });
  }
  for (const cat of categories) {
    if (cat.parentId) {
      const view = categoryViewById.get(cat.id);
      const parent = categoryViewById.get(cat.parentId);
      if (view && parent) view.parentName = parent.name;
    }
  }
  // Resolve referenced categories that don't belong to the user (e.g. share recipient
  // transactions attributed to an owner-only category). Don't synthesize a fake row
  // – we just leave the lookup as undefined and emit an empty subcategory cell.
  if (categoryIds.length) {
    const missing = categoryIds.filter((id) => !categoryViewById.has(id));
    if (missing.length) {
      const externalCats = await Categories.findAll({
        where: { id: { [Op.in]: missing } },
        attributes: ['id', 'name', 'parentId'],
      });
      for (const cat of externalCats) {
        categoryViewById.set(cat.id, { id: cat.id, name: cat.name, parentName: null });
      }
    }
  }

  // Per-tx aggregations
  const splitsByTxId = new Map<string, TransactionSplits[]>();
  for (const split of splits) {
    const list = splitsByTxId.get(split.transactionId) ?? [];
    list.push(split);
    splitsByTxId.set(split.transactionId, list);
  }

  const tagNamesByTxId = new Map<string, string[]>();
  for (const link of tagLinks) {
    const name = tagNameById.get(link.tagId);
    if (!name) {
      logger.warn(
        `Data export: transaction ${link.transactionId} references missing tag ${link.tagId}; dropping from tags column.`,
      );
      continue;
    }
    const list = tagNamesByTxId.get(link.transactionId) ?? [];
    list.push(name);
    tagNamesByTxId.set(link.transactionId, list);
  }

  // refundLinks: row { originalTxId, refundTxId }. The refund row needs to point
  // back at its original; the original row should optionally show "refunded by".
  // For the export we only fill RefundOf on the refund side – surfacing both
  // directions doubles the cell noise without adding information.
  const refundOriginalByRefundId = new Map<string, RecordId>();
  for (const link of refundLinks) {
    if (link.refundTxId && link.originalTxId) {
      refundOriginalByRefundId.set(String(link.refundTxId), link.originalTxId);
    }
  }

  // Transfer pairs share a transferId. For a given tx, find the other tx with
  // the same transferId (the counterparty leg of the transfer).
  const txsByTransferId = new Map<string, Transactions[]>();
  for (const tx of transactions) {
    if (tx.transferNature === TRANSACTION_TRANSFER_NATURE.common_transfer && tx.transferId) {
      const list = txsByTransferId.get(tx.transferId) ?? [];
      list.push(tx);
      txsByTransferId.set(tx.transferId, list);
    }
  }

  const txById = new Map(transactions.map((t) => [t.id, t]));

  // An account filter fetches only one side of a transfer or refund pair, so the
  // counterparts are pulled in for the LinkedTransfer/RefundOf lookups alone –
  // adding them to `transactions` would export rows the filter excluded.
  if (accountIdsFilter) {
    const lonelyTransferIds = [...txsByTransferId.entries()]
      .filter(([, legs]) => legs.length < 2)
      .map(([transferId]) => transferId);
    const missingOriginalIds: RecordId[] = [];
    for (const tx of transactions) {
      const originalId = refundOriginalByRefundId.get(String(tx.id));
      if (originalId && !txById.has(originalId)) missingOriginalIds.push(originalId);
    }

    if (lonelyTransferIds.length || missingOriginalIds.length) {
      const counterparts = await findTransactions({
        where: {
          [Op.or]: [
            ...(lonelyTransferIds.length ? [{ transferId: { [Op.in]: lonelyTransferIds } }] : []),
            ...(missingOriginalIds.length ? [{ id: { [Op.in]: missingOriginalIds } }] : []),
          ],
        },
        planned: 'include',
        access: { creator: userId },
        balanceAdjustments: 'include',
        completeness: 'all',
      });

      for (const tx of counterparts) {
        if (txById.has(tx.id)) continue;
        txById.set(tx.id, tx);
        if (tx.transferNature === TRANSACTION_TRANSFER_NATURE.common_transfer && tx.transferId) {
          txsByTransferId.set(tx.transferId, [...(txsByTransferId.get(tx.transferId) ?? []), tx]);
        }
      }

      const extraAccountIds = [
        ...new Set(
          counterparts
            .map((t) => t.accountId)
            .filter((id): id is RecordId => Boolean(id) && !accountNameById.has(String(id))),
        ),
      ];
      if (extraAccountIds.length) {
        const extraAccounts = await Accounts.findAll({
          where: { userId, id: { [Op.in]: extraAccountIds } },
          attributes: ['id', 'name'],
        });
        for (const account of extraAccounts) accountNameById.set(String(account.id), account.name);
      }
    }
  }

  // Subscriptions linked to transactions. The `userId` clause is defensive:
  // subscription_transactions should only ever link rows owned by the same
  // user, but a wrong-direction link would silently leak another user's
  // subscription name into this export.
  const subIds = [...new Set(subLinks.map((l) => l.subscriptionId))];
  const subs = subIds.length
    ? await Subscriptions.findAll({ where: { userId, id: { [Op.in]: subIds } }, attributes: ['id', 'name'] })
    : [];
  const subNameById = new Map(subs.map((s) => [s.id, s.name]));
  const subNameByTxId = new Map<string, string>();
  for (const link of subLinks) {
    const name = subNameById.get(link.subscriptionId);
    if (!name) {
      logger.warn(
        `Data export: subscription_transaction link references missing subscription ${link.subscriptionId}; dropping from subscription column.`,
      );
      continue;
    }
    subNameByTxId.set(link.transactionId, name);
  }

  const resolveCategoryName = ({ id, context }: { id: RecordId; context: string }): string => {
    const view = categoryViewById.get(String(id));
    if (view) return view.name;
    logger.warn(
      `Data export: category reference ${id} could not be resolved (context=${context}); emitting unresolved sentinel.`,
    );
    return '(unresolved category)';
  };

  const resolveAccountName = ({ id, context }: { id: RecordId | null | undefined; context: string }): string =>
    id
      ? resolveRelationName({
          id: String(id),
          nameById: accountNameById,
          relation: 'account',
          context,
        })
      : '';

  return transactions.map((tx): TransactionRow => {
    const accountName = resolveAccountName({ id: tx.accountId, context: `transaction ${tx.id}` });
    const view = tx.categoryId ? categoryViewById.get(tx.categoryId) : undefined;
    let categoryName: string;
    let subcategoryName: string;
    if (!tx.categoryId) {
      categoryName = '';
      subcategoryName = '';
    } else if (!view) {
      // FK set but the category row is missing – emit the sentinel so the
      // reader can see the gap instead of a blank cell.
      categoryName = resolveCategoryName({ id: tx.categoryId, context: `transaction ${tx.id}` });
      subcategoryName = '';
    } else {
      categoryName = view.parentName ?? view.name;
      subcategoryName = view.parentName ? view.name : '';
    }

    const txSplits = splitsByTxId.get(tx.id) ?? [];
    const splitsForJson = txSplits.length
      ? txSplits.map((s) => ({
          category: resolveCategoryName({ id: s.categoryId, context: `transaction ${tx.id} split ${s.id}` }),
          amount: s.amount.toNumber(),
          note: s.note ?? '',
        }))
      : null;
    const splitDetails = txSplits.length
      ? txSplits
          .map((s) => {
            const catName = resolveCategoryName({
              id: s.categoryId,
              context: `transaction ${tx.id} split ${s.id}`,
            });
            return `${catName}: ${fmtAmount({ value: s.amount.toNumber() })}`;
          })
          .join(' | ')
      : '';

    let refundOf = '';
    const originalId = refundOriginalByRefundId.get(String(tx.id));
    if (originalId) {
      const original = txById.get(originalId);
      if (original) {
        const originalAccountName = resolveAccountName({
          id: original.accountId,
          context: `transaction ${tx.id} refund-of`,
        });
        refundOf = describeTransaction({ tx: original, accountName: originalAccountName });
      }
    }

    let linkedTransfer = '';
    if (tx.transferId) {
      const pair = (txsByTransferId.get(tx.transferId) ?? []).find((other) => other.id !== tx.id);
      if (pair) {
        const pairAccountName = resolveAccountName({
          id: pair.accountId,
          context: `transaction ${tx.id} transfer-pair`,
        });
        linkedTransfer = describeTransaction({ tx: pair, accountName: pairAccountName });
      }
    }

    return {
      date: tx.time instanceof Date ? tx.time.toISOString().slice(0, 10) : String(tx.time).slice(0, 10),
      time: tx.time instanceof Date ? tx.time.toISOString().slice(11, 19) : '',
      account: accountName,
      type: deriveExportType({ tx }),
      paymentType: tx.paymentType,
      category: categoryName,
      subcategory: subcategoryName,
      payee: resolveRelationName({
        id: tx.payeeId,
        nameById: payeeNameById,
        relation: 'payee',
        context: `transaction ${tx.id}`,
      }),
      amount: tx.amount.toNumber(),
      currency: tx.currencyCode ?? '',
      amountInBaseCurrency: tx.refAmount?.toNumber() ?? null,
      baseCurrency: tx.refCurrencyCode ?? '',
      note: tx.note ?? '',
      externalUrl: tx.externalUrl ?? '',
      externalReference: tx.externalReference ?? '',
      location: tx.location ? `${tx.location.latitude},${tx.location.longitude}` : '',
      tags: tagNamesByTxId.get(tx.id) ?? [],
      splitDetails,
      splits: splitsForJson,
      refundOf,
      linkedTransfer,
      subscription: subNameByTxId.get(tx.id) ?? '',
      isPlanned: tx.isPlanned,
    };
  });
}

import type { RecordId } from '@bt/shared/types';
import type { ReconciliationRestoreResponse } from '@bt/shared/types/endpoints';
import { t } from '@i18n/index';
import { NotFoundError } from '@js/errors';
import Accounts from '@models/accounts.model';
import { findTransactions, updateTransactions } from '@models/transactions-query';
import { withTransaction } from '@services/common/with-transaction';
import { Op } from 'sequelize';

import { rejectIfAny } from './helpers';

export const restoreTransactions = withTransaction(
  async ({
    userId,
    transactionIds,
  }: {
    userId: number;
    transactionIds: RecordId[];
  }): Promise<ReconciliationRestoreResponse> => {
    const rows = await findTransactions({
      where: { id: { [Op.in]: transactionIds }, deletedAt: { [Op.ne]: null } },
      paranoid: false,
      planned: 'include',
      access: { creator: userId },
      balanceAdjustments: 'include',
      completeness: 'all',
      lock: true,
    });

    if (rows.length !== transactionIds.length) {
      throw new NotFoundError({ message: t({ key: 'transactions.notFound' }) });
    }

    const accounts = await Accounts.findAll({
      where: { id: { [Op.in]: [...new Set(rows.map((row) => row.accountId))] }, userId },
      attributes: ['id', 'type'],
    });
    const accountTypeById = new Map(accounts.map((account) => [account.id, account.type]));
    rejectIfAny({
      rows: rows.filter((row) => accountTypeById.get(row.accountId) !== row.accountType),
      key: 'transactions.reconciliation.accountDisconnected',
    });

    await updateTransactions({
      values: { deletedAt: null, mergedIntoId: null },
      where: { id: { [Op.in]: transactionIds } },
      paranoid: false,
      planned: 'include',
      access: { creator: userId },
      balanceAdjustments: 'include',
    });

    return { restoredIds: transactionIds };
  },
);

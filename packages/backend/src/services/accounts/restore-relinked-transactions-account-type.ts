import { BANK_PROVIDER_TYPE } from '@bt/shared/types';
import { logger } from '@js/utils/logger';
import { updateTransactions } from '@models/transactions-query';
import { PROVIDER_TO_ACCOUNT_TYPE } from '@services/bank-data-providers/types';
import { Op, Sequelize } from 'sequelize';

/**
 * Types the rows `providerType` synced before an unlink as bank rows again;
 * left as `system` on a bank account, reconciliation rejects them. Manual rows,
 * file-imported rows and rows another provider synced stay `system`.
 * Hooks stay off: no amount changes, so no balance may move.
 */
export const restoreRelinkedTransactionsAccountType = async ({
  accountId,
  providerType,
}: {
  accountId: string;
  providerType: BANK_PROVIDER_TYPE;
}) => {
  const [affectedCount] = await updateTransactions({
    planned: 'exclude',
    access: 'unscoped-internal',
    balanceAdjustments: 'include',
    values: { accountType: PROVIDER_TO_ACCOUNT_TYPE[providerType] },
    where: {
      accountId,
      [Op.and]: [
        Sequelize.where(Sequelize.literal(`"externalData"#>>'{originalSource,importedFrom}'`), providerType),
        Sequelize.literal(`"externalData"->'importDetails' IS NULL`),
      ],
    },
    paranoid: false,
    hooks: false,
  });

  if (affectedCount > 0) {
    logger.info('[balance-diag] Relinked transactions typed as bank rows', {
      accountId,
      providerType,
      affectedCount,
    });
  }
};

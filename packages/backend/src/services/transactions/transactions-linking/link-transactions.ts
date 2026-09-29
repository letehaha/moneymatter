import { LINKED_TRANSFER_NATURES } from '@bt/shared/const/transfers';
import { ACCOUNT_CATEGORIES, TRANSACTION_TRANSFER_NATURE, TRANSACTION_TYPES } from '@bt/shared/types';
import { t } from '@i18n/index';
import { NotFoundError, ValidationError } from '@js/errors';
import { logger } from '@js/utils/logger';
import Accounts from '@models/accounts.model';
import TransactionSplits from '@models/transaction-splits.model';
import { findTransactions, updateTransactions } from '@models/transactions-query';
import * as Transactions from '@models/transactions.model';
import { withTransaction } from '@root/services/common/with-transaction';
import { assertTxWriteAccess } from '@services/sharing/auth/authorize-account-write.service';
import { Op } from 'sequelize';
import { v4 as uuidv4 } from 'uuid';

const validateTransactionLinking = ({
  base,
  opposite,
  ignoreBaseTxTypeValidation,
}: {
  base: Transactions.default;
  opposite: Transactions.default;
  ignoreBaseTxTypeValidation?: boolean;
}) => {
  if (base.id === opposite.id) {
    throw new ValidationError({
      message: t({ key: 'transactions.linkSelfNotAllowed' }),
    });
  }
  if (opposite.transactionType === base.transactionType) {
    throw new ValidationError({
      message: t({ key: 'transactions.linkSameTypeNotAllowed' }),
    });
  }
  if (opposite.accountId === base.accountId) {
    throw new ValidationError({
      message: t({ key: 'transactions.linkSameAccountNotAllowed' }),
    });
  }
  if (
    LINKED_TRANSFER_NATURES.includes(opposite.transferNature) ||
    (!ignoreBaseTxTypeValidation && LINKED_TRANSFER_NATURES.includes(base.transferNature))
  ) {
    // TODO: disabled when multiple links are available
    throw new ValidationError({
      message: t({ key: 'transactions.linkAlreadyTransferNotAllowed' }),
    });
  }
};

type ResultStruct = [baseTx: Transactions.default, oppositeTx: Transactions.default];
export const linkTransactions = withTransaction(
  async ({
    userId,
    ids,
    ignoreBaseTxTypeValidation,
  }: {
    userId: number;
    ids: [baseTxId: string, oppositeTxId: string][];
    ignoreBaseTxTypeValidation?: boolean;
  }): Promise<[baseTx: Transactions.default, oppositeTx: Transactions.default][]> => {
    try {
      const result: ResultStruct[] = [];

      for (const [baseTxId, oppositeTxId] of ids) {
        // Fetch both rows without a userId filter – sharing means the pair can live on
        // accounts owned by different users. The auth gate below verifies the caller has
        // `write` on each side's parent account before we mutate anything.
        const transactions = await findTransactions({
          planned: 'include',
          access: 'unscoped-internal',
          balanceAdjustments: 'include',
          completeness: 'all',
          where: { id: { [Op.in]: [baseTxId, oppositeTxId] } },
        });

        if (transactions.length !== 2) {
          throw new ValidationError({
            message: t({ key: 'transactions.linkUnexpectedError' }),
          });
        }

        const base = transactions.find((tx) => tx.id === baseTxId);
        const opposite = transactions.find((tx) => tx.id === oppositeTxId);

        if (!base || !opposite) {
          logger.info('Cannot find base or opposite transactions', {
            base,
            opposite,
          });
          throw new ValidationError({
            message: t({ key: 'transactions.linkCannotFind' }),
          });
        }

        // Auth gate per side: caller must have `write` on the parent account, and the
        // `transactionsWriteScope: 'own'` policy still applies (recipient on `'own'`
        // can only link rows they authored). Missing/insufficient access surfaces as a
        // 404 so existence is masked.
        for (const tx of [base, opposite]) {
          await assertTxWriteAccess({ userId, tx, notFoundKey: 'transactions.linkCannotFind' });
        }

        validateTransactionLinking({
          base,
          opposite,
          ignoreBaseTxTypeValidation,
        });

        if (base.isPlanned || opposite.isPlanned) {
          throw new ValidationError({
            message: t({ key: 'transactions.linkPlannedNotAllowed' }),
          });
        }

        const splitsOnLegs = await TransactionSplits.count({
          where: { transactionId: { [Op.in]: [baseTxId, oppositeTxId] } },
        });
        if (splitsOnLegs > 0) {
          throw new ValidationError({
            message: t({ key: 'transactions.linkSplitTransactionNotAllowed' }),
          });
        }

        // `validateTransactionLinking` already rejects `transfer_to_loan` legs as
        // already-linked, so a link can never legitimately land on a loan account.
        // Guard the impossible case loudly — stamping either nature here would
        // desync the loan's payment list or skip the balance recompute.
        const incomeLeg = base.transactionType === TRANSACTION_TYPES.income ? base : opposite;
        const incomeLegAccount = await Accounts.findOne({
          where: { id: incomeLeg.accountId },
          attributes: ['accountCategory'],
        });
        if (!incomeLegAccount) {
          throw new NotFoundError({ message: t({ key: 'accounts.accountNotFoundForTransaction' }) });
        }
        if (incomeLegAccount.accountCategory === ACCOUNT_CATEGORIES.loan) {
          throw new ValidationError({ message: t({ key: 'transactions.loanAccountReadonly' }) });
        }

        const [, results = []] = await updateTransactions({
          planned: 'include',
          access: 'unscoped-internal',
          balanceAdjustments: 'include',
          values: {
            transferId: uuidv4(),
            transferNature: TRANSACTION_TRANSFER_NATURE.common_transfer,
          },
          where: { id: { [Op.in]: [baseTxId, oppositeTxId] } },
          returning: true,
        });

        result.push([
          results.find((tx) => tx.id === baseTxId),
          results.find((tx) => tx.id === oppositeTxId),
        ] as ResultStruct);
      }

      return result;
    } catch (err) {
      logger.error(err as Error);
      throw err;
    }
  },
);

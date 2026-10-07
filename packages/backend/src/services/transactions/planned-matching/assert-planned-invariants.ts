import { TRANSACTION_TRANSFER_NATURE, isDedicatedFlowAccountCategory } from '@bt/shared/types';
import { Money } from '@common/types/money';
import { findOrThrowNotFound } from '@common/utils/find-or-throw-not-found';
import { t } from '@i18n/index';
import { ForbiddenError, ValidationError } from '@js/errors';
import Accounts, { isBankLinkedAccount } from '@models/accounts.model';
import RefundTransactions from '@models/refund-transactions.model';
import type Transactions from '@models/transactions.model';
import { Op } from 'sequelize';

export const assertAccountCanHoldPlans = async ({
  accountId,
  callerUserId,
}: {
  accountId: string;
  callerUserId: number;
}) => {
  const account = await findOrThrowNotFound({
    query: Accounts.findOne({ where: { id: accountId }, attributes: ['userId', 'accountCategory'] }),
    message: t({ key: 'accounts.accountNotFoundForTransaction' }),
  });

  if (account.userId !== callerUserId) {
    throw new ValidationError({ message: t({ key: 'transactions.plannedOwnerOnly' }) });
  }

  // Loan and vehicle balances are replayed from their transactions, which would count a
  // plan as money that already moved.
  if (isDedicatedFlowAccountCategory(account.accountCategory)) {
    throw new ValidationError({ message: t({ key: 'transactions.plannedAccountNotSupported' }) });
  }
};

/**
 * Service-level creation invariants for `isPlanned: true`. Lives outside the zod schemas
 * because MCP callers reach `createTransaction` without them.
 */
export const assertPlannedCreateAllowed = async ({
  callerUserId,
  accountId,
  amount,
  transferNature,
  refundsTxId,
  refundsSplitId,
  originalId,
  destinationAccountId,
  destinationAmount,
  destinationTransactionId,
}: {
  callerUserId: number;
  accountId: string;
  amount: Money;
  transferNature?: TRANSACTION_TRANSFER_NATURE;
  refundsTxId?: string | null;
  refundsSplitId?: string | null;
  originalId?: string | null;
  destinationAccountId?: string;
  destinationAmount?: Money;
  destinationTransactionId?: string;
}): Promise<void> => {
  const isStandalone =
    (transferNature ?? TRANSACTION_TRANSFER_NATURE.not_transfer) === TRANSACTION_TRANSFER_NATURE.not_transfer &&
    !refundsTxId &&
    !refundsSplitId &&
    !originalId &&
    !destinationAccountId &&
    !destinationAmount &&
    !destinationTransactionId;

  if (!isStandalone) {
    throw new ValidationError({ message: t({ key: 'transactions.plannedMustBeStandalone' }) });
  }

  // A zero-amount plan would match any zero-amount incoming row.
  if (!amount.isPositive()) {
    throw new ValidationError({ message: t({ key: 'transactions.plannedAmountMustBePositive' }) });
  }

  await assertAccountCanHoldPlans({ accountId, callerUserId });
};

/** Fields of an in-flight edit that would pair the row with another one. */
interface PlannedStandaloneUpdate {
  transferNature?: TRANSACTION_TRANSFER_NATURE;
  transferId?: string;
  destinationAccountId?: string;
  destinationAmount?: Money;
  destinationTransactionId?: string;
  refundsTxId?: string | null;
  refundedByTxIds?: string[] | null;
}

/**
 * A plan is an intention that later merges into a single real row, so it must stay unpaired.
 * Every listed field ties the row to another one — a transfer leg, a refund link, a provider
 * import — which means the money already moved or would move outside the merge.
 */
export const assertPlannedStandalone = async ({
  transaction,
  update,
  message,
}: {
  transaction: Transactions;
  update?: PlannedStandaloneUpdate;
  message: string;
}): Promise<void> => {
  const externalData: Record<string, unknown> = transaction.externalData ?? {};
  const transferNature = update?.transferNature ?? transaction.transferNature;

  const entangled =
    transferNature !== TRANSACTION_TRANSFER_NATURE.not_transfer ||
    Boolean(transaction.transferId) ||
    Boolean(transaction.refundLinked) ||
    Boolean(transaction.originalId) ||
    Boolean(externalData.importDetails) ||
    Boolean(externalData.originalSource) ||
    Boolean(externalData.plannedMerge) ||
    Boolean(update?.transferId) ||
    Boolean(update?.destinationAccountId) ||
    Boolean(update?.destinationAmount) ||
    Boolean(update?.destinationTransactionId) ||
    Boolean(update?.refundsTxId) ||
    Boolean(update?.refundedByTxIds?.length);

  if (entangled) {
    throw new ValidationError({ message });
  }

  // `refundLinked` is a cached flag; a drifted false must not pass as standalone.
  const refundLink = await RefundTransactions.findOne({
    where: { [Op.or]: [{ originalTxId: transaction.id }, { refundTxId: transaction.id }] },
    attributes: ['id'],
  });

  if (refundLink) {
    throw new ValidationError({ message });
  }
};

/**
 * Invariants for flipping an existing row to `isPlanned: true`. A row that records money
 * which already moved must not turn back into an intention: that would reverse a real
 * balance or make a confirmed bank row un-confirmable.
 */
export const assertPlannedFlipAllowed = async ({
  transaction,
  callerUserId,
}: {
  transaction: Transactions;
  callerUserId: number;
}): Promise<void> => {
  // The creator check keeps the owner-only invariant airtight: without it, an account
  // owner could flip a share member's row and mint a plan whose userId isn't the owner.
  if (transaction.userId !== callerUserId) {
    throw new ValidationError({ message: t({ key: 'transactions.plannedFlipNotAllowed' }) });
  }

  await assertPlannedStandalone({ transaction, message: t({ key: 'transactions.plannedFlipNotAllowed' }) });

  await assertAccountCanHoldPlans({ accountId: transaction.accountId, callerUserId });

  // A real row on a bank-linked account stays real: as a plan it could be moved or deleted.
  if (await isBankLinkedAccount({ id: transaction.accountId })) {
    throw new ValidationError({ message: t({ key: 'transactions.plannedFlipNotAllowed' }) });
  }
};

/**
 * Planned rows are owner-only: `authorizeAccountWrite` alone would wave a full-scope
 * shared-account member through to someone else's plan.
 */
export const assertPlannedWriteAllowed = ({
  transaction,
  callerUserId,
}: {
  transaction: Transactions;
  callerUserId: number;
}): void => {
  if (!transaction.isPlanned) return;
  if (transaction.userId === callerUserId) return;

  throw new ForbiddenError({ message: t({ key: 'transactions.plannedCreatorOnly' }) });
};

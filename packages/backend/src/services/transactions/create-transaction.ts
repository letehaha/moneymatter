import {
  isTwoLegTransfer,
  ACCOUNT_CATEGORIES,
  ACCOUNT_TYPES,
  RESOURCE_TYPES,
  SHARE_PERMISSIONS,
  TRANSACTION_TRANSFER_NATURE,
  TRANSACTION_TYPES,
} from '@bt/shared/types';
import { UnwrapPromise } from '@common/types';
import { Money } from '@common/types/money';
import { findOrThrowNotFound } from '@common/utils/find-or-throw-not-found';
import { t } from '@i18n/index';
import { NotFoundError, UnexpectedError, ValidationError } from '@js/errors';
import { logger } from '@js/utils/logger';
import * as Accounts from '@models/accounts.model';
import Categories from '@models/categories.model';
import Payees from '@models/payees.model';
import Tags from '@models/tags.model';
import * as Transactions from '@models/transactions.model';
import * as UsersCurrencies from '@models/users-currencies.model';
import { calculateRefAmount } from '@services/calculate-ref-amount.service';
import { DOMAIN_EVENTS, eventBus } from '@services/common/event-bus';
import { assertLoanPaymentAllowed } from '@services/loans/assert-loan-payment-allowed';
import { applyPayeeCategorization } from '@services/payees/apply-categorization';
import { applyPayeeDefaultLocation } from '@services/payees/apply-default-location';
import { applyPayeeDefaultTags } from '@services/payees/apply-default-tags';
import { resolvePayeeForIncomingRow } from '@services/payees/resolve-payee-for-incoming-row';
import {
  assertSharedWritePhase1Guards,
  authorizeAccountWrite,
} from '@services/sharing/auth/authorize-account-write.service';
import { canUserAccessResource } from '@services/sharing/auth/can-user-access-resource.service';
import { ensureUserCurrencyConnected } from '@services/sharing/auth/ensure-currency-connected.service';
import { matchTransactionToSubscriptions } from '@services/subscriptions/matching-engine';
import { isAutomationEligible } from '@services/transaction-automations/eligibility';
import { runTransactionAutomations } from '@services/transaction-automations/run-automations';
import { ConnectionError, DatabaseError, UniqueConstraintError } from 'sequelize';
import { v4 as uuidv4 } from 'uuid';

import { withTransaction } from '../common/with-transaction';
import { createSingleRefund } from '../tx-refunds/create-single-refund.service';
import { tryMergeIntoPlanned } from './planned-matching';
import { assertPlannedCreateAllowed } from './planned-matching/assert-planned-invariants';
import { manageSplits } from './splits';
import { linkTransactions } from './transactions-linking';
import type { CreateTransactionParams, UpdateTransactionParams } from './types';

/**
 * Errors that leave the open Postgres transaction aborted, so swallowing them would turn
 * COMMIT into a silent rollback. `UniqueConstraintError` is server-side but extends
 * `ValidationError`, not `DatabaseError`.
 */
const abortsTransaction = (error: unknown) =>
  error instanceof DatabaseError || error instanceof UniqueConstraintError || error instanceof ConnectionError;

/**
 * `mergedIntoPlanned` rides along on the tuple so every existing caller keeps destructuring
 * `[baseTx, oppositeTx]` untouched. It is set only when the row confirmed an existing plan,
 * which means no new row was created and post-processing jobs must leave it alone.
 */
type CreateTxResult = [baseTx: Transactions.default, oppositeTx?: Transactions.default] & {
  mergedIntoPlanned?: boolean;
};

/**
 * The account row is the only trustworthy source for `accountType`: a caller-supplied one
 * lets a hand-typed row claim to be bank data, which then drives the balance hooks. Provider
 * and importer code passes its own type explicitly and keeps it; everything reaching this
 * without one is a user typing a transaction, and gets the account's real type.
 *
 * Only a planned row may sit on a provider account without the provider having reported it,
 * because it records an intention the sync is expected to confirm later.
 */
const resolveAccountTypeForManualWrite = async ({
  accountId,
  accountOwnerUserId,
  isPlanned,
}: {
  accountId: string;
  accountOwnerUserId: number;
  isPlanned: boolean;
}): Promise<ACCOUNT_TYPES> => {
  const account = await findOrThrowNotFound({
    query: Accounts.getAccountById({ id: accountId, userId: accountOwnerUserId }),
    message: t({ key: 'accounts.accountNotFoundForTransaction' }),
  });

  if (account.type !== ACCOUNT_TYPES.system && !isPlanned) {
    throw new ValidationError({ message: t({ key: 'transactions.manualOnConnectedAccount' }) });
  }

  return account.type;
};

type CreateOppositeTransactionParams = [
  creationParams: (CreateTransactionParams | UpdateTransactionParams) & {
    time: Date;
    skipLoanOverpayAssert?: boolean;
  },
  baseTransaction: Transactions.default,
];

/**
 * Calculate oppositeTx based on baseTx amount and currency.
 *
 * *ref-transaction - transaction with ref-currency, means user's base currency
 *
 * 1. If source transaction is a ref-transaction, and opposite is non-ref,
 *    then opposite's refAmount should be the same as of source
 * 2. If source tx is a non-ref, and opposite is ref - then source's
 *    refAmount should be the same as opposite. We update its value right in that
 *    helper and return it back
 * 3. If both are ref, then they both should have same refAmount
 * 4. If both are non-ref, then each of them has separate refAmount. So we don't
 *    touch source tx, and calculate refAmount for opposite tx
 *
 */
export const calcTransferTransactionRefAmount = async ({
  userId,
  baseTransaction,
  destinationAmount,
  oppositeTxCurrencyCode,
  baseCurrency,
  date,
}: {
  userId: number;
  baseTransaction: Transactions.default;
  destinationAmount: Money;
  oppositeTxCurrencyCode: string;
  baseCurrency?: UnwrapPromise<ReturnType<typeof UsersCurrencies.getBaseCurrency>>;
  date: Date;
}) => {
  if (!baseCurrency) {
    baseCurrency = await UsersCurrencies.getBaseCurrency({ userId });
  }

  const isSourceRef = baseTransaction.currencyCode === baseCurrency.currency.code;
  const isOppositeRef = oppositeTxCurrencyCode === baseCurrency.currency.code;

  let oppositeRefAmount: Money = destinationAmount;

  if (isSourceRef && !isOppositeRef) {
    oppositeRefAmount = baseTransaction.refAmount;
  } else if (!isSourceRef && isOppositeRef) {
    baseTransaction = await Transactions.updateTransactionById({
      id: baseTransaction.id,
      userId,
      refAmount: destinationAmount,
    });
    oppositeRefAmount = destinationAmount;
  } else if (isSourceRef && isOppositeRef) {
    oppositeRefAmount = baseTransaction.refAmount;
  } else if (!isSourceRef && !isOppositeRef) {
    oppositeRefAmount = await calculateRefAmount({
      userId,
      amount: destinationAmount,
      baseCode: oppositeTxCurrencyCode,
      quoteCode: baseCurrency.currency.code,
      date,
    });
  }

  return {
    oppositeRefAmount,
    baseTransaction,
  };
};

/**
 * If previously the base tx wasn't transfer, so it was income or expense, we need to:
 *
 * 1. create an opposite tx
 * 2. generate "transferId" and put it to both transactions
 * 3. Calculate correct refAmount for both base and opposite tx. Logic is described down in the code
 */
export const createOppositeTransaction = async (params: CreateOppositeTransactionParams) => {
  const [creationParams, baseTransaction] = params;

  const { destinationAmount, destinationAccountId, userId, transactionType } = creationParams;

  if (!destinationAmount || !destinationAccountId) {
    throw new ValidationError({
      message: t({ key: 'transactions.missingRequiredFields' }),
    });
  }

  // Dest may belong to another user when the caller has a household membership (or per-resource
  // write share) on it. Auth + resolve owner here so opposite-tx fields can be scoped to the
  // *dest owner* — userId on the row, ref-currency, category — instead of leaking source-user
  // context onto someone else's account.
  const destAccess = await canUserAccessResource({
    userId,
    resourceType: RESOURCE_TYPES.account,
    resourceId: destinationAccountId,
    requiredPermission: SHARE_PERMISSIONS.write,
  });
  if (!destAccess.granted) {
    throw new NotFoundError({ message: t({ key: 'accounts.accountNotFoundForTransaction' }) });
  }
  const destOwnerUserId = destAccess.ownerUserId;
  const isCrossUser = destOwnerUserId !== baseTransaction.userId;

  // Loan-payment treatment keys off the destination account's *category*, not
  // the caller-supplied nature: any two-leg transfer into a loan account moves
  // the loan balance, so it must be stamped `transfer_to_loan` and pass the
  // overpay check. A `transfer_to_loan` label on a non-loan destination is a
  // caller bug — fail loudly.
  const destAccount = await Accounts.default.findOne({
    where: { id: destinationAccountId, userId: destOwnerUserId },
    attributes: ['accountCategory', 'type'],
  });
  if (!destAccount) {
    throw new NotFoundError({ message: t({ key: 'accounts.accountNotFoundForTransaction' }) });
  }
  if (destAccount.type !== ACCOUNT_TYPES.system) {
    throw new ValidationError({ message: t({ key: 'transactions.manualOnConnectedAccount' }) });
  }
  const isLoanDestination = destAccount.accountCategory === ACCOUNT_CATEGORIES.loan;
  // A loan payment is an outflow: the base leg is the expense, the auto-created
  // loan-side leg is the income that pays the balance down. An income base
  // would invert both legs and grow the debt — reject it.
  if (isLoanDestination && transactionType === TRANSACTION_TYPES.income) {
    throw new ValidationError({
      message: t({ key: 'transactions.loanPaymentMustBeExpense' }),
    });
  }
  if (!isLoanDestination && creationParams.transferNature === TRANSACTION_TRANSFER_NATURE.transfer_to_loan) {
    throw new ValidationError({
      message: t({ key: 'transactions.transferToLoanRequiresLoanDestination' }),
    });
  }
  // The nature is stamped onto both legs so loan-payment reporting can filter
  // on the label instead of joining via the destination account.
  const oppositeTransferNature = isLoanDestination
    ? TRANSACTION_TRANSFER_NATURE.transfer_to_loan
    : isTwoLegTransfer(creationParams.transferNature)
      ? creationParams.transferNature!
      : TRANSACTION_TRANSFER_NATURE.common_transfer;

  // `linkLoanPayments` validates the whole batch in one aggregate overpay check
  // and sets `skipLoanOverpayAssert` so the per-leg guard here doesn't
  // re-reject mid-batch as each linked leg moves the balance.
  if (isLoanDestination && !creationParams.skipLoanOverpayAssert) {
    await assertLoanPaymentAllowed({
      ownerUserId: destOwnerUserId,
      loanAccountId: destinationAccountId,
      newLegAmount: destinationAmount,
      // Both legs of a transfer share the date; the base tx carries it.
      paymentDate: baseTransaction.time,
    });
  }

  const transferId = uuidv4();

  let baseTx = await Transactions.updateTransactionById({
    id: baseTransaction.id,
    userId: baseTransaction.userId,
    transferId,
    transferNature: oppositeTransferNature,
  });

  const { currency: oppositeTxCurrency } = await Accounts.getAccountCurrency({
    userId: destOwnerUserId,
    id: destinationAccountId,
  });

  const sourceUserBaseCurrency = await UsersCurrencies.getBaseCurrency({ userId });
  const destOwnerBaseCurrency = isCrossUser
    ? await UsersCurrencies.getBaseCurrency({ userId: destOwnerUserId })
    : sourceUserBaseCurrency;

  let oppositeRefAmount: Money;

  if (isCrossUser) {
    // Cross-user pairs deliberately *don't* share a refAmount: each leg's refAmount is in
    // its own owner's base currency. The same-user `calcTransferTransactionRefAmount` would
    // pull one of the two refs back into the other's base currency and corrupt accounting
    // on whichever side it overwrote. Calculate the opposite leg independently using the
    // dest owner's userId so their exchange-rate config drives the conversion.
    if (destOwnerBaseCurrency.currency.code === oppositeTxCurrency.code) {
      oppositeRefAmount = destinationAmount;
    } else {
      oppositeRefAmount = await calculateRefAmount({
        userId: destOwnerUserId,
        amount: destinationAmount,
        baseCode: oppositeTxCurrency.code,
        quoteCode: destOwnerBaseCurrency.currency.code,
        date: new Date(baseTransaction.time),
      });
    }
  } else {
    const result = await calcTransferTransactionRefAmount({
      userId,
      baseTransaction: baseTx,
      destinationAmount,
      oppositeTxCurrencyCode: oppositeTxCurrency.code,
      baseCurrency: sourceUserBaseCurrency,
      date: new Date(baseTransaction.time),
    });
    oppositeRefAmount = result.oppositeRefAmount;
    baseTx = result.baseTransaction;
  }

  // Categories are per-user — copying the source-side category id onto a row owned by a
  // different user would point at a category the dest owner doesn't own. Drop it on
  // cross-user pairs; same-user transfers keep the existing copy-through behavior.
  const oppositeCategoryId = isCrossUser ? undefined : baseTransaction.categoryId;

  const oppositeTx = await Transactions.createTransaction({
    userId: destOwnerUserId,
    amount: destinationAmount,
    refAmount: oppositeRefAmount,
    note: baseTransaction.note,
    externalUrl: baseTransaction.externalUrl,
    externalReference: baseTransaction.externalReference,
    location: baseTransaction.location,
    time: new Date(baseTransaction.time),
    transactionType:
      transactionType === TRANSACTION_TYPES.income ? TRANSACTION_TYPES.expense : TRANSACTION_TYPES.income,
    paymentType: baseTransaction.paymentType,
    accountId: destinationAccountId,
    categoryId: oppositeCategoryId,
    accountType: ACCOUNT_TYPES.system,
    currencyCode: oppositeTxCurrency.code,
    refCurrencyCode: destOwnerBaseCurrency.currency.code,
    transferNature: oppositeTransferNature,
    transferId,
    // `externalData` is a shared namespace, not import-only metadata — a synced row's
    // `balance`/`entryReference` or the balance-adjustment flag must NOT cross to the
    // opposite leg (bank sync reads the newest row's `balance` as authoritative, so
    // copying it here would corrupt the destination account's synced balance). Only
    // `importDetails` is safe to carry over, and only same-user: on a cross-user pair
    // the opposite tx belongs to someone else, who never ran this import.
    externalData:
      !isCrossUser && baseTransaction.externalData?.importDetails
        ? { importDetails: baseTransaction.externalData.importDetails }
        : undefined,
  });

  return { baseTx, oppositeTx: oppositeTx! };
};

/**
 * Creates transaction and updates account balance.
 */
export const createTransaction = withTransaction(
  async ({
    amount,
    commissionRate = Money.zero(),
    userId,
    accountId,
    transferNature,
    destinationTransactionId,
    refundsTxId,
    refundsSplitId,
    splits,
    tagIds,
    rawMerchantName,
    payeeId: callerPayeeId,
    payeeLocked: callerPayeeLocked,
    categoryIdIsExplicit = false,
    matchPlanned = false,
    applyAutomations = false,
    ...payload
  }: CreateTransactionParams): Promise<CreateTxResult> => {
    if (applyAutomations) payload.externalData = { ...payload.externalData, applyAutomations: true };

    try {
      // Captured before the coercion below, which would hide a non-positive amount from
      // the planned-row invariants.
      const requestedAmount = amount;

      // Detect negative amounts - this is a bug in the caller code
      // Transaction amounts should ALWAYS be positive, with transactionType determining expense/income
      if (amount.isNegative()) {
        const stack = new Error().stack;
        logger.error('Negative amount detected in createTransaction. This is a bug - amounts must be positive.', {
          amount: amount.toNumber(),
          userId,
          accountId,
          transactionType: payload.transactionType,
          stack,
        });
        amount = amount.abs();
      }

      if (refundsTxId && transferNature !== TRANSACTION_TRANSFER_NATURE.not_transfer) {
        throw new ValidationError({
          message: t({ key: 'transactions.refundAndTransferNotAllowed' }),
        });
      }

      // Account-scoped auth: owners pass; recipients need `write`. The returned
      // `accountOwnerUserId` scopes downstream owner-only lookups (account row, category
      // set) so a shared-account write resolves correctly. Phase-1 guards block recipient
      // flows that need their own follow-up slices.
      const { isOwner, accountOwnerUserId } = await authorizeAccountWrite({
        userId,
        accountId,
      });
      assertSharedWritePhase1Guards({
        isOwner,
        involvesTransfer: isTwoLegTransfer(transferNature),
        involvesRefund: refundsTxId !== undefined && refundsTxId !== null,
      });

      if (payload.isPlanned) {
        await assertPlannedCreateAllowed({
          callerUserId: userId,
          accountId,
          amount: requestedAmount,
          transferNature,
          refundsTxId,
          refundsSplitId,
          originalId: payload.originalId,
          destinationAccountId: payload.destinationAccountId,
          destinationAmount: payload.destinationAmount,
          destinationTransactionId,
        });
      }

      const accountType =
        payload.accountType ??
        (await resolveAccountTypeForManualWrite({
          accountId,
          accountOwnerUserId,
          isPlanned: Boolean(payload.isPlanned),
        }));

      if (payload.categoryId !== undefined && payload.categoryId !== null) {
        await findOrThrowNotFound({
          query: Categories.findOne({ where: { id: payload.categoryId, userId: accountOwnerUserId } }),
          message: 'Category not found or does not belong to user.',
        });
      }

      const { currency: defaultUserCurrency } = await UsersCurrencies.getCurrency({
        userId,
        isDefaultCurrency: true,
      });

      const { currency: generalTxCurrency } = await Accounts.getAccountCurrency({
        userId: accountOwnerUserId,
        id: accountId,
      });

      // Recipients writing on a shared account whose currency they haven't connected
      // would otherwise trip `currencyNotConnected` inside the ref-amount lookup.
      // Auto-connect so the guard stays internal and not user-facing.
      if (!isOwner && generalTxCurrency.code !== defaultUserCurrency.code) {
        await ensureUserCurrencyConnected({ userId, currencyCode: generalTxCurrency.code });
      }

      if (matchPlanned && transferNature === TRANSACTION_TRANSFER_NATURE.not_transfer && !payload.isPlanned) {
        const merged = await tryMergeIntoPlanned({
          accountId,
          amount,
          transactionType: payload.transactionType,
          currencyCode: generalTxCurrency.code,
          incoming: {
            time: payload.time ?? new Date(),
            note: payload.note,
            originalId: payload.originalId,
            externalData: payload.externalData,
            commissionRate,
            cashbackAmount: payload.cashbackAmount,
            accountType,
            rawMerchantName,
            externalUrl: payload.externalUrl,
            externalReference: payload.externalReference,
            location: payload.location,
          },
        });

        if (merged) {
          const mergedResult: CreateTxResult = [merged];
          mergedResult.mergedIntoPlanned = true;
          return mergedResult;
        }
      }

      // Resolve Payee for provider-sync rows. Caller-supplied `payeeId` wins
      // (manual UI assignment); otherwise extract from `rawMerchantName` only
      // when the row isn't locked. Transfers skip extraction entirely — they
      // model internal account moves, not merchant interactions.
      //
      // Both the caller-supplied id and the extraction are scoped to
      // `accountOwnerUserId`, not the caller — Payees belong to the account
      // owner just like Categories. On a shared-account write the recipient
      // must pick from the owner's payee list; their own private payees are
      // out of scope for rows that live on someone else's account.
      let resolvedPayeeId: string | null = null;
      if (callerPayeeId) {
        const ownedPayee = await Payees.findOne({
          where: { id: callerPayeeId, userId: accountOwnerUserId },
          attributes: ['id'],
        });
        if (!ownedPayee) {
          throw new NotFoundError({ message: t({ key: 'payees.notFound' }) });
        }
        resolvedPayeeId = callerPayeeId;
      }
      if (!callerPayeeLocked && !resolvedPayeeId && !isTwoLegTransfer(transferNature)) {
        resolvedPayeeId = await resolvePayeeForIncomingRow({
          ownerUserId: accountOwnerUserId,
          rawMerchantName,
          note: payload.note,
          failureLogMessage: 'Failed to resolve Payee during createTransaction; continuing without link',
        });
      }

      const generalTxParams: Transactions.CreateTransactionPayload & {
        time: Date;
      } = {
        ...payload,
        time: payload.time ?? new Date(),
        amount,
        refAmount: amount,
        commissionRate,
        refCommissionRate: commissionRate,
        userId,
        accountId,
        accountType,
        transferNature,
        currencyCode: generalTxCurrency.code,
        transferId: undefined,
        refCurrencyCode: defaultUserCurrency.code,
        payeeId: resolvedPayeeId,
        payeeLocked: callerPayeeLocked ?? false,
      };

      if (defaultUserCurrency.code !== generalTxCurrency.code) {
        generalTxParams.refAmount = await calculateRefAmount({
          userId,
          amount: generalTxParams.amount,
          baseCode: generalTxCurrency.code,
          quoteCode: defaultUserCurrency.code,
          date: generalTxParams.time,
        });
        generalTxParams.refCommissionRate = await calculateRefAmount({
          userId,
          amount: generalTxParams.commissionRate || Money.zero(),
          baseCode: generalTxCurrency.code,
          quoteCode: defaultUserCurrency.code,
          date: generalTxParams.time,
        });
      }

      const baseTransaction = await Transactions.createTransaction(generalTxParams);

      let transactions: CreateTxResult = [baseTransaction!];

      if (refundsTxId && !isTwoLegTransfer(transferNature)) {
        await createSingleRefund({
          userId,
          originalTxId: refundsTxId,
          refundTxId: baseTransaction!.id,
          splitId: refundsSplitId,
        });
      } else if (isTwoLegTransfer(transferNature)) {
        logger.info('Transfer transaction creation');
        /**
         * If transaction is transfer between two accounts, add transferId to both
         * transactions to connect them, and use destinationAmount and destinationAccountId
         * for the second transaction.
         */

        if (destinationTransactionId) {
          /**
           * When "destinationTransactionId" is provided, we don't need to create an
           * opposite transaction, since it's expected to use the existing one.
           * We need to update the existing one, or fail the whole creation if it
           * doesn't exist
           */
          const result = await linkTransactions({
            userId,
            ids: [[baseTransaction!.id, destinationTransactionId]],
            ignoreBaseTxTypeValidation: true,
          });
          if (result[0]) {
            const [baseTx, oppositeTx] = result[0];
            transactions = [baseTx, oppositeTx];
          } else {
            logger.info('Cannot create transaction with provided params', {
              ids: [[baseTransaction!.id, destinationTransactionId]],
              result,
            });
            throw new UnexpectedError({ message: t({ key: 'transactions.cannotCreateWithParams' }) });
          }
        } else {
          const res = await createOppositeTransaction([
            {
              amount,
              userId,
              accountId,
              transferNature,
              time: payload.time ?? new Date(),
              ...payload,
            },
            baseTransaction!,
          ]);
          transactions = [res.baseTx, res.oppositeTx];
        }
      }

      // Handle splits for non-transfer transactions
      if (splits && splits.length > 0 && !isTwoLegTransfer(transferNature)) {
        await manageSplits({
          transactionId: baseTransaction!.id,
          userId,
          categoryOwnerUserId: accountOwnerUserId,
          splits,
          transactionAmount: amount,
          transactionCurrencyCode: generalTxCurrency.code,
          transactionTime: generalTxParams.time,
          transferNature,
        });
      }

      // Handle tags for the transaction
      if (tagIds && tagIds.length > 0) {
        // Validate that all tagIds belong to the current user
        const userTags = await Tags.findAll({
          where: { userId, id: tagIds },
          attributes: ['id'],
        });

        if (userTags.length !== tagIds.length) {
          throw new ValidationError({
            message: t({ key: 'transactions.invalidTagIds' }),
          });
        }

        await baseTransaction!.$set('tags', tagIds);

        // Emit event for real-time reminders check (handled by event listener)
        eventBus.emit(DOMAIN_EVENTS.TRANSACTIONS_TAGGED, { tagIds, userId });
      }

      if (!isTwoLegTransfer(transferNature)) {
        try {
          await matchTransactionToSubscriptions({ transaction: baseTransaction!, userId });
        } catch (error) {
          if (abortsTransaction(error)) throw error;

          logger.error({
            message: `Failed to match transaction ${baseTransaction!.id} to subscriptions`,
            error: error as Error,
          });
        }
      }

      // An `enforce`-mode Payee's `defaultCategoryId` normally overrides even a
      // passed `categoryId` (the point of enforce mode; manual/bank-sync callers
      // rely on it). CSV/Wallet import opts out via `categoryIdIsExplicit`, where
      // the mapped-column category is authoritative. Inert without a `categoryId`,
      // so import rows with no mapped category still get enforce/hint.
      const skipPayeeCategorization =
        categoryIdIsExplicit && payload.categoryId !== undefined && payload.categoryId !== null;

      // User automations — after subscription matching (whose category wins) and before
      // payee categorization (which refuses to override `user_rule`). `isPlanned` is
      // load-bearing: `resolveAccountTypeForManualWrite` reports the provider type for a
      // manually created planned row on a connected account, which would read as eligible.
      if (
        isOwner &&
        isAutomationEligible({
          accountType,
          externalData: payload.externalData,
          transferNature,
          isPlanned: Boolean(payload.isPlanned),
        })
      ) {
        try {
          const applied = await runTransactionAutomations({
            transactionId: baseTransaction!.id,
            userId: accountOwnerUserId,
            skipSetCategory: skipPayeeCategorization,
          });
          if (applied) {
            transactions[0] = applied;
            // A set_payee action must drive the payee defaults below, not the extraction's payee.
            resolvedPayeeId = applied.payeeId;
          }
        } catch (error) {
          if (abortsTransaction(error)) throw error;

          logger.error({
            message: `Automations failed for tx ${baseTransaction!.id} (user ${accountOwnerUserId}); kept as-is`,
            error: error as Error,
          });
        }
      }

      // Auto-categorize via `payee_rule` — runs AFTER subscription matching so
      // subscription_rule wins on conflict. The helper itself handles the
      // mode-based meta stamping and the overridable-source precedence; we
      // just hand it the linked payeeId.
      //
      // Gated on `isOwner`: when a recipient writes on the owner's shared
      // account we resolve the payee from the owner's namespace but skip
      // categorization here. The row's account belongs to the owner, so the
      // owner's post-sync note fuzzy backfill (or a manual re-categorize) is
      // the appropriate actor for applying their categorization rules.
      // `applyPayeeCategorization` itself filters by `userId` against both
      // the Payee and the Transaction row, which doesn't fit a recipient
      // caller — short-circuiting here also keeps that helper's contract
      // narrow.
      if (isOwner && resolvedPayeeId && !isTwoLegTransfer(transferNature)) {
        if (!skipPayeeCategorization) {
          try {
            const updated = await applyPayeeCategorization({
              accountOwnerUserId,
              transactionId: baseTransaction!.id,
              payeeId: resolvedPayeeId,
            });
            if (updated) {
              transactions[0] = updated;
            }
          } catch (error) {
            logger.error({
              message: 'Failed to apply payee_rule categorization; leaving transaction uncategorized',
              error: error as Error,
            });
          }
        }

        // Payee default tags, add-only. An explicit `tagIds` (even `[]`) is the
        // final tag set only when the caller also picked the payee. A payee
        // resolved here was unknown to the caller, so its defaults merge on top.
        //
        // No catch-and-continue here: `applyPayeeDefaultTags` joins this
        // create's transaction via `withTransaction`, and a failed SQL
        // statement aborts the whole Postgres transaction — swallowing the
        // error would just poison every subsequent query before commit.
        // Letting it propagate keeps the create atomic and surfaces a real
        // error to the caller instead of silently dropping tags.
        if (tagIds === undefined || !callerPayeeId) {
          await applyPayeeDefaultTags({
            accountOwnerUserId,
            transactionId: baseTransaction!.id,
            payeeId: resolvedPayeeId,
          });
        }

        // Same "caller didn't mention it" contract as tags: an explicit `location`
        // (even null, the form's cleared state) is the client's final answer.
        if (payload.location === undefined) {
          const appliedLocation = await applyPayeeDefaultLocation({
            accountOwnerUserId,
            transactionId: baseTransaction!.id,
            payeeId: resolvedPayeeId,
          });
          if (appliedLocation) transactions[0]!.location = appliedLocation;
        }
      }

      return transactions;
    } catch (e) {
      if (process.env.NODE_ENV !== 'test') {
        logger.error(e as Error);
      }
      throw e;
    }
  },
);

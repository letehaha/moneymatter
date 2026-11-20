import { ACCOUNT_CATEGORIES, TRANSACTION_TRANSFER_NATURE, TRANSACTION_TYPES, isTwoLegTransfer } from '@bt/shared/types';
import type { Money } from '@common/types/money';
import { t } from '@i18n/index';
import { NotFoundError, ValidationError } from '@js/errors';
import * as Accounts from '@models/accounts.model';
import { findOneTransaction } from '@models/transactions-query';
import * as Transactions from '@models/transactions.model';
import { assertLoanPaymentAllowed } from '@services/loans/assert-loan-payment-allowed';
import { deriveImpliedDestinationAmount } from '@services/loans/implied-destination-amount';
import { type UpdateTransactionParams } from '@services/transactions/types';
import { Op } from 'sequelize';

/**
 * Write-policy checks that gate edits touching a loan-linked transfer. Applied
 * from the generic transaction-update path before any mutation runs; each
 * violation throws the same error type the caller expects, and the checks run
 * in a fixed order so the first applicable one short-circuits.
 */
export const assertLoanEditAllowed = async ({
  newData,
  prevData,
  callerUserId,
  accountOwnerUserId,
}: {
  newData: UpdateTransactionParams;
  prevData: Transactions.default;
  callerUserId: number;
  accountOwnerUserId: number;
}): Promise<void> => {
  // The transfer kind is frozen once a pair exists — relabeling
  // (common_transfer ↔ transfer_to_loan) would require restamping both legs
  // atomically and re-validating the destination's category. Supported flow:
  // unlink first, then re-mark via the create path.
  if (
    newData.transferNature !== undefined &&
    isTwoLegTransfer(prevData.transferNature) &&
    isTwoLegTransfer(newData.transferNature) &&
    newData.transferNature !== prevData.transferNature
  ) {
    throw new ValidationError({
      message: t({ key: 'transactions.transferNatureChangeNotAllowed' }),
    });
  }

  // The loan-side income leg is system-managed: every sanctioned flow edits the
  // *expense* leg, which propagates here and passes the overpay assertion. A
  // direct edit would bypass that assertion and restamp the opposite leg's
  // transactionType — rejected; edit via the expense leg or delete the pair.
  if (
    prevData.transferNature === TRANSACTION_TRANSFER_NATURE.transfer_to_loan &&
    prevData.transactionType === TRANSACTION_TYPES.income
  ) {
    throw new ValidationError({
      message: t({ key: 'transactions.loanAccountReadonly' }),
    });
  }

  // Loan invariants for edits that can move a loan's balance — keyed off the
  // destination account's *category*, not the nature label (mirrors
  // createOppositeTransaction).
  const effectiveNature = newData.transferNature ?? prevData.transferNature;
  if (
    isTwoLegTransfer(prevData.transferNature) &&
    prevData.transferId &&
    (newData.destinationAmount !== undefined ||
      // A base-leg amount edit on a same-currency pair rewrites the loan-side
      // income leg to the same value (see `updateTransferTransaction`), so it
      // moves the loan balance and must pass the overpay assertion too.
      newData.amount !== undefined ||
      newData.destinationAccountId !== undefined ||
      // A date edit can carry the payment across the loan's balance anchor
      // (informational → counted), so it must pass the overpay assertion too.
      newData.time !== undefined)
  ) {
    // Unscoped on purpose: a shared cross-user pair's opposite leg lives on the other
    // user's account. Ownership is enforced by `assertLoanPaymentAllowed`'s row lock.
    const oppositeLeg = await findOneTransaction({
      planned: 'include',
      access: 'unscoped-internal',
      balanceAdjustments: 'include',
      where: { transferId: prevData.transferId, id: { [Op.ne]: prevData.id } },
      attributes: ['id', 'accountId', 'amount', 'currencyCode'],
    });
    if (oppositeLeg) {
      const destinationAccountId = newData.destinationAccountId ?? oppositeLeg.accountId;
      const isSameDestination = destinationAccountId === oppositeLeg.accountId;

      // Deliberately not scoped by userId: on a shared cross-user pair the
      // opposite leg can live on another user's account, and an owner-scoped
      // lookup would 404 a plain amount edit. Ownership is still enforced by
      // `assertLoanPaymentAllowed`'s (id, ownerUserId) lock and by
      // `updateTransferTransaction`'s currency lookup on a re-point.
      const destAccount = await Accounts.default.findOne({
        where: { id: destinationAccountId },
        attributes: ['accountCategory', 'currencyCode'],
      });
      if (!destAccount) {
        throw new NotFoundError({ message: t({ key: 'accounts.accountNotFoundForTransaction' }) });
      }
      const isLoanDestination = destAccount.accountCategory === ACCOUNT_CATEGORIES.loan;

      if (effectiveNature === TRANSACTION_TRANSFER_NATURE.transfer_to_loan && !isLoanDestination) {
        throw new ValidationError({
          message: t({ key: 'transactions.transferToLoanRequiresLoanDestination' }),
        });
      }
      if (effectiveNature !== TRANSACTION_TRANSFER_NATURE.transfer_to_loan && isLoanDestination && !isSameDestination) {
        throw new ValidationError({
          message: t({ key: 'transactions.transferToLoanRelinkRequired' }),
        });
      }
      if (isLoanDestination) {
        // A base-amount edit without an explicit destinationAmount rewrites the
        // loan-side income leg 1:1 when the pair shares a currency (see
        // `updateTransferTransaction`), so the overpay projection must use the
        // incoming base amount. On a cross-currency pair no amount can be
        // implied — `updateTransferTransaction` rejects such an edit unless
        // destinationAmount is provided explicitly.
        let impliedDestinationAmount: Money | undefined;
        if (newData.destinationAmount === undefined && newData.amount !== undefined) {
          let baseLegCurrencyCode = prevData.currencyCode;
          if (newData.accountId && newData.accountId !== prevData.accountId) {
            const { currency: newBaseCurrency } = await Accounts.getAccountCurrency({
              userId: callerUserId,
              id: newData.accountId,
            });
            baseLegCurrencyCode = newBaseCurrency.code;
          }
          impliedDestinationAmount = deriveImpliedDestinationAmount({
            baseAmount: newData.amount,
            destinationAmount: newData.destinationAmount,
            baseLegCurrencyCode,
            destinationLegCurrencyCode: destAccount.currencyCode,
          });
        }

        await assertLoanPaymentAllowed({
          ownerUserId: accountOwnerUserId,
          loanAccountId: destinationAccountId,
          newLegAmount: newData.destinationAmount ?? impliedDestinationAmount ?? oppositeLeg.amount,
          // The old leg is part of this loan's balance only when the
          // destination stays put; on a re-point the new loan never saw it.
          currentLegAmount: isSameDestination ? oppositeLeg.amount : null,
          // Pre-edit date of the pair — decides whether the replaced leg is
          // post-anchor (counted) or informational.
          currentLegDate: isSameDestination ? prevData.time : null,
          // Effective post-update date; both legs share it.
          paymentDate: newData.time ?? prevData.time,
        });
      }
    }
  }
};

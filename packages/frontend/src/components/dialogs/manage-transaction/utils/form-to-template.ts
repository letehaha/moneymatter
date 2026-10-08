import {
  type RecordId,
  type TransactionTemplateModel,
  TRANSACTION_TYPES,
  type CreateTransactionTemplateBody,
} from '@bt/shared/types';

import { FORM_TYPES, type UI_FORM_STRUCT } from '../types';
import { isPinnableTemplateAccount } from './template-to-form';

export const formToTemplate = ({
  form,
  base,
}: {
  form: UI_FORM_STRUCT;
  /** The template being updated; its null account/amount are user choices to preserve. */
  base?: TransactionTemplateModel;
}): Omit<CreateTransactionTemplateBody, 'name'> => {
  if (form.type === FORM_TYPES.transfer) {
    throw new Error('A transfer cannot be saved as a transaction template');
  }

  // The out-of-wallet placeholder has no id, so it can never be pinned.
  const isPinnable = Boolean(form.account?.id) && isPinnableTemplateAccount({ account: form.account! });
  const keepsCurrentAccount = base?.accountId === null;
  const accountId = isPinnable && !keepsCurrentAccount ? form.account!.id : null;

  const note = form.note?.trim();

  return {
    transactionType: form.type === FORM_TYPES.income ? TRANSACTION_TYPES.income : TRANSACTION_TYPES.expense,
    accountId,
    amount: accountId === null || base?.amount === null ? null : (form.amount ?? null),
    // The form seeds an arbitrary first category, so only an explicit pick is a choice.
    categoryId: form.categoryUserTouched ? (form.category?.id ?? null) : null,
    payeeId: (form.payeeId as RecordId | null | undefined) ?? null,
    tagIds: (form.tagIds ?? []) as RecordId[],
    paymentType: form.paymentType?.value ?? null,
    note: note || null,
    originalCurrencyCode: form.originalCurrency?.code ?? null,
  };
};

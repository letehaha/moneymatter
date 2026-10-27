import { FORM_TYPES, type TransactionPrefill, type UI_FORM_STRUCT } from '../types';

// A linked transaction can't join a second payment, and a saved part's id would point at the source row.
const duplicatePaymentLegs = ({ legs }: { legs: UI_FORM_STRUCT['paymentLegs'] }) => {
  const copies = legs?.filter((leg) => !leg.isLinked).map((leg) => ({ ...leg, transactionId: undefined }));
  return copies?.length ? copies : undefined;
};

export const formToDuplicatePrefill = ({ form, now }: { form: UI_FORM_STRUCT; now: Date }): TransactionPrefill => {
  const common = {
    type: form.type,
    account: form.account,
    amount: form.amount ?? null,
    time: now,
    tagIds: [...(form.tagIds ?? [])],
    paymentType: form.paymentType,
    note: form.note,
  };

  // The form keeps the source leg in account/amount and the destination in toAccount/targetAmount,
  // so copying them as-is preserves the transfer direction.
  if (form.type === FORM_TYPES.transfer) {
    return {
      ...common,
      toAccount: form.toAccount ?? null,
      targetAmount: form.targetAmount ?? null,
      originalAmount: null,
      originalCurrency: null,
    };
  }

  return {
    ...common,
    externalUrl: form.externalUrl,
    externalReference: form.externalReference,
    latitude: form.latitude,
    longitude: form.longitude,
    category: form.category,
    payeeId: form.payeeId ?? null,
    originalAmount: form.originalAmount ?? null,
    originalCurrency: form.originalCurrency ?? null,
    isPlanned: Boolean(form.isPlanned),
    splits: form.splits?.map(({ category, amount, note }) => ({ category, amount, note })),
    paymentLegs: duplicatePaymentLegs({ legs: form.paymentLegs }),
  };
};

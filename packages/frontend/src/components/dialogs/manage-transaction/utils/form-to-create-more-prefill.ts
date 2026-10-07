import { isAfter } from 'date-fns';

import { isConnectedAccount } from '../helpers';
import { FORM_TYPES, type TransactionPrefill, type UI_FORM_STRUCT } from '../types';

export const formToCreateMorePrefill = ({ form, now }: { form: UI_FORM_STRUCT; now: Date }): TransactionPrefill => {
  // Only a bank-connected account turns the planned mode back on, and a plain row can't be dated in the future.
  const isPlannedRestored =
    form.type !== FORM_TYPES.transfer && !!form.account && isConnectedAccount({ account: form.account });
  return {
    type: form.type,
    account: form.account,
    toAccount: form.type === FORM_TYPES.transfer ? (form.toAccount ?? null) : null,
    amount: null,
    time: !isPlannedRestored && isAfter(form.time, now) ? now : form.time,
    paymentType: form.paymentType,
  };
};

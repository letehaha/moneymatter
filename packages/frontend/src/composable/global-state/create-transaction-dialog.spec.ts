import { FORM_TYPES, type TransactionPrefill } from '@/components/dialogs/manage-transaction/types';
import { beforeEach, describe, expect, it } from 'vitest';
import { nextTick } from 'vue';

import {
  createTransactionPrefill,
  isCreateTransactionDialogOpen,
  openCreateTransactionDialog,
} from './create-transaction-dialog';

const prefill = { type: FORM_TYPES.expense, account: null, amount: 10, time: new Date() } as TransactionPrefill;

describe('create-transaction-dialog', () => {
  beforeEach(() => {
    isCreateTransactionDialogOpen.value = false;
    createTransactionPrefill.value = undefined;
  });

  it('opens prefilled and clears the prefill once closed', async () => {
    openCreateTransactionDialog({ prefill });

    expect(isCreateTransactionDialogOpen.value).toBe(true);
    expect(createTransactionPrefill.value).toBe(prefill);

    isCreateTransactionDialogOpen.value = false;
    await nextTick();

    expect(createTransactionPrefill.value).toBeUndefined();
  });

  it('clears the prefill synchronously when closed in the same tick it opened', () => {
    openCreateTransactionDialog({ prefill });
    isCreateTransactionDialogOpen.value = false;

    expect(createTransactionPrefill.value).toBeUndefined();
  });

  it('replaces the prefill when opened again while already open', () => {
    const nextPrefill = { ...prefill, amount: 20 } as TransactionPrefill;

    openCreateTransactionDialog({ prefill });
    openCreateTransactionDialog({ prefill: nextPrefill });

    expect(isCreateTransactionDialogOpen.value).toBe(true);
    expect(createTransactionPrefill.value).toBe(nextPrefill);
  });
});

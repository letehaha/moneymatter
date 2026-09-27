import { editTransaction } from '@/api';
import { VUE_QUERY_GLOBAL_PREFIXES } from '@/common/const';
import {
  applyOptimisticTransactionUpdate,
  rollbackOptimisticUpdate,
} from '@/components/dialogs/manage-transaction/utils';
import { useNotificationCenter } from '@/components/notification-center';
import {
  ApiErrorResponseError,
  AuthError,
  NetworkError,
  UnexpectedError,
  extractApiErrorMessage,
  isApiErrorWithCode,
} from '@/js/errors';
import { captureException } from '@/lib/sentry';
import { useTagsStore } from '@/stores';
import { API_ERROR_CODES, type TransactionModel } from '@bt/shared/types';
import type { UpdateTransactionBody } from '@bt/shared/types/endpoints';
import { useQueryClient } from '@tanstack/vue-query';
import { storeToRefs } from 'pinia';
import { reactive } from 'vue';
import { useI18n } from 'vue-i18n';

import { TABLE_COLUMN } from './columns';
import { buildInlineEditPreview } from './inline-edit-payload';

export type InlineCellSaveState = 'pending' | 'saved';

const SAVED_FLASH_MS = 1600;

export const inlineCellKey = ({ txId, column }: { txId: string; column: TABLE_COLUMN }) => `${txId}:${column}`;

// Keyed by tx id, not held in the row: every save changes updatedAt, which is part of the row key and remounts it.
export const useInlineTransactionEdit = () => {
  const queryClient = useQueryClient();
  const { addErrorNotification } = useNotificationCenter();
  const { t } = useI18n();
  const { tags } = storeToRefs(useTagsStore());

  const cellStates = reactive(new Map<string, InlineCellSaveState>());

  const save = async ({
    tx,
    column,
    columnLabel,
    body,
  }: {
    tx: TransactionModel;
    column: TABLE_COLUMN;
    columnLabel: string;
    body: UpdateTransactionBody;
  }) => {
    // The server recomputes refAmount from amount, date and account currency.
    const touchesRefAmount = body.amount !== undefined || body.time !== undefined || body.accountId !== undefined;
    const keys = [column, ...(touchesRefAmount ? [TABLE_COLUMN.refAmount] : [])].map((c) =>
      inlineCellKey({ txId: tx.id, column: c }),
    );
    keys.forEach((key) => cellStates.set(key, 'pending'));

    let context: ReturnType<typeof applyOptimisticTransactionUpdate> | undefined;
    try {
      await queryClient.cancelQueries({ queryKey: [VUE_QUERY_GLOBAL_PREFIXES.transactionChange] });
      context = applyOptimisticTransactionUpdate({
        queryClient,
        transactionId: tx.id,
        updatedTransaction: buildInlineEditPreview({ tx, body, tags: tags.value }),
      });

      await editTransaction({ txId: tx.id, ...body });
      // Awaited so the pending state lasts until server-derived values (refAmount, currency) land.
      await queryClient.invalidateQueries({ queryKey: [VUE_QUERY_GLOBAL_PREFIXES.transactionChange] });
      keys.forEach((key) => cellStates.set(key, 'saved'));
      setTimeout(
        () => keys.forEach((key) => cellStates.get(key) === 'saved' && cellStates.delete(key)),
        SAVED_FLASH_MS,
      );
    } catch (error) {
      // The snapshot can predate an overlapping save that succeeded, so refetch after restoring it.
      if (context) rollbackOptimisticUpdate({ queryClient, context });
      void queryClient.invalidateQueries({ queryKey: [VUE_QUERY_GLOBAL_PREFIXES.transactionChange] });
      keys.forEach((key) => cellStates.delete(key));

      // The API client already toasts these.
      if (
        error instanceof AuthError ||
        error instanceof NetworkError ||
        error instanceof UnexpectedError ||
        isApiErrorWithCode(error, API_ERROR_CODES.planRequired)
      ) {
        return;
      }
      if (!(error instanceof ApiErrorResponseError)) {
        captureException({ error, context: { scope: 'transactions-table:inline-edit' } });
      }
      addErrorNotification(
        extractApiErrorMessage(error) || t('transactions.inlineEdit.saveFailed', { field: columnLabel }),
      );
    }
  };

  return { cellStates, save };
};

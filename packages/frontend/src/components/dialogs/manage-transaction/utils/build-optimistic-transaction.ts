import { VUE_QUERY_GLOBAL_PREFIXES } from '@/common/const';
import type { TagModel, TransactionModel, RecordId } from '@bt/shared/types';
import type { InfiniteData, QueryClient } from '@tanstack/vue-query';
import { toRaw } from 'vue';

import {
  getTxTypeFromFormType,
  isTxEditableAsManual,
  resolveFormIsPlanned,
  resolveOriginalCurrencyPair,
} from '../helpers';
import { FORM_TYPES, type UI_FORM_STRUCT } from '../types';
import { resolveFormLocation } from './resolve-form-location';

interface BuildOptimisticTransactionParams {
  form: UI_FORM_STRUCT;
  transaction: TransactionModel;
  isRecordBankLocked: boolean;
}

/**
 * Builds an optimistically updated transaction from form data.
 * Only updates fields that can be changed via the edit form.
 *
 * IMPORTANT: All values must be plain (non-reactive) to avoid storing Vue
 * Proxy objects in the query cache, which would break structuredClone/JSON
 * cloning in subsequent optimistic updates.
 */
export const buildOptimisticTransaction = ({
  form,
  transaction,
  isRecordBankLocked,
}: BuildOptimisticTransactionParams): TransactionModel => {
  // Unwrap reactive proxy from transaction to get plain nested objects
  const rawTransaction = toRaw(transaction);
  const location = resolveFormLocation(form);

  const updatedTransaction: TransactionModel = {
    ...rawTransaction,
    note: form.note ?? '',
    externalUrl: form.externalUrl === undefined ? rawTransaction.externalUrl : form.externalUrl.trim() || null,
    externalReference:
      form.externalReference === undefined ? rawTransaction.externalReference : form.externalReference.trim() || null,
    location: location === undefined ? rawTransaction.location : location,
    paymentType: form.paymentType!.value,
    isPlanned: resolveFormIsPlanned({ form }),
    excludeFromStats: Boolean(form.excludeFromStats),
    updatedAt: new Date(),
  };

  if (isTxEditableAsManual({ transaction: rawTransaction, isRecordBankLocked })) {
    updatedTransaction.amount = Number(form.amount);
    updatedTransaction.time = new Date(form.time);
    updatedTransaction.transactionType = getTxTypeFromFormType(form.type);
    updatedTransaction.accountId = form.account?.id ?? rawTransaction.accountId;
  }

  // Update category if not a transfer
  if (form.category?.id) {
    updatedTransaction.categoryId = form.category.id;
  }

  // Never touch the pair on a transfer: the payload omits both fields there, so writing the
  // form values would show a pair the save never stored.
  if (form.type !== FORM_TYPES.transfer) {
    const originalPair = resolveOriginalCurrencyPair({ form });
    if (originalPair.state === 'pair') {
      updatedTransaction.originalAmount = originalPair.originalAmount;
      updatedTransaction.originalCurrencyCode = originalPair.originalCurrencyCode;
    } else if (originalPair.state === 'clear') {
      updatedTransaction.originalAmount = null;
      updatedTransaction.originalCurrencyCode = null;
    }
  }

  // Update tags optimistically
  if (form.tagIds !== undefined) {
    updatedTransaction.tags = toRaw(form.tagIds).map(
      (id): TagModel => ({
        id: id as RecordId,
        userId: rawTransaction.userId,
        name: '',
        color: '',
        icon: null,
        description: null,
        createdAt: new Date(),
      }),
    );
  }

  return updatedTransaction;
};

// A page is not always a transaction array: some queries page as
// `{ items, totalCount }`, others hold rows that aren't transactions at all.
type TransactionPage = TransactionModel[] | { items: TransactionModel[] } | unknown;
type InfiniteTransactionData = InfiniteData<TransactionPage, unknown>;

interface OptimisticUpdateContext {
  previousQueries: Map<string, unknown>;
}

/**
 * Optimistically updates a transaction in all relevant Vue Query caches.
 * Returns a context object that can be used to rollback on error.
 */
export const applyOptimisticTransactionUpdate = ({
  queryClient,
  transactionId,
  updatedTransaction,
}: {
  queryClient: QueryClient;
  transactionId: string;
  updatedTransaction: TransactionModel;
}): OptimisticUpdateContext => {
  const previousQueries = new Map<string, unknown>();

  // Get all queries that might contain transactions
  const allQueries = queryClient.getQueryCache().getAll();

  // Filter to transaction-related queries (those with transactionChange prefix)
  const transactionQueries = allQueries.filter((query) => {
    const queryKey = query.queryKey;
    return Array.isArray(queryKey) && queryKey.some((key) => key === VUE_QUERY_GLOBAL_PREFIXES.transactionChange);
  });

  for (const query of transactionQueries) {
    const queryKey = query.queryKey;
    const queryKeyString = JSON.stringify(queryKey);
    const currentData = query.state.data;

    if (!currentData) continue;

    // Store previous data for rollback.
    // Use JSON clone instead of structuredClone because cache data may contain
    // Vue reactive Proxies (from prior optimistic updates that haven't been
    // replaced by a refetch yet), and structuredClone cannot handle Proxy objects.
    previousQueries.set(queryKeyString, JSON.parse(JSON.stringify(currentData)));

    // Handle infinite query data (paginated lists)
    if (isInfiniteQueryData(currentData)) {
      queryClient.setQueryData(queryKey, (oldData: InfiniteTransactionData | undefined) => {
        if (!oldData) return oldData;

        return {
          ...oldData,
          pages: oldData.pages.map((page) => replaceTransactionInPage({ page, transactionId, updatedTransaction })),
        };
      });
    }
    // Handle single transaction queries
    else if (isSingleTransaction(currentData)) {
      if (currentData.id === transactionId) {
        queryClient.setQueryData(queryKey, updatedTransaction);
      }
    }
    // Handle array of transactions (non-paginated)
    else if (isTransactionArray(currentData)) {
      queryClient.setQueryData(queryKey, (oldData: TransactionModel[] | undefined) => {
        if (!oldData) return oldData;
        return oldData.map((tx) => (tx.id === transactionId ? updatedTransaction : tx));
      });
    }
  }

  return { previousQueries };
};

/**
 * Rolls back optimistic updates using the stored previous query data.
 */
export const rollbackOptimisticUpdate = ({
  queryClient,
  context,
}: {
  queryClient: QueryClient;
  context: OptimisticUpdateContext;
}): void => {
  for (const [queryKeyString, previousData] of context.previousQueries) {
    const queryKey = JSON.parse(queryKeyString);
    queryClient.setQueryData(queryKey, previousData);
  }
};

function replaceTransactionInPage({
  page,
  transactionId,
  updatedTransaction,
}: {
  page: TransactionPage;
  transactionId: string;
  updatedTransaction: TransactionModel;
}): TransactionPage {
  const swap = (tx: TransactionModel) => (tx.id === transactionId ? updatedTransaction : tx);

  if (isTransactionArray(page)) return page.map(swap);

  if (isItemsPage(page)) return { ...page, items: page.items.map(swap) };

  return page;
}

// Type guards
function isInfiniteQueryData(data: unknown): data is InfiniteTransactionData {
  return (
    typeof data === 'object' &&
    data !== null &&
    'pages' in data &&
    'pageParams' in data &&
    Array.isArray((data as InfiniteTransactionData).pages)
  );
}

function isSingleTransaction(data: unknown): data is TransactionModel {
  return (
    typeof data === 'object' &&
    data !== null &&
    'id' in data &&
    'amount' in data &&
    'transactionType' in data &&
    !Array.isArray(data)
  );
}

function isItemsPage(data: unknown): data is { items: TransactionModel[] } {
  return (
    typeof data === 'object' &&
    data !== null &&
    'items' in data &&
    isTransactionArray((data as { items: unknown }).items)
  );
}

function isTransactionArray(data: unknown): data is TransactionModel[] {
  if (!Array.isArray(data)) return false;
  // Empty arrays are valid transaction arrays - preserve them for rollback
  if (data.length === 0) return true;
  // Check first element to verify it's a transaction
  const first = data[0];
  return (
    typeof first === 'object' && first !== null && 'id' in first && 'amount' in first && 'transactionType' in first
  );
}

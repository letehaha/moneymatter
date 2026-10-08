import {
  createTransactionTemplate,
  deleteTransactionTemplate,
  loadTransactionTemplates,
  updateTransactionTemplate,
} from '@/api/transaction-templates';
import { VUE_QUERY_CACHE_KEYS } from '@/common/const';
import {
  API_ERROR_CODES,
  type TransactionTemplateModel,
  type CreateTransactionTemplateBody,
  type UpdateTransactionTemplateBody,
} from '@bt/shared/types';
import { useQuery } from '@tanstack/vue-query';
import { type MaybeRefOrGetter, computed, toValue } from 'vue';

import { useInvalidatingMutation } from './use-invalidating-mutation';

export const useTransactionTemplates = ({ enabled }: { enabled?: MaybeRefOrGetter<boolean> } = {}) => {
  const query = useQuery({
    queryKey: VUE_QUERY_CACHE_KEYS.transactionTemplatesList,
    queryFn: loadTransactionTemplates,
    enabled: computed(() => (enabled === undefined ? true : toValue(enabled))),
  });

  const list = computed<TransactionTemplateModel[]>(() => query.data.value ?? []);

  return { ...query, list };
};

const useTransactionTemplateMutation = <TVariables, TData>({
  mutationFn,
  errorKey,
  silentErrorCodes,
}: {
  mutationFn: (variables: TVariables) => Promise<TData>;
  errorKey: string;
  silentErrorCodes?: API_ERROR_CODES[];
}) =>
  useInvalidatingMutation<TData, TVariables>({
    mutationFn,
    invalidateKeys: [VUE_QUERY_CACHE_KEYS.transactionTemplatesList],
    errorKey,
    silentErrorCodes,
  });

export const useCreateTransactionTemplate = () =>
  useTransactionTemplateMutation({
    mutationFn: ({ payload }: { payload: CreateTransactionTemplateBody }) => createTransactionTemplate({ payload }),
    errorKey: 'dialogs.manageTransaction.templates.errors.create',
    silentErrorCodes: [API_ERROR_CODES.conflict],
  });

export const useUpdateTransactionTemplate = () =>
  useTransactionTemplateMutation({
    mutationFn: ({ id, payload }: { id: string; payload: UpdateTransactionTemplateBody }) =>
      updateTransactionTemplate({ id, payload }),
    errorKey: 'dialogs.manageTransaction.templates.errors.update',
    silentErrorCodes: [API_ERROR_CODES.conflict],
  });

export const useDeleteTransactionTemplate = () =>
  useTransactionTemplateMutation({
    mutationFn: ({ id }: { id: string }) => deleteTransactionTemplate({ id }),
    errorKey: 'dialogs.manageTransaction.templates.errors.delete',
  });

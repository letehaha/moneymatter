import type { CreateTransactionTemplateBody, UpdateTransactionTemplateBody } from '@bt/shared/types';
import type {
  createTransactionTemplate as apiCreateTransactionTemplate,
  deleteTransactionTemplate as apiDeleteTransactionTemplate,
  getTransactionTemplates as apiGetTransactionTemplates,
  updateTransactionTemplate as apiUpdateTransactionTemplate,
} from '@services/transaction-templates';

import { makeRequest } from './common';

export async function getTransactionTemplates<R extends boolean | undefined = undefined>({ raw }: { raw?: R } = {}) {
  return makeRequest<Awaited<ReturnType<typeof apiGetTransactionTemplates>>, R>({
    method: 'get',
    url: '/transaction-templates',
    raw,
  });
}

export async function createTransactionTemplate<R extends boolean | undefined = undefined>({
  payload,
  raw,
}: {
  payload: CreateTransactionTemplateBody;
  raw?: R;
}) {
  return makeRequest<Awaited<ReturnType<typeof apiCreateTransactionTemplate>>, R>({
    method: 'post',
    url: '/transaction-templates',
    payload,
    raw,
  });
}

export async function updateTransactionTemplate<R extends boolean | undefined = undefined>({
  id,
  payload,
  raw,
}: {
  id: string;
  payload: UpdateTransactionTemplateBody;
  raw?: R;
}) {
  return makeRequest<Awaited<ReturnType<typeof apiUpdateTransactionTemplate>>, R>({
    method: 'put',
    url: `/transaction-templates/${id}`,
    payload,
    raw,
  });
}

export async function deleteTransactionTemplate<R extends boolean | undefined = undefined>({
  id,
  raw,
}: {
  id: string;
  raw?: R;
}) {
  return makeRequest<Awaited<ReturnType<typeof apiDeleteTransactionTemplate>>, R>({
    method: 'delete',
    url: `/transaction-templates/${id}`,
    raw,
  });
}

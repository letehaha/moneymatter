import { CategoryModel } from '@bt/shared/types';
import * as helpers from '@tests/helpers';
import { Response } from 'express';

interface BaseCreationPayload {
  parentId?: string;
  name?: string;
  color?: string;
  defaultTagIds?: string[];
  applyDefaultTagsOnAiCategorization?: boolean;
}
export async function addCustomCategory({ raw, ...params }: BaseCreationPayload & { raw?: false }): Promise<Response>;
export async function addCustomCategory({
  raw,
  ...params
}: BaseCreationPayload & { raw?: true }): Promise<CategoryModel>;
export async function addCustomCategory({
  raw = true,
  ...params
}: BaseCreationPayload & {
  raw?: boolean;
}): Promise<Response | CategoryModel> {
  const result = await helpers.makeRequest({
    method: 'post',
    url: '/categories',
    payload: params,
    raw,
  });

  return result;
}

interface BaseUpdationPayload {
  categoryId: string;
  name?: string;
  color?: string;
  icon?: string | null;
  parentId?: string | null;
  defaultTagIds?: string[];
  applyDefaultTagsOnAiCategorization?: boolean;
}
export async function editCustomCategory({ raw, ...params }: BaseUpdationPayload & { raw?: false }): Promise<Response>;
export async function editCustomCategory({
  raw,
  ...params
}: BaseUpdationPayload & { raw?: true }): Promise<CategoryModel[]>;
export async function editCustomCategory({
  categoryId,
  raw = true,
  ...params
}: BaseUpdationPayload & {
  raw?: boolean;
}): Promise<Response | CategoryModel[]> {
  const result = await helpers.makeRequest({
    method: 'put',
    url: `/categories/${categoryId}`,
    payload: params,
    raw,
  });

  return result;
}

/**
 * Strip undefined fields so they don't end up serialized as the literal string "undefined"
 * in the query string (URLSearchParams happily turns `undefined` into `"undefined"`, which
 * then trips `z.coerce.boolean()` into truthy and breaks downstream validation).
 */
const compactParams = <T extends Record<string, unknown>>(params: T | undefined): Record<string, unknown> | null => {
  if (!params) return null;
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined) out[key] = value;
  }
  return Object.keys(out).length > 0 ? out : null;
};

export const getCategoriesList = async (params?: {
  accountId?: string;
  includeAccessible?: boolean;
}): Promise<CategoryModel[]> => {
  const result = await helpers.makeRequest({
    method: 'get',
    url: '/categories',
    payload: compactParams(params),
    raw: true,
  });

  return result;
};

export const getCategoriesListResponse = async (params?: { accountId?: string; includeAccessible?: boolean }) => {
  return helpers.makeRequest({
    method: 'get',
    url: '/categories',
    payload: compactParams(params),
  });
};

export function getCategoryTransactionCount<R extends boolean | undefined = undefined>({
  categoryId,
  raw,
}: {
  categoryId: string;
  raw?: R;
}) {
  return helpers.makeRequest<{ transactionCount: number }, R>({
    method: 'get',
    url: `/categories/${categoryId}/transaction-count`,
    raw,
  });
}

export async function deleteCustomCategory({
  raw,
  ...params
}: {
  categoryId?: string;
  replaceWithCategoryId?: string;
  raw?: false;
}): Promise<Response>;
export async function deleteCustomCategory({
  raw,
  ...params
}: {
  categoryId?: string;
  replaceWithCategoryId?: string;
  raw?: true;
}): Promise<CategoryModel[]>;
export async function deleteCustomCategory({
  categoryId,
  replaceWithCategoryId,
  raw = true,
}: {
  categoryId?: string;
  replaceWithCategoryId?: string;
  raw?: boolean;
}): Promise<Response | CategoryModel[]> {
  const result = await helpers.makeRequest({
    method: 'delete',
    url: `/categories/${categoryId}`,
    payload: replaceWithCategoryId ? { replaceWithCategoryId } : null,
    raw,
  });

  return result;
}

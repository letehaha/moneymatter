import type { RecordId, TagModel, TransactionModel } from '@bt/shared/types';
import type { UpdateTransactionBody } from '@bt/shared/types/endpoints';
import { startOfMinute } from 'date-fns';
import { toRaw } from 'vue';

import { TABLE_COLUMN } from './columns';
import type { InlineEditableColumn } from './inline-cell-mode';

export const MAX_TAGS = 20;

export interface InlineEditForm {
  date: Date;
  account: { id: RecordId } | null;
  category: { id: RecordId } | null;
  payeeId: RecordId | null;
  amount: number | null;
  note: string;
  tagIds: string[];
}

export const buildInlineEditBody = ({
  column,
  form,
}: {
  column: InlineEditableColumn;
  form: InlineEditForm;
}): UpdateTransactionBody | null => {
  switch (column) {
    case TABLE_COLUMN.date:
      return { time: form.date.toISOString() };
    case TABLE_COLUMN.account:
      return form.account ? { accountId: form.account.id } : null;
    case TABLE_COLUMN.category:
      return form.category ? { categoryId: form.category.id } : null;
    case TABLE_COLUMN.payee:
      return { payeeId: form.payeeId };
    // The server's positive-amount check for plans runs on create only.
    case TABLE_COLUMN.amount:
      return form.amount !== null && form.amount > 0 ? { amount: form.amount } : null;
    case TABLE_COLUMN.note:
      return { note: form.note };
    case TABLE_COLUMN.tags:
      return form.tagIds.length <= MAX_TAGS ? { tagIds: form.tagIds } : null;
  }
};

// The date input has no seconds; comparing them would flag an untouched date as changed.
const toComparable = ({ time, tagIds, ...rest }: UpdateTransactionBody) => ({
  ...rest,
  time: time === undefined ? undefined : startOfMinute(new Date(time)).getTime(),
  tagIds: tagIds ? [...tagIds].sort() : tagIds,
});

export const canSaveInlineEdit = ({ tx, body }: { tx: TransactionModel; body: UpdateTransactionBody | null }) => {
  if (!body) return false;

  const next = toComparable(body);
  const original = toComparable({
    time: new Date(tx.time).toISOString(),
    accountId: tx.accountId,
    categoryId: tx.categoryId,
    payeeId: tx.payeeId ?? null,
    amount: tx.amount,
    note: tx.note ?? '',
    tagIds: (tx.tags ?? []).map((tag) => tag.id),
  });

  return (Object.keys(body) as (keyof typeof next)[]).some(
    (key) => JSON.stringify(next[key]) !== JSON.stringify(original[key]),
  );
};

// Cache values must be plain objects: Vue proxies break structuredClone of the cache.
export const buildInlineEditPreview = ({
  tx,
  body,
  tags,
}: {
  tx: TransactionModel;
  body: UpdateTransactionBody;
  tags: TagModel[];
}): TransactionModel => {
  const preview: TransactionModel = { ...toRaw(tx) };

  if (body.time !== undefined) preview.time = new Date(body.time);
  if (body.accountId !== undefined) preview.accountId = body.accountId;
  if (body.categoryId !== undefined) preview.categoryId = body.categoryId;
  if (body.payeeId !== undefined) preview.payeeId = body.payeeId;
  if (body.amount !== undefined) preview.amount = body.amount;
  if (body.note !== undefined) preview.note = body.note;
  if (body.tagIds !== undefined) {
    const ids = body.tagIds ?? [];
    preview.tags = tags.filter((tag) => ids.includes(tag.id)).map((tag) => toRaw(tag));
  }

  return preview;
};

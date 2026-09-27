import type { RecordId, TagModel, TransactionModel } from '@bt/shared/types';
import { describe, expect, it } from 'vitest';
import { isProxy, reactive } from 'vue';

import { TABLE_COLUMN } from './columns';
import type { InlineEditableColumn } from './inline-cell-mode';
import {
  type InlineEditForm,
  MAX_TAGS,
  buildInlineEditBody,
  buildInlineEditPreview,
  canSaveInlineEdit,
} from './inline-edit-payload';

const tagIds = ({ count }: { count: number }) => Array.from({ length: count }, (_, index) => `tag-${index}`);

const buildTx = (overrides: Partial<TransactionModel> = {}) =>
  ({
    id: 'tx-1',
    time: new Date('2030-01-15T10:30:00.000Z'),
    accountId: 'acc-1',
    categoryId: 'cat-1',
    payeeId: 'payee-1',
    amount: 100,
    note: 'coffee',
    tags: [{ id: 'tag-a' }, { id: 'tag-b' }] as TagModel[],
    ...overrides,
  }) as TransactionModel;

const buildForm = (overrides: Partial<InlineEditForm> = {}): InlineEditForm => ({
  date: new Date('2030-01-15T10:30:00.000Z'),
  account: { id: 'acc-1' as RecordId },
  category: { id: 'cat-1' as RecordId },
  payeeId: 'payee-1' as RecordId,
  amount: 100,
  note: 'coffee',
  tagIds: ['tag-a', 'tag-b'],
  ...overrides,
});

const bodyFor = ({ column, form }: { column: InlineEditableColumn; form: Partial<InlineEditForm> }) =>
  buildInlineEditBody({ column, form: buildForm(form) });

describe('buildInlineEditBody', () => {
  it.each<[string, InlineEditableColumn, Partial<InlineEditForm>, unknown]>([
    ['date', TABLE_COLUMN.date, {}, { time: '2030-01-15T10:30:00.000Z' }],
    ['account', TABLE_COLUMN.account, { account: { id: 'acc-2' as RecordId } }, { accountId: 'acc-2' }],
    ['cleared account', TABLE_COLUMN.account, { account: null }, null],
    ['category', TABLE_COLUMN.category, { category: { id: 'cat-2' as RecordId } }, { categoryId: 'cat-2' }],
    ['cleared category', TABLE_COLUMN.category, { category: null }, null],
    ['payee', TABLE_COLUMN.payee, { payeeId: 'payee-2' as RecordId }, { payeeId: 'payee-2' }],
    ['cleared payee', TABLE_COLUMN.payee, { payeeId: null }, { payeeId: null }],
    ['positive amount', TABLE_COLUMN.amount, { amount: 0.01 }, { amount: 0.01 }],
    ['zero amount', TABLE_COLUMN.amount, { amount: 0 }, null],
    ['negative amount', TABLE_COLUMN.amount, { amount: -5 }, null],
    ['empty amount', TABLE_COLUMN.amount, { amount: null }, null],
    ['note', TABLE_COLUMN.note, { note: '' }, { note: '' }],
    [
      `${MAX_TAGS} tags`,
      TABLE_COLUMN.tags,
      { tagIds: tagIds({ count: MAX_TAGS }) },
      { tagIds: tagIds({ count: MAX_TAGS }) },
    ],
    [`${MAX_TAGS + 1} tags`, TABLE_COLUMN.tags, { tagIds: tagIds({ count: MAX_TAGS + 1 }) }, null],
  ])('%s', (_, column, form, expected) => {
    expect(bodyFor({ column, form })).toEqual(expected);
  });
});

describe('canSaveInlineEdit', () => {
  const canSave = ({ column, form }: { column: InlineEditableColumn; form: Partial<InlineEditForm> }) =>
    canSaveInlineEdit({ tx: buildTx(), body: bodyFor({ column, form }) });

  it.each<InlineEditableColumn>([
    TABLE_COLUMN.date,
    TABLE_COLUMN.account,
    TABLE_COLUMN.category,
    TABLE_COLUMN.payee,
    TABLE_COLUMN.amount,
    TABLE_COLUMN.note,
    TABLE_COLUMN.tags,
  ])('is false for an unchanged %s', (column) => {
    expect(canSave({ column, form: {} })).toBe(false);
  });

  it.each<[string, InlineEditableColumn, Partial<InlineEditForm>]>([
    ['date in another minute', TABLE_COLUMN.date, { date: new Date('2030-01-15T10:31:00.000Z') }],
    ['account', TABLE_COLUMN.account, { account: { id: 'acc-2' as RecordId } }],
    ['category', TABLE_COLUMN.category, { category: { id: 'cat-2' as RecordId } }],
    ['cleared payee', TABLE_COLUMN.payee, { payeeId: null }],
    ['amount', TABLE_COLUMN.amount, { amount: 101 }],
    ['note', TABLE_COLUMN.note, { note: 'tea' }],
    ['tags', TABLE_COLUMN.tags, { tagIds: ['tag-a'] }],
  ])('is true for a changed %s', (_, column, form) => {
    expect(canSave({ column, form })).toBe(true);
  });

  it('ignores seconds within the same minute', () => {
    expect(canSave({ column: TABLE_COLUMN.date, form: { date: new Date('2030-01-15T10:30:45.000Z') } })).toBe(false);
  });

  it('ignores tag order', () => {
    expect(canSave({ column: TABLE_COLUMN.tags, form: { tagIds: ['tag-b', 'tag-a'] } })).toBe(false);
  });

  it('is false when the body is invalid', () => {
    expect(canSave({ column: TABLE_COLUMN.amount, form: { amount: 0 } })).toBe(false);
    expect(canSave({ column: TABLE_COLUMN.category, form: { category: null } })).toBe(false);
  });

  it('treats a missing payee and note on the row as empty values', () => {
    const tx = buildTx({ payeeId: undefined, note: null as unknown as string });

    expect(canSaveInlineEdit({ tx, body: { payeeId: null } })).toBe(false);
    expect(canSaveInlineEdit({ tx, body: { note: '' } })).toBe(false);
  });
});

describe('buildInlineEditPreview', () => {
  const storeTags = [
    { id: 'tag-a', name: 'Food' },
    { id: 'tag-c', name: 'Travel' },
  ] as TagModel[];

  it('maps the sent time to a Date', () => {
    const preview = buildInlineEditPreview({ tx: buildTx(), body: { time: '2030-02-01T08:00:00.000Z' }, tags: [] });

    expect(preview.time).toEqual(new Date('2030-02-01T08:00:00.000Z'));
  });

  it('resolves tag ids to store tags and drops unknown ids', () => {
    const preview = buildInlineEditPreview({
      tx: buildTx(),
      body: { tagIds: ['tag-c', 'tag-unknown'] },
      tags: storeTags,
    });

    expect(preview.tags).toEqual([{ id: 'tag-c', name: 'Travel' }]);
  });

  it('clears tags when tag ids are null', () => {
    expect(buildInlineEditPreview({ tx: buildTx(), body: { tagIds: null }, tags: storeTags }).tags).toEqual([]);
  });

  it('preserves the fields the body does not send', () => {
    const tx = buildTx();

    const preview = buildInlineEditPreview({ tx, body: { note: 'tea' }, tags: storeTags });

    expect(preview).toEqual({ ...tx, note: 'tea' });
  });

  it('returns plain values for reactive inputs', () => {
    const preview = buildInlineEditPreview({
      tx: reactive(buildTx()) as TransactionModel,
      body: { tagIds: ['tag-a'] },
      tags: reactive(storeTags) as TagModel[],
    });

    expect(isProxy(preview)).toBe(false);
    expect(isProxy(preview.tags![0])).toBe(false);
  });
});

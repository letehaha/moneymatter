import type { ChatCardField } from '@bt/shared/types';
import { describe, expect, it } from 'vitest';

import { buildCardRows } from './card-diff';
import { buildCard } from './card-test-fixtures';

const field = (overrides: Partial<ChatCardField> & { path: string }): ChatCardField => ({
  labelKey: `chat.fields.${overrides.path}`,
  value: null,
  editable: null,
  ...overrides,
});

const entityField = ({
  path,
  kind,
  id,
  namesRecord,
}: {
  path: string;
  kind: 'transaction' | 'account' | 'payee' | 'category';
  id: string;
  namesRecord?: true;
}) =>
  field({
    path,
    value: id,
    display: { kind: 'entity', entity: { kind, id, label: '' } },
    ...(namesRecord ? { namesRecord } : {}),
  });

const target = [
  field({ path: 'amount', value: 25 }),
  field({ path: 'time', value: '2026-03-05T10:00:00.000Z' }),
  entityField({ path: 'payeeId', kind: 'payee', id: 'p1' }),
  entityField({ path: 'accountId', kind: 'account', id: 'a1' }),
];

describe('buildCardRows', () => {
  it('shows each field of an update once: the changed one with its old value, the rest as they are', () => {
    const card = buildCard({
      kind: 'update',
      entity: 'transaction',
      target,
      fields: [
        entityField({ path: 'transactionId', kind: 'transaction', id: 't1', namesRecord: true }),
        field({ path: 'amount', value: 30, before: 25 }),
      ],
    });

    const rows = buildCardRows({ card });

    expect(rows.map((row) => [row.field.path, row.tone])).toEqual([
      ['amount', 'changed'],
      ['time', 'normal'],
      ['payeeId', 'normal'],
      ['accountId', 'normal'],
    ]);
    expect(rows[0]!.field.value).toBe(30);
    expect(rows[0]!.field.before).toBe(25);
  });

  it('leaves out the argument that only names the record, so there is no separate summary row', () => {
    const card = buildCard({
      kind: 'update',
      entity: 'transaction',
      target,
      fields: [
        entityField({ path: 'transactionId', kind: 'transaction', id: 't1', namesRecord: true }),
        field({ path: 'amount', value: 30, before: 25 }),
      ],
    });

    expect(buildCardRows({ card }).some((row) => row.field.path === 'transactionId')).toBe(false);
  });

  it('keeps a changed field the record has no identifying value for, after the identifying ones', () => {
    const card = buildCard({
      kind: 'update',
      entity: 'transaction',
      target,
      fields: [field({ path: 'note', value: 'Lunch', before: 'Dinner' })],
    });

    expect(
      buildCardRows({ card })
        .map((row) => [row.field.path, row.tone])
        .at(-1),
    ).toEqual(['note', 'changed']);
  });

  it('takes the new value of an identifying field that changed, not the stored one', () => {
    const card = buildCard({
      kind: 'update',
      entity: 'transaction',
      target,
      fields: [entityField({ path: 'accountId', kind: 'account', id: 'a2' })].map((f) => ({ ...f, before: 'a1' })),
    });

    const account = buildCardRows({ card }).find((row) => row.field.path === 'accountId')!;

    expect(account.tone).toBe('changed');
    expect(account.field.value).toBe('a2');
  });

  it('tells a field that fills in an empty value from one that replaces a real value', () => {
    const card = buildCard({
      kind: 'update',
      entity: 'transaction',
      target: [field({ path: 'note', value: '' }), field({ path: 'amount', value: 25 })],
      fields: [
        field({ path: 'note', value: 'Lunch', before: '' }),
        field({ path: 'amount', value: 30, before: 25 }),
        field({ path: 'tagIds', value: ['t1'], before: [] }),
        field({ path: 'description', value: 'x', before: null }),
      ],
    });

    expect(buildCardRows({ card }).map((row) => [row.field.path, row.tone])).toEqual([
      ['note', 'added'],
      ['amount', 'changed'],
      ['tagIds', 'added'],
      ['description', 'added'],
    ]);
  });

  it('shows the record plainly when nothing changes, as a delete card does', () => {
    const card = buildCard({ kind: 'delete', entity: 'transaction', target, fields: [] });

    expect(buildCardRows({ card }).every((row) => row.tone === 'normal')).toBe(true);
    expect(buildCardRows({ card })).toHaveLength(4);
  });

  it('shows the fields of a card without a target as they are, marking a changed one', () => {
    const card = buildCard({
      kind: 'create',
      entity: 'tag',
      fields: [field({ path: 'name', value: 'Coffee' }), field({ path: 'color', value: 'red', before: 'blue' })],
    });

    expect(buildCardRows({ card }).map((row) => row.tone)).toEqual(['normal', 'changed']);
  });

  it('keeps an argument of the same kind as the record that is not the one naming it', () => {
    const card = buildCard({
      kind: 'delete',
      entity: 'category',
      target: [field({ path: 'name', value: 'Food' })],
      fields: [
        entityField({ path: 'categoryId', kind: 'category', id: 'c1', namesRecord: true }),
        entityField({ path: 'replaceWithCategoryId', kind: 'category', id: 'c2' }),
      ],
    });

    expect(buildCardRows({ card }).map((row) => row.field.path)).toEqual(['name', 'replaceWithCategoryId']);
  });

  it('keeps a new parent of the same kind, even when it is the only change', () => {
    const card = buildCard({
      kind: 'update',
      entity: 'category',
      target: [field({ path: 'name', value: 'Food' })],
      fields: [
        entityField({ path: 'categoryId', kind: 'category', id: 'c1', namesRecord: true }),
        { ...entityField({ path: 'parentId', kind: 'category', id: 'c9' }), before: null },
      ],
    });

    const rows = buildCardRows({ card });

    expect(rows.map((row) => [row.field.path, row.tone])).toEqual([
      ['name', 'normal'],
      ['parentId', 'added'],
    ]);
  });

  it('shows a changed amount in the currency of the record, which the card argument does not carry', () => {
    const card = buildCard({
      kind: 'update',
      entity: 'transaction',
      target: [field({ path: 'amount', value: 28.1, display: { kind: 'money', currencyCode: 'EUR' } })],
      fields: [field({ path: 'amount', value: 30, before: 28.1, display: { kind: 'money' } })],
    });

    const [row] = buildCardRows({ card });

    expect(row!.field.display?.currencyCode).toBe('EUR');
    expect(row!.source).toBe('card');
  });

  it('leaves the currency to the card when it moves the transaction to another account', () => {
    const card = buildCard({
      kind: 'update',
      entity: 'transaction',
      target: [field({ path: 'amount', value: 28.1, display: { kind: 'money', currencyCode: 'EUR' } })],
      fields: [
        field({ path: 'amount', value: 30, before: 28.1, display: { kind: 'money' } }),
        entityField({ path: 'accountId', kind: 'account', id: 'a2' }),
      ],
    });

    expect(buildCardRows({ card })[0]!.field.display?.currencyCode).toBeUndefined();
  });

  it('keeps the old value of an amount in the stored currency when the account moves', () => {
    const card = buildCard({
      kind: 'update',
      entity: 'transaction',
      target: [field({ path: 'amount', value: 28.1, display: { kind: 'money', currencyCode: 'GEL' } })],
      fields: [
        field({ path: 'amount', value: 30, before: 28.1, display: { kind: 'money' } }),
        entityField({ path: 'accountId', kind: 'account', id: 'a2' }),
      ],
    });

    expect(buildCardRows({ card })[0]!.beforeCurrencyCode).toBe('GEL');
  });

  describe('a subscription amount', () => {
    const subscriptionTarget = [
      field({ path: 'expectedAmount', value: 10, display: { kind: 'money', currencyCode: 'USD' } }),
    ];
    const expectedAmount = field({ path: 'expectedAmount', value: 20, before: 10, display: { kind: 'money' } });

    it('leaves a new currency the card states to the card, and keeps the old value in the stored one', () => {
      const card = buildCard({
        kind: 'update',
        entity: 'subscription',
        target: subscriptionTarget,
        fields: [expectedAmount, field({ path: 'expectedCurrencyCode', value: 'EUR', before: 'USD' })],
      });

      const [row] = buildCardRows({ card });

      expect(row!.field.display?.currencyCode).toBeUndefined();
      expect(row!.beforeCurrencyCode).toBe('USD');
    });

    it('stays in the stored currency when the card moves it to another account', () => {
      const card = buildCard({
        kind: 'update',
        entity: 'subscription',
        target: subscriptionTarget,
        fields: [expectedAmount, entityField({ path: 'accountId', kind: 'account', id: 'a2' })],
      });

      expect(buildCardRows({ card })[0]!.field.display?.currencyCode).toBe('USD');
    });
  });

  it('marks the rows that come from the target record rather than from the card', () => {
    const card = buildCard({ kind: 'update', entity: 'transaction', target, fields: [] });

    expect(buildCardRows({ card }).every((row) => row.source === 'target')).toBe(true);
  });

  it('does not treat the id of another kind of record as the record itself', () => {
    const card = buildCard({
      kind: 'update',
      entity: 'transaction',
      target,
      fields: [
        entityField({ path: 'accountId', kind: 'account', id: 'a1' }),
        field({ path: 'amount', value: 30, before: 25 }),
      ],
    });

    expect(buildCardRows({ card }).filter((row) => row.field.path === 'accountId')).toHaveLength(1);
  });

  it('leaves a field the card keeps as it was untinted, an empty note staying empty included', () => {
    const card = buildCard({
      kind: 'update',
      entity: 'transaction',
      target: [field({ path: 'note', value: null }), field({ path: 'amount', value: 25 })],
      fields: [
        field({ path: 'note', value: '', before: null }),
        field({ path: 'amount', value: 25, before: 25 }),
        field({ path: 'tagIds', value: [], before: [] }),
        field({ path: 'categoryId', value: 'c1', before: 'c1' }),
      ],
    });

    expect(buildCardRows({ card }).map((row) => [row.field.path, row.tone])).toEqual([
      ['note', 'normal'],
      ['amount', 'normal'],
      ['tagIds', 'normal'],
      ['categoryId', 'normal'],
    ]);
  });
});

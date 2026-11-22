import { generateRandomRecordId } from '@common/lib/record-id-helpers';
import { describe, expect, it } from '@jest/globals';

import { actionsSchema, conditionsSchema } from './zod-schemas';

const conditions = (items: unknown[]) => conditionsSchema.safeParse({ match: 'all', items });

const amount = (operator: string, value: object) => [
  { field: 'amount', operator, value, currency: { mode: 'transaction' } },
];

describe('transaction automations zod schemas', () => {
  it('accepts a text condition and rejects an empty keyword list', () => {
    expect(conditions([{ field: 'note', operator: 'contains_any', value: ['uber'] }]).success).toBe(true);
    expect(conditions([{ field: 'note', operator: 'contains_any', value: [] }]).success).toBe(false);
    expect(conditions([{ field: 'note', operator: 'is_empty', value: [] }]).success).toBe(true);
  });

  it('enforces amount bounds per operator', () => {
    expect(conditions(amount('gte', { min: 10 })).success).toBe(true);
    expect(conditions(amount('gte', { min: 10, max: 20 })).success).toBe(false);
    expect(conditions(amount('gte', {})).success).toBe(false);
    expect(conditions(amount('gte', { max: 5 })).success).toBe(false);
    expect(conditions(amount('equals', { min: 10 })).success).toBe(true);
    expect(conditions(amount('equals', { max: 10 })).success).toBe(false);
    expect(conditions(amount('lte', { max: 10 })).success).toBe(true);
    expect(conditions(amount('lte', { min: 10 })).success).toBe(false);
    expect(conditions(amount('between', { min: 10, max: 20 })).success).toBe(true);
    expect(conditions(amount('between', { min: 20, max: 10 })).success).toBe(false);
    expect(conditions(amount('between', { min: 10 })).success).toBe(false);
  });

  it('caps the item count and allows at most one transactionType item', () => {
    const item = { field: 'note', operator: 'contains_any', value: ['x'] };
    expect(conditions(Array.from({ length: 10 }, () => item)).success).toBe(true);
    expect(conditions(Array.from({ length: 11 }, () => item)).success).toBe(false);

    const typeItem = { field: 'transactionType', operator: 'equals', value: 'income' };
    expect(conditions([typeItem]).success).toBe(true);
    expect(conditions([typeItem, typeItem]).success).toBe(false);
  });

  it('accepts set_payee only with a valid payee id', () => {
    expect(actionsSchema.safeParse([{ type: 'set_payee', payeeId: generateRandomRecordId() }]).success).toBe(true);
    expect(actionsSchema.safeParse([{ type: 'set_payee', payeeId: 'not-a-uuid' }]).success).toBe(false);
    expect(actionsSchema.safeParse([{ type: 'set_payee' }]).success).toBe(false);
  });

  it('rejects duplicate action types', () => {
    const setNote = { type: 'set_note', mode: 'replace', value: 'hi' };
    expect(actionsSchema.safeParse([setNote]).success).toBe(true);
    expect(actionsSchema.safeParse([setNote, setNote]).success).toBe(false);
    expect(actionsSchema.safeParse([]).success).toBe(false);
  });

  it('accepts one action of every type, exclude_from_stats included', () => {
    const id = generateRandomRecordId();
    const everyType = [
      { type: 'set_category', categoryId: id },
      { type: 'add_tags', tagIds: [id] },
      { type: 'set_payee', payeeId: id },
      { type: 'set_note', mode: 'replace', value: 'hi' },
      { type: 'exclude_from_stats' },
    ];
    expect(actionsSchema.safeParse(everyType).success).toBe(true);
  });
});

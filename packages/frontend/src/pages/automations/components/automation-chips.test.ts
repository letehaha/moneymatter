import {
  type AutomationAction,
  type AutomationCondition,
  type RecordId,
  TRANSACTION_TYPES,
  type TransactionAutomationModel,
} from '@bt/shared/types';

import { buildAutomationChips } from './automation-chips';

const id = (value: string) => value as RecordId;

const makeRule = ({
  items,
  match = 'all',
  actions = [],
}: {
  items: AutomationCondition[];
  match?: 'all' | 'any';
  actions?: AutomationAction[];
}): TransactionAutomationModel =>
  ({
    id: id('rule-1'),
    name: 'Rule',
    conditions: { match, items },
    actions,
  }) as TransactionAutomationModel;

const chips = (rule: TransactionAutomationModel) => buildAutomationChips({ rule });

describe('buildAutomationChips', () => {
  test('text conditions keep their operator label and raw keywords', () => {
    const { when } = chips(
      makeRule({
        items: [
          {
            field: 'note',
            operator: 'contains_any',
            value: ['uber', 'bolt', 'free now'],
          },
          {
            field: 'merchant',
            operator: 'not_contains_any',
            value: ['refund'],
          },
          { field: 'note', operator: 'is_empty', value: ['stale'] },
        ],
      }),
    );

    expect(when).toEqual([
      {
        kind: 'text',
        field: 'note',
        labelKey: 'automations.chips.note.containsAny',
        keywords: ['uber', 'bolt', 'free now'],
      },
      {
        kind: 'text',
        field: 'merchant',
        labelKey: 'automations.chips.merchant.notContainsAny',
        keywords: ['refund'],
      },
      {
        kind: 'text',
        field: 'note',
        labelKey: 'automations.chips.note.isEmpty',
        keywords: [],
      },
    ]);
  });

  test('id-based conditions expand to one chip per id and keep the negation', () => {
    const { when } = chips(
      makeRule({
        items: [
          { field: 'account', operator: 'in', value: [id('a1'), id('a2')] },
          { field: 'payee', operator: 'not_in', value: [id('p1')] },
          { field: 'accountGroup', operator: 'in', value: [id('g1')] },
          { field: 'bankConnection', operator: 'in', value: [id('c1')] },
        ],
      }),
    );

    expect(when).toEqual([
      { kind: 'ref', refType: 'account', id: 'a1', negated: false },
      { kind: 'ref', refType: 'account', id: 'a2', negated: false },
      { kind: 'ref', refType: 'payee', id: 'p1', negated: true },
      { kind: 'ref', refType: 'accountGroup', id: 'g1', negated: false },
      { kind: 'ref', refType: 'bankConnection', id: 'c1', negated: false },
    ]);
  });

  test('amount conditions render an operator-prefixed value and a currency suffix', () => {
    const { when } = chips(
      makeRule({
        items: [
          {
            field: 'amount',
            operator: 'gte',
            value: { min: 8000 },
            currency: { mode: 'base' },
          },
          {
            field: 'amount',
            operator: 'lte',
            value: { max: 25.5 },
            currency: { mode: 'transaction' },
          },
          {
            field: 'amount',
            operator: 'between',
            value: { min: 4500, max: 5500 },
            currency: { mode: 'specific', code: 'EUR' },
          },
          {
            field: 'amount',
            operator: 'equals',
            value: { min: 10 },
            currency: { mode: 'specific', code: 'PLN' },
          },
        ],
      }),
    );

    expect(when).toEqual([
      {
        kind: 'amount',
        value: '≥ 8,000',
        currency: { key: 'automations.summary.currency.base' },
        tone: 'neutral',
      },
      {
        kind: 'amount',
        value: '≤ 25.5',
        currency: { key: 'automations.summary.currency.transaction' },
        tone: 'neutral',
      },
      {
        kind: 'amount',
        value: '4,500 – 5,500',
        currency: { code: 'EUR' },
        tone: 'neutral',
      },
      {
        kind: 'amount',
        value: '= 10',
        currency: { code: 'PLN' },
        tone: 'neutral',
      },
    ]);
  });

  test.each<[number, string]>([
    [1.234, '= 1.234'],
    [0.0005, '= 0.0005'],
    [8000.123, '= 8,000.123'],
  ])('an amount bound of %d shows every digit it carries', (min, value) => {
    const { when } = chips(
      makeRule({
        items: [{ field: 'amount', operator: 'equals', value: { min }, currency: { mode: 'specific', code: 'KWD' } }],
      }),
    );

    expect(when[0]).toMatchObject({ kind: 'amount', value });
  });

  test('a transaction type condition tints both its own chip and the amount chips', () => {
    const { when } = chips(
      makeRule({
        items: [
          {
            field: 'transactionType',
            operator: 'equals',
            value: TRANSACTION_TYPES.income,
          },
          {
            field: 'amount',
            operator: 'gte',
            value: { min: 200 },
            currency: { mode: 'specific', code: 'PLN' },
          },
        ],
      }),
    );

    expect(when).toEqual([
      {
        kind: 'transactionType',
        labelKey: 'automations.summary.transactionTypeValue.income',
        tone: 'income',
      },
      {
        kind: 'amount',
        value: '≥ 200',
        currency: { code: 'PLN' },
        tone: 'income',
      },
    ]);
  });

  test('day of month renders a range', () => {
    const { when } = chips(
      makeRule({
        items: [
          {
            field: 'dayOfMonth',
            operator: 'between',
            value: { min: 1, max: 5 },
          },
        ],
      }),
    );

    expect(when).toEqual([{ kind: 'dayOfMonth', value: '1 – 5' }]);
  });

  test('actions expand to ref chips per id and a note chip per mode', () => {
    const { then, match } = chips(
      makeRule({
        match: 'any',
        items: [],
        actions: [
          { type: 'set_category', categoryId: id('c1') },
          { type: 'add_tags', tagIds: [id('t1'), id('t2')] },
          { type: 'set_payee', payeeId: id('p1') },
          { type: 'set_note', mode: 'append', value: 'from automation' },
          { type: 'exclude_from_stats' },
        ],
      }),
    );

    expect(match).toBe('any');
    expect(then).toEqual([
      { kind: 'ref', refType: 'category', id: 'c1', negated: false },
      { kind: 'ref', refType: 'tag', id: 't1', negated: false },
      { kind: 'ref', refType: 'tag', id: 't2', negated: false },
      { kind: 'ref', refType: 'payee', id: 'p1', negated: false },
      {
        kind: 'note',
        labelKey: 'automations.chips.noteAppend',
        value: 'from automation',
      },
      { kind: 'excludeFromStats' },
    ]);
  });

  test.each([
    ['replace', 'automations.chips.noteReplace'],
    ['prepend', 'automations.chips.notePrepend'],
  ] as const)('set_note in %s mode picks its own label', (mode, labelKey) => {
    const { then } = chips(makeRule({ items: [], actions: [{ type: 'set_note', mode, value: 'note' }] }));

    expect(then).toEqual([{ kind: 'note', labelKey, value: 'note' }]);
  });
});

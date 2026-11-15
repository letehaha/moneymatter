import { AutomationConditions, AutomationTextOperator, RecordId, TRANSACTION_TYPES } from '@bt/shared/types';
import { Money } from '@common/types/money';
import { describe, expect, it, jest } from '@jest/globals';

import {
  AutomationContext,
  AutomationResolvers,
  AutomationTransactionInput,
  buildAutomationContext,
  resolveGroupAncestry,
} from './build-context';
import { evaluateConditions } from './evaluate-conditions';

const id = (value: string) => value as RecordId;

const makeCtx = ({
  transaction,
  resolvers,
}: {
  transaction?: Partial<AutomationTransactionInput>;
  resolvers?: Partial<AutomationResolvers>;
} = {}): AutomationContext =>
  buildAutomationContext({
    userId: 1,
    transaction: {
      amount: Money.fromDecimal(-25),
      refAmount: Money.fromDecimal(-20),
      note: 'Uber trip to airport',
      externalData: null,
      payeeId: null,
      currencyCode: 'USD',
      transactionType: TRANSACTION_TYPES.expense,
      accountId: id('acc-1'),
      time: new Date('2026-03-15T10:00:00.000Z'),
      ...transaction,
    },
    resolvers: {
      accountGroupIds: async () => [],
      bankConnectionId: async () => null,
      ...resolvers,
    },
  });

const matches = ({ ctx, conditions }: { ctx: AutomationContext; conditions: AutomationConditions }) =>
  evaluateConditions({ ctx, conditions }).then((result) => result.matched);

const all = (items: AutomationConditions['items']): AutomationConditions => ({ match: 'all', items });

describe('evaluateConditions', () => {
  describe('text operators', () => {
    const cases: [AutomationTextOperator, string[], boolean][] = [
      ['contains_any', ['UBER'], true],
      ['contains_any', ['bolt', 'taxi'], false],
      ['contains_any', ['  uber  '], true],
      ['not_contains_any', ['bolt'], true],
      ['not_contains_any', ['bolt', 'uber'], false],
      ['starts_with_any', ['uber'], true],
      ['starts_with_any', ['trip'], false],
      ['ends_with_any', ['AIRPORT'], true],
      ['ends_with_any', ['uber'], false],
      ['equals_any', ['uber trip to airport'], true],
      ['equals_any', ['uber'], false],
    ];

    it.each(cases)('note %s %j → %s', async (operator, value, expected) => {
      const ctx = makeCtx();
      await expect(matches({ ctx, conditions: all([{ field: 'note', operator, value }]) })).resolves.toBe(expected);
    });

    it('is_empty is true only for a blank note', async () => {
      const conditions = all([{ field: 'note', operator: 'is_empty', value: [] }]);

      await expect(matches({ ctx: makeCtx({ transaction: { note: '   ' } }), conditions })).resolves.toBe(true);
      await expect(matches({ ctx: makeCtx({ transaction: { note: null } }), conditions })).resolves.toBe(true);
      await expect(matches({ ctx: makeCtx(), conditions })).resolves.toBe(false);
    });

    it('merchant reads externalData, note stays independent', async () => {
      const ctx = makeCtx({ transaction: { externalData: { merchantName: 'BOLT.EU' } } });

      await expect(
        matches({ ctx, conditions: all([{ field: 'merchant', operator: 'contains_any', value: ['bolt'] }]) }),
      ).resolves.toBe(true);
      await expect(
        matches({ ctx, conditions: all([{ field: 'note', operator: 'contains_any', value: ['bolt'] }]) }),
      ).resolves.toBe(false);
    });

    it('merchant falls back to note when externalData carries no merchant key', async () => {
      const ctx = makeCtx({ transaction: { externalData: { balance: 100 } } });

      await expect(
        matches({ ctx, conditions: all([{ field: 'merchant', operator: 'contains_any', value: ['uber'] }]) }),
      ).resolves.toBe(true);
    });
  });

  describe('payee', () => {
    it('null payeeId is out of `in` and inside `not_in`', async () => {
      const ctx = makeCtx();

      await expect(
        matches({ ctx, conditions: all([{ field: 'payee', operator: 'in', value: [id('p-1')] }]) }),
      ).resolves.toBe(false);
      await expect(
        matches({ ctx, conditions: all([{ field: 'payee', operator: 'not_in', value: [id('p-1')] }]) }),
      ).resolves.toBe(true);
    });

    it('matches a set membership', async () => {
      const ctx = makeCtx({ transaction: { payeeId: id('p-1') } });

      await expect(
        matches({ ctx, conditions: all([{ field: 'payee', operator: 'in', value: [id('p-1'), id('p-2')] }]) }),
      ).resolves.toBe(true);
      await expect(
        matches({ ctx, conditions: all([{ field: 'payee', operator: 'in', value: [id('p-2')] }]) }),
      ).resolves.toBe(false);
    });
  });

  describe('amount', () => {
    it('compares the unsigned magnitude in the transaction currency', async () => {
      const ctx = makeCtx();
      const currency = { mode: 'transaction' } as const;

      await expect(
        matches({ ctx, conditions: all([{ field: 'amount', operator: 'gte', value: { min: 25 }, currency }]) }),
      ).resolves.toBe(true);
      await expect(
        matches({ ctx, conditions: all([{ field: 'amount', operator: 'gte', value: { min: 25.01 }, currency }]) }),
      ).resolves.toBe(false);
      await expect(
        matches({ ctx, conditions: all([{ field: 'amount', operator: 'lte', value: { max: 25 }, currency }]) }),
      ).resolves.toBe(true);
      await expect(
        matches({ ctx, conditions: all([{ field: 'amount', operator: 'equals', value: { min: 25 }, currency }]) }),
      ).resolves.toBe(true);
      await expect(
        matches({
          ctx,
          conditions: all([{ field: 'amount', operator: 'between', value: { min: 20, max: 30 }, currency }]),
        }),
      ).resolves.toBe(true);
      await expect(
        matches({
          ctx,
          conditions: all([{ field: 'amount', operator: 'between', value: { min: 26, max: 30 }, currency }]),
        }),
      ).resolves.toBe(false);
    });

    it('compares a 3-decimal amount at its own precision', async () => {
      const ctx = makeCtx({
        transaction: {
          amount: Money.fromDecimal('-1.234'),
          refAmount: Money.fromDecimal('-14.75'),
          currencyCode: 'KWD',
        },
      });
      const currency = { mode: 'specific', code: 'KWD' } as const;

      await expect(
        matches({ ctx, conditions: all([{ field: 'amount', operator: 'equals', value: { min: 1.234 }, currency }]) }),
      ).resolves.toBe(true);
      await expect(
        matches({ ctx, conditions: all([{ field: 'amount', operator: 'equals', value: { min: 1.23 }, currency }]) }),
      ).resolves.toBe(false);
      await expect(
        matches({ ctx, conditions: all([{ field: 'amount', operator: 'gte', value: { min: 1.235 }, currency }]) }),
      ).resolves.toBe(false);
      await expect(
        matches({
          ctx,
          conditions: all([{ field: 'amount', operator: 'between', value: { min: 1.231, max: 1.233 }, currency }]),
        }),
      ).resolves.toBe(false);
    });

    it('base mode compares refAmount', async () => {
      const ctx = makeCtx();
      const currency = { mode: 'base' } as const;

      await expect(
        matches({ ctx, conditions: all([{ field: 'amount', operator: 'equals', value: { min: 20 }, currency }]) }),
      ).resolves.toBe(true);
      await expect(
        matches({ ctx, conditions: all([{ field: 'amount', operator: 'equals', value: { min: 25 }, currency }]) }),
      ).resolves.toBe(false);
    });

    it('specific mode compares the native amount only when the transaction is in that currency', async () => {
      const ctx = makeCtx();

      await expect(
        matches({
          ctx,
          conditions: all([
            { field: 'amount', operator: 'equals', value: { min: 25 }, currency: { mode: 'specific', code: 'USD' } },
          ]),
        }),
      ).resolves.toBe(true);
      await expect(
        matches({
          ctx,
          conditions: all([
            { field: 'amount', operator: 'gte', value: { min: 1 }, currency: { mode: 'specific', code: 'EUR' } },
          ]),
        }),
      ).resolves.toBe(false);
    });
  });

  it('matches transactionType by equality', async () => {
    const ctx = makeCtx();

    await expect(
      matches({
        ctx,
        conditions: all([{ field: 'transactionType', operator: 'equals', value: TRANSACTION_TYPES.expense }]),
      }),
    ).resolves.toBe(true);
    await expect(
      matches({
        ctx,
        conditions: all([{ field: 'transactionType', operator: 'equals', value: TRANSACTION_TYPES.income }]),
      }),
    ).resolves.toBe(false);
  });

  it('matches account in / not_in', async () => {
    const ctx = makeCtx();

    await expect(
      matches({ ctx, conditions: all([{ field: 'account', operator: 'in', value: [id('acc-1')] }]) }),
    ).resolves.toBe(true);
    await expect(
      matches({ ctx, conditions: all([{ field: 'account', operator: 'not_in', value: [id('acc-1')] }]) }),
    ).resolves.toBe(false);
    await expect(
      matches({ ctx, conditions: all([{ field: 'account', operator: 'not_in', value: [id('acc-2')] }]) }),
    ).resolves.toBe(true);
  });

  describe('accountGroup', () => {
    it('matches any group in the resolved ancestry and memoizes the lookup', async () => {
      const accountGroupIds = jest
        .fn<AutomationResolvers['accountGroupIds']>()
        .mockResolvedValue([id('g-child'), id('g-root')]);
      const ctx = makeCtx({ resolvers: { accountGroupIds } });

      await expect(
        matches({
          ctx,
          conditions: all([
            { field: 'accountGroup', operator: 'in', value: [id('g-root')] },
            { field: 'accountGroup', operator: 'not_in', value: [id('g-other')] },
          ]),
        }),
      ).resolves.toBe(true);
      expect(accountGroupIds).toHaveBeenCalledTimes(1);
    });
  });

  describe('bankConnection', () => {
    it('an account with no connection is out of `in` and inside `not_in`', async () => {
      const ctx = makeCtx();

      await expect(
        matches({ ctx, conditions: all([{ field: 'bankConnection', operator: 'in', value: [id('c-1')] }]) }),
      ).resolves.toBe(false);
      await expect(
        matches({ ctx, conditions: all([{ field: 'bankConnection', operator: 'not_in', value: [id('c-1')] }]) }),
      ).resolves.toBe(true);
    });

    it('matches the account connection', async () => {
      const ctx = makeCtx({ resolvers: { bankConnectionId: async () => id('c-1') } });

      await expect(
        matches({ ctx, conditions: all([{ field: 'bankConnection', operator: 'in', value: [id('c-1')] }]) }),
      ).resolves.toBe(true);
    });
  });

  it('treats dayOfMonth bounds as inclusive on the UTC day', async () => {
    const ctx = makeCtx();

    await expect(
      matches({ ctx, conditions: all([{ field: 'dayOfMonth', operator: 'between', value: { min: 15, max: 15 } }]) }),
    ).resolves.toBe(true);
    await expect(
      matches({ ctx, conditions: all([{ field: 'dayOfMonth', operator: 'between', value: { min: 1, max: 14 } }]) }),
    ).resolves.toBe(false);
    await expect(
      matches({ ctx, conditions: all([{ field: 'dayOfMonth', operator: 'between', value: { min: 16, max: 31 } }]) }),
    ).resolves.toBe(false);
  });

  describe('match mode', () => {
    const items: AutomationConditions['items'] = [
      { field: 'note', operator: 'contains_any', value: ['uber'] },
      { field: 'note', operator: 'contains_any', value: ['bolt'] },
    ];

    it('`all` stops at the first failing item', async () => {
      await expect(evaluateConditions({ ctx: makeCtx(), conditions: { match: 'all', items } })).resolves.toEqual({
        matched: false,
        perItem: [true, false],
      });
    });

    it('`any` stops at the first matching item', async () => {
      await expect(evaluateConditions({ ctx: makeCtx(), conditions: { match: 'any', items } })).resolves.toEqual({
        matched: true,
        perItem: [true],
      });
    });

    it('`any` is false when nothing matches', async () => {
      await expect(
        evaluateConditions({ ctx: makeCtx(), conditions: { match: 'any', items: [items[1]!] } }),
      ).resolves.toEqual({ matched: false, perItem: [false] });
    });
  });
});

describe('resolveGroupAncestry', () => {
  it('climbs to every ancestor of every membership', () => {
    const groups = [
      { id: id('g-child'), parentGroupId: id('g-mid') },
      { id: id('g-mid'), parentGroupId: id('g-root') },
      { id: id('g-root'), parentGroupId: null },
      { id: id('g-detached'), parentGroupId: null },
    ];

    expect(resolveGroupAncestry({ groups, memberships: [{ groupId: id('g-child') }] })).toEqual([
      'g-child',
      'g-mid',
      'g-root',
    ]);
    expect(resolveGroupAncestry({ groups, memberships: [] })).toEqual([]);
  });

  it('terminates on a parent cycle', () => {
    const groups = [
      { id: id('g-a'), parentGroupId: id('g-b') },
      { id: id('g-b'), parentGroupId: id('g-a') },
    ];

    expect(resolveGroupAncestry({ groups, memberships: [{ groupId: id('g-a') }] })).toEqual(['g-a', 'g-b']);
  });
});

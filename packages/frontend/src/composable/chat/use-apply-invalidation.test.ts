import { VUE_QUERY_CACHE_KEYS, VUE_QUERY_GLOBAL_PREFIXES } from '@/common/const';
import type { ChatEntityKind, ChatProposalCard } from '@bt/shared/types';
import { QueryClient, VueQueryPlugin } from '@tanstack/vue-query';
import { flushPromises, mount } from '@vue/test-utils';
import { describe, expect, it, vi } from 'vitest';
import { defineComponent } from 'vue';

import { matchesInvalidationPlan, planInvalidation, useApplyInvalidation } from './use-apply-invalidation';

const loadCategories = vi.fn();
const loadTags = vi.fn();

vi.mock('@/stores/categories/categories', () => ({ useCategoriesStore: () => ({ loadCategories }) }));
vi.mock('@/stores/tags', () => ({ useTagsStore: () => ({ loadTags }) }));

const { transactionChange, securityPriceChange, ventureChange } = VUE_QUERY_GLOBAL_PREFIXES;

const appliedCard = ({
  entity,
  refs = [],
}: {
  entity: ChatEntityKind;
  refs?: Array<{ kind: ChatEntityKind; id: string }>;
}) =>
  ({
    id: `card-${entity}`,
    status: 'applied',
    entity,
    result: { refs, executedArgs: {}, appliedAt: '2026-10-18T10:00:00.000Z' },
  }) as unknown as ChatProposalCard;

describe('planInvalidation', () => {
  it('maps entities to the global prefixes of the queries that show them', () => {
    expect(planInvalidation({ kinds: ['transaction'] })).toMatchObject({ all: false, prefixes: [transactionChange] });
    expect(planInvalidation({ kinds: ['ventureDeal'] })).toMatchObject({ all: false, prefixes: [ventureChange] });
    expect(planInvalidation({ kinds: ['customCurrency'] })).toMatchObject({
      all: false,
      prefixes: expect.arrayContaining([VUE_QUERY_GLOBAL_PREFIXES.currencies, transactionChange]),
    });
  });

  it('joins the targets of several entities without repeating one', () => {
    const plan = planInvalidation({ kinds: ['transaction', 'account', 'portfolio'] });

    expect(plan).toMatchObject({ all: false });
    if (plan.all) return;
    expect(plan.prefixes.toSorted()).toEqual([securityPriceChange, transactionChange].toSorted());
  });

  it('adds the plain query keys of entities that have no global prefix of their own', () => {
    const plan = planInvalidation({ kinds: ['payee'] });

    expect(plan.all).toBe(false);
    if (plan.all) return;
    expect(plan.keys).toContainEqual(VUE_QUERY_CACHE_KEYS.payeesList);
  });

  it('invalidates everything as soon as one entity is not mapped', () => {
    expect(planInvalidation({ kinds: ['transaction', 'userSettings'] })).toEqual({ all: true });
    expect(planInvalidation({ kinds: ['tagReminder'] })).toEqual({ all: true });
  });

  it('plans nothing for no entities', () => {
    expect(planInvalidation({ kinds: [] })).toEqual({ all: false, prefixes: [], keys: [] });
  });
});

describe('matchesInvalidationPlan', () => {
  it('matches a key that carries a planned prefix anywhere in it, or starts with a planned key', () => {
    const plan = planInvalidation({ kinds: ['payee'] });

    expect(matchesInvalidationPlan({ plan, queryKey: [securityPriceChange, transactionChange, 'widget'] })).toBe(true);
    expect(matchesInvalidationPlan({ plan, queryKey: [...VUE_QUERY_CACHE_KEYS.payeesList, 'search'] })).toBe(true);
    expect(matchesInvalidationPlan({ plan, queryKey: ['unrelated'] })).toBe(false);
  });

  it('matches every key of an all-plan', () => {
    expect(matchesInvalidationPlan({ plan: { all: true }, queryKey: ['anything'] })).toBe(true);
  });
});

describe('useApplyInvalidation', () => {
  const setup = () => {
    const queryClient = new QueryClient();
    const invalidateQueries = vi.spyOn(queryClient, 'invalidateQueries').mockResolvedValue();
    let invalidation!: ReturnType<typeof useApplyInvalidation>;
    mount(
      defineComponent({
        setup() {
          invalidation = useApplyInvalidation();
          return () => null;
        },
      }),
      { global: { plugins: [[VueQueryPlugin, { queryClient }]] } },
    );
    return { invalidation, invalidateQueries };
  };

  it('invalidates the queries of the entities an applied card touched', async () => {
    const { invalidation, invalidateQueries } = setup();

    await invalidation.invalidateForCards({
      cards: [appliedCard({ entity: 'transaction', refs: [{ kind: 'transaction', id: 't1' }] })],
    });

    expect(invalidateQueries).toHaveBeenCalledTimes(1);
    const { predicate } = invalidateQueries.mock.calls[0]![0] as unknown as {
      predicate: (query: { queryKey: unknown[] }) => boolean;
    };
    expect(predicate({ queryKey: [transactionChange, 'records'] })).toBe(true);
    expect(predicate({ queryKey: ['unrelated'] })).toBe(false);
  });

  it('counts the entity kinds of the refs as well as the card entity', async () => {
    const { invalidation, invalidateQueries } = setup();

    await invalidation.invalidateForCards({
      cards: [
        appliedCard({
          entity: 'category',
          refs: [
            { kind: 'category', id: 'c1' },
            { kind: 'ventureDeal', id: 'd1' },
          ],
        }),
      ],
    });

    const { predicate } = invalidateQueries.mock.calls[0]![0] as unknown as {
      predicate: (query: { queryKey: unknown[] }) => boolean;
    };
    expect(predicate({ queryKey: [ventureChange, 'deals'] })).toBe(true);
  });

  it('invalidates everything for an entity it does not know', async () => {
    const { invalidation, invalidateQueries } = setup();

    await invalidation.invalidateForCards({ cards: [appliedCard({ entity: 'userSettings' })] });

    expect(invalidateQueries).toHaveBeenCalledTimes(1);
    expect(invalidateQueries.mock.calls[0]![0]).toBeUndefined();
  });

  it('ignores cards that applied nothing', async () => {
    const { invalidation, invalidateQueries } = setup();

    await invalidation.invalidateForCards({
      cards: [{ ...appliedCard({ entity: 'transaction' }), status: 'rejected' } as ChatProposalCard],
    });

    expect(invalidateQueries).not.toHaveBeenCalled();
  });

  it('reloads the category and tag stores, which hold their own copy', async () => {
    const { invalidation } = setup();

    await invalidation.invalidateForCards({
      cards: [appliedCard({ entity: 'category' }), appliedCard({ entity: 'tag' })],
    });
    await flushPromises();

    expect(loadCategories).toHaveBeenCalledWith({ force: true });
    expect(loadTags).toHaveBeenCalledTimes(1);
  });
});

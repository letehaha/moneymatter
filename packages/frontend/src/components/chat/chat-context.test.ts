import enChat from '@/i18n/locales/chunks/en/pages/chat.json';
import { ROUTES_NAMES } from '@/routes/constants';
import { describe, expect, it } from 'vitest';
import { createI18n } from 'vue-i18n';

import { describeChatContext, hasChatContext, isSameChatContext, toThreadContext } from './chat-context';

const i18n = createI18n({ legacy: false, locale: 'en', messages: { en: enChat }, missingWarn: false });
const t = (key: string, params?: Record<string, string>) => i18n.global.t(key, params ?? {});

const describeWith = ({
  context,
  names = {},
}: {
  context: Parameters<typeof describeChatContext>[0]['context'];
  names?: Record<string, string>;
}) => describeChatContext({ context, t, entityName: ({ kind, id }) => names[`${kind}:${id}`] ?? null });

describe('describeChatContext', () => {
  it('names an entity by its kind and its name', () => {
    const label = describeWith({
      context: { route: ROUTES_NAMES.account, entity: { kind: 'account', id: 'a1' } },
      names: { 'account:a1': 'Main card' },
    });

    expect(label).toBe('Account: Main card');
  });

  it('falls back to the kind alone when the name is not known', () => {
    expect(describeWith({ context: { entity: { kind: 'budgetPlan', id: 'x' } } })).toBe('Budget plan');
  });

  it('names a page that has no entity', () => {
    expect(describeWith({ context: { route: ROUTES_NAMES.transactions } })).toBe('Transactions');
  });

  it('adds the period and says the list is filtered', () => {
    const label = describeWith({
      context: {
        route: ROUTES_NAMES.transactions,
        period: { from: '2026-03-01', to: '2026-03-31' },
        filters: { categoryIds: ['c1'] },
      },
    });

    expect(label).toBe('Transactions · 2026-03-01 to 2026-03-31 · filtered');
  });

  it('names every kind of page, not only a few', () => {
    expect(describeWith({ context: { route: ROUTES_NAMES.plannedSubscriptions } })).toBe('Recurring payments');
    expect(describeWith({ context: { route: ROUTES_NAMES.plannedTrackers } })).toBe('Trackers');
    expect(describeWith({ context: { route: ROUTES_NAMES.settingsGeneral } })).toBe('General settings');
  });

  it('names an entity page by the entity, with the open drawer after it', () => {
    const label = describeWith({
      context: {
        route: ROUTES_NAMES.plannedSubscriptionDetails,
        entity: { kind: 'subscription', id: 's1' },
        focus: { kind: 'transaction', id: 't1' },
      },
    });

    expect(label).toBe('Subscription · Transaction');
  });

  it('counts the selected rows', () => {
    const label = describeWith({
      context: {
        route: ROUTES_NAMES.transactions,
        selection: { kind: 'transaction', ids: ['t1', 't2'], total: 12 },
      },
    });

    expect(label).toBe('Transactions · 12 selected');
  });

  it('does not call a sorted list filtered', () => {
    expect(
      describeWith({ context: { route: ROUTES_NAMES.plannedSubscriptions, filters: { sortBy: 'nextDue' } } }),
    ).toBe('Recurring payments');
  });

  it('falls back to a generic name for a route nobody declared', () => {
    expect(describeWith({ context: { route: 'dashboard.brand-new' } })).toBe('This page');
  });

  it('has no label without a route or any detail', () => {
    expect(describeWith({ context: {} })).toBeNull();
  });
});

describe('hasChatContext', () => {
  it('is true for any page, an entity, a period or filters', () => {
    expect(hasChatContext({ context: { entity: { kind: 'account', id: 'a1' } } })).toBe(true);
    expect(hasChatContext({ context: { period: { from: '2026-03-01', to: '2026-03-31' } } })).toBe(true);
    expect(hasChatContext({ context: { filters: { tagIds: ['t1'] } } })).toBe(true);
    expect(hasChatContext({ context: { route: ROUTES_NAMES.transactions } })).toBe(true);
  });

  it('is false for no context or an empty one', () => {
    expect(hasChatContext({ context: null })).toBe(false);
    expect(hasChatContext({ context: {} })).toBe(false);
    expect(hasChatContext({ context: { filters: {} } })).toBe(false);
  });
});

describe('toThreadContext', () => {
  it('keeps the page and what it is about, and leaves out the drawer and the ticked rows', () => {
    expect(
      toThreadContext({
        context: {
          route: ROUTES_NAMES.transactions,
          filters: { search: 'a' },
          period: { from: '2026-03-01', to: '2026-03-31' },
          focus: { kind: 'transaction', id: 't1' },
          selection: { kind: 'transaction', ids: ['t1'] },
        },
      }),
    ).toEqual({
      route: ROUTES_NAMES.transactions,
      filters: { search: 'a' },
      period: { from: '2026-03-01', to: '2026-03-31' },
    });
  });
});

describe('isSameChatContext', () => {
  it('ignores the order of keys, which stored JSON does not keep', () => {
    expect(
      isSameChatContext({
        a: { route: 'r', entity: { kind: 'account', id: '1' } },
        b: { entity: { id: '1', kind: 'account' }, route: 'r' },
      }),
    ).toBe(true);
  });

  it('tells a different page from the same one, and none from some', () => {
    expect(isSameChatContext({ a: { route: 'r' }, b: { route: 'q' } })).toBe(false);
    expect(isSameChatContext({ a: null, b: { route: 'r' } })).toBe(false);
    expect(isSameChatContext({ a: null, b: null })).toBe(true);
  });
});

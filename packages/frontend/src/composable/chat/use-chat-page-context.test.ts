import { ROUTE_CHAT_CONTEXT, type RouteChatContext } from '@/routes/chat-context';
import { ROUTES_NAMES } from '@/routes/constants';
import { createPinia, setActivePinia } from 'pinia';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createApp, defineComponent, effectScope, nextTick, reactive } from 'vue';

import {
  chatPageContextFromQuery,
  chatPageContextToQuery,
  provideChatPageContext,
  resolveRouteChatContext,
  useChatPageContext,
} from './use-chat-page-context';

const route = reactive<{ name: string; params: Record<string, string> }>({ name: '', params: {} });

vi.mock('vue-router', () => ({ useRoute: () => route }));

const goTo = ({ name, params = {} }: { name: string; params?: Record<string, string> }) => {
  route.name = name;
  route.params = params;
};

/** Runs `fn` as the setup of a component, the way a page calls the composables. */
const inComponent = <T>(fn: () => T) => {
  let result!: T;
  const app = createApp(
    defineComponent({
      setup() {
        result = fn();
        return () => null;
      },
    }),
  );
  app.use(createPinia());
  const root = document.createElement('div');
  app.mount(root);
  return { result, unmount: () => app.unmount() };
};

beforeEach(() => {
  setActivePinia(createPinia());
  goTo({ name: ROUTES_NAMES.home });
});

describe('useChatPageContext', () => {
  it('falls back to the route name', () => {
    goTo({ name: ROUTES_NAMES.analytics });

    const { context } = useChatPageContext();

    expect(context.value).toEqual({ route: ROUTES_NAMES.analytics });
  });

  it('names the entity of a detail route from its params', () => {
    goTo({ name: ROUTES_NAMES.account, params: { id: '42' } });
    const { context } = useChatPageContext();
    expect(context.value).toEqual({ route: ROUTES_NAMES.account, entity: { kind: 'account', id: '42' } });

    goTo({ name: ROUTES_NAMES.loanDetail, params: { id: '7' } });
    expect(context.value?.entity).toEqual({ kind: 'loan', id: '7' });

    goTo({ name: ROUTES_NAMES.portfolioDetail, params: { portfolioId: '9' } });
    expect(context.value?.entity).toEqual({ kind: 'portfolio', id: '9' });
  });

  it('has no context before the router has resolved a route', () => {
    goTo({ name: '' });

    expect(useChatPageContext().context.value).toBeNull();
  });

  it('prefers the context a page provides', () => {
    goTo({ name: ROUTES_NAMES.transactions });
    const { result } = inComponent(() => {
      provideChatPageContext({ filters: { accountIds: ['1'] }, period: { from: '2026-09-01', to: '2026-09-30' } });
      return useChatPageContext();
    });

    expect(result.context.value).toEqual({
      route: ROUTES_NAMES.transactions,
      filters: { accountIds: ['1'] },
      period: { from: '2026-09-01', to: '2026-09-30' },
    });
  });

  it('follows a provided context that changes', async () => {
    goTo({ name: ROUTES_NAMES.transactions });
    const filters = reactive<{ search: string }>({ search: 'coffee' });
    const { result } = inComponent(() => {
      provideChatPageContext(() => ({ filters: { search: filters.search } }));
      return useChatPageContext();
    });

    filters.search = 'tea';
    await nextTick();

    expect(result.context.value?.filters).toEqual({ search: 'tea' });
  });

  it('clears the provided context when the route changes', async () => {
    goTo({ name: ROUTES_NAMES.transactions });
    const { result } = inComponent(() => {
      provideChatPageContext({ filters: { search: 'coffee' } });
      return useChatPageContext();
    });
    expect(result.context.value?.filters).toEqual({ search: 'coffee' });

    goTo({ name: ROUTES_NAMES.budget });
    await nextTick();

    expect(result.context.value).toEqual({ route: ROUTES_NAMES.budget });
  });

  it('clears the provided context when the page goes away', async () => {
    goTo({ name: ROUTES_NAMES.transactions });
    const { result, unmount } = inComponent(() => {
      provideChatPageContext({ filters: { search: 'coffee' } });
      return useChatPageContext();
    });

    unmount();
    await nextTick();

    expect(result.context.value).toEqual({ route: ROUTES_NAMES.transactions });
  });

  it('lays what a drawer provides over the page, and the page shows again when the drawer closes', () => {
    goTo({ name: ROUTES_NAMES.plannedSubscriptionDetails, params: { id: 'sub-1' } });
    const page = effectScope();
    page.run(() => provideChatPageContext({ filters: { tab: 'history' } }));
    const drawer = effectScope();
    drawer.run(() =>
      provideChatPageContext({ focus: { kind: 'transaction', id: 'tx-1' }, filters: { tab: 'drawer' } }),
    );

    expect(useChatPageContext().context.value).toEqual({
      route: ROUTES_NAMES.plannedSubscriptionDetails,
      entity: { kind: 'subscription', id: 'sub-1' },
      focus: { kind: 'transaction', id: 'tx-1' },
      filters: { tab: 'drawer' },
    });

    drawer.stop();
    expect(useChatPageContext().context.value).toEqual({
      route: ROUTES_NAMES.plannedSubscriptionDetails,
      entity: { kind: 'subscription', id: 'sub-1' },
      filters: { tab: 'history' },
    });
    page.stop();
  });

  it('keeps what an earlier page provided when a later one provides something else', () => {
    goTo({ name: ROUTES_NAMES.transactions });
    const list = effectScope();
    list.run(() => provideChatPageContext({ filters: { search: 'coffee' } }));
    const selection = effectScope();
    selection.run(() => provideChatPageContext({ selection: { kind: 'transaction', ids: ['tx-1'], total: 1 } }));

    expect(useChatPageContext().context.value).toEqual({
      route: ROUTES_NAMES.transactions,
      filters: { search: 'coffee' },
      selection: { kind: 'transaction', ids: ['tx-1'], total: 1 },
    });

    list.stop();
    selection.stop();
  });

  it('sends a sensitive page by name only, whatever the page provides', () => {
    goTo({ name: ROUTES_NAMES.settingsAiModels });
    const scope = effectScope();
    scope.run(() =>
      provideChatPageContext({ filters: { apiKey: 'sk-secret' }, entity: { kind: 'bankConnection', id: 'c' } }),
    );

    expect(useChatPageContext().context.value).toEqual({ route: ROUTES_NAMES.settingsAiModels });
    scope.stop();
  });
});

describe('resolveRouteChatContext', () => {
  const entityRoutes = Object.entries(ROUTE_CHAT_CONTEXT).filter(
    (entry): entry is [string, Extract<RouteChatContext, { entity: object }>] =>
      'entity' in entry[1] && entry[1].entity !== undefined,
  );

  it.each(entityRoutes)('reads the %s entity from its route param', (routeName, declared) => {
    expect(resolveRouteChatContext({ routeName, params: { [declared.entity.param]: 'abc' } })).toEqual({
      route: routeName,
      entity: { kind: declared.entity.kind, id: 'abc' },
    });
  });

  it.each(entityRoutes)('sends only the route name for %s when the param is missing', (routeName) => {
    expect(resolveRouteChatContext({ routeName, params: {} })).toEqual({ route: routeName });
  });

  it('takes the first value of a repeated param', () => {
    expect(resolveRouteChatContext({ routeName: ROUTES_NAMES.account, params: { id: ['a', 'b'] } }).entity?.id).toBe(
      'a',
    );
  });

  it('sends a route nobody declared by name', () => {
    expect(resolveRouteChatContext({ routeName: 'dashboard.brand-new', params: { id: '1' } })).toEqual({
      route: 'dashboard.brand-new',
    });
  });
});

describe('page context in a route query', () => {
  it('round-trips through the query the header button builds for the chat page', () => {
    const context = {
      route: ROUTES_NAMES.transactions,
      entity: { kind: 'account' as const, id: '3' },
      focus: { kind: 'transaction' as const, id: 't9' },
      selection: { kind: 'transaction' as const, ids: ['t1', 't2'], total: 7 },
      filters: { search: 'coffee' },
      period: { from: '2026-09-01', to: '2026-09-30' },
    };

    expect(chatPageContextFromQuery({ query: chatPageContextToQuery({ context }) })).toEqual(context);
  });

  it('reads nothing from a query without a context or with a broken one', () => {
    expect(chatPageContextFromQuery({ query: {} })).toBeNull();
    expect(chatPageContextFromQuery({ query: { context: '{not json' } })).toBeNull();
    expect(chatPageContextFromQuery({ query: { context: '[1,2]' } })).toBeNull();
  });
});

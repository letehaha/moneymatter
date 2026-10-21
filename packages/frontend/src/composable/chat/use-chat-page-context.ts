import { ROUTE_CHAT_CONTEXT, isRedirectRoute } from '@/routes/chat-context';
import { CHAT_ENTITY_KINDS, type ChatEntityKind, type ChatPageContext } from '@bt/shared/types';
import { defineStore } from 'pinia';
import { type MaybeRefOrGetter, computed, onScopeDispose, ref, toValue, watch } from 'vue';
import { useRoute } from 'vue-router';

/** What a page tells the chat about itself; the route name is added from the router. */
export type ProvidedChatPageContext = Omit<ChatPageContext, 'route'>;

interface ContextProvider {
  token: symbol;
  routeName: string;
  read: () => ProvidedChatPageContext;
}

/**
 * The pages and drawers that provided a context, in the order they registered. A registry in a store
 * rather than provide/inject because the reader (the panel in the layout) is not a descendant of the page.
 */
const useChatPageContextStore = defineStore('chat-page-context', () => {
  const providers = ref<ContextProvider[]>([]);

  const register = ({ provider }: { provider: ContextProvider }) => {
    providers.value = [...providers.value, provider];
  };

  const unregister = ({ token }: { token: symbol }) => {
    providers.value = providers.value.filter((provider) => provider.token !== token);
  };

  return { providers, register, unregister };
});

const routeParam = ({ value }: { value: unknown }): string | null => {
  const first = Array.isArray(value) ? value[0] : value;
  return typeof first === 'string' && first !== '' ? first : null;
};

/**
 * A page calls this to say what it is showing (filters, a period, an entity). The context lives while
 * the page does: it goes when the component unmounts or the route changes. Pass a getter for a
 * context that follows reactive state.
 */
export const provideChatPageContext = (context: MaybeRefOrGetter<ProvidedChatPageContext>): void => {
  const route = useRoute();
  const store = useChatPageContextStore();
  const token = Symbol('chat-page-context');
  const routeName = String(route.name ?? '');

  store.register({ provider: { token, routeName, read: () => toValue(context) } });

  const stopWatching = watch(
    () => route.name,
    (name) => {
      if (String(name ?? '') !== routeName) store.unregister({ token });
    },
  );

  onScopeDispose(() => {
    stopWatching();
    store.unregister({ token });
  });
};

/**
 * What the router alone says about a route: its name, and the entity its param names. A route that
 * is declared sensitive says its name and nothing else, and a route nobody declared still says its name.
 */
export const resolveRouteChatContext = ({
  routeName,
  params,
}: {
  routeName: string;
  params: Record<string, unknown>;
}): ChatPageContext => {
  const base: ChatPageContext = { route: routeName };
  const declared = ROUTE_CHAT_CONTEXT[routeName];
  if (!declared || isRedirectRoute(declared) || declared.entity === undefined) return base;

  const id = routeParam({ value: params[declared.entity.param] });
  return id ? { ...base, entity: { kind: declared.entity.kind, id } } : base;
};

/** Whether the page must not add anything to the chat context (its declaration says why). */
const isSensitiveChatRoute = ({ routeName }: { routeName: string }): boolean => {
  const declared = ROUTE_CHAT_CONTEXT[routeName];
  return declared !== undefined && 'sensitive' in declared;
};

/**
 * The route's own context with what the pages on it provided laid over it, in the order they
 * registered: a drawer that opens after its page overrides the page.
 */
const mergeChatPageContext = ({
  base,
  provided,
}: {
  base: ChatPageContext;
  provided: ProvidedChatPageContext[];
}): ChatPageContext => {
  const merged: ChatPageContext = { ...base };
  for (const next of provided) Object.assign(merged, next, { route: base.route });
  return merged;
};

/** The context to send with a message: what the current page provided over the route's own default. */
export const useChatPageContext = () => {
  const route = useRoute();
  const store = useChatPageContextStore();

  const context = computed<ChatPageContext | null>(() => {
    if (route.name === undefined || route.name === null || route.name === '') return null;

    const routeName = String(route.name);
    const base = resolveRouteChatContext({ routeName, params: route.params });
    if (isSensitiveChatRoute({ routeName })) return base;

    // A provider registered for another route is stale until its watcher has run.
    const provided = store.providers.filter((candidate) => candidate.routeName === routeName).map((p) => p.read());
    return mergeChatPageContext({ base, provided });
  });

  return { context };
};

const PAGE_CONTEXT_QUERY_KEY = 'context';

/** The route query that carries a context to the Chat page (the mobile header button). */
export const chatPageContextToQuery = ({ context }: { context: ChatPageContext }): Record<string, string> => ({
  [PAGE_CONTEXT_QUERY_KEY]: JSON.stringify(context),
});

const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const isEntityKind = (value: unknown): value is ChatEntityKind =>
  typeof value === 'string' && (CHAT_ENTITY_KINDS as readonly string[]).includes(value);

/** The context a route query carries; anything unreadable is left out, and no context is null. */
export const chatPageContextFromQuery = ({ query }: { query: Record<string, unknown> }): ChatPageContext | null => {
  const raw = query[PAGE_CONTEXT_QUERY_KEY];
  if (typeof raw !== 'string') return null;

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!isPlainObject(parsed)) return null;

  const context: ChatPageContext = {};
  if (typeof parsed.route === 'string') context.route = parsed.route;
  for (const key of ['entity', 'focus'] as const) {
    const entityRef = parsed[key];
    if (isPlainObject(entityRef) && isEntityKind(entityRef.kind) && typeof entityRef.id === 'string') {
      context[key] = { kind: entityRef.kind, id: entityRef.id };
    }
  }
  const selection = parsed.selection;
  if (isPlainObject(selection) && isEntityKind(selection.kind) && Array.isArray(selection.ids)) {
    const ids = selection.ids.filter((id): id is string => typeof id === 'string');
    context.selection = {
      kind: selection.kind,
      ids,
      ...(typeof selection.total === 'number' ? { total: selection.total } : {}),
    };
  }
  if (isPlainObject(parsed.filters)) context.filters = parsed.filters;
  if (isPlainObject(parsed.period) && typeof parsed.period.from === 'string' && typeof parsed.period.to === 'string') {
    context.period = { from: parsed.period.from, to: parsed.period.to };
  }
  return context;
};

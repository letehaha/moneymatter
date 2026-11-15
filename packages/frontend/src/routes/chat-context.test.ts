import enChat from '@/i18n/locales/chunks/en/pages/chat.json';
import ukChat from '@/i18n/locales/chunks/uk/pages/chat.json';
import { CHAT_ENTITY_KINDS } from '@bt/shared/types';
import { describe, expect, it } from 'vitest';

import { ROUTE_CHAT_CONTEXT, isRedirectRoute } from './chat-context';
import { ROUTES_NAMES } from './constants';
import { router } from './index';

const named = router.getRoutes().filter((record) => typeof record.name === 'string');
const isRedirect = (record: { redirect?: unknown }) => record.redirect !== undefined;

describe('router chat context coverage', () => {
  it('finds the routes of the app', () => {
    expect(named.length).toBeGreaterThan(80);
  });

  it.each(named.map((record) => [record.name as string, record] as const))(
    'declares what the chat sees on %s',
    (name, record) => {
      const declared = ROUTE_CHAT_CONTEXT[name];

      // Add the route to ROUTE_CHAT_CONTEXT in src/routes/chat-context.ts: a page with its name, an entity
      // page with the param that holds its id, or a sensitive page with the reason it must stay dark.
      expect(declared, `${name} has no entry in ROUTE_CHAT_CONTEXT`).toBeDefined();
      expect(isRedirectRoute(declared!), `${name} ${isRedirect(record) ? 'redirects' : 'renders'}`).toBe(
        isRedirect(record),
      );
    },
  );

  it('declares only routes that exist', () => {
    const names = new Set(named.map((record) => record.name));

    expect(Object.keys(ROUTE_CHAT_CONTEXT).filter((name) => !names.has(name))).toEqual([]);
  });

  it('names an entity route param that the route path has', () => {
    for (const record of named) {
      const declared = ROUTE_CHAT_CONTEXT[record.name as string];
      if (!declared || !('entity' in declared) || declared.entity === undefined) continue;

      expect(record.path, `${String(record.name)} path`).toContain(`:${declared.entity.param}`);
    }
  });

  it('uses entity kinds the server knows', () => {
    for (const declared of Object.values(ROUTE_CHAT_CONTEXT)) {
      if ('entity' in declared && declared.entity) expect(CHAT_ENTITY_KINDS).toContain(declared.entity.kind);
    }
  });

  it('has a name in en and uk for every page it declares', () => {
    const pages = new Set(
      Object.values(ROUTE_CHAT_CONTEXT).flatMap((declared) =>
        'page' in declared && declared.page !== undefined ? [declared.page] : [],
      ),
    );

    for (const page of [...pages, 'generic']) {
      expect(enChat.chat.context.pages, `en: ${page}`).toHaveProperty(page);
      expect(ukChat.chat.context.pages, `uk: ${page}`).toHaveProperty(page);
    }
  });
});

describe('sensitive routes', () => {
  const sensitive = Object.entries(ROUTE_CHAT_CONTEXT).filter(([, declared]) => 'sensitive' in declared);

  it('give a reason in code', () => {
    for (const [name, declared] of sensitive) {
      expect('sensitive' in declared && declared.sensitive.reason.length, name).toBeGreaterThan(10);
    }
  });

  it('cover the pages that hold credentials, tokens and secrets', () => {
    const names = sensitive.map(([name]) => name);

    expect(names).toEqual(
      expect.arrayContaining([
        ROUTES_NAMES.signIn,
        ROUTES_NAMES.signUp,
        ROUTES_NAMES.forgotPassword,
        ROUTES_NAMES.resetPassword,
        ROUTES_NAMES.oauthAuthorize,
        ROUTES_NAMES.settingsSecurityPassword,
        ROUTES_NAMES.settingsSecurityLoginMethods,
        ROUTES_NAMES.settingsAiModels,
        ROUTES_NAMES.settingsAiConnectedApps,
      ]),
    );
  });
});

import { describe, expect, it } from '@jest/globals';

import { isReadOnlyAllowed } from './entitlements';

const ID = '3f1b0c9e-6a58-4b6d-9d4e-0a7d2f3c8b11';

describe('isReadOnlyAllowed', () => {
  describe('chat routes of a read-only user', () => {
    // Every route of the chat API table. "allowed" routes write no financial data; the rest need a plan.
    const CHAT_ROUTES: Array<{ method: string; path: string; allowed: boolean }> = [
      { method: 'POST', path: '/chat/threads', allowed: true },
      { method: 'PATCH', path: `/chat/threads/${ID}`, allowed: true },
      { method: 'DELETE', path: `/chat/threads/${ID}`, allowed: true },
      { method: 'POST', path: `/chat/threads/${ID}/attachments`, allowed: true },
      { method: 'POST', path: `/chat/threads/${ID}/messages`, allowed: true },
      { method: 'POST', path: `/chat/runs/${ID}/cancel`, allowed: true },
      { method: 'POST', path: `/chat/proposals/${ID}/refresh`, allowed: true },
      { method: 'POST', path: `/chat/proposals/${ID}/reject`, allowed: true },
      { method: 'POST', path: `/chat/proposals/${ID}/comment`, allowed: true },
      { method: 'PUT', path: '/chat/settings', allowed: true },
      { method: 'PATCH', path: `/chat/proposals/${ID}`, allowed: false },
      { method: 'POST', path: `/chat/proposals/${ID}/approve`, allowed: false },
      { method: 'POST', path: `/chat/messages/${ID}/approve-all`, allowed: false },
    ];

    it.each(CHAT_ROUTES)('classifies $method $path as allowed=$allowed', ({ method, path, allowed }) => {
      expect(isReadOnlyAllowed({ method, path })).toBe(allowed);
    });

    it('matches a rule only for its own method', () => {
      expect(isReadOnlyAllowed({ method: 'PUT', path: '/chat/threads' })).toBe(false);
      expect(isReadOnlyAllowed({ method: 'POST', path: '/chat/settings' })).toBe(false);
      expect(isReadOnlyAllowed({ method: 'DELETE', path: `/chat/proposals/${ID}/reject` })).toBe(false);
    });

    it('does not let a path segment stand in for another or extend a rule', () => {
      expect(isReadOnlyAllowed({ method: 'DELETE', path: `/chat/threads/${ID}/messages` })).toBe(false);
      expect(isReadOnlyAllowed({ method: 'POST', path: `/chat/threads/${ID}/messages/extra` })).toBe(false);
      expect(isReadOnlyAllowed({ method: 'POST', path: `/chat/threads/${ID}/x/messages` })).toBe(false);
      expect(isReadOnlyAllowed({ method: 'POST', path: '/chat/threads//messages' })).toBe(false);
      expect(isReadOnlyAllowed({ method: 'POST', path: `/other/chat/threads/${ID}/messages` })).toBe(false);
    });
  });

  describe('routes outside /chat/', () => {
    it('still allows the exact-match routes and prefixes', () => {
      expect(isReadOnlyAllowed({ method: 'PUT', path: '/user/settings' })).toBe(true);
      expect(isReadOnlyAllowed({ method: 'POST', path: '/notifications/read-all' })).toBe(true);
      expect(isReadOnlyAllowed({ method: 'POST', path: '/billing/checkout' })).toBe(true);
    });

    it('keeps matching the notification read route after it moved into the pattern list', () => {
      expect(isReadOnlyAllowed({ method: 'POST', path: `/notifications/${ID}/read` })).toBe(true);
      expect(isReadOnlyAllowed({ method: 'POST', path: `/notifications/${ID}/other` })).toBe(false);
    });

    it('keeps blocking financial writes', () => {
      expect(isReadOnlyAllowed({ method: 'POST', path: '/accounts' })).toBe(false);
      expect(isReadOnlyAllowed({ method: 'DELETE', path: `/transactions/${ID}` })).toBe(false);
      expect(isReadOnlyAllowed({ method: 'POST', path: `/threads/${ID}/messages` })).toBe(false);
    });
  });
});

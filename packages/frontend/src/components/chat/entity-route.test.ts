import { ROUTES_NAMES } from '@/routes/constants';
import { describe, expect, it } from 'vitest';

import { chatEntityRoute } from './entity-route';

describe('chatEntityRoute', () => {
  it('names the detail route of an entity with a page', () => {
    expect(chatEntityRoute({ entity: { kind: 'account', id: '7' } })).toEqual({
      name: ROUTES_NAMES.account,
      params: { id: '7' },
    });
    expect(chatEntityRoute({ entity: { kind: 'portfolio', id: '3' } })).toEqual({
      name: ROUTES_NAMES.portfolioDetail,
      params: { portfolioId: '3' },
    });
    expect(chatEntityRoute({ entity: { kind: 'payee', id: '9' } })).toEqual({
      name: ROUTES_NAMES.settingsPayeeDetail,
      params: { id: '9' },
    });
  });

  it('returns null for an entity without a page of its own', () => {
    expect(chatEntityRoute({ entity: { kind: 'category', id: '1' } })).toBeNull();
    expect(chatEntityRoute({ entity: { kind: 'transaction', id: '1' } })).toBeNull();
  });
});

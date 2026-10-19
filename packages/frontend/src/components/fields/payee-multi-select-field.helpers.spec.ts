import type { RecordId } from '@bt/shared/types';
import { describe, expect, it } from 'vitest';

import { type SelectedPayee, hydrateSelectedPayees } from './payee-multi-select-field.helpers';

const payee = (
  id: string,
  name: string,
  logoDomain: string | null = null,
  logoInitials: string | null = null,
  logoColor: string | null = null,
): SelectedPayee => ({
  id: id as RecordId,
  name,
  logoDomain,
  logoInitials,
  logoColor,
  logoIcon: null,
  logoImageId: null,
});

describe('hydrateSelectedPayees', () => {
  it('replaces an id-placeholder name once the lookup resolves it (saved-view restore)', () => {
    // A restored selection starts with name === id because no source has resolved it yet.
    const selected = [payee('019ea731-0e4e', '019ea731-0e4e')];
    const lookup = new Map([
      [
        '019ea731-0e4e',
        {
          name: 'Glovo',
          logoDomain: 'glovoapp.com',
          logoInitials: null,
          logoColor: null,
          logoIcon: null,
          logoImageId: null,
        },
      ],
    ]);

    const result = hydrateSelectedPayees({ selected, lookup });

    expect(result[0]).toEqual(payee('019ea731-0e4e', 'Glovo', 'glovoapp.com'));
  });

  it('keeps object identity for rows the lookup does not resolve', () => {
    const row = payee('missing', 'missing');
    const result = hydrateSelectedPayees({ selected: [row], lookup: new Map() });

    expect(result[0]).toBe(row);
  });

  it('keeps object identity when name and logo are unchanged', () => {
    const row = payee('a', 'Amazon', 'amazon.com');
    const lookup = new Map([
      [
        'a',
        {
          name: 'Amazon',
          logoDomain: 'amazon.com',
          logoInitials: null,
          logoColor: null,
          logoIcon: null,
          logoImageId: null,
        },
      ],
    ]);

    const result = hydrateSelectedPayees({ selected: [row], lookup });

    expect(result[0]).toBe(row);
  });

  it('normalizes an undefined lookup logo to null', () => {
    const row = payee('a', 'a', null);
    const lookup = new Map([
      [
        'a',
        { name: 'Amazon', logoDomain: null, logoInitials: null, logoColor: null, logoIcon: null, logoImageId: null },
      ],
    ]);

    const result = hydrateSelectedPayees({ selected: [row], lookup });

    expect(result[0]).toEqual(payee('a', 'Amazon', null));
  });

  it('refreshes a custom monogram when only the initials/color changed', () => {
    const row = payee('a', 'Amazon', null, 'AM', '#7355be');
    const lookup = new Map([
      [
        'a',
        {
          name: 'Amazon',
          logoDomain: null,
          logoInitials: 'AZ',
          logoColor: '#c2410c',
          logoIcon: null,
          logoImageId: null,
        },
      ],
    ]);

    const result = hydrateSelectedPayees({ selected: [row], lookup });

    expect(result[0]).toEqual(payee('a', 'Amazon', null, 'AZ', '#c2410c'));
  });

  it('refreshes a row when only the icon changed', () => {
    const row = { ...payee('a', 'Amazon', null, null, '#7355be'), logoIcon: 'cart' };
    const fresh = { ...row, logoIcon: 'box' };

    const result = hydrateSelectedPayees({ selected: [row], lookup: new Map([['a', fresh]]) });

    expect(result[0]).not.toBe(row);
    expect(result[0]).toEqual(fresh);
  });

  it('refreshes a row when only the image changed', () => {
    const row = { ...payee('a', 'Amazon'), logoImageId: 'image-1' };
    const fresh = { ...row, logoImageId: 'image-2' };

    const result = hydrateSelectedPayees({ selected: [row], lookup: new Map([['a', fresh]]) });

    expect(result[0]).not.toBe(row);
    expect(result[0]).toEqual(fresh);
  });
});

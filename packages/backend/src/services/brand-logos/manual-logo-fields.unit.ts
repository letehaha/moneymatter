import { describe, expect, it } from '@jest/globals';
import { ValidationError } from '@js/errors';

import { resolveManualLogoFields } from './manual-logo-fields';

describe('resolveManualLogoFields', () => {
  describe('setting values', () => {
    it('setting a domain evicts initials and color', () => {
      expect(resolveManualLogoFields({ input: { logoDomain: 'netflix.com' } })).toEqual({
        logoSource: 'manual',
        logoDomain: 'netflix.com',
        logoInitials: null,
        logoIcon: null,
        logoImageId: null,
        logoColor: null,
      });
    });

    it('setting initials evicts the domain', () => {
      expect(resolveManualLogoFields({ input: { logoInitials: 'AB' } })).toEqual({
        logoSource: 'manual',
        logoInitials: 'AB',
        logoDomain: null,
        logoIcon: null,
        logoImageId: null,
      });
    });

    it('setting initials together with a color stamps both', () => {
      expect(resolveManualLogoFields({ input: { logoInitials: 'AB', logoColor: '#7355be' } })).toEqual({
        logoSource: 'manual',
        logoInitials: 'AB',
        logoDomain: null,
        logoIcon: null,
        logoImageId: null,
        logoColor: '#7355be',
      });
    });

    it('recolors alone when the stored row already has initials', () => {
      expect(
        resolveManualLogoFields({
          input: { logoColor: '#0ea5e9' },
          stored: { logoInitials: 'AB', logoColor: '#7355be' },
        }),
      ).toEqual({ logoSource: 'manual', logoColor: '#0ea5e9' });
    });

    it('setting an icon evicts domain, initials and image', () => {
      expect(
        resolveManualLogoFields({ input: { logoIcon: 'food-24-regular' }, stored: { logoInitials: 'AB' } }),
      ).toEqual({
        logoSource: 'manual',
        logoIcon: 'food-24-regular',
        logoDomain: null,
        logoInitials: null,
        logoImageId: null,
      });
    });

    it('setting an image evicts the other slots and the color', () => {
      expect(
        resolveManualLogoFields({
          input: { logoImageId: 'img-1' },
          stored: { logoInitials: 'AB', logoColor: '#7355be' },
        }),
      ).toEqual({
        logoSource: 'manual',
        logoImageId: 'img-1',
        logoDomain: null,
        logoInitials: null,
        logoIcon: null,
        logoColor: null,
      });
    });

    it('accepts a color behind an icon', () => {
      expect(resolveManualLogoFields({ input: { logoIcon: 'food-24-regular', logoColor: '#7355be' } })).toEqual({
        logoSource: 'manual',
        logoIcon: 'food-24-regular',
        logoDomain: null,
        logoInitials: null,
        logoImageId: null,
        logoColor: '#7355be',
      });
    });

    it('recolors alone when the stored row has an icon', () => {
      expect(
        resolveManualLogoFields({ input: { logoColor: '#0ea5e9' }, stored: { logoIcon: 'food-24-regular' } }),
      ).toEqual({ logoSource: 'manual', logoColor: '#0ea5e9' });
    });
  });

  describe('clearing stored values', () => {
    it('clearing a stored icon clears the color', () => {
      expect(
        resolveManualLogoFields({
          input: { logoIcon: null },
          stored: { logoIcon: 'food-24-regular', logoColor: '#7355be' },
        }),
      ).toEqual({ logoSource: 'manual', logoIcon: null, logoColor: null });
    });

    it('clearing a stored domain stamps manual (explicit no-logo)', () => {
      expect(resolveManualLogoFields({ input: { logoDomain: null }, stored: { logoDomain: 'netflix.com' } })).toEqual({
        logoSource: 'manual',
        logoDomain: null,
      });
    });

    it('clearing stored initials stamps manual and clears the color', () => {
      expect(
        resolveManualLogoFields({
          input: { logoInitials: null },
          stored: { logoInitials: 'AB', logoColor: '#7355be' },
        }),
      ).toEqual({ logoSource: 'manual', logoInitials: null, logoColor: null });
    });
  });

  describe('validation', () => {
    it('throws when a color arrives without initials (input or stored)', () => {
      expect(() => resolveManualLogoFields({ input: { logoColor: '#7355be' } })).toThrow(ValidationError);
    });

    it('throws when icon and initials are both set', () => {
      expect(() => resolveManualLogoFields({ input: { logoIcon: 'food-24-regular', logoInitials: 'AB' } })).toThrow(
        ValidationError,
      );
    });

    it('throws when a color arrives on a stored image', () => {
      expect(() =>
        resolveManualLogoFields({ input: { logoColor: '#7355be' }, stored: { logoImageId: 'img-1' } }),
      ).toThrow(ValidationError);
    });

    it('throws when image and domain are both set', () => {
      expect(() => resolveManualLogoFields({ input: { logoImageId: 'img-1', logoDomain: 'netflix.com' } })).toThrow(
        ValidationError,
      );
    });
  });

  describe('no-op payloads keep resolver ownership', () => {
    it('returns {} when all logo keys are absent', () => {
      expect(resolveManualLogoFields({ input: {} })).toEqual({});
    });

    it('returns {} for { logoInitials: null } when nothing is stored', () => {
      expect(resolveManualLogoFields({ input: { logoInitials: null } })).toEqual({});
    });

    it('returns {} for { logoDomain: null } when nothing is stored', () => {
      expect(resolveManualLogoFields({ input: { logoDomain: null } })).toEqual({});
    });

    it('returns {} for the three-null reset when nothing is stored', () => {
      expect(resolveManualLogoFields({ input: { logoDomain: null, logoInitials: null, logoIcon: null } })).toEqual({});
    });

    it('returns {} when the payload re-states the stored domain', () => {
      expect(
        resolveManualLogoFields({ input: { logoDomain: 'netflix.com' }, stored: { logoDomain: 'netflix.com' } }),
      ).toEqual({});
    });

    it('returns {} when the payload re-states the stored monogram', () => {
      expect(
        resolveManualLogoFields({
          input: { logoInitials: 'AB', logoColor: '#7355be' },
          stored: { logoInitials: 'AB', logoColor: '#7355be' },
        }),
      ).toEqual({});
    });
  });
});

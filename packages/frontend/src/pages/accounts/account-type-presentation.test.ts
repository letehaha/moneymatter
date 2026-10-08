import { ACCOUNT_CATEGORIES } from '@bt/shared/types';
import { describe, expect, it } from 'vitest';

import {
  getAccountTypeIcon,
  getAccountTypeSolidChipClass,
  getAccountTypeTintedChipClass,
} from './account-type-presentation';

describe('account-type-presentation', () => {
  describe('getAccountTypeIcon', () => {
    it('returns a defined icon component for every account category', () => {
      for (const category of Object.values(ACCOUNT_CATEGORIES)) {
        expect(getAccountTypeIcon({ category })).toBeDefined();
      }
    });

    it('falls back to a defined icon for an unknown category', () => {
      const icon = getAccountTypeIcon({
        category: 'totally-unknown-category' as ACCOUNT_CATEGORIES,
      });
      expect(icon).toBeDefined();
    });
  });

  describe('getAccountTypeTintedChipClass', () => {
    it.each([
      [ACCOUNT_CATEGORIES.currentAccount, 'bg-account-checking/15 text-account-checking'],
      [ACCOUNT_CATEGORIES.general, 'bg-account-checking/15 text-account-checking'],
      [ACCOUNT_CATEGORIES.saving, 'bg-account-saving/15 text-account-saving'],
      [ACCOUNT_CATEGORIES.creditCard, 'bg-account-credit/15 text-account-credit'],
      [ACCOUNT_CATEGORIES.overdraft, 'bg-account-credit/15 text-account-credit'],
      [ACCOUNT_CATEGORIES.cash, 'bg-account-cash/15 text-account-cash'],
      [ACCOUNT_CATEGORIES.investment, 'bg-account-investment/15 text-account-investment'],
      [ACCOUNT_CATEGORIES.crypto, 'bg-account-crypto/15 text-account-crypto'],
      [ACCOUNT_CATEGORIES.vehicle, 'bg-account-vehicle/15 text-account-vehicle'],
    ])('returns the exact chip literal for %s', (category, expected) => {
      expect(getAccountTypeTintedChipClass({ category })).toBe(expected);
    });

    it('returns a chip class for every account category', () => {
      for (const category of Object.values(ACCOUNT_CATEGORIES)) {
        expect(getAccountTypeTintedChipClass({ category })).toMatch(/^bg-account-\w+\/15 text-account-\w+$/);
      }
    });

    it('falls back to the checking chip literal for an unknown category', () => {
      const chip = getAccountTypeTintedChipClass({
        category: 'totally-unknown-category' as ACCOUNT_CATEGORIES,
      });
      expect(chip).toBe('bg-account-checking/15 text-account-checking');
    });
  });

  describe('getAccountTypeSolidChipClass', () => {
    it('returns an opaque chip class for every account category', () => {
      for (const category of Object.values(ACCOUNT_CATEGORIES)) {
        expect(getAccountTypeSolidChipClass({ category })).toMatch(/^bg-account-\w+ text-background$/);
      }
    });

    it('falls back to the checking chip for an unknown category', () => {
      expect(getAccountTypeSolidChipClass({ category: 'totally-unknown-category' as ACCOUNT_CATEGORIES })).toBe(
        'bg-account-checking text-background',
      );
    });
  });
});

import { describe, expect, it } from '@jest/globals';

import { dominantPaymentType } from './account-history-guard';

describe('dominantPaymentType', () => {
  it('names the type most of the history shares', () => {
    expect(dominantPaymentType({ types: ['debitCard', 'debitCard', 'debitCard', 'cash'] })).toBe('debitCard');
  });

  it('names none when no type reaches the share', () => {
    expect(dominantPaymentType({ types: ['debitCard', 'cash', 'creditCard', 'debitCard', 'cash'] })).toBeNull();
  });

  it('names none for too little history', () => {
    expect(dominantPaymentType({ types: ['debitCard', 'debitCard'] })).toBeNull();
    expect(dominantPaymentType({ types: [] })).toBeNull();
  });
});

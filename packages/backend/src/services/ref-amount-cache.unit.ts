import { Money } from '@common/types/money';
import { describe, expect, it } from '@jest/globals';

import { buildRefAmountCacheKey, buildRefAmountCachePattern, serializeRefAmountCacheValue } from './ref-amount-cache';

describe('ref amount cache', () => {
  it('namespaces keys under ref_amount:v2 with the exact decimal amount', () => {
    const key = buildRefAmountCacheKey({
      userId: 7,
      amount: Money.fromDecimal('0.00040641'),
      baseCode: 'BTC',
      quoteCode: 'USD',
      dateStr: '2024-03-15',
    });

    expect(key).toBe('ref_amount:v2:7:0.000406410000000000:BTC:USD:2024-03-15');
  });

  it('gives one key to equal amounts however they were built', () => {
    const fromNumber = buildRefAmountCacheKey({
      userId: 1,
      amount: Money.fromDecimal(10.5),
      baseCode: 'EUR',
      quoteCode: 'USD',
      dateStr: '2024-01-01',
    });
    const fromCents = buildRefAmountCacheKey({
      userId: 1,
      amount: Money.fromCents(1050),
      baseCode: 'EUR',
      quoteCode: 'USD',
      dateStr: '2024-01-01',
    });

    expect(fromNumber).toBe(fromCents);
  });

  it('matches every key of the user, and only of that user, with the invalidation pattern', () => {
    const pattern = buildRefAmountCachePattern({ userId: 7 });
    const key = buildRefAmountCacheKey({
      userId: 7,
      amount: Money.fromDecimal(1),
      baseCode: 'EUR',
      quoteCode: 'USD',
      dateStr: '2024-01-01',
    });
    const regex = new RegExp(`^${pattern.replaceAll('*', '.*')}$`);

    expect(regex.test(key)).toBe(true);
    expect(regex.test(key.replace(':7:', ':70:'))).toBe(false);
    expect(regex.test(key.replace('ref_amount:v2:', 'ref_amount:'))).toBe(false);
  });

  it('serializes a value as an exact decimal string', () => {
    expect(serializeRefAmountCacheValue({ amount: Money.fromDecimal('123.45') })).toBe('123.450000000000000000');
  });
});

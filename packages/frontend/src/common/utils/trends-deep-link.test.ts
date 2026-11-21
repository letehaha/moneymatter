import { ROUTES_NAMES } from '@/routes/constants';
import type { LocationQuery } from 'vue-router';

import { buildTrendsLocation, readTrendsDeepLink } from './trends-deep-link';

const FROM = new Date('2026-01-01T00:00:00.000Z');
const TO = new Date('2026-01-31T23:59:59.999Z');

const queryOf = (location: ReturnType<typeof buildTrendsLocation>) => (location as { query: LocationQuery }).query;

describe('buildTrendsLocation', () => {
  it('targets the Trends page and omits empty parts', () => {
    expect(buildTrendsLocation({ categoryIds: [] })).toStrictEqual({
      name: ROUTES_NAMES.analyticsTrendsComparison,
      query: {},
    });
  });

  it('writes only the keys it was given', () => {
    expect(buildTrendsLocation({ excludedCategoryIds: ['3'], metric: 'income' })).toStrictEqual({
      name: ROUTES_NAMES.analyticsTrendsComparison,
      query: { excludedCategoryIds: ['3'], metric: 'income' },
    });
  });
});

describe('readTrendsDeepLink', () => {
  it('round-trips everything the builder writes', () => {
    const query = queryOf(
      buildTrendsLocation({ categoryIds: ['1', '2'], metric: 'income', period: { from: FROM, to: TO } }),
    );

    expect(readTrendsDeepLink({ query })).toEqual({
      categoryIds: ['1', '2'],
      excludedCategoryIds: [],
      metric: 'income',
      period: { from: FROM, to: TO },
      restQuery: {},
    });
  });

  it('round-trips excluded categories', () => {
    const query = queryOf(buildTrendsLocation({ excludedCategoryIds: ['3'] }));
    expect(readTrendsDeepLink({ query })?.excludedCategoryIds).toEqual(['3']);
  });

  it('reads scalar string ids as arrays', () => {
    const link = readTrendsDeepLink({ query: { categoryIds: '1', excludedCategoryIds: '2' } });
    expect(link?.categoryIds).toEqual(['1']);
    expect(link?.excludedCategoryIds).toEqual(['2']);
  });

  it('keeps a single-instant period where from equals to', () => {
    expect(readTrendsDeepLink({ query: { from: FROM.toISOString(), to: FROM.toISOString() } })?.period).toEqual({
      from: FROM,
      to: FROM,
    });
  });

  it('is null when no deep-link key is present', () => {
    expect(readTrendsDeepLink({ query: { tab: 'x' } })).toBeNull();
  });

  it('keeps unrelated query params', () => {
    expect(readTrendsDeepLink({ query: { categoryIds: '1', tab: 'x' } })?.restQuery).toEqual({ tab: 'x' });
  });

  it('takes the first value of repeated scalar params', () => {
    const link = readTrendsDeepLink({
      query: { metric: ['income', 'expenses'], from: [FROM.toISOString(), 'x'], to: [TO.toISOString()] },
    });
    expect(link?.metric).toBe('income');
    expect(link?.period).toEqual({ from: FROM, to: TO });
  });

  it('keeps only non-empty string ids', () => {
    const link = readTrendsDeepLink({ query: { categoryIds: ['1', '', null], excludedCategoryIds: '' } });
    expect(link?.categoryIds).toEqual(['1']);
    expect(link?.excludedCategoryIds).toEqual([]);
  });

  it('reads absent ids as empty', () => {
    expect(readTrendsDeepLink({ query: { metric: 'expenses' } })).toEqual({
      categoryIds: [],
      excludedCategoryIds: [],
      metric: 'expenses',
      period: undefined,
      restQuery: {},
    });
  });

  it('ignores an unknown metric', () => {
    expect(readTrendsDeepLink({ query: { metric: 'savings' } })?.metric).toBeUndefined();
  });

  it('drops the period when a date is missing or invalid', () => {
    expect(readTrendsDeepLink({ query: { from: FROM.toISOString() } })?.period).toBeUndefined();
    expect(readTrendsDeepLink({ query: { from: 'nope', to: TO.toISOString() } })?.period).toBeUndefined();
  });

  it('drops the period when from is after to', () => {
    expect(readTrendsDeepLink({ query: { from: TO.toISOString(), to: FROM.toISOString() } })?.period).toBeUndefined();
  });
});

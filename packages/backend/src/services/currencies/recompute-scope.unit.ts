import { describe, expect, it } from '@jest/globals';

import {
  type CustomRateChange,
  buildRowSelectors,
  buildScope,
  expandScope,
  matchesRowSelectors,
  selectorEnvelope,
} from './recompute-scope';

const change = (overrides: Partial<CustomRateChange> = {}): CustomRateChange => ({
  currencyCode: 'EUR',
  from: '2026-01-10',
  to: '2026-01-20',
  ...overrides,
});

const at = (day: string): Date => new Date(`${day}T12:00:00.000Z`);

describe('expandScope', () => {
  it('adds a currency pegged to a changed one, with the same days', () => {
    const scope = buildScope({ changes: [change()] });

    const expanded = expandScope({ scope, edges: [{ dependent: 'USDC', source: 'EUR' }] });

    expect([...expanded.keys()].toSorted()).toEqual(['EUR', 'USDC']);
    expect(expanded.get('USDC')).toEqual([{ from: '2026-01-10', to: '2026-01-20' }]);
  });

  it('leaves currencies that depend on nothing changed alone', () => {
    const expanded = expandScope({
      scope: buildScope({ changes: [change()] }),
      edges: [{ dependent: 'SAT', source: 'USD' }],
    });

    expect([...expanded.keys()]).toEqual(['EUR']);
  });

  it('carries every interval of a source to its dependent, once each', () => {
    const scope = buildScope({ changes: [change(), change({ from: '2026-03-01', to: null }), change()] });

    const expanded = expandScope({ scope, edges: [{ dependent: 'USDC', source: 'EUR' }] });

    expect(expanded.get('USDC')).toEqual(expanded.get('EUR'));
    expect(expanded.get('USDC')).toHaveLength(2);
  });

  it('merges the intervals of a dependent that changed itself as well', () => {
    const scope = buildScope({ changes: [change(), change({ currencyCode: 'USDC', from: '2026-05-01', to: null })] });

    const expanded = expandScope({ scope, edges: [{ dependent: 'USDC', source: 'EUR' }] });

    expect(expanded.get('USDC')).toEqual([
      { from: '2026-05-01', to: null },
      { from: '2026-01-10', to: '2026-01-20' },
    ]);
  });
});

describe('row selection', () => {
  const selectors = buildRowSelectors({ intervals: [{ from: '2026-01-10', to: '2026-01-20' }] });

  it('selects every row on the days of a change', () => {
    expect(matchesRowSelectors({ selectors, row: { time: at('2026-01-10') } })).toBe(true);
    expect(matchesRowSelectors({ selectors, row: { time: at('2026-01-19') } })).toBe(true);
  });

  it('leaves rows outside the days alone, the end day being exclusive', () => {
    expect(matchesRowSelectors({ selectors, row: { time: at('2026-01-09') } })).toBe(false);
    expect(matchesRowSelectors({ selectors, row: { time: at('2026-01-20') } })).toBe(false);
  });

  it('treats an open side as unbounded', () => {
    const all = buildRowSelectors({ intervals: [{ from: null, to: null }] });

    expect(matchesRowSelectors({ selectors: all, row: { time: at('1999-01-01') } })).toBe(true);
    expect(matchesRowSelectors({ selectors: all, row: { time: at('2999-01-01') } })).toBe(true);
  });
});

describe('selectorEnvelope', () => {
  it('spans the earliest start to the latest end', () => {
    const selectors = buildRowSelectors({
      intervals: [
        { from: '2026-01-10', to: '2026-01-20' },
        { from: '2026-02-01', to: '2026-02-05' },
      ],
    });

    expect(selectorEnvelope({ selectors })).toEqual({
      from: new Date('2026-01-10T00:00:00.000Z'),
      to: new Date('2026-02-05T00:00:00.000Z'),
    });
  });

  it('stays open on a side that any interval leaves open', () => {
    const selectors = buildRowSelectors({
      intervals: [
        { from: '2026-01-10', to: null },
        { from: null, to: '2026-01-05' },
      ],
    });

    expect(selectorEnvelope({ selectors })).toEqual({ from: null, to: null });
  });
});

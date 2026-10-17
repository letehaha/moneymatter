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
  currencyCode: 'USDT',
  from: '2026-01-10',
  to: '2026-01-20',
  mode: 'recompute',
  ...overrides,
});

const at = (day: string): Date => new Date(`${day}T12:00:00.000Z`);

describe('expandScope', () => {
  it('adds a currency pegged to a changed one, with the same days', () => {
    const scope = buildScope({ changes: [change()] });

    const expanded = expandScope({ scope, edges: [{ dependent: 'USDC', source: 'USDT' }] });

    expect([...expanded.keys()].toSorted()).toEqual(['USDC', 'USDT']);
    expect(expanded.get('USDC')).toEqual([{ from: '2026-01-10', to: '2026-01-20', mode: 'recompute' }]);
  });

  it('follows a chain of dependencies however long it is', () => {
    const scope = buildScope({ changes: [change()] });

    const expanded = expandScope({
      scope,
      edges: [
        { dependent: 'C', source: 'B' },
        { dependent: 'B', source: 'USDT' },
        { dependent: 'D', source: 'C' },
      ],
    });

    expect([...expanded.keys()].toSorted()).toEqual(['B', 'C', 'D', 'USDT']);
  });

  it('leaves currencies that depend on nothing changed alone', () => {
    const expanded = expandScope({
      scope: buildScope({ changes: [change()] }),
      edges: [{ dependent: 'SAT', source: 'BTC' }],
    });

    expect([...expanded.keys()]).toEqual(['USDT']);
  });

  it('ends on a cycle of dependencies', () => {
    const expanded = expandScope({
      scope: buildScope({ changes: [change()] }),
      edges: [
        { dependent: 'B', source: 'USDT' },
        { dependent: 'USDT', source: 'B' },
      ],
    });

    expect(expanded.get('B')).toHaveLength(1);
    expect(expanded.get('USDT')).toHaveLength(1);
  });

  it('carries every interval and mode of a source to its dependent', () => {
    const scope = buildScope({
      changes: [change(), change({ from: '2026-03-01', to: null, mode: 'fill' })],
    });

    const expanded = expandScope({ scope, edges: [{ dependent: 'USDC', source: 'USDT' }] });

    expect(expanded.get('USDC')).toEqual(expanded.get('USDT'));
    expect(expanded.get('USDC')).toHaveLength(2);
  });
});

describe('row selection', () => {
  const recompute = buildRowSelectors({ intervals: [{ from: '2026-01-10', to: '2026-01-20', mode: 'recompute' }] });

  it('selects every row on the days of a recompute, valued or not', () => {
    expect(
      matchesRowSelectors({ selectors: recompute, row: { time: at('2026-01-10'), refAmountMissing: false } }),
    ).toBe(true);
    expect(matchesRowSelectors({ selectors: recompute, row: { time: at('2026-01-19'), refAmountMissing: true } })).toBe(
      true,
    );
  });

  it('leaves rows outside the days alone, the end day being exclusive', () => {
    expect(matchesRowSelectors({ selectors: recompute, row: { time: at('2026-01-09'), refAmountMissing: true } })).toBe(
      false,
    );
    expect(matchesRowSelectors({ selectors: recompute, row: { time: at('2026-01-20'), refAmountMissing: true } })).toBe(
      false,
    );
  });

  it('selects no previously valued row when a rate is added for a new day', () => {
    const fill = buildRowSelectors({ intervals: [{ from: '2026-01-10', to: null, mode: 'fill' }] });

    const valued = matchesRowSelectors({ selectors: fill, row: { time: at('2026-01-12'), refAmountMissing: false } });
    const waiting = matchesRowSelectors({ selectors: fill, row: { time: at('2026-01-12'), refAmountMissing: true } });

    expect(valued).toBe(false);
    expect(waiting).toBe(true);
  });

  it('treats an open side as unbounded', () => {
    const all = buildRowSelectors({ intervals: [{ from: null, to: null, mode: 'recompute' }] });

    expect(matchesRowSelectors({ selectors: all, row: { time: at('1999-01-01'), refAmountMissing: false } })).toBe(
      true,
    );
    expect(matchesRowSelectors({ selectors: all, row: { time: at('2999-01-01'), refAmountMissing: false } })).toBe(
      true,
    );
  });
});

describe('selectorEnvelope', () => {
  it('spans the earliest start to the latest end and asks for unpriced rows only when all do', () => {
    const selectors = buildRowSelectors({
      intervals: [
        { from: '2026-01-10', to: '2026-01-20', mode: 'fill' },
        { from: '2026-02-01', to: '2026-02-05', mode: 'fill' },
      ],
    });

    expect(selectorEnvelope({ selectors })).toEqual({
      from: new Date('2026-01-10T00:00:00.000Z'),
      to: new Date('2026-02-05T00:00:00.000Z'),
      onlyMissing: true,
    });
  });

  it('stays open on a side that any interval leaves open, and reads valued rows when one recomputes', () => {
    const selectors = buildRowSelectors({
      intervals: [
        { from: '2026-01-10', to: null, mode: 'fill' },
        { from: null, to: '2026-01-05', mode: 'recompute' },
      ],
    });

    expect(selectorEnvelope({ selectors })).toEqual({ from: null, to: null, onlyMissing: false });
  });
});

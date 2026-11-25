import type { HoldingModel } from '@bt/shared/types/investments';

import { getHoldingWeights, groupHoldings, isClosedPosition, isPriceStale, sortHoldings } from './holding-display';

const makeHolding = (overrides: Partial<HoldingModel> & { symbol?: string }): HoldingModel => {
  const { symbol, ...rest } = overrides;
  return {
    portfolioId: 'p1',
    securityId: symbol ?? 'sec',
    quantity: '0',
    costBasis: '0',
    refCostBasis: '0',
    currencyCode: 'USD',
    excluded: false,
    security: symbol ? ({ symbol, name: symbol } as HoldingModel['security']) : undefined,
    ...rest,
  };
};

describe('isClosedPosition', () => {
  it('treats zero quantity with a realized gain as closed (fully sold out)', () => {
    expect(isClosedPosition(makeHolding({ quantity: '0', costBasis: '0', realizedGainValue: '500' }))).toBe(true);
    expect(isClosedPosition(makeHolding({ quantity: '0', costBasis: '0', realizedGainValue: '-120' }))).toBe(true);
  });

  it('treats zero quantity with a remaining cost basis as closed', () => {
    expect(isClosedPosition(makeHolding({ quantity: '0', costBasis: '100', realizedGainValue: '0' }))).toBe(true);
  });

  it('does NOT treat zero quantity with no activity as closed (freshly-added security)', () => {
    // Newly added via search → no transactions yet → must stay in the active list
    // so the user can add their first buy without scrolling into "Closed positions".
    expect(isClosedPosition(makeHolding({ quantity: '0', costBasis: '0', realizedGainValue: '0' }))).toBe(false);
    expect(isClosedPosition(makeHolding({ quantity: '0', costBasis: '0' }))).toBe(false);
  });

  it('treats any non-zero quantity as active', () => {
    expect(isClosedPosition(makeHolding({ quantity: '10' }))).toBe(false);
    expect(isClosedPosition(makeHolding({ quantity: '0.5' }))).toBe(false);
    // Crypto drift residue is still a real (if small) position, not closed.
    expect(isClosedPosition(makeHolding({ quantity: '-0.000492' }))).toBe(false);
  });
});

describe('isPriceStale', () => {
  const now = new Date('2026-09-21T12:00:00Z');
  const stale = (overrides: Partial<HoldingModel>) => isPriceStale({ holding: makeHolding(overrides), now });

  it('flags an open position priced more than 5 calendar days ago', () => {
    expect(stale({ quantity: '10', priceDate: new Date('2026-09-14T00:00:00Z') })).toBe(true);
  });

  it('tolerates a long weekend plus the EOD lag', () => {
    expect(stale({ quantity: '10', priceDate: new Date('2026-09-17T00:00:00Z') })).toBe(false);
  });

  it('accepts the ISO string the API actually sends', () => {
    expect(stale({ quantity: '10', priceDate: '2026-09-01T00:00:00.000Z' as unknown as Date })).toBe(true);
  });

  it('ignores holdings with no price or no open quantity', () => {
    expect(stale({ quantity: '10' })).toBe(false);
    expect(stale({ quantity: '0', priceDate: new Date('2026-01-01T00:00:00Z') })).toBe(false);
  });
});

describe('sortHoldings', () => {
  it('sorts by symbol ascending and descending', () => {
    const holdings = [
      makeHolding({ symbol: 'SONY', quantity: '1' }),
      makeHolding({ symbol: 'BAC', quantity: '1' }),
      makeHolding({ symbol: 'FIG', quantity: '1' }),
    ];

    expect(sortHoldings({ holdings, sortKey: 'symbol', sortDir: 'asc' }).map((h) => h.security?.symbol)).toEqual([
      'BAC',
      'FIG',
      'SONY',
    ]);
    expect(sortHoldings({ holdings, sortKey: 'symbol', sortDir: 'desc' }).map((h) => h.security?.symbol)).toEqual([
      'SONY',
      'FIG',
      'BAC',
    ]);
  });

  it('sorts numerically by market value', () => {
    const holdings = [
      makeHolding({ symbol: 'A', quantity: '1', marketValue: '100' }),
      makeHolding({ symbol: 'B', quantity: '1', marketValue: '2000' }),
      makeHolding({ symbol: 'C', quantity: '1', marketValue: '50' }),
    ];

    expect(sortHoldings({ holdings, sortKey: 'value', sortDir: 'asc' }).map((h) => h.security?.symbol)).toEqual([
      'C',
      'A',
      'B',
    ]);
  });

  it('sorts by the base-currency value across currencies', () => {
    const holdings = [
      makeHolding({ symbol: 'JPY', currencyCode: 'JPY', marketValue: '100000', refMarketValue: '700' }),
      makeHolding({ symbol: 'USD', marketValue: '1000', refMarketValue: '1000' }),
    ];

    expect(sortHoldings({ holdings, sortKey: 'value', sortDir: 'asc' }).map((h) => h.security?.symbol)).toEqual([
      'JPY',
      'USD',
    ]);
  });

  it('prefers the display-currency value when present', () => {
    const holdings = [
      makeHolding({ symbol: 'A', marketValue: '100', refMarketValue: '100', displayMarketValue: '900' }),
      makeHolding({ symbol: 'B', marketValue: '500', refMarketValue: '500', displayMarketValue: '450' }),
    ];

    expect(sortHoldings({ holdings, sortKey: 'value', sortDir: 'asc' }).map((h) => h.security?.symbol)).toEqual([
      'B',
      'A',
    ]);
  });

  it('does not mutate the input array', () => {
    const holdings = [makeHolding({ symbol: 'B', quantity: '1' }), makeHolding({ symbol: 'A', quantity: '1' })];
    sortHoldings({ holdings, sortKey: 'symbol', sortDir: 'asc' });
    expect(holdings.map((h) => h.security?.symbol)).toEqual(['B', 'A']);
  });
});

describe('groupHoldings', () => {
  it('separates active from closed positions, each sorted independently', () => {
    const holdings = [
      makeHolding({ symbol: 'SONY', quantity: '20', marketValue: '434' }),
      // BAC and VST have realized gains – fully sold out, so they're truly closed.
      makeHolding({ symbol: 'BAC', quantity: '0', marketValue: '0', realizedGainValue: '120' }),
      makeHolding({ symbol: 'FIG', quantity: '14', marketValue: '328' }),
      makeHolding({ symbol: 'VST', quantity: '0', marketValue: '0', realizedGainValue: '-50' }),
    ];

    const { active, closed } = groupHoldings({ holdings, sortKey: 'symbol', sortDir: 'asc' });

    expect(active.map((h) => h.security?.symbol)).toEqual(['FIG', 'SONY']);
    expect(closed.map((h) => h.security?.symbol)).toEqual(['BAC', 'VST']);
  });

  it('keeps freshly-added (zero-everything) holdings in active, not closed', () => {
    const holdings = [
      makeHolding({ symbol: 'SONY', quantity: '20', marketValue: '434' }),
      // Freshly added security – no transactions yet, must stay in active.
      makeHolding({ symbol: 'NEW', quantity: '0', costBasis: '0', realizedGainValue: '0' }),
      makeHolding({ symbol: 'OLD', quantity: '0', costBasis: '0', realizedGainValue: '300' }),
    ];

    const { active, closed } = groupHoldings({ holdings, sortKey: 'symbol', sortDir: 'asc' });

    expect(active.map((h) => h.security?.symbol)).toEqual(['NEW', 'SONY']);
    expect(closed.map((h) => h.security?.symbol)).toEqual(['OLD']);
  });

  it('returns empty closed group when no positions are closed', () => {
    const holdings = [makeHolding({ symbol: 'A', quantity: '1' }), makeHolding({ symbol: 'B', quantity: '2' })];
    const { active, closed } = groupHoldings({ holdings, sortKey: 'symbol', sortDir: 'asc' });
    expect(active).toHaveLength(2);
    expect(closed).toHaveLength(0);
  });

  it('pins just-added holdings into the justAdded bucket, ahead of active/closed', () => {
    const holdings = [
      makeHolding({ symbol: 'SONY', quantity: '20', marketValue: '434', securityId: 'sec-sony' }),
      makeHolding({ symbol: 'NEW', quantity: '0', costBasis: '0', realizedGainValue: '0', securityId: 'sec-new' }),
      makeHolding({ symbol: 'OLD', quantity: '0', costBasis: '0', realizedGainValue: '120', securityId: 'sec-old' }),
    ];
    const justAddedIds = new Set(['sec-new']);

    const { justAdded, active, closed } = groupHoldings({
      holdings,
      sortKey: 'symbol',
      sortDir: 'asc',
      justAddedIds,
    });

    expect(justAdded.map((h) => h.security?.symbol)).toEqual(['NEW']);
    expect(active.map((h) => h.security?.symbol)).toEqual(['SONY']);
    expect(closed.map((h) => h.security?.symbol)).toEqual(['OLD']);
  });

  it('keeps an already-funded holding in the justAdded bucket if its id was tracked', () => {
    // Once the session marks a holding as "just added", it stays pinned until
    // a hard refresh – even after the first buy transaction lands.
    const holdings = [
      makeHolding({ symbol: 'NEW', quantity: '5', marketValue: '500', securityId: 'sec-new' }),
      makeHolding({ symbol: 'SONY', quantity: '20', marketValue: '434', securityId: 'sec-sony' }),
    ];
    const justAddedIds = new Set(['sec-new']);

    const { justAdded, active } = groupHoldings({
      holdings,
      sortKey: 'symbol',
      sortDir: 'asc',
      justAddedIds,
    });

    expect(justAdded.map((h) => h.security?.symbol)).toEqual(['NEW']);
    expect(active.map((h) => h.security?.symbol)).toEqual(['SONY']);
  });
});

describe('getHoldingWeights', () => {
  it('weighs holdings by their base-currency market value', () => {
    const weights = getHoldingWeights({
      holdings: [
        makeHolding({ symbol: 'A', refMarketValue: '300' }),
        makeHolding({ symbol: 'B', refMarketValue: '100' }),
        makeHolding({ symbol: 'C' }),
      ],
    });

    expect(weights.get('A')).toBe(0.75);
    expect(weights.get('B')).toBe(0.25);
    expect(weights.get('C')).toBeNull();
  });

  it('leaves a priced holding whose base value failed to convert out of the total', () => {
    const weights = getHoldingWeights({
      holdings: [
        makeHolding({ symbol: 'A', marketValue: '300', refMarketValue: '300' }),
        makeHolding({ symbol: 'B', marketValue: '100', refMarketValue: '100' }),
        makeHolding({ symbol: 'C', marketValue: '500', refMarketValue: '0' }),
      ],
    });

    expect(weights.get('A')).toBe(0.75);
    expect(weights.get('B')).toBe(0.25);
    expect(weights.get('C')).toBeNull();
  });

  it('returns zero weights when every value is zero', () => {
    expect(getHoldingWeights({ holdings: [makeHolding({ symbol: 'A', refMarketValue: '0' })] }).get('A')).toBe(0);
  });
});

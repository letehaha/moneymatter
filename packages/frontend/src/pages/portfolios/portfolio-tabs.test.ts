import { PORTFOLIO_TABS, orderPortfolioTabs, parsePortfolioTab } from './portfolio-tabs';

describe('orderPortfolioTabs', () => {
  it('keeps the default order when nothing is locked', () => {
    expect(orderPortfolioTabs({ isLocked: () => false })).toEqual(['holdings', 'analytics', 'activity', 'watchlist']);
  });

  it('moves locked tabs to the end', () => {
    const locked = new Set<string>([PORTFOLIO_TABS.analytics, PORTFOLIO_TABS.watchlist]);
    expect(orderPortfolioTabs({ isLocked: (tab) => locked.has(tab) })).toEqual([
      'holdings',
      'activity',
      'analytics',
      'watchlist',
    ]);
  });
});

describe('parsePortfolioTab', () => {
  it('parses known tabs', () => {
    expect(parsePortfolioTab({ value: 'activity' })).toBe('activity');
    expect(parsePortfolioTab({ value: 'watchlist' })).toBe('watchlist');
  });

  it('maps the legacy cash tab to activity', () => {
    expect(parsePortfolioTab({ value: 'cash' })).toBe('activity');
  });

  it('falls back to holdings for unknown values', () => {
    expect(parsePortfolioTab({ value: 'nope' })).toBe('holdings');
    expect(parsePortfolioTab({ value: 'constructor' })).toBe('holdings');
    expect(parsePortfolioTab({ value: undefined })).toBe('holdings');
  });
});

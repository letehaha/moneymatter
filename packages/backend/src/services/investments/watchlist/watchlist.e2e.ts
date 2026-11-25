import {
  API_ERROR_CODES,
  ASSET_CLASS,
  FEATURES,
  PLANS,
  SECURITY_PROVIDER,
  WATCHLIST_ALERT_FREQUENCIES,
  WATCHLIST_ALERT_TYPES,
  WATCHLIST_LIMITS,
} from '@bt/shared/types';
import { describe, expect, it } from '@jest/globals';
import { ERROR_CODES } from '@js/errors';
import Securities from '@models/investments/securities.model';
import SecurityPricing from '@models/investments/security-pricing.model';
import WatchlistAlerts from '@models/investments/watchlist-alerts.model';
import WatchlistItems from '@models/investments/watchlist-items.model';
import WatchlistSections from '@models/investments/watchlist-sections.model';
import * as helpers from '@tests/helpers';
import type { ErrorResponse } from '@tests/helpers/common';

const createPortfolio = ({ name = 'Watch' }: { name?: string } = {}) =>
  helpers.createPortfolio({ payload: helpers.buildPortfolioPayload({ name }), raw: true });

/** Adding an item starts a background price backfill; drain it before pinning prices. */
const watch = async ({
  portfolioId,
  symbol,
  sectionId,
}: {
  portfolioId: string;
  symbol: string;
  sectionId?: string;
}) => {
  const security = await helpers.createTestSecurity({ symbol });
  const item = await helpers.createWatchlistItem({
    portfolioId,
    payload: { securityId: security.id, sectionId },
    raw: true,
  });
  await helpers.sleep(200);
  return { security, item };
};

const searchEtest = async () => {
  const results = await helpers.searchSecurities({ payload: { query: 'etest' }, raw: true });
  return results.find((result) => result.symbol === 'ETEST')!;
};

const itemIdsOf = ({ items }: { items: { id: string }[] }) => items.map((item) => item.id);

describe('Portfolio watchlist', () => {
  describe('access', () => {
    it('returns 402 planRequired for an Essential plan', async () => {
      const portfolio = await createPortfolio();
      await helpers.setUserBilling({ plan: PLANS.essential });

      const response = await helpers.getWatchlist({ portfolioId: portfolio.id });

      expect(response.statusCode).toBe(ERROR_CODES.PaymentRequired);
      expect((response.body.response as unknown as ErrorResponse).code).toBe(API_ERROR_CODES.planRequired);
    });

    it('gates every write endpoint for an Essential plan', async () => {
      const portfolio = await createPortfolio();
      await helpers.setUserBilling({ plan: PLANS.essential });
      const id = '01900000-0000-7000-8000-000000000000';
      const ids = { portfolioId: portfolio.id, sectionId: id, itemId: id, alertId: id };

      const responses = await Promise.all([
        helpers.createWatchlistSection({ portfolioId: portfolio.id, name: 'S' }),
        helpers.updateWatchlistSection({ ...ids, name: 'S' }),
        helpers.deleteWatchlistSection(ids),
        helpers.setWatchlistLayout({ portfolioId: portfolio.id, payload: { sections: [], ungroupedItemIds: [] } }),
        helpers.createWatchlistItem({ portfolioId: portfolio.id, payload: { securityId: id } }),
        helpers.updateWatchlistItem({ ...ids, payload: { note: 'x' } }),
        helpers.deleteWatchlistItem(ids),
        helpers.createWatchlistAlert({ ...ids, payload: { type: WATCHLIST_ALERT_TYPES.closeAbove, price: '1' } }),
        helpers.updateWatchlistAlert({ ...ids, payload: { isActive: false } }),
        helpers.deleteWatchlistAlert(ids),
      ]);

      expect(responses.map((response) => response.statusCode)).toEqual(
        responses.map(() => ERROR_CODES.PaymentRequired),
      );
    });

    it('returns 200 for an Essential user once the watchlist trial is started', async () => {
      const portfolio = await createPortfolio();
      await helpers.setUserBilling({ plan: PLANS.essential });

      expect((await helpers.startFeatureTrial({ feature: FEATURES.watchlist })).statusCode).toBe(200);

      expect((await helpers.getWatchlist({ portfolioId: portfolio.id })).statusCode).toBe(200);
    });

    it("returns 404 for another user's portfolio", async () => {
      const portfolio = await createPortfolio();
      const { cookies } = await helpers.signUpSecondUser();

      const [list, section] = await helpers.asUser({
        cookies,
        fn: () =>
          Promise.all([
            helpers.getWatchlist({ portfolioId: portfolio.id }),
            helpers.createWatchlistSection({ portfolioId: portfolio.id, name: 'Mine' }),
          ]),
      });

      expect(list.statusCode).toBe(ERROR_CODES.NotFoundError);
      expect(section.statusCode).toBe(ERROR_CODES.NotFoundError);
    });

    it("returns 404 for another of the user's portfolios' sections, items and alerts", async () => {
      const [owner, other] = await Promise.all([
        createPortfolio({ name: 'Owner' }),
        createPortfolio({ name: 'Other' }),
      ]);
      const section = await helpers.createWatchlistSection({ portfolioId: owner.id, name: 'Owned', raw: true });
      const { item } = await watch({ portfolioId: owner.id, symbol: 'ISO' });
      const alert = await helpers.createWatchlistAlert({
        portfolioId: owner.id,
        itemId: item.id,
        payload: { type: WATCHLIST_ALERT_TYPES.closeAbove, price: '10' },
        raw: true,
      });
      const ids = { portfolioId: other.id, itemId: item.id };

      const responses = await Promise.all([
        helpers.updateWatchlistSection({ portfolioId: other.id, sectionId: section.id, name: 'Moved' }),
        helpers.deleteWatchlistSection({ portfolioId: other.id, sectionId: section.id }),
        helpers.updateWatchlistItem({ ...ids, payload: { note: 'x' } }),
        helpers.deleteWatchlistItem(ids),
        helpers.updateWatchlistAlert({ ...ids, alertId: alert.id, payload: { isActive: false } }),
        helpers.deleteWatchlistAlert({ ...ids, alertId: alert.id }),
      ]);
      const layout = await helpers.setWatchlistLayout({
        portfolioId: other.id,
        payload: { sections: [{ id: section.id, itemIds: [] }], ungroupedItemIds: [] },
      });

      expect(responses.map((response) => response.statusCode)).toEqual(
        Array.from({ length: responses.length }, () => ERROR_CODES.NotFoundError),
      );
      expect(layout.statusCode).toBe(ERROR_CODES.ValidationError);
      const watchlist = await helpers.getWatchlist({ portfolioId: owner.id, raw: true });
      expect(watchlist.sections).toMatchObject([{ id: section.id, name: 'Owned', items: [] }]);
      expect(watchlist.ungroupedItems).toMatchObject([
        { id: item.id, note: null, alerts: [{ id: alert.id, isActive: true }] },
      ]);
    });

    it('returns 404 once the portfolio is in the trash', async () => {
      const portfolio = await createPortfolio();
      await helpers.deletePortfolio({ portfolioId: portfolio.id });

      expect((await helpers.getWatchlist({ portfolioId: portfolio.id })).statusCode).toBe(ERROR_CODES.NotFoundError);
    });
  });

  it('returns an empty watchlist', async () => {
    const portfolio = await createPortfolio();

    expect(await helpers.getWatchlist({ portfolioId: portfolio.id, raw: true })).toEqual({
      ungroupedItems: [],
      sections: [],
    });
  });

  describe('items', () => {
    it('adds a security with a note and target price and lists it with its prices', async () => {
      const portfolio = await createPortfolio();
      const security = await helpers.createTestSecurity({ symbol: 'GOOGL' });

      const item = await helpers.createWatchlistItem({
        portfolioId: portfolio.id,
        payload: { securityId: security.id, note: 'Wait for a dip', targetPrice: '160.5' },
        raw: true,
      });
      await helpers.sleep(200);
      await helpers.setDailyPrices({
        securityId: security.id,
        prices: [
          { days: 400, price: '50' },
          { days: 200, price: '140.25' },
          { days: 30, price: '207.05' },
          { days: 2, price: '170' },
          { days: 1, price: '171.2' },
          { days: 0, price: '999' },
        ],
      });

      expect(item).toMatchObject({
        sectionId: null,
        note: 'Wait for a dip',
        targetPrice: '160.5000000000',
        security: { id: security.id, symbol: 'GOOGL', name: 'GOOGL Inc.', currencyCode: 'USD' },
        isHeld: false,
        alerts: [],
      });

      const watchlist = await helpers.getWatchlist({ portfolioId: portfolio.id, raw: true });
      expect(watchlist.ungroupedItems).toHaveLength(1);
      expect(watchlist.ungroupedItems[0]).toMatchObject({
        id: item.id,
        lastClose: '171.2000000000',
        lastCloseDate: helpers.utcDaysAgo({ days: 1 }).toISOString().slice(0, 10),
        previousClose: '170.0000000000',
        changePercent: expect.closeTo((171.2 / 170 - 1) * 100, 8),
        low52w: '140.2500000000',
        high52w: '207.0500000000',
      });
    });

    it('reports no 52-week range under a year of history and no prices without any', async () => {
      const portfolio = await createPortfolio();
      const { security: young } = await watch({ portfolioId: portfolio.id, symbol: 'YOUNG' });
      const { security: bare } = await watch({ portfolioId: portfolio.id, symbol: 'BARE' });
      await helpers.setDailyPrices({ securityId: young.id, prices: [{ days: 5, price: '10' }] });
      await SecurityPricing.destroy({ where: { securityId: bare.id } });

      const { ungroupedItems } = await helpers.getWatchlist({ portfolioId: portfolio.id, raw: true });

      expect(ungroupedItems.find((item) => item.security.id === young.id)).toMatchObject({
        lastClose: '10.0000000000',
        previousClose: null,
        changePercent: null,
        low52w: null,
        high52w: null,
      });
      expect(ungroupedItems.find((item) => item.security.id === bare.id)).toMatchObject({
        lastClose: null,
        lastCloseDate: null,
        previousClose: null,
      });
    });

    it('marks a security the portfolio holds', async () => {
      const portfolio = await createPortfolio();
      const { security } = await watch({ portfolioId: portfolio.id, symbol: 'HELD' });
      await helpers.createHolding({ payload: { portfolioId: portfolio.id, securityId: security.id } });
      await helpers.updatePortfolioBalance({
        portfolioId: portfolio.id,
        currencyCode: 'USD',
        setAvailableCash: '1000',
        setTotalCash: '1000',
      });
      await helpers.createInvestmentTransaction({
        payload: {
          portfolioId: portfolio.id,
          securityId: security.id,
          date: '2024-03-15',
          quantity: '2',
          price: '100',
          fees: '0',
        },
      });

      const { ungroupedItems } = await helpers.getWatchlist({ portfolioId: portfolio.id, raw: true });

      expect(ungroupedItems[0]!.isHeld).toBe(true);
    });

    it('rejects a security already on the watchlist, an unknown security and a bad target price', async () => {
      const portfolio = await createPortfolio();
      const { security } = await watch({ portfolioId: portfolio.id, symbol: 'DUP' });

      const duplicate = await helpers.createWatchlistItem({
        portfolioId: portfolio.id,
        payload: { securityId: security.id },
      });
      const unknown = await helpers.createWatchlistItem({
        portfolioId: portfolio.id,
        payload: { securityId: '01900000-0000-7000-8000-000000000000' },
      });
      const badPrice = await helpers.createWatchlistItem({
        portfolioId: portfolio.id,
        payload: { securityId: security.id, targetPrice: '-5' },
      });

      expect(duplicate.statusCode).toBe(ERROR_CODES.ConflictError);
      expect(unknown.statusCode).toBe(ERROR_CODES.NotFoundError);
      expect(badPrice.statusCode).toBe(ERROR_CODES.ValidationError);
    });

    describe('by search result', () => {
      it('creates the security and lists the item', async () => {
        const portfolio = await createPortfolio();
        const searchResult = await searchEtest();

        const response = await helpers.createWatchlistItem({
          portfolioId: portfolio.id,
          payload: { searchResult, note: 'From search' },
        });
        await helpers.sleep(200);

        expect(response.statusCode).toBe(201);
        const stored = await Securities.findOne({ where: { providerSymbol: 'ETEST' } });
        expect(stored).not.toBeNull();
        expect(helpers.extractResponse(response)).toMatchObject({
          note: 'From search',
          security: { id: stored!.id, symbol: 'ETEST', name: 'E2E Test Corp' },
          isHeld: false,
        });

        const { ungroupedItems } = await helpers.getWatchlist({ portfolioId: portfolio.id, raw: true });
        expect(ungroupedItems.map((item) => item.security.id)).toEqual([stored!.id]);
      });

      it('returns 409 when the same search result is added twice', async () => {
        const portfolio = await createPortfolio();
        const searchResult = await searchEtest();

        const first = await helpers.createWatchlistItem({ portfolioId: portfolio.id, payload: { searchResult } });
        await helpers.sleep(200);
        const second = await helpers.createWatchlistItem({ portfolioId: portfolio.id, payload: { searchResult } });

        expect(first.statusCode).toBe(201);
        expect(second.statusCode).toBe(ERROR_CODES.ConflictError);
      });

      it("returns 404 for another user's portfolio without storing the security", async () => {
        const portfolio = await createPortfolio();
        const searchResult = await searchEtest();
        const { cookies } = await helpers.signUpSecondUser();

        const response = await helpers.asUser({
          cookies,
          fn: () => helpers.createWatchlistItem({ portfolioId: portfolio.id, payload: { searchResult } }),
        });
        await helpers.sleep(200);

        expect(response.statusCode).toBe(ERROR_CODES.NotFoundError);
        expect(await Securities.findOne({ where: { providerSymbol: 'ETEST' } })).toBeNull();
      });

      it('rejects a body with neither or both of securityId and searchResult', async () => {
        const portfolio = await createPortfolio();
        const security = await helpers.createTestSecurity({ symbol: 'BOTH' });
        const searchResult = await searchEtest();
        const url = `/investments/portfolios/${portfolio.id}/watchlist/items`;

        const [neither, both] = await Promise.all([
          helpers.makeRequest({ method: 'post', url, payload: { note: 'x' } }),
          helpers.makeRequest({ method: 'post', url, payload: { securityId: security.id, searchResult } }),
        ]);

        expect(neither.statusCode).toBe(ERROR_CODES.ValidationError);
        expect(both.statusCode).toBe(ERROR_CODES.ValidationError);
      });
    });

    it('lets the same security be watched in two portfolios', async () => {
      const [first, second] = await Promise.all([createPortfolio({ name: 'A' }), createPortfolio({ name: 'B' })]);
      const { security } = await watch({ portfolioId: first.id, symbol: 'TWICE' });

      const response = await helpers.createWatchlistItem({
        portfolioId: second.id,
        payload: { securityId: security.id },
      });

      expect(response.statusCode).toBe(201);
    });

    it('rejects a section of another portfolio', async () => {
      const [first, second] = await Promise.all([createPortfolio({ name: 'A' }), createPortfolio({ name: 'B' })]);
      const section = await helpers.createWatchlistSection({ portfolioId: second.id, name: 'Other', raw: true });
      const security = await helpers.createTestSecurity({ symbol: 'XSEC' });

      const response = await helpers.createWatchlistItem({
        portfolioId: first.id,
        payload: { securityId: security.id, sectionId: section.id },
      });

      expect(response.statusCode).toBe(ERROR_CODES.NotFoundError);
    });

    it('updates the note and target price, clears them, and moves the item to the end of a section', async () => {
      const portfolio = await createPortfolio();
      const section = await helpers.createWatchlistSection({ portfolioId: portfolio.id, name: 'Ideas', raw: true });
      const { item: first } = await watch({ portfolioId: portfolio.id, symbol: 'FIRST', sectionId: section.id });
      const { item } = await watch({ portfolioId: portfolio.id, symbol: 'MOVE' });

      const updated = await helpers.updateWatchlistItem({
        portfolioId: portfolio.id,
        itemId: item.id,
        payload: { note: 'Top up', targetPrice: '12.5', sectionId: section.id },
        raw: true,
      });
      expect(updated).toMatchObject({ note: 'Top up', targetPrice: '12.5000000000', sectionId: section.id });

      const cleared = await helpers.updateWatchlistItem({
        portfolioId: portfolio.id,
        itemId: item.id,
        payload: { note: null, targetPrice: null },
        raw: true,
      });
      expect(cleared).toMatchObject({ note: null, targetPrice: null, sectionId: section.id });

      const watchlist = await helpers.getWatchlist({ portfolioId: portfolio.id, raw: true });
      expect(watchlist.ungroupedItems).toEqual([]);
      expect(itemIdsOf({ items: watchlist.sections[0]!.items })).toEqual([first.id, item.id]);
    });

    it('deletes an item with its alerts, then 404s on it', async () => {
      const portfolio = await createPortfolio();
      const { item } = await watch({ portfolioId: portfolio.id, symbol: 'GONE' });
      await helpers.createWatchlistAlert({
        portfolioId: portfolio.id,
        itemId: item.id,
        payload: { type: WATCHLIST_ALERT_TYPES.closeBelow, price: '10' },
        raw: true,
      });

      expect((await helpers.deleteWatchlistItem({ portfolioId: portfolio.id, itemId: item.id })).statusCode).toBe(200);
      expect(await WatchlistAlerts.count({ where: { itemId: item.id } })).toBe(0);
      expect((await helpers.deleteWatchlistItem({ portfolioId: portfolio.id, itemId: item.id })).statusCode).toBe(
        ERROR_CODES.NotFoundError,
      );
      expect(
        (await helpers.updateWatchlistItem({ portfolioId: portfolio.id, itemId: item.id, payload: { note: 'x' } }))
          .statusCode,
      ).toBe(ERROR_CODES.NotFoundError);
    });
  });

  describe('sections and layout', () => {
    it('creates, renames and lists sections in order', async () => {
      const portfolio = await createPortfolio();
      const buy = await helpers.createWatchlistSection({ portfolioId: portfolio.id, name: 'Buy', raw: true });
      await helpers.createWatchlistSection({ portfolioId: portfolio.id, name: 'Dividends', raw: true });

      const renamed = await helpers.updateWatchlistSection({
        portfolioId: portfolio.id,
        sectionId: buy.id,
        name: 'Buy candidates',
        raw: true,
      });
      expect(renamed).toEqual({ id: buy.id, name: 'Buy candidates' });

      const { sections } = await helpers.getWatchlist({ portfolioId: portfolio.id, raw: true });
      expect(sections.map((section) => section.name)).toEqual(['Buy candidates', 'Dividends']);
    });

    it('rejects a blank name and an unknown section', async () => {
      const portfolio = await createPortfolio();

      const blank = await helpers.createWatchlistSection({ portfolioId: portfolio.id, name: '  ' });
      const unknown = await helpers.updateWatchlistSection({
        portfolioId: portfolio.id,
        sectionId: '01900000-0000-7000-8000-000000000000',
        name: 'Nope',
      });

      expect(blank.statusCode).toBe(ERROR_CODES.ValidationError);
      expect(unknown.statusCode).toBe(ERROR_CODES.NotFoundError);
    });

    it('moves the items of a deleted section to the end of the ungrouped list', async () => {
      const portfolio = await createPortfolio();
      const section = await helpers.createWatchlistSection({ portfolioId: portfolio.id, name: 'Temp', raw: true });
      const { item: loose } = await watch({ portfolioId: portfolio.id, symbol: 'LOOSE' });
      const { item: a } = await watch({ portfolioId: portfolio.id, symbol: 'SA', sectionId: section.id });
      const { item: b } = await watch({ portfolioId: portfolio.id, symbol: 'SB', sectionId: section.id });

      expect(
        (await helpers.deleteWatchlistSection({ portfolioId: portfolio.id, sectionId: section.id })).statusCode,
      ).toBe(200);

      const watchlist = await helpers.getWatchlist({ portfolioId: portfolio.id, raw: true });
      expect(watchlist.sections).toEqual([]);
      expect(itemIdsOf({ items: watchlist.ungroupedItems })).toEqual([loose.id, a.id, b.id]);
    });

    it('saves a layout: section order, item order and moves between sections', async () => {
      const portfolio = await createPortfolio();
      const first = await helpers.createWatchlistSection({ portfolioId: portfolio.id, name: 'First', raw: true });
      const second = await helpers.createWatchlistSection({ portfolioId: portfolio.id, name: 'Second', raw: true });
      const { item: a } = await watch({ portfolioId: portfolio.id, symbol: 'LA', sectionId: first.id });
      const { item: b } = await watch({ portfolioId: portfolio.id, symbol: 'LB', sectionId: first.id });
      const { item: c } = await watch({ portfolioId: portfolio.id, symbol: 'LC' });

      const response = await helpers.setWatchlistLayout({
        portfolioId: portfolio.id,
        payload: {
          sections: [
            { id: second.id, itemIds: [c.id, a.id] },
            { id: first.id, itemIds: [] },
          ],
          ungroupedItemIds: [b.id],
        },
      });
      expect(response.statusCode).toBe(200);

      const watchlist = await helpers.getWatchlist({ portfolioId: portfolio.id, raw: true });
      expect(itemIdsOf({ items: watchlist.ungroupedItems })).toEqual([b.id]);
      expect(watchlist.sections.map((section) => [section.name, itemIdsOf({ items: section.items })])).toEqual([
        ['Second', [c.id, a.id]],
        ['First', []],
      ]);
    });

    it('rejects a layout that leaves out a section or repeats an item', async () => {
      const portfolio = await createPortfolio();
      const first = await helpers.createWatchlistSection({ portfolioId: portfolio.id, name: 'First', raw: true });
      await helpers.createWatchlistSection({ portfolioId: portfolio.id, name: 'Second', raw: true });
      const { item } = await watch({ portfolioId: portfolio.id, symbol: 'REP' });

      const missingSection = await helpers.setWatchlistLayout({
        portfolioId: portfolio.id,
        payload: { sections: [{ id: first.id, itemIds: [] }], ungroupedItemIds: [] },
      });
      const repeatedItem = await helpers.setWatchlistLayout({
        portfolioId: portfolio.id,
        payload: { sections: [{ id: first.id, itemIds: [item.id] }], ungroupedItemIds: [item.id] },
      });

      expect(missingSection.statusCode).toBe(ERROR_CODES.ValidationError);
      expect(repeatedItem.statusCode).toBe(ERROR_CODES.ValidationError);
    });
  });

  describe('alerts', () => {
    it('creates price and daily move alerts and lists them on the item', async () => {
      const portfolio = await createPortfolio();
      const { item } = await watch({ portfolioId: portfolio.id, symbol: 'ALRT' });

      const below = await helpers.createWatchlistAlert({
        portfolioId: portfolio.id,
        itemId: item.id,
        payload: { type: WATCHLIST_ALERT_TYPES.closeBelow, price: '160', notifyEmail: true },
        raw: true,
      });
      const move = await helpers.createWatchlistAlert({
        portfolioId: portfolio.id,
        itemId: item.id,
        payload: { type: WATCHLIST_ALERT_TYPES.dailyMove, percent: 5, frequency: 'every_time' },
        raw: true,
      });

      expect(below).toEqual({
        id: expect.any(String),
        type: 'close_below',
        price: '160.0000000000',
        percent: null,
        frequency: 'once',
        notifyInApp: true,
        notifyEmail: true,
        isActive: true,
        lastTriggeredAt: null,
      });
      expect(move).toMatchObject({ type: 'daily_move', price: null, percent: 5, frequency: 'every_time' });

      const { ungroupedItems } = await helpers.getWatchlist({ portfolioId: portfolio.id, raw: true });
      expect(ungroupedItems[0]!.alerts.map((alert) => alert.id)).toEqual([below.id, move.id]);
    });

    it('rejects an alert without its threshold, without a channel, or on an unknown item', async () => {
      const portfolio = await createPortfolio();
      const { item } = await watch({ portfolioId: portfolio.id, symbol: 'BADA' });

      const noPrice = await helpers.createWatchlistAlert({
        portfolioId: portfolio.id,
        itemId: item.id,
        payload: { type: WATCHLIST_ALERT_TYPES.closeAbove, percent: 5 },
      });
      const noChannel = await helpers.createWatchlistAlert({
        portfolioId: portfolio.id,
        itemId: item.id,
        payload: { type: WATCHLIST_ALERT_TYPES.closeAbove, price: '10', notifyInApp: false },
      });
      const unknownItem = await helpers.createWatchlistAlert({
        portfolioId: portfolio.id,
        itemId: '01900000-0000-7000-8000-000000000000',
        payload: { type: WATCHLIST_ALERT_TYPES.closeAbove, price: '10' },
      });

      expect(noPrice.statusCode).toBe(ERROR_CODES.ValidationError);
      expect(noChannel.statusCode).toBe(ERROR_CODES.ValidationError);
      expect(unknownItem.statusCode).toBe(ERROR_CODES.NotFoundError);
    });

    it("rejects an update with the other alert type's threshold", async () => {
      const portfolio = await createPortfolio();
      const { item } = await watch({ portfolioId: portfolio.id, symbol: 'MISM' });
      const [priceAlert, moveAlert] = await Promise.all([
        helpers.createWatchlistAlert({
          portfolioId: portfolio.id,
          itemId: item.id,
          payload: { type: WATCHLIST_ALERT_TYPES.closeAbove, price: '10' },
          raw: true,
        }),
        helpers.createWatchlistAlert({
          portfolioId: portfolio.id,
          itemId: item.id,
          payload: { type: WATCHLIST_ALERT_TYPES.dailyMove, percent: 5 },
          raw: true,
        }),
      ]);

      const [percentOnPrice, priceOnMove] = await Promise.all([
        helpers.updateWatchlistAlert({
          portfolioId: portfolio.id,
          itemId: item.id,
          alertId: priceAlert.id,
          payload: { percent: 5 },
        }),
        helpers.updateWatchlistAlert({
          portfolioId: portfolio.id,
          itemId: item.id,
          alertId: moveAlert.id,
          payload: { price: '10' },
        }),
      ]);

      expect(percentOnPrice.statusCode).toBe(ERROR_CODES.ValidationError);
      expect(priceOnMove.statusCode).toBe(ERROR_CODES.ValidationError);
    });

    it('updates and deletes an alert', async () => {
      const portfolio = await createPortfolio();
      const { item } = await watch({ portfolioId: portfolio.id, symbol: 'UPDA' });
      const alert = await helpers.createWatchlistAlert({
        portfolioId: portfolio.id,
        itemId: item.id,
        payload: { type: WATCHLIST_ALERT_TYPES.closeAbove, price: '10' },
        raw: true,
      });

      const updated = await helpers.updateWatchlistAlert({
        portfolioId: portfolio.id,
        itemId: item.id,
        alertId: alert.id,
        payload: { price: '12', frequency: 'every_time', notifyEmail: true, notifyInApp: false, isActive: false },
        raw: true,
      });
      expect(updated).toMatchObject({
        price: '12.0000000000',
        frequency: 'every_time',
        notifyInApp: false,
        notifyEmail: true,
        isActive: false,
      });

      const noChannel = await helpers.updateWatchlistAlert({
        portfolioId: portfolio.id,
        itemId: item.id,
        alertId: alert.id,
        payload: { notifyEmail: false },
      });
      expect(noChannel.statusCode).toBe(ERROR_CODES.ValidationError);

      const params = { portfolioId: portfolio.id, itemId: item.id, alertId: alert.id };
      expect((await helpers.deleteWatchlistAlert(params)).statusCode).toBe(200);
      expect((await helpers.deleteWatchlistAlert(params)).statusCode).toBe(ERROR_CODES.NotFoundError);
    });
  });

  it('purges the watchlist with the portfolio', async () => {
    const portfolio = await createPortfolio();
    const section = await helpers.createWatchlistSection({ portfolioId: portfolio.id, name: 'S', raw: true });
    const { item } = await watch({ portfolioId: portfolio.id, symbol: 'PURGE', sectionId: section.id });
    await helpers.createWatchlistAlert({
      portfolioId: portfolio.id,
      itemId: item.id,
      payload: { type: WATCHLIST_ALERT_TYPES.closeAbove, price: '10' },
      raw: true,
    });

    await helpers.deletePortfolio({ portfolioId: portfolio.id, force: true });

    expect(await WatchlistItems.count({ where: { portfolioId: portfolio.id } })).toBe(0);
    expect(await WatchlistAlerts.count({ where: { itemId: item.id } })).toBe(0);
  });

  describe('validation', () => {
    type Ids = { portfolioId: string; itemId: string; alertId: string };
    const priceAlert = { type: WATCHLIST_ALERT_TYPES.closeAbove, price: '10' };

    it.each<{ name: string; send: (ids: Ids) => Promise<{ statusCode: number }> }>([
      {
        name: 'an alert price of 10 billion',
        send: ({ portfolioId, itemId }) =>
          helpers.createWatchlistAlert({ portfolioId, itemId, payload: { ...priceAlert, price: '10000000000' } }),
      },
      {
        name: 'a daily move of 0%',
        send: ({ portfolioId, itemId }) =>
          helpers.createWatchlistAlert({
            portfolioId,
            itemId,
            payload: { type: WATCHLIST_ALERT_TYPES.dailyMove, percent: 0 },
          }),
      },
      {
        name: 'a daily move of 150%',
        send: ({ portfolioId, itemId }) =>
          helpers.createWatchlistAlert({
            portfolioId,
            itemId,
            payload: { type: WATCHLIST_ALERT_TYPES.dailyMove, percent: 150 },
          }),
      },
      {
        name: 'a note over the max length',
        send: ({ portfolioId, itemId }) =>
          helpers.updateWatchlistItem({
            portfolioId,
            itemId,
            payload: { note: 'x'.repeat(WATCHLIST_LIMITS.noteMaxLength + 1) },
          }),
      },
      {
        name: 'a section name over the max length',
        send: ({ portfolioId }) =>
          helpers.createWatchlistSection({
            portfolioId,
            name: 'x'.repeat(WATCHLIST_LIMITS.sectionNameMaxLength + 1),
          }),
      },
      {
        name: 'an unknown key',
        send: ({ portfolioId, itemId }) =>
          helpers.createWatchlistAlert({ portfolioId, itemId, payload: { ...priceAlert, bogus: true } }),
      },
      {
        name: 'a type change on an alert update',
        send: (ids) => helpers.updateWatchlistAlert({ ...ids, payload: { type: WATCHLIST_ALERT_TYPES.closeBelow } }),
      },
    ])('rejects $name', async ({ send }) => {
      const portfolio = await createPortfolio();
      const { item } = await watch({ portfolioId: portfolio.id, symbol: 'INVAL' });
      const alert = await helpers.createWatchlistAlert({
        portfolioId: portfolio.id,
        itemId: item.id,
        payload: priceAlert,
        raw: true,
      });

      const response = await send({ portfolioId: portfolio.id, itemId: item.id, alertId: alert.id });
      expect(response.statusCode).toBe(ERROR_CODES.ValidationError);
    });
  });

  describe('limits', () => {
    it(`rejects an item past ${WATCHLIST_LIMITS.maxItems} per portfolio`, async () => {
      const portfolio = await createPortfolio();
      const securities = await Securities.bulkCreate(
        Array.from({ length: WATCHLIST_LIMITS.maxItems + 1 }, (_, index) => ({
          symbol: `CAP${index}`,
          providerSymbol: `CAP${index}`,
          currencyCode: 'USD',
          providerName: SECURITY_PROVIDER.fmp,
          assetClass: ASSET_CLASS.stocks,
          name: `Cap ${index}`,
        })),
      );
      await WatchlistItems.bulkCreate(
        securities.slice(0, -1).map((security, index) => ({
          portfolioId: portfolio.id,
          securityId: security.id,
          sortOrder: index,
        })),
      );

      const response = await helpers.createWatchlistItem({
        portfolioId: portfolio.id,
        payload: { securityId: securities.at(-1)!.id },
      });

      expect(response.statusCode).toBe(ERROR_CODES.ValidationError);
    });

    it(`rejects a section past ${WATCHLIST_LIMITS.maxSections} per portfolio`, async () => {
      const portfolio = await createPortfolio();
      await WatchlistSections.bulkCreate(
        Array.from({ length: WATCHLIST_LIMITS.maxSections }, (_, index) => ({
          portfolioId: portfolio.id,
          name: `Section ${index}`,
          sortOrder: index,
        })),
      );

      const response = await helpers.createWatchlistSection({ portfolioId: portfolio.id, name: 'One too many' });

      expect(response.statusCode).toBe(ERROR_CODES.ValidationError);
    });

    it(`rejects an alert past ${WATCHLIST_LIMITS.maxAlertsPerItem} per item`, async () => {
      const portfolio = await createPortfolio();
      const { item } = await watch({ portfolioId: portfolio.id, symbol: 'ALRTCAP' });
      await WatchlistAlerts.bulkCreate(
        Array.from({ length: WATCHLIST_LIMITS.maxAlertsPerItem }, (_, index) => ({
          itemId: item.id,
          type: WATCHLIST_ALERT_TYPES.closeAbove,
          price: String(index + 1),
          frequency: WATCHLIST_ALERT_FREQUENCIES.once,
        })),
      );

      const response = await helpers.createWatchlistAlert({
        portfolioId: portfolio.id,
        itemId: item.id,
        payload: { type: WATCHLIST_ALERT_TYPES.closeAbove, price: '100' },
      });

      expect(response.statusCode).toBe(ERROR_CODES.ValidationError);
    });
  });
});

import {
  NOTIFICATION_TYPES,
  PLANS,
  SECURITY_PROVIDER,
  WATCHLIST_ALERT_TYPES,
  type WatchlistAlertNotificationPayload,
} from '@bt/shared/types';
import { afterEach, describe, expect, it, jest } from '@jest/globals';
import SecurityPricing from '@models/investments/security-pricing.model';
import WatchlistAlerts from '@models/investments/watchlist-alerts.model';
import * as sendEmailModule from '@services/email/send-email';
import * as helpers from '@tests/helpers';
import { addHours } from 'date-fns';

import { checkWatchlistAlerts } from './check-watchlist-alerts';
import { sendWatchlistAlertEmails } from './send-watchlist-alert-emails';

const dayKey = ({ days }: { days: number }) => helpers.utcDaysAgo({ days }).toISOString().slice(0, 10);

const alertNotifications = () => helpers.getNotifications({ type: NOTIFICATION_TYPES.watchlistAlert, raw: true });

/** Watches a security priced at 100 two days ago, so a new alert is evaluated against that close. */
const seedWatch = async ({ symbol, crypto = false }: { symbol: string; crypto?: boolean }) => {
  const portfolio = await helpers.createPortfolio({
    payload: helpers.buildPortfolioPayload({ name: `Watch ${symbol}` }),
    raw: true,
  });
  const security = await helpers.createTestSecurity({ symbol, crypto });
  const item = await helpers.createWatchlistItem({
    portfolioId: portfolio.id,
    payload: { securityId: security.id },
    raw: true,
  });
  await helpers.sleep(200);
  await helpers.setDailyPrices({ securityId: security.id, prices: [{ days: 2, price: '100' }] });
  return { portfolio, security, item };
};

const createAlert = ({
  portfolioId,
  itemId,
  payload,
}: {
  portfolioId: string;
  itemId: string;
  payload: Record<string, unknown>;
}) => helpers.createWatchlistAlert({ portfolioId, itemId, payload, raw: true });

const getAlert = async ({ portfolioId }: { portfolioId: string }) => {
  const { ungroupedItems } = await helpers.getWatchlist({ portfolioId, raw: true });
  return ungroupedItems[0]!.alerts[0]!;
};

const mockSend = ({ error = null }: { error?: { name: string; message: string; statusCode: number } | null } = {}) =>
  jest.spyOn(sendEmailModule, 'sendEmail').mockResolvedValue({
    data: error ? null : { id: 'email-id' },
    error,
    headers: null,
  } as Awaited<ReturnType<typeof sendEmailModule.sendEmail>>);

describe('Watchlist alerts check', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('fires a once alert when the close is already past its price, then turns it off', async () => {
    const { portfolio, security, item } = await seedWatch({ symbol: 'ONCE' });
    const alert = await createAlert({
      portfolioId: portfolio.id,
      itemId: item.id,
      payload: { type: WATCHLIST_ALERT_TYPES.closeAbove, price: '95' },
    });

    expect(await checkWatchlistAlerts({ crypto: false })).toEqual({
      alertsChecked: 1,
      fired: 1,
      failed: 0,
    });

    const notifications = await alertNotifications();
    expect(notifications).toHaveLength(1);
    expect(notifications[0]!.title).toBe('ONCE closed above 95 USD');
    expect(notifications[0]!.payload).toEqual({
      portfolioId: portfolio.id,
      portfolioName: portfolio.name,
      itemId: item.id,
      alertId: alert.id,
      securityId: security.id,
      symbol: 'ONCE',
      type: 'close_above',
      price: '95.0000000000',
      percent: null,
      currencyCode: 'USD',
      close: '100.0000000000',
      previousClose: null,
      changePercent: null,
      closeDate: dayKey({ days: 2 }),
    } satisfies WatchlistAlertNotificationPayload);
    expect(await getAlert({ portfolioId: portfolio.id })).toMatchObject({
      isActive: false,
      lastTriggeredAt: expect.any(String),
    });

    await helpers.addDailyPrices({ securityId: security.id, prices: [{ days: 1, price: '120' }] });
    expect((await checkWatchlistAlerts({ crypto: false })).fired).toBe(0);
    expect(await alertNotifications()).toHaveLength(1);
  });

  it('never fires twice on the same close', async () => {
    const { portfolio, security, item } = await seedWatch({ symbol: 'SAME' });
    const alert = await createAlert({
      portfolioId: portfolio.id,
      itemId: item.id,
      payload: { type: WATCHLIST_ALERT_TYPES.closeAbove, price: '90' },
    });
    expect((await checkWatchlistAlerts({ crypto: false })).fired).toBe(1);

    await helpers.updateWatchlistAlert({
      portfolioId: portfolio.id,
      itemId: item.id,
      alertId: alert.id,
      payload: { isActive: true },
      raw: true,
    });
    expect((await checkWatchlistAlerts({ crypto: false })).fired).toBe(0);

    await helpers.addDailyPrices({ securityId: security.id, prices: [{ days: 1, price: '95' }] });
    expect((await checkWatchlistAlerts({ crypto: false })).fired).toBe(1);
    expect(await alertNotifications()).toHaveLength(2);
  });

  it('runs concurrently without notifying twice', async () => {
    const { portfolio, item } = await seedWatch({ symbol: 'RACE' });
    await createAlert({
      portfolioId: portfolio.id,
      itemId: item.id,
      payload: { type: WATCHLIST_ALERT_TYPES.closeAbove, price: '90' },
    });

    const results = await Promise.all([
      checkWatchlistAlerts({ crypto: false }),
      checkWatchlistAlerts({ crypto: false }),
    ]);

    expect(results.reduce((sum, result) => sum + result.fired, 0)).toBe(1);
    expect(await alertNotifications()).toHaveLength(1);
  });

  it('waits for an every-time alert to cross back, then fires on a gap past the price and re-arms', async () => {
    const { portfolio, security, item } = await seedWatch({ symbol: 'EVERY' });
    await helpers.setDailyPrices({ securityId: security.id, prices: [{ days: 5, price: '120' }] });
    await createAlert({
      portfolioId: portfolio.id,
      itemId: item.id,
      payload: { type: WATCHLIST_ALERT_TYPES.closeAbove, price: '110', frequency: 'every_time' },
    });

    expect((await checkWatchlistAlerts({ crypto: false })).fired).toBe(0);

    await helpers.addDailyPrices({ securityId: security.id, prices: [{ days: 4, price: '100' }] });
    expect((await checkWatchlistAlerts({ crypto: false })).fired).toBe(0);

    // Two missing days in between: the close jumps straight past the price.
    await helpers.addDailyPrices({ securityId: security.id, prices: [{ days: 1, price: '130' }] });
    expect((await checkWatchlistAlerts({ crypto: false })).fired).toBe(1);
    expect(await getAlert({ portfolioId: portfolio.id })).toMatchObject({ isActive: true });
    expect(await alertNotifications()).toHaveLength(1);
  });

  it('fires a daily move alert in either direction past its percentage', async () => {
    const { portfolio, security, item } = await seedWatch({ symbol: 'MOVE' });
    await helpers.setDailyPrices({
      securityId: security.id,
      prices: [
        { days: 2, price: '100' },
        { days: 1, price: '93.5' },
      ],
    });
    await createAlert({
      portfolioId: portfolio.id,
      itemId: item.id,
      payload: { type: WATCHLIST_ALERT_TYPES.dailyMove, percent: 5 },
    });

    expect((await checkWatchlistAlerts({ crypto: false })).fired).toBe(1);
    const [notification] = await alertNotifications();
    expect(notification!.title).toBe('MOVE moved -6.5% in a day');
    expect(notification!.payload).toMatchObject({ previousClose: '100.0000000000', changePercent: -6.5 });
  });

  it('ignores a move under the percentage', async () => {
    const { portfolio, security, item } = await seedWatch({ symbol: 'CALM' });
    await helpers.setDailyPrices({
      securityId: security.id,
      prices: [
        { days: 2, price: '100' },
        { days: 1, price: '103' },
      ],
    });
    await createAlert({
      portfolioId: portfolio.id,
      itemId: item.id,
      payload: { type: WATCHLIST_ALERT_TYPES.dailyMove, percent: 5 },
    });

    expect((await checkWatchlistAlerts({ crypto: false })).fired).toBe(0);
  });

  it('fires a close below alert on a close equal to its price', async () => {
    const { portfolio, item } = await seedWatch({ symbol: 'BELOW' });
    await createAlert({
      portfolioId: portfolio.id,
      itemId: item.id,
      payload: { type: WATCHLIST_ALERT_TYPES.closeBelow, price: '100' },
    });

    expect((await checkWatchlistAlerts({ crypto: false })).fired).toBe(1);
    expect((await alertNotifications())[0]!.title).toBe('BELOW closed below 100 USD');
  });

  it('does not arm an every-time alert edited onto a threshold the close already passes', async () => {
    const { portfolio, security, item } = await seedWatch({ symbol: 'EDIT' });
    const alert = await createAlert({
      portfolioId: portfolio.id,
      itemId: item.id,
      payload: { type: WATCHLIST_ALERT_TYPES.closeAbove, price: '150', frequency: 'every_time' },
    });
    await helpers.updateWatchlistAlert({
      portfolioId: portfolio.id,
      itemId: item.id,
      alertId: alert.id,
      payload: { price: '90' },
      raw: true,
    });

    expect((await checkWatchlistAlerts({ crypto: false })).fired).toBe(0);

    await helpers.addDailyPrices({ securityId: security.id, prices: [{ days: 1, price: '80' }] });
    expect((await checkWatchlistAlerts({ crypto: false })).fired).toBe(0);
    expect(await alertNotifications()).toHaveLength(0);
  });

  it('never fires on a close older than a week, and fires on one within it', async () => {
    const { portfolio, security, item } = await seedWatch({ symbol: 'STALE' });
    await helpers.setDailyPrices({ securityId: security.id, prices: [{ days: 10, price: '10' }] });
    await createAlert({
      portfolioId: portfolio.id,
      itemId: item.id,
      payload: { type: WATCHLIST_ALERT_TYPES.closeBelow, price: '50' },
    });

    expect((await checkWatchlistAlerts({ crypto: false })).fired).toBe(0);

    await helpers.setDailyPrices({ securityId: security.id, prices: [{ days: 6, price: '10' }] });
    expect((await checkWatchlistAlerts({ crypto: false })).fired).toBe(1);
  });

  it("uses the last price of each completed UTC day and ignores today's", async () => {
    const { portfolio, security, item } = await seedWatch({ symbol: 'BTCX', crypto: true });
    await SecurityPricing.bulkCreate([
      {
        securityId: security.id,
        date: addHours(helpers.utcDaysAgo({ days: 1 }), 6),
        priceClose: '200',
        source: SECURITY_PROVIDER.coingecko,
      },
      {
        securityId: security.id,
        date: addHours(helpers.utcDaysAgo({ days: 1 }), 23),
        priceClose: '90',
        source: SECURITY_PROVIDER.coingecko,
      },
      {
        securityId: security.id,
        date: addHours(helpers.utcDaysAgo({ days: 0 }), 0),
        priceClose: '300',
        source: SECURITY_PROVIDER.coingecko,
      },
    ]);
    await createAlert({
      portfolioId: portfolio.id,
      itemId: item.id,
      payload: { type: WATCHLIST_ALERT_TYPES.closeBelow, price: '150' },
    });

    expect((await checkWatchlistAlerts({ crypto: false })).alertsChecked).toBe(0);
    expect((await checkWatchlistAlerts({ crypto: true })).fired).toBe(1);

    const { ungroupedItems } = await helpers.getWatchlist({ portfolioId: portfolio.id, raw: true });
    expect(ungroupedItems[0]).toMatchObject({ lastClose: '90.0000000000', lastCloseDate: dayKey({ days: 1 }) });
  });

  it('records an email-only alert without an in-app notification', async () => {
    const { portfolio, item } = await seedWatch({ symbol: 'MAIL' });
    await createAlert({
      portfolioId: portfolio.id,
      itemId: item.id,
      payload: { type: WATCHLIST_ALERT_TYPES.closeAbove, price: '90', notifyInApp: false, notifyEmail: true },
    });

    expect((await checkWatchlistAlerts({ crypto: false })).fired).toBe(1);
    expect(await alertNotifications()).toHaveLength(0);
    expect(await getAlert({ portfolioId: portfolio.id })).toMatchObject({ lastTriggeredAt: expect.any(String) });
  });

  it('fails one alert without skipping the rest of its user', async () => {
    const { portfolio, item } = await seedWatch({ symbol: 'SPLIT' });
    for (const price of ['90', '95']) {
      await createAlert({
        portfolioId: portfolio.id,
        itemId: item.id,
        payload: { type: WATCHLIST_ALERT_TYPES.closeAbove, price },
      });
    }
    jest.spyOn(WatchlistAlerts, 'update').mockRejectedValueOnce(new Error('boom'));

    expect(await checkWatchlistAlerts({ crypto: false })).toEqual({
      alertsChecked: 2,
      fired: 1,
      failed: 1,
    });
    expect(await alertNotifications()).toHaveLength(1);
  });

  describe('email', () => {
    const emailAlert = async ({ symbol, price = '90' }: { symbol: string; price?: string }) => {
      const { portfolio, item } = await seedWatch({ symbol });
      await createAlert({
        portfolioId: portfolio.id,
        itemId: item.id,
        payload: { type: WATCHLIST_ALERT_TYPES.closeAbove, price, notifyInApp: false, notifyEmail: true },
      });
      return portfolio;
    };

    it('sends nothing during the check, then one email per alert run', async () => {
      const sendSpy = mockSend();
      await emailAlert({ symbol: 'SENT' });

      expect((await checkWatchlistAlerts({ crypto: false })).fired).toBe(1);
      expect(sendSpy).not.toHaveBeenCalled();

      expect(await sendWatchlistAlertEmails()).toEqual({ sent: 1, skipped: 0, failed: 0 });
      expect(sendSpy).toHaveBeenCalledTimes(1);
      expect(sendSpy).toHaveBeenCalledWith(expect.objectContaining({ subject: 'SENT closed above 90 USD' }));

      expect(await sendWatchlistAlertEmails()).toEqual({ sent: 0, skipped: 0, failed: 0 });
      expect(sendSpy).toHaveBeenCalledTimes(1);
    });

    it('batches every pending alert of a user, across portfolios, into one email', async () => {
      const sendSpy = mockSend();
      await emailAlert({ symbol: 'BATCHA' });
      await emailAlert({ symbol: 'BATCHB', price: '95' });

      expect((await checkWatchlistAlerts({ crypto: false })).fired).toBe(2);
      expect(await sendWatchlistAlertEmails()).toEqual({ sent: 1, skipped: 0, failed: 0 });

      expect(sendSpy).toHaveBeenCalledTimes(1);
      const { subject, html } = sendSpy.mock.calls[0]![0] as { subject: string; html: string };
      expect(subject).toBe('2 watchlist alerts fired');
      expect(html).toContain('BATCHA closed above 90 USD');
      expect(html).toContain('BATCHB closed above 95 USD');
    });

    it('drops a failed send without retrying it, and keeps the alert fired', async () => {
      mockSend({ error: { name: 'rate_limit_exceeded', message: 'Too many requests', statusCode: 429 } });
      const portfolio = await emailAlert({ symbol: 'BOUNCE' });

      await checkWatchlistAlerts({ crypto: false });
      expect(await sendWatchlistAlertEmails()).toEqual({ sent: 0, skipped: 0, failed: 1 });
      expect(await sendWatchlistAlertEmails()).toEqual({ sent: 0, skipped: 0, failed: 0 });
      expect(await getAlert({ portfolioId: portfolio.id })).toMatchObject({
        isActive: false,
        lastTriggeredAt: expect.any(String),
      });
    });

    it('skips the email when the user lost the watchlist feature before the send', async () => {
      const sendSpy = mockSend();
      await emailAlert({ symbol: 'LOST' });

      await checkWatchlistAlerts({ crypto: false });
      await helpers.setUserBilling({ plan: PLANS.essential });

      expect(await sendWatchlistAlertEmails()).toEqual({ sent: 0, skipped: 1, failed: 0 });
      expect(sendSpy).not.toHaveBeenCalled();
    });
  });

  it('skips portfolios in the trash and users without the watchlist feature', async () => {
    const trashed = await seedWatch({ symbol: 'TRASH' });
    await createAlert({
      portfolioId: trashed.portfolio.id,
      itemId: trashed.item.id,
      payload: { type: WATCHLIST_ALERT_TYPES.closeAbove, price: '90' },
    });
    await helpers.deletePortfolio({ portfolioId: trashed.portfolio.id });

    expect((await checkWatchlistAlerts({ crypto: false })).alertsChecked).toBe(0);

    const lapsed = await seedWatch({ symbol: 'LAPSED' });
    await createAlert({
      portfolioId: lapsed.portfolio.id,
      itemId: lapsed.item.id,
      payload: { type: WATCHLIST_ALERT_TYPES.closeAbove, price: '90' },
    });
    await helpers.setUserBilling({ plan: PLANS.essential });

    expect(await checkWatchlistAlerts({ crypto: false })).toEqual({
      alertsChecked: 1,
      fired: 0,
      failed: 0,
    });
    expect(await alertNotifications()).toHaveLength(0);
  });

  it('still completes the price sync when the alert check throws', async () => {
    const { portfolio, item } = await seedWatch({ symbol: 'THROW' });
    await createAlert({
      portfolioId: portfolio.id,
      itemId: item.id,
      payload: { type: WATCHLIST_ALERT_TYPES.closeAbove, price: '90' },
    });
    jest.spyOn(WatchlistAlerts, 'findAll').mockRejectedValue(new Error('boom'));

    const response = await helpers.triggerSecuritiesSync();

    expect(response.statusCode).toBe(200);
    expect(helpers.extractResponse(response)).toMatchObject({ stocks: { ok: true } });
    expect(await alertNotifications()).toHaveLength(0);
  });

  it('runs after the securities price sync', async () => {
    const { portfolio, item } = await seedWatch({ symbol: 'WIRED' });
    await createAlert({
      portfolioId: portfolio.id,
      itemId: item.id,
      payload: { type: WATCHLIST_ALERT_TYPES.closeAbove, price: '90' },
    });

    expect((await helpers.triggerSecuritiesSync()).statusCode).toBe(200);

    expect(await alertNotifications()).toHaveLength(1);
  });
});

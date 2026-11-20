import { ASSET_CLASS, NOTIFICATION_TYPES, SECURITY_PROVIDER } from '@bt/shared/types';
import { describe, expect, it } from '@jest/globals';
import Holdings from '@models/investments/holdings.model';
import Securities from '@models/investments/securities.model';
import SecurityPricing from '@models/investments/security-pricing.model';
import * as helpers from '@tests/helpers';
import { AED_PER_USD } from '@tests/mocks/exchange-rates/data';

import { checkUnrealizedLossAlerts } from './check-unrealized-loss-alerts';

/** The check runs from the daily price cron and has no HTTP surface, so this e2e invokes it directly. */

// getHoldingValues deduplicates identical calls for 1 second.
const DEDUP_CACHE_MS = 1100;

const lossNotifications = () => helpers.getNotifications({ type: NOTIFICATION_TYPES.unrealizedLossAlert, raw: true });

const enableAlerts = (config: { percentThreshold?: number; amountThreshold?: number } = {}) =>
  helpers.patchUserSettings({ patch: { unrealizedLossAlerts: { enabled: true, ...config } }, raw: true });

const setPrice = async ({ securityId, price }: { securityId: string; price: string }) => {
  await SecurityPricing.destroy({ where: { securityId } });
  await SecurityPricing.create({ securityId, date: new Date(), priceClose: price, source: SECURITY_PROVIDER.fmp });
  await helpers.sleep(DEDUP_CACHE_MS);
};

// No endpoint toggles `excluded`, so the tests set it on the model.
const setExcluded = async ({ securityId, excluded }: { securityId: string; excluded: boolean }) => {
  await Holdings.update({ excluded }, { where: { securityId } });
  await helpers.sleep(DEDUP_CACHE_MS);
};

/** 10 shares bought at 100 USD: a cost basis of 1000 USD. */
const seedHolding = async ({ symbol, price }: { symbol: string; price: string }) => {
  const portfolio = await helpers.createPortfolio({
    payload: helpers.buildPortfolioPayload({ name: `Loss alert ${symbol}` }),
    raw: true,
  });
  const security = await Securities.create({
    symbol,
    providerSymbol: symbol,
    currencyCode: 'USD',
    providerName: SECURITY_PROVIDER.fmp,
    assetClass: ASSET_CLASS.stocks,
    name: `${symbol} Inc.`,
  });
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
      quantity: '10',
      price: '100',
      fees: '0',
    },
  });
  // Drain the background price sync triggered by createHolding before pinning the price.
  await helpers.sleep(200);
  await setPrice({ securityId: security.id, price });
  return { portfolio, security };
};

describe('Unrealized loss alerts check', () => {
  it('sends nothing while alerts are off', async () => {
    await seedHolding({ symbol: 'OFF', price: '50' });

    expect(await checkUnrealizedLossAlerts()).toEqual({ usersChecked: 0, notified: 0, failed: 0, errors: [] });
    expect(await lossNotifications()).toHaveLength(0);
  });

  it('notifies once per crossing with the default thresholds, then stays quiet', async () => {
    const { portfolio, security } = await seedHolding({ symbol: 'DROP', price: '80' });
    await enableAlerts();

    expect(await checkUnrealizedLossAlerts()).toEqual({ usersChecked: 1, notified: 1, failed: 0, errors: [] });

    const notifications = await lossNotifications();
    expect(notifications).toHaveLength(1);
    expect(notifications[0]!.payload).toEqual({
      currencyCode: global.BASE_CURRENCY_CODE,
      holdings: [
        {
          portfolioId: portfolio.id,
          portfolioName: portfolio.name,
          securityId: security.id,
          symbol: 'DROP',
          lossPercent: 20,
          lossAmount: expect.closeTo(200 * AED_PER_USD, 1),
        },
      ],
    });

    await helpers.sleep(DEDUP_CACHE_MS);
    expect((await checkUnrealizedLossAlerts()).notified).toBe(0);
    expect(await lossNotifications()).toHaveLength(1);
  });

  it('re-arms after the holding recovers and alerts on the next drop', async () => {
    const { security } = await seedHolding({ symbol: 'BOUNCE', price: '80' });
    await enableAlerts();
    await checkUnrealizedLossAlerts();

    await setPrice({ securityId: security.id, price: '99' });
    expect((await checkUnrealizedLossAlerts()).notified).toBe(0);

    await setPrice({ securityId: security.id, price: '85' });
    expect((await checkUnrealizedLossAlerts()).notified).toBe(1);
    expect(await lossNotifications()).toHaveLength(2);
  });

  it('alerts on the amount threshold alone when the percentage is below its threshold', async () => {
    await seedHolding({ symbol: 'BIG', price: '80' });
    // A 20% loss of 200 USD ≈ 734 AED: under 50%, over 700 AED.
    await enableAlerts({ percentThreshold: 50, amountThreshold: 700 });

    expect((await checkUnrealizedLossAlerts()).notified).toBe(1);
  });

  it('ignores losses under both thresholds and gains', async () => {
    await seedHolding({ symbol: 'SMALL', price: '95' });
    await seedHolding({ symbol: 'GAIN', price: '150' });
    await enableAlerts();

    expect((await checkUnrealizedLossAlerts()).notified).toBe(0);
    expect(await lossNotifications()).toHaveLength(0);
  });

  it('sends one digest for crossings across portfolios', async () => {
    await seedHolding({ symbol: 'ONE', price: '80' });
    await seedHolding({ symbol: 'TWO', price: '70' });
    await enableAlerts();

    expect(await checkUnrealizedLossAlerts()).toEqual({ usersChecked: 1, notified: 1, failed: 0, errors: [] });
    const notifications = await lossNotifications();
    expect(notifications).toHaveLength(1);
    expect((notifications[0]!.payload as { holdings: unknown[] }).holdings).toHaveLength(2);
  });

  it('skips excluded holdings', async () => {
    const { security } = await seedHolding({ symbol: 'EXCL', price: '50' });
    await setExcluded({ securityId: security.id, excluded: true });
    await enableAlerts();

    expect((await checkUnrealizedLossAlerts()).notified).toBe(0);
    expect(await lossNotifications()).toHaveLength(0);
  });

  it('keeps the latch while a holding is excluded', async () => {
    const { security } = await seedHolding({ symbol: 'LATCH', price: '50' });
    await enableAlerts();
    expect((await checkUnrealizedLossAlerts()).notified).toBe(1);

    await setExcluded({ securityId: security.id, excluded: true });
    await checkUnrealizedLossAlerts();
    await setExcluded({ securityId: security.id, excluded: false });

    expect((await checkUnrealizedLossAlerts()).notified).toBe(0);
    expect(await lossNotifications()).toHaveLength(1);
  });

  it('skips holdings without a price', async () => {
    const { security } = await seedHolding({ symbol: 'NOPRICE', price: '50' });
    await SecurityPricing.destroy({ where: { securityId: security.id } });
    await helpers.sleep(DEDUP_CACHE_MS);
    await enableAlerts();

    expect((await checkUnrealizedLossAlerts()).notified).toBe(0);
    expect(await lossNotifications()).toHaveLength(0);
  });

  it('keeps stored thresholds when alerts are disabled', async () => {
    await enableAlerts({ percentThreshold: 25, amountThreshold: 900 });
    await helpers.patchUserSettings({ patch: { unrealizedLossAlerts: { enabled: false } }, raw: true });

    expect((await helpers.getUserSettings({ raw: true })).unrealizedLossAlerts).toEqual({
      enabled: false,
      percentThreshold: 25,
      amountThreshold: 900,
    });
  });

  it('rejects out-of-range thresholds', async () => {
    const response = await helpers.patchUserSettings({ patch: { unrealizedLossAlerts: { percentThreshold: 0 } } });
    expect(response.statusCode).toBe(422);
  });
});

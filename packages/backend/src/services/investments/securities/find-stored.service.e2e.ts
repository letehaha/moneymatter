import { ASSET_CLASS, SECURITY_PROVIDER } from '@bt/shared/types/investments';
import { describe, expect, it } from '@jest/globals';
import Securities from '@models/investments/securities.model';

import { findStoredSecurityBySymbol, findStoredSecurityIds } from './find-stored.service';

const makeStock = ({ symbol, currencyCode = 'USD' }: { symbol: string; currencyCode?: string }) =>
  Securities.create({
    symbol,
    providerSymbol: symbol,
    currencyCode,
    providerName: SECURITY_PROVIDER.fmp,
    assetClass: ASSET_CLASS.stocks,
    name: `${symbol} test security`,
  });

describe('findStoredSecurityBySymbol', () => {
  it('finds a stored security by provider and symbol, and returns null for one that is not stored', async () => {
    const stored = await makeStock({ symbol: 'STORED1' });

    expect((await findStoredSecurityBySymbol({ symbol: 'STORED1', providerName: SECURITY_PROVIDER.fmp }))?.id).toBe(
      stored.id,
    );
    expect(
      await findStoredSecurityBySymbol({ symbol: 'STORED1', providerName: SECURITY_PROVIDER.coingecko }),
    ).toBeNull();
    expect(await findStoredSecurityBySymbol({ symbol: 'NOTSTORED', providerName: SECURITY_PROVIDER.fmp })).toBeNull();
  });

  it('matches the provider symbol of a crypto security as well as its ticker', async () => {
    const bitcoin = await Securities.create({
      symbol: 'BTC',
      providerSymbol: 'bitcoin',
      currencyCode: 'USD',
      cryptoCurrencyCode: 'BTC',
      providerName: SECURITY_PROVIDER.coingecko,
      assetClass: ASSET_CLASS.crypto,
      name: 'Bitcoin',
    });

    const byProviderSymbol = await findStoredSecurityBySymbol({
      symbol: 'bitcoin',
      providerName: SECURITY_PROVIDER.coingecko,
    });
    const byTicker = await findStoredSecurityBySymbol({ symbol: 'BTC', providerName: SECURITY_PROVIDER.coingecko });

    expect(byProviderSymbol?.id).toBe(bitcoin.id);
    expect(byTicker?.id).toBe(bitcoin.id);
  });

  it('refuses to guess between several stored securities that share a ticker, and prefers an exact provider symbol', async () => {
    const make = ({ providerSymbol, currencyCode }: { providerSymbol: string; currencyCode: string }) =>
      Securities.create({
        symbol: 'TWINS1',
        providerSymbol,
        currencyCode,
        providerName: SECURITY_PROVIDER.fmp,
        assetClass: ASSET_CLASS.stocks,
        name: 'Twin',
      });
    const usd = await make({ providerSymbol: 'TWINS1', currencyCode: 'USD' });
    await make({ providerSymbol: 'TWINS1.DE', currencyCode: 'EUR' });
    await make({ providerSymbol: 'TWINS1.L', currencyCode: 'GBP' });

    expect((await findStoredSecurityBySymbol({ symbol: 'TWINS1', providerName: SECURITY_PROVIDER.fmp }))?.id).toBe(
      usd.id,
    );
    await Securities.destroy({ where: { id: usd.id } });

    await expect(findStoredSecurityBySymbol({ symbol: 'TWINS1', providerName: SECURITY_PROVIDER.fmp })).rejects.toThrow(
      /securityId/,
    );
  });
});

describe('findStoredSecurityIds', () => {
  it('lines the stored ids up with the results, null where nothing is stored, whatever the provider', async () => {
    const stored = await makeStock({ symbol: 'LINEUP1' });
    const hit = (symbol: string, providerName = SECURITY_PROVIDER.fmp) => ({
      symbol,
      providerSymbol: symbol,
      providerName,
      assetClass: ASSET_CLASS.stocks,
      currencyCode: 'USD',
    });

    const ids = await findStoredSecurityIds({
      results: [
        hit('LINEUP2'),
        hit('LINEUP1', SECURITY_PROVIDER.polygon),
        hit('LINEUP1'),
        { ...hit('LINEUP1'), currencyCode: 'EUR' },
      ],
    });

    expect(ids).toEqual([null, stored.id, stored.id, null]);
  });

  it('returns nothing for no results', async () => {
    expect(await findStoredSecurityIds({ results: [] })).toEqual([]);
  });
});

import { SECURITY_PROVIDER } from '@bt/shared/types/investments';

import { AlphaVantageDataProvider } from './alphavantage-provider';
import { BaseSecurityDataProvider } from './base-provider';
import { getCoinGeckoKey, requireCoinGeckoKey } from './clients/coingecko-client';
import { CoinGeckoDataProvider } from './coingecko-provider';
import { CompositeDataProvider } from './composite-provider';
import { FmpDataProvider } from './fmp-provider';
import { PolygonDataProvider } from './polygon-provider';
import { YahooDataProvider } from './yahoo-provider';

class DataProviderFactory {
  private providers = new Map<SECURITY_PROVIDER, BaseSecurityDataProvider>();

  getProvider(providerName: SECURITY_PROVIDER = SECURITY_PROVIDER.composite): BaseSecurityDataProvider {
    if (!this.providers.has(providerName)) {
      this.providers.set(providerName, this.createProvider(providerName));
    }
    return this.providers.get(providerName)!;
  }

  private createProvider(providerName: SECURITY_PROVIDER): BaseSecurityDataProvider {
    switch (providerName) {
      case SECURITY_PROVIDER.alphavantage: {
        const apiKey = process.env.ALPHA_VANTAGE_API_KEY as string;
        if (!apiKey) {
          throw new Error('Alpha Vantage API key not configured');
        }
        return new AlphaVantageDataProvider(apiKey);
      }

      case SECURITY_PROVIDER.polygon: {
        const apiKey = process.env.POLYGON_API_KEY as string;
        if (!apiKey) {
          throw new Error('Polygon API key not configured');
        }
        return new PolygonDataProvider(apiKey);
      }

      case SECURITY_PROVIDER.fmp: {
        const apiKey = process.env.FMP_API_KEY as string;
        if (!apiKey) {
          throw new Error('FMP API key not configured');
        }
        return new FmpDataProvider(apiKey);
      }

      case SECURITY_PROVIDER.yahoo: {
        return new YahooDataProvider();
      }

      case SECURITY_PROVIDER.coingecko: {
        return new CoinGeckoDataProvider({ apiKey: requireCoinGeckoKey() });
      }

      case SECURITY_PROVIDER.composite: {
        return new CompositeDataProvider({
          fmpApiKey: process.env.FMP_API_KEY,
          polygonApiKey: process.env.POLYGON_API_KEY,
          alphaVantageApiKey: process.env.ALPHA_VANTAGE_API_KEY,
          coingeckoApiKey: getCoinGeckoKey(),
          yahooEnabled: process.env.YAHOO_FINANCE_ENABLED !== 'false',
        });
      }

      default:
        throw new Error(`Unsupported data provider: ${providerName}`);
    }
  }

  /**
   * Used in tests to clear cached providers to avoid mocking issues
   */
  public clearCache() {
    this.providers.clear();
  }
}

export const dataProviderFactory = new DataProviderFactory();

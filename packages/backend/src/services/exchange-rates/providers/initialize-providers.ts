import { ApiLayerProvider } from './api-layer';
import { CurrencyRatesApiProvider } from './currency-rates-api';
import { FawazCurrencyApiProvider } from './fawaz-currency-api';
import { exchangeRateProviderRegistry } from './registry';

export function initializeExchangeRateProviders(): void {
  // Register providers in priority order — registration order is the fallback order.
  // 1. Custom Currency Rates API (try first)
  exchangeRateProviderRegistry.register(new CurrencyRatesApiProvider());
  // 2. fawazahmed0 Currency API (free CDN, fills the exotic long tail on fresh dates)
  exchangeRateProviderRegistry.register(new FawazCurrencyApiProvider());
  // 3. ApiLayer (comprehensive, paid last-resort fallback)
  exchangeRateProviderRegistry.register(new ApiLayerProvider());
}

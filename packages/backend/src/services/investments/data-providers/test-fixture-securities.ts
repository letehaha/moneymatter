import { ASSET_CLASS, SECURITY_PROVIDER, type SecuritySearchResult } from '@bt/shared/types/investments';
import { isTestSeedingEnabled } from '@common/utils/env';

const TEST_FIXTURE_SECURITIES: SecuritySearchResult[] = [
  { symbol: 'ETEST', name: 'E2E Test Corp' },
  { symbol: 'ISCRL', name: 'Infinite Scroll Corp' },
].map(({ symbol, name }) => ({
  symbol,
  providerSymbol: symbol,
  name,
  assetClass: ASSET_CLASS.stocks,
  providerName: SECURITY_PROVIDER.fmp,
  currencyCode: 'USD',
}));

/** Search hit for e2e seeding when the query names a fixture symbol exactly; never matches outside test seeding envs. */
export const findTestFixtureSecurity = ({ query }: { query: string }): SecuritySearchResult | undefined => {
  if (!isTestSeedingEnabled()) return undefined;
  const symbol = query.trim().toUpperCase();
  return TEST_FIXTURE_SECURITIES.find((fixture) => fixture.symbol === symbol);
};

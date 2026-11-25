import {
  ASSET_CLASS,
  PORTFOLIO_BENCHMARKS,
  type PortfolioBenchmark,
  SECURITY_PROVIDER,
  SECURITY_TYPE,
} from '@bt/shared/types';
import { LockedError } from '@js/errors';
import { logger } from '@js/utils';
import Securities from '@models/investments/securities.model';
import SecurityPricing from '@models/investments/security-pricing.model';
import { syncHistoricalPrices } from '@services/investments/securities-price/historical-sync.service';
import { findSecurityByIdentity } from '@services/investments/securities/identity';
import { UniqueConstraintError } from 'sequelize';

const backfillPrices = ({ securityId }: { securityId: string }) =>
  syncHistoricalPrices(securityId).then(
    ({ count }) => {
      if (count === 0) {
        logger.error('Benchmark price backfill returned no prices', {
          code: 'BENCHMARK_PRICE_BACKFILL_EMPTY',
          securityId,
        });
      }
    },
    (error: unknown) => {
      // Another request is already backfilling this security.
      if (error instanceof LockedError) return;
      logger.error(
        { message: 'Benchmark price backfill failed', error: error as Error },
        { code: 'BENCHMARK_PRICE_BACKFILL_FAILED', securityId },
      );
    },
  );

/**
 * The benchmark's security, created with a price backfill the first time it is asked for. A stored row
 * with no prices gets the backfill again in the background, so a failed first one heals.
 */
export const resolveBenchmarkSecurity = async ({ benchmark }: { benchmark: PortfolioBenchmark }) => {
  const { name, providerSymbol, currencyCode, isFundProxy } = PORTFOLIO_BENCHMARKS[benchmark];

  const existing =
    (await Securities.findOne({ where: { providerName: SECURITY_PROVIDER.yahoo, providerSymbol } })) ??
    // A row another provider stored for the same listing; a second row would duplicate the stock identity.
    (await findSecurityByIdentity({
      assetClass: ASSET_CLASS.stocks,
      providerName: SECURITY_PROVIDER.yahoo,
      providerSymbol,
      symbol: providerSymbol,
      currencyCode,
    }));
  if (existing) {
    const hasPrices = await SecurityPricing.findOne({ where: { securityId: existing.id }, attributes: ['securityId'] });
    if (!hasPrices) backfillPrices({ securityId: existing.id });
    return existing;
  }

  let created: Securities;
  try {
    created = await Securities.create({
      symbol: providerSymbol,
      providerSymbol,
      name,
      currencyCode,
      providerName: SECURITY_PROVIDER.yahoo,
      assetClass: ASSET_CLASS.stocks,
      securityType: isFundProxy ? SECURITY_TYPE.etf : SECURITY_TYPE.other,
      isBrokerageCash: false,
    });
  } catch (error) {
    if (!(error instanceof UniqueConstraintError)) throw error;
    return Securities.findOne({
      where: { providerName: SECURITY_PROVIDER.yahoo, providerSymbol },
      rejectOnEmpty: true,
    });
  }

  await backfillPrices({ securityId: created.id });
  return created;
};

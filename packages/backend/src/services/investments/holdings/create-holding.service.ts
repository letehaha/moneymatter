import { findOrThrowNotFound } from '@common/utils/find-or-throw-not-found';
import { t } from '@i18n/index';
import { ConflictError } from '@js/errors';
import { logger } from '@js/utils';
import { getCurrency } from '@models/currencies.model';
import Holdings from '@models/investments/holdings.model';
import Portfolios from '@models/investments/portfolios.model';
import Securities from '@models/investments/securities.model';
import { withTransaction } from '@services/common/with-transaction';
import { addUserCurrencies } from '@services/currencies/add-user-currency';
import { syncHistoricalPrices } from '@services/investments/securities-price/historical-sync.service';

interface CreateHoldingParams {
  userId: number;
  portfolioId: string;
  securityId: string;
}

const createHoldingImpl = async ({ userId, portfolioId, securityId }: CreateHoldingParams) => {
  await findOrThrowNotFound({
    query: Portfolios.findOne({ where: { id: portfolioId, userId } }),
    message: t({ key: 'investments.portfolioNotFound' }),
  });

  const security = await findOrThrowNotFound({
    query: Securities.findByPk(securityId),
    message: t({ key: 'investments.securityNotFound' }),
  });

  // Ensure user has the currency for this security. Investments are ISO-only: a security quoted
  // in a code that matches a user-defined currency must not attach somebody's custom definition.
  const currency = await findOrThrowNotFound({
    query: getCurrency({ code: security.currencyCode.toUpperCase() }).then((row) => (row?.isCustom ? null : row)),
    message: t({ key: 'investments.currencyForSecurityNotFound' }),
  });
  await addUserCurrencies([{ userId, currencyCode: currency.code }]);

  const existingHolding = await Holdings.findOne({ where: { portfolioId, securityId } });
  if (existingHolding) {
    throw new ConflictError({ message: t({ key: 'investments.securityAlreadyInPortfolio' }) });
  }

  const newHolding = await Holdings.create({
    portfolioId,
    securityId,
    currencyCode: security.currencyCode,
    quantity: '0',
    costBasis: '0',
    refCostBasis: '0',
    value: '0', // Deprecated - will be removed
    refValue: '0', // Deprecated - will be removed
  });

  return { newHolding, securityId };
};

export const createHolding = async (params: CreateHoldingParams) => {
  const { newHolding, securityId } = await withTransaction(createHoldingImpl)(params);

  // TODO: check if securityId already assiciated with some other holdings, and if so
  // then there's no need to sync historical prices, because they must already be synced
  // by sync-latest-prices service/cron. We can also add extra verification check like
  // if_already_associated + if_last_synced_price_no_older_than_week
  // Trigger background price sync after transaction is committed
  syncHistoricalPrices(securityId).catch((error) => {
    logger.error({
      message: `Background historical price sync failed for securityId: ${securityId}`,
      error: error as Error,
    });
  });

  return newHolding;
};

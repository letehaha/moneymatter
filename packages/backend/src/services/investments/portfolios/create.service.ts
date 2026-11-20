import { PORTFOLIO_TYPE } from '@bt/shared/types/investments';
import { t } from '@i18n/index';
import { ValidationError } from '@js/errors';
import Portfolios from '@models/investments/portfolios.model';
import * as UsersCurrencies from '@models/users-currencies.model';
import { withTransaction } from '@services/common/with-transaction';

interface CreatePortfolioParams {
  userId: number;
  name: string;
  portfolioType: PORTFOLIO_TYPE;
  description?: string | null;
  displayCurrencyCode?: string | null;
  externalUrl?: string | null;
  isEnabled?: boolean;
}

const createPortfolioImpl = async ({
  userId,
  name,
  portfolioType,
  description = null,
  displayCurrencyCode = null,
  externalUrl = null,
  isEnabled = true,
}: CreatePortfolioParams) => {
  // Display currency must be connected to the user, otherwise the summary and
  // holdings endpoints could not resolve an exchange rate for it.
  if (displayCurrencyCode) {
    const userCurrency = await UsersCurrencies.getCurrency({ userId, currencyCode: displayCurrencyCode });
    if (!userCurrency) {
      throw new ValidationError({ message: t({ key: 'currencies.currencyNotConnected' }) });
    }
  }

  // Duplicate names are allowed — the (userId, name) DB constraint was dropped
  // because it collided with soft-delete and the product call is to not bother
  // the user about it.
  const portfolio = await Portfolios.create({
    userId,
    name: name.trim(),
    portfolioType,
    description,
    displayCurrencyCode,
    externalUrl,
    isEnabled,
  });

  return portfolio;
};

export const createPortfolio = withTransaction(createPortfolioImpl);

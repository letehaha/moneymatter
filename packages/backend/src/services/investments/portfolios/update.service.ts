import type { NonImageLogoPayload } from '@bt/shared/types';
import { PORTFOLIO_TYPE } from '@bt/shared/types/investments';
import { findOrThrowNotFound } from '@common/utils/find-or-throw-not-found';
import { t } from '@i18n/index';
import { ValidationError } from '@js/errors';
import Portfolios from '@models/investments/portfolios.model';
import * as UsersCurrencies from '@models/users-currencies.model';
import { applyManualLogoPatch } from '@services/brand-logos';
import { withTransaction } from '@services/common/with-transaction';

interface UpdatePortfolioParams extends NonImageLogoPayload {
  userId: number;
  portfolioId: string;
  name?: string;
  portfolioType?: PORTFOLIO_TYPE;
  description?: string | null;
  displayCurrencyCode?: string | null;
  isEnabled?: boolean;
}

const updatePortfolioImpl = async ({
  userId,
  portfolioId,
  name,
  portfolioType,
  description,
  displayCurrencyCode,
  isEnabled,
  logoDomain,
  logoInitials,
  logoColor,
  logoIcon,
}: UpdatePortfolioParams) => {
  // Find the portfolio and verify ownership
  const portfolio = await findOrThrowNotFound({
    query: Portfolios.findOne({
      where: { id: portfolioId, userId },
    }),
    message: t({ key: 'investments.portfolioNotFound' }),
  });

  // Duplicate names are allowed — see the matching note in create.service.ts.

  // Display currency must be connected to the user, otherwise the summary
  // endpoint could not resolve an exchange rate for it.
  if (displayCurrencyCode != null) {
    const userCurrency = await UsersCurrencies.getCurrency({ userId, currencyCode: displayCurrencyCode });
    if (!userCurrency) {
      throw new ValidationError({ message: t({ key: 'currencies.currencyNotConnected' }) });
    }
  }

  // Update the portfolio with only provided fields
  const updateData: Partial<Portfolios> = {};

  if (name !== undefined) updateData.name = name.trim();
  if (portfolioType !== undefined) updateData.portfolioType = portfolioType;
  if (description !== undefined) updateData.description = description;
  if (displayCurrencyCode !== undefined) updateData.displayCurrencyCode = displayCurrencyCode;
  if (isEnabled !== undefined) updateData.isEnabled = isEnabled;

  const logoPatch = applyManualLogoPatch({
    patch: { logoDomain, logoInitials, logoColor, logoIcon },
    stored: portfolio,
  });

  await portfolio.update({ ...updateData, ...logoPatch });

  return portfolio.reload();
};

export const updatePortfolio = withTransaction(updatePortfolioImpl);

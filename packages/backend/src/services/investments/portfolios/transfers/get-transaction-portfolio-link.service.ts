import { findOrThrowNotFound } from '@common/utils/find-or-throw-not-found';
import { t } from '@i18n/index';
import Currencies from '@models/currencies.model';
import PortfolioTransfers from '@models/investments/portfolio-transfers.model';
import Portfolios from '@models/investments/portfolios.model';
import { EMPTY_LOGO_FIELDS, serializeLogoFields } from '@root/serializers/logo-fields.serializer';

interface GetTransactionPortfolioLinkParams {
  userId: number;
  transactionId: string;
}

export const getTransactionPortfolioLink = async ({ userId, transactionId }: GetTransactionPortfolioLinkParams) => {
  const transfer = await findOrThrowNotFound({
    query: PortfolioTransfers.findOne({
      where: { transactionId, userId },
      include: [
        // paranoid:false so the link surfaces even when the linked portfolio
        // has been soft-deleted (trash). The FE shows a "Deleted portfolio"
        // badge based on `isPortfolioDeleted` below.
        { model: Portfolios, as: 'fromPortfolio', paranoid: false },
        { model: Portfolios, as: 'toPortfolio', paranoid: false },
        { model: Currencies, as: 'currency' },
      ],
    }),
    message: t({ key: 'investments.portfolioTransferNotFound' }),
  });

  // fromAccountId + toPortfolioId = deposit (money flows from account to portfolio)
  // fromPortfolioId + toAccountId = withdrawal (money flows from portfolio to account)
  const isDeposit = transfer.fromAccountId !== null && transfer.toPortfolioId !== null;
  const portfolioId = isDeposit ? transfer.toPortfolioId! : transfer.fromPortfolioId!;
  const portfolio = isDeposit ? transfer.toPortfolio : transfer.fromPortfolio;

  // A null portfolio means the FK row no longer exists at all (hard-deleted
  // outside the trash window, or DB corruption). Surface that as "deleted"
  // too so the FE renders the badge instead of a blank active label.
  const isPortfolioDeleted = portfolio == null || portfolio.deletedAt != null;

  return {
    transferId: transfer.id,
    portfolioId,
    portfolioName: portfolio?.name ?? '',
    isPortfolioDeleted,
    ...serializeLogoFields({ entity: portfolio ?? EMPTY_LOGO_FIELDS }),
    transferType: isDeposit ? ('deposit' as const) : ('withdrawal' as const),
    amount: transfer.amount.toJSON(),
    currencyCode: transfer.currencyCode,
    date: transfer.date,
    affectsCash: transfer.affectsCash,
  };
};

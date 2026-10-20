import Accounts from '@models/accounts.model';
import { countTransactions } from '@models/transactions-query';
import { getBaseCurrency } from '@models/users-currencies.model';

import { PreviewError } from './preview-helpers';
import type { PreviewResolver } from './types';

/**
 * A user with no base currency gets one at once. A user who has one starts a background change that
 * revalues every account and transaction and blocks other edits until it ends, so the card counts
 * what it revalues and the typed phrase is that count.
 */
export const resolveChangeBaseCurrency: PreviewResolver = async ({ userId, args }) => {
  const current = (await getBaseCurrency({ userId }))?.currencyCode ?? null;

  if (current === null) return { preview: { before: { baseCurrencyCode: null } }, snapshot: {} };

  if (current === args.newCurrencyCode) {
    throw new PreviewError({
      messageKey: 'chat.cards.sameBaseCurrency',
      message: `${current} is already the base currency`,
    });
  }

  const [accountCount, transactionCount] = await Promise.all([
    Accounts.count({ where: { userId } }),
    countTransactions({ planned: 'include', access: { creator: userId }, balanceAdjustments: 'include' }),
  ]);

  return {
    preview: {
      before: { baseCurrencyCode: current },
      counts: { accountCount, transactionCount },
    },
    snapshot: {},
    affectedCount: accountCount + transactionCount,
    warnings: [{ key: 'chat.warnings.baseCurrencyBlocksEdits' }],
  };
};

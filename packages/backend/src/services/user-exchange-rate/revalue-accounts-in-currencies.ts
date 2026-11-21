import Accounts from '@models/accounts.model';
import { getBaseCurrency } from '@models/users-currencies.model';
import { isRevaluedAccount, scheduleBalanceRevalue } from '@services/balances/revalue-balance-history.service';
import { loadDependencyEdges } from '@services/currencies/load-dependency-edges';

/**
 * The edited codes plus the user's custom currencies valued through one of them: pegged to it, or
 * quoting it in a stored rate. A custom currency is worth its peg factor or stored rate times that
 * ISO currency's rate into the base, so editing that rate moves the custom currency too.
 */
const withDependentCustomCurrencies = async ({
  userId,
  currencyCodes,
}: {
  userId: number;
  currencyCodes: string[];
}): Promise<string[]> => {
  const edited = new Set(currencyCodes);
  const dependents = (await loadDependencyEdges({ userId }))
    .filter((edge) => edited.has(edge.source))
    .map((edge) => edge.dependent);

  return [...new Set([...currencyCodes, ...dependents])];
};

/**
 * A manual rate for `X → base` prices every past day of an account held in X, so a
 * rate edit or removal moves the whole stored history, not only the spot balances
 * `remeasureRefBalances` re-anchors. The same goes for an account in a custom currency whose
 * quote's rate was edited.
 */
export const revalueAccountsInCurrencies = async ({
  userId,
  pairs,
}: {
  userId: number;
  pairs: { baseCode: string; quoteCode: string }[];
}): Promise<void> => {
  const editedCodes = [...new Set(pairs.flatMap((pair) => [pair.baseCode, pair.quoteCode]))];
  if (!editedCodes.length) return;

  const currencyCodes = await withDependentCustomCurrencies({ userId, currencyCodes: editedCodes });

  const baseCurrency = await getBaseCurrency({ userId });
  if (!baseCurrency) return;

  const accounts = await Accounts.findAll({ where: { userId, currencyCode: currencyCodes } });

  for (const account of accounts) {
    if (!isRevaluedAccount({ account, baseCurrencyCode: baseCurrency.currencyCode })) continue;

    await scheduleBalanceRevalue({ accountId: account.id });
  }
};

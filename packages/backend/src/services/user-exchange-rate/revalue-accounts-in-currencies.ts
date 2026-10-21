import Accounts from '@models/accounts.model';
import { getBaseCurrency } from '@models/users-currencies.model';
import { isRevaluedAccount, scheduleBalanceRevalue } from '@services/balances/revalue-balance-history.service';
import { loadDependencyEdges } from '@services/currencies/load-dependency-edges';
import { expandScope } from '@services/currencies/recompute-scope';

/**
 * The edited codes plus every custom currency the user prices through one of them, however many
 * steps away: a currency pegged to an edited code, or one whose stored quote is an edited code. A
 * custom currency is worth its peg or stored quote times the ISO rate of that currency into the
 * base, so editing that rate moves the custom currency's value as well.
 */
const withDependentCustomCurrencies = async ({
  userId,
  currencyCodes,
}: {
  userId: number;
  currencyCodes: string[];
}): Promise<string[]> => {
  const seeds = new Map(currencyCodes.map((code) => [code, [{ from: null, to: null, mode: 'recompute' as const }]]));
  const reached = expandScope({ scope: seeds, edges: await loadDependencyEdges({ userId }) });

  return [...reached.keys()];
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

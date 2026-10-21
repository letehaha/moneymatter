import Accounts from '@models/accounts.model';
import UserExchangeRates from '@models/user-exchange-rates.model';
import { getBaseCurrency } from '@models/users-currencies.model';
import { isRevaluedAccount, scheduleBalanceRevalue } from '@services/balances/revalue-balance-history.service';
import { findCustomCurrencyCodes } from '@services/currencies/custom-currency-codes';

/**
 * The edited codes plus every custom currency the user prices through one of them, however many
 * custom steps away. A custom currency is worth its stored quote times the ISO rate of that quote
 * into the base, so editing the quote's rate moves the custom currency's value as well.
 */
const withDependentCustomCurrencies = async ({
  userId,
  currencyCodes,
}: {
  userId: number;
  currencyCodes: string[];
}): Promise<string[]> => {
  const covered = new Set(currencyCodes);
  let frontier = currencyCodes;

  while (frontier.length) {
    const rows = await UserExchangeRates.findAll({
      where: { userId, quoteCode: frontier },
      attributes: ['baseCode'],
      raw: true,
    });
    const customCodes = await findCustomCurrencyCodes({ codes: rows.map((row) => row.baseCode) });

    frontier = [...customCodes].filter((code) => !covered.has(code));
    frontier.forEach((code) => covered.add(code));
  }

  return [...covered];
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

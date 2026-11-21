import Accounts from '@models/accounts.model';
import UserExchangeRates from '@models/user-exchange-rates.model';
import { getBaseCurrency } from '@models/users-currencies.model';
import { isRevaluedAccount, scheduleBalanceRevalue } from '@services/balances/revalue-balance-history.service';
import { findCustomCurrencyCodes } from '@services/currencies/custom-currency-codes';

/**
 * The edited codes plus the user's custom currencies quoted in one of them: a custom currency is worth
 * its stored rate times its ISO quote's rate into the base, so editing the quote moves it too.
 */
const withDependentCustomCurrencies = async ({
  userId,
  currencyCodes,
}: {
  userId: number;
  currencyCodes: string[];
}): Promise<string[]> => {
  const rows = await UserExchangeRates.findAll({
    where: { userId, quoteCode: currencyCodes },
    attributes: ['baseCode'],
    raw: true,
  });
  const customCodes = await findCustomCurrencyCodes({ codes: rows.map((row) => row.baseCode) });

  return [...new Set([...currencyCodes, ...customCodes])];
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

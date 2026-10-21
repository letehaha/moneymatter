import type { CurrencyMeta } from '@bt/shared/types';
import Accounts from '@models/accounts.model';
import Currencies from '@models/currencies.model';
import UsersCurrencies from '@models/users-currencies.model';
import { Op } from 'sequelize';

/** A currency as one user sees it: the global row with that user's overrides applied. */
export interface EffectiveCurrency extends CurrencyMeta {
  code: string;
  name: string;
}

interface OverrideFields {
  nameOverride: string | null;
  symbolOverride: string | null;
  decimalsOverride: number | null;
}

/**
 * The global row with the user's overrides on top; a `null` override keeps the global value, except
 * for the symbol of a row that carries its decimals (see below). Only custom currencies carry
 * overrides, so an ISO row ignores them.
 */
export const applyCurrencyOverrides = ({
  currency,
  overrides,
}: {
  currency: Pick<Currencies, 'code' | 'currency' | 'digits' | 'symbol' | 'isCustom'>;
  overrides: OverrideFields | null | undefined;
}): EffectiveCurrency => {
  const applied = currency.isCustom ? overrides : null;
  // A row that carries its decimals holds the user's complete definition, so its empty symbol means
  // "no symbol" rather than "take the symbol of whoever created the global row".
  const isDefined = applied != null && applied.decimalsOverride != null;

  return {
    code: currency.code,
    name: applied?.nameOverride ?? currency.currency,
    decimals: applied?.decimalsOverride ?? currency.digits,
    symbol: isDefined ? applied.symbolOverride : (applied?.symbolOverride ?? currency.symbol),
    isCustom: currency.isCustom,
  };
};

/**
 * A `UsersCurrencies` row with its joined `Currencies` row, the custom currency's name, symbol and
 * decimals replaced by the user's own. Rows of ISO currencies come back untouched.
 */
export const withEffectiveCurrency = <
  TItem extends OverrideFields & {
    currency?: Pick<Currencies, 'code' | 'currency' | 'digits' | 'symbol' | 'isCustom'>;
  },
>({
  item,
}: {
  item: TItem;
}): TItem => {
  if (!item.currency?.isCustom) return item;

  const effective = applyCurrencyOverrides({ currency: item.currency, overrides: item });

  return {
    ...item,
    currency: { ...item.currency, currency: effective.name, digits: effective.decimals, symbol: effective.symbol },
  };
};

interface CurrencyOwnerPair {
  /** User whose definition of the code applies. */
  ownerUserId: number;
  code: string;
}

const buildCurrencyPairKey = ({ ownerUserId, code }: CurrencyOwnerPair) => `${ownerUserId}:${code}`;

/**
 * Effective currencies for `(owner, code)` pairs, keyed by `buildCurrencyPairKey`. ISO currencies
 * ignore the owner. A custom code takes the owner's overrides, and falls back to the global row
 * when the owner holds no `UsersCurrencies` row for it.
 */
const getEffectiveCurrencies = async ({
  pairs,
}: {
  pairs: readonly CurrencyOwnerPair[];
}): Promise<Map<string, EffectiveCurrency>> => {
  const result = new Map<string, EffectiveCurrency>();
  if (!pairs.length) return result;

  const codes = [...new Set(pairs.map((pair) => pair.code))];
  const rows = await Currencies.findAll({ where: { code: { [Op.in]: codes } } });
  const rowByCode = new Map(rows.map((row) => [row.code, row]));

  const customCodes = rows.filter((row) => row.isCustom).map((row) => row.code);
  const overrideByPair = new Map<string, OverrideFields>();

  if (customCodes.length) {
    const ownerIds = [...new Set(pairs.map((pair) => pair.ownerUserId))];
    const overrides = await UsersCurrencies.findAll({
      where: { userId: { [Op.in]: ownerIds }, currencyCode: { [Op.in]: customCodes } },
      attributes: ['userId', 'currencyCode', 'nameOverride', 'symbolOverride', 'decimalsOverride'],
    });
    overrides.forEach((row) =>
      overrideByPair.set(buildCurrencyPairKey({ ownerUserId: row.userId, code: row.currencyCode }), row),
    );
  }

  for (const pair of pairs) {
    const currency = rowByCode.get(pair.code);
    if (!currency) continue;

    result.set(
      buildCurrencyPairKey(pair),
      applyCurrencyOverrides({ currency, overrides: overrideByPair.get(buildCurrencyPairKey(pair)) }),
    );
  }

  return result;
};

const toMeta = ({ decimals, symbol, isCustom }: EffectiveCurrency): CurrencyMeta => ({ decimals, symbol, isCustom });

/**
 * Stamps `currencyMeta` on serialized-to-be accounts: the decimals, symbol and kind of the account
 * currency under its owner's definition. The serializer picks the property up when it is present.
 */
export const attachAccountCurrencyMeta = async <TAccount extends { userId: number; currencyCode: string }>({
  accounts,
}: {
  accounts: readonly TAccount[];
}): Promise<void> => {
  const effective = await getEffectiveCurrencies({
    pairs: accounts.map((account) => ({ ownerUserId: account.userId, code: account.currencyCode })),
  });

  for (const account of accounts) {
    const currency = effective.get(buildCurrencyPairKey({ ownerUserId: account.userId, code: account.currencyCode }));
    if (currency) Object.assign(account, { currencyMeta: toMeta(currency) });
  }
};

/**
 * Stamps `currencyMeta` on transactions: the account currency's decimals, symbol and kind under the
 * definition of the account's OWNER, which governs every native amount on the account whoever
 * entered it. Owners are only looked up when a custom currency is involved; an ISO currency means
 * the same to everyone.
 */
export const attachTransactionCurrencyMeta = async <TTransaction extends { accountId: string; currencyCode: string }>({
  transactions: candidates,
}: {
  /** Absent entries (the optional second leg of a create or update result) are skipped. */
  transactions: readonly (TTransaction | null | undefined)[];
}): Promise<void> => {
  const transactions = candidates.filter((tx): tx is TTransaction => tx !== null && tx !== undefined);
  if (!transactions.length) return;

  const codes = [...new Set(transactions.map((tx) => tx.currencyCode))];
  const rows = await Currencies.findAll({ where: { code: { [Op.in]: codes } } });
  const hasCustom = rows.some((row) => row.isCustom);

  const ownerByAccountId = new Map<string, number>();
  if (hasCustom) {
    const accountIds = [...new Set(transactions.map((tx) => tx.accountId))];
    const accounts = await Accounts.findAll({
      where: { id: { [Op.in]: accountIds } },
      attributes: ['id', 'userId'],
    });
    accounts.forEach((account) => ownerByAccountId.set(account.id, account.userId));
  }

  const effective = await getEffectiveCurrencies({
    pairs: transactions.map((tx) => ({ ownerUserId: ownerByAccountId.get(tx.accountId) ?? 0, code: tx.currencyCode })),
  });

  for (const tx of transactions) {
    const currency = effective.get(
      buildCurrencyPairKey({ ownerUserId: ownerByAccountId.get(tx.accountId) ?? 0, code: tx.currencyCode }),
    );
    if (currency) Object.assign(tx, { currencyMeta: toMeta(currency) });
  }
};

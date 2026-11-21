import type { CurrencyMeta } from '@bt/shared/types';
import { UnexpectedError } from '@js/errors';
import Accounts from '@models/accounts.model';
import Currencies from '@models/currencies.model';
import UsersCurrencies from '@models/users-currencies.model';
import { Op } from 'sequelize';

import { includesCustomCurrencyCode } from './custom-currency-codes';

/** A currency as one user sees it: the global row with that user's overrides applied. */
interface EffectiveCurrency extends CurrencyMeta {
  code: string;
  name: string;
}

interface OverrideFields {
  nameOverride: string | null;
  symbolOverride: string | null;
  decimalsOverride: number | null;
}

type CurrencyRow = Pick<Currencies, 'code' | 'currency' | 'digits' | 'isCustom'>;

const hasDefinition = (
  overrides: OverrideFields | null | undefined,
): overrides is OverrideFields & { nameOverride: string; decimalsOverride: number } =>
  overrides?.nameOverride != null && overrides.decimalsOverride != null;

/**
 * An ISO currency as its global row describes it, or a custom currency as the user's
 * `UsersCurrencies` row defines it. The global row of a custom code is a stub, so a custom code
 * without the user's definition throws.
 */
export const applyCurrencyOverrides = ({
  currency,
  overrides,
}: {
  currency: CurrencyRow;
  overrides: OverrideFields | null | undefined;
}): EffectiveCurrency => {
  if (!currency.isCustom) {
    return { code: currency.code, name: currency.currency, decimals: currency.digits, symbol: null, isCustom: false };
  }

  if (!hasDefinition(overrides)) {
    throw new UnexpectedError({ message: `Custom currency ${currency.code} has no definition for this user` });
  }

  return {
    code: currency.code,
    name: overrides.nameOverride,
    decimals: overrides.decimalsOverride,
    symbol: overrides.symbolOverride,
    isCustom: true,
  };
};

/** A `UsersCurrencies` row with its joined `Currencies` row replaced by the effective currency. */
export const withEffectiveCurrency = <TItem extends OverrideFields & { currency?: CurrencyRow }>({
  item,
}: {
  item: TItem;
}): TItem => {
  if (!item.currency) return item;

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
 * ignore the owner. A custom code takes the owner's definition and is left out when the owner has none.
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
    const overrides = overrideByPair.get(buildCurrencyPairKey(pair));
    if (!currency || (currency.isCustom && !hasDefinition(overrides))) continue;

    result.set(buildCurrencyPairKey(pair), applyCurrencyOverrides({ currency, overrides }));
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

  const ownerByAccountId = new Map<string, number>();
  if (await includesCustomCurrencyCode({ codes: transactions.map((tx) => tx.currencyCode) })) {
    const accountIds = [...new Set(transactions.map((tx) => tx.accountId))];
    const accounts = await Accounts.findAll({
      where: { id: { [Op.in]: accountIds } },
      attributes: ['id', 'userId'],
    });
    accounts.forEach((account) => ownerByAccountId.set(account.id, account.userId));
  }

  // ISO pairs ignore the owner, so `-1` only marks a transaction whose account was not found.
  const pairOf = ({ tx }: { tx: TTransaction }) => ({
    ownerUserId: ownerByAccountId.get(tx.accountId) ?? -1,
    code: tx.currencyCode,
  });
  const effective = await getEffectiveCurrencies({ pairs: transactions.map((tx) => pairOf({ tx })) });

  for (const tx of transactions) {
    const currency = effective.get(buildCurrencyPairKey(pairOf({ tx })));
    if (currency) Object.assign(tx, { currencyMeta: toMeta(currency) });
  }
};

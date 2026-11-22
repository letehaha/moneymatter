import { getCurrencyDecimals } from '@common/lib/currency-precision';
import { Money } from '@common/types/money';
import { UnexpectedError } from '@js/errors';
import Accounts from '@models/accounts.model';

/**
 * Decimals of each account's own currency, keyed by account id. An import rounds a row amount to
 * these before it is written, tallied or compared with a stored amount.
 */
export async function getAccountDecimals({
  accountIds,
}: {
  accountIds: Iterable<string>;
}): Promise<Map<string, number>> {
  const decimalsByAccountId = new Map<string, number>();
  const ids = [...new Set(accountIds)];

  if (ids.length === 0) return decimalsByAccountId;

  const accounts = await Accounts.findAll({ where: { id: ids }, attributes: ['id', 'userId', 'currencyCode'] });

  await Promise.all(
    accounts.map(async (account) => {
      decimalsByAccountId.set(
        account.id,
        await getCurrencyDecimals({ userId: account.userId, code: account.currencyCode }),
      );
    }),
  );

  return decimalsByAccountId;
}

/** One account's decimals from a `getAccountDecimals` map. An account the map lacks is a bug, never 2 decimals. */
export function decimalsOfAccount({
  decimalsByAccountId,
  accountId,
}: {
  decimalsByAccountId: Map<string, number>;
  accountId: string;
}): number {
  const decimals = decimalsByAccountId.get(accountId);

  if (decimals === undefined) {
    throw new UnexpectedError({ message: `No currency decimals were loaded for account ${accountId}` });
  }

  return decimals;
}

/** `amount` rounded half-up to its account currency's decimals. */
export function roundToAccountDecimals({
  decimalsByAccountId,
  accountId,
  amount,
}: {
  decimalsByAccountId: Map<string, number>;
  accountId: string;
  amount: number | string;
}): Money {
  return Money.fromDecimal(amount).round(decimalsOfAccount({ decimalsByAccountId, accountId }));
}

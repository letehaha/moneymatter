import { getCurrencyDecimals } from '@common/lib/currency-precision';
import Accounts from '@models/accounts.model';

/**
 * Decimals of each account's own currency, keyed by account id. An import rounds a row amount to
 * these before it is written, tallied or compared with a stored amount. The account owner's id
 * governs a custom code's decimals, so the lookup does not depend on who runs the import.
 */
export async function getAccountDecimals({ accountIds }: { accountIds: string[] }): Promise<Map<string, number>> {
  const decimalsByAccountId = new Map<string, number>();

  if (accountIds.length === 0) return decimalsByAccountId;

  const accounts = await Accounts.findAll({ where: { id: accountIds }, attributes: ['id', 'userId', 'currencyCode'] });

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

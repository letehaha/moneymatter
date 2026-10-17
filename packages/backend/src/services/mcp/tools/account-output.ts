import { t } from '@i18n/index';
import type Accounts from '@models/accounts.model';
import { serializeAccount } from '@root/serializers/accounts.serializer';
import { attachAccountCurrencyMeta } from '@services/currencies/effective-currency';
import { slimAccountDetailForMcp } from '@services/mcp/serializers';

/** The REST account serialization (currency precision attached) slimmed for an assistant. */
export async function presentAccount({
  account,
}: {
  account: Parameters<typeof serializeAccount>[0] | null | undefined;
}) {
  if (!account) throw new Error(t({ key: 'accounts.accountNotFound' }));

  await attachAccountCurrencyMeta({ accounts: [account as Accounts] });
  return slimAccountDetailForMcp(serializeAccount(account));
}

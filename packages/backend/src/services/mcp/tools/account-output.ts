import { t } from '@i18n/index';
import { serializeAccount } from '@root/serializers/accounts.serializer';
import { slimAccountDetailForMcp } from '@services/mcp/serializers';

/** The REST account serialization slimmed for an assistant. */
export function presentAccount({ account }: { account: Parameters<typeof serializeAccount>[0] | null | undefined }) {
  if (!account) throw new Error(t({ key: 'accounts.accountNotFound' }));

  return slimAccountDetailForMcp(serializeAccount(account));
}

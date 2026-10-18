import type AccountGroup from '@models/accounts-groups/account-groups.model';
import { serializeAccountGroups } from '@root/serializers/account-groups.serializer';
import { slimAccountGroupForMcp } from '@services/mcp/serializers';

/** The REST group serialization, slimmed to the group's own fields (a write result loads no accounts or children). */
export function presentAccountGroup({ group }: { group: AccountGroup }) {
  const [serialized] = serializeAccountGroups([group]);
  return slimAccountGroupForMcp(serialized!);
}

import { PayeeAliasModel, PayeeModel, PayeeStats, RecordId } from '@bt/shared/types';
import Payees from '@models/payees.model';
import { serializeLogoFields } from '@root/serializers/logo-fields.serializer';
import type { PayeeStatsRow } from '@services/payees/payee-stats';

export function serializePayee(payee: Payees): PayeeModel {
  return {
    id: payee.id,
    userId: payee.userId,
    name: payee.name,
    normalizedName: payee.normalizedName,
    defaultCategoryId: payee.defaultCategoryId,
    categorizationMode: payee.categorizationMode,
    ...serializeLogoFields({ entity: payee }),
    logoSource: payee.logoSource,
    defaultTagIds: (payee.defaultTags ?? []).map((tag) => tag.id),
    defaultLocation: payee.defaultLocation ?? null,
    createdAt: payee.createdAt,
    updatedAt: payee.updatedAt,
    aliases: payee.aliases?.map(
      (alias): PayeeAliasModel => ({
        id: alias.id,
        payeeId: alias.payeeId,
        rawName: alias.rawName,
        normalizedName: alias.normalizedName,
        isCanonical: alias.normalizedName === payee.normalizedName,
        createdAt: alias.createdAt,
      }),
    ),
  };
}

function serializeStats(stats: PayeeStatsRow): PayeeStats {
  return {
    payeeId: stats.payeeId as RecordId,
    transactionCount: stats.transactionCount,
    netFlowRef: stats.netFlowRef.toNumber(),
    firstSeenAt: stats.firstSeenAt,
    lastSeenAt: stats.lastSeenAt,
    topCategoryId: stats.topCategoryId as RecordId | null,
  };
}

export function serializePayeeWithStats({
  payee,
  stats,
}: {
  payee: Payees;
  stats: PayeeStatsRow | null;
}): PayeeModel & { stats: PayeeStats | null } {
  return {
    ...serializePayee(payee),
    stats: stats ? serializeStats(stats) : null,
  };
}

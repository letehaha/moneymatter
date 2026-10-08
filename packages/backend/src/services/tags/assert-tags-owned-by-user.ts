import { t } from '@i18n/index';
import { ValidationError } from '@js/errors';
import Tags from '@models/tags.model';

/** Throws unless every tag belongs to the user. Returns the ids deduped, safe for a join-table write. */
export async function assertTagsOwnedByUser<T extends string>({
  userId,
  tagIds,
}: {
  userId: number;
  tagIds: T[];
}): Promise<T[]> {
  const uniqueTagIds = [...new Set(tagIds)];
  if (uniqueTagIds.length === 0) return uniqueTagIds;
  const ownedCount = await Tags.count({ where: { id: uniqueTagIds, userId } });
  if (ownedCount !== uniqueTagIds.length) {
    throw new ValidationError({ message: t({ key: 'payees.defaultTagsNotOwned' }) });
  }
  return uniqueTagIds;
}

import type Payees from '@models/payees.model';

/**
 * A payee as an assistant needs it after a write: its own fields, the default tags as ids and the
 * aliases when the row carries them. The user id, the normalized name and the logo bookkeeping stay out.
 */
export function presentPayee({ payee }: { payee: Payees }) {
  return {
    id: payee.id,
    name: payee.name,
    defaultCategoryId: payee.defaultCategoryId,
    categorizationMode: payee.categorizationMode,
    defaultTagIds: (payee.defaultTags ?? []).map((tag) => tag.id),
    defaultLocation: payee.defaultLocation ?? null,
    logoDomain: payee.logoDomain,
    logoInitials: payee.logoInitials,
    logoColor: payee.logoColor,
    ...(payee.aliases
      ? {
          aliases: payee.aliases.map((alias) => ({
            id: alias.id,
            rawName: alias.rawName,
            normalizedName: alias.normalizedName,
          })),
        }
      : {}),
  };
}

/** One ignored name as REST serializes it. */
export function presentIgnoredName({
  row,
}: {
  row: { id: string; normalizedName: string; rawSample: string | null; createdAt: Date };
}) {
  return {
    id: row.id,
    normalizedName: row.normalizedName,
    rawSample: row.rawSample,
    createdAt: row.createdAt.toISOString(),
  };
}

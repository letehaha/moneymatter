/**
 * Replaces UUIDs with `<prefix><n>` aliases numbered in input order, and translates
 * the model's answer back. A UUID costs ~20 tokens and gives the model something
 * UUID-shaped to invent; an alias it never saw simply resolves to nothing.
 */
export const createShortIds = ({ ids, prefix }: { ids: string[]; prefix: string }) => {
  const idByAlias = new Map(ids.map((id, index) => [`${prefix}${index + 1}`, id]));
  const aliasById = new Map([...idByAlias].map(([alias, id]) => [id, alias]));

  return {
    idByAlias,
    aliasOf: ({ id }: { id: string }): string | undefined => aliasById.get(id),
    /** Unknown aliases are dropped. */
    resolve: ({ aliases }: { aliases: string[] }): string[] => aliases.flatMap((alias) => idByAlias.get(alias) ?? []),
  };
};

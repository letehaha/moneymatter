import type { TagMappingConfig } from '@bt/shared/types';
import { t } from '@i18n/index';
import Tags from '@models/tags.model';
import { createTag } from '@services/tags/create-tag';
import { Op } from 'sequelize';

import { resolveOrCreateByName } from './resolve-or-create-by-name';

interface CreateTagsIfNeededParams {
  userId: number;
  tagMapping: TagMappingConfig;
}

interface CreateTagsIfNeededResult {
  /**
   * Resolved tag id per distinct source tag string. Only contains entries whose
   * mapping yields a usable tag — `skip` mappings are omitted. Many source
   * strings may resolve to the same id (many-to-one is intentional).
   */
  tagNameToId: Map<string, string>;
  /** Number of tags actually inserted. Reused/linked tags don't count. */
  tagsCreated: number;
}

/**
 * Resolve each distinct source tag string in `tagMapping` to a tag id, creating
 * tags where the user chose `create-new`.
 *
 * - `link-existing`: verify the tag id belongs to the user, then map to it.
 * - `create-new`: find-or-create by name, case-insensitively. When the user
 *   already owns a tag with the same name (any casing) the source string links
 *   to that tag instead of inserting a duplicate, and it isn't counted as
 *   created. Only a genuine insert increments `tagsCreated`.
 * - `skip`: dropped before resolution — the source string is absent from the
 *   result map.
 */
export async function createTagsIfNeeded({
  userId,
  tagMapping,
}: CreateTagsIfNeededParams): Promise<CreateTagsIfNeededResult> {
  // `skip` is dropped here rather than inside the shared resolver: it's a
  // tag-only action, so the resolver never sees those source strings and they
  // stay absent from the result map.
  const mapping: Record<string, { action: 'link-existing'; id: string } | { action: 'create-new' }> = {};
  for (const [sourceName, entry] of Object.entries(tagMapping)) {
    if (entry.action === 'skip') {
      continue;
    }
    mapping[sourceName] =
      entry.action === 'link-existing' ? { action: 'link-existing', id: entry.tagId } : { action: 'create-new' };
  }

  const { nameToId, created } = await resolveOrCreateByName({
    userId,
    mapping,
    findOne: (args) => Tags.findOne(args),
    create: ({ userId: ownerId, name, color }) => createTag({ userId: ownerId, name, color }),
    notFoundMessage: (id) => t({ key: 'importExport.tagIdNotFound', variables: { id } }),
  });

  return { tagNameToId: nameToId, tagsCreated: created };
}

interface CreateNamedTagsIfNeededParams {
  userId: number;
  /**
   * The exact tags an importer wants to exist, each with its desired colour for
   * the create case. Duplicate names within the list collapse to one tag (the
   * first colour wins). Names are matched against the user's existing tags
   * case-insensitively, but a fresh insert uses the verbatim `name`.
   */
  tags: { name: string; color: string }[];
}

interface CreateNamedTagsIfNeededResult {
  /**
   * Resolved tag id per input tag name (verbatim key, matching the `name` the
   * caller passed in). Every requested name is present.
   */
  tagIdByName: Map<string, string>;
  /** Number of tags actually inserted. Reused tags don't count. */
  tagsCreated: number;
}

/**
 * Find-or-create a known list of named, colored tags for `userId`, returning an
 * id per requested name. Unlike {@link createTagsIfNeeded} there is no
 * source-string mapping or per-name action: the caller already knows the exact
 * tag names it wants (e.g. Wallet's verbatim labels, YNAB's flag-derived names)
 * and just needs them to exist.
 *
 * Existing tags are reused case-insensitively (so "Food" satisfies a request for
 * "food"); a tag is only inserted when nothing matches, and only genuine inserts
 * increment `tagsCreated`. The existing-tag lookup is a single batched
 * `Tags.findAll`, mirroring the per-importer inline loops this replaces.
 *
 * Fail-fast: a failing `createTag` propagates. Callers must NOT expect partial
 * success or a swallowed-error list.
 */
export async function createNamedTagsIfNeeded({
  userId,
  tags,
}: CreateNamedTagsIfNeededParams): Promise<CreateNamedTagsIfNeededResult> {
  const tagIdByName = new Map<string, string>();
  let tagsCreated = 0;

  // Collapse duplicate names (first colour wins) so the same tag is requested
  // at most once. Preserves insertion order for a stable create sequence.
  const colorByName = new Map<string, string>();
  for (const tag of tags) {
    if (!colorByName.has(tag.name)) colorByName.set(tag.name, tag.color);
  }

  const requestedNames = Array.from(colorByName.keys());
  if (requestedNames.length === 0) {
    return { tagIdByName, tagsCreated };
  }

  // Batched existing-tag lookup. Match case-insensitively by indexing the
  // user's tags whose lowercased name equals a requested lowercased name; the
  // first stored row wins when the user owns several casings of the same name.
  const requestedLowerSet = new Set(requestedNames.map((name) => name.toLowerCase()));
  const existingTags = await Tags.findAll({ where: { userId, name: { [Op.in]: requestedNames } } });
  const existingIdByLowerName = new Map<string, string>();
  for (const tag of existingTags) {
    const lower = tag.name.toLowerCase();
    if (requestedLowerSet.has(lower) && !existingIdByLowerName.has(lower)) {
      existingIdByLowerName.set(lower, tag.id);
    }
  }

  for (const [name, color] of colorByName) {
    const existingId = existingIdByLowerName.get(name.toLowerCase());
    if (existingId) {
      tagIdByName.set(name, existingId);
      continue;
    }
    const created = await createTag({ userId, name, color });
    tagIdByName.set(name, created.id);
    // Cache the insert so a later requested name differing only in casing reuses
    // it instead of attempting a duplicate insert.
    existingIdByLowerName.set(name.toLowerCase(), created.id);
    tagsCreated += 1;
  }

  return { tagIdByName, tagsCreated };
}

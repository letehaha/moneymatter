import type { TagMappingConfig } from '@bt/shared/types';
import { generateRandomRecordId } from '@common/lib/record-id-helpers';
import { i18nextReady, t } from '@i18n/index';
import { afterEach, beforeAll, beforeEach, describe, expect, it, jest } from '@jest/globals';
import { Op } from 'sequelize';

// ── Mocks (hoisted before importing the module under test) ──────────────────

// Stub Tags.findOne — drives both the create-new case-insensitive lookup and
// the link-existing ownership check. Each test queues the rows it wants back.
const findOne = jest.fn<(args: unknown) => Promise<{ id: string; name: string } | null>>();
jest.mock('@models/tags.model', () => ({
  __esModule: true,
  default: {
    findOne: (args: unknown) => findOne(args),
  },
}));

// Stub the create-tag service — records every create so tests assert which
// names were actually created (vs. linked to a pre-existing tag).
const createTag = jest.fn<(args: { userId: number; name: string; color: string }) => Promise<{ id: string }>>();
jest.mock('@services/tags/create-tag', () => ({
  __esModule: true,
  createTag: (args: { userId: number; name: string; color: string }) => createTag(args),
}));

// eslint-disable-next-line import/first
import { createTagsIfNeeded } from './create-tags-if-needed';

const USER_ID = 1;

beforeAll(async () => {
  await i18nextReady;
});

beforeEach(() => {
  findOne.mockReset();
  createTag.mockReset();
  // Default: no existing tag by name; each create returns a fresh id.
  findOne.mockResolvedValue(null);
  createTag.mockImplementation(async () => ({ id: generateRandomRecordId() }));
});

afterEach(() => {
  jest.clearAllMocks();
});

describe('createTagsIfNeeded', () => {
  it('links an existing tag for a link-existing mapping without creating', async () => {
    const tagId = generateRandomRecordId();
    findOne.mockResolvedValueOnce({ id: tagId, name: 'Food' });

    const tagMapping: TagMappingConfig = { Food: { action: 'link-existing', tagId } };

    const { tagNameToId, tagsCreated } = await createTagsIfNeeded({ userId: USER_ID, tagMapping });

    expect(tagNameToId.get('Food')).toBe(tagId);
    expect(tagsCreated).toBe(0);
    expect(createTag).not.toHaveBeenCalled();
  });

  it('throws a ValidationError when a link-existing tag is not owned by the user', async () => {
    const tagId = generateRandomRecordId();
    findOne.mockResolvedValueOnce(null); // ownership check: miss

    const tagMapping: TagMappingConfig = { Food: { action: 'link-existing', tagId } };

    await expect(createTagsIfNeeded({ userId: USER_ID, tagMapping })).rejects.toThrow(
      t({ key: 'importExport.tagIdNotFound', variables: { id: tagId }, locale: 'en' }),
    );
    expect(createTag).not.toHaveBeenCalled();
  });

  it('creates a tag for a create-new mapping when no same-named tag exists', async () => {
    const createdId = generateRandomRecordId();
    findOne.mockResolvedValueOnce(null); // case-insensitive lookup: miss
    createTag.mockResolvedValueOnce({ id: createdId });

    const tagMapping: TagMappingConfig = { Travel: { action: 'create-new' } };

    const { tagNameToId, tagsCreated } = await createTagsIfNeeded({ userId: USER_ID, tagMapping });

    expect(tagNameToId.get('Travel')).toBe(createdId);
    expect(tagsCreated).toBe(1);
    expect(createTag).toHaveBeenCalledTimes(1);
    expect(createTag).toHaveBeenCalledWith(expect.objectContaining({ userId: USER_ID, name: 'Travel' }));
  });

  it('links to an existing tag (case-insensitive) for create-new instead of duplicating', async () => {
    const existingId = generateRandomRecordId();
    // Source string "food" but the user already owns "Food".
    findOne.mockResolvedValueOnce({ id: existingId, name: 'Food' });

    const tagMapping: TagMappingConfig = { food: { action: 'create-new' } };

    const { tagNameToId, tagsCreated } = await createTagsIfNeeded({ userId: USER_ID, tagMapping });

    expect(tagNameToId.get('food')).toBe(existingId);
    expect(tagsCreated).toBe(0);
    expect(createTag).not.toHaveBeenCalled();
  });

  it('omits skip mappings from the resolved map', async () => {
    const tagMapping: TagMappingConfig = { Junk: { action: 'skip' } };

    const { tagNameToId, tagsCreated } = await createTagsIfNeeded({ userId: USER_ID, tagMapping });

    expect(tagNameToId.has('Junk')).toBe(false);
    expect(tagsCreated).toBe(0);
    expect(createTag).not.toHaveBeenCalled();
  });

  it('resolves a mixed mapping: counts only newly created tags', async () => {
    const linkedId = generateRandomRecordId();
    const reusedId = generateRandomRecordId();
    const createdId = generateRandomRecordId();

    // Route each findOne by the where clause: an `id` lookup is the
    // link-existing ownership check; the create-new reuse check arrives as an
    // Op.and array holding one sequelize `where(fn('lower', col('name')), value)`
    // clause whose `.logic` is the lowercased source string. It hits only for
    // "food".
    findOne.mockImplementation(async (args) => {
      const where = (args as { where: Record<string | symbol, unknown> }).where;
      if ('id' in where) return { id: linkedId, name: 'Linked' };
      const andClauses = where[Op.and] as Array<{ logic: string }> | undefined;
      const wanted = andClauses?.[0]?.logic;
      if (wanted === 'food') return { id: reusedId, name: 'Food' };
      return null;
    });
    createTag.mockResolvedValueOnce({ id: createdId });

    const tagMapping: TagMappingConfig = {
      Linked: { action: 'link-existing', tagId: linkedId },
      food: { action: 'create-new' }, // reuses existing "Food"
      Brandnew: { action: 'create-new' }, // actually created
      Dropme: { action: 'skip' },
    };

    const { tagNameToId, tagsCreated } = await createTagsIfNeeded({ userId: USER_ID, tagMapping });

    expect(tagNameToId.get('Linked')).toBe(linkedId);
    expect(tagNameToId.get('food')).toBe(reusedId);
    expect(tagNameToId.get('Brandnew')).toBe(createdId);
    expect(tagNameToId.has('Dropme')).toBe(false);
    expect(tagsCreated).toBe(1);
  });
});

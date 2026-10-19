import type { CategoryMappingConfig } from '@bt/shared/types';
import { generateRandomRecordId } from '@common/lib/record-id-helpers';
import { i18nextReady, t } from '@i18n/index';
import { afterEach, beforeAll, beforeEach, describe, expect, it, jest } from '@jest/globals';
import { Op } from 'sequelize';

// ── Mocks (hoisted before importing the module under test) ──────────────────

// Stub Categories.findOne — drives both the create-new case-insensitive lookup
// and the link-existing ownership check. Each test queues the rows it wants back.
const findOne = jest.fn<(args: unknown) => Promise<{ id: string; name: string } | null>>();
// Stub Categories.create — records every insert so tests assert which names were
// actually created (vs. linked/reused from a pre-existing category).
const create =
  jest.fn<(args: { userId: number; name: string; color: string; type: string }) => Promise<{ id: string }>>();
jest.mock('@models/categories.model', () => ({
  __esModule: true,
  default: {
    findOne: (args: unknown) => findOne(args),
    create: (args: { userId: number; name: string; color: string; type: string }) => create(args),
  },
}));

// eslint-disable-next-line import/first
import { createCategoriesIfNeeded } from './create-categories-if-needed';

const USER_ID = 1;

beforeAll(async () => {
  await i18nextReady;
});

beforeEach(() => {
  findOne.mockReset();
  create.mockReset();
  // Default: no existing category by name; each insert returns a fresh id.
  findOne.mockResolvedValue(null);
  create.mockImplementation(async () => ({ id: generateRandomRecordId() }));
});

afterEach(() => {
  jest.clearAllMocks();
});

describe('createCategoriesIfNeeded', () => {
  it('links an existing category for a link-existing mapping without creating', async () => {
    const categoryId = generateRandomRecordId();
    findOne.mockResolvedValueOnce({ id: categoryId, name: 'Food' });

    const categoryMapping: CategoryMappingConfig = { Food: { action: 'link-existing', categoryId } };

    const { categoryNameToId, categoriesCreated } = await createCategoriesIfNeeded({
      userId: USER_ID,
      categoryMapping,
    });

    expect(categoryNameToId.get('Food')).toBe(categoryId);
    expect(categoriesCreated).toBe(0);
    expect(create).not.toHaveBeenCalled();
  });

  it('throws a ValidationError when a link-existing category is not owned by the user', async () => {
    const categoryId = generateRandomRecordId();
    findOne.mockResolvedValueOnce(null); // ownership check: miss

    const categoryMapping: CategoryMappingConfig = { Food: { action: 'link-existing', categoryId } };

    await expect(createCategoriesIfNeeded({ userId: USER_ID, categoryMapping })).rejects.toThrow(
      t({ key: 'importExport.categoryIdNotFound', variables: { id: categoryId }, locale: 'en' }),
    );
    expect(create).not.toHaveBeenCalled();
  });

  it('creates a category for a create-new mapping when no same-named category exists', async () => {
    const createdId = generateRandomRecordId();
    findOne.mockResolvedValueOnce(null); // case-insensitive lookup: miss
    create.mockResolvedValueOnce({ id: createdId });

    const categoryMapping: CategoryMappingConfig = { Travel: { action: 'create-new' } };

    const { categoryNameToId, categoriesCreated } = await createCategoriesIfNeeded({
      userId: USER_ID,
      categoryMapping,
    });

    expect(categoryNameToId.get('Travel')).toBe(createdId);
    expect(categoriesCreated).toBe(1);
    expect(create).toHaveBeenCalledTimes(1);
    expect(create).toHaveBeenCalledWith(expect.objectContaining({ userId: USER_ID, name: 'Travel' }));
  });

  it('reuses an existing category (case-insensitive) for create-new instead of duplicating', async () => {
    const existingId = generateRandomRecordId();
    // Source string "food" but the user already owns "Food".
    findOne.mockResolvedValueOnce({ id: existingId, name: 'Food' });

    const categoryMapping: CategoryMappingConfig = { food: { action: 'create-new' } };

    const { categoryNameToId, categoriesCreated } = await createCategoriesIfNeeded({
      userId: USER_ID,
      categoryMapping,
    });

    expect(categoryNameToId.get('food')).toBe(existingId);
    expect(categoriesCreated).toBe(0);
    expect(create).not.toHaveBeenCalled();
  });

  it('builds the create-new reuse lookup with lower(name), not Op.iLike', async () => {
    // Regression guard: the reuse lookup must compare the source as a literal via
    // where(fn('lower', col('name')), value), never Op.iLike — `%`/`_` in a CSV
    // source value would otherwise act as ILIKE wildcards.
    findOne.mockResolvedValueOnce(null);
    create.mockResolvedValueOnce({ id: generateRandomRecordId() });

    const categoryMapping: CategoryMappingConfig = { Travel: { action: 'create-new' } };

    await createCategoriesIfNeeded({ userId: USER_ID, categoryMapping });

    const reuseCall = findOne.mock.calls.find(([args]) => {
      const where = (args as { where: Record<string | symbol, unknown> }).where;
      return Op.and in where;
    });
    expect(reuseCall).toBeDefined();
    const where = (reuseCall![0] as { where: Record<string | symbol, unknown> }).where;
    expect(Op.iLike in where).toBe(false);
    const andClauses = where[Op.and] as Array<{ logic: string }>;
    // Sequelize where(fn('lower', col('name')), value) stores the comparison
    // value on `.logic` — here the lowercased source string.
    expect(andClauses[0]?.logic).toBe('travel');
  });

  it('resolves a mixed mapping: counts only newly created categories', async () => {
    const linkedId = generateRandomRecordId();
    const reusedId = generateRandomRecordId();
    const createdId = generateRandomRecordId();

    // Route each findOne by the where clause: an `id` lookup is the link-existing
    // ownership check; the create-new reuse check arrives as an Op.and array
    // holding one sequelize where(fn('lower', col('name')), value) clause whose
    // `.logic` is the lowercased source string. It hits only for "food".
    findOne.mockImplementation(async (args) => {
      const where = (args as { where: Record<string | symbol, unknown> }).where;
      if ('id' in where) return { id: linkedId, name: 'Linked' };
      const andClauses = where[Op.and] as Array<{ logic: string }> | undefined;
      const wanted = andClauses?.[0]?.logic;
      if (wanted === 'food') return { id: reusedId, name: 'Food' };
      return null;
    });
    create.mockResolvedValueOnce({ id: createdId });

    const categoryMapping: CategoryMappingConfig = {
      Linked: { action: 'link-existing', categoryId: linkedId },
      food: { action: 'create-new' }, // reuses existing "Food"
      Brandnew: { action: 'create-new' }, // actually created
    };

    const { categoryNameToId, categoriesCreated } = await createCategoriesIfNeeded({
      userId: USER_ID,
      categoryMapping,
    });

    expect(categoryNameToId.get('Linked')).toBe(linkedId);
    expect(categoryNameToId.get('food')).toBe(reusedId);
    expect(categoryNameToId.get('Brandnew')).toBe(createdId);
    expect(categoriesCreated).toBe(1);
    expect(create).toHaveBeenCalledTimes(1);
  });
});

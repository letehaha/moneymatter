import { CATEGORY_TYPES, CategoryModel } from '@bt/shared/types';
import { NONEXISTENT_ID } from '@common/lib/record-id-helpers';
import { beforeEach, describe, expect, it } from '@jest/globals';
import { ERROR_CODES } from '@js/errors';
import * as helpers from '@tests/helpers';

const CATEGORY_NAME = 'test-1';
const CATEGORY_COLOR = '#FF0000';

const mockedCategory = {
  name: 'test-category',
  color: '#FF0000',
  icon: 'food-20-filled',
};
const updatedCategory = {
  name: 'updated-test-category',
  color: '#00FF00',
  icon: 'shopping-bag-20-filled',
};

describe('Create custom categories and subcategories', () => {
  let rootCategories: CategoryModel[] = [];

  beforeEach(async () => {
    rootCategories = await helpers.getCategoriesList();
  });

  it('should successfully create a custom categories', async () => {
    const parent = rootCategories[0];
    await helpers.addCustomCategory({
      parentId: parent!.id,
      name: CATEGORY_NAME,
    });
    const newCategory = (await helpers.getCategoriesList()).find((i) => i.name === CATEGORY_NAME);

    expect(newCategory!.parentId).toBe(parent!.id);
  });

  it('should successfully create a custom category with color when no parentId', async () => {
    await helpers.addCustomCategory({
      name: CATEGORY_NAME,
      color: CATEGORY_COLOR,
    });
    const newCategory = (await helpers.getCategoriesList()).find((i) => i.name === CATEGORY_NAME);

    expect(newCategory!.color).toBe(CATEGORY_COLOR);
  });

  it('should allow creating duplicate categories', async () => {
    const parent = rootCategories[0];
    await helpers.addCustomCategory({
      parentId: parent!.id,
      name: CATEGORY_NAME,
    });
    await helpers.addCustomCategory({
      parentId: parent!.id,
      name: CATEGORY_NAME,
    });

    const newCategories = await helpers.getCategoriesList();

    expect(newCategories.filter((i) => i.name === CATEGORY_NAME).length).toBe(2);
  });

  it('should return validation error when no color is provided without a parentId, when no name is provided without a parentId, and when no data is provided at all', async () => {
    const noColor = await helpers.addCustomCategory({
      name: CATEGORY_NAME,
      raw: false,
    });
    const noName = await helpers.addCustomCategory({
      color: CATEGORY_COLOR,
      raw: false,
    });
    const noData = await helpers.addCustomCategory({ raw: false });

    expect(noColor.statusCode).toEqual(ERROR_CODES.ValidationError);
    expect(noName.statusCode).toEqual(ERROR_CODES.ValidationError);
    expect(noData.statusCode).toEqual(ERROR_CODES.ValidationError);
  });

  it('should not allow creating category with non-existent parent', async () => {
    const res = await helpers.addCustomCategory({ parentId: NONEXISTENT_ID, raw: false });

    expect(res.statusCode).toEqual(ERROR_CODES.ValidationError);
  });

  it('should not allow creating a category deeper than 3 levels', async () => {
    const child = await helpers.addCustomCategory({
      parentId: rootCategories[0]!.id,
      name: 'child',
      raw: true,
    });
    const grandChild = await helpers.addCustomCategory({
      parentId: child.id,
      name: 'grand-child',
      raw: true,
    });

    const res = await helpers.addCustomCategory({
      parentId: grandChild.id,
      name: CATEGORY_NAME,
      raw: false,
    });

    expect(res.statusCode).toEqual(ERROR_CODES.ValidationError);
  });

  it('should not allow creating a category under a system category', async () => {
    const internal = rootCategories.find((i) => i.type === CATEGORY_TYPES.internal);

    const res = await helpers.addCustomCategory({
      parentId: internal!.id,
      name: CATEGORY_NAME,
      raw: false,
    });

    expect(res.statusCode).toEqual(ERROR_CODES.ValidationError);
  });

  it('should use parent color if not provided for subcategory', async () => {
    const parent = rootCategories[0];
    const newCategory = await helpers.addCustomCategory({
      parentId: parent!.id,
      name: CATEGORY_NAME,
      raw: true,
    });

    expect(newCategory.color).toEqual(parent!.color);
  });
});

describe('Edit custom categories', () => {
  let testCategory: CategoryModel;

  beforeEach(async () => {
    testCategory = await helpers.addCustomCategory({
      name: mockedCategory.name,
      color: mockedCategory.color,
      raw: true,
    });
  });

  it('should successfully edit a category with all fields', async () => {
    const [category] = await helpers.editCustomCategory({
      categoryId: testCategory.id,
      ...updatedCategory,
      raw: true,
    });

    expect(category!.name).toBe(updatedCategory.name);
    expect(category!.color).toBe(updatedCategory.color);
    expect(category!.icon).toBe(updatedCategory.icon);
  });

  it('should successfully edit a sub-category with all fields', async () => {
    const parent = (await helpers.getCategoriesList())[0];

    const subCategory = await helpers.addCustomCategory({
      parentId: parent!.id,
      name: mockedCategory.name,
      color: mockedCategory.color,
      raw: true,
    });
    const [category] = await helpers.editCustomCategory({
      categoryId: subCategory.id,
      ...updatedCategory,
      raw: true,
    });

    expect(category!.name).toBe(updatedCategory.name);
    expect(category!.color).toBe(updatedCategory.color);
    expect(category!.icon).toBe(updatedCategory.icon);
  });

  it('should successfully edit a category with only the name and then only the color, leaving the untouched field intact each time', async () => {
    const [afterNameEdit] = await helpers.editCustomCategory({
      categoryId: testCategory.id,
      name: updatedCategory.name,
      raw: true,
    });

    expect(afterNameEdit!.name).toBe(updatedCategory.name);
    expect(afterNameEdit!.color).toBe(mockedCategory.color);

    const [afterColorEdit] = await helpers.editCustomCategory({
      categoryId: testCategory.id,
      color: updatedCategory.color,
      raw: true,
    });

    expect(afterColorEdit!.color).toBe(updatedCategory.color);
    expect(afterColorEdit!.name).toBe(updatedCategory.name);
  });

  it('should return validation error when no fields are provided, for an invalid color, for a name exceeding 200 characters, and for an icon exceeding 50 characters', async () => {
    const noFields = await helpers.editCustomCategory({
      categoryId: testCategory.id,
      raw: false,
    });
    const invalidColor = await helpers.editCustomCategory({
      categoryId: testCategory.id,
      color: 'invalid-color',
      raw: false,
    });
    const longName = await helpers.editCustomCategory({
      categoryId: testCategory.id,
      name: 'a'.repeat(201),
      raw: false,
    });
    const longIcon = await helpers.editCustomCategory({
      categoryId: testCategory.id,
      icon: 'a'.repeat(51),
      raw: false,
    });

    expect(noFields.statusCode).toBe(ERROR_CODES.ValidationError);
    expect(invalidColor.statusCode).toEqual(ERROR_CODES.ValidationError);
    expect(longName.statusCode).toEqual(ERROR_CODES.ValidationError);
    expect(longIcon.statusCode).toEqual(ERROR_CODES.ValidationError);
  });

  it('should return not found error for non-existent category', async () => {
    const res = await helpers.editCustomCategory({
      categoryId: NONEXISTENT_ID,
      name: updatedCategory.name,
      raw: false,
    });

    expect(res.statusCode).toEqual(ERROR_CODES.NotFoundError);
  });

  describe('Re-parenting', () => {
    it('should move a root category under another root category', async () => {
      const newParent = await helpers.addCustomCategory({
        name: 'new-parent',
        color: mockedCategory.color,
        raw: true,
      });

      const [category] = await helpers.editCustomCategory({
        categoryId: testCategory.id,
        parentId: newParent.id,
        raw: true,
      });

      expect(category!.parentId).toBe(newParent.id);

      const stored = (await helpers.getCategoriesList()).find((i) => i.id === testCategory.id);
      expect(stored!.parentId).toBe(newParent.id);
    });

    it('should move a nested category to the top level when parentId is null', async () => {
      const child = await helpers.addCustomCategory({
        parentId: testCategory.id,
        name: 'child',
        raw: true,
      });

      const [category] = await helpers.editCustomCategory({
        categoryId: child.id,
        parentId: null,
        raw: true,
      });

      expect(category!.parentId).toBe(null);

      const stored = (await helpers.getCategoriesList()).find((i) => i.id === child.id);
      expect(stored!.parentId).toBe(null);
    });

    it('should allow moving a category with a child under a root (subtree lands exactly on the limit)', async () => {
      const newParent = await helpers.addCustomCategory({
        name: 'new-parent',
        color: mockedCategory.color,
        raw: true,
      });
      await helpers.addCustomCategory({
        parentId: testCategory.id,
        name: 'child',
        raw: true,
      });

      const [category] = await helpers.editCustomCategory({
        categoryId: testCategory.id,
        parentId: newParent.id,
        raw: true,
      });

      expect(category!.parentId).toBe(newParent.id);
    });

    it('should return validation error when moving a system category', async () => {
      const internal = (await helpers.getCategoriesList()).find((i) => i.type === CATEGORY_TYPES.internal);

      const res = await helpers.editCustomCategory({
        categoryId: internal!.id,
        parentId: testCategory.id,
        raw: false,
      });

      expect(res.statusCode).toEqual(ERROR_CODES.ValidationError);
    });

    it('should return validation error when using a system category as a parent', async () => {
      const internal = (await helpers.getCategoriesList()).find((i) => i.type === CATEGORY_TYPES.internal);

      const res = await helpers.editCustomCategory({
        categoryId: testCategory.id,
        parentId: internal!.id,
        raw: false,
      });

      expect(res.statusCode).toEqual(ERROR_CODES.ValidationError);
    });

    it('should allow a move that lands exactly on the third level', async () => {
      const grandParent = await helpers.addCustomCategory({
        name: 'grand-parent',
        color: mockedCategory.color,
        raw: true,
      });
      const parent = await helpers.addCustomCategory({
        parentId: grandParent.id,
        name: 'parent',
        raw: true,
      });

      const [category] = await helpers.editCustomCategory({
        categoryId: testCategory.id,
        parentId: parent.id,
        raw: true,
      });

      expect(category!.parentId).toBe(parent.id);
    });

    it('should return validation error for a non-existent parentId', async () => {
      const res = await helpers.editCustomCategory({
        categoryId: testCategory.id,
        parentId: NONEXISTENT_ID,
        raw: false,
      });

      expect(res.statusCode).toEqual(ERROR_CODES.ValidationError);
    });

    it('should return validation error when moving a category under its own descendant or under itself', async () => {
      const child = await helpers.addCustomCategory({
        parentId: testCategory.id,
        name: 'child',
        raw: true,
      });

      const underDescendant = await helpers.editCustomCategory({
        categoryId: testCategory.id,
        parentId: child.id,
        raw: false,
      });
      const underItself = await helpers.editCustomCategory({
        categoryId: testCategory.id,
        parentId: testCategory.id,
        raw: false,
      });

      expect(underDescendant.statusCode).toEqual(ERROR_CODES.ValidationError);
      expect(underItself.statusCode).toEqual(ERROR_CODES.ValidationError);
    });

    it('should return validation error when the move would exceed 3 nesting levels', async () => {
      const grandParent = await helpers.addCustomCategory({
        name: 'grand-parent',
        color: mockedCategory.color,
        raw: true,
      });
      const parent = await helpers.addCustomCategory({
        parentId: grandParent.id,
        name: 'parent',
        raw: true,
      });
      await helpers.addCustomCategory({
        parentId: testCategory.id,
        name: 'child',
        raw: true,
      });

      const res = await helpers.editCustomCategory({
        categoryId: testCategory.id,
        parentId: parent.id,
        raw: false,
      });

      expect(res.statusCode).toEqual(ERROR_CODES.ValidationError);
    });
  });
});

describe('Delete custom categories', () => {
  let rootCategory: CategoryModel;
  let subCategory: CategoryModel;

  beforeEach(async () => {
    rootCategory = await helpers.addCustomCategory({
      name: 'Root Category',
      color: '#FF0000',
      raw: true,
    });
    subCategory = await helpers.addCustomCategory({
      name: 'Sub Category',
      parentId: rootCategory.id,
      raw: true,
    });
  });

  it('should successfully delete a category without subcategories or transactions', async () => {
    const customRootCategory = await helpers.addCustomCategory({
      name: 'Root Category',
      color: '#FF0000',
      raw: true,
    });
    const res = await helpers.deleteCustomCategory({
      categoryId: customRootCategory.id,
      raw: false,
    });

    expect(res.status).toBe(200);

    const categories = await helpers.getCategoriesList();
    expect(categories.find((c) => c.id === customRootCategory.id)).toBeUndefined();
  });

  it('should successfully delete a sub-category without subcategories or transactions', async () => {
    const res = await helpers.deleteCustomCategory({
      categoryId: subCategory.id,
      raw: false,
    });

    expect(res.status).toBe(200);

    const categories = await helpers.getCategoriesList();
    expect(categories.find((c) => c.id === subCategory.id)).toBeUndefined();
  });

  it('should return validation error when trying to delete a category with subcategories', async () => {
    const res = await helpers.deleteCustomCategory({
      categoryId: rootCategory.id,
      raw: false,
    });

    expect(res.statusCode).toEqual(ERROR_CODES.ValidationError);
  });

  it('should return validation error when trying to delete a category with linked transactions', async () => {
    const categoryWithTransaction = await helpers.addCustomCategory({
      name: 'Category with Transaction',
      raw: true,
    });
    const account = await helpers.createAccount({ raw: true });
    const txPayload = helpers.buildTransactionPayload({
      accountId: account.id,
      categoryId: categoryWithTransaction.id,
      amount: 100,
    });
    await helpers.createTransaction({
      payload: txPayload,
    });

    const res = await helpers.deleteCustomCategory({
      categoryId: categoryWithTransaction.id,
      raw: false,
    });

    expect(res.statusCode).toEqual(ERROR_CODES.ValidationError);
  });

  it('should return validation error when trying to delete the user default category, with or without a replacement', async () => {
    const { defaultCategoryId } = await helpers.getUserInfo({ raw: true });

    const withoutReplacement = await helpers.deleteCustomCategory({ categoryId: defaultCategoryId, raw: false });
    const withReplacement = await helpers.deleteCustomCategory({
      categoryId: defaultCategoryId,
      replaceWithCategoryId: rootCategory.id,
      raw: false,
    });

    expect(withoutReplacement.statusCode).toEqual(ERROR_CODES.ValidationError);
    expect(withReplacement.statusCode).toEqual(ERROR_CODES.ValidationError);

    const categories = await helpers.getCategoriesList();
    expect(categories.find((c) => c.id === defaultCategoryId)).toBeDefined();
    expect((await helpers.getUserInfo({ raw: true })).defaultCategoryId).toBe(defaultCategoryId);
  });

  it('should return not found error for a non-existent category and validation error for an invalid category id', async () => {
    const nonExistent = await helpers.deleteCustomCategory({
      categoryId: NONEXISTENT_ID,
      raw: false,
    });
    const invalidId = await helpers.deleteCustomCategory({
      categoryId: 'invalid-category-id',
      raw: false,
    });

    expect(nonExistent.statusCode).toEqual(ERROR_CODES.NotFoundError);
    expect(invalidId.statusCode).toEqual(ERROR_CODES.ValidationError);
  });
});

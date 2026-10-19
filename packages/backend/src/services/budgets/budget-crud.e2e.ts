import { BUDGET_STATUSES, BUDGET_TYPES, SHARE_PERMISSIONS, TRANSACTION_TYPES } from '@bt/shared/types';
import { NONEXISTENT_ID } from '@common/lib/record-id-helpers';
import { describe, expect, it } from '@jest/globals';
import { ERROR_CODES } from '@js/errors';
import {
  OVERSIZED_PNG_DATA_URL,
  PNG_1X1_BYTES,
  PNG_1X1_DATA_URL,
  TEXT_AS_PNG_DATA_URL,
  WEBP_1X1_BYTES,
  WEBP_1X1_DATA_URL,
} from '@tests/fixtures/logo-images';
import * as helpers from '@tests/helpers';
import { addDays, subDays } from 'date-fns';
import { randomUUID } from 'node:crypto';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

const createImageTracker = () =>
  helpers.createCustomBudget({ name: 'Image Tracker', logoImage: PNG_1X1_DATA_URL, raw: true });

describe('Budget CRUD', () => {
  const baseBudgetMockData = {
    name: 'Original Budget',
    startDate: subDays(new Date(), 1).toISOString(),
    endDate: new Date().toISOString(),
    autoInclude: false,
    limitAmount: 1000,
  };

  describe('Create', () => {
    const budgetName = 'Test Budget';

    it('successfully creates a budget', async () => {
      const budget = await helpers.createCustomBudget({
        name: budgetName,
        startDate: '2025-03-01T00:00:00Z',
        endDate: '2025-03-31T23:59:59Z',
        autoInclude: false,
        limitAmount: 1000,
        raw: true,
      });

      const response = await helpers.getCustomBudgets({ raw: true });
      expect(response.length).toBeGreaterThanOrEqual(1);
      expect(!!response.find((i) => i.name === budgetName)).toBe(true);

      const budgetById = await helpers.getCustomBudgetById({ id: budget.id, raw: true });
      expect(budgetById?.name).toBe(budgetName);
    });

    it('can create budgets with the same name', async () => {
      await helpers.createCustomBudget({
        name: budgetName,
        startDate: '2025-03-01T00:00:00Z',
        endDate: '2025-03-31T23:59:59Z',
        raw: true,
      });

      await helpers.createCustomBudget({
        name: budgetName,
        startDate: '2025-04-01T00:00:00Z',
        endDate: '2025-04-30T23:59:59Z',
        raw: true,
      });

      const response = await helpers.getCustomBudgets({ raw: true });
      expect(response.length).toBeGreaterThanOrEqual(2);
      expect(response.filter((i) => i.name === budgetName).length).toBeGreaterThanOrEqual(2);
    });

    it('autoInclude links only real transactions from the covered date range', async () => {
      const account = await helpers.createAccount({ raw: true });

      const [realTx] = await helpers.createTransaction({
        payload: helpers.buildTransactionPayload({
          accountId: account.id,
          amount: 100,
          transactionType: TRANSACTION_TYPES.expense,
          time: '2025-03-02T10:00:00Z',
        }),
        raw: true,
      });

      const [plannedTx] = await helpers.createPlannedTransaction({
        payload: {
          accountId: account.id,
          amount: 250,
          transactionType: TRANSACTION_TYPES.expense,
          time: '2025-03-03T10:00:00Z',
        },
        raw: true,
      });

      const budget = await helpers.createCustomBudget({
        name: 'Auto-include Planned Budget',
        startDate: '2025-03-01T00:00:00Z',
        endDate: '2025-03-04T23:59:59Z',
        autoInclude: true,
        limitAmount: 500,
        raw: true,
      });

      const linked = await helpers.getTransactions({ budgetIds: [budget.id], limit: 30, raw: true });
      const linkedIds = linked.map((tx) => tx.id);

      expect(linkedIds).toEqual([realTx.id]);
      expect(linkedIds).not.toContain(plannedTx.id);

      const stats = (await helpers.getStats({ id: budget.id, raw: true }))!;

      expect(stats.summary.actualExpense).toBe(100);
      expect(stats.summary.actualIncome).toBe(0);
      expect(stats.summary.balance).toBe(-100);
      expect(stats.summary.transactionsCount).toBe(1);
      expect(stats.summary.utilizationRate).toBeCloseTo((100 / 500) * 100, 1);
    });

    it('fails validation when start date is later than end date', async () => {
      const response = await helpers.createCustomBudget({
        name: 'Inverted Range Budget',
        startDate: '2025-03-31T23:59:59Z',
        endDate: '2025-03-01T00:00:00Z',
        raw: false,
      });

      expect(response.statusCode).toEqual(ERROR_CODES.ValidationError);
    });

    it('creates a tracker with a monogram logo', async () => {
      const budget = await helpers.createCustomBudget({
        name: 'Monogram Tracker',
        logoInitials: 'TR',
        logoColor: '#112233',
        raw: true,
      });

      const expected = { logoDomain: null, logoInitials: 'TR', logoColor: '#112233' };
      expect(budget).toMatchObject(expected);
      const budgetById = await helpers.getCustomBudgetById({ id: budget.id, raw: true });
      expect(budgetById).toMatchObject(expected);
    });

    it('rejects a logo domain combined with monogram initials', async () => {
      const response = await helpers.createCustomBudget({
        name: 'Conflicting Logo',
        logoDomain: 'booking.com',
        logoInitials: 'TR',
        raw: false,
      });

      expect(response.statusCode).toEqual(ERROR_CODES.ValidationError);
    });

    it('rejects a logo color without initials', async () => {
      const response = await helpers.createCustomBudget({
        name: 'Color Only',
        logoColor: '#112233',
        raw: false,
      });

      expect(response.statusCode).toEqual(ERROR_CODES.ValidationError);
    });
  });

  describe('Edit', () => {
    it('returns error when budget is not found', async () => {
      const response = await helpers.editCustomBudget({
        id: NONEXISTENT_ID,
        params: { name: 'Some name' },
        raw: false,
      });

      expect(response.statusCode).toEqual(ERROR_CODES.NotFoundError);
    });

    it('applies partial updates and preserves untouched fields', async () => {
      const budget = await helpers.createCustomBudget({ ...baseBudgetMockData, raw: true });

      const newName = 'Updated Budget';
      const renamed = await helpers.editCustomBudget({
        id: budget.id,
        raw: true,
        params: { name: newName },
      });

      expect(renamed).toMatchObject({
        ...baseBudgetMockData,
        name: newName,
        id: budget.id,
      });
      const budgetById = await helpers.getCustomBudgetById({ id: budget.id, raw: true });
      expect(budgetById?.name).toBe(newName);

      const relimited = await helpers.editCustomBudget({
        id: budget.id,
        raw: true,
        params: { limitAmount: 5000 },
      });

      expect(relimited.limitAmount).toBe(5000);
      expect(relimited.name).toBe(newName);

      const autoIncluded = await helpers.editCustomBudget({
        id: budget.id,
        raw: true,
        params: { autoInclude: true },
      });

      expect(autoIncluded.autoInclude).toBe(true);

      const newStartDate = new Date().toISOString();
      const newEndDate = addDays(new Date(), 30).toISOString();
      const redated = await helpers.editCustomBudget({
        id: budget.id,
        raw: true,
        params: { startDate: newStartDate, endDate: newEndDate },
      });

      expect(redated.startDate).toBe(newStartDate);
      expect(redated.endDate).toBe(newEndDate);

      const allFieldsParams = {
        name: 'Completely Updated Budget',
        startDate: subDays(new Date(), 5).toISOString(),
        endDate: addDays(new Date(), 5).toISOString(),
        limitAmount: 2500,
        autoInclude: true,
      };
      const fullyUpdated = await helpers.editCustomBudget({
        id: budget.id,
        raw: true,
        params: allFieldsParams,
      });

      expect(fullyUpdated).toEqual(expect.objectContaining(allFieldsParams));
    }, 60_000);

    it('rejects invalid edit payloads', async () => {
      const budget = await helpers.createCustomBudget({ ...baseBudgetMockData, raw: true });

      const invalidPayloads = [
        { name: 'A'.repeat(201) },
        { limitAmount: -100 },
        { limitAmount: 0 },
        { startDate: 'not-a-date' },
        {
          startDate: addDays(new Date(), 30).toISOString(),
          endDate: new Date().toISOString(),
        },
      ];

      for (const params of invalidPayloads) {
        const response = await helpers.editCustomBudget({
          id: budget.id,
          params,
          raw: false,
        });
        expect(response.statusCode).toEqual(ERROR_CODES.ValidationError);
      }

      const budgetById = await helpers.getCustomBudgetById({ id: budget.id, raw: true });
      expect(budgetById?.limitAmount).toBe(baseBudgetMockData.limitAmount);
    }, 60_000);

    it('rejects a partial date edit that inverts the stored range', async () => {
      const budget = await helpers.createCustomBudget({
        ...baseBudgetMockData,
        startDate: '2025-03-10T00:00:00.000Z',
        endDate: '2025-03-31T00:00:00.000Z',
        raw: true,
      });

      const response = await helpers.editCustomBudget({
        id: budget.id,
        params: { endDate: '2025-03-01T00:00:00.000Z' },
        raw: false,
      });
      expect(response.statusCode).toEqual(ERROR_CODES.ValidationError);

      const budgetById = await helpers.getCustomBudgetById({ id: budget.id, raw: true });
      expect(budgetById).toMatchObject({
        startDate: '2025-03-10T00:00:00.000Z',
        endDate: '2025-03-31T00:00:00.000Z',
      });
    });

    it('persists archivePromptDismissed', async () => {
      const budget = await helpers.createCustomBudget({ ...baseBudgetMockData, raw: true });
      expect(budget.archivePromptDismissed).toBe(false);

      await helpers.editCustomBudget({ id: budget.id, params: { archivePromptDismissed: true }, raw: true });

      const budgetById = await helpers.getCustomBudgetById({ id: budget.id, raw: true });
      expect(budgetById?.archivePromptDismissed).toBe(true);
    });

    it('keeps autoInclude when the payload omits it', async () => {
      const budget = await helpers.createCustomBudget({ ...baseBudgetMockData, autoInclude: true, raw: true });

      const renamed = await helpers.editCustomBudget({ id: budget.id, params: { name: 'Renamed' }, raw: true });

      expect(renamed.autoInclude).toBe(true);
      const budgetById = await helpers.getCustomBudgetById({ id: budget.id, raw: true });
      expect(budgetById?.autoInclude).toBe(true);
    });

    it('clears the limit and the dates with null', async () => {
      const budget = await helpers.createCustomBudget({ ...baseBudgetMockData, raw: true });

      const cleared = await helpers.editCustomBudget({
        id: budget.id,
        params: { limitAmount: null, startDate: null, endDate: null },
        raw: true,
      });

      expect(cleared).toMatchObject({ limitAmount: null, startDate: null, endDate: null });
      const budgetById = await helpers.getCustomBudgetById({ id: budget.id, raw: true });
      expect(budgetById).toMatchObject({ limitAmount: null, startDate: null, endDate: null });
    });

    it('persists new start and end dates', async () => {
      const budget = await helpers.createCustomBudget({ ...baseBudgetMockData, raw: true });
      const startDate = '2025-06-01T00:00:00.000Z';
      const endDate = '2025-06-30T23:59:59.000Z';

      await helpers.editCustomBudget({ id: budget.id, params: { startDate, endDate }, raw: true });

      const [budgetById] = (await helpers.getCustomBudgets({ raw: true })).filter((b) => b.id === budget.id);
      expect(budgetById).toMatchObject({ startDate, endDate });
    });

    it('setting a logo domain clears the monogram', async () => {
      const budget = await helpers.createCustomBudget({
        name: 'Monogram Tracker',
        logoInitials: 'TR',
        logoColor: '#112233',
        raw: true,
      });

      await helpers.editCustomBudget({ id: budget.id, params: { logoDomain: 'booking.com' }, raw: true });

      const budgetById = await helpers.getCustomBudgetById({ id: budget.id, raw: true });
      expect(budgetById).toMatchObject({ logoDomain: 'booking.com', logoInitials: null, logoColor: null });
    });

    it('clearing the initials also clears the logo color', async () => {
      const budget = await helpers.createCustomBudget({
        name: 'Monogram Tracker',
        logoInitials: 'TR',
        logoColor: '#112233',
        raw: true,
      });

      await helpers.editCustomBudget({ id: budget.id, params: { logoInitials: null }, raw: true });

      const budgetById = await helpers.getCustomBudgetById({ id: budget.id, raw: true });
      expect(budgetById).toMatchObject({ logoDomain: null, logoInitials: null, logoColor: null });
    });

    it('recolors a monogram with a color-only update', async () => {
      const budget = await helpers.createCustomBudget({
        name: 'Monogram Tracker',
        logoInitials: 'TR',
        logoColor: '#112233',
        raw: true,
      });

      await helpers.editCustomBudget({ id: budget.id, params: { logoColor: '#445566' }, raw: true });

      const budgetById = await helpers.getCustomBudgetById({ id: budget.id, raw: true });
      expect(budgetById).toMatchObject({ logoDomain: null, logoInitials: 'TR', logoColor: '#445566' });
    });

    it('keeps the logo when other fields change', async () => {
      const budget = await helpers.createCustomBudget({
        name: 'Monogram Tracker',
        logoInitials: 'TR',
        logoColor: '#112233',
        raw: true,
      });

      await helpers.editCustomBudget({ id: budget.id, params: { name: 'Renamed' }, raw: true });

      const budgetById = await helpers.getCustomBudgetById({ id: budget.id, raw: true });
      expect(budgetById).toMatchObject({
        name: 'Renamed',
        logoDomain: null,
        logoInitials: 'TR',
        logoColor: '#112233',
      });
    });

    it('rejects a color-only update on a tracker without initials', async () => {
      const budget = await helpers.createCustomBudget({ ...baseBudgetMockData, raw: true });

      const response = await helpers.editCustomBudget({
        id: budget.id,
        params: { logoColor: '#112233' },
        raw: false,
      });
      expect(response.statusCode).toEqual(ERROR_CODES.ValidationError);

      const budgetById = await helpers.getCustomBudgetById({ id: budget.id, raw: true });
      expect(budgetById).toMatchObject({ logoDomain: null, logoInitials: null, logoColor: null });
    });
  });

  describe('Delete', () => {
    it('successfully deletes a budget without transactions', async () => {
      const budget = await helpers.createCustomBudget({
        name: 'Test Budget',
        startDate: '2025-03-01T00:00:00Z',
        endDate: '2025-03-31T23:59:59Z',
        autoInclude: false,
        limitAmount: 1000,
        raw: true,
      });

      const deleteResponse = await helpers.deleteCustomBudget({
        id: budget.id,
        raw: true,
      });
      expect(deleteResponse.success).toBe(true);

      const budgetByIdResponse = await helpers.getCustomBudgetById({ id: budget.id, raw: false });
      expect(budgetByIdResponse.statusCode).toBe(ERROR_CODES.NotFoundError);

      const budgets = await helpers.getCustomBudgets({ raw: true });
      expect(budgets.find((b) => b.id === budget.id)).toBeUndefined();
    });

    it('successfully deletes a budget with transactions when autoInclude is true', async () => {
      const account = await helpers.createAccount({ raw: true });

      const transactions = await Promise.all([
        helpers.createTransaction({
          payload: helpers.buildTransactionPayload({
            accountId: account.id,
            amount: 100,
            transactionType: TRANSACTION_TYPES.expense,
            time: '2025-03-02T10:00:00Z',
            categoryId: global.DEFAULT_CATEGORY_ID,
          }),
          raw: true,
        }),
        helpers.createTransaction({
          payload: helpers.buildTransactionPayload({
            accountId: account.id,
            amount: 200,
            transactionType: TRANSACTION_TYPES.expense,
            time: '2025-03-03T10:00:00Z',
            categoryId: global.DEFAULT_CATEGORY_ID,
          }),
          raw: true,
        }),
      ]);

      const budget = await helpers.createCustomBudget({
        name: 'Budget With Transactions',
        startDate: '2025-03-01T00:00:00Z',
        endDate: '2025-03-04T23:59:59Z',
        autoInclude: true,
        limitAmount: 500,
        raw: true,
      });

      const budgetTransactionsBefore = await helpers.getTransactions({
        budgetIds: [budget.id],
        limit: 30,
        raw: true,
      });
      expect(budgetTransactionsBefore.length).toBe(2);
      const transactionIds = budgetTransactionsBefore.map((t) => t.id);
      expect(transactionIds).toContain(transactions[0][0].id);
      expect(transactionIds).toContain(transactions[1][0].id);

      const deleteResponse = await helpers.deleteCustomBudget({
        id: budget.id,
        raw: true,
      });
      expect(deleteResponse.success).toBe(true);

      const budgetByIdResponse = await helpers.getCustomBudgetById({ id: budget.id, raw: false });
      expect(budgetByIdResponse.statusCode).toBe(ERROR_CODES.NotFoundError);

      const budgetTransactionsAfter = await helpers.getTransactions({
        budgetIds: [budget.id],
        limit: 30,
        raw: true,
      });
      expect(budgetTransactionsAfter.length).toBe(0);
    });

    it('fails to delete a non-existent budget', async () => {
      const deleteResponse = await helpers.deleteCustomBudget({
        id: NONEXISTENT_ID,
        raw: false,
      });

      expect(deleteResponse.statusCode).toBe(200);
    });
  });

  describe('Archive', () => {
    it('archives, hides, filters and unarchives a budget', async () => {
      const budgetA = await helpers.createCustomBudget({
        name: 'Budget to archive',
        raw: true,
      });
      const budgetB = await helpers.createCustomBudget({
        name: 'Active budget',
        raw: true,
      });

      expect(budgetA.status).toBe(BUDGET_STATUSES.active);

      const archived = await helpers.archiveCustomBudget({
        id: budgetA.id,
        isArchived: true,
        raw: true,
      });
      expect(archived.status).toBe(BUDGET_STATUSES.archived);

      const defaultList = await helpers.getCustomBudgets({ raw: true });
      expect(defaultList.find((b) => b.id === budgetA.id)).toBeUndefined();
      expect(defaultList.find((b) => b.id === budgetB.id)).toBeDefined();

      const bothStatuses = await helpers.getCustomBudgets({
        status: 'active,archived',
        raw: true,
      });
      const foundInBoth = bothStatuses.find((b) => b.id === budgetA.id);
      expect(foundInBoth).toBeDefined();
      expect(foundInBoth!.status).toBe(BUDGET_STATUSES.archived);

      const archivedOnly = await helpers.getCustomBudgets({
        status: 'archived',
        raw: true,
      });
      expect(archivedOnly.find((b) => b.id === budgetA.id)).toBeDefined();
      expect(archivedOnly.find((b) => b.id === budgetB.id)).toBeUndefined();

      const unarchived = await helpers.archiveCustomBudget({
        id: budgetA.id,
        isArchived: false,
        raw: true,
      });
      expect(unarchived.status).toBe(BUDGET_STATUSES.active);
    }, 60_000);

    it("returns the tracker's lines in the archive toggle response", async () => {
      const category = await helpers.addCustomCategory({ name: 'Food', color: '#FF0000', raw: true });
      const budget = await helpers.createCustomBudget({ name: 'With lines', raw: true });
      const line = await helpers.createTrackerLine({
        budgetId: budget.id,
        payload: { name: 'Food', categoryIds: [category.id] },
        raw: true,
      });

      const archived = await helpers.archiveCustomBudget({ id: budget.id, isArchived: true, raw: true });

      expect(archived.lines!.map((l) => l.id)).toEqual([line.id]);
      expect(archived.lines![0]!.categories.map((c) => c.id)).toEqual([category.id]);
    });

    it('returns 404 when archiving a non-existent budget', async () => {
      const response = await helpers.archiveCustomBudget({
        id: NONEXISTENT_ID,
        isArchived: true,
        raw: false,
      });

      expect(response.statusCode).toBe(ERROR_CODES.NotFoundError);
    });
  });

  describe('Logo icon and image', () => {
    it('creates a tracker with a colored icon', async () => {
      const budget = await helpers.createCustomBudget({
        name: 'Icon Tracker',
        logoIcon: 'food-24-regular',
        logoColor: '#112233',
        raw: true,
      });

      const expected = {
        logoIcon: 'food-24-regular',
        logoColor: '#112233',
        logoDomain: null,
        logoInitials: null,
        logoImageId: null,
      };
      expect(budget).toMatchObject(expected);
      expect(await helpers.getCustomBudgetById({ id: budget.id, raw: true })).toMatchObject(expected);
    });

    it('rejects an image combined with an icon', async () => {
      const response = await helpers.createCustomBudget({
        name: 'Conflicting Logo',
        logoImage: PNG_1X1_DATA_URL,
        logoIcon: 'food-24-regular',
        raw: false,
      });

      expect(response.statusCode).toEqual(ERROR_CODES.ValidationError);
    });

    it('stores an uploaded image and serves it', async () => {
      const budget = await createImageTracker();

      expect(budget.logoImageId).toMatch(UUID_PATTERN);
      expect(budget).toMatchObject({ logoDomain: null, logoInitials: null, logoIcon: null, logoColor: null });

      const image = await helpers.getLogoImage({ id: budget.logoImageId! });
      expect(image.statusCode).toBe(200);
      expect(image.contentType).toBe('image/png');
      expect(image.cacheControl).toBe('private, max-age=31536000, immutable');
      expect(image.body.equals(PNG_1X1_BYTES)).toBe(true);
    });

    it('returns 404 for an unknown image id', async () => {
      const image = await helpers.getLogoImage({ id: randomUUID() });
      expect(image.statusCode).toBe(ERROR_CODES.NotFoundError);
    });

    it('returns 401 for an unauthenticated image request', async () => {
      const budget = await createImageTracker();

      const image = await helpers.withoutSession(() => helpers.getLogoImage({ id: budget.logoImageId! }));
      expect(image.statusCode).toBe(ERROR_CODES.Unauthorized);
    });

    it('replacing the image releases the old blob', async () => {
      const budget = await createImageTracker();
      const oldId = budget.logoImageId!;

      const edited = await helpers.editCustomBudget({
        id: budget.id,
        params: { logoImage: WEBP_1X1_DATA_URL },
        raw: true,
      });

      expect(edited.logoImageId).toMatch(UUID_PATTERN);
      expect(edited.logoImageId).not.toBe(oldId);
      expect((await helpers.getLogoImage({ id: oldId })).statusCode).toBe(ERROR_CODES.NotFoundError);

      const image = await helpers.getLogoImage({ id: edited.logoImageId! });
      expect(image.statusCode).toBe(200);
      expect(image.contentType).toBe('image/webp');
      expect(image.body.equals(WEBP_1X1_BYTES)).toBe(true);
    });

    it('setting initials on an image tracker clears the image', async () => {
      const budget = await createImageTracker();

      const edited = await helpers.editCustomBudget({ id: budget.id, params: { logoInitials: 'TR' }, raw: true });

      expect(edited).toMatchObject({ logoInitials: 'TR', logoImageId: null });
      expect((await helpers.getLogoImage({ id: budget.logoImageId! })).statusCode).toBe(ERROR_CODES.NotFoundError);
    });

    it('clears the image with null', async () => {
      const budget = await createImageTracker();

      const edited = await helpers.editCustomBudget({ id: budget.id, params: { logoImage: null }, raw: true });

      expect(edited.logoImageId).toBeNull();
      expect((await helpers.getLogoImage({ id: budget.logoImageId! })).statusCode).toBe(ERROR_CODES.NotFoundError);
    });

    it('setting a domain clears the icon', async () => {
      const budget = await helpers.createCustomBudget({ name: 'Icon Tracker', raw: true });

      const withIcon = await helpers.editCustomBudget({
        id: budget.id,
        params: { logoIcon: 'food-24-regular' },
        raw: true,
      });
      expect(withIcon.logoIcon).toBe('food-24-regular');

      const edited = await helpers.editCustomBudget({
        id: budget.id,
        params: { logoDomain: 'booking.com' },
        raw: true,
      });

      expect(edited).toMatchObject({ logoDomain: 'booking.com', logoIcon: null });
    });

    it('rejects an image over the size limit', async () => {
      const response = await helpers.createCustomBudget({
        name: 'Huge Image',
        logoImage: OVERSIZED_PNG_DATA_URL,
        raw: false,
      });

      expect(response.statusCode).toEqual(ERROR_CODES.ValidationError);
    });

    it('rejects a data URL whose bytes are not the declared image type', async () => {
      const response = await helpers.createCustomBudget({
        name: 'Fake Image',
        logoImage: TEXT_AS_PNG_DATA_URL,
        raw: false,
      });

      expect(response.statusCode).toEqual(ERROR_CODES.ValidationError);
    });

    it('recolors an icon with a color-only update', async () => {
      const budget = await helpers.createCustomBudget({
        name: 'Icon Tracker',
        logoIcon: 'food-24-regular',
        logoColor: '#112233',
        raw: true,
      });

      const response = await helpers.editCustomBudget({
        id: budget.id,
        params: { logoColor: '#445566' },
        raw: false,
      });

      expect(response.statusCode).toBe(200);
      expect(await helpers.getCustomBudgetById({ id: budget.id, raw: true })).toMatchObject({
        logoIcon: 'food-24-regular',
        logoColor: '#445566',
      });
    });

    it('sets an icon via edit', async () => {
      const budget = await helpers.createCustomBudget({
        name: 'Monogram Tracker',
        logoInitials: 'TR',
        logoColor: '#112233',
        raw: true,
      });

      await helpers.editCustomBudget({ id: budget.id, params: { logoIcon: 'food-24-regular' }, raw: true });

      expect(await helpers.getCustomBudgetById({ id: budget.id, raw: true })).toMatchObject({
        logoIcon: 'food-24-regular',
        logoInitials: null,
        logoColor: '#112233',
      });
    });

    it('rejects an svg data URL', async () => {
      const response = await helpers.createCustomBudget({
        name: 'Svg Image',
        logoImage: `data:image/svg+xml;base64,${Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>').toString('base64')}`,
        raw: false,
      });

      expect(response.statusCode).toEqual(ERROR_CODES.ValidationError);
    });

    it.each(['fluent:food', 'Food', 'a b', 'a'.repeat(65)])('rejects the malformed icon name %p', async (logoIcon) => {
      const response = await helpers.createCustomBudget({ name: 'Bad Icon', logoIcon, raw: false });

      expect(response.statusCode).toEqual(ERROR_CODES.ValidationError);
    });

    it('returns 422 for a non-uuid image id', async () => {
      const image = await helpers.getLogoImage({ id: 'not-a-uuid' });
      expect(image.statusCode).toBe(ERROR_CODES.ValidationError);
    });

    it('rejects an image sent together with a color on edit', async () => {
      const budget = await helpers.createCustomBudget({ name: 'Plain Tracker', raw: true });

      const response = await helpers.editCustomBudget({
        id: budget.id,
        params: { logoImage: PNG_1X1_DATA_URL, logoColor: '#112233' },
        raw: false,
      });

      expect(response.statusCode).toEqual(ERROR_CODES.ValidationError);
      expect((await helpers.getCustomBudgetById({ id: budget.id, raw: true }))?.logoImageId).toBeNull();
    });

    it('clearing the icon keeps the color behind stored initials', async () => {
      const budget = await helpers.createCustomBudget({
        name: 'Monogram Tracker',
        logoInitials: 'TR',
        logoColor: '#112233',
        raw: true,
      });

      await helpers.editCustomBudget({ id: budget.id, params: { logoIcon: null }, raw: true });

      expect(await helpers.getCustomBudgetById({ id: budget.id, raw: true })).toMatchObject({
        logoInitials: 'TR',
        logoColor: '#112233',
      });
    });

    it.each([
      ['clearing', null],
      ['replacing', WEBP_1X1_DATA_URL],
    ])('a rejected edit %s the image keeps the stored blob', async (_label, logoImage) => {
      const category = await helpers.addCustomCategory({ name: 'Food', color: '#FF0000', raw: true });
      const budget = await helpers.createCustomBudget({
        name: 'Category Tracker',
        type: BUDGET_TYPES.category,
        categoryIds: [category.id],
        logoImage: PNG_1X1_DATA_URL,
        raw: true,
      });

      const response = await helpers.editCustomBudget({
        id: budget.id,
        params: { logoImage, categoryIds: [NONEXISTENT_ID] },
        raw: false,
      });

      expect(response.statusCode).toEqual(ERROR_CODES.ValidationError);
      expect((await helpers.getCustomBudgetById({ id: budget.id, raw: true }))?.logoImageId).toBe(budget.logoImageId);
      expect((await helpers.getLogoImage({ id: budget.logoImageId! })).statusCode).toBe(200);
    });

    it('ignores a client-sent logoImageId', async () => {
      const owner = await createImageTracker();
      const other = await helpers.createCustomBudget({ name: 'Plain Tracker', raw: true });

      await helpers.editCustomBudget({
        id: other.id,
        params: { logoImageId: owner.logoImageId } as never,
        raw: true,
      });
      expect((await helpers.getCustomBudgetById({ id: other.id, raw: true }))?.logoImageId).toBeNull();

      await helpers.editCustomBudget({ id: other.id, params: { logoImage: null }, raw: true });
      expect((await helpers.getLogoImage({ id: owner.logoImageId! })).statusCode).toBe(200);
    });

    it('deleting the tracker deletes its image', async () => {
      const budget = await createImageTracker();

      await helpers.deleteCustomBudget({ id: budget.id, raw: true });

      expect((await helpers.getLogoImage({ id: budget.logoImageId! })).statusCode).toBe(ERROR_CODES.NotFoundError);
    });

    it('a share recipient sees the image id and can fetch the image', async () => {
      const budget = await createImageTracker();
      const recipient = await helpers.provisionSecondUserWithBaseCurrency();
      await helpers.shareBudgetWith({ budgetId: budget.id, recipient, permission: SHARE_PERMISSIONS.read });

      const { shared, image } = await helpers.asUser({
        cookies: recipient.cookies,
        fn: async () => ({
          shared: await helpers.getCustomBudgetById({ id: budget.id, raw: true }),
          image: await helpers.getLogoImage({ id: budget.logoImageId! }),
        }),
      });

      expect(shared?.logoImageId).toBe(budget.logoImageId);
      expect(image.statusCode).toBe(200);
      expect(image.body.equals(PNG_1X1_BYTES)).toBe(true);
    });
  });
});

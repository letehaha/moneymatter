import { BUDGET_STATUSES, BUDGET_TYPES, SHARE_PERMISSIONS, TRANSACTION_TYPES } from '@bt/shared/types';
import { NONEXISTENT_ID } from '@common/lib/record-id-helpers';
import { describe, expect, it } from '@jest/globals';
import { ERROR_CODES } from '@js/errors';
import { PNG_1X1_BYTES, PNG_1X1_DATA_URL } from '@tests/fixtures/logo-images';
import * as helpers from '@tests/helpers';

describe('POST /budgets/:id/duplicate', () => {
  it('copies type, limit, categories and lines but resets dates and flags', async () => {
    const [food, fun] = await Promise.all([
      helpers.addCustomCategory({ name: 'Food', color: '#FF0000', raw: true }),
      helpers.addCustomCategory({ name: 'Fun', color: '#00FF00', raw: true }),
    ]);
    const source = await helpers.createCustomBudget({
      name: 'Monthly',
      type: BUDGET_TYPES.category,
      categoryIds: [food.id, fun.id],
      limitAmount: 1000,
      startDate: '2025-03-01T00:00:00Z',
      endDate: '2025-03-31T23:59:59Z',
      autoInclude: true,
      raw: true,
    });
    const foodLine = await helpers.createTrackerLine({
      budgetId: source.id,
      payload: { name: 'Food', limitAmount: 300, categoryIds: [food.id] },
      raw: true,
    });
    const funLine = await helpers.createTrackerLine({
      budgetId: source.id,
      payload: { name: 'Fun', categoryIds: [fun.id] },
      raw: true,
    });
    await helpers.editCustomBudget({ id: source.id, params: { archivePromptDismissed: true }, raw: true });
    const archivedSource = await helpers.archiveCustomBudget({ id: source.id, isArchived: true, raw: true });
    expect(archivedSource).toMatchObject({ status: BUDGET_STATUSES.archived, autoInclude: true });

    const copyResponse = await helpers.duplicateCustomBudget({ id: source.id, raw: false });
    expect(copyResponse.statusCode).toBe(201);

    const copy = helpers.extractResponse(copyResponse);
    expect(copy.id).not.toBe(source.id);
    expect(copy).toMatchObject({
      name: 'Monthly copy',
      type: BUDGET_TYPES.category,
      status: BUDGET_STATUSES.active,
      limitAmount: 1000,
      startDate: null,
      endDate: null,
      autoInclude: false,
      archivePromptDismissed: false,
    });
    expect(copy.categories!.map((c) => c.id).toSorted()).toEqual([food.id, fun.id].toSorted());

    const fetched = await helpers.getCustomBudgetById({ id: copy.id, raw: true });
    const copiedLines = fetched!.lines!;
    expect(copiedLines.map((line) => line.name)).toEqual(['Food', 'Fun']);
    expect(copiedLines.map((line) => line.position)).toEqual([foodLine.position, funLine.position]);
    expect(copiedLines.map((line) => line.id)).not.toContain(foodLine.id);
    expect(copiedLines[0]!.limitAmount).toBe(300);
    expect(copiedLines[0]!.categories.map((c) => c.id)).toEqual([food.id]);
    expect(copiedLines[1]!.categories.map((c) => c.id)).toEqual([fun.id]);

    const sourceAfter = await helpers.getCustomBudgetById({ id: source.id, raw: true });
    expect(sourceAfter!.lines!.map((line) => line.id)).toEqual([foodLine.id, funLine.id]);
  });

  it('copies the logo fields', async () => {
    const source = await helpers.createCustomBudget({
      name: 'Monogram',
      logoInitials: 'TR',
      logoColor: '#112233',
      raw: true,
    });

    const copy = await helpers.duplicateCustomBudget({ id: source.id, raw: true });

    expect(copy).toMatchObject({ logoDomain: null, logoInitials: 'TR', logoColor: '#112233' });
  });

  it('copies the logo icon', async () => {
    const source = await helpers.createCustomBudget({
      name: 'Icon',
      logoIcon: 'food-24-regular',
      logoColor: '#112233',
      raw: true,
    });

    const copy = await helpers.duplicateCustomBudget({ id: source.id, raw: true });

    expect(copy).toMatchObject({ logoIcon: 'food-24-regular', logoColor: '#112233', logoImageId: null });
  });

  it('gives the copy its own logo image blob', async () => {
    const source = await helpers.createCustomBudget({ name: 'Image', logoImage: PNG_1X1_DATA_URL, raw: true });

    const copy = await helpers.duplicateCustomBudget({ id: source.id, raw: true });

    expect(copy.logoImageId).toBeTruthy();
    expect(copy.logoImageId).not.toBe(source.logoImageId);
    const image = await helpers.getLogoImage({ id: copy.logoImageId! });
    expect(image.statusCode).toBe(200);
    expect(image.body.equals(PNG_1X1_BYTES)).toBe(true);

    await helpers.editCustomBudget({ id: source.id, params: { logoImage: null }, raw: true });
    expect((await helpers.getLogoImage({ id: copy.logoImageId! })).statusCode).toBe(200);
  });

  it('does not copy linked transactions of a manual tracker', async () => {
    const account = await helpers.createAccount({ raw: true });
    const [tx] = await helpers.createTransaction({
      payload: helpers.buildTransactionPayload({
        accountId: account.id,
        amount: 100,
        transactionType: TRANSACTION_TYPES.expense,
      }),
      raw: true,
    });
    const source = await helpers.createCustomBudget({ name: 'Trip', raw: true });
    await helpers.addTransactionToCustomBudget({ id: source.id, payload: { transactionIds: [tx!.id] }, raw: true });

    const copy = await helpers.duplicateCustomBudget({ id: source.id, raw: true });

    expect(copy.type).toBe(BUDGET_TYPES.manual);
    expect(copy.lines).toEqual([]);
    const [sourceStats, copyStats] = await Promise.all([
      helpers.getStats({ id: source.id, raw: true }),
      helpers.getStats({ id: copy.id, raw: true }),
    ]);
    expect(sourceStats!.summary.transactionsCount).toBe(1);
    expect(copyStats!.summary.transactionsCount).toBe(0);
  });

  it('forbids a manage recipient from duplicating', async () => {
    const source = await helpers.createCustomBudget({ name: 'Shared', raw: true });
    const recipient = await helpers.provisionSecondUserWithBaseCurrency();
    await helpers.shareBudgetWith({ budgetId: source.id, recipient, permission: SHARE_PERMISSIONS.manage });

    const response = await helpers.asUser({
      cookies: recipient.cookies,
      fn: () => helpers.duplicateCustomBudget({ id: source.id, raw: false }),
    });

    expect(response.statusCode).toBe(ERROR_CODES.Forbidden);
  });

  it('returns 404 for an unknown tracker', async () => {
    const response = await helpers.duplicateCustomBudget({ id: NONEXISTENT_ID, raw: false });

    expect(response.statusCode).toBe(ERROR_CODES.NotFoundError);
  });
});

import { TRACKER_STATUSES, SHARE_PERMISSIONS, TRANSACTION_TYPES, TRACKER_LIMIT_KINDS } from '@bt/shared/types';
import { NONEXISTENT_ID } from '@common/lib/record-id-helpers';
import { describe, expect, it } from '@jest/globals';
import { ERROR_CODES } from '@js/errors';
import { PNG_1X1_BYTES, PNG_1X1_DATA_URL } from '@tests/fixtures/logo-images';
import * as helpers from '@tests/helpers';

describe('POST /trackers/:id/duplicate', () => {
  it('copies rules, limit, categories, tags and lines but resets dates and flags', async () => {
    const [food, fun, tag] = await Promise.all([
      helpers.addCustomCategory({ name: 'Food', color: '#FF0000', raw: true }),
      helpers.addCustomCategory({ name: 'Fun', color: '#00FF00', raw: true }),
      helpers.createTag({ payload: { name: 'Trip', color: '#0000FF' }, raw: true }),
    ]);
    const source = await helpers.createTracker({
      name: 'Monthly',
      rulesEnabled: true,
      rulesCleanup: false,
      categoryIds: [food.id, fun.id],
      tagIds: [tag.id],
      limitAmount: 1000,
      limitKind: TRACKER_LIMIT_KINDS.incomeCap,
      startDate: '2025-03-01T00:00:00Z',
      endDate: '2025-03-31T23:59:59Z',
      raw: true,
    });
    const foodLine = await helpers.createTrackerLine({
      trackerId: source.id,
      payload: { name: 'Food', limitAmount: 300, categoryIds: [food.id] },
      raw: true,
    });
    const funLine = await helpers.createTrackerLine({
      trackerId: source.id,
      payload: { name: 'Fun', categoryIds: [fun.id] },
      raw: true,
    });
    await helpers.editTracker({ id: source.id, params: { archivePromptDismissed: true }, raw: true });
    const archivedSource = await helpers.archiveTracker({ id: source.id, isArchived: true, raw: true });
    expect(archivedSource).toMatchObject({ status: TRACKER_STATUSES.archived });

    const copyResponse = await helpers.duplicateTracker({ id: source.id, raw: false });
    expect(copyResponse.statusCode).toBe(201);

    const copy = helpers.extractResponse(copyResponse);
    expect(copy.id).not.toBe(source.id);
    expect(copy).toMatchObject({
      name: 'Monthly copy',
      rulesEnabled: true,
      rulesCleanup: false,
      status: TRACKER_STATUSES.active,
      limitAmount: 1000,
      limitKind: TRACKER_LIMIT_KINDS.incomeCap,
      startDate: null,
      endDate: null,
      archivePromptDismissed: false,
    });
    expect(copy.categories!.map((c) => c.id).toSorted()).toEqual([food.id, fun.id].toSorted());
    expect(copy.tags!.map((t) => t.id)).toEqual([tag.id]);

    const fetched = await helpers.getTrackerById({ id: copy.id, raw: true });
    const copiedLines = fetched!.lines!;
    expect(copiedLines.map((line) => line.name)).toEqual(['Food', 'Fun']);
    expect(copiedLines.map((line) => line.position)).toEqual([foodLine.position, funLine.position]);
    expect(copiedLines.map((line) => line.id)).not.toContain(foodLine.id);
    expect(copiedLines[0]!.limitAmount).toBe(300);
    expect(copiedLines[0]!.categories.map((c) => c.id)).toEqual([food.id]);
    expect(copiedLines[1]!.categories.map((c) => c.id)).toEqual([fun.id]);

    const sourceAfter = await helpers.getTrackerById({ id: source.id, raw: true });
    expect(sourceAfter!.lines!.map((line) => line.id)).toEqual([foodLine.id, funLine.id]);
  });

  it('copies the logo fields', async () => {
    const source = await helpers.createTracker({
      name: 'Monogram',
      logoInitials: 'TR',
      logoColor: '#112233',
      raw: true,
    });

    const copy = await helpers.duplicateTracker({ id: source.id, raw: true });

    expect(copy).toMatchObject({ logoDomain: null, logoInitials: 'TR', logoColor: '#112233' });
  });

  it('copies the logo icon', async () => {
    const source = await helpers.createTracker({
      name: 'Icon',
      logoIcon: 'food-24-regular',
      logoColor: '#112233',
      raw: true,
    });

    const copy = await helpers.duplicateTracker({ id: source.id, raw: true });

    expect(copy).toMatchObject({ logoIcon: 'food-24-regular', logoColor: '#112233', logoImageId: null });
  });

  it('gives the copy its own logo image blob', async () => {
    const source = await helpers.createTracker({ name: 'Image', logoImage: PNG_1X1_DATA_URL, raw: true });

    const copy = await helpers.duplicateTracker({ id: source.id, raw: true });

    expect(copy.logoImageId).toBeTruthy();
    expect(copy.logoImageId).not.toBe(source.logoImageId);
    const image = await helpers.getLogoImage({ id: copy.logoImageId! });
    expect(image.statusCode).toBe(200);
    expect(image.body.equals(PNG_1X1_BYTES)).toBe(true);

    await helpers.editTracker({ id: source.id, params: { logoImage: null }, raw: true });
    expect((await helpers.getLogoImage({ id: copy.logoImageId! })).statusCode).toBe(200);
  });

  it('does not copy hand-linked transactions', async () => {
    const account = await helpers.createAccount({ raw: true });
    const [tx] = await helpers.createTransaction({
      payload: helpers.buildTransactionPayload({
        accountId: account.id,
        amount: 100,
        transactionType: TRANSACTION_TYPES.expense,
      }),
      raw: true,
    });
    const source = await helpers.createTracker({ name: 'Trip', raw: true });
    await helpers.addTransactionsToTracker({ id: source.id, payload: { transactionIds: [tx!.id] }, raw: true });

    const copy = await helpers.duplicateTracker({ id: source.id, raw: true });

    expect(copy.lines).toEqual([]);
    const [sourceStats, copyStats] = await Promise.all([
      helpers.getTrackerStats({ id: source.id, raw: true }),
      helpers.getTrackerStats({ id: copy.id, raw: true }),
    ]);
    expect(sourceStats!.summary.transactionsCount).toBe(1);
    expect(copyStats!.summary.transactionsCount).toBe(0);
  });

  it('forbids a manage recipient from duplicating', async () => {
    const source = await helpers.createTracker({ name: 'Shared', raw: true });
    const recipient = await helpers.provisionSecondUserWithBaseCurrency();
    await helpers.shareTrackerWith({ trackerId: source.id, recipient, permission: SHARE_PERMISSIONS.manage });

    const response = await helpers.asUser({
      cookies: recipient.cookies,
      fn: () => helpers.duplicateTracker({ id: source.id, raw: false }),
    });

    expect(response.statusCode).toBe(ERROR_CODES.Forbidden);
  });

  it('returns 404 for an unknown tracker', async () => {
    const response = await helpers.duplicateTracker({ id: NONEXISTENT_ID, raw: false });

    expect(response.statusCode).toBe(ERROR_CODES.NotFoundError);
  });
});

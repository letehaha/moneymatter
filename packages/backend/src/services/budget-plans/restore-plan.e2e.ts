import { generateRandomRecordId } from '@common/lib/record-id-helpers';
import { describe, expect, it } from '@jest/globals';
import { ERROR_CODES } from '@js/errors';
import * as helpers from '@tests/helpers';

describe('Budget plan restore', () => {
  it('frees the slot on delete, conflicts while the replacement is active, and restores once it is gone', async () => {
    const original = await helpers.createBudgetPlan({ raw: true });
    await helpers.deleteBudgetPlan({ planId: original.plan.id });

    const replacement = await helpers.createBudgetPlan({ raw: true });
    expect((await helpers.restoreBudgetPlan({ planId: original.plan.id })).statusCode).toBe(ERROR_CODES.ConflictError);

    await helpers.deleteBudgetPlan({ planId: replacement.plan.id });

    const restored = await helpers.restoreBudgetPlan({ planId: original.plan.id, raw: true });
    expect(restored.plan.id).toBe(original.plan.id);
    expect(await helpers.listBudgetPlans({ raw: true })).toHaveLength(1);
  });

  it('only lists a soft-deleted plan with includeDeleted, and restores by that id', async () => {
    const created = await helpers.createBudgetPlan({ raw: true });
    await helpers.deleteBudgetPlan({ planId: created.plan.id });

    expect(await helpers.listBudgetPlans({ raw: true })).toEqual([]);

    const trashed = await helpers.listBudgetPlans({ includeDeleted: true, raw: true });
    expect(trashed).toHaveLength(1);
    expect(trashed[0]!.id).toBe(created.plan.id);
    expect(trashed[0]!.deletedAt).not.toBeNull();

    const restored = await helpers.restoreBudgetPlan({ planId: trashed[0]!.id, raw: true });
    expect(restored.plan.id).toBe(created.plan.id);
  });

  it('attaches eligible accounts added while the plan sat in the trash', async () => {
    const first = await helpers.createAccount({ raw: true });
    const created = await helpers.createBudgetPlan({
      payload: { accountIds: [first.id], autoAttachAccounts: true },
      raw: true,
    });
    expect(created.accountIds).toEqual([first.id]);

    await helpers.deleteBudgetPlan({ planId: created.plan.id });
    const second = await helpers.createAccount({ raw: true });

    const restored = await helpers.restoreBudgetPlan({ planId: created.plan.id, raw: true });
    expect(restored.accountIds.toSorted()).toEqual([first.id, second.id].toSorted());
  });

  it('leaves the account set alone when auto-attach is off', async () => {
    const first = await helpers.createAccount({ raw: true });
    const created = await helpers.createBudgetPlan({
      payload: { accountIds: [first.id], autoAttachAccounts: false },
      raw: true,
    });

    await helpers.deleteBudgetPlan({ planId: created.plan.id });
    await helpers.createAccount({ raw: true });

    const restored = await helpers.restoreBudgetPlan({ planId: created.plan.id, raw: true });
    expect(restored.accountIds).toEqual([first.id]);
  });

  it('restores a live plan without a conflict', async () => {
    const created = await helpers.createBudgetPlan({ raw: true });

    const restored = await helpers.restoreBudgetPlan({ planId: created.plan.id, raw: true });

    expect(restored.plan.id).toBe(created.plan.id);
    expect(restored.plan.deletedAt).toBeNull();
  });

  it('lets exactly one of two concurrent restores through', async () => {
    const first = await helpers.createBudgetPlan({ raw: true });
    await helpers.deleteBudgetPlan({ planId: first.plan.id });
    const second = await helpers.createBudgetPlan({ raw: true });
    await helpers.deleteBudgetPlan({ planId: second.plan.id });

    const responses = await Promise.all([
      helpers.restoreBudgetPlan({ planId: first.plan.id }),
      helpers.restoreBudgetPlan({ planId: second.plan.id }),
    ]);

    expect(responses.map((response) => response.statusCode).toSorted()).toEqual([200, ERROR_CODES.ConflictError]);
    expect(await helpers.listBudgetPlans({ raw: true })).toHaveLength(1);
  });

  it('refuses a restore after the base currency changed', async () => {
    await helpers.addUserCurrencies({ currencyCodes: ['USD'], raw: true });
    const created = await helpers.createBudgetPlan({ raw: true });
    await helpers.deleteBudgetPlan({ planId: created.plan.id });

    const status = await helpers.changeBaseCurrencyAndWait({ newCurrencyCode: 'USD' });
    helpers.expectBaseCurrencyChangeCompleted(status);

    expect((await helpers.restoreBudgetPlan({ planId: created.plan.id })).statusCode).toBe(ERROR_CODES.ConflictError);
  });

  it('404s on an unknown plan', async () => {
    expect((await helpers.restoreBudgetPlan({ planId: generateRandomRecordId() })).statusCode).toBe(
      ERROR_CODES.NotFoundError,
    );
  });
});

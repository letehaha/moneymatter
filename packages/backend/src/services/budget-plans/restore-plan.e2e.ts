import { ACCOUNT_STATUSES } from '@bt/shared/types';
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

  it('keeps an account archived after the trashed plan attached it', async () => {
    const first = await helpers.createAccount({ raw: true });
    const created = await helpers.createBudgetPlan({
      payload: { accountIds: [first.id], autoAttachAccounts: true },
      raw: true,
    });

    await helpers.deleteBudgetPlan({ planId: created.plan.id });
    const archived = await helpers.createAccount({ raw: true });
    await helpers.updateAccount({ id: archived.id, payload: { status: ACCOUNT_STATUSES.archived }, raw: true });

    const restored = await helpers.restoreBudgetPlan({ planId: created.plan.id, raw: true });
    expect(restored.accountIds.toSorted()).toEqual([first.id, archived.id].toSorted());
  });

  it('does not re-attach an account the user removed before the delete', async () => {
    const kept = await helpers.createAccount({ raw: true });
    const removed = await helpers.createAccount({ raw: true });
    const created = await helpers.createBudgetPlan({
      payload: { accountIds: [kept.id, removed.id], autoAttachAccounts: true },
      raw: true,
    });
    await helpers.setBudgetPlanAccounts({ planId: created.plan.id, accountIds: [kept.id], raw: true });

    await helpers.deleteBudgetPlan({ planId: created.plan.id });

    const restored = await helpers.restoreBudgetPlan({ planId: created.plan.id, raw: true });
    expect(restored.accountIds).toEqual([kept.id]);
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

  describe('with replace', () => {
    const activePlanIds = async () => (await helpers.listBudgetPlans({ raw: true })).map((plan) => plan.id);
    const trashedPlanIds = async () =>
      (await helpers.listBudgetPlans({ includeDeleted: true, raw: true }))
        .filter((plan) => plan.deletedAt)
        .map((plan) => plan.id);

    it('swaps the active plan into the trash, and swaps back the same way', async () => {
      const first = await helpers.createBudgetPlan({ raw: true });
      await helpers.deleteBudgetPlan({ planId: first.plan.id });
      const second = await helpers.createBudgetPlan({ raw: true });

      const restored = await helpers.restoreBudgetPlan({ planId: first.plan.id, replace: true, raw: true });
      expect(restored.plan.id).toBe(first.plan.id);
      expect(restored.plan.deletedAt).toBeNull();
      expect(await activePlanIds()).toEqual([first.plan.id]);
      expect(await trashedPlanIds()).toEqual([second.plan.id]);

      const swappedBack = await helpers.restoreBudgetPlan({ planId: second.plan.id, replace: true, raw: true });
      expect(swappedBack.plan.id).toBe(second.plan.id);
      expect(await activePlanIds()).toEqual([second.plan.id]);
      expect(await trashedPlanIds()).toEqual([first.plan.id]);
    });

    it('behaves like a plain restore when no plan is active', async () => {
      const created = await helpers.createBudgetPlan({ raw: true });
      await helpers.deleteBudgetPlan({ planId: created.plan.id });

      const restored = await helpers.restoreBudgetPlan({ planId: created.plan.id, replace: true, raw: true });

      expect(restored.plan.id).toBe(created.plan.id);
      expect(await activePlanIds()).toEqual([created.plan.id]);
      expect(await trashedPlanIds()).toEqual([]);
    });

    it('still conflicts without the flag and leaves the active plan alone', async () => {
      const first = await helpers.createBudgetPlan({ raw: true });
      await helpers.deleteBudgetPlan({ planId: first.plan.id });
      const second = await helpers.createBudgetPlan({ raw: true });

      for (const replace of [undefined, false]) {
        const response = await helpers.restoreBudgetPlan({ planId: first.plan.id, replace });
        expect(response.statusCode).toBe(ERROR_CODES.ConflictError);
      }

      expect(await activePlanIds()).toEqual([second.plan.id]);
      expect(await trashedPlanIds()).toEqual([first.plan.id]);
    });

    it('keeps the active plan when the trashed one is in a stale base currency', async () => {
      await helpers.addUserCurrencies({ currencyCodes: ['USD'], raw: true });
      const stale = await helpers.createBudgetPlan({ raw: true });
      await helpers.deleteBudgetPlan({ planId: stale.plan.id });

      const status = await helpers.changeBaseCurrencyAndWait({ newCurrencyCode: 'USD' });
      helpers.expectBaseCurrencyChangeCompleted(status);
      const current = await helpers.createBudgetPlan({ raw: true });

      const response = await helpers.restoreBudgetPlan({ planId: stale.plan.id, replace: true });

      expect(response.statusCode).toBe(ERROR_CODES.ConflictError);
      expect(await activePlanIds()).toEqual([current.plan.id]);
      expect(await trashedPlanIds()).toEqual([stale.plan.id]);
    });

    it("404s on another user's trashed plan and keeps the caller's active plan", async () => {
      const foreign = await helpers.createBudgetPlan({ raw: true });
      await helpers.deleteBudgetPlan({ planId: foreign.plan.id });
      const other = await helpers.provisionSecondUserWithBaseCurrency();

      const { own, response, active } = await helpers.asUser({
        cookies: other.cookies,
        fn: async () => {
          const own = await helpers.createBudgetPlan({ raw: true });
          const response = await helpers.restoreBudgetPlan({ planId: foreign.plan.id, replace: true });
          return { own, response, active: await activePlanIds() };
        },
      });

      expect(response.statusCode).toBe(ERROR_CODES.NotFoundError);
      expect(active).toEqual([own.plan.id]);
      expect(await trashedPlanIds()).toEqual([foreign.plan.id]);
    });

    it('rejects a non-boolean flag', async () => {
      const response = await helpers.makeRequest({
        method: 'post',
        url: `/budget-plans/${generateRandomRecordId()}/restore`,
        payload: { replace: 'yes' },
      });

      expect(response.statusCode).toBe(ERROR_CODES.ValidationError);
    });
  });

  it('404s on an unknown plan', async () => {
    expect((await helpers.restoreBudgetPlan({ planId: generateRandomRecordId() })).statusCode).toBe(
      ERROR_CODES.NotFoundError,
    );
  });
});

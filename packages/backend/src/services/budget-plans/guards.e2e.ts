import { ACCOUNT_CATEGORIES, API_ERROR_CODES, BANK_PROVIDER_TYPE } from '@bt/shared/types';
import { describe, expect, it } from '@jest/globals';
import { ERROR_CODES } from '@js/errors';
import BudgetPlanAccounts from '@models/budget-plan-accounts.model';
import * as helpers from '@tests/helpers';
import type { ErrorResponse } from '@tests/helpers/common';
import { VALID_MONOBANK_TOKEN } from '@tests/mocks/monobank/mock-api';

describe('Budget plan auto-attach of new accounts', () => {
  it('attaches an eligible account created after the plan', async () => {
    const created = await helpers.createBudgetPlan({ payload: { autoAttachAccounts: true }, raw: true });
    const added = await helpers.createAccount({ raw: true });

    const plan = await helpers.getBudgetPlan({ planId: created.plan.id, raw: true });
    expect(plan.accountIds.toSorted()).toEqual([...created.accountIds, added.id].toSorted());
  });

  it('leaves the set alone when auto-attach was not asked for', async () => {
    const created = await helpers.createBudgetPlan({ raw: true });
    await helpers.createAccount({ raw: true });

    const plan = await helpers.getBudgetPlan({ planId: created.plan.id, raw: true });
    expect(plan.accountIds).toEqual(created.accountIds);
  });

  it('attaches accounts created after auto-attach is switched on, but not the ones that already existed', async () => {
    const created = await helpers.createBudgetPlan({ raw: true });
    const existing = await helpers.createAccount({ raw: true });

    await helpers.updateBudgetPlan({ planId: created.plan.id, payload: { autoAttachAccounts: true }, raw: true });
    const added = await helpers.createAccount({ raw: true });

    const plan = await helpers.getBudgetPlan({ planId: created.plan.id, raw: true });
    expect(plan.accountIds.toSorted()).toEqual([...created.accountIds, added.id].toSorted());
    expect(plan.accountIds).not.toContain(existing.id);
  });

  it('ignores an account category outside the eligible set', async () => {
    const created = await helpers.createBudgetPlan({ payload: { autoAttachAccounts: true }, raw: true });
    await helpers.createAccount({
      payload: helpers.buildAccountPayload({ accountCategory: ACCOUNT_CATEGORIES.bonus }),
      raw: true,
    });

    const plan = await helpers.getBudgetPlan({ planId: created.plan.id, raw: true });
    expect(plan.accountIds).toEqual(created.accountIds);
  });

  it('ignores an eligible account created by another user', async () => {
    const created = await helpers.createBudgetPlan({ payload: { autoAttachAccounts: true }, raw: true });
    const other = await helpers.provisionSecondUserWithBaseCurrency();

    const otherAccount = await helpers.asUser({
      cookies: other.cookies,
      fn: () => helpers.createAccount({ raw: true }),
    });

    const plan = await helpers.getBudgetPlan({ planId: created.plan.id, raw: true });
    expect(plan.accountIds).not.toContain(otherAccount.id);
    expect(plan.accountIds).toHaveLength(created.accountIds.length);
  });

  it('attaches an account created through the bank-sync path', async () => {
    const created = await helpers.createBudgetPlan({ payload: { autoAttachAccounts: true }, raw: true });

    const { connectionId } = await helpers.bankDataProviders.connectProvider({
      providerType: BANK_PROVIDER_TYPE.MONOBANK,
      credentials: { apiToken: VALID_MONOBANK_TOKEN },
      raw: true,
    });
    const { accounts: externalAccounts } = await helpers.bankDataProviders.listExternalAccounts({
      connectionId,
      raw: true,
    });
    const { syncedAccounts } = await helpers.bankDataProviders.connectSelectedAccounts({
      connectionId,
      accountExternalIds: [externalAccounts[0]!.externalId],
      raw: true,
    });

    const plan = await helpers.getBudgetPlan({ planId: created.plan.id, raw: true });
    expect(plan.accountIds.toSorted()).toEqual([...created.accountIds, syncedAccounts[0]!.id].toSorted());
  });

  it('attaches a new account while the plan sits in the trash', async () => {
    const created = await helpers.createBudgetPlan({ payload: { autoAttachAccounts: true }, raw: true });
    await helpers.deleteBudgetPlan({ planId: created.plan.id });

    const added = await helpers.createAccount({ raw: true });

    expect(await BudgetPlanAccounts.count({ where: { planId: created.plan.id, accountId: added.id } })).toBe(1);
  });
});

describe('Base currency change with a budget plan', () => {
  it('is blocked by an active plan and allowed once the plan is soft-deleted', async () => {
    await helpers.addUserCurrencies({ currencyCodes: ['USD'], raw: true });
    const created = await helpers.createBudgetPlan({ raw: true });

    const blocked = await helpers.changeBaseCurrency({ newCurrencyCode: 'USD' });
    expect(blocked.statusCode).toBe(ERROR_CODES.ConflictError);
    const error = blocked.body.response as unknown as ErrorResponse;
    expect(error.code).toBe(API_ERROR_CODES.baseCurrencyLockedByBudgetPlan);
    expect(error.details).toEqual({ blockers: [{ type: 'budget_plan', count: 1 }] });

    await helpers.deleteBudgetPlan({ planId: created.plan.id });

    const status = await helpers.changeBaseCurrencyAndWait({ newCurrencyCode: 'USD' });
    helpers.expectBaseCurrencyChangeCompleted(status);
  });
});

import { ACCOUNT_CATEGORIES, ACCOUNT_STATUSES } from '@bt/shared/types';
import { generateRandomRecordId } from '@common/lib/record-id-helpers';
import { describe, expect, it } from '@jest/globals';
import { ERROR_CODES } from '@js/errors';
import * as helpers from '@tests/helpers';

describe('Budget plan account set', () => {
  it('replaces the set, and accepts an empty one', async () => {
    const kept = await helpers.createAccount({ raw: true });
    const dropped = await helpers.createAccount({ raw: true });
    const created = await helpers.createBudgetPlan({ payload: { accountIds: [kept.id, dropped.id] }, raw: true });
    expect(created.accountIds.toSorted()).toEqual([kept.id, dropped.id].toSorted());

    const replaced = await helpers.setBudgetPlanAccounts({
      planId: created.plan.id,
      accountIds: [kept.id],
      raw: true,
    });
    expect(replaced.accountIds).toEqual([kept.id]);

    const emptied = await helpers.setBudgetPlanAccounts({ planId: created.plan.id, accountIds: [], raw: true });
    expect(emptied.accountIds).toEqual([]);
  });

  it('accepts re-sending an attached account that was archived later', async () => {
    const account = await helpers.createAccount({ raw: true });
    const created = await helpers.createBudgetPlan({ payload: { accountIds: [account.id] }, raw: true });
    await helpers.updateAccount({ id: account.id, payload: { status: ACCOUNT_STATUSES.archived }, raw: true });

    const resent = await helpers.setBudgetPlanAccounts({
      planId: created.plan.id,
      accountIds: [account.id],
      raw: true,
    });

    expect(resent.accountIds).toEqual([account.id]);
  });

  it('detaches an account moved to a category a plan cannot attach', async () => {
    const kept = await helpers.createAccount({ raw: true });
    const moved = await helpers.createAccount({ raw: true });
    const created = await helpers.createBudgetPlan({ payload: { accountIds: [kept.id, moved.id] }, raw: true });

    await helpers.updateAccount({
      id: moved.id,
      payload: { accountCategory: ACCOUNT_CATEGORIES.investment },
      raw: true,
    });
    expect((await helpers.getBudgetPlan({ planId: created.plan.id, raw: true })).accountIds).toEqual([kept.id]);

    const replaced = await helpers.setBudgetPlanAccounts({
      planId: created.plan.id,
      accountIds: [kept.id],
      raw: true,
    });
    expect(replaced.accountIds).toEqual([kept.id]);
  });

  it('refuses an account the user does not own', async () => {
    const created = await helpers.createBudgetPlan({ raw: true });
    const other = await helpers.provisionSecondUserWithBaseCurrency();
    const foreign = await helpers.asUser({
      cookies: other.cookies,
      fn: () => helpers.createAccount({ raw: true }),
    });

    const unknown = await helpers.setBudgetPlanAccounts({
      planId: created.plan.id,
      accountIds: [generateRandomRecordId()],
    });
    expect(unknown.statusCode).toBe(ERROR_CODES.ValidationError);

    const someoneElses = await helpers.setBudgetPlanAccounts({
      planId: created.plan.id,
      accountIds: [foreign.id],
    });
    expect(someoneElses.statusCode).toBe(ERROR_CODES.ValidationError);
  });

  it('refuses an account whose category a plan cannot attach', async () => {
    const created = await helpers.createBudgetPlan({ raw: true });
    const loan = await helpers.createLoan({
      payload: helpers.buildCreateLoanPayload({ currencyCode: global.BASE_CURRENCY_CODE }),
      raw: true,
    });

    const response = await helpers.setBudgetPlanAccounts({ planId: created.plan.id, accountIds: [loan.id] });

    expect(response.statusCode).toBe(ERROR_CODES.ValidationError);
  });

  it('404s on an unknown plan', async () => {
    const account = await helpers.createAccount({ raw: true });

    const response = await helpers.setBudgetPlanAccounts({
      planId: generateRandomRecordId(),
      accountIds: [account.id],
    });

    expect(response.statusCode).toBe(ERROR_CODES.NotFoundError);
  });
});

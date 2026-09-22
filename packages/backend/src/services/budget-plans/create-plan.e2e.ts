import { ACCOUNT_CATEGORIES, API_ERROR_CODES, PLANS } from '@bt/shared/types';
import { generateRandomRecordId } from '@common/lib/record-id-helpers';
import { toUtcDateString } from '@common/utils/date';
import { describe, expect, it } from '@jest/globals';
import { ERROR_CODES } from '@js/errors';
import * as helpers from '@tests/helpers';
import type { ErrorResponse } from '@tests/helpers/common';

const DAY_MS = 86_400_000;

describe('Budget plan CRUD', () => {
  it('returns an empty list before anything is created', async () => {
    expect(await helpers.listBudgetPlans({ raw: true })).toEqual([]);
  });

  it('attaches exactly the requested accounts and stamps the base currency and the defaults', async () => {
    const chosen = await helpers.createAccount({ raw: true });
    await helpers.createAccount({ raw: true });

    const created = await helpers.createBudgetPlan({ payload: { accountIds: [chosen.id] }, raw: true });

    expect(created.accountIds).toEqual([chosen.id]);
    expect(created.lines).toEqual([]);
    expect(created.plan.currencyCode).toBe(global.BASE_CURRENCY.code);
    expect(created.plan.carryPolicy).toBe('none');
    expect(created.plan.autoAttachAccounts).toBe(false);
    expect(toUtcDateString(created.plan.epochDate)).toBe(helpers.budgetPeriodStart());
  });

  it('refuses a create without an account set', async () => {
    const response = await helpers.makeRequest({
      method: 'post',
      url: '/budget-plans',
      payload: { name: 'No accounts', type: 'category_caps', cadence: 'months', anchorDate: '2020-01-01' },
    });

    expect(response.statusCode).toBe(ERROR_CODES.ValidationError);
  });

  it('refuses an empty account set', async () => {
    const response = await helpers.createBudgetPlan({ payload: { accountIds: [] } });

    expect(response.statusCode).toBe(ERROR_CODES.ValidationError);
  });

  it('refuses an account whose category a plan cannot attach', async () => {
    const investment = await helpers.createAccount({
      payload: helpers.buildAccountPayload({ accountCategory: ACCOUNT_CATEGORIES.investment }),
      raw: true,
    });

    const response = await helpers.createBudgetPlan({ payload: { accountIds: [investment.id] } });

    expect(response.statusCode).toBe(ERROR_CODES.ValidationError);
  });

  it('snaps a backdated epoch to a period start', async () => {
    const created = await helpers.createBudgetPlan({
      payload: { epochDate: `${helpers.budgetPeriodStart({ monthsAgo: 2 }).slice(0, 8)}15` },
      raw: true,
    });

    expect(toUtcDateString(created.plan.epochDate)).toBe(helpers.budgetPeriodStart({ monthsAgo: 2 }));
  });

  it('rejects an epoch in the future', async () => {
    const response = await helpers.createBudgetPlan({
      payload: { epochDate: toUtcDateString(new Date(Date.now() + DAY_MS)) },
    });

    expect(response.statusCode).toBe(ERROR_CODES.ValidationError);
  });

  it('rejects an epoch more than the backdating limit away from today', async () => {
    const response = await helpers.createBudgetPlan({
      payload: {
        cadence: 'days',
        intervalN: 1,
        epochDate: toUtcDateString(new Date(Date.now() - 600 * DAY_MS)),
      },
    });

    expect(response.statusCode).toBe(ERROR_CODES.ValidationError);
  });

  it('rejects an interval longer than the cadence allows', async () => {
    expect((await helpers.createBudgetPlan({ payload: { cadence: 'months', intervalN: 13 } })).statusCode).toBe(
      ERROR_CODES.ValidationError,
    );
    expect((await helpers.createBudgetPlan({ payload: { cadence: 'days', intervalN: 400 } })).statusCode).toBe(
      ERROR_CODES.ValidationError,
    );
  });

  it('rejects a second anchor day outside a semi-monthly plan, and semi-monthly days that are too close', async () => {
    expect((await helpers.createBudgetPlan({ payload: { secondAnchorDay: 15 } })).statusCode).toBe(
      ERROR_CODES.ValidationError,
    );
    expect((await helpers.createBudgetPlan({ payload: { cadence: 'semi_monthly' } })).statusCode).toBe(
      ERROR_CODES.ValidationError,
    );
    expect(
      (
        await helpers.createBudgetPlan({
          payload: { cadence: 'semi_monthly', anchorDate: '2020-01-01', secondAnchorDay: 31 },
        })
      ).statusCode,
    ).toBe(ERROR_CODES.ValidationError);

    const accepted = await helpers.createBudgetPlan({
      payload: { cadence: 'semi_monthly', anchorDate: '2020-01-01', secondAnchorDay: 15 },
    });
    expect(accepted.statusCode).toBe(201);

    const periods = await helpers.listBudgetPlanPeriods({ planId: accepted.body.response.plan.id, raw: true });
    expect(periods.length).toBeGreaterThan(0);
    for (const period of periods) {
      expect(['01', '15']).toContain(period.startDate.slice(8));
      expect(['01', '15']).toContain(period.endDate.slice(8));
      expect(period.startDate.slice(8)).not.toBe(period.endDate.slice(8));
    }
  });

  it('rejects an account the user does not own', async () => {
    const response = await helpers.createBudgetPlan({ payload: { accountIds: [generateRandomRecordId()] } });

    expect(response.statusCode).toBe(ERROR_CODES.ValidationError);
  });

  it('honours an explicit account set and carry policy', async () => {
    const chosen = await helpers.createAccount({ raw: true });
    await helpers.createAccount({ raw: true });

    const created = await helpers.createBudgetPlan({
      payload: { accountIds: [chosen.id], carryPolicy: 'signed' },
      raw: true,
    });

    expect(created.accountIds).toEqual([chosen.id]);
    expect(created.plan.carryPolicy).toBe('signed');
  });

  it('refuses a second plan while one is active', async () => {
    expect((await helpers.createBudgetPlan()).statusCode).toBe(201);

    const second = await helpers.createBudgetPlan();
    expect(second.statusCode).toBe(ERROR_CODES.ConflictError);
  });

  it('lets exactly one of two concurrent creates through', async () => {
    const responses = await Promise.all([helpers.createBudgetPlan(), helpers.createBudgetPlan()]);

    expect(responses.map((response) => response.statusCode).toSorted()).toEqual([201, ERROR_CODES.ConflictError]);
    expect(await helpers.listBudgetPlans({ raw: true })).toHaveLength(1);
  });

  it("hides another user's plan behind a 404, reads and writes alike", async () => {
    const created = await helpers.createBudgetPlan({ raw: true });
    const planId = created.plan.id;
    const other = await helpers.provisionSecondUserWithBaseCurrency();

    const statusCodes = await helpers.asUser({
      cookies: other.cookies,
      fn: async () => [
        (await helpers.getBudgetPlan({ planId })).statusCode,
        (await helpers.updateBudgetPlan({ planId, payload: { name: 'Stolen' } })).statusCode,
        (await helpers.setBudgetPlanAccounts({ planId, accountIds: [] })).statusCode,
        (await helpers.restoreBudgetPlan({ planId })).statusCode,
        (await helpers.deleteBudgetPlan({ planId })).statusCode,
      ],
    });

    for (const statusCode of statusCodes) {
      expect(statusCode).toBe(ERROR_CODES.NotFoundError);
    }
  });

  it('patches only the mutable fields', async () => {
    const created = await helpers.createBudgetPlan({ raw: true });

    const updated = await helpers.updateBudgetPlan({
      planId: created.plan.id,
      payload: { name: 'Renamed', autoAttachAccounts: false, carryPolicy: 'floor' },
      raw: true,
    });
    expect(updated.plan.name).toBe('Renamed');
    expect(updated.plan.autoAttachAccounts).toBe(false);
    expect(updated.plan.carryPolicy).toBe('floor');

    for (const payload of [{ cadence: 'days' }, { epochDate: '2020-01-01' }, { type: 'category_caps' }]) {
      expect((await helpers.updateBudgetPlan({ planId: created.plan.id, payload })).statusCode).toBe(
        ERROR_CODES.ValidationError,
      );
    }
  });

  it('soft-deletes a plan out of the list, out of GET and out of every write', async () => {
    const created = await helpers.createBudgetPlan({ raw: true });
    const planId = created.plan.id;

    expect((await helpers.deleteBudgetPlan({ planId })).statusCode).toBe(200);
    expect(await helpers.listBudgetPlans({ raw: true })).toEqual([]);
    expect((await helpers.getBudgetPlan({ planId })).statusCode).toBe(ERROR_CODES.NotFoundError);
    expect((await helpers.updateBudgetPlan({ planId, payload: { name: 'x' } })).statusCode).toBe(
      ERROR_CODES.NotFoundError,
    );
    expect((await helpers.setBudgetPlanAccounts({ planId, accountIds: [] })).statusCode).toBe(
      ERROR_CODES.NotFoundError,
    );
  });

  it('404s on an unknown plan', async () => {
    const planId = generateRandomRecordId();

    expect((await helpers.getBudgetPlan({ planId })).statusCode).toBe(ERROR_CODES.NotFoundError);
    expect((await helpers.deleteBudgetPlan({ planId })).statusCode).toBe(ERROR_CODES.NotFoundError);
    expect((await helpers.updateBudgetPlan({ planId, payload: { name: 'x' } })).statusCode).toBe(
      ERROR_CODES.NotFoundError,
    );
  });
});

describe('Budget plans without the feature', () => {
  it('keeps reads open and answers writes with 402', async () => {
    const created = await helpers.createBudgetPlan({ raw: true });

    await helpers.setUserBilling({ plan: PLANS.early_adopter, trialEndsAt: null });

    expect((await helpers.listBudgetPlans()).statusCode).toBe(200);
    expect((await helpers.getBudgetPlan({ planId: created.plan.id })).statusCode).toBe(200);
    expect((await helpers.listBudgetPlanPeriods({ planId: created.plan.id })).statusCode).toBe(200);

    const write = await helpers.updateBudgetPlan({ planId: created.plan.id, payload: { name: 'Nope' } });
    expect(write.statusCode).toBe(ERROR_CODES.PaymentRequired);
    expect((write.body.response as unknown as ErrorResponse).code).toBe(API_ERROR_CODES.planRequired);

    expect((await helpers.createBudgetPlan({ payload: { accountIds: created.accountIds } })).statusCode).toBe(
      ERROR_CODES.PaymentRequired,
    );
    expect((await helpers.deleteBudgetPlan({ planId: created.plan.id })).statusCode).toBe(ERROR_CODES.PaymentRequired);
  });
});

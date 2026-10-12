import {
  ACCOUNT_CATEGORIES,
  API_ERROR_CODES,
  EARLY_ADOPTER_BUDGET_TRIAL_DAYS,
  PLANS,
  type RecordId,
} from '@bt/shared/types';
import { generateRandomRecordId } from '@common/lib/record-id-helpers';
import { toUtcDateString } from '@common/utils/date';
import { describe, expect, it } from '@jest/globals';
import { ERROR_CODES } from '@js/errors';
import * as helpers from '@tests/helpers';
import type { ErrorResponse } from '@tests/helpers/common';

import { MS_PER_DAY } from './periods/period-enumerator';

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
      payload: { epochDate: toUtcDateString(new Date(Date.now() + MS_PER_DAY)) },
    });

    expect(response.statusCode).toBe(ERROR_CODES.ValidationError);
  });

  it('rejects an epoch more than the backdating limit away from today', async () => {
    const response = await helpers.createBudgetPlan({
      payload: {
        cadence: 'days',
        intervalN: 1,
        epochDate: toUtcDateString(new Date(Date.now() - 600 * MS_PER_DAY)),
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
    const [period] = await helpers.listBudgetPlanPeriods({ planId, raw: true });
    const line = await helpers.createBudgetPlanLine({
      planId,
      payload: { name: 'Food', categoryIds: [(await helpers.getCategoriesList())[0]!.id] },
      raw: true,
    });
    const other = await helpers.provisionSecondUserWithBaseCurrency();

    const statusCodes = await helpers.asUser({
      cookies: other.cookies,
      fn: async () => [
        (await helpers.getBudgetPlan({ planId })).statusCode,
        (await helpers.updateBudgetPlan({ planId, payload: { name: 'Stolen' } })).statusCode,
        (await helpers.setBudgetPlanAccounts({ planId, accountIds: [] })).statusCode,
        (await helpers.getBudgetPlanPeriodView({ planId, periodId: period!.id })).statusCode,
        (await helpers.getBudgetPlanTrends({ planId })).statusCode,
        (await helpers.getBudgetPlanScheduled({ planId, periodId: period!.id })).statusCode,
        (
          await helpers.setBudgetAssignment({
            planId,
            periodId: period!.id,
            lineId: line.id,
            payload: { scope: 'from_here', amount: 10 },
          })
        ).statusCode,
        (await helpers.restoreBudgetPlan({ planId })).statusCode,
        (await helpers.deleteBudgetPlan({ planId })).statusCode,
      ],
    });

    for (const statusCode of statusCodes) {
      expect(statusCode).toBe(ERROR_CODES.NotFoundError);
    }
  });

  it("keeps a user's active and trashed plans out of another user's list", async () => {
    const trashed = await helpers.createBudgetPlan({ raw: true });
    await helpers.deleteBudgetPlan({ planId: trashed.plan.id });
    await helpers.createBudgetPlan({ raw: true });
    expect(await helpers.listBudgetPlans({ includeDeleted: true, raw: true })).toHaveLength(2);
    const other = await helpers.provisionSecondUserWithBaseCurrency();

    const lists = await helpers.asUser({
      cookies: other.cookies,
      fn: async () => [
        await helpers.listBudgetPlans({ raw: true }),
        await helpers.listBudgetPlans({ includeDeleted: true, raw: true }),
      ],
    });

    expect(lists).toEqual([[], []]);
  });

  it('patches only the mutable fields', async () => {
    const created = await helpers.createBudgetPlan({ raw: true });

    const updated = await helpers.updateBudgetPlan({
      planId: created.plan.id,
      payload: { name: 'Renamed', autoAttachAccounts: true, carryPolicy: 'floor' },
      raw: true,
    });
    expect(updated.plan.name).toBe('Renamed');
    expect(updated.plan.autoAttachAccounts).toBe(true);
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
    const [period] = await helpers.listBudgetPlanPeriods({ planId, raw: true });
    const categoryId = (await helpers.getCategoriesList())[0]!.id;
    const line = await helpers.createBudgetPlanLine({
      planId,
      payload: { name: 'Food', categoryIds: [categoryId] },
      raw: true,
    });

    expect((await helpers.deleteBudgetPlan({ planId })).statusCode).toBe(200);
    expect(await helpers.listBudgetPlans({ raw: true })).toEqual([]);
    expect((await helpers.getBudgetPlan({ planId })).statusCode).toBe(ERROR_CODES.NotFoundError);
    expect((await helpers.updateBudgetPlan({ planId, payload: { name: 'x' } })).statusCode).toBe(
      ERROR_CODES.NotFoundError,
    );
    expect((await helpers.setBudgetPlanAccounts({ planId, accountIds: [] })).statusCode).toBe(
      ERROR_CODES.NotFoundError,
    );

    const target = { planId, lineId: line.id };
    const statusCodes = [
      (await helpers.getBudgetPlanPeriodView({ planId, periodId: period!.id })).statusCode,
      (await helpers.getBudgetPlanTrends({ planId })).statusCode,
      (await helpers.createBudgetPlanLine({ planId, payload: { name: 'Late', categoryIds: [categoryId] } })).statusCode,
      (
        await helpers.setBudgetAssignment({
          ...target,
          periodId: period!.id,
          payload: { scope: 'from_here', amount: 10 },
        })
      ).statusCode,
      (await helpers.createBudgetLineGroup({ planId, name: 'Late' })).statusCode,
      (
        await helpers.setBudgetLineGoal({
          ...target,
          payload: { frequency: 'every_period', behavior: 'budget_another', amount: 10 },
        })
      ).statusCode,
      (await helpers.deleteBudgetPlan({ planId })).statusCode,
    ];
    for (const statusCode of statusCodes) {
      expect(statusCode).toBe(ERROR_CODES.NotFoundError);
    }
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
  it('keeps reads and delete open and answers other writes with 402', async () => {
    const trashed = await helpers.createBudgetPlan({ raw: true });
    await helpers.deleteBudgetPlan({ planId: trashed.plan.id });
    const created = await helpers.createBudgetPlan({ raw: true });
    const line = await helpers.createBudgetPlanLine({
      planId: created.plan.id,
      payload: { name: 'Food', categoryIds: [(await helpers.getCategoriesList())[0]!.id] },
      raw: true,
    });
    const group = await helpers.createBudgetLineGroup({ planId: created.plan.id, name: 'Bills', raw: true });

    await helpers.setUserBilling({
      plan: PLANS.early_adopter,
      trialEndsAt: null,
      firstBudgetPlanAt: new Date(Date.now() - (EARLY_ADOPTER_BUDGET_TRIAL_DAYS + 1) * MS_PER_DAY),
    });

    expect((await helpers.listBudgetPlans()).statusCode).toBe(200);
    expect((await helpers.getBudgetPlan({ planId: created.plan.id })).statusCode).toBe(200);
    expect((await helpers.listBudgetPlanPeriods({ planId: created.plan.id })).statusCode).toBe(200);
    const [period] = await helpers.listBudgetPlanPeriods({ planId: created.plan.id, raw: true });
    expect((await helpers.getBudgetPlanPeriodView({ planId: created.plan.id, periodId: period!.id })).statusCode).toBe(
      200,
    );
    expect((await helpers.getBudgetPlanScheduled({ planId: created.plan.id, periodId: period!.id })).statusCode).toBe(
      200,
    );
    expect((await helpers.getBudgetPlanTrends({ planId: created.plan.id })).statusCode).toBe(200);

    const write = await helpers.updateBudgetPlan({ planId: created.plan.id, payload: { name: 'Nope' } });
    expect(write.statusCode).toBe(ERROR_CODES.PaymentRequired);
    expect((write.body.response as unknown as ErrorResponse).code).toBe(API_ERROR_CODES.planRequired);

    expect(
      (await helpers.createBudgetPlan({ payload: { accountIds: created.accountIds as RecordId[] } })).statusCode,
    ).toBe(ERROR_CODES.PaymentRequired);

    const planId = created.plan.id;
    const target = { planId, lineId: line.id };
    const gatedStatusCodes = [
      (
        await helpers.setBudgetAssignment({
          ...target,
          periodId: period!.id,
          payload: { scope: 'from_here', amount: 10 },
        })
      ).statusCode,
      (
        await helpers.setBudgetLineGoal({
          ...target,
          payload: { frequency: 'every_period', behavior: 'budget_another', amount: 10 },
        })
      ).statusCode,
      (await helpers.deleteBudgetLineGoal(target)).statusCode,
      (await helpers.snoozeBudgetLineGoal({ ...target, periodId: period!.id })).statusCode,
      (await helpers.createBudgetLineGroup({ planId, name: 'More' })).statusCode,
      (await helpers.updateBudgetLineGroup({ planId, groupId: group.id, name: 'Renamed' })).statusCode,
      (await helpers.deleteBudgetLineGroup({ planId, groupId: group.id })).statusCode,
      (await helpers.setBudgetPlanLayout({ planId, payload: { groups: [], ungroupedLineIds: [line.id] } })).statusCode,
      (await helpers.setBudgetPlanAccounts({ planId, accountIds: created.accountIds })).statusCode,
      (await helpers.updateBudgetPlanLine({ ...target, payload: { name: 'Nope' } })).statusCode,
      (await helpers.archiveBudgetPlanLine(target)).statusCode,
      (await helpers.restoreBudgetPlanLine(target)).statusCode,
      (await helpers.deleteBudgetPlanLine(target)).statusCode,
      (await helpers.restoreBudgetPlan({ planId: trashed.plan.id })).statusCode,
    ];
    for (const statusCode of gatedStatusCodes) {
      expect(statusCode).toBe(ERROR_CODES.PaymentRequired);
    }

    expect((await helpers.deleteBudgetPlan({ planId: trashed.plan.id, permanent: true })).statusCode).toBe(200);
    expect((await helpers.deleteBudgetPlan({ planId: created.plan.id })).statusCode).toBe(200);
  });
});

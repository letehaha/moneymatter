import { API_ERROR_CODES, EARLY_ADOPTER_BUDGET_TRIAL_DAYS, FEATURES, PLANS } from '@bt/shared/types';
import { describe, expect, it } from '@jest/globals';
import { ERROR_CODES } from '@js/errors';
import * as helpers from '@tests/helpers';
import type { ErrorResponse } from '@tests/helpers/common';

const DAY = 24 * 60 * 60 * 1000;
const MINUTE = 60 * 1000;

const daysAgo = (days: number) => new Date(Date.now() - days * DAY);

const getEntitlements = async () => (await helpers.getUserInfo({ raw: true })).entitlements!;

describe('Early adopter budget trial', () => {
  it('grants budgeting before the first plan and starts the countdown when it is created', async () => {
    await helpers.setUserBilling({ plan: PLANS.early_adopter });

    const before = await getEntitlements();
    expect(before.features).toContain(FEATURES.budget_plan);
    expect(before.budgetPlanTrialEndsAt).toBeNull();

    expect((await helpers.createBudgetPlan()).statusCode).toBe(201);

    const { budgetPlanTrialEndsAt } = await getEntitlements();
    const expectedEnd = Date.now() + EARLY_ADOPTER_BUDGET_TRIAL_DAYS * DAY;
    expect(Math.abs(new Date(budgetPlanTrialEndsAt!).getTime() - expectedEnd)).toBeLessThan(MINUTE);
  });

  it('keeps writes open on the last day of the window', async () => {
    const { plan } = await helpers.createBudgetPlan({ raw: true });
    await helpers.setUserBilling({
      plan: PLANS.early_adopter,
      firstBudgetPlanAt: daysAgo(EARLY_ADOPTER_BUDGET_TRIAL_DAYS - 1),
    });

    expect((await helpers.updateBudgetPlan({ planId: plan.id, payload: { name: 'Still open' } })).statusCode).toBe(200);
  });

  it('turns the budget read-only once the window has passed, with reads and delete still open', async () => {
    const { plan } = await helpers.createBudgetPlan({ raw: true });
    await helpers.setUserBilling({
      plan: PLANS.early_adopter,
      firstBudgetPlanAt: daysAgo(EARLY_ADOPTER_BUDGET_TRIAL_DAYS + 1),
    });

    const entitlements = await getEntitlements();
    expect(entitlements.features).not.toContain(FEATURES.budget_plan);
    expect(entitlements.readOnly).toBe(false);
    expect(new Date(entitlements.budgetPlanTrialEndsAt!).getTime()).toBeLessThan(Date.now());

    const write = await helpers.updateBudgetPlan({ planId: plan.id, payload: { name: 'Nope' } });
    expect(write.statusCode).toBe(ERROR_CODES.PaymentRequired);
    expect((write.body.response as unknown as ErrorResponse).code).toBe(API_ERROR_CODES.planRequired);

    expect((await helpers.getBudgetPlan({ planId: plan.id })).statusCode).toBe(200);
    const [period] = await helpers.listBudgetPlanPeriods({ planId: plan.id, raw: true });
    expect((await helpers.getBudgetPlanPeriodView({ planId: plan.id, periodId: period!.id })).statusCode).toBe(200);
    expect((await helpers.deleteBudgetPlan({ planId: plan.id })).statusCode).toBe(200);
  });

  it('keeps the first anchor when a later plan is created', async () => {
    await helpers.setUserBilling({ plan: PLANS.early_adopter });
    const first = await helpers.createBudgetPlan({ raw: true });
    const { budgetPlanTrialEndsAt } = await getEntitlements();

    await helpers.deleteBudgetPlan({ planId: first.plan.id, raw: true });
    expect((await helpers.createBudgetPlan()).statusCode).toBe(201);

    expect((await getEntitlements()).budgetPlanTrialEndsAt).toBe(budgetPlanTrialEndsAt);
  });

  it('starts the countdown when a restored backup brings plans back', async () => {
    await helpers.setUserBilling({ plan: PLANS.early_adopter });
    await helpers.createBudgetPlan({ raw: true });
    const backup = await helpers.exportBackup();
    expect(backup.statusCode).toBe(200);

    await helpers.setUserBilling({ firstBudgetPlanAt: null });
    expect((await getEntitlements()).budgetPlanTrialEndsAt).toBeNull();

    const restore = await helpers.restoreBackup({ fileContent: backup.body.toString('base64') });
    expect(restore.statusCode).toBe(200);
    expect((await helpers.waitForRestore({ jobId: restore.jobId! })).status).toBe('completed');

    const { budgetPlanTrialEndsAt } = await getEntitlements();
    const expectedEnd = Date.now() + EARLY_ADOPTER_BUDGET_TRIAL_DAYS * DAY;
    expect(Math.abs(new Date(budgetPlanTrialEndsAt!).getTime() - expectedEnd)).toBeLessThan(MINUTE);
  });

  it.each([
    ['inside', EARLY_ADOPTER_BUDGET_TRIAL_DAYS - 1],
    ['after', EARLY_ADOPTER_BUDGET_TRIAL_DAYS + 1],
  ])(
    'reports no budget trial for an early adopter whose live subscription covers budgeting, anchor %s the window',
    async (_, anchorDaysAgo) => {
      const { id } = await helpers.getUserInfo({ raw: true });
      const webhook = await helpers.sendBillingWebhook({
        payload: helpers.buildStripeSubscriptionEvent({ userId: id }),
      });
      expect(webhook.body.outcome).toBe('processed');
      await helpers.setUserBilling({ plan: PLANS.early_adopter, firstBudgetPlanAt: daysAgo(anchorDaysAgo) });

      const entitlements = await getEntitlements();
      expect(entitlements.features).toContain(FEATURES.budget_plan);
      expect(entitlements.budgetPlanTrialEndsAt).toBeNull();
    },
  );

  it.each([PLANS.essential, PLANS.plus])('reports no budget trial for a %s user', async (plan) => {
    await helpers.setUserBilling({ plan, firstBudgetPlanAt: daysAgo(EARLY_ADOPTER_BUDGET_TRIAL_DAYS + 1) });

    const entitlements = await getEntitlements();
    expect(entitlements.features).toContain(FEATURES.budget_plan);
    expect(entitlements.budgetPlanTrialEndsAt).toBeNull();
  });
});

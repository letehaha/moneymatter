import { FEATURES } from '@bt/shared/types';
import archiveLine from '@controllers/budget-plans/archive-line';
import createLine from '@controllers/budget-plans/create-line';
import createPlan from '@controllers/budget-plans/create-plan';
import deleteLine from '@controllers/budget-plans/delete-line';
import deletePlan from '@controllers/budget-plans/delete-plan';
import getPeriodView from '@controllers/budget-plans/get-period-view';
import getPlan from '@controllers/budget-plans/get-plan';
import listPeriods from '@controllers/budget-plans/list-periods';
import listPlans from '@controllers/budget-plans/list-plans';
import restoreLine from '@controllers/budget-plans/restore-line';
import restorePlan from '@controllers/budget-plans/restore-plan';
import setAssignment from '@controllers/budget-plans/set-assignment';
import setPlanAccounts from '@controllers/budget-plans/set-plan-accounts';
import updateLine from '@controllers/budget-plans/update-line';
import updatePlan from '@controllers/budget-plans/update-plan';
import { authenticateSession } from '@middlewares/better-auth';
import { checkBaseCurrencyLock } from '@middlewares/check-base-currency-lock';
import { requireFeature } from '@middlewares/entitlements';
import { validateEndpoint } from '@middlewares/validations';
import { Router } from 'express';

const router = Router({});

// Reads stay ungated: a lapsed user keeps reading their budget, and
// `enforceReadOnly` stops their writes like everywhere else.
router.get('/', authenticateSession, validateEndpoint(listPlans.schema), listPlans.handler);
router.get('/:planId', authenticateSession, validateEndpoint(getPlan.schema), getPlan.handler);
router.get('/:planId/periods', authenticateSession, validateEndpoint(listPeriods.schema), listPeriods.handler);
router.get(
  '/:planId/periods/:periodId',
  authenticateSession,
  validateEndpoint(getPeriodView.schema),
  getPeriodView.handler,
);

router.post(
  '/',
  authenticateSession,
  requireFeature(FEATURES.budget_plan),
  checkBaseCurrencyLock,
  validateEndpoint(createPlan.schema),
  createPlan.handler,
);
router.patch(
  '/:planId',
  authenticateSession,
  requireFeature(FEATURES.budget_plan),
  checkBaseCurrencyLock,
  validateEndpoint(updatePlan.schema),
  updatePlan.handler,
);
// Ungated: an active plan blocks base-currency changes, so a lapsed user must be able to drop it.
router.delete(
  '/:planId',
  authenticateSession,
  checkBaseCurrencyLock,
  validateEndpoint(deletePlan.schema),
  deletePlan.handler,
);
router.post(
  '/:planId/restore',
  authenticateSession,
  requireFeature(FEATURES.budget_plan),
  checkBaseCurrencyLock,
  validateEndpoint(restorePlan.schema),
  restorePlan.handler,
);
router.put(
  '/:planId/accounts',
  authenticateSession,
  requireFeature(FEATURES.budget_plan),
  checkBaseCurrencyLock,
  validateEndpoint(setPlanAccounts.schema),
  setPlanAccounts.handler,
);
router.post(
  '/:planId/lines',
  authenticateSession,
  requireFeature(FEATURES.budget_plan),
  checkBaseCurrencyLock,
  validateEndpoint(createLine.schema),
  createLine.handler,
);
router.patch(
  '/:planId/lines/:lineId',
  authenticateSession,
  requireFeature(FEATURES.budget_plan),
  checkBaseCurrencyLock,
  validateEndpoint(updateLine.schema),
  updateLine.handler,
);
router.delete(
  '/:planId/lines/:lineId',
  authenticateSession,
  requireFeature(FEATURES.budget_plan),
  checkBaseCurrencyLock,
  validateEndpoint(deleteLine.schema),
  deleteLine.handler,
);
router.post(
  '/:planId/lines/:lineId/archive',
  authenticateSession,
  requireFeature(FEATURES.budget_plan),
  checkBaseCurrencyLock,
  validateEndpoint(archiveLine.schema),
  archiveLine.handler,
);
router.post(
  '/:planId/lines/:lineId/restore',
  authenticateSession,
  requireFeature(FEATURES.budget_plan),
  checkBaseCurrencyLock,
  validateEndpoint(restoreLine.schema),
  restoreLine.handler,
);
router.put(
  '/:planId/periods/:periodId/lines/:lineId/assignment',
  authenticateSession,
  requireFeature(FEATURES.budget_plan),
  checkBaseCurrencyLock,
  validateEndpoint(setAssignment.schema),
  setAssignment.handler,
);

export default router;

import { FEATURES } from '@bt/shared/types';
import addSuggestedLines from '@controllers/budget-plans/add-suggested-lines';
import archiveLine from '@controllers/budget-plans/archive-line';
import createGroup from '@controllers/budget-plans/create-group';
import createLine from '@controllers/budget-plans/create-line';
import createPlan from '@controllers/budget-plans/create-plan';
import deleteGroup from '@controllers/budget-plans/delete-group';
import deleteLine from '@controllers/budget-plans/delete-line';
import deleteLineGoal from '@controllers/budget-plans/delete-line-goal';
import deletePlan from '@controllers/budget-plans/delete-plan';
import getPeriodView from '@controllers/budget-plans/get-period-view';
import getPlan from '@controllers/budget-plans/get-plan';
import getScheduled from '@controllers/budget-plans/get-scheduled';
import getSuggestionContext from '@controllers/budget-plans/get-suggestion-context';
import getTrends from '@controllers/budget-plans/get-trends';
import listPeriods from '@controllers/budget-plans/list-periods';
import listPlans from '@controllers/budget-plans/list-plans';
import restoreLine from '@controllers/budget-plans/restore-line';
import restorePlan from '@controllers/budget-plans/restore-plan';
import setAssignment from '@controllers/budget-plans/set-assignment';
import setLayout from '@controllers/budget-plans/set-layout';
import setLineGoal from '@controllers/budget-plans/set-line-goal';
import setPlanAccounts from '@controllers/budget-plans/set-plan-accounts';
import snoozeLineGoal from '@controllers/budget-plans/snooze-line-goal';
import updateGroup from '@controllers/budget-plans/update-group';
import updateLine from '@controllers/budget-plans/update-line';
import updatePlan from '@controllers/budget-plans/update-plan';
import { authenticateSession } from '@middlewares/better-auth';
import { checkBaseCurrencyLock } from '@middlewares/check-base-currency-lock';
import { requireFeature } from '@middlewares/entitlements';
import { Router } from 'express';

// `/budget-plans` serves the user-facing "Budget"; budgets.route.ts serves "Trackers".
const router = Router({});
const gatedWrite = [authenticateSession, requireFeature(FEATURES.budget_plan), checkBaseCurrencyLock];

// Reads stay ungated: a lapsed user keeps reading their budget, and
// `enforceReadOnly` stops their writes like everywhere else.
router.get('/', authenticateSession, listPlans);
router.get('/suggestion-context', authenticateSession, getSuggestionContext);
router.get('/:planId', authenticateSession, getPlan);
router.get('/:planId/trends', authenticateSession, getTrends);
router.get('/:planId/periods', authenticateSession, listPeriods);
router.get('/:planId/periods/:periodId', authenticateSession, getPeriodView);
router.get('/:planId/periods/:periodId/scheduled', authenticateSession, getScheduled);

router.post('/', ...gatedWrite, createPlan);
router.patch('/:planId', ...gatedWrite, updatePlan);
// Ungated: an active plan blocks base-currency changes, so a lapsed user must be able to drop it.
router.delete('/:planId', authenticateSession, checkBaseCurrencyLock, deletePlan);
router.post('/:planId/restore', ...gatedWrite, restorePlan);
router.put('/:planId/accounts', ...gatedWrite, setPlanAccounts);
router.post('/:planId/groups', ...gatedWrite, createGroup);
router.patch('/:planId/groups/:groupId', ...gatedWrite, updateGroup);
router.delete('/:planId/groups/:groupId', ...gatedWrite, deleteGroup);
router.put('/:planId/layout', ...gatedWrite, setLayout);
router.post('/:planId/lines', ...gatedWrite, createLine);
router.post('/:planId/suggested-lines', ...gatedWrite, addSuggestedLines);
router.patch('/:planId/lines/:lineId', ...gatedWrite, updateLine);
router.delete('/:planId/lines/:lineId', ...gatedWrite, deleteLine);
router.post('/:planId/lines/:lineId/archive', ...gatedWrite, archiveLine);
router.post('/:planId/lines/:lineId/restore', ...gatedWrite, restoreLine);
router.put('/:planId/lines/:lineId/goal', ...gatedWrite, setLineGoal);
router.delete('/:planId/lines/:lineId/goal', ...gatedWrite, deleteLineGoal);
router.post('/:planId/lines/:lineId/goal/snooze', ...gatedWrite, snoozeLineGoal);
router.put('/:planId/periods/:periodId/lines/:lineId/assignment', ...gatedWrite, setAssignment);

export default router;
